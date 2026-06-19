/**
 * 校验工具属性测试
 * 使用 fast-check 验证 isValidPhone 和 isFormComplete 的通用正确性属性
 *
 * **Validates: Requirements 2.5, 2.6, 16.5**
 */

import * as fc from 'fast-check';
import { isValidPhone, isFormComplete } from '../../../cloudfunctions/shared/utils/validator';
import { AttachTemplate } from '../../../cloudfunctions/shared/types/product';

describe('Property 3: 手机号格式校验正确性', () => {
  /**
   * **Validates: Requirements 2.5, 16.5**
   *
   * 对任意 1[3-9] 开头的 11 位数字串，isValidPhone 返回 true
   */
  test('任意合法格式手机号（1[3-9]开头 + 9位数字）应返回 true', () => {
    // 生成合法手机号：第一位固定1，第二位3-9，后9位任意数字
    const validPhoneArb = fc.tuple(
      fc.integer({ min: 3, max: 9 }),
      fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 9, maxLength: 9 })
    ).map(([second, rest]) => '1' + second.toString() + rest.join(''));

    fc.assert(
      fc.property(validPhoneArb, (phone) => {
        expect(isValidPhone(phone)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 2.5, 16.5**
   *
   * 对非 1[3-9]\d{9} 格式的字符串，isValidPhone 返回 false
   */
  test('长度不为11的数字串应返回 false', () => {
    // 生成长度不为11的纯数字字符串
    const nonElevenDigitsArb = fc.stringOf(
      fc.integer({ min: 0, max: 9 }).map(n => n.toString())
    ).filter(s => s.length !== 11 && s.length > 0);

    fc.assert(
      fc.property(nonElevenDigitsArb, (str) => {
        expect(isValidPhone(str)).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  test('第二位为0/1/2的11位数字串应返回 false', () => {
    // 第一位1，第二位0-2，后9位任意数字
    const invalidSecondDigitArb = fc.tuple(
      fc.integer({ min: 0, max: 2 }),
      fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 9, maxLength: 9 })
    ).map(([second, rest]) => '1' + second.toString() + rest.join(''));

    fc.assert(
      fc.property(invalidSecondDigitArb, (phone) => {
        expect(isValidPhone(phone)).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  test('不以1开头的11位数字串应返回 false', () => {
    // 第一位2-9，后10位任意数字
    const notStartWithOneArb = fc.tuple(
      fc.integer({ min: 2, max: 9 }),
      fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 10, maxLength: 10 })
    ).map(([first, rest]) => first.toString() + rest.join(''));

    fc.assert(
      fc.property(notStartWithOneArb, (str) => {
        expect(isValidPhone(str)).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  test('包含非数字字符的字符串应返回 false', () => {
    // 生成至少包含一个非数字字符的字符串
    const nonDigitArb = fc.string({ minLength: 1, maxLength: 20 })
      .filter(s => /[^0-9]/.test(s));

    fc.assert(
      fc.property(nonDigitArb, (str) => {
        expect(isValidPhone(str)).toBe(false);
      }),
      { numRuns: 200 }
    );
  });
});

describe('Property 4: 表单完整性与按钮状态联动', () => {
  // 生成 AttachTemplate 的 Arbitrary
  const fieldTypeArb = fc.constantFrom<AttachTemplate['type']>(
    'text', 'select', 'radio', 'checkbox', 'cascader'
  );

  const templateFieldArb = fc.record({
    key: fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
    type: fieldTypeArb,
    label: fc.string({ minLength: 1, maxLength: 30 }),
    required: fc.boolean(),
  }).map(field => ({
    ...field,
    // 确保 key 无空格，便于作为 Record 的键
    key: field.key.replace(/\s/g, '_'),
  } as AttachTemplate));

  // 生成非空字符串值（trim 后非空）
  const nonEmptyValueArb = fc.string({ minLength: 1, maxLength: 50 })
    .filter(s => s.trim().length > 0);

  /**
   * **Validates: Requirements 2.6**
   *
   * 当所有必填字段都有非空值时，isFormComplete 返回 true
   */
  test('所有必填字段都有非空值时应返回 true', () => {
    // 生成1-5个字段的模板（至少含1个必填字段）
    const templateArb = fc.array(templateFieldArb, { minLength: 1, maxLength: 5 })
      .filter(tpl => {
        // 确保 key 唯一
        const keys = tpl.map(f => f.key);
        return new Set(keys).size === keys.length;
      });

    fc.assert(
      fc.property(templateArb, nonEmptyValueArb, (template, fillValue) => {
        // 为所有字段（包括必填和非必填）都填上非空值
        const values: Record<string, string> = {};
        for (const field of template) {
          values[field.key] = fillValue;
        }
        expect(isFormComplete(template, values)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 2.6**
   *
   * 当至少一个必填字段为空时，isFormComplete 返回 false
   */
  test('任一必填字段为空时应返回 false', () => {
    // 生成至少包含一个必填字段的模板
    const templateWithRequiredArb = fc.array(templateFieldArb, { minLength: 1, maxLength: 5 })
      .filter(tpl => {
        const keys = tpl.map(f => f.key);
        return new Set(keys).size === keys.length && tpl.some(f => f.required);
      });

    fc.assert(
      fc.property(
        templateWithRequiredArb,
        nonEmptyValueArb,
        (template, fillValue) => {
          // 找出所有必填字段
          const requiredFields = template.filter(f => f.required);
          // 固定选择第一个必填字段设为空（避免 Math.random 导致非确定性）
          const emptyKey = requiredFields[0].key;

          // 填写所有字段，但选中的那个必填字段留空
          const values: Record<string, string> = {};
          for (const field of template) {
            if (field.key === emptyKey) {
              values[field.key] = '';
            } else {
              values[field.key] = fillValue;
            }
          }

          expect(isFormComplete(template, values)).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 2.6**
   *
   * 当必填字段的值为纯空格时，isFormComplete 应返回 false
   */
  test('必填字段值为纯空格时应返回 false', () => {
    const templateWithRequiredArb = fc.array(templateFieldArb, { minLength: 1, maxLength: 5 })
      .filter(tpl => {
        const keys = tpl.map(f => f.key);
        return new Set(keys).size === keys.length && tpl.some(f => f.required);
      });

    // 生成纯空格字符串
    const spacesArb = fc.stringOf(fc.constant(' '), { minLength: 1, maxLength: 10 });

    fc.assert(
      fc.property(
        templateWithRequiredArb,
        spacesArb,
        nonEmptyValueArb,
        (template, spaces, fillValue) => {
          const requiredFields = template.filter(f => f.required);
          // 把第一个必填字段值设为纯空格
          const emptyKey = requiredFields[0].key;

          const values: Record<string, string> = {};
          for (const field of template) {
            if (field.key === emptyKey) {
              values[field.key] = spaces;
            } else {
              values[field.key] = fillValue;
            }
          }

          expect(isFormComplete(template, values)).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 2.6**
   *
   * 没有必填字段的模板，无论 values 如何，isFormComplete 都返回 true
   */
  test('没有必填字段时无论值如何都应返回 true', () => {
    // 生成全部 required=false 的模板
    const optionalOnlyTemplateArb = fc.array(
      templateFieldArb.map(f => ({ ...f, required: false } as AttachTemplate)),
      { minLength: 0, maxLength: 5 }
    ).filter(tpl => {
      const keys = tpl.map(f => f.key);
      return new Set(keys).size === keys.length;
    });

    fc.assert(
      fc.property(
        optionalOnlyTemplateArb,
        fc.dictionary(fc.string(), fc.string()),
        (template, values) => {
          expect(isFormComplete(template, values)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });
});
