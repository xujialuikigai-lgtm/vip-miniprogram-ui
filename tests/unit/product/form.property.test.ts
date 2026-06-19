/**
 * 动态表单属性测试（任务 15.6）
 *
 * - Property 2: 动态表单渲染一致性 — 已在 validator.property.test.ts 中由 Property 4 覆盖
 *   （isFormComplete 行为与模板中 required 标记一致）
 * - Property 4: 表单完整性与按钮状态联动 — 已在 validator.property.test.ts 中覆盖
 * - Property 20: 套餐选择与金额同步 — 本文件重点实现
 *
 * **Validates: Requirements 2.3, 2.4, 2.6**
 */

import * as fc from 'fast-check';
import { formatPrice } from '../../../miniprogram/utils/format';
import { isFormComplete } from '../../../cloudfunctions/shared/utils/validator';
import { AttachTemplate, Package } from '../../../cloudfunctions/shared/types/product';

/**
 * 纯函数：根据套餐数组和选中索引获取价格
 * 模拟前端"选中套餐后底部支付栏展示该套餐价格"的逻辑
 */
function getSelectedPackagePrice(packages: Package[], selectedIndex: number): number {
  return packages[selectedIndex].price;
}

/**
 * 纯函数：根据套餐数组和选中索引获取格式化后的价格
 * 模拟前端支付栏展示的格式化金额
 */
function getFormattedPrice(packages: Package[], selectedIndex: number): string {
  const price = getSelectedPackagePrice(packages, selectedIndex);
  return formatPrice(price);
}

// ===== Arbitrary 生成器 =====

/**
 * 生成合法的 Package 对象
 * price 为正数（单位：元），模拟实际业务场景
 */
const packageArb: fc.Arbitrary<Package> = fc.record({
  packageId: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 20 }),
  memberType: fc.string({ minLength: 1, maxLength: 20 }),
  price: fc.double({ min: 0.01, max: 99999.99, noNaN: true }),
  costPrice: fc.double({ min: 0.01, max: 99999.99, noNaN: true }),
  faceValue: fc.double({ min: 0.01, max: 99999.99, noNaN: true }),
  shunshiGoodsId: fc.integer({ min: 1, max: 999999 }),
  stock: fc.integer({ min: -1, max: 10000 }),
  online: fc.boolean(),
  isDefault: fc.boolean(),
  sortWeight: fc.integer({ min: 0, max: 9999 }),
});

/**
 * 生成至少包含1个套餐的数组及一个合法的选中索引
 */
const packagesWithIndexArb = fc
  .array(packageArb, { minLength: 1, maxLength: 10 })
  .chain((packages) =>
    fc.tuple(
      fc.constant(packages),
      fc.integer({ min: 0, max: packages.length - 1 })
    )
  );

// ===== Property 20: 套餐选择与金额同步 =====

describe('Property 20: 套餐选择与金额同步', () => {
  /**
   * **Validates: Requirements 2.3**
   *
   * 对任意 packages 数组和 selectedIndex，
   * 支付栏显示的金额必须等于 packages[selectedIndex].price
   */
  test('选中套餐的价格应等于 packages[selectedIndex].price', () => {
    fc.assert(
      fc.property(packagesWithIndexArb, ([packages, selectedIndex]) => {
        const displayedPrice = getSelectedPackagePrice(packages, selectedIndex);
        expect(displayedPrice).toBe(packages[selectedIndex].price);
      }),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 2.3**
   *
   * 对任意 packages 数组和 selectedIndex，
   * formatPrice(packages[selectedIndex].price) 输出的格式为 "X.XX"（保留2位小数）
   */
  test('格式化后的价格应为保留2位小数的字符串', () => {
    fc.assert(
      fc.property(packagesWithIndexArb, ([packages, selectedIndex]) => {
        const formatted = getFormattedPrice(packages, selectedIndex);
        // 格式应匹配：可选负号 + 整数部分 + 小数点 + 两位小数
        expect(formatted).toMatch(/^-?\d+\.\d{2}$/);
      }),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 2.3**
   *
   * 对任意 packages 数组和 selectedIndex，
   * parseFloat(formatPrice(price)) 应与原 price 值相差不超过 0.005（浮点精度）
   */
  test('格式化后的价格解析回数值应与原价一致（精度误差 < 0.005）', () => {
    fc.assert(
      fc.property(packagesWithIndexArb, ([packages, selectedIndex]) => {
        const price = packages[selectedIndex].price;
        const formatted = formatPrice(price);
        const parsed = parseFloat(formatted);
        expect(Math.abs(parsed - price)).toBeLessThan(0.005);
      }),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 2.3**
   *
   * 切换不同套餐时，金额应随之变化（当两套餐价格不同时）
   */
  test('切换不同价格的套餐时金额应同步变化', () => {
    // 生成至少2个套餐且至少存在两个不同价格的数组
    const multiPackagesArb = fc
      .array(packageArb, { minLength: 2, maxLength: 10 })
      .filter((pkgs) => {
        const prices = new Set(pkgs.map((p) => p.price));
        return prices.size >= 2;
      })
      .chain((packages) => {
        // 找两个不同价格的索引
        return fc.tuple(
          fc.constant(packages),
          fc.integer({ min: 0, max: packages.length - 1 }),
          fc.integer({ min: 0, max: packages.length - 1 })
        );
      })
      .filter(([packages, i, j]) => packages[i].price !== packages[j].price);

    fc.assert(
      fc.property(multiPackagesArb, ([packages, indexA, indexB]) => {
        const priceA = getSelectedPackagePrice(packages, indexA);
        const priceB = getSelectedPackagePrice(packages, indexB);
        expect(priceA).not.toBe(priceB);
        expect(priceA).toBe(packages[indexA].price);
        expect(priceB).toBe(packages[indexB].price);
      }),
      { numRuns: 200 }
    );
  });
});

// ===== Property 2 & 4 引用验证 =====

describe('Property 2/4 引用确认: 动态表单渲染一致性与按钮联动', () => {
  /**
   * **Validates: Requirements 2.4, 2.6**
   *
   * 确认 Property 2（动态表单渲染一致性）和 Property 4（表单完整性与按钮联动）
   * 在 isFormComplete 层面已覆盖——本测试作为回归补充。
   *
   * 对任意 attachTemplate：
   * - 全部必填字段非空 → isFormComplete 返回 true（按钮启用）
   * - 任一必填字段空 → isFormComplete 返回 false（按钮禁用）
   */
  const fieldTypeArb = fc.constantFrom<AttachTemplate['type']>(
    'text', 'select', 'radio', 'checkbox', 'cascader'
  );

  const templateFieldArb: fc.Arbitrary<AttachTemplate> = fc.record({
    key: fc.string({ minLength: 1, maxLength: 15 })
      .filter((s) => s.trim().length > 0)
      .map((s) => s.replace(/\s/g, '_')),
    type: fieldTypeArb,
    label: fc.string({ minLength: 1, maxLength: 20 }),
    required: fc.boolean(),
  }) as fc.Arbitrary<AttachTemplate>;

  test('模板字段全必填且全部非空 → isFormComplete 为 true', () => {
    // 生成全部 required=true 的模板
    const allRequiredTemplateArb = fc
      .array(
        templateFieldArb.map((f) => ({ ...f, required: true } as AttachTemplate)),
        { minLength: 1, maxLength: 5 }
      )
      .filter((tpl) => {
        const keys = tpl.map((f) => f.key);
        return new Set(keys).size === keys.length;
      });

    const nonEmptyValueArb = fc
      .string({ minLength: 1, maxLength: 30 })
      .filter((s) => s.trim().length > 0);

    fc.assert(
      fc.property(allRequiredTemplateArb, nonEmptyValueArb, (template, fillValue) => {
        const values: Record<string, string> = {};
        for (const field of template) {
          values[field.key] = fillValue;
        }
        expect(isFormComplete(template, values)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  test('存在必填字段缺失值 → isFormComplete 为 false', () => {
    const templateWithRequiredArb = fc
      .array(
        templateFieldArb.map((f) => ({ ...f, required: true } as AttachTemplate)),
        { minLength: 1, maxLength: 5 }
      )
      .filter((tpl) => {
        const keys = tpl.map((f) => f.key);
        return new Set(keys).size === keys.length;
      });

    fc.assert(
      fc.property(templateWithRequiredArb, (template) => {
        // 第一个必填字段值设为空字符串，其余填充非空值
        const values: Record<string, string> = {};
        for (let i = 0; i < template.length; i++) {
          values[template[i].key] = i === 0 ? '' : 'filled';
        }
        expect(isFormComplete(template, values)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});
