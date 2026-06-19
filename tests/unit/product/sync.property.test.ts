/**
 * 商品同步保留管理员配置 - 属性测试
 * 使用 fast-check 生成随机商品数据，验证同步更新逻辑的字段保留规则
 *
 * **Validates: Requirements 17.3**
 *
 * Property 14: 商品同步保留管理员配置
 * 对已存在商品执行同步更新后：
 * - 管理员已配置字段（name、sortWeight、online（status=1时）、packages[].price）不被覆盖
 * - 仅顺势字段（shunshiName、shunshiImg、shunshiStatus、stockNum）被更新
 * - 匹配套餐的 costPrice/faceValue/stock 被更新，price 保留
 */

import * as fc from 'fast-check';
import { Product, Package } from '../../../cloudfunctions/shared/types/product';
import { ShunshiProductStatus } from '../../../cloudfunctions/shared/constants';
import {
  computeSyncUpdateData,
  ShunshiProductData
} from '../../../cloudfunctions/product/syncMerge';

// ===== 数据生成器 =====

/** 生成随机套餐（支持指定 shunshiGoodsId） */
const arbPackage = (shunshiGoodsId?: number): fc.Arbitrary<Package> => {
  return fc.record({
    packageId: fc.uuid(),
    name: fc.string({ minLength: 1, maxLength: 10 }),
    memberType: fc.constantFrom('month', 'quarter', 'year'),
    price: fc.integer({ min: 1, max: 100000 }),
    costPrice: fc.integer({ min: 1, max: 100000 }),
    faceValue: fc.integer({ min: 1, max: 100000 }),
    shunshiGoodsId: shunshiGoodsId !== undefined
      ? fc.constant(shunshiGoodsId)
      : fc.integer({ min: 1, max: 99999 }),
    stock: fc.integer({ min: 0, max: 9999 }),
    online: fc.boolean(),
    isDefault: fc.boolean(),
    sortWeight: fc.integer({ min: 0, max: 1000 })
  });
};

/** 生成随机商品（支持覆盖字段） */
const arbProduct = (overrides?: Partial<Product>): fc.Arbitrary<Product> => {
  return fc.record({
    _id: fc.uuid(),
    productId: fc.uuid(),
    shunshiGoodsId: fc.integer({ min: 1, max: 99999 }),
    name: fc.string({ minLength: 1, maxLength: 30 }),
    shunshiName: fc.string({ minLength: 1, maxLength: 30 }),
    categoryId: fc.hexaString({ minLength: 3, maxLength: 15 }),
    categoryName: fc.string({ minLength: 1, maxLength: 15 }),
    brandIcon: fc.constant(''),
    shunshiImg: fc.string({ minLength: 0, maxLength: 50 }),
    tags: fc.array(fc.string({ minLength: 1, maxLength: 8 }), { minLength: 0, maxLength: 3 }),
    description: fc.constant(''),
    rechargeMethod: fc.constant('account'),
    accountType: fc.constant('phone'),
    autoActivate: fc.boolean(),
    online: fc.boolean(),
    sortWeight: fc.integer({ min: 0, max: 9999 }),
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

/** 生成顺势商品数据（字段名与列表/详情一致：id、goods_price/face_value 为字符串） */
const arbShunshiProduct = (overrides?: Partial<ShunshiProductData>): fc.Arbitrary<ShunshiProductData> => {
  return fc.record({
    id: fc.integer({ min: 1, max: 99999 }),
    goods_name: fc.string({ minLength: 1, maxLength: 30 }),
    goods_img: fc.string({ minLength: 1, maxLength: 50 }),
    // 顺势售价/面值为字符串，如 "18.00"
    goods_price: fc.integer({ min: 1, max: 100000 }).map((n) => (n / 100).toFixed(2)),
    face_value: fc.integer({ min: 1, max: 100000 }).map((n) => (n / 100).toFixed(2)),
    status: fc.constantFrom(
      ShunshiProductStatus.ON_SALE,
      ShunshiProductStatus.PAUSED,
      ShunshiProductStatus.FORBIDDEN
    ),
    stock_num: fc.integer({ min: 0, max: 9999 })
  }).map(sp => ({ ...sp, ...overrides }));
};

// ===== 属性测试 =====

describe('Property 14: 商品同步保留管理员配置', () => {
  /**
   * **Validates: Requirements 17.3**
   * 同步后管理员配置字段 name 不被覆盖（name 不在更新数据中）
   */
  it('同步更新不修改管理员自定义的 name 字段', () => {
    fc.assert(
      fc.property(
        arbProduct(),
        arbShunshiProduct(),
        (existing, sp) => {
          const { data } = computeSyncUpdateData(existing, sp);

          // name 不应出现在更新数据中，保留管理员自定义名称
          expect(data).not.toHaveProperty('name');
        }
      ),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 17.3**
   * 同步后管理员配置字段 sortWeight 不被覆盖
   */
  it('同步更新不修改管理员配置的 sortWeight 字段', () => {
    fc.assert(
      fc.property(
        arbProduct(),
        arbShunshiProduct(),
        (existing, sp) => {
          const { data } = computeSyncUpdateData(existing, sp);

          // sortWeight 不应出现在更新数据中
          expect(data).not.toHaveProperty('sortWeight');
        }
      ),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 17.3**
   * 顺势 status=1（销售中）时不修改 online 字段，保留管理员手动下架决定
   */
  it('顺势 status=1 时不修改 online 字段', () => {
    fc.assert(
      fc.property(
        arbProduct(),
        arbShunshiProduct({ status: ShunshiProductStatus.ON_SALE }),
        (existing, sp) => {
          const { data } = computeSyncUpdateData(existing, sp);

          // status=1 时 online 不应出现在更新数据中
          expect(data.online).toBeUndefined();
        }
      ),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 17.3**
   * 顺势 status=2/3 时自动下架（online 设为 false）
   */
  it('顺势 status=2 或 3 时自动将 online 设为 false', () => {
    fc.assert(
      fc.property(
        arbProduct(),
        arbShunshiProduct({
          status: fc.constantFrom(
            ShunshiProductStatus.PAUSED,
            ShunshiProductStatus.FORBIDDEN
          ) as any
        }),
        (existing, sp) => {
          // 由于 overrides 中 status 是固定值，需要手动处理生成器
          // 此处直接随机二选一
          const actualSp = { ...sp, status: sp.status >= 2 ? sp.status : 2 };
          const { data } = computeSyncUpdateData(existing, actualSp);

          expect(data.online).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 17.3**
   * 匹配套餐（shunshiGoodsId 相同）的 price 不被覆盖
   */
  it('同步更新不修改匹配套餐的管理员售价 price', () => {
    // 生成确保有匹配套餐的场景
    const sharedGoodsId = fc.integer({ min: 1, max: 99999 });

    fc.assert(
      fc.property(
        sharedGoodsId.chain(gid =>
          fc.tuple(
            arbProduct().map(p => ({
              ...p,
              packages: [
                ...p.packages,
                // 确保至少一个套餐匹配顺势商品 ID
                {
                  packageId: 'pkg_match',
                  name: '匹配套餐',
                  memberType: 'month',
                  price: Math.floor(Math.random() * 100000) + 1,
                  costPrice: 5000,
                  faceValue: 8000,
                  shunshiGoodsId: gid,
                  stock: 100,
                  online: true,
                  isDefault: true,
                  sortWeight: 0
                } as Package
              ]
            })),
            arbShunshiProduct({ id: gid })
          )
        ),
        ([existing, sp]) => {
          // 记录同步前匹配套餐的 price
          const matchedPkgBefore = existing.packages.find(
            pkg => pkg.shunshiGoodsId === sp.id
          );
          expect(matchedPkgBefore).toBeDefined();
          const priceBefore = matchedPkgBefore!.price;

          const { data } = computeSyncUpdateData(existing, sp);

          // 同步后匹配套餐的 price 应保持不变
          const matchedPkgAfter = data.packages.find(
            pkg => pkg.shunshiGoodsId === sp.id
          );
          expect(matchedPkgAfter).toBeDefined();
          expect(matchedPkgAfter!.price).toBe(priceBefore);
        }
      ),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 17.3**
   * 匹配套餐的 costPrice、faceValue、stock 被正确更新为顺势数据
   */
  it('同步正确更新匹配套餐的 costPrice/faceValue/stock', () => {
    const sharedGoodsId = fc.integer({ min: 1, max: 99999 });

    fc.assert(
      fc.property(
        sharedGoodsId.chain(gid =>
          fc.tuple(
            arbProduct().map(p => ({
              ...p,
              packages: [
                {
                  packageId: 'pkg_match',
                  name: '匹配套餐',
                  memberType: 'month',
                  price: 9900,
                  costPrice: 5000,
                  faceValue: 8000,
                  shunshiGoodsId: gid,
                  stock: 100,
                  online: true,
                  isDefault: true,
                  sortWeight: 0
                } as Package
              ]
            })),
            arbShunshiProduct({ id: gid })
          )
        ),
        ([existing, sp]) => {
          const { data } = computeSyncUpdateData(existing, sp);

          const matchedPkg = data.packages.find(
            pkg => pkg.shunshiGoodsId === sp.id
          );
          expect(matchedPkg).toBeDefined();
          // 顺势字段被更新（字符串价格转数字）
          expect(matchedPkg!.costPrice).toBe(Number(sp.goods_price));
          expect(matchedPkg!.faceValue).toBe(Number(sp.face_value));
          expect(matchedPkg!.stock).toBe(sp.stock_num);
        }
      ),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 17.3**
   * 顺势字段（shunshiName、shunshiImg、shunshiStatus、stockNum）被正确更新
   */
  it('同步正确更新顺势字段 shunshiName/shunshiImg/shunshiStatus/stockNum', () => {
    fc.assert(
      fc.property(
        arbProduct(),
        arbShunshiProduct(),
        (existing, sp) => {
          const { data } = computeSyncUpdateData(existing, sp);

          expect(data.shunshiName).toBe(sp.goods_name);
          expect(data.shunshiImg).toBe(sp.goods_img);
          expect(data.shunshiStatus).toBe(sp.status);
          expect(data.stockNum).toBe(sp.stock_num);
        }
      ),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 17.3**
   * 非匹配套餐完全不受影响（保留所有原有字段）
   */
  it('非匹配套餐的所有字段完全保留不变', () => {
    fc.assert(
      fc.property(
        arbProduct(),
        arbShunshiProduct(),
        (existing, sp) => {
          const { data } = computeSyncUpdateData(existing, sp);

          // 找到所有非匹配套餐
          const nonMatchedBefore = existing.packages.filter(
            pkg => pkg.shunshiGoodsId !== sp.id
          );
          const nonMatchedAfter = data.packages.filter(
            pkg => pkg.shunshiGoodsId !== sp.id
          );

          // 数量不变
          expect(nonMatchedAfter.length).toBe(nonMatchedBefore.length);

          // 每个非匹配套餐的所有字段完全一致
          for (let i = 0; i < nonMatchedBefore.length; i++) {
            const before = nonMatchedBefore[i];
            const after = nonMatchedAfter[i];
            expect(after).toEqual(before);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 17.3**
   * 仅当原商品上架且顺势状态为 2/3 时，offlinedDelta 为 1
   */
  it('offlinedDelta 仅在原商品上架且顺势 status=2/3 时为 1', () => {
    fc.assert(
      fc.property(
        arbProduct(),
        arbShunshiProduct(),
        (existing, sp) => {
          const { offlinedDelta } = computeSyncUpdateData(existing, sp);

          const shouldOffline = (
            sp.status === ShunshiProductStatus.PAUSED ||
            sp.status === ShunshiProductStatus.FORBIDDEN
          );

          if (shouldOffline && existing.online) {
            expect(offlinedDelta).toBe(1);
          } else {
            expect(offlinedDelta).toBe(0);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
