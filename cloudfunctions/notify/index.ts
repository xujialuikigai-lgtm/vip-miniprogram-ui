// 通知云函数入口
import * as cloud from 'wx-server-sdk';
import { send } from './send';
import { SendParams } from './types';

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// action 路由分发
export async function main(event: any, _context: any) {
  const { action } = event || {};

  switch (action) {
    case 'send':
      // 发送订阅消息（开通成功/开通失败/退款到账）
      return send(cloud, event as SendParams);
    default:
      return { success: false, errCode: 'INVALID_ACTION', errMsg: '无效的操作类型' };
  }
}
