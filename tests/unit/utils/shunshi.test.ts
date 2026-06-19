import { EventEmitter } from 'events';
import { SHUNSHI_API_TIMEOUT } from '../../../cloudfunctions/shared/constants';

// 模拟 request 方法返回的对象
let mockReqInstance: EventEmitter & { write: jest.Mock; end: jest.Mock; destroy: jest.Mock };
let capturedOptions: any;
let capturedCallback: ((res: any) => void) | null;

// 模拟 https 模块
jest.mock('https', () => ({
  request: (options: any, callback: (res: any) => void) => {
    capturedOptions = options;
    capturedCallback = callback;
    return mockReqInstance;
  },
}));

// 模拟 http 模块（备用，ShunshiClient 使用 https）
jest.mock('http', () => ({
  request: (options: any, callback: (res: any) => void) => {
    capturedOptions = options;
    capturedCallback = callback;
    return mockReqInstance;
  },
}));

import { ShunshiClient } from '../../../cloudfunctions/shared/utils/shunshi';

/**
 * 创建新的 mock request 实例
 */
function createMockReq() {
  const req = new EventEmitter() as EventEmitter & {
    write: jest.Mock;
    end: jest.Mock;
    destroy: jest.Mock;
  };
  req.write = jest.fn();
  req.end = jest.fn();
  req.destroy = jest.fn();
  return req;
}

/**
 * 模拟成功响应
 */
function simulateResponse(statusCode: number, body: any) {
  const res = new EventEmitter() as EventEmitter & { statusCode: number };
  res.statusCode = statusCode;
  process.nextTick(() => {
    if (capturedCallback) {
      capturedCallback(res);
      process.nextTick(() => {
        res.emit('data', JSON.stringify(body));
        res.emit('end');
      });
    }
  });
}

/**
 * 模拟响应带原始字符串（用于 JSON 解析失败场景）
 */
function simulateRawResponse(statusCode: number, rawData: string) {
  const res = new EventEmitter() as EventEmitter & { statusCode: number };
  res.statusCode = statusCode;
  process.nextTick(() => {
    if (capturedCallback) {
      capturedCallback(res);
      process.nextTick(() => {
        res.emit('data', rawData);
        res.emit('end');
      });
    }
  });
}

describe('ShunshiClient', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    capturedOptions = null;
    capturedCallback = null;
    mockReqInstance = createMockReq();
    process.env = {
      ...originalEnv,
      SHUNSHI_USER_ID: 'test_user_123',
      SHUNSHI_API_KEY: 'test_api_key_456',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('构造函数', () => {
    it('应从环境变量读取 userId 和 apikey', () => {
      const client = new ShunshiClient();
      expect(client).toBeDefined();
    });

    it('环境变量缺失时应给出警告', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      process.env.SHUNSHI_USER_ID = '';
      process.env.SHUNSHI_API_KEY = '';
      new ShunshiClient();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('SHUNSHI_USER_ID 或 SHUNSHI_API_KEY 未设置')
      );
      warnSpy.mockRestore();
    });
  });

  describe('request()', () => {
    it('应发送带正确 Header 的 POST 请求', async () => {
      const client = new ShunshiClient();
      const promise = client.request('/api/v1/test', { key: 'value' });
      simulateResponse(200, { code: 200, msg: 'success', data: { result: 'ok' } });

      await promise;

      expect(capturedOptions.method).toBe('POST');
      expect(capturedOptions.path).toBe('/api/v1/test');
      expect(capturedOptions.headers['Content-Type']).toBe('application/json');
      expect(capturedOptions.headers['UserId']).toBe('test_user_123');
      // Sign 为 40 位小写十六进制
      expect(capturedOptions.headers['Sign']).toMatch(/^[0-9a-f]{40}$/);
      // Timestamp 为 13 位数字字符串
      expect(capturedOptions.headers['Timestamp']).toMatch(/^\d{13}$/);
    });

    it('应设置超时为 SHUNSHI_API_TIMEOUT (15000ms)', async () => {
      const client = new ShunshiClient();
      const promise = client.request('/api/v1/test');
      simulateResponse(200, { code: 200, msg: 'success', data: null });

      await promise;

      expect(capturedOptions.timeout).toBe(SHUNSHI_API_TIMEOUT);
      expect(capturedOptions.timeout).toBe(15000);
    });

    it('应正确返回 API 的 data 字段', async () => {
      const responseData = { list: [{ id: 1 }], total: 1 };
      const client = new ShunshiClient();
      const promise = client.request('/api/v1/goods/list');
      simulateResponse(200, { code: 200, msg: 'success', data: responseData });

      const result = await promise;
      expect(result).toEqual(responseData);
    });

    it('HTTP 状态码非 200 时应抛出错误', async () => {
      const client = new ShunshiClient();
      const promise = client.request('/api/v1/test');
      simulateResponse(500, 'Internal Server Error');

      await expect(promise).rejects.toThrow('HTTP 请求失败');
    });

    it('API 业务错误（code 非 200）时应抛出错误', async () => {
      const client = new ShunshiClient();
      const promise = client.request('/api/v1/test');
      simulateResponse(200, { code: 400, msg: '参数错误', data: null });

      await expect(promise).rejects.toThrow('API 业务错误');
    });

    it('请求超时时应抛出错误并销毁连接', async () => {
      const client = new ShunshiClient();
      const promise = client.request('/api/v1/test');

      // 触发 timeout 事件
      process.nextTick(() => {
        mockReqInstance.emit('timeout');
      });

      await expect(promise).rejects.toThrow('请求超时');
      expect(mockReqInstance.destroy).toHaveBeenCalled();
    });

    it('网络错误时应抛出错误', async () => {
      const client = new ShunshiClient();
      const promise = client.request('/api/v1/test');

      process.nextTick(() => {
        mockReqInstance.emit('error', new Error('ECONNREFUSED'));
      });

      await expect(promise).rejects.toThrow('网络请求错误');
    });

    it('响应 JSON 解析失败时应抛出错误', async () => {
      const client = new ShunshiClient();
      const promise = client.request('/api/v1/test');
      simulateRawResponse(200, 'not valid json{{{');

      await expect(promise).rejects.toThrow('响应解析失败');
    });
  });

  describe('getCategories()', () => {
    it('应调用 /api/v1/goods/cate 并返回分类数组', async () => {
      // 接口 data 直接是分类节点数组
      const categories = [{ id: 1, name: '游戏', pid: 0, img: '' }];
      const client = new ShunshiClient();
      const promise = client.getCategories();
      simulateResponse(200, { code: 200, msg: 'success', data: categories });

      const result = await promise;
      expect(capturedOptions.path).toBe('/api/v1/goods/cate');
      expect(result).toEqual(categories);
    });
  });

  describe('getProductList()', () => {
    it('应调用 /api/v1/goods/list 并传入分页参数（limit）', async () => {
      const products = { list: [], total: 0 };
      const client = new ShunshiClient();
      const promise = client.getProductList({ cate_id: 5, page: 2, limit: 10 });
      simulateResponse(200, { code: 200, msg: 'success', data: products });

      const result = await promise;
      expect(capturedOptions.path).toBe('/api/v1/goods/list');

      // 验证写入的请求体（参数名为 limit）
      const writtenData = JSON.parse(mockReqInstance.write.mock.calls[0][0]);
      expect(writtenData).toEqual({ cate_id: 5, page: 2, limit: 10 });
      expect(result).toEqual(products);
    });

    it('无参数时应发送空 body', async () => {
      const products = { list: [], total: 0 };
      const client = new ShunshiClient();
      const promise = client.getProductList();
      simulateResponse(200, { code: 200, msg: 'success', data: products });

      await promise;
      const writtenData = JSON.parse(mockReqInstance.write.mock.calls[0][0]);
      expect(writtenData).toEqual({});
    });
  });

  describe('submitOrder()', () => {
    it('应调用 /api/v1/order/buy 并包含 safe_price（字符串）', async () => {
      const orderRes = { ordersn: 'SS202401010001', external_orderno: 'VIP20240101001' };
      const client = new ShunshiClient();
      const promise = client.submitOrder({
        id: 100,
        quantity: 1,
        safe_price: 9800,
        external_orderno: 'VIP20240101001',
        attach: { recharge_account: '13800138000' },
      });
      simulateResponse(200, { code: 200, msg: 'success', data: orderRes });

      const result = await promise;
      expect(capturedOptions.path).toBe('/api/v1/order/buy');

      const writtenData = JSON.parse(mockReqInstance.write.mock.calls[0][0]);
      expect(writtenData.id).toBe(100);
      expect(writtenData.quantity).toBe(1);
      // safe_price 发送时转为字符串
      expect(writtenData.safe_price).toBe('9800');
      expect(writtenData.external_orderno).toBe('VIP20240101001');
      expect(writtenData.attach).toEqual({ recharge_account: '13800138000' });
      expect(result).toEqual(orderRes);
    });

    it('应支持 attach 附加字段', async () => {
      const orderRes = { ordersn: 'SS202401010002', external_orderno: 'VIP20240101002' };
      const client = new ShunshiClient();
      const promise = client.submitOrder({
        id: 200,
        quantity: 1,
        safe_price: 5000,
        external_orderno: 'VIP20240101002',
        attach: { server: '电信一区', role: '角色A' },
      });
      simulateResponse(200, { code: 200, msg: 'success', data: orderRes });

      await promise;
      const writtenData = JSON.parse(mockReqInstance.write.mock.calls[0][0]);
      expect(writtenData.attach).toEqual({ server: '电信一区', role: '角色A' });
    });
  });

  describe('queryOrder()', () => {
    it('应调用 /api/v1/order/info 并传入 ordersn（返回数组取首项）', async () => {
      // 接口 data 为数组，queryOrder 取 data[0]
      const orderInfo = { ordersn: 'SS001', external_orderno: 'VIP001', status: 3 };
      const client = new ShunshiClient();
      const promise = client.queryOrder({ ordersn: 'SS001' });
      simulateResponse(200, { code: 200, msg: 'success', data: [orderInfo] });

      const result = await promise;
      expect(capturedOptions.path).toBe('/api/v1/order/info');

      const writtenData = JSON.parse(mockReqInstance.write.mock.calls[0][0]);
      expect(writtenData.ordersn).toBe('SS001');
      expect(result).toEqual(orderInfo);
    });

    it('应支持 external_orderno 查询', async () => {
      const orderInfo = { ordersn: 'SS002', external_orderno: 'VIP20240101001', status: 1 };
      const client = new ShunshiClient();
      const promise = client.queryOrder({ external_orderno: 'VIP20240101001' });
      simulateResponse(200, { code: 200, msg: 'success', data: [orderInfo] });

      await promise;
      const writtenData = JSON.parse(mockReqInstance.write.mock.calls[0][0]);
      expect(writtenData.external_orderno).toBe('VIP20240101001');
    });

    it('查询结果为空数组时返回 status=0 的安全默认对象', async () => {
      const client = new ShunshiClient();
      const promise = client.queryOrder({ ordersn: 'SS_EMPTY' });
      simulateResponse(200, { code: 200, msg: 'success', data: [] });

      const result = await promise;
      expect(result.status).toBe(0);
      expect(result.ordersn).toBe('SS_EMPTY');
    });
  });
});
