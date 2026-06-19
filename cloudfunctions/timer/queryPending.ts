// 开通中订单超时轮询逻辑
import { Order, OrderStatus, TimelineNode } from './shared/types/order';
import { ShunshiOrderInfoItem } from './shared/types/api';
import { AuditType } from './shared/types/audit';
import { createAuditLog, writeAuditLog } from './shared/utils/logger';
import { getShunshiClient } from './shared/utils/shunshi';
import { ACTIVATION_TIMEOUT_MINUTES, ShunshiOrderStatus } from './shared/constants';

/** 单次任务最多处理的订单数，避免单次执行超时 */
const BATCH_LIMIT = 100;

/** 系统操作人标识 */
const SYSTEM_OPERATOR = 'system';

/** 开通超时轮询任务执行结果 */
export interface QueryPendingResult {
  /** 本次扫描到的开通中订单数 */
  scanned: number;
  /** 实际发起查询的订单数 */
  queried: number;
  /** 状态发生变更的订单数 */
  updated: number;
  /** 查询失败的订单数 */
  failed: number;
}

/** 顺势状态映射结果 */
interface MappedStatus {
  /** 映射后的本地订单状态 */
  status: OrderStatus;
  /** 时间轴节点描述文案 */
  desc: string;
}

/**
 * 将顺势订单状态码映射为本地订单状态
 * status=3 → 开通成功；status=4/5 → 开通失败；其余保持开通中
 * @param shunshiStatus - 顺势返回的状态码
 */
function mapShunshiStatus(shunshiStatus: number): MappedStatus {
  switch (shunshiStatus) {
    case ShunshiOrderStatus.SUCCESS: // 3
      return { status: OrderStatus.SUCCESS, desc: '开通成功' };
    case ShunshiOrderStatus.CANCELLED: // 4
      return { status: OrderStatus.API_FAILED, desc: '开通失败（订单已取消）' };
    case ShunshiOrderStatus.REFUNDED: // 5
      return { status: OrderStatus.API_FAILED, desc: '开通失败（已退款）' };
    default: // 1 待处理 / 2 处理中
      return { status: OrderStatus.ACTIVATING, desc: '开通处理中' };
  }
}

/**
 * 判断开通中订单是否已超过轮询阈值（默认10分钟未更新）
 * @param order - 订单记录
 * @param minutes - 超时分钟数
 */
function isActivationTimeout(order: Order, minutes: number): boolean {
  // 优先以 updatedAt 作为"最近一次状态变化"的依据，缺失时回退到 createdAt
  const baseTime = order.updatedAt || order.createdAt;
  const baseMs = new Date(baseTime).getTime();
  return Date.now() - baseMs > minutes * 60 * 1000;
}

/**
 * 扫描并轮询超时未回调的开通中订单
 *
 * 业务流程（需求 4.8）：
 * 1. 查询 status=activating 的订单（限制单批数量）
 * 2. 过滤出超过 10 分钟未更新的订单
 * 3. 对存在顺势订单号的订单调用 /api/v1/order/info 查询最新状态
 * 4. 状态有变化时更新本地状态并追加时间轴节点
 * 5. 写入审计日志，操作人标记为"系统"
 *
 * @param db - 云数据库实例
 */
export async function queryPendingOrders(db: any): Promise<QueryPendingResult> {
  const result: QueryPendingResult = { scanned: 0, queried: 0, updated: 0, failed: 0 };

  // 1. 查询开通中订单
  const orderRes = await db
    .collection('orders')
    .where({ status: OrderStatus.ACTIVATING })
    .limit(BATCH_LIMIT)
    .get();

  const orders: Order[] = (orderRes && orderRes.data) || [];
  result.scanned = orders.length;

  // 2. 过滤出超时未更新且有顺势订单号的订单
  const timeoutOrders = orders.filter(
    (order) =>
      !!order.shunshiOrderSn &&
      isActivationTimeout(order, ACTIVATION_TIMEOUT_MINUTES)
  );

  const client = getShunshiClient();

  // 3. 逐个查询顺势最新状态
  for (const order of timeoutOrders) {
    result.queried += 1;

    let info: ShunshiOrderInfoItem;
    try {
      info = await client.queryOrder({ ordersn: order.shunshiOrderSn });
    } catch (err: any) {
      result.failed += 1;
      // 查询失败记录审计日志，不中断整体任务
      const failLog = createAuditLog({
        type: AuditType.STATUS_UPDATE,
        operator: SYSTEM_OPERATOR,
        operatorName: '系统',
        orderId: order.orderId,
        action: '开通超时轮询（查询失败）',
        result: 'failed',
        errorMsg: err && err.message ? err.message : '顺势接口查询失败'
      });
      await writeAuditLog(db, failLog);
      continue;
    }

    // 4. 映射并判断状态是否变化
    const mapped = mapShunshiStatus(info.status);
    const now = new Date();

    const updateData: Record<string, any> = {
      shunshiStatus: info.status,
      updatedAt: now
    };
    if (info.recharge_hints) {
      updateData.rechargeHints = info.recharge_hints;
    }

    const statusChanged = mapped.status !== order.status;

    if (statusChanged) {
      const node: TimelineNode = {
        status: mapped.status,
        time: now,
        desc: mapped.desc
      };
      updateData.status = mapped.status;
      updateData.timeline = (order.timeline || []).concat([node]);

      // 开通成功记录到账时间
      if (mapped.status === OrderStatus.SUCCESS) {
        updateData.activatedAt = now;
      }
      // 开通失败记录失败原因（优先使用顺势 recharge_hints）
      if (mapped.status === OrderStatus.API_FAILED) {
        updateData.failReason = info.recharge_hints || mapped.desc;
      }
    }

    // 5. 写入数据库并记录审计日志
    try {
      await db
        .collection('orders')
        .where({ orderId: order.orderId, status: OrderStatus.ACTIVATING })
        .update({ data: updateData });

      if (statusChanged) {
        result.updated += 1;
      }

      const log = createAuditLog({
        type: AuditType.STATUS_UPDATE,
        operator: SYSTEM_OPERATOR,
        operatorName: '系统',
        orderId: order.orderId,
        action: statusChanged ? '开通超时轮询（状态更新）' : '开通超时轮询（状态未变）',
        detail: { shunshiStatus: info.status, status: mapped.status },
        result: 'success'
      });
      await writeAuditLog(db, log);
    } catch (err: any) {
      result.failed += 1;
      const failLog = createAuditLog({
        type: AuditType.STATUS_UPDATE,
        operator: SYSTEM_OPERATOR,
        operatorName: '系统',
        orderId: order.orderId,
        action: '开通超时轮询（更新失败）',
        result: 'failed',
        errorMsg: err && err.message ? err.message : '订单状态更新失败'
      });
      await writeAuditLog(db, failLog);
    }
  }

  return result;
}
