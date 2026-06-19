// 定时任务云函数入口（每5分钟由定时触发器执行）
import * as cloud from 'wx-server-sdk';
import { cancelExpiredOrders, CancelExpiredResult } from './cancelExpired';
import { queryPendingOrders, QueryPendingResult } from './queryPending';

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

/** 定时任务执行汇总结果 */
interface TimerResult {
  success: boolean;
  /** 待支付订单超时取消结果 */
  cancelExpired?: CancelExpiredResult;
  /** 开通超时轮询结果 */
  queryPending?: QueryPendingResult;
  /** 整体异常信息 */
  errMsg?: string;
}

/**
 * 定时触发入口
 *
 * 每5分钟执行两项任务（需求 4.8 / 23.1 / 23.2 / 23.3）：
 * 1. cancelExpiredOrders：扫描并取消超时30分钟未支付订单
 * 2. queryPendingOrders：查询超10分钟未回调的开通中订单
 *
 * 两个任务相互独立，单个失败不影响另一个。
 */
export async function main(_event: any, _context: any): Promise<TimerResult> {
  const db = cloud.database();
  const result: TimerResult = { success: true };

  // 任务一：超时未支付订单自动取消
  try {
    result.cancelExpired = await cancelExpiredOrders(db);
  } catch (err: any) {
    result.success = false;
    result.errMsg = `cancelExpiredOrders 执行失败: ${err && err.message ? err.message : err}`;
    console.error('[Timer]', result.errMsg);
  }

  // 任务二：开通中订单超时轮询
  try {
    result.queryPending = await queryPendingOrders(db);
  } catch (err: any) {
    result.success = false;
    const msg = `queryPendingOrders 执行失败: ${err && err.message ? err.message : err}`;
    result.errMsg = result.errMsg ? `${result.errMsg}; ${msg}` : msg;
    console.error('[Timer]', msg);
  }

  return result;
}
