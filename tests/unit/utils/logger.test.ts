// 审计日志工具函数单元测试

import { createAuditLog, writeAuditLog, CreateAuditLogParams } from '../../../cloudfunctions/shared/utils/logger';
import { AuditType } from '../../../cloudfunctions/shared/types/audit';

describe('createAuditLog', () => {
  it('应包含所有必填字段：operator、createdAt、type、action', () => {
    const params: CreateAuditLogParams = {
      type: AuditType.ORDER_CREATE,
      operator: 'user_openid_123',
      action: '创建订单',
      result: 'success',
    };

    const log = createAuditLog(params);

    expect(log.operator).toBe('user_openid_123');
    expect(log.type).toBe(AuditType.ORDER_CREATE);
    expect(log.action).toBe('创建订单');
    expect(log.createdAt).toBeDefined();
    expect(log.logId).toBeDefined();
    expect(log.result).toBe('success');
  });

  it('createdAt 应为合法的 ISO 8601 格式（毫秒精度）', () => {
    const params: CreateAuditLogParams = {
      type: AuditType.ORDER_PAY,
      operator: 'system',
      action: '支付回调处理',
      result: 'success',
    };

    const log = createAuditLog(params);

    // ISO 8601 格式验证：YYYY-MM-DDTHH:mm:ss.mmmZ
    const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    expect(log.createdAt).toMatch(isoRegex);

    // 确保可以被 Date 解析
    const parsedDate = new Date(log.createdAt);
    expect(parsedDate.getTime()).not.toBeNaN();
  });

  it('logId 应包含时间戳和随机数', () => {
    const params: CreateAuditLogParams = {
      type: AuditType.ADMIN_LOGIN,
      operator: 'admin_openid',
      action: '管理员登录',
      result: 'success',
    };

    const log = createAuditLog(params);

    expect(log.logId).toMatch(/^log_[a-z0-9]+_[a-z0-9]+$/);
  });

  it('每次调用应生成不同的 logId', () => {
    const params: CreateAuditLogParams = {
      type: AuditType.STATUS_UPDATE,
      operator: 'system',
      action: '状态更新',
      result: 'success',
    };

    const log1 = createAuditLog(params);
    const log2 = createAuditLog(params);

    expect(log1.logId).not.toBe(log2.logId);
  });

  it('operator 为 system 时，operatorName 默认为"系统"', () => {
    const params: CreateAuditLogParams = {
      type: AuditType.ORDER_CANCEL,
      operator: 'system',
      action: '超时自动取消',
      result: 'success',
    };

    const log = createAuditLog(params);

    expect(log.operatorName).toBe('系统');
  });

  it('应正确传递可选字段：orderId、productId、errorCode', () => {
    const params: CreateAuditLogParams = {
      type: AuditType.SHUNSHI_SUBMIT,
      operator: 'system',
      action: '提交顺势下单',
      result: 'failed',
      orderId: 'VIP202501010001',
      productId: 'prod_001',
      errorCode: 'NETWORK_TIMEOUT',
      errorMsg: '请求超时',
    };

    const log = createAuditLog(params);

    expect(log.orderId).toBe('VIP202501010001');
    expect(log.productId).toBe('prod_001');
    expect(log.errorCode).toBe('NETWORK_TIMEOUT');
    expect(log.errorMsg).toBe('请求超时');
  });

  describe('日志脱敏', () => {
    beforeEach(() => {
      process.env.SHUNSHI_API_KEY = 'my_secret_api_key_12345';
    });

    afterEach(() => {
      delete process.env.SHUNSHI_API_KEY;
    });

    it('detail 中不应包含 apikey 原文', () => {
      const params: CreateAuditLogParams = {
        type: AuditType.SHUNSHI_SUBMIT,
        operator: 'system',
        action: '提交下单',
        result: 'success',
        detail: {
          requestPath: '/api/v1/order/buy',
          usedKey: 'my_secret_api_key_12345',
          httpStatus: 200,
        },
      };

      const log = createAuditLog(params);

      expect(JSON.stringify(log)).not.toContain('my_secret_api_key_12345');
    });

    it('detail 中不应包含完整的40位签名值', () => {
      const fullSign = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
      const params: CreateAuditLogParams = {
        type: AuditType.SHUNSHI_CALLBACK,
        operator: 'system',
        action: '回调处理',
        result: 'success',
        detail: {
          sign: fullSign,
          httpStatus: 200,
        },
      };

      const log = createAuditLog(params);

      // 不应包含完整的40位签名
      expect(JSON.stringify(log)).not.toContain(fullSign);
    });

    it('detail 中未脱敏的11位手机号应被脱敏', () => {
      const params: CreateAuditLogParams = {
        type: AuditType.ORDER_CREATE,
        operator: 'user_123',
        action: '创建订单',
        result: 'success',
        detail: {
          rechargeAccount: '13812345678',
          productName: '爱奇艺会员月卡',
        },
      };

      const log = createAuditLog(params);

      // 不应包含完整手机号
      expect(JSON.stringify(log)).not.toContain('13812345678');
      // 应包含脱敏后的手机号
      expect(JSON.stringify(log)).toContain('138****5678');
    });

    it('note 中的手机号应被脱敏', () => {
      const params: CreateAuditLogParams = {
        type: AuditType.RETRY_ACTIVATION,
        operator: 'admin_001',
        action: '重试开通',
        result: 'success',
        note: '用户手机号 13912345678 重新开通',
      };

      const log = createAuditLog(params);

      expect(log.note).not.toContain('13912345678');
      expect(log.note).toContain('139****5678');
    });

    it('errorMsg 中的手机号应被脱敏', () => {
      const params: CreateAuditLogParams = {
        type: AuditType.SHUNSHI_SUBMIT,
        operator: 'system',
        action: '提交下单',
        result: 'failed',
        errorMsg: '账号 15012345678 充值失败',
      };

      const log = createAuditLog(params);

      expect(log.errorMsg).not.toContain('15012345678');
      expect(log.errorMsg).toContain('150****5678');
    });

    it('应递归处理 detail 中的嵌套对象', () => {
      const params: CreateAuditLogParams = {
        type: AuditType.SHUNSHI_SUBMIT,
        operator: 'system',
        action: '提交下单',
        result: 'success',
        detail: {
          request: {
            phone: '18612345678',
            nested: {
              key: 'my_secret_api_key_12345',
            },
          },
        },
      };

      const log = createAuditLog(params);

      const logStr = JSON.stringify(log);
      expect(logStr).not.toContain('18612345678');
      expect(logStr).not.toContain('my_secret_api_key_12345');
      expect(logStr).toContain('186****5678');
    });

    it('detail 中 key 为 apikey/secret 的字段应被替换为 [REDACTED]', () => {
      const params: CreateAuditLogParams = {
        type: AuditType.SHUNSHI_SUBMIT,
        operator: 'system',
        action: '接口调用',
        result: 'success',
        detail: {
          apikey: 'some_key_value',
          secret: 'some_secret',
          normalField: '正常数据',
        },
      };

      const log = createAuditLog(params);

      expect(log.detail!['apikey']).toBe('[REDACTED]');
      expect(log.detail!['secret']).toBe('[REDACTED]');
      expect(log.detail!['normalField']).toBe('正常数据');
    });
  });
});

describe('writeAuditLog', () => {
  it('应正常写入数据库', async () => {
    const mockAdd = jest.fn().mockResolvedValue({ _id: 'new_id' });
    const mockCollection = jest.fn().mockReturnValue({ add: mockAdd });
    const mockDb = { collection: mockCollection };

    const log = createAuditLog({
      type: AuditType.ORDER_CREATE,
      operator: 'user_123',
      action: '创建订单',
      result: 'success',
    });

    await writeAuditLog(mockDb, log);

    expect(mockCollection).toHaveBeenCalledWith('audit_logs');
    expect(mockAdd).toHaveBeenCalledWith({ data: log });
    expect(mockAdd).toHaveBeenCalledTimes(1);
  });

  it('首次失败后应重试1次', async () => {
    const mockAdd = jest.fn()
      .mockRejectedValueOnce(new Error('网络错误'))
      .mockResolvedValueOnce({ _id: 'new_id' });
    const mockCollection = jest.fn().mockReturnValue({ add: mockAdd });
    const mockDb = { collection: mockCollection };

    const log = createAuditLog({
      type: AuditType.STATUS_UPDATE,
      operator: 'system',
      action: '状态更新',
      result: 'success',
    });

    await writeAuditLog(mockDb, log);

    expect(mockAdd).toHaveBeenCalledTimes(2);
  });

  it('重试仍失败则输出 console.error', async () => {
    const mockAdd = jest.fn().mockRejectedValue(new Error('持续失败'));
    const mockCollection = jest.fn().mockReturnValue({ add: mockAdd });
    const mockDb = { collection: mockCollection };
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    const log = createAuditLog({
      type: AuditType.REFUND_INITIATE,
      operator: 'admin_001',
      action: '发起退款',
      result: 'success',
    });

    await writeAuditLog(mockDb, log);

    expect(mockAdd).toHaveBeenCalledTimes(2);
    expect(consoleSpy).toHaveBeenCalled();
    // 验证 console.error 输出了日志内容
    expect(consoleSpy.mock.calls[0][0]).toContain('[AuditLog]');

    consoleSpy.mockRestore();
  });

  it('写入失败不应抛出异常（静默处理）', async () => {
    const mockAdd = jest.fn().mockRejectedValue(new Error('数据库不可用'));
    const mockCollection = jest.fn().mockReturnValue({ add: mockAdd });
    const mockDb = { collection: mockCollection };
    jest.spyOn(console, 'error').mockImplementation();

    const log = createAuditLog({
      type: AuditType.PRODUCT_SYNC,
      operator: 'admin_001',
      action: '商品同步',
      result: 'failed',
    });

    // 不应抛出异常
    await expect(writeAuditLog(mockDb, log)).resolves.toBeUndefined();

    jest.restoreAllMocks();
  });
});
