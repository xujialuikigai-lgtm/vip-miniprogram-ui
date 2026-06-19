// 用户订单统计逻辑（个人中心）
import { OrderStatus } from './shared/types/order';
import { CloudFunctionResult } from './shared/types/api';

/** 订单统计返回数据 */
export interface OrderStatsData {
  /** 全部订单数（不含已取消） */
  total: number;
  /** 处理中（开通中）订单数 */
  activating: number;
  /** 待退款订单数 */
  refunding: number;
}

/**
 * 统计当前用户的订单数量
 *
 * 业务规则（需求 19.3、23.4）：
 * - total：全部订单数，排除已取消订单
 * - activating：处理中订单数（已支付 + 开通中）
 * - refunding：待退款订单数（退款中）
 *
 * @param db - 云数据库实例
 * @param openid - 当前用户 openid
 */
export async function getOrderStats(
  db: any,
  openid: string
): Promise<CloudFunctionResult<OrderStatsData>> {
  if (!openid) {
    return { success: false, errCode: 'UNAUTHORIZED', errMsg: '无法获取用户身份' };
  }

  const _ = db.command;
  const ordersCol = db.collection('orders');

  // 并发统计三类数量，减少等待时间
  const [totalRes, activatingRes, refundingRes] = await Promise.all([
    // 全部订单：排除已取消
    ordersCol.where({ openid, status: _.neq(OrderStatus.CANCELLED) }).count(),
    // 处理中：已支付 + 开通中
    ordersCol
      .where({ openid, status: _.in([OrderStatus.PAID, OrderStatus.ACTIVATING]) })
      .count(),
    // 待退款：退款中
    ordersCol.where({ openid, status: OrderStatus.REFUNDING }).count()
  ]);

  return {
    success: true,
    data: {
      total: totalRes.total || 0,
      activating: activatingRes.total || 0,
      refunding: refundingRes.total || 0
    }
  };
}
