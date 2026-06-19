/**
 * 集成测试：支付完整流程 Mock 测试
 * 验证 create → 金额锁定 → 状态为 pending_pay
 *
 * Mock 策略：模拟云数据库操作
 */

import { createOrder, CreateOrderParams } from '../../cloudfunctions/order/create';
import { OrderStatus } from '../../cloudfunctions/shared/types/order';

// Mock logger 避免实际写审计日志
jest.mock('../../cloudfunctions/shared/utils/logger', () => ({
  createAuditLog: jest.fn(() => ({ logId: 'mock_log_id', createdAt: new Date().toISOString() })),
  writeAuditLog: jest.fn(async () => {}),
}));

/** 构造模拟数据库实例 */
function createMockDb(options: {
  product?: any;
  addResult?: any;
  addError?: Error;
}) {
  const { product, addResult, addError } = options;
  return {
    collection: jest.fn((name: string) => {
      if (name === 'products') {
        return {
          where: jest.fn(() => ({
            limit: jest.fn(() => ({
              get: jest.fn(async () => ({
                data: product ? [product] : [],
              })),
            })),
          })),
        };
      }
      if (name === 'orders') {
        return {
          add: jest.fn(async (params: any) => {
            if (addError) throw addError;
            return addResult || { _id: 'mock_order_doc_id' };
          }),
        };
      }
      // audit_logs
      return {
        add: jest.fn(async () => ({ _id: 'mock_audit_log_id' })),
      };
    }),
  };
}

/** 构造合法商品数据 */
function createValidProduct(overrides: Partial<any> = {}) {
  return {
    productId: 'prod_001',
    name: '爱奇艺VIP月卡',
    categoryName: '视频会员',
    online: true,
    packages: [
      {
        packageId: 'pkg_001',
        name: '月卡',
        price: 1990, // 19.90元（分）
        costPrice: 1500,
        shunshiGoodsId: 12345,
        online: true,
        isDefault: true,
      },
      {
        packageId: 'pkg_002',
        name: '季卡',
        price: 4990,
        costPrice: 4000,
        shunshiGoodsId: 12346,
        online: true,
        isDefault: false,
      },
    ],
    ...overrides,
  };
}

describe('订单创建流程集成测试', () => {
  const openid = 'user_openid_123';

  it('正常创建订单：金额锁定为下单时套餐价格，状态为 pending_pay', async () => {
    const product = createValidProduct();
    const addedData: any[] = [];
    const db = createMockDb({ product });
    // 拦截 add 调用以检查写入数据
    db.collection = jest.fn((name: string) => {
      if (name === 'products') {
        return {
          where: jest.fn(() => ({
            limit: jest.fn(() => ({
              get: jest.fn(async () => ({ data: [product] })),
            })),
          })),
        };
      }
      if (name === 'orders') {
        return {
          add: jest.fn(async (params: any) => {
            addedData.push(params.data);
            return { _id: 'mock_id' };
          }),
        };
      }
      return { add: jest.fn(async () => ({ _id: 'log_id' })) };
    });

    const params: CreateOrderParams = {
      productId: 'prod_001',
      packageId: 'pkg_001',
      attach: { recharge_account: '13812345678' },
    };

    const result = await createOrder(db, openid, params);

    // 验证返回成功
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.orderId).toMatch(/^VIP\d+/);

    // 验证写入的订单数据
    expect(addedData.length).toBe(1);
    const order = addedData[0];
    // 金额锁定：amount 等于下单时套餐的 price
    expect(order.amount).toBe(1990);
    expect(order.costPrice).toBe(1500);
    // 状态为 pending_pay
    expect(order.status).toBe(OrderStatus.PENDING_PAY);
    // timeline 含创建节点
    expect(order.timeline).toHaveLength(1);
    expect(order.timeline[0].status).toBe(OrderStatus.PENDING_PAY);
    expect(order.timeline[0].desc).toBe('创建订单');
    // 记录了用户开通参数
    expect(order.attach).toEqual({ recharge_account: '13812345678' });
    // 冗余快照字段
    expect(order.productName).toBe('爱奇艺VIP月卡');
    expect(order.packageName).toBe('月卡');
  });

  it('商品不存在时返回错误', async () => {
    const db = createMockDb({ product: null });
    const params: CreateOrderParams = { productId: 'nonexist', packageId: 'pkg_001' };
    const result = await createOrder(db, openid, params);

    expect(result.success).toBe(false);
    expect(result.errCode).toBe('PRODUCT_NOT_FOUND');
  });

  it('商品已下架时返回错误', async () => {
    const product = createValidProduct({ online: false });
    const db = createMockDb({ product });
    const params: CreateOrderParams = { productId: 'prod_001', packageId: 'pkg_001' };
    const result = await createOrder(db, openid, params);

    expect(result.success).toBe(false);
    expect(result.errCode).toBe('PRODUCT_OFFLINE');
  });

  it('套餐已下架时返回错误', async () => {
    const product = createValidProduct();
    product.packages[0].online = false;
    const db = createMockDb({ product });
    const params: CreateOrderParams = { productId: 'prod_001', packageId: 'pkg_001' };
    const result = await createOrder(db, openid, params);

    expect(result.success).toBe(false);
    expect(result.errCode).toBe('PACKAGE_OFFLINE');
  });

  it('金额锁定：选择不同套餐时金额对应该套餐的 price', async () => {
    const product = createValidProduct();
    const addedData: any[] = [];
    const db = {
      collection: jest.fn((name: string) => {
        if (name === 'products') {
          return {
            where: jest.fn(() => ({
              limit: jest.fn(() => ({
                get: jest.fn(async () => ({ data: [product] })),
              })),
            })),
          };
        }
        if (name === 'orders') {
          return {
            add: jest.fn(async (params: any) => {
              addedData.push(params.data);
              return { _id: 'mock_id' };
            }),
          };
        }
        return { add: jest.fn(async () => ({ _id: 'log_id' })) };
      }),
    };

    const params: CreateOrderParams = {
      productId: 'prod_001',
      packageId: 'pkg_002', // 选择季卡
      attach: { recharge_account: '13800000000' },
    };
    const result = await createOrder(db, openid, params);

    expect(result.success).toBe(true);
    expect(addedData[0].amount).toBe(4990); // 季卡价格
    expect(addedData[0].costPrice).toBe(4000);
  });

  it('缺少 openid 时返回身份错误', async () => {
    const product = createValidProduct();
    const db = createMockDb({ product });
    const params: CreateOrderParams = { productId: 'prod_001', packageId: 'pkg_001' };
    const result = await createOrder(db, '', params);

    expect(result.success).toBe(false);
    expect(result.errCode).toBe('UNAUTHORIZED');
  });

  it('数据库写入失败时返回错误', async () => {
    const product = createValidProduct();
    const db = createMockDb({ product, addError: new Error('DB Error') });
    const params: CreateOrderParams = { productId: 'prod_001', packageId: 'pkg_001' };
    const result = await createOrder(db, openid, params);

    expect(result.success).toBe(false);
    expect(result.errCode).toBe('ORDER_CREATE_FAILED');
  });
});
