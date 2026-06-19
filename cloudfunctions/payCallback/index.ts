// 支付回调云函数入口（独立部署）
// 职责：验证微信支付回调签名 → 解密报文 → 幂等更新订单为已支付
//      → 调用顺势 API 下单（safe_price = 用户实付金额）→ 更新为开通中/接口失败
//      → 写入 timeline 与审计日志 → 返回微信要求的应答报文
import * as cloud from 'wx-server-sdk';
import {
  decryptResource,
  verifyNotifySignature,
  loadWechatPayCallbackConfig,
  EncryptedResource,
  WechatPayCallbackConfig,
  PayTransactionResult
} from './payment/wechatpay';
import { getShunshiClient } from './shared/utils/shunshi';
import { createAuditLog, writeAuditLog } from './shared/utils/logger';
import { OrderStatus, Order, TimelineNode } from './shared/types/order';
import { AuditType } from './shared/types/audit';

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

/** 微信支付回调应答报文（按微信要求返回） */
interface WechatPayCallbackReply {
  code: 'SUCCESS' | 'FAIL';
  message: string;
}

/** 成功应答（微信收到后不再重试） */
const REPLY_SUCCESS: WechatPayCallbackReply = { code: 'SUCCESS', message: '成功' };

/** 从原始事件中解析出报文主体、通知对象与请求头，兼容 HTTP 触发与直接调用两种形式 */
function parseEvent(event: any): { rawBody: string; notification: any; headers: Record<string, any> } {
  const headers: Record<string, any> = event && event.headers ? event.headers : {};
  let rawBody = '';

  if (typeof event?.body === 'string') {
    // HTTP 触发：body 为字符串，可能为 base64 编码
    rawBody = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
  } else if (event?.body && typeof event.body === 'object') {
    rawBody = JSON.stringify(event.body);
  } else if (event?.resource) {
    // 直接以通知对象形式调用
    rawBody = JSON.stringify(event);
  }

  let notification: any = {};
  if (rawBody) {
    notification = JSON.parse(rawBody);
  } else if (event?.resource) {
    notification = event;
  }

  return { rawBody, notification, headers };
}

/** 不区分大小写读取请求头 */
function getHeader(headers: Record<string, any>, name: string): string {
  if (!headers) return '';
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      return String(headers[key]);
    }
  }
  return '';
}

/** 从用户填写的 attach 中提取充值账号 */
function extractAccount(attach: Record<string, any> | undefined): string {
  if (!attach) return '';
  // 优先匹配常见账号字段
  const candidates = ['recharge_account', 'account', 'phone', 'mobile'];
  for (const key of candidates) {
    if (attach[key]) return String(attach[key]);
  }
  // 兜底：取第一个非空字符串值
  for (const key of Object.keys(attach)) {
    if (typeof attach[key] === 'string' && attach[key]) {
      return attach[key];
    }
  }
  return '';
}

/**
 * 验证回调签名并解密报文，返回支付成功通知核心字段
 * 验签失败或解密失败时抛出错误，由主流程拒绝处理
 */
function verifyAndDecrypt(
  notification: any,
  rawBody: string,
  headers: Record<string, any>
): PayTransactionResult {
  // 读取回调配置（API v3 密钥必需，缺失会抛错）
  const config: WechatPayCallbackConfig = loadWechatPayCallbackConfig();

  // 1. 验证回调签名（仅在配置了平台证书公钥时执行；未配置则跳过并告警）
  if (config.platformPublicKey) {
    const timestamp = getHeader(headers, 'Wechatpay-Timestamp');
    const nonce = getHeader(headers, 'Wechatpay-Nonce');
    const signature = getHeader(headers, 'Wechatpay-Signature');

    if (!timestamp || !nonce || !signature) {
      throw new Error('回调签名头缺失，拒绝处理');
    }

    const valid = verifyNotifySignature(
      { timestamp, nonce, body: rawBody, signature },
      config.platformPublicKey
    );
    if (!valid) {
      throw new Error('回调签名验证失败，拒绝处理');
    }
  } else {
    console.warn('[payCallback] 未配置 WXPAY_PLATFORM_PUBLIC_KEY，跳过签名验证');
  }

  // 2. 解密回调报文（AES-256-GCM）
  const resource = notification.resource as EncryptedResource | undefined;
  if (!resource || !resource.ciphertext) {
    throw new Error('回调报文缺少 resource 加密数据');
  }

  const plaintext = decryptResource(resource, config.apiV3Key);
  return JSON.parse(plaintext) as PayTransactionResult;
}

/**
 * 调用顺势 API 下单并更新订单状态
 * 成功：更新为开通中，记录顺势订单号；失败：更新为接口失败，记录错误
 */
async function submitToShunshi(db: any, order: Order): Promise<void> {
  const _ = db.command;
  const ordersCollection = db.collection('orders');

  try {
    const shunshi = getShunshiClient();

    // 组装 attach，确保包含充值账号 recharge_account（顺势要求账号放在 attach 内）
    const attach: Record<string, string> = { ...(order.attach as Record<string, string>) };
    if (!attach.recharge_account) {
      const account = extractAccount(order.attach);
      if (account) {
        attach.recharge_account = account;
      }
    }

    // 异步回调地址（从环境变量读取，未配置则不传）
    const callbackUrl = process.env.SHUNSHI_CALLBACK_URL || '';

    // safe_price 等于用户实付金额（order.amount），单位为「元」（与顺势售价一致）
    // 顺势 API safe_price 用于防止上游调价亏本，不能小于售价，单位同售价（元），故不做元→分转换
    const result = await shunshi.submitOrder({
      id: order.shunshiGoodsId || 0,
      quantity: 1,
      external_orderno: order.orderId,
      safe_price: order.amount, // 单位：元
      attach,
      ...(callbackUrl ? { url: callbackUrl } : {})
    });

    // 下单成功：更新为开通中，记录顺势订单号
    const activatingNode: TimelineNode = {
      status: OrderStatus.ACTIVATING,
      time: new Date(),
      desc: '已提交开通，等待到账'
    };
    await ordersCollection.doc(order._id).update({
      data: {
        status: OrderStatus.ACTIVATING,
        shunshiOrderSn: result.ordersn,
        updatedAt: new Date(),
        timeline: _.push([activatingNode])
      }
    });

    // 审计日志：顺势下单成功
    await writeAuditLog(
      db,
      createAuditLog({
        type: AuditType.SHUNSHI_SUBMIT,
        operator: 'system',
        orderId: order.orderId,
        action: '调用顺势 API 下单成功',
        detail: { requestPath: '/api/v1/order/buy', ordersn: result.ordersn },
        result: 'success'
      })
    );
  } catch (err) {
    // 下单失败：更新为接口失败，记录错误码与原因
    const errMsg = err instanceof Error ? err.message : String(err);
    const failedNode: TimelineNode = {
      status: OrderStatus.API_FAILED,
      time: new Date(),
      desc: '开通失败，请联系客服处理'
    };
    await ordersCollection.doc(order._id).update({
      data: {
        status: OrderStatus.API_FAILED,
        failReason: errMsg,
        updatedAt: new Date(),
        timeline: _.push([failedNode])
      }
    });

    // 审计日志：顺势下单失败
    await writeAuditLog(
      db,
      createAuditLog({
        type: AuditType.SHUNSHI_SUBMIT,
        operator: 'system',
        orderId: order.orderId,
        action: '调用顺势 API 下单失败',
        detail: { requestPath: '/api/v1/order/buy' },
        result: 'failed',
        errorMsg: errMsg
      })
    );
  }
}

/**
 * 微信支付成功回调处理主入口
 * @param event HTTP 触发事件或直接调用的通知对象
 */
export async function main(event: any, _context: any): Promise<WechatPayCallbackReply> {
  // 1. 解析事件、验签并解密
  let transaction: PayTransactionResult;
  try {
    const { rawBody, notification, headers } = parseEvent(event);
    transaction = verifyAndDecrypt(notification, rawBody, headers);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[payCallback] 验签或解密失败：', errMsg);
    return { code: 'FAIL', message: errMsg };
  }

  // 2. 仅处理支付成功通知
  if (transaction.trade_state !== 'SUCCESS') {
    console.warn('[payCallback] 非支付成功通知，trade_state=', transaction.trade_state);
    return REPLY_SUCCESS;
  }

  const orderId = transaction.out_trade_no;
  const db = cloud.database();
  const _ = db.command;
  const ordersCollection = db.collection('orders');

  // 3. 查询订单
  const queryRes = await ordersCollection.where({ orderId }).limit(1).get();
  const orders: Order[] = queryRes.data || [];
  if (orders.length === 0) {
    console.error('[payCallback] 未找到订单：', orderId);
    // 订单不存在仍返回成功，避免微信无意义重试
    return REPLY_SUCCESS;
  }

  const order = orders[0];

  // 4. 幂等处理：非待支付状态视为已处理，直接返回成功
  if (order.status !== OrderStatus.PENDING_PAY) {
    console.log('[payCallback] 订单已处理，幂等返回：', orderId, order.status);
    return REPLY_SUCCESS;
  }

  // 5. 更新订单为已支付，记录交易号与支付时间，追加 timeline 节点
  const paidNode: TimelineNode = {
    status: OrderStatus.PAID,
    time: new Date(),
    desc: '支付成功'
  };
  await ordersCollection.doc(order._id).update({
    data: {
      status: OrderStatus.PAID,
      payTransactionId: transaction.transaction_id,
      paidAt: new Date(),
      updatedAt: new Date(),
      timeline: _.push([paidNode])
    }
  });

  // 审计日志：支付成功
  await writeAuditLog(
    db,
    createAuditLog({
      type: AuditType.ORDER_PAY,
      operator: 'system',
      orderId,
      action: '微信支付成功回调',
      detail: {
        transactionId: transaction.transaction_id,
        // 审计金额统一记录为「元」：微信回调 amount.total 单位为「分」，需 ÷100 转回元后再与 order.amount（元）对齐
        amount: transaction.amount
          ? Math.round(transaction.amount.total) / 100
          : order.amount
      },
      result: 'success'
    })
  );

  // 6. 触发顺势 API 下单（内部更新为开通中/接口失败并写日志）
  //    使用已支付后的订单对象（携带 _id 与下单所需字段）
  await submitToShunshi(db, { ...order, status: OrderStatus.PAID });

  // 7. 支付已入账，无论开通结果如何均返回成功，避免微信重复回调
  return REPLY_SUCCESS;
}
