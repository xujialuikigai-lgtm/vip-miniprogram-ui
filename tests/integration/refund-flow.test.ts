/**
 * 集成测试：退款流程 Mock 测试
 * 验证仅 api_failed 状态可退 → refunding
 *
 * Mock 策略：模拟 db、WechatPayClient、adminAuth
 */

import { refund, RefundParams } from '../../cloudfunctions/payment/refund';
import { OrderStatus } from '../../cloudfunctions/shared/types/order';

// Mock adminAuth，默认允许
jest.mock('../../cloudfunctions/shared/utils/adminAuth', () => ({
  requireAdmin: jest.fn(async () => ({ allowed: true })),
  checkAdmin: jest.fn(async () => true),
}));

// Mock logger
jest.mock('../../cloudfunctions/shared/utils/logger', () => ({
  createAuditLog: jest.fn(() => ({ logId: 'mock_log', createdAt: new Date().toISOString() })),
  writeAuditLog: jest.fn(async () => {}),
}));

/** 构造测试订单 */
function createTestOrder(statusOverride?: OrderStatus, extraFields?: any) {
  return {
    _id: 'doc_001',
    orderId: 'VIP17041234567890001',
    openid: 'user_123',
    productId: 'prod_001',
    productName: '爱奇艺VIP月卡',
    packageId: 'pkg_001',
    packageName: '月卡',
    categoryName: '视频会员',
    attach: { recharge_account: '13812345678' },
    amount: 19.9, // 元
    costPrice: 15.0,
    status: statusOverride || OrderStatus.API_FAILED,
    retryCount: 1,
    payTransactionId: 'wx_trans_001',
    timeline: [
      { status: OrderStatus.PENDING_PAY, time: new Date(), desc: '创建订单' },
      { status: OrderStatus.PAID, time: new Date(), desc: '支付成功' },
      { status: OrderStatus.API_FAILED, time: new Date(), desc: '接口下单失败' },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extraFields,
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
              update: jest.fn(async (params: any) => {
                updateCalls.push(params.data);
                return { stats: { updated: 1 } };
              }),
            })),
          };
        }
        // admin_whitelist / audit_logs
        return {
          where: jest.fn(() => ({
            limit: jest.fn(() => ({
              get: jest.fn(async () => ({ data: [{ openid: 'admin_001' }] })),
            })),
          })),
          add: jest.fn(async () => ({ _id: 'log_id' })),
        };
      }),
      command: { push: jest.fn((arr: any[]) => arr) },
    },
    updateCalls,
  };
}

/** 构造 Mock 微信支付客户端 */
function createMockPayClient(options: { success?: boolean; refundId?: string; error?: Error } = {}) {
  return {
    refund: jest.fn(async () => {
      if (options.error) throw options.error;
      return {
        refundId: options.refundId || 'wx_refund_001',
        outRefundNo: 'VIP17041234567890001',
        status: 'PROCESSING',
      };
    }),
  } as any;
}

describe('退款流程集成测试', () => {
  const adminOpenid = 'admin_001';

  it('api_failed 状态订单 → 退款成功 → 状态更新为 refunding', async () => {
    const order = createTestOrder(OrderStatus.API_FAILED);
    const { db, updateCalls } = createMockDb(order);
    const payClient = createMockPayClient({ refundId: 'wx_refund_999' });

    const params: RefundParams = {
      orderId: 'VIP17041234567890001',
      reason: '接口开通失败',
      note: '用户投诉',
    };

    const result = await refund(db, adminOpenid, params, payClient);

    // 返回成功
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.status).toBe(OrderStatus.REFUNDING);
    expect(result.data!.refundId).toBe('wx_refund_999');

    // 验证微信退款接口调用
    expect(payClient.refund).toHaveBeenCalledTimes(1);
    const refundCall = payClient.refund.mock.calls[0][0];
    // 退款金额 = 用户实付金额（元→分）
    expect(refundCall.refundFee).toBe(Math.round(19.9 * 100));
    expect(refundCall.totalFee).toBe(Math.round(19.9 * 100));

    // 验证数据库更新
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0].status).toBe(OrderStatus.REFUNDING);
    expect(updateCalls[0].refundReason).toBe('接口开通失败');
    expect(updateCalls[0].refundNote).toBe('用户投诉');
    expect(updateCalls[0].refundId).toBe('wx_refund_999');
  });

  it('非 api_failed 状态订单不允许退款', async () => {
    // pending_pay 不可退
    const order1 = createTestOrder(OrderStatus.PENDING_PAY);
    const { db: db1 } = createMockDb(order1);
    const result1 = await refund(db1, adminOpenid, {
      orderId: 'VIP17041234567890001',
      reason: '测试',
    });
    expect(result1.success).toBe(false);
    expect(result1.errCode).toBe('ORDER_STATUS_INVALID');

    // activating 不可退
    const order2 = createTestOrder(OrderStatus.ACTIVATING);
    const { db: db2 } = createMockDb(order2);
    const result2 = await refund(db2, adminOpenid, {
      orderId: 'VIP17041234567890001',
      reason: '测试',
    });
    expect(result2.success).toBe(false);
    expect(result2.errCode).toBe('ORDER_STATUS_INVALID');

    // success 不可退
    const order3 = createTestOrder(OrderStatus.SUCCESS);
    const { db: db3 } = createMockDb(order3);
    const result3 = await refund(db3, adminOpenid, {
      orderId: 'VIP17041234567890001',
      reason: '测试',
    });
    expect(result3.success).toBe(false);
    expect(result3.errCode).toBe('ORDER_STATUS_INVALID');

    // refunding 不可退（幂等保护）
    const order4 = createTestOrder(OrderStatus.REFUNDING);
    const { db: db4 } = createMockDb(order4);
    const result4 = await refund(db4, adminOpenid, {
      orderId: 'VIP17041234567890001',
      reason: '测试',
    });
    expect(result4.success).toBe(false);
    expect(result4.errCode).toBe('ORDER_STATUS_INVALID');
  });

  it('微信退款接口失败时返回错误，订单状态不变', async () => {
    const order = createTestOrder(OrderStatus.API_FAILED);
    const { db, updateCalls } = createMockDb(order);
    const payClient = createMockPayClient({ error: new Error('微信退款超时') });

    const params: RefundParams = {
      orderId: 'VIP17041234567890001',
      reason: '接口失败',
    };

    const result = await refund(db, adminOpenid, params, payClient);

    expect(result.success).toBe(false);
    expect(result.errCode).toBe('REFUND_FAILED');
    // 订单状态未被更新
    expect(updateCalls.length).toBe(0);
  });

  it('订单不存在时返回错误', async () => {
    const { db } = createMockDb(null);
    const params: RefundParams = {
      orderId: 'NONEXIST_ORDER',
      reason: '测试',
    };
    const result = await refund(db, adminOpenid, params);

    expect(result.success).toBe(false);
    expect(result.errCode).toBe('ORDER_NOT_FOUND');
  });

  it('缺少退款原因时返回参数错误', async () => {
    const order = createTestOrder(OrderStatus.API_FAILED);
    const { db } = createMockDb(order);
    const params: RefundParams = {
      orderId: 'VIP17041234567890001',
      reason: '', // 空原因
    };
    const result = await refund(db, adminOpenid, params);

    expect(result.success).toBe(false);
    expect(result.errCode).toBe('INVALID_PARAM');
  });
});
