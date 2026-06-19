// 订单刷新进度逻辑
import { Order, OrderStatus, TimelineNode } from './shared/types/order';
import { CloudFunctionResult, ShunshiOrderInfoItem } from './shared/types/api';
import { AuditType } from './shared/types/audit';
import { createAuditLog, writeAuditLog } from './shared/utils/logger';
import { getShunshiClient } from './shared/utils/shunshi';
import { maskAccount } from './shared/utils/mask';
import { ShunshiOrderStatus } from './shared/constants';

/** 刷新进度入参 */
export interface RefreshOrderParams {
  /** 系统订单号 */
  orderId: string;
}

/** 刷新进度返回数据 */
export interface RefreshOrderData {
  /** 最新订单信息（账号字段已脱敏） */
  order: Order;
  /** 订单时间轴 */
  timeline: TimelineNode[];
}

/**
 * 刷新接口最大等待时长（毫秒）
 * 需求要求刷新按钮在 5 秒内响应；底层顺势客户端超时为 15 秒，
 * 这里用更短的等待时间包裹查询，超过即按"查询失败"友好返回。
 */
const REFRESH_TIMEOUT_MS = 5000;

/** 顺势状态映射结果 */
interface MappedStatus {
  /** 映射后的本地订单状态 */
  status: OrderStatus;
  /** 时间轴节点描述文案 */
  desc: string;
  /** 是否为终态（开通成功 / 开通失败） */
  terminal: boolean;
}

/**
 * 将顺势订单状态码映射为本地订单状态
 * 对应状态机：status=3 → 开通成功；status=4/5 → 开通失败；其余保持开通中
 * @param shunshiStatus - 顺势返回的状态码
 */
function mapShunshiStatus(shunshiStatus: number): MappedStatus {
  switch (shunshiStatus) {
    case ShunshiOrderStatus.SUCCESS: // 3
      return { status: OrderStatus.SUCCESS, desc: '开通成功', terminal: true };
    case ShunshiOrderStatus.CANCELLED: // 4
      return { status: OrderStatus.API_FAILED, desc: '开通失败（订单已取消）', terminal: true };
    case ShunshiOrderStatus.REFUNDED: // 5
      return { status: OrderStatus.API_FAILED, desc: '开通失败（已退款）', terminal: true };
    default: // 1 待处理 / 2 处理中
      return { status: OrderStatus.ACTIVATING, desc: '开通处理中', terminal: false };
  }
}

/**
 * 对订单中的开通账号进行脱敏，避免返回完整敏感信息
 * 仅处理 attach 中的字符串字段，对象/数组等保持原样
 * @param order - 原始订单
 */
function maskOrderAccount(order: Order): Order {
  const maskedAttach: Record<string, any> = {};
  const attach = order.attach || {};
  for (const key of Object.keys(attach)) {
    const value = attach[key];
    maskedAttach[key] = typeof value === 'string' ? maskAccount(value) : value;
  }
  return { ...order, attach: maskedAttach };
}

/**
 * 包裹一个 Promise，超过指定时长则以超时错误 reject
 * 用于保证刷新接口在 5 秒内给出响应
 * @param promise - 原始 Promise
 * @param ms - 超时时长（毫秒）
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`刷新查询超时(${ms}ms)`));
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * 刷新订单进度
 *
 * 业务流程：
 * 1. 校验入参与用户身份
 * 2. 按 orderId + openid 查询订单（校验归属）
 * 3. 终态订单（成功/退款/取消）或无顺势单号时，直接返回当前状态，不再调用接口
 * 4. 调用顺势 /api/v1/order/info 查询最新状态（5秒内响应，失败友好提示）
 * 5. 状态有变化时更新本地订单状态、shunshiStatus、rechargeHints 并追加 timeline 节点
 * 6. 写入审计日志，返回脱敏后的订单与时间轴
 *
 * @param db - 云数据库实例
 * @param openid - 当前用户 openid
 * @param params - 刷新入参
 */
export async function refreshOrder(
  db: any,
  openid: string,
  params: RefreshOrderParams
): Promise<CloudFunctionResult<RefreshOrderData>> {
  const { orderId } = params;

  // 1. 入参与身份校验
  if (!openid) {
    return { success: false, errCode: 'UNAUTHORIZED', errMsg: '无法获取用户身份' };
  }
  if (!orderId) {
    return { success: false, errCode: 'INVALID_PARAMS', errMsg: '缺少订单号参数' };
  }

  // 2. 查询订单（限定本人订单）
  const orderRes = await db
    .collection('orders')
    .where({ orderId, openid })
    .limit(1)
    .get();
  const order: Order | undefined = orderRes.data && orderRes.data[0];

  if (!order) {
    return { success: false, errCode: 'ORDER_NOT_FOUND', errMsg: '订单不存在' };
  }

  // 3. 终态订单无需再查询接口，直接返回当前状态
  const terminalStatuses: OrderStatus[] = [
    OrderStatus.SUCCESS,
    OrderStatus.REFUNDING,
    OrderStatus.REFUNDED,
    OrderStatus.CANCELLED
  ];
  if (terminalStatuses.indexOf(order.status) !== -1) {
    return {
      success: true,
      data: { order: maskOrderAccount(order), timeline: order.timeline || [] }
    };
  }

  // 无顺势订单号（尚未成功下单），无法查询接口，返回当前状态
  if (!order.shunshiOrderSn) {
    return {
      success: true,
      data: { order: maskOrderAccount(order), timeline: order.timeline || [] }
    };
  }

  // 4. 调用顺势查询最新状态（5秒超时，失败友好返回）
  let info: ShunshiOrderInfoItem;
  try {
    const client = getShunshiClient();
    info = await withTimeout(
      client.queryOrder({ ordersn: order.shunshiOrderSn }),
      REFRESH_TIMEOUT_MS
    );
  } catch (err: any) {
    // 记录失败审计日志（不阻断返回）
    const failLog = createAuditLog({
      type: AuditType.STATUS_UPDATE,
      operator: openid,
      orderId,
      action: '刷新订单进度（查询失败）',
      result: 'failed',
      errorMsg: err && err.message ? err.message : '顺势接口查询失败'
    });
    await writeAuditLog(db, failLog);

    return {
      success: false,
      errCode: 'SHUNSHI_QUERY_FAILED',
      errMsg: '查询失败，请稍后重试'
    };
  }

  // 5. 映射最新状态并判断是否变化
  const mapped = mapShunshiStatus(info.status);
  const now = new Date();

  // 状态未变化：仅同步 shunshiStatus / rechargeHints，不追加时间轴
  const statusChanged = mapped.status !== order.status;

  const updateData: Record<string, any> = {
    shunshiStatus: info.status,
    updatedAt: now
  };
  if (info.recharge_hints) {
    updateData.rechargeHints = info.recharge_hints;
  }

  let newTimeline: TimelineNode[] = order.timeline || [];

  if (statusChanged) {
    const node: TimelineNode = {
      status: mapped.status,
      time: now,
      desc: mapped.desc
    };
    newTimeline = newTimeline.concat([node]);

    updateData.status = mapped.status;
    updateData.timeline = newTimeline;

    // 开通成功记录到账时间
    if (mapped.status === OrderStatus.SUCCESS) {
      updateData.activatedAt = now;
    }
    // 开通失败记录失败原因（优先使用顺势 recharge_hints）
    if (mapped.status === OrderStatus.API_FAILED) {
      updateData.failReason = info.recharge_hints || mapped.desc;
    }
  }

  // 写入数据库更新
  try {
    await db
      .collection('orders')
      .where({ orderId, openid })
      .update({ data: updateData });
  } catch (err: any) {
    return {
      success: false,
      errCode: 'ORDER_UPDATE_FAILED',
      errMsg: '查询失败，请稍后重试'
    };
  }

  // 6. 写入审计日志
  const auditLog = createAuditLog({
    type: AuditType.STATUS_UPDATE,
    operator: openid,
    orderId,
    action: statusChanged ? '刷新订单进度（状态更新）' : '刷新订单进度（状态未变）',
    detail: { shunshiStatus: info.status, status: mapped.status },
    result: 'success'
  });
  await writeAuditLog(db, auditLog);

  // 组装最新订单返回（脱敏账号）
  const latestOrder: Order = {
    ...order,
    ...updateData,
    timeline: newTimeline
  } as Order;

  return {
    success: true,
    data: { order: maskOrderAccount(latestOrder), timeline: newTimeline }
  };
}
