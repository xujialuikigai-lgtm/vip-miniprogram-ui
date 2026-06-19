import * as fc from 'fast-check';
import { maskPhone, maskAccount } from '../../../cloudfunctions/shared/utils/mask';

/**
 * 脱敏工具属性测试
 * 使用 fast-check 验证脱敏函数在大量随机输入下的正确性
 */

describe('Property 12: 11位手机号脱敏格式', () => {
  /**
   * **Validates: Requirements 15.1, 15.3**
   *
   * 对任意 11 位数字字符串（手机号），maskPhone 结果格式为：
   * 前3位原文 + "****" + 后4位原文，总长度为 11
   */
  it('任意11位数字字符串，脱敏后格式为前3+****+后4，总长度11', () => {
    // 生成器：精确生成11位纯数字字符串
    const phoneArb = fc.stringOf(
      fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'),
      { minLength: 11, maxLength: 11 }
    );

    fc.assert(
      fc.property(phoneArb, (phone) => {
        const masked = maskPhone(phone);

        // 总长度为 11
        expect(masked.length).toBe(11);

        // 前3位与原文相同
        expect(masked.slice(0, 3)).toBe(phone.slice(0, 3));

        // 中间4位为星号
        expect(masked.slice(3, 7)).toBe('****');

        // 后4位与原文相同
        expect(masked.slice(7)).toBe(phone.slice(7));
      }),
      { numRuns: 200 }
    );
  });

  it('脱敏结果不包含完整原始手机号', () => {
    const phoneArb = fc.stringOf(
      fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'),
      { minLength: 11, maxLength: 11 }
    );

    fc.assert(
      fc.property(phoneArb, (phone) => {
        const masked = maskPhone(phone);
        // 脱敏后结果不应与原始手机号相同（除非手机号中间4位恰好全是 *，但纯数字不可能）
        expect(masked).not.toBe(phone);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property 13: 非手机号格式脱敏规则', () => {
  /**
   * **Validates: Requirements 15.5**
   *
   * 对非11位纯数字字符串，maskAccount 满足：
   * - 长度≥5 → 首2位原文 + 星号（数量=原长度-4）+ 末2位原文
   * - 长度<5 → 全部替换为星号
   */

  it('长度≥5且非11位纯数字：首2+星号(原长度-4个)+末2', () => {
    // 生成长度≥5的字符串，排除恰好为11位纯数字的情况
    const nonPhoneGe5Arb = fc.string({ minLength: 5, maxLength: 50 }).filter((s) => {
      // 排除11位纯数字（那属于手机号脱敏范畴）
      return !/^\d{11}$/.test(s);
    });

    fc.assert(
      fc.property(nonPhoneGe5Arb, (account) => {
        const masked = maskAccount(account);

        // 总长度与原字符串相同
        expect(masked.length).toBe(account.length);

        // 首2位与原文相同
        expect(masked.slice(0, 2)).toBe(account.slice(0, 2));

        // 末2位与原文相同
        expect(masked.slice(-2)).toBe(account.slice(-2));

        // 中间部分全为星号，数量 = 原长度 - 4
        const starCount = account.length - 4;
        const middle = masked.slice(2, 2 + starCount);
        expect(middle).toBe('*'.repeat(starCount));
      }),
      { numRuns: 200 }
    );
  });

  it('长度<5的字符串：全部替换为星号', () => {
    // 生成长度 1~4 的非空字符串
    const shortArb = fc.string({ minLength: 1, maxLength: 4 });

    fc.assert(
      fc.property(shortArb, (account) => {
        const masked = maskAccount(account);

        // 长度与原字符串相同
        expect(masked.length).toBe(account.length);

        // 全部为星号
        expect(masked).toBe('*'.repeat(account.length));
      }),
      { numRuns: 200 }
    );
  });

  it('空字符串脱敏后仍为空字符串', () => {
    const masked = maskAccount('');
    expect(masked).toBe('');
  });

  it('11位纯数字走手机号脱敏逻辑（maskAccount 内部委托）', () => {
    // 验证 maskAccount 对11位纯数字的处理与 maskPhone 一致
    const phoneArb = fc.stringOf(
      fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'),
      { minLength: 11, maxLength: 11 }
    );

    fc.assert(
      fc.property(phoneArb, (phone) => {
        expect(maskAccount(phone)).toBe(maskPhone(phone));
      }),
      { numRuns: 100 }
    );
  });
});
