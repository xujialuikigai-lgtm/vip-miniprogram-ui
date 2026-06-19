/**
 * 集成测试：超时取消流程测试
 * 验证 pending_pay 超 30 分钟 → cancelled
 *
 * Mock 策略：模拟云数据库，通过操纵 createdAt 时间来模拟超时
 */

import { cancelExpiredOrders } from '../../cloudfunctions/timer/cancelExpired';
import { OrderStatus } from '../../cloudfunctions/shared/types/order';
import { ORDER_TIMEOUT_MINUTES } from '../../cloudfunctions/shared/constants';

// Mock logger
jest.mock('../../cloudfunctions/shared/utils/logger', () => ({
  createAuditLog: jest.fn(() => ({ logId: 'mock_log', createdAt: new Date().toISOString() })),
  writeAuditLog: jest.fn(async () => {}),
}));

/** 创建待支付订单（可设置 createdAt 相对于当前时间的偏移分钟数） */
function createPendingOrder(minutesAgo: number, orderId: string = 'VIP_TEST_001') {
  const now = Date.now();
  return {
    _id: `doc_${orderId}`,
    orderId,
    openid: 'user_001',
    productId: 'prod_001',
    productName: '测试商品',
    packageId: 'pkg_001',
    packageName: '月卡',
    categoryName: '视频',
    attach: { recharge_account: '13800001111' },
    amount: 1990,
    costPrice: 1500,
    status: OrderStatus.PENDING_PAY,
    retryCount: 0,
    timeline: [{ status: OrderStatus.PENDING_PAY, time: new Date(now - minutesAgo * 60000), desc: '创建订单' }],
    createdAt: new Date(now - minutesAgo * 60000),
    updatedAt: new Date(now - minutesAgo * 60000),
  };
}

/** 构造模拟数据库 */
function createMockDb(orders: any[]) {
  const updateCalls: Array<{ where: any; data: any }> = [];

  return {
    db: {
      collection: jest.fn((name: string) => {
        if (name === 'orders') {
          return {
            where: jest.fn((condition: any) => ({
              limit: jest.fn(() => ({
                get: jest.fn(async () => ({ data: orders })),
              })),
              update: jest.fn(async (params: any) => {
                updateCalls.push({ where: condition, data: params.data });
                return { stats: { updated: 1 } };
              }),
            })),
          };
        }
        // audit_logs
        return {
          add: jest.fn(async () => ({ _id: 'log_id' })),
        };
      }),
    },
    updateCalls,
  };
}

describe('超时取消流程集成测试', () => {
  it('超过30分钟的 pending_pay 订单被自动取消', async () => {
    // 创建两个超时订单（31分钟和45分钟前创建）
    const expiredOrder1 = createPendingOrder(31, 'VIP_EXPIRED_001');
    const expiredOrder2 = createPendingOrder(45, 'VIP_EXPIRED_002');
    const { db, updateCalls } = createMockDb([expiredOrder1, expiredOrder2]);

    const result = await cancelExpiredOrders(db);

    // 扫描到2个订单
    expect(result.scanned).toBe(2);
    // 两个都超时，都被取消
    expect(result.cancelled).toBe(2);
    expect(result.failed).toBe(0);

    // 验证更新调用：状态变为 cancelled
    expect(updateCalls.length).toBe(2);
    for (const call of updateCalls) {
      expect(call.data.status).toBe(OrderStatus.CANCELLED);
      expect(call.data.cancelledAt).toBeInstanceOf(Date);
      // timeline 中追加了取消节点
      const lastNode = call.data.timeline[call.data.timeline.length - 1];
      expect(lastNode.status).toBe(OrderStatus.CANCELLED);
      expect(lastNode.desc).toContain('超时');
    }
  });

  it('未超时的 pending_pay 订单不会被取消', async () => {
    // 创建未超时订单（10分钟前、29分钟前）
    const recentOrder1 = createPendingOrder(10, 'VIP_RECENT_001');
    const recentOrder2 = createPendingOrder(29, 'VIP_RECENT_002');
    const { db, updateCalls } = createMockDb([recentOrder1, recentOrder2]);

    const result = await cancelExpiredOrders(db);

    expect(result.scanned).toBe(2);
    expect(result.cancelled).toBe(0);
    expect(result.failed).toBe(0);
    expect(updateCalls.length).toBe(0);
  });

  it('混合场景：部分超时部分未超时', async () => {
    const expiredOrder = createPendingOrder(35, 'VIP_EXPIRED_MIX');
    const recentOrder = createPendingOrder(20, 'VIP_RECENT_MIX');
    const { db, updateCalls } = createMockDb([expiredOrder, recentOrder]);

    const result = await cancelExpiredOrders(db);

    expect(result.scanned).toBe(2);
    expect(result.cancelled).toBe(1);
    expect(result.failed).toBe(0);
    expect(updateCalls.length).toBe(1);
    // 只取消了超时的那个
    expect(updateCalls[0].where.orderId).toBe('VIP_EXPIRED_MIX');
  });

  it('无待支付订单时正常返回空结果', async () => {
    const { db, updateCalls } = createMockDb([]);

    const result = await cancelExpiredOrders(db);

    expect(result.scanned).toBe(0);
    expect(result.cancelled).toBe(0);
    expect(result.failed).toBe(0);
    expect(updateCalls.length).toBe(0);
  });

  it('数据库更新失败时记录 failed 但不中断', async () => {
    const expiredOrder1 = createPendingOrder(40, 'VIP_FAIL_001');
    const expiredOrder2 = createPendingOrder(50, 'VIP_FAIL_002');

    // 第一个更新失败，第二个成功
    let callCount = 0;
    const updateCalls: any[] = [];
    const db = {
      collection: jest.fn((name: string) => {
        if (name === 'orders') {
          return {
            where: jest.fn((condition: any) => ({
              limit: jest.fn(() => ({
                get: jest.fn(async () => ({ data: [expiredOrder1, expiredOrder2] })),
              })),
              update: jest.fn(async (params: any) => {
                callCount++;
                if (callCount === 1) {
                  throw new Error('数据库更新超时');
                }
                updateCalls.push(params.data);
                return { stats: { updated: 1 } };
              }),
            })),
          };
        }
        return { add: jest.fn(async () => ({ _id: 'log_id' })) };
      }),
    };

    const result = await cancelExpiredOrders(db);

    expect(result.scanned).toBe(2);
    expect(result.cancelled).toBe(1);
    expect(result.failed).toBe(1);
  });

  it('超时阈值为30分钟（使用 ORDER_TIMEOUT_MINUTES 常量）', () => {
    // 确认常量值
    expect(ORDER_TIMEOUT_MINUTES).toBe(30);
  });
});
