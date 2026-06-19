/**
 * 过滤与排序工具函数 - 属性测试
 * 使用 fast-check 生成随机商品/订单数据验证通用正确性属性
 *
 * Validates: Requirements 1.2, 1.6, 21.2, 21.5, 21.6, 23.1, 23.4
 */

import * as fc from 'fast-check';
import {
  filterByCategory,
  searchProducts,
  sortByPrice,
  filterByTag,
  filterCancelledOrders,
  isOrderExpired
} from '../../../cloudfunctions/shared/utils/filter';
import { Product, Package } from '../../../cloudfunctions/shared/types/product';
import { Order, OrderStatus } from '../../../cloudfunctions/shared/types/order';

// ===== 数据生成器 =====

/** 生成随机套餐 */
const arbPackage = (opts?: { priceRange?: [number, number] }): fc.Arbitrary<Package> => {
  const [minPrice, maxPrice] = opts?.priceRange ?? [1, 100000];
  return fc.record({
    packageId: fc.uuid(),
    name: fc.stringOf(fc.unicode(), { minLength: 1, maxLength: 10 }),
    memberType: fc.constantFrom('month', 'quarter', 'year'),
    price: fc.integer({ min: minPrice, max: maxPrice }),
    costPrice: fc.integer({ min: 1, max: 100000 }),
    faceValue: fc.integer({ min: 1, max: 100000 }),
    shunshiGoodsId: fc.integer({ min: 1, max: 99999 }),
    stock: fc.integer({ min: 0, max: 9999 }),
    online: fc.boolean(),
    isDefault: fc.boolean(),
    sortWeight: fc.integer({ min: 0, max: 1000 })
  });
};

/** 生成随机商品（支持覆盖字段） */
const arbProduct = (overrides?: Partial<Product>): fc.Arbitrary<Product> => {
  return fc.record({
    productId: fc.uuid(),
    shunshiGoodsId: fc.integer({ min: 1, max: 99999 }),
    name: fc.stringOf(fc.unicode(), { minLength: 1, maxLength: 30 }),
    shunshiName: fc.stringOf(fc.unicode(), { minLength: 1, maxLength: 30 }),
    categoryId: fc.hexaString({ minLength: 3, maxLength: 15 }),
    categoryName: fc.stringOf(fc.unicode(), { minLength: 1, maxLength: 15 }),
    brandIcon: fc.constant(''),
    shunshiImg: fc.constant(''),
    tags: fc.array(fc.stringOf(fc.unicode(), { minLength: 1, maxLength: 8 }), { minLength: 0, maxLength: 5 }),
    description: fc.constant(''),
    rechargeMethod: fc.constant('account'),
    accountType: fc.constant('phone'),
    autoActivate: fc.boolean(),
    online: fc.boolean(),
    sortWeight: fc.integer({ min: 0, max: 1000 }),
    salesCount: fc.integer({ min: 0, max: 99999 }),
    todaySales: fc.integer({ min: 0, max: 999 }),
    shunshiStatus: fc.constantFrom(1, 2, 3),
    stockNum: fc.integer({ min: 0, max: 9999 }),
    attachTemplate: fc.constant([]),
    packages: fc.array(arbPackage(), { minLength: 1, maxLength: 5 }),
    rules: fc.constant({ deviceSupport: '', arrivalTime: '', safetyNote: '' }),
    createdAt: fc.date(),
    updatedAt: fc.date()
  }).map(p => ({ ...p, ...overrides }));
};

/** 生成指定 categoryId 和 online 的商品 */
const arbProductWith = (categoryId: string, online: boolean): fc.Arbitrary<Product> =>
  arbProduct({ categoryId, online });

/** 生成随机订单状态 */
const arbOrderStatus = fc.constantFrom(
  OrderStatus.PENDING_PAY,
  OrderStatus.PAID,
  OrderStatus.ACTIVATING,
  OrderStatus.SUCCESS,
  OrderStatus.API_FAILED,
  OrderStatus.REFUNDING,
  OrderStatus.REFUNDED,
  OrderStatus.CANCELLED
);

/** 生成随机订单 */
const arbOrder = (overrides?: Partial<Order>): fc.Arbitrary<Order> => {
  return fc.record({
    orderId: fc.uuid(),
    openid: fc.uuid(),
    productId: fc.uuid(),
    productName: fc.stringOf(fc.unicode(), { minLength: 1, maxLength: 20 }),
    packageId: fc.uuid(),
    packageName: fc.stringOf(fc.unicode(), { minLength: 1, maxLength: 10 }),
    categoryName: fc.stringOf(fc.unicode(), { minLength: 1, maxLength: 10 }),
    attach: fc.constant({}),
    amount: fc.integer({ min: 1, max: 100000 }),
    costPrice: fc.integer({ min: 1, max: 100000 }),
    status: arbOrderStatus,
    retryCount: fc.integer({ min: 0, max: 5 }),
    timeline: fc.constant([]),
    createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
    updatedAt: fc.date()
  }).map(o => ({ ...o, ...overrides }));
};

// ===== 属性测试 =====

describe('Property 1: 分类过滤正确性', () => {
  /**
   * **Validates: Requirements 1.2**
   * filterByCategory 结果中所有商品的 categoryId 等于入参且 online=true
   */
  it('返回结果中每个商品的 categoryId 等于入参且 online=true', () => {
    fc.assert(
      fc.property(
        fc.array(arbProduct(), { minLength: 0, maxLength: 20 }),
        fc.hexaString({ minLength: 3, maxLength: 15 }),
        (products, categoryId) => {
          const result = filterByCategory(products, categoryId);

          // 属性: 所有结果 categoryId 等于入参
          for (const p of result) {
            expect(p.categoryId).toBe(categoryId);
            expect(p.online).toBe(true);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('不遗漏：原数组中符合条件的商品全部出现在结果中', () => {
    fc.assert(
      fc.property(
        fc.array(arbProduct(), { minLength: 0, maxLength: 20 }),
        fc.hexaString({ minLength: 3, maxLength: 15 }),
        (products, categoryId) => {
          const result = filterByCategory(products, categoryId);
          const expected = products.filter(p => p.categoryId === categoryId && p.online === true);
          expect(result.length).toBe(expected.length);
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('Property 15: 搜索匹配正确性', () => {
  /**
   * **Validates: Requirements 1.6, 21.2**
   * searchProducts 结果中所有商品的 name 或 categoryName 包含 keyword 且 online=true
   */
  it('返回结果中每个商品的 name 或 categoryName 包含 keyword 且 online=true', () => {
    fc.assert(
      fc.property(
        fc.array(arbProduct(), { minLength: 0, maxLength: 20 }),
        fc.hexaString({ minLength: 1, maxLength: 5 }),
        (products, keyword) => {
          const result = searchProducts(products, keyword);
          const lowerKw = keyword.toLowerCase();

          for (const p of result) {
            // 必须 online
            expect(p.online).toBe(true);
            // name 或 categoryName 包含 keyword（不区分大小写）
            const nameMatch = p.name.toLowerCase().includes(lowerKw);
            const catMatch = p.categoryName.toLowerCase().includes(lowerKw);
            expect(nameMatch || catMatch).toBe(true);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('不遗漏：原数组中符合条件的商品全部出现在结果中', () => {
    fc.assert(
      fc.property(
        fc.array(arbProduct(), { minLength: 0, maxLength: 20 }),
        fc.hexaString({ minLength: 1, maxLength: 5 }),
        (products, keyword) => {
          const result = searchProducts(products, keyword);
          const lowerKw = keyword.toLowerCase();
          const expected = products.filter(
            p => p.online === true &&
              (p.name.toLowerCase().includes(lowerKw) || p.categoryName.toLowerCase().includes(lowerKw))
          );
          expect(result.length).toBe(expected.length);
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('Property 16: 价格排序单调性', () => {
  /**
   * **Validates: Requirements 21.5**
   * sortByPrice 结果按默认套餐 price 非递减
   */
  it('排序后结果中每个商品的默认套餐价格 ≤ 下一个商品的默认套餐价格', () => {
    // 生成至少有一个套餐的商品
    fc.assert(
      fc.property(
        fc.array(arbProduct(), { minLength: 0, maxLength: 20 }),
        (products) => {
          const sorted = sortByPrice(products);

          // 辅助：获取默认套餐价格
          const getPrice = (p: Product): number => {
            const defaultPkg = p.packages.find(pkg => pkg.isDefault === true);
            if (defaultPkg) return defaultPkg.price;
            if (p.packages.length > 0) return p.packages[0].price;
            return Infinity;
          };

          // 验证单调非递减
          for (let i = 0; i < sorted.length - 1; i++) {
            expect(getPrice(sorted[i])).toBeLessThanOrEqual(getPrice(sorted[i + 1]));
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('排序不改变原数组', () => {
    fc.assert(
      fc.property(
        fc.array(arbProduct(), { minLength: 1, maxLength: 10 }),
        (products) => {
          const original = products.map(p => p.productId);
          sortByPrice(products);
          const afterCall = products.map(p => p.productId);
          expect(afterCall).toEqual(original);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 17: 标签过滤正确性', () => {
  /**
   * **Validates: Requirements 21.6**
   * filterByTag 结果中每个商品的 tags 包含指定 tag
   */
  it('返回结果中每个商品的 tags 包含指定 tag', () => {
    fc.assert(
      fc.property(
        fc.array(arbProduct(), { minLength: 0, maxLength: 20 }),
        fc.stringOf(fc.unicode(), { minLength: 1, maxLength: 8 }),
        (products, tag) => {
          const result = filterByTag(products, tag);

          for (const p of result) {
            expect(p.tags).toContain(tag);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('不遗漏：原数组中 tags 包含 tag 的商品全部出现在结果中', () => {
    fc.assert(
      fc.property(
        fc.array(arbProduct(), { minLength: 0, maxLength: 20 }),
        fc.stringOf(fc.unicode(), { minLength: 1, maxLength: 8 }),
        (products, tag) => {
          const result = filterByTag(products, tag);
          const expected = products.filter(p => p.tags.includes(tag));
          expect(result.length).toBe(expected.length);
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('Property 18: 订单超时判断正确性', () => {
  /**
   * **Validates: Requirements 23.1**
   * 对 createdAt 超过 minutes 分钟前的 pending_pay 订单 isOrderExpired 返回 true，否则 false
   */
  it('pending_pay 订单超时时返回 true', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 120 }), // minutes 参数
        fc.integer({ min: 1, max: 60 }),   // 超过 minutes 的额外分钟数
        (minutes, extra) => {
          const now = Date.now();
          // createdAt = 超过 minutes + extra 分钟前
          const createdAt = new Date(now - (minutes + extra) * 60 * 1000);
          const order: Order = {
            orderId: 'test',
            openid: 'u1',
            productId: 'p1',
            productName: 'test',
            packageId: 'pkg1',
            packageName: 'test',
            categoryName: 'test',
            attach: {},
            amount: 100,
            costPrice: 80,
            status: OrderStatus.PENDING_PAY,
            retryCount: 0,
            timeline: [],
            createdAt,
            updatedAt: new Date()
          };
          expect(isOrderExpired(order, minutes)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('pending_pay 订单未超时时返回 false', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 120 }), // minutes 参数
        fc.integer({ min: 1, max: 60 }),   // 不超过 minutes 的分钟数（0到minutes-1）
        (minutes, withinMinutes) => {
          const actualWithin = Math.min(withinMinutes, minutes - 1);
          const now = Date.now();
          // createdAt = actualWithin 分钟前（必定小于 minutes）
          const createdAt = new Date(now - actualWithin * 60 * 1000);
          const order: Order = {
            orderId: 'test',
            openid: 'u1',
            productId: 'p1',
            productName: 'test',
            packageId: 'pkg1',
            packageName: 'test',
            categoryName: 'test',
            attach: {},
            amount: 100,
            costPrice: 80,
            status: OrderStatus.PENDING_PAY,
            retryCount: 0,
            timeline: [],
            createdAt,
            updatedAt: new Date()
          };
          expect(isOrderExpired(order, minutes)).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('非 pending_pay 状态始终返回 false', () => {
    const nonPendingStatuses = fc.constantFrom(
      OrderStatus.PAID,
      OrderStatus.ACTIVATING,
      OrderStatus.SUCCESS,
      OrderStatus.API_FAILED,
      OrderStatus.REFUNDING,
      OrderStatus.REFUNDED,
      OrderStatus.CANCELLED
    );

    fc.assert(
      fc.property(
        nonPendingStatuses,
        fc.integer({ min: 1, max: 120 }),
        (status, minutes) => {
          const now = Date.now();
          // 即使创建时间远超过超时时间
          const createdAt = new Date(now - (minutes + 100) * 60 * 1000);
          const order: Order = {
            orderId: 'test',
            openid: 'u1',
            productId: 'p1',
            productName: 'test',
            packageId: 'pkg1',
            packageName: 'test',
            categoryName: 'test',
            attach: {},
            amount: 100,
            costPrice: 80,
            status,
            retryCount: 0,
            timeline: [],
            createdAt,
            updatedAt: new Date()
          };
          expect(isOrderExpired(order, minutes)).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('Property 19: 用户端排除已取消订单', () => {
  /**
   * **Validates: Requirements 23.4**
   * filterCancelledOrders 结果中无 status=cancelled 的订单
   */
  it('返回结果中不包含 status 为 cancelled 的订单', () => {
    fc.assert(
      fc.property(
        fc.array(arbOrder(), { minLength: 0, maxLength: 20 }),
        (orders) => {
          const result = filterCancelledOrders(orders);

          for (const o of result) {
            expect(o.status).not.toBe(OrderStatus.CANCELLED);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('不遗漏：原数组中非 cancelled 的订单全部保留', () => {
    fc.assert(
      fc.property(
        fc.array(arbOrder(), { minLength: 0, maxLength: 20 }),
        (orders) => {
          const result = filterCancelledOrders(orders);
          const expected = orders.filter(o => o.status !== OrderStatus.CANCELLED);
          expect(result.length).toBe(expected.length);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('保持原有顺序不变', () => {
    fc.assert(
      fc.property(
        fc.array(arbOrder(), { minLength: 0, maxLength: 20 }),
        (orders) => {
          const result = filterCancelledOrders(orders);
          const expected = orders.filter(o => o.status !== OrderStatus.CANCELLED);
          // 验证顺序一致
          for (let i = 0; i < result.length; i++) {
            expect(result[i].orderId).toBe(expected[i].orderId);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
