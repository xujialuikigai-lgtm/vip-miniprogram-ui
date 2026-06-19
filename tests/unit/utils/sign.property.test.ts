/**
 * 签名工具属性测试（Property-Based Testing）
 * 使用 fast-check 验证签名算法的通用正确性属性
 *
 * **Validates: Requirements 5.2, 14.1, 14.2**
 */
import * as fc from 'fast-check';
import { generateSign, verifyCallbackSign, sortObjectKeys } from '../../../cloudfunctions/shared/utils/sign';

describe('签名工具属性测试', () => {
  /**
   * Property 7: 签名生成与验证 Round-Trip
   *
   * 对任意 timestamp/body/apikey，generateSign 生成的签名
   * 能被 verifyCallbackSign 正确验证（构造等价的回调参数做 round-trip）
   *
   * **Validates: Requirements 5.2, 14.1**
   */
  describe('Property 7: 签名生成与验证 Round-Trip', () => {
    it('generateSign 生成的签名应被 verifyCallbackSign 正确验证', () => {
      fc.assert(
        fc.property(
          // 生成任意请求体：key 为非空字符串，value 为字符串或数字
          fc.dictionary(
            fc.string({ minLength: 1, maxLength: 20 }).filter(
              // 排除回调验签中需要移除的保留字段
              (s) => !['sign', 'card_list', 'express_list', 'time'].includes(s)
            ),
            fc.oneof(
              fc.string({ maxLength: 50 }),
              fc.integer({ min: -1000000, max: 1000000 }),
              fc.boolean()
            )
          ),
          // 生成 13 位时间戳字符串
          fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), {
            minLength: 13,
            maxLength: 13
          }),
          // 生成任意 apikey
          fc.string({ minLength: 1, maxLength: 64 }),
          (body, timestamp, apikey) => {
            // 使用 generateSign 生成签名
            const sign = generateSign(timestamp, body, apikey);

            // 构造回调参数：body + sign + time（模拟顺势回调结构）
            const callbackParams = {
              ...body,
              sign,
              time: timestamp
            };

            // verifyCallbackSign 应能正确验证
            expect(verifyCallbackSign(callbackParams, apikey)).toBe(true);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('篡改 body 中任一字段后验签应失败', () => {
      fc.assert(
        fc.property(
          // 至少有一个字段的请求体
          fc.dictionary(
            fc.string({ minLength: 1, maxLength: 10 }).filter(
              (s) => !['sign', 'card_list', 'express_list', 'time'].includes(s)
            ),
            fc.string({ minLength: 1, maxLength: 20 })
          ).filter((obj) => Object.keys(obj).length > 0),
          fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), {
            minLength: 13,
            maxLength: 13
          }),
          fc.string({ minLength: 1, maxLength: 64 }),
          fc.string({ minLength: 1, maxLength: 20 }),
          (body, timestamp, apikey, tamperValue) => {
            const sign = generateSign(timestamp, body, apikey);
            const keys = Object.keys(body);
            // 篡改第一个字段的值
            const tamperedBody = { ...body, [keys[0]]: tamperValue + '_tampered' };

            const callbackParams = {
              ...tamperedBody,
              sign,
              time: timestamp
            };

            // 如果篡改后 body 与原始不同，验签应失败
            const originalSorted = JSON.stringify(sortObjectKeys(body));
            const tamperedSorted = JSON.stringify(sortObjectKeys(tamperedBody));
            if (originalSorted !== tamperedSorted) {
              expect(verifyCallbackSign(callbackParams, apikey)).toBe(false);
            }
          }
        ),
        { numRuns: 200 }
      );
    });

    it('card_list 和 express_list 不影响验签结果', () => {
      fc.assert(
        fc.property(
          fc.dictionary(
            fc.string({ minLength: 1, maxLength: 10 }).filter(
              (s) => !['sign', 'card_list', 'express_list', 'time'].includes(s)
            ),
            fc.oneof(fc.string({ maxLength: 20 }), fc.integer())
          ),
          fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), {
            minLength: 13,
            maxLength: 13
          }),
          fc.string({ minLength: 1, maxLength: 64 }),
          // 任意 card_list
          fc.array(fc.string(), { maxLength: 5 }),
          // 任意 express_list
          fc.array(fc.dictionary(fc.string({ minLength: 1 }), fc.string()), { maxLength: 3 }),
          (body, timestamp, apikey, cardList, expressList) => {
            const sign = generateSign(timestamp, body, apikey);

            // 回调参数中附加 card_list 和 express_list
            const callbackParams = {
              ...body,
              sign,
              time: timestamp,
              card_list: cardList,
              express_list: expressList
            };

            // 验签应仍然通过
            expect(verifyCallbackSign(callbackParams, apikey)).toBe(true);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  /**
   * Property 8: 请求 Header 格式正确性
   *
   * 确保签名算法满足顺势 API 文档的格式要求：
   * - Sign 字段为 40 位小写十六进制字符串（SHA1 输出格式）
   * - Timestamp 为 13 位数字字符串
   * - 签名计算方式为 sha1(timestamp + sortedBodyJson + apikey)
   *
   * **Validates: Requirements 14.2**
   */
  describe('Property 8: 请求 Header 格式正确性', () => {
    it('generateSign 返回值始终为 40 位小写十六进制字符串', () => {
      fc.assert(
        fc.property(
          // 任意请求体
          fc.dictionary(
            fc.string({ minLength: 1, maxLength: 20 }),
            fc.oneof(
              fc.string({ maxLength: 50 }),
              fc.integer(),
              fc.boolean(),
              fc.float({ noNaN: true, noDefaultInfinity: true })
            )
          ),
          // 任意时间戳字符串
          fc.string({ minLength: 1, maxLength: 30 }),
          // 任意 apikey
          fc.string({ minLength: 1, maxLength: 64 }),
          (body, timestamp, apikey) => {
            const sign = generateSign(timestamp, body, apikey);

            // 签名必须为 40 位小写十六进制字符串
            expect(sign).toHaveLength(40);
            expect(sign).toMatch(/^[0-9a-f]{40}$/);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('签名计算结果等于 sha1(timestamp + sortedBodyJson + apikey)', () => {
      // 引入 CryptoJS 直接验证计算逻辑
      const CryptoJS = require('crypto-js');

      fc.assert(
        fc.property(
          fc.dictionary(
            fc.string({ minLength: 1, maxLength: 15 }),
            fc.oneof(fc.string({ maxLength: 30 }), fc.integer())
          ),
          fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), {
            minLength: 13,
            maxLength: 13
          }),
          fc.string({ minLength: 1, maxLength: 32 }),
          (body, timestamp, apikey) => {
            const sign = generateSign(timestamp, body, apikey);

            // 手动计算期望签名：sha1(timestamp + JSON.stringify(sortedBody) + apikey)
            const sortedBody = sortObjectKeys(body);
            const jsonStr = JSON.stringify(sortedBody);
            const raw = timestamp + jsonStr + apikey;
            const expected = CryptoJS.SHA1(raw).toString(CryptoJS.enc.Hex);

            expect(sign).toBe(expected);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('不同 key 顺序的 body 应生成相同的签名（字典序规范化）', () => {
      fc.assert(
        fc.property(
          // 生成两个以上 key 的对象
          fc.array(
            fc.tuple(
              fc.string({ minLength: 1, maxLength: 10 }),
              fc.oneof(fc.string({ maxLength: 20 }), fc.integer())
            ),
            { minLength: 2, maxLength: 8 }
          ),
          fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), {
            minLength: 13,
            maxLength: 13
          }),
          fc.string({ minLength: 1, maxLength: 32 }),
          (entries, timestamp, apikey) => {
            // 构造正序和反序的对象
            const body1: Record<string, any> = {};
            const body2: Record<string, any> = {};
            for (const [k, v] of entries) {
              body1[k] = v;
            }
            // 反序插入
            for (const [k, v] of [...entries].reverse()) {
              body2[k] = v;
            }

            const sign1 = generateSign(timestamp, body1, apikey);
            const sign2 = generateSign(timestamp, body2, apikey);

            // key 顺序不同但内容相同，签名应相等
            expect(sign1).toBe(sign2);
          }
        ),
        { numRuns: 200 }
      );
    });
  });
});
