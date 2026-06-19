// 订单详情查询逻辑（用户端）
import { Order, TimelineNode } from './shared/types/order';
import { CloudFunctionResult } from './shared/types/api';
import { maskAttach } from './shared/utils/mask';

/** 订单详情入参 */
export interface DetailOrderParams {
  /** 系统订单号 */
  orderId: string;
}

/** 订单详情返回数据 */
export interface DetailOrderData {
  /** 订单完整信息（手机号已脱敏） */
  order: Order;
  /** 状态流转时间轴（按时间正序） */
  timeline: TimelineNode[];
  /** 失败原因（开通失败时存在） */
  failReason?: string;
}

/**
 * 查询单个订单完整信息
 *
 * 业务规则（需求 7.8、20）：
 * 1. 按 orderId 查询，且必须属于当前用户（防止越权查看他人订单）
 * 2. 返回完整订单信息、时间轴（按时间正序）和失败原因
 * 3. attach 中的手机号/账号脱敏后返回（需求 15.4）
 *
 * @param db - 云数据库实例
 * @param openid - 当前用户 openid
 * @param params - 详情查询入参
 */
export async function getOrderDetail(
  db: any,
  openid: string,
  params: DetailOrderParams
): Promise<CloudFunctionResult<DetailOrderData>> {
  if (!openid) {
    return { success: false, errCode: 'UNAUTHORIZED', errMsg: '无法获取用户身份' };
  }
  if (!params.orderId) {
    return { success: false, errCode: 'INVALID_PARAMS', errMsg: '缺少订单号参数' };
  }

  // 按订单号 + openid 查询，确保只能查看自己的订单
  const res = await db
    .collection('orders')
    .where({ orderId: params.orderId, openid })
    .limit(1)
    .get();

  const order: Order | undefined = res.data && res.data[0];
  if (!order) {
    return { success: false, errCode: 'ORDER_NOT_FOUND', errMsg: '订单不存在' };
  }

  // 时间轴按时间正序排列（需求 20.3）
  const timeline: TimelineNode[] = [...(order.timeline || [])].sort(
    (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
  );

  // 脱敏后的订单信息
  const maskedOrder: Order = {
    ...order,
    attach: maskAttach(order.attach),
    timeline
  };

  return {
    success: true,
    data: {
      order: maskedOrder,
      timeline,
      failReason: order.failReason
    }
  };
}
