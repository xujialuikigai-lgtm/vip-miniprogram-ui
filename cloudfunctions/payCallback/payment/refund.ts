// 退款发起逻辑（任务 7.2）
// 设计依据：Requirements 6.1 / 6.2 / 6.3 / 6.5
// 流程：校验管理员权限 -> 校验订单状态为 api_failed -> 调用微信退款接口（原路退回实付金额）
//      -> 更新订单状态为 refunding -> 记录退款原因与补充说明 -> 写入审计日志
import { Order, OrderStatus, TimelineNode } from '../shared/types/order';
import { CloudFunctionResult } from '../shared/types/api';
import { AuditType } from '../shared/types/audit';
import { createAuditLog, writeAuditLog } from '../shared/utils/logger';
import { requireAdmin } from '../shared/utils/adminAuth';
import { NOTE_MAX_LENGTH } from '../shared/constants';
import { WechatPayClient, WechatPayError } from './wechatpay';

/** 订单集合名 */
const ORDERS_COLLECTION = 'orders';

/** 退款发起入参 */
export interface RefundParams {
  /** 系统订单号 */
  orderId: string;
  /** 失败原因分类（必填） */
  reason: string;
  /** 补充说明（可选，最大 200 字符） */
  note?: string;
}

/** 退款发起出参 */
export interface RefundData {
  /** 是否受理成功 */
  success: boolean;
  /** 微信退款单号 */
  refundId: string;
  /** 订单最新状态 */
  status: OrderStatus;
}

/** 错误码常量 */
export const ERR_INVALID_PARAM = 'INVALID_PARAM';
export const ERR_ORDER_NOT_FOUND = 'ORDER_NOT_FOUND';
export const ERR_ORDER_STATUS = 'ORDER_STATUS_INVALID';
export const ERR_REFUND_FAILED = 'REFUND_FAILED';

/**
 * 退款发起主流程
 *
 * @param db        云数据库实例
 * @param openid    调用者 openid（用于管理员权限校验与审计记录）
 * @param params    退款入参
 * @param payClient 微信支付客户端（可注入，便于测试；默认从环境变量构建）
 */
export async function refund(
  db: any,
  openid: string,
  params: RefundParams,
  payClient?: WechatPayClient
): Promise<CloudFunctionResult<RefundData>> {
  // 1. 管理员权限校验（不通过时直接返回权限错误）
  const auth = await requireAdmin(db, openid, { action: 'refund' });
  if (!auth.allowed) {
    return auth.error as CloudFunctionResult<RefundData>;
  }

  // 2. 入参校验：orderId 与 reason 必填
  const orderId = params && params.orderId ? String(params.orderId).trim() : '';
  const reason = params && params.reason ? String(params.reason).trim() : '';
  if (!orderId) {
    return { success: false, errCode: ERR_INVALID_PARAM, errMsg: '缺少订单号' };
  }
  if (!reason) {
    return { success: false, errCode: ERR_INVALID_PARAM, errMsg: '请选择失败原因分类' };
  }
  // 补充说明截断到最大长度
  const note = params.note ? String(params.note).slice(0, NOTE_MAX_LENGTH) : '';

  // 3. 查询订单
  const orderRes = await db
    .collection(ORDERS_COLLECTION)
    .where({ orderId })
    .limit(1)
    .get();
  const orderList: Order[] = orderRes && Array.isArray(orderRes.data) ? orderRes.data : [];
  if (orderList.length === 0) {
    return { success: false, errCode: ERR_ORDER_NOT_FOUND, errMsg: '订单不存在' };
  }
  const order = orderList[0];

  // 4. 状态校验：仅 api_failed 的订单允许发起退款（幂等保护，避免重复退款）
  if (order.status !== OrderStatus.API_FAILED) {
    return {
      success: false,
      errCode: ERR_ORDER_STATUS,
      errMsg: `当前订单状态（${order.status}）不允许发起退款`,
    };
  }

  // 5. 调用微信支付退款接口，退款金额等于用户实付金额（原路退回）
  // order.amount 单位为「元」，微信退款 API v3 的 amount.refund / amount.total 要求「分」（整数）
  // 用 Math.round 做元→分转换，规避浮点误差，确保传给微信的是整数分
  const amountInCents = Math.round(order.amount * 100);
  let refundId = '';
  try {
    const client = payClient || new WechatPayClient();
    const result = await client.refund({
      outTradeNo: orderId,
      // 复用订单号作为退款单号，保证同一订单退款幂等
      outRefundNo: orderId,
      refundFee: amountInCents, // 单位：分
      totalFee: amountInCents, // 单位：分
      reason,
      notifyUrl: process.env.WXPAY_REFUND_NOTIFY_URL || undefined,
    });
    refundId = result.refundId;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[refund] 调用微信退款接口失败：', errorMsg);
    // 记录失败审计日志（不阻断错误返回）
    await safeWriteRefundLog(db, {
      openid,
      orderId,
      amount: order.amount,
      reason,
      note,
      result: 'failed',
      errorMsg,
    });
    const errCode = err instanceof WechatPayError ? `WXPAY_${err.code}` : ERR_REFUND_FAILED;
    return { success: false, errCode, errMsg: '退款发起失败，请稍后重试' };
  }

  // 6. 退款受理成功：更新订单状态为 refunding，记录退款原因与补充说明
  const now = new Date();
  const timelineNode: TimelineNode = {
    status: OrderStatus.REFUNDING,
    time: now,
    desc: '发起退款',
  };
  const _ = db.command;
  await db
    .collection(ORDERS_COLLECTION)
    .where({ orderId })
    .update({
      data: {
        status: OrderStatus.REFUNDING,
        refundReason: reason,
        refundNote: note,
        refundId,
        timeline: _.push([timelineNode]),
        updatedAt: now,
      },
    });

  // 7. 写入审计日志（操作人、操作时间、退款金额、失败原因）
  await safeWriteRefundLog(db, {
    openid,
    orderId,
    amount: order.amount,
    reason,
    note,
    result: 'success',
    refundId,
  });

  return {
    success: true,
    data: { success: true, refundId, status: OrderStatus.REFUNDING },
  };
}

/** 退款审计日志参数 */
interface RefundLogParams {
  openid: string;
  orderId: string;
  amount: number;
  reason: string;
  note: string;
  result: 'success' | 'failed';
  refundId?: string;
  errorMsg?: string;
}

/**
 * 写入退款审计日志（包含操作人、退款金额、失败原因），写库失败不阻断主流程
 */
async function safeWriteRefundLog(db: any, params: RefundLogParams): Promise<void> {
  try {
    const log = createAuditLog({
      type: AuditType.REFUND_INITIATE,
      operator: params.openid,
      orderId: params.orderId,
      action: '发起退款',
      result: params.result,
      detail: {
        refundAmount: params.amount,
        refundReason: params.reason,
        refundId: params.refundId,
      },
      note: params.note,
      errorMsg: params.errorMsg,
    });
    await writeAuditLog(db, log);
  } catch (logErr) {
    console.error('[refund] 写入退款审计日志失败：', logErr);
  }
}
