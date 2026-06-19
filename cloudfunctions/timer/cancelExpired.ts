// 待支付订单超时自动取消逻辑
import { Order, OrderStatus, TimelineNode } from './shared/types/order';
import { AuditType } from './shared/types/audit';
import { createAuditLog, writeAuditLog } from './shared/utils/logger';
import { isOrderExpired } from './shared/utils/filter';
import { ORDER_TIMEOUT_MINUTES } from './shared/constants';

/** 单次任务最多处理的订单数，避免单次执行超时 */
const BATCH_LIMIT = 100;

/** 系统操作人标识 */
const SYSTEM_OPERATOR = 'system';

/** 取消备注（需求 23.3 固定文案） */
const CANCEL_NOTE = '超时未支付自动取消';

/** 超时取消任务执行结果 */
export interface CancelExpiredResult {
  /** 本次扫描到的待支付订单数 */
  scanned: number;
  /** 实际取消的订单数 */
  cancelled: number;
  /** 取消失败的订单数 */
  failed: number;
}

/**
 * 扫描并取消超时未支付订单
 *
 * 业务流程（需求 23.1 / 23.2 / 23.3）：
 * 1. 查询 status=pending_pay 的订单（限制单批数量）
 * 2. 用 isOrderExpired 判断是否超过 30 分钟
 * 3. 超时订单更新为 cancelled，追加时间轴节点并记录 cancelledAt
 * 4. 写入审计日志，操作人标记为"系统"，备注"超时未支付自动取消"
 *
 * @param db - 云数据库实例
 */
export async function cancelExpiredOrders(db: any): Promise<CancelExpiredResult> {
  const result: CancelExpiredResult = { scanned: 0, cancelled: 0, failed: 0 };

  // 1. 查询待支付订单
  const orderRes = await db
    .collection('orders')
    .where({ status: OrderStatus.PENDING_PAY })
    .limit(BATCH_LIMIT)
    .get();

  const orders: Order[] = (orderRes && orderRes.data) || [];
  result.scanned = orders.length;

  // 2. 过滤出已超时的订单
  const expiredOrders = orders.filter((order) =>
    isOrderExpired(order, ORDER_TIMEOUT_MINUTES)
  );

  // 3. 逐个取消
  for (const order of expiredOrders) {
    const now = new Date();
    const node: TimelineNode = {
      status: OrderStatus.CANCELLED,
      time: now,
      desc: CANCEL_NOTE
    };
    const newTimeline: TimelineNode[] = (order.timeline || []).concat([node]);

    try {
      await db
        .collection('orders')
        .where({ orderId: order.orderId, status: OrderStatus.PENDING_PAY })
        .update({
          data: {
            status: OrderStatus.CANCELLED,
            timeline: newTimeline,
            cancelledAt: now,
            updatedAt: now
          }
        });

      result.cancelled += 1;

      // 4. 写入审计日志（操作人为系统）
      const log = createAuditLog({
        type: AuditType.ORDER_CANCEL,
        operator: SYSTEM_OPERATOR,
        operatorName: '系统',
        orderId: order.orderId,
        action: '超时自动取消订单',
        result: 'success',
        note: CANCEL_NOTE
      });
      await writeAuditLog(db, log);
    } catch (err: any) {
      result.failed += 1;
      // 记录失败审计日志，不中断整体任务
      const failLog = createAuditLog({
        type: AuditType.ORDER_CANCEL,
        operator: SYSTEM_OPERATOR,
        operatorName: '系统',
        orderId: order.orderId,
        action: '超时自动取消订单（失败）',
        result: 'failed',
        errorMsg: err && err.message ? err.message : '订单取消更新失败',
        note: CANCEL_NOTE
      });
      await writeAuditLog(db, failLog);
    }
  }

  return result;
}
