/**
 * 集成测试：重试开通流程测试（含3次上限）
 * 验证管理员重试开通逻辑、次数限制、状态流转
 *
 * Mock 策略：模拟 db、ShunshiClient、adminAuth
 */

import { handleRetryActivation } from '../../cloudfunctions/admin/orderManage';
import { OrderStatus } from '../../cloudfunctions/shared/types/order';
import { MAX_RETRY_COUNT } from '../../cloudfunctions/shared/constants';

// Mock adminAuth（管理端入口已校验，这里 handleRetryActivation 内部不再校验）
jest.mock('../../cloudfunctions/shared/utils/adminAuth', () => ({
  requireAdmin: jest.fn(async () => ({ allowed: true })),
  checkAdmin: jest.fn(async () => true),
}));

// Mock logger
jest.mock('../../cloudfunctions/shared/utils/logger', () => ({
  createAuditLog: jest.fn(() => ({ logId: 'mock_log', createdAt: new Date().toISOString() })),
  writeAuditLog: jest.fn(async () => {}),
}));

// Mock ShunshiClient
const mockSubmitOrder = jest.fn();
jest.mock('../../cloudfunctions/shared/utils/shunshi', () => ({
  getShunshiClient: jest.fn(() => ({
    submitOrder: mockSubmitOrder,
  })),
  ShunshiClient: jest.fn(),
}));

/** 创建测试订单 */
function createTestOrder(status: OrderStatus, retryCount: number = 0) {
  return {
    _id: 'doc_retry_001',
    orderId: 'VIP17041234567890099',
    openid: 'user_001',
    productId: 'prod_001',
    productName: '腾讯视频VIP',
    packageId: 'pkg_001',
    packageName: '月卡',
    categoryName: '视频会员',
    attach: { recharge_account: '13800009999' },
    amount: 2990,
    costPrice: 2200,
    status,
    shunshiGoodsId: 54321,
    shunshiOrderSn: 'SS_OLD_001',
    retryCount,
    timeline: [
      { status: OrderStatus.PENDING_PAY, time: new Date(), desc: '创建订单' },
      { status: OrderStatus.ACTIVATING, time: new Date(), desc: '提交开通' },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/** 构造模拟数据库 */
function createMockDb(order: any) {
  const updateCalls: any[] = [];

  return {
    db: {
      collection: jest.fn((name: string) => {
        if (name === 'orders') {
          return {
            where: jest.fn(() => ({
              limit: jest.fn(() => ({
                get: jest.fn(async () => ({
                  data: order ? [order] : [],
                })),
              })),
            })),
            doc: jest.fn(() => ({
              update: jest.fn(async (params: any) => {
                updateCalls.push(params.data);
                return { stats: { updated: 1 } };
              }),
            })),
          };
        }
        // audit_logs
        return {
          add: jest.fn(async () => ({ _id: 'log_id' })),
          where: jest.fn(() => ({
            limit: jest.fn(() => ({
              get: jest.fn(async () => ({ data: [] })),
            })),
          })),
        };
      }),
      command: { push: jest.fn((arr: any[]) => arr) },
    },
    updateCalls,
  };
}

describe('重试开通流程集成测试', () => {
  const adminOpenid = 'admin_001';

  beforeEach(() => {
    mockSubmitOrder.mockReset();
  });

  it('api_failed 订单重试成功 → 状态变为 activating，retryCount + 1', async () => {
    const order = createTestOrder(OrderStatus.API_FAILED, 0);
    const { db, updateCalls } = createMockDb(order);

    mockSubmitOrder.mockResolvedValue({ ordersn: 'SS_NEW_001', order_id: 99 });

    const result = await handleRetryActivation(db, adminOpenid, {
      orderId: 'VIP17041234567890099',
    });

    expect(result.success).toBe(true);
    expect(result.data!.success).toBe(true);
    expect(result.data!.msg).toContain('已重新提交');

    // 验证顺势下单调用参数
    expect(mockSubmitOrder).toHaveBeenCalledTimes(1);
    const submitCall = mockSubmitOrder.mock.calls[0][0];
    expect(submitCall.id).toBe(54321);
    expect(submitCall.safe_price).toBe(2990); // safe_price = order.amount
    expect(submitCall.external_orderno).toBe('VIP17041234567890099');
    expect(submitCall.attach.recharge_account).toBe('13800009999');

    // 验证数据库更新
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0].status).toBe(OrderStatus.ACTIVATING);
    expect(updateCalls[0].retryCount).toBe(1);
    expect(updateCalls[0].shunshiOrderSn).toBe('SS_NEW_001');
  });

  it('已重试2次的订单再次重试成功 → retryCount 变为 3', async () => {
    const order = createTestOrder(OrderStatus.API_FAILED, 2);
    const { db, updateCalls } = createMockDb(order);

    mockSubmitOrder.mockResolvedValue({ ordersn: 'SS_NEW_003', order_id: 100 });

    const result = await handleRetryActivation(db, adminOpenid, {
      orderId: 'VIP17041234567890099',
    });

    expect(result.success).toBe(true);
    expect(result.data!.success).toBe(true);
    expect(updateCalls[0].retryCount).toBe(3);
  });

  it('已达3次上限不允许继续重试', async () => {
    const order = createTestOrder(OrderStatus.API_FAILED, 3);
    const { db, updateCalls } = createMockDb(order);

    const result = await handleRetryActivation(db, adminOpenid, {
      orderId: 'VIP17041234567890099',
    });

    expect(result.success).toBe(true);
    expect(result.data!.success).toBe(false);
    expect(result.data!.msg).toContain('最大重试次数');

    // 不应调用顺势接口
    expect(mockSubmitOrder).not.toHaveBeenCalled();
    // 不应更新数据库
    expect(updateCalls.length).toBe(0);
  });

  it('重试次数上限常量为 3', () => {
    expect(MAX_RETRY_COUNT).toBe(3);
  });

  it('activating 状态订单也可以重试', async () => {
    const order = createTestOrder(OrderStatus.ACTIVATING, 1);
    const { db, updateCalls } = createMockDb(order);

    mockSubmitOrder.mockResolvedValue({ ordersn: 'SS_RETRY_ACT', order_id: 101 });

    const result = await handleRetryActivation(db, adminOpenid, {
      orderId: 'VIP17041234567890099',
    });

    expect(result.success).toBe(true);
    expect(result.data!.success).toBe(true);
    expect(updateCalls[0].retryCount).toBe(2);
  });

  it('非 api_failed/activating 状态不允许重试', async () => {
    // success 不允许
    const order1 = createTestOrder(OrderStatus.SUCCESS, 0);
    const { db: db1 } = createMockDb(order1);
    const result1 = await handleRetryActivation(db1, adminOpenid, {
      orderId: 'VIP17041234567890099',
    });
    expect(result1.success).toBe(false);
    expect(result1.errCode).toBe('ORDER_STATUS_INVALID');

    // refunding 不允许
    const order2 = createTestOrder(OrderStatus.REFUNDING, 0);
    const { db: db2 } = createMockDb(order2);
    const result2 = await handleRetryActivation(db2, adminOpenid, {
      orderId: 'VIP17041234567890099',
    });
    expect(result2.success).toBe(false);
    expect(result2.errCode).toBe('ORDER_STATUS_INVALID');

    // pending_pay 不允许
    const order3 = createTestOrder(OrderStatus.PENDING_PAY, 0);
    const { db: db3 } = createMockDb(order3);
    const result3 = await handleRetryActivation(db3, adminOpenid, {
      orderId: 'VIP17041234567890099',
    });
    expect(result3.success).toBe(false);
    expect(result3.errCode).toBe('ORDER_STATUS_INVALID');
  });

  it('顺势接口调用失败 → 状态变为 api_failed，retryCount 仍+1', async () => {
    const order = createTestOrder(OrderStatus.API_FAILED, 1);
    const { db, updateCalls } = createMockDb(order);

    mockSubmitOrder.mockRejectedValue(new Error('顺势接口网络超时'));

    const result = await handleRetryActivation(db, adminOpenid, {
      orderId: 'VIP17041234567890099',
    });

    expect(result.success).toBe(true);
    expect(result.data!.success).toBe(false);
    expect(result.data!.msg).toContain('失败');

    // 验证数据库更新：失败也要更新状态和计数
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0].status).toBe(OrderStatus.API_FAILED);
    expect(updateCalls[0].retryCount).toBe(2);
    expect(updateCalls[0].failReason).toBe('顺势接口网络超时');
  });

  it('订单不存在时返回错误', async () => {
    const { db } = createMockDb(null);
    const result = await handleRetryActivation(db, adminOpenid, {
      orderId: 'NONEXIST',
    });

    expect(result.success).toBe(false);
    expect(result.errCode).toBe('ORDER_NOT_FOUND');
  });

  it('缺少 orderId 参数时返回错误', async () => {
    const order = createTestOrder(OrderStatus.API_FAILED, 0);
    const { db } = createMockDb(order);
    const result = await handleRetryActivation(db, adminOpenid, {});

    expect(result.success).toBe(false);
    expect(result.errCode).toBe('INVALID_PARAM');
  });
});
