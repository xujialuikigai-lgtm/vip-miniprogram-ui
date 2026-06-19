import { maskPhone, maskAccount } from '../../../cloudfunctions/shared/utils/mask';

describe('maskPhone - 手机号脱敏', () => {
  it('标准11位手机号脱敏为前3+****+后4', () => {
    expect(maskPhone('13812345678')).toBe('138****5678');
  });

  it('另一个手机号脱敏', () => {
    expect(maskPhone('15900001111')).toBe('159****1111');
  });

  it('非11位字符串原样返回', () => {
    expect(maskPhone('1381234')).toBe('1381234');
    expect(maskPhone('138123456789')).toBe('138123456789');
  });

  it('空字符串原样返回', () => {
    expect(maskPhone('')).toBe('');
  });
});

describe('maskAccount - 通用账号脱敏', () => {
  it('11位纯数字走手机号脱敏逻辑', () => {
    expect(maskAccount('13812345678')).toBe('138****5678');
  });

  it('长度≥5且非11位纯数字：首2+星号+末2', () => {
    expect(maskAccount('abcdefgh')).toBe('ab****gh'); // 8位，4个星号
    expect(maskAccount('hello')).toBe('he*lo'); // 5位，1个星号
    expect(maskAccount('test@email.com')).toBe('te**********om'); // 14位，10个星号
  });

  it('长度<5：全部替换为星号', () => {
    expect(maskAccount('abcd')).toBe('****');
    expect(maskAccount('abc')).toBe('***');
    expect(maskAccount('ab')).toBe('**');
    expect(maskAccount('a')).toBe('*');
  });

  it('空字符串返回空字符串', () => {
    expect(maskAccount('')).toBe('');
  });

  it('12位纯数字不视为手机号，走通用规则', () => {
    expect(maskAccount('123456789012')).toBe('12********12');
  });

  it('10位纯数字不视为手机号，走通用规则', () => {
    expect(maskAccount('1234567890')).toBe('12******90');
  });
});
