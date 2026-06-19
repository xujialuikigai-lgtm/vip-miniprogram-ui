// 订单业务云函数入口
import * as cloud from 'wx-server-sdk';
import { createOrder, CreateOrderParams } from './create';
import { refreshOrder, RefreshOrderParams } from './refresh';
import { listOrders, ListOrderParams } from './list';
import { getOrderDetail, DetailOrderParams } from './detail';
import { getOrderStats } from './stats';
import { rebuyCheck, RebuyCheckParams } from './rebuyCheck';

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// action 路由分发
export async function main(event: any, context: any) {
  const { action } = event;
  const db = cloud.database();
  // 获取当前调用用户的 openid
  const { OPENID } = cloud.getWXContext();

  switch (action) {
    case 'create':
      // 创建订单
      return createOrder(db, OPENID, event as CreateOrderParams);
    case 'list':
      // 订单列表
      return listOrders(db, OPENID, event as ListOrderParams);
    case 'detail':
      // 订单详情
      return getOrderDetail(db, OPENID, event as DetailOrderParams);
    case 'refresh':
      // 刷新订单状态
      return refreshOrder(db, OPENID, event as RefreshOrderParams);
    case 'stats':
      // 用户订单统计
      return getOrderStats(db, OPENID);
    case 'rebuyCheck':
      // 再买一次验证
      return rebuyCheck(db, event as RebuyCheckParams);
    default:
      return { success: false, errCode: 'INVALID_ACTION', errMsg: '无效的操作类型' };
  }
}
