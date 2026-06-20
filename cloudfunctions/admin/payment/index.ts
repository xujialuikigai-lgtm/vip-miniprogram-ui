// 支付业务云函数入口
import * as cloud from 'wx-server-sdk';
import { CloudFunctionResult } from '../shared/types/api';
import { unifiedOrder, UnifiedOrderParams } from './unifiedOrder';
import { refund, RefundParams } from './refund';

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV as any });

// action 路由分发
export async function main(event: any, context: any): Promise<CloudFunctionResult> {
  const { action } = event;
  const db: any = cloud.database();
  const { OPENID } = cloud.getWXContext();

  switch (action) {
    case 'unifiedOrder':
      // 统一下单（任务 7.1）
      return unifiedOrder(db, OPENID || '', event as UnifiedOrderParams);
    case 'refund':
      // 退款发起（任务 7.2）
      return refund(db, OPENID || '', event as RefundParams);
    default:
      return { success: false, errCode: 'INVALID_ACTION', errMsg: '无效的操作类型' };
  }
}
