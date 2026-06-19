// 退款回调云函数入口（独立部署）
// 任务 9.1：微信退款结果回调处理
// 设计依据：Requirements 6.4（退款回调成功后订单状态流转为 refunded）
// 处理流程：
//   1. 解析回调报文，验证回调签名（已配置平台证书公钥时执行 RSA 验签）
//   2. 复用 wechatpay 的 AES-256-GCM 解密退款回调资源体
//   3. 幂等处理（已退款订单直接返回成功）
//   4. 退款成功更新订单状态为 refunded，记录退款时间并追加 timeline 节点
//   5. 写入审计日志，并尽力触发退款到账订阅消息通知
//   6. 返回微信支付要求的应答报文（{ code, message }）
import * as cloud from 'wx-server-sdk';
import { OrderStatus, TimelineNode } from './shared/types/order';
import { AuditType } from './shared/types/audit';
import { createAuditLog, writeAuditLog } from './shared/utils/logger';
import {
  decryptResource,
  verifyNotifySignature,
  loadWechatPayCallbackConfig,
  EncryptedResource,
  WechatPayCallbackConfig
} from '../payment/wechatpay';

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

/** 订单集合名 */
const ORDERS_COLLECTION = 'orders';

/** 退款成功的事件类型 */
const EVENT_REFUND_SUCCESS = 'REFUND.SUCCESS';

/** 退款成功状态值 */
const REFUND_STATUS_SUCCESS = 'SUCCESS';

/** 微信支付要求的成功应答 */
const ACK_SUCCESS = { code: 'SUCCESS', message: '成功' };

/** 微信支付要求的失败应答（微信将按策略重试推送） */
function ackFail(message: string): { code: 'FAIL'; message: string } {
  return { code: 'FAIL', message };
}

/** 微信退款回调报文结构 */
interface RefundNotification {
  id?: string;
  event_type?: string;
  resource_type?: string;
  summary?: string;
  resource?: EncryptedResource;
}

/** 解密后的退款资源明文（仅声明本任务关注字段） */
interface RefundResource {
  mchid?: string;
  out_trade_no?: string;
  transaction_id?: string;
  out_refund_no?: string;
  refund_id?: string;
  refund_status?: string;
  success_time?: string;
  amount?: { refund?: number; payer_refund?: number };
}

/** 解析后的回调上下文 */
interface ParsedEvent {
  /** 原始报文主体（用于验签） */
  body: string;
  /** 解析后的回调报文对象 */
  notification: RefundNotification;
  /** 统一小写键的请求头 */
  headers: Record<string, string>;
}

/**
 * 从云函数 HTTP 触发事件中解析回调报文与请求头
 * 兼容 HTTP 触发（body 为字符串，可能 Base64 编码）与直接调用（event 即报文对象）两种入参
 */
function parseEvent(event: any): ParsedEvent {
  if (event && typeof event.body === 'string') {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    return {
      body: raw,
      notification: safeJsonParse(raw),
      headers: normalizeHeaders(event.headers)
    };
  }

  // 直接传入已解析对象（便于测试或内部调用）
  if (event && event.body && typeof event.body === 'object') {
    return {
      body: JSON.stringify(event.body),
      notification: event.body as RefundNotification,
      headers: normalizeHeaders(event.headers)
    };
  }

  return {
    body: JSON.stringify(event || {}),
    notification: (event as RefundNotification) || {},
    headers: normalizeHeaders(event && event.headers)
  };
}

/** 将请求头统一转为小写键，便于大小写无关读取 */
function normalizeHeaders(headers: any): Record<string, string> {
  const result: Record<string, string> = {};
  if (headers && typeof headers === 'object') {
    for (const key of Object.keys(headers)) {
      result[key.toLowerCase()] = String(headers[key]);
    }
  }
  return result;
}

/** 安全 JSON 解析，失败返回空对象 */
function safeJsonParse(raw: string): any {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * 验证回调签名
 * 仅当配置了微信支付平台证书公钥时执行 RSA 验签；
 * 未配置公钥时返回 true（由后续 AES-256-GCM 解密的认证标签保证报文完整性，防篡改）。
 */
function checkSignature(
  body: string,
  headers: Record<string, string>,
  config: WechatPayCallbackConfig
): boolean {
  if (!config.platformPublicKey) {
    return true;
  }
  const timestamp = headers['wechatpay-timestamp'];
  const nonce = headers['wechatpay-nonce'];
  const signature = headers['wechatpay-signature'];
  if (!timestamp || !nonce || !signature) {
    return false;
  }
  return verifyNotifySignature(
    { timestamp, nonce, body, signature },
    config.platformPublicKey
  );
}

// 微信退款结果回调处理
export async function main(event: any, _context: any) {
  const db = cloud.database();
  const { body, notification, headers } = parseEvent(event);

  // 读取回调配置（API v3 密钥必需，缺失会抛错并返回 FAIL）
  let config: WechatPayCallbackConfig;
  try {
    config = loadWechatPayCallbackConfig();
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[refundCallback] 读取回调配置失败：', errorMsg);
    return ackFail('回调配置缺失');
  }

  // 1. 验证回调签名（配置了平台公钥时）
  if (!checkSignature(body, headers, config)) {
    console.error('[refundCallback] 回调签名验证失败');
    return ackFail('签名验证失败');
  }

  // 2. 解密退款回调资源体
  if (!notification || !notification.resource) {
    console.error('[refundCallback] 回调报文缺少 resource 字段');
    return ackFail('报文格式错误');
  }

  let resource: RefundResource;
  try {
    const plaintext = decryptResource(notification.resource, config.apiV3Key);
    resource = JSON.parse(plaintext) as RefundResource;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[refundCallback] 退款回调报文解密失败：', errorMsg);
    return ackFail('解密失败');
  }

  const orderId = resource.out_trade_no ? String(resource.out_trade_no) : '';
  if (!orderId) {
    console.error('[refundCallback] 解密报文缺少 out_trade_no');
    return ackFail('缺少订单号');
  }

  // 3. 查询订单
  const orderRes = await db.collection(ORDERS_COLLECTION).where({ orderId }).limit(1).get();
  const orderList = orderRes && Array.isArray(orderRes.data) ? orderRes.data : [];
  if (orderList.length === 0) {
    console.error('[refundCallback] 订单不存在：', orderId);
    // 订单不存在时返回成功，避免微信无意义重试
    return ACK_SUCCESS;
  }
  const order = orderList[0];

  // 仅处理退款成功事件，其余事件（退款异常/关闭）记录日志后确认接收
  const isSuccess =
    notification.event_type === EVENT_REFUND_SUCCESS &&
    (!resource.refund_status || resource.refund_status === REFUND_STATUS_SUCCESS);
  if (!isSuccess) {
    console.warn(
      `[refundCallback] 非退款成功事件，订单：${orderId}，事件：${notification.event_type}，状态：${resource.refund_status}`
    );
    await safeWriteRefundLog(db, {
      orderId,
      amount: order.amount,
      refundId: resource.refund_id,
      result: 'failed',
      errorMsg: `退款未成功：event=${notification.event_type}, status=${resource.refund_status}`
    });
    return ACK_SUCCESS;
  }

  // 4. 幂等处理：已退款订单直接返回成功
  if (order.status === OrderStatus.REFUNDED) {
    console.info('[refundCallback] 订单已处理退款，幂等返回：', orderId);
    return ACK_SUCCESS;
  }

  // 5. 退款成功：更新订单状态为 refunded，记录退款时间并追加 timeline 节点
  const now = new Date();
  const timelineNode: TimelineNode = {
    status: OrderStatus.REFUNDED,
    time: now,
    desc: '退款已到账'
  };
  const _ = db.command;
  await db
    .collection(ORDERS_COLLECTION)
    .where({ orderId })
    .update({
      data: {
        status: OrderStatus.REFUNDED,
        refundId: resource.refund_id || order.refundId,
        refundedAt: now,
        timeline: _.push([timelineNode]),
        updatedAt: now
      }
    });

  // 6. 写入审计日志（操作人标记为系统）
  await safeWriteRefundLog(db, {
    orderId,
    amount: order.amount,
    refundId: resource.refund_id,
    result: 'success'
  });

  // 7. 尽力触发退款到账订阅消息通知（失败不影响订单流转，也不影响应答）
  await safeNotifyRefund(order.openid, orderId, order.amount);

  return ACK_SUCCESS;
}

/** 退款审计日志参数 */
interface RefundLogParams {
  orderId: string;
  amount: number;
  refundId?: string;
  result: 'success' | 'failed';
  errorMsg?: string;
}

/**
 * 写入退款审计日志，写库失败不阻断主流程
 */
async function safeWriteRefundLog(db: any, params: RefundLogParams): Promise<void> {
  try {
    const log = createAuditLog({
      type: AuditType.REFUND_SUCCESS,
      operator: 'system',
      orderId: params.orderId,
      action: '退款到账',
      result: params.result,
      detail: {
        refundAmount: params.amount,
        refundId: params.refundId
      },
      errorMsg: params.errorMsg
    });
    await writeAuditLog(db, log);
  } catch (logErr) {
    console.error('[refundCallback] 写入退款审计日志失败：', logErr);
  }
}

/**
 * 尽力触发退款到账订阅消息通知（调用 notify 云函数），异常吞掉不阻断回调应答
 */
async function safeNotifyRefund(openid: string, orderId: string, amount: number): Promise<void> {
  try {
    await cloud.callFunction({
      name: 'notify',
      data: {
        action: 'send',
        type: 'refund_success',
        openid,
        orderId,
        amount
      }
    });
  } catch (notifyErr) {
    console.error('[refundCallback] 触发退款到账通知失败：', notifyErr);
  }
}
