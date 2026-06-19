/**
 * 集成测试：开通超时轮询流程测试
 * 验证 activating 超 10 分钟 → 查询顺势接口 → 状态映射
 *
 * Mock 策略：模拟 db 和 ShunshiClient
 */

import { queryPendingOrders } from '../../cloudfunctions/timer/queryPending';
import { OrderStatus } from '../../cloudfunctions/shared/types/order';
import { ACTIVATION_TIMEOUT_MINUTES, ShunshiOrderStatus } from '../../cloudfunctions/shared/constants';

// Mock logger
jest.mock('../../cloudfunctions/shared/utils/logger', () => ({
  createAuditLog: jest.fn(() => ({ logId: 'mock_log', createdAt: new Date().toISOString() })),
  writeAuditLog: jest.fn(async () => {}),
}));

// Mock ShunshiClient
const mockQueryOrder = jest.fn();
jest.mock('../../cloudfunctions/shared/utils/shunshi', () => ({
  getShunshiClient: jest.fn(() => ({
    queryOrder: mockQueryOrder,
  })),
  ShunshiClient: jest.fn(),
}));

/** 创建开通中订单 */
function createActivatingOrder(minutesAgo: number, orderId: string, shunshiOrderSn: string = 'SS_001') {
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
    status: OrderStatus.ACTIVATING,
    shunshiOrderSn,
    shunshiGoodsId: 12345,
    retryCount: 0,
    timeline: [
      { status: OrderStatus.PENDING_PAY, time: new Date(now - (minutesAgo + 5) * 60000), desc: '创建订单' },
      { status: OrderStatus.ACTIVATING, time: new Date(now - minutesAgo * 60000), desc: '提交开通' },
    ],
    createdAt: new Date(now - (minutesAgo + 5) * 60000),
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
        return { add: jest.fn(async () => ({ _id: 'log_id' })) };
      }),
    },
    updateCalls,
  };
}

describe('开通超时轮询流程集成测试', () => {
  beforeEach(() => {
    mockQueryOrder.mockReset();
  });

  it('超过10分钟的 activating 订单查询顺势后状态映射为 success', async () => {
    const order = createActivatingOrder(15, 'VIP_ACT_001', 'SS_SUCCESS');
    const { db, updateCalls } = createMockDb([order]);

    // 顺势返回成功
    mockQueryOrder.mockResolvedValue({
      ordersn: 'SS_SUCCESS',
      status: ShunshiOrderStatus.SUCCESS, // 3
      recharge_hints: '充值成功，已到账',
    });

    const result = await queryPendingOrders(db);

    expect(result.scanned).toBe(1);
    expect(result.queried).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.failed).toBe(0);

    // 验证数据库更新
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0].data.status).toBe(OrderStatus.SUCCESS);
    expect(updateCalls[0].data.activatedAt).toBeInstanceOf(Date);
    expect(updateCalls[0].data.rechargeHints).toBe('充值成功，已到账');
    // timeline 追加了成功节点
    const newTimeline = updateCalls[0].data.timeline;
    const lastNode = newTimeline[newTimeline.length - 1];
    expect(lastNode.status).toBe(OrderStatus.SUCCESS);
    expect(lastNode.desc).toContain('成功');
  });

  it('顺势返回 status=4（取消）→ 映射为 api_failed', async () => {
    const order = createActivatingOrder(12, 'VIP_ACT_002', 'SS_CANCEL');
    const { db, updateCalls } = createMockDb([order]);

    mockQueryOrder.mockResolvedValue({
      ordersn: 'SS_CANCEL',
      status: ShunshiOrderStatus.CANCELLED, // 4
      recharge_hints: '订单已被取消',
    });

    const result = await queryPendingOrders(db);

    expect(result.updated).toBe(1);
    expect(updateCalls[0].data.status).toBe(OrderStatus.API_FAILED);
    expect(updateCalls[0].data.failReason).toBe('订单已被取消');
  });

  it('顺势返回 status=5（退款）→ 映射为 api_failed', async () => {
    const order = createActivatingOrder(20, 'VIP_ACT_003', 'SS_REFUND');
    const { db, updateCalls } = createMockDb([order]);

    mockQueryOrder.mockResolvedValue({
      ordersn: 'SS_REFUND',
      status: ShunshiOrderStatus.REFUNDED, // 5
    });

    const result = await queryPendingOrders(db);

    expect(result.updated).toBe(1);
    expect(updateCalls[0].data.status).toBe(OrderStatus.API_FAILED);
  });

  it('顺势返回 status=2（处理中）→ 不变更状态', async () => {
    const order = createActivatingOrder(11, 'VIP_ACT_004', 'SS_PROCESSING');
    const { db, updateCalls } = createMockDb([order]);

    mockQueryOrder.mockResolvedValue({
      ordersn: 'SS_PROCESSING',
      status: ShunshiOrderStatus.PROCESSING, // 2
    });

    const result = await queryPendingOrders(db);

    expect(result.scanned).toBe(1);
    expect(result.queried).toBe(1);
    expect(result.updated).toBe(0); // 状态未变更
    // 仍然会更新 shunshiStatus 和 updatedAt
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0].data.shunshiStatus).toBe(ShunshiOrderStatus.PROCESSING);
    expect(updateCalls[0].data.status).toBeUndefined(); // 未设置新状态
  });

  it('未超时的 activating 订单不会被轮询', async () => {
    // 只有 8 分钟前更新的订单
    const order = createActivatingOrder(8, 'VIP_ACT_005', 'SS_RECENT');
    const { db, updateCalls } = createMockDb([order]);

    const result = await queryPendingOrders(db);

    expect(result.scanned).toBe(1);
    expect(result.queried).toBe(0); // 未超时，不查询
    expect(result.updated).toBe(0);
    expect(mockQueryOrder).not.toHaveBeenCalled();
  });

  it('无顺势订单号的订单跳过查询', async () => {
    const order = createActivatingOrder(15, 'VIP_ACT_006', '');
    // 设置空的 shunshiOrderSn
    order.shunshiOrderSn = '';
    const { db } = createMockDb([order]);

    const result = await queryPendingOrders(db);

    expect(result.scanned).toBe(1);
    expect(result.queried).toBe(0);
    expect(mockQueryOrder).not.toHaveBeenCalled();
  });

  it('顺势接口查询失败时记录失败但不中断', async () => {
    const order1 = createActivatingOrder(15, 'VIP_ACT_FAIL1', 'SS_FAIL');
    const order2 = createActivatingOrder(20, 'VIP_ACT_FAIL2', 'SS_OK');
    const { db, updateCalls } = createMockDb([order1, order2]);

    // 第一个查询失败，第二个成功
    mockQueryOrder
      .mockRejectedValueOnce(new Error('网络超时'))
      .mockResolvedValueOnce({
        ordersn: 'SS_OK',
        status: ShunshiOrderStatus.SUCCESS,
      });

    const result = await queryPendingOrders(db);

    expect(result.scanned).toBe(2);
    expect(result.queried).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.updated).toBe(1);
  });

  it('超时阈值为10分钟（使用 ACTIVATION_TIMEOUT_MINUTES 常量）', () => {
    expect(ACTIVATION_TIMEOUT_MINUTES).toBe(10);
  });
});
