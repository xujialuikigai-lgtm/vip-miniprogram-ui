import { sortObjectKeys, generateSign, verifyCallbackSign } from '../../../cloudfunctions/shared/utils/sign';

describe('sortObjectKeys', () => {
  it('应按 ASCII 码升序排列对象 key', () => {
    const input = { b: 2, a: 1, c: 3 };
    const result = sortObjectKeys(input);
    expect(Object.keys(result)).toEqual(['a', 'b', 'c']);
  });

  it('应递归排列嵌套对象的 key', () => {
    const input = { z: { b: 2, a: 1 }, a: 'hello' };
    const result = sortObjectKeys(input);
    expect(Object.keys(result)).toEqual(['a', 'z']);
    expect(Object.keys(result.z)).toEqual(['a', 'b']);
  });

  it('应处理数组中的对象', () => {
    const input = { list: [{ b: 2, a: 1 }, { d: 4, c: 3 }] };
    const result = sortObjectKeys(input);
    expect(Object.keys(result.list[0])).toEqual(['a', 'b']);
    expect(Object.keys(result.list[1])).toEqual(['c', 'd']);
  });

  it('应保持基本类型值不变', () => {
    const input = { num: 42, str: 'test', bool: true, nil: null };
    const result = sortObjectKeys(input);
    expect(result).toEqual({ bool: true, nil: null, num: 42, str: 'test' });
  });

  it('应处理空对象', () => {
    expect(sortObjectKeys({})).toEqual({});
  });

  it('应处理深层嵌套', () => {
    const input = { c: { z: { y: 1, x: 2 }, a: 3 }, b: 'val' };
    const result = sortObjectKeys(input);
    expect(Object.keys(result)).toEqual(['b', 'c']);
    expect(Object.keys(result.c)).toEqual(['a', 'z']);
    expect(Object.keys(result.c.z)).toEqual(['x', 'y']);
  });
});

describe('generateSign', () => {
  it('应生成 40 位小写十六进制字符串', () => {
    const sign = generateSign('1700000000000', { name: 'test' }, 'myapikey');
    expect(sign).toMatch(/^[0-9a-f]{40}$/);
  });

  it('相同输入应生成相同签名', () => {
    const body = { product_id: 123, amount: 100 };
    const sign1 = generateSign('1700000000000', body, 'key123');
    const sign2 = generateSign('1700000000000', body, 'key123');
    expect(sign1).toBe(sign2);
  });

  it('不同 key 顺序的 body 应生成相同签名', () => {
    const body1 = { b: 2, a: 1, c: 3 };
    const body2 = { c: 3, a: 1, b: 2 };
    const sign1 = generateSign('1700000000000', body1, 'key');
    const sign2 = generateSign('1700000000000', body2, 'key');
    expect(sign1).toBe(sign2);
  });

  it('不同 timestamp 应生成不同签名', () => {
    const body = { id: 1 };
    const sign1 = generateSign('1700000000000', body, 'key');
    const sign2 = generateSign('1700000000001', body, 'key');
    expect(sign1).not.toBe(sign2);
  });

  it('不同 apikey 应生成不同签名', () => {
    const body = { id: 1 };
    const sign1 = generateSign('1700000000000', body, 'key1');
    const sign2 = generateSign('1700000000000', body, 'key2');
    expect(sign1).not.toBe(sign2);
  });
});

describe('verifyCallbackSign', () => {
  const apikey = 'test_api_key_123';

  it('应验证正确的回调签名', () => {
    const body = { order_sn: 'SN001', status: 3 };
    const timestamp = '1700000000000';
    const sign = generateSign(timestamp, body, apikey);

    const params = { ...body, sign, time: timestamp };
    expect(verifyCallbackSign(params, apikey)).toBe(true);
  });

  it('应拒绝错误的签名', () => {
    const params = {
      order_sn: 'SN001',
      status: 3,
      sign: 'invalid_sign_value_that_is_40chars_long0',
      time: '1700000000000'
    };
    expect(verifyCallbackSign(params, apikey)).toBe(false);
  });

  it('应移除 card_list 和 express_list 后再验签', () => {
    const body = { order_sn: 'SN001', status: 3 };
    const timestamp = '1700000000000';
    const sign = generateSign(timestamp, body, apikey);

    // 回调参数中包含 card_list 和 express_list
    const params = {
      ...body,
      sign,
      time: timestamp,
      card_list: ['card1', 'card2'],
      express_list: [{ id: 'exp1' }]
    };
    expect(verifyCallbackSign(params, apikey)).toBe(true);
  });

  it('缺少 sign 字段时应返回 false', () => {
    const params = { order_sn: 'SN001', time: '1700000000000' };
    expect(verifyCallbackSign(params, apikey)).toBe(false);
  });

  it('缺少 time 字段时应返回 false', () => {
    const params = { order_sn: 'SN001', sign: 'somesign' };
    expect(verifyCallbackSign(params, apikey)).toBe(false);
  });

  it('篡改参数后签名应验证失败', () => {
    const body = { order_sn: 'SN001', status: 3 };
    const timestamp = '1700000000000';
    const sign = generateSign(timestamp, body, apikey);

    // 篡改 status
    const params = { order_sn: 'SN001', status: 5, sign, time: timestamp };
    expect(verifyCallbackSign(params, apikey)).toBe(false);
  });
});
