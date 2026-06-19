// 审计日志属性测试
// Property 9: 日志不含敏感信息
// Property 11: 审计日志字段完整性
// **Validates: Requirements 13.1, 13.2, 14.4**

import * as fc from 'fast-check';
import { createAuditLog, CreateAuditLogParams } from '../../../cloudfunctions/shared/utils/logger';
import { AuditType } from '../../../cloudfunctions/shared/types/audit';

// ===== 辅助生成器 =====

/** 生成合法的 AuditType 枚举值 */
const auditTypeArb = fc.constantFrom(
  AuditType.ORDER_CREATE,
  AuditType.ORDER_PAY,
  AuditType.SHUNSHI_SUBMIT,
  AuditType.SHUNSHI_CALLBACK,
  AuditType.STATUS_UPDATE,
  AuditType.RETRY_ACTIVATION,
  AuditType.REFUND_INITIATE,
  AuditType.REFUND_SUCCESS,
  AuditType.ORDER_CANCEL,
  AuditType.PRODUCT_SYNC,
  AuditType.PRODUCT_UPDATE,
  AuditType.CONFIG_UPDATE,
  AuditType.ADMIN_LOGIN
);

/** 生成11位大陆手机号 */
const phoneArb = fc.tuple(
  fc.constantFrom('13', '14', '15', '16', '17', '18', '19'),
  fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), { minLength: 9, maxLength: 9 })
).map(([prefix, rest]) => prefix + rest);

/** 生成40位十六进制签名字符串 */
const signatureArb = fc.stringOf(
  fc.constantFrom(
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
    'a', 'b', 'c', 'd', 'e', 'f'
  ),
  { minLength: 40, maxLength: 40 }
);

/** 生成 apikey（非空字符串，长度16-32） */
const apikeyArb = fc.string({ minLength: 16, maxLength: 32 }).filter(s => s.trim().length > 0);

/** 生成合法的 operator（非空字符串） */
const operatorArb = fc.oneof(
  fc.constant('system'),
  fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0)
);

/** 生成合法的 action 描述 */
const actionArb = fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0);

/** 生成 result 值 */
const resultArb = fc.constantFrom<'success' | 'failed'>('success', 'failed');

// ===== Property 9: 日志不含敏感信息 =====

describe('Property 9: 日志不含敏感信息', () => {
  /**
   * **Validates: Requirements 14.4**
   * 
   * 对任意 createAuditLog 入参（含 apikey、签名、手机号等敏感数据），
   * 生成的审计日志对象序列化后不包含原始 apikey、完整签名或未脱敏手机号
   */
  it('日志序列化结果中不应包含原始 apikey', () => {
    fc.assert(
      fc.property(
        apikeyArb,
        auditTypeArb,
        operatorArb,
        actionArb,
        resultArb,
        (apikey, type, operator, action, result) => {
          // 设置环境变量中的 apikey
          process.env.SHUNSHI_API_KEY = apikey;

          try {
            const params: CreateAuditLogParams = {
              type,
              operator,
              action,
              result,
              detail: {
                requestPath: '/api/v1/order/buy',
                usedApikey: apikey,
                description: `使用密钥 ${apikey} 发起请求`,
              },
              note: `操作使用 apikey: ${apikey}`,
            };

            const log = createAuditLog(params);
            const serialized = JSON.stringify(log);

            // 日志序列化后不应包含原始 apikey
            expect(serialized).not.toContain(apikey);
          } finally {
            delete process.env.SHUNSHI_API_KEY;
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('日志序列化结果中不应包含完整的40位签名', () => {
    fc.assert(
      fc.property(
        signatureArb,
        auditTypeArb,
        operatorArb,
        actionArb,
        resultArb,
        (signature, type, operator, action, result) => {
          const params: CreateAuditLogParams = {
            type,
            operator,
            action,
            result,
            detail: {
              sign: signature,
              requestSign: signature,
              nested: { verifySign: signature },
            },
            errorMsg: `签名验证失败: ${signature}`,
          };

          const log = createAuditLog(params);
          const serialized = JSON.stringify(log);

          // 日志序列化后不应包含完整的40位签名
          expect(serialized).not.toContain(signature);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('日志序列化结果中不应包含未脱敏的11位手机号', () => {
    fc.assert(
      fc.property(
        phoneArb,
        auditTypeArb,
        operatorArb,
        actionArb,
        resultArb,
        (phone, type, operator, action, result) => {
          const params: CreateAuditLogParams = {
            type,
            operator,
            action,
            result,
            detail: {
              rechargeAccount: phone,
              userPhone: phone,
              nested: { contact: phone },
            },
            note: `为用户 ${phone} 处理订单`,
            errorMsg: `账号 ${phone} 充值异常`,
          };

          const log = createAuditLog(params);
          const serialized = JSON.stringify(log);

          // 日志序列化后不应包含未脱敏的手机号原文
          expect(serialized).not.toContain(phone);

          // 应包含脱敏后的格式：前3位 + **** + 后4位
          const masked = phone.substring(0, 3) + '****' + phone.substring(7);
          expect(serialized).toContain(masked);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('包含多种敏感信息时应全部脱敏', () => {
    fc.assert(
      fc.property(
        apikeyArb,
        signatureArb,
        phoneArb,
        auditTypeArb,
        operatorArb,
        actionArb,
        resultArb,
        (apikey, signature, phone, type, operator, action, result) => {
          process.env.SHUNSHI_API_KEY = apikey;

          try {
            const params: CreateAuditLogParams = {
              type,
              operator,
              action,
              result,
              detail: {
                apiCall: {
                  sign: signature,
                  account: phone,
                  key: apikey,
                },
              },
              note: `调用接口 sign=${signature} phone=${phone}`,
            };

            const log = createAuditLog(params);
            const serialized = JSON.stringify(log);

            // 所有敏感信息都不应以原始形式出现
            expect(serialized).not.toContain(apikey);
            expect(serialized).not.toContain(signature);
            expect(serialized).not.toContain(phone);
          } finally {
            delete process.env.SHUNSHI_API_KEY;
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ===== Property 11: 审计日志字段完整性 =====

describe('Property 11: 审计日志字段完整性', () => {
  /**
   * **Validates: Requirements 13.1, 13.2**
   * 
   * 对任意合法入参，createAuditLog 返回的对象包含 logId、type、operator、
   * createdAt（ISO 格式）、action、result 等必填字段且非空
   */
  it('返回对象应包含所有必填字段且非空', () => {
    fc.assert(
      fc.property(
        auditTypeArb,
        operatorArb,
        actionArb,
        resultArb,
        fc.option(fc.string({ minLength: 1, maxLength: 30 })),
        fc.option(fc.string({ minLength: 1, maxLength: 30 })),
        (type, operator, action, result, orderId, productId) => {
          const params: CreateAuditLogParams = {
            type,
            operator,
            action,
            result,
            orderId: orderId ?? undefined,
            productId: productId ?? undefined,
          };

          const log = createAuditLog(params);

          // logId 必须存在且非空
          expect(log.logId).toBeDefined();
          expect(log.logId.length).toBeGreaterThan(0);

          // type 必须存在且等于入参
          expect(log.type).toBe(type);
          expect(log.type.length).toBeGreaterThan(0);

          // operator 必须存在且等于入参
          expect(log.operator).toBe(operator);
          expect(log.operator.length).toBeGreaterThan(0);

          // action 必须存在且等于入参
          expect(log.action).toBe(action);
          expect(log.action.length).toBeGreaterThan(0);

          // result 必须存在
          expect(log.result).toBe(result);

          // createdAt 必须存在且非空
          expect(log.createdAt).toBeDefined();
          expect(log.createdAt.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('createdAt 必须为合法的 ISO 8601 格式（毫秒精度）', () => {
    fc.assert(
      fc.property(
        auditTypeArb,
        operatorArb,
        actionArb,
        resultArb,
        (type, operator, action, result) => {
          const params: CreateAuditLogParams = {
            type,
            operator,
            action,
            result,
          };

          const log = createAuditLog(params);

          // ISO 8601 格式验证：YYYY-MM-DDTHH:mm:ss.mmmZ
          const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
          expect(log.createdAt).toMatch(isoRegex);

          // Date 解析后应为有效时间
          const parsed = new Date(log.createdAt);
          expect(parsed.getTime()).not.toBeNaN();

          // 时间应在合理范围内（不超过当前时间+1秒）
          const now = Date.now();
          expect(parsed.getTime()).toBeLessThanOrEqual(now + 1000);
          // 时间不应超过当前时间太久之前（测试执行期间约几秒）
          expect(parsed.getTime()).toBeGreaterThan(now - 10000);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('logId 格式应正确且每次不同', () => {
    fc.assert(
      fc.property(
        auditTypeArb,
        operatorArb,
        actionArb,
        resultArb,
        (type, operator, action, result) => {
          const params: CreateAuditLogParams = {
            type,
            operator,
            action,
            result,
          };

          const log1 = createAuditLog(params);
          const log2 = createAuditLog(params);

          // logId 格式：log_ + base36时间戳 + _ + base36随机数
          expect(log1.logId).toMatch(/^log_[a-z0-9]+_[a-z0-9]+$/);
          expect(log2.logId).toMatch(/^log_[a-z0-9]+_[a-z0-9]+$/);

          // 两次调用生成不同的 logId
          expect(log1.logId).not.toBe(log2.logId);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('operatorName 应正确处理 system 和非 system 操作人', () => {
    fc.assert(
      fc.property(
        auditTypeArb,
        operatorArb,
        actionArb,
        resultArb,
        fc.option(fc.string({ minLength: 1, maxLength: 20 })),
        (type, operator, action, result, customName) => {
          const params: CreateAuditLogParams = {
            type,
            operator,
            action,
            result,
            operatorName: customName ?? undefined,
          };

          const log = createAuditLog(params);

          // operatorName 必须存在（可能为空字符串但必须定义）
          expect(log.operatorName).toBeDefined();

          if (customName) {
            // 提供了自定义名称
            expect(log.operatorName).toBe(customName);
          } else if (operator === 'system') {
            // system 操作人默认名称为"系统"
            expect(log.operatorName).toBe('系统');
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
