// 脱敏工具函数

/**
 * 手机号脱敏：11位手机号 → 前3+****+后4
 * 例：13812345678 → 138****5678
 */
export function maskPhone(phone: string): string {
  if (phone.length !== 11) {
    return phone;
  }
  return phone.slice(0, 3) + '****' + phone.slice(7);
}

/**
 * 通用账号脱敏
 * - 11位纯数字（手机号）：走 maskPhone 逻辑
 * - 长度≥5且非11位纯数字：首2位 + 星号（数量=原长度-4）+ 末2位
 * - 长度<5：全部替换为星号
 */
export function maskAccount(account: string): string {
  // 11位纯数字视为手机号，使用手机号脱敏
  if (/^\d{11}$/.test(account)) {
    return maskPhone(account);
  }

  // 长度<5，全部用星号替代
  if (account.length < 5) {
    return '*'.repeat(account.length);
  }

  // 长度≥5：首2位 + 星号 + 末2位
  const starCount = account.length - 4;
  return account.slice(0, 2) + '*'.repeat(starCount) + account.slice(-2);
}

/** 账号类字段名集合：这些字段的值按账号规则脱敏 */
const ACCOUNT_KEYS = ['account', 'phone', 'mobile', 'tel', 'telephone', '充值账号', '账号', '手机号'];

/**
 * 对订单 attach（用户填写的开通参数）做脱敏处理
 * 规则：
 * - 账号类字段（account/phone/mobile 等）的字符串值走 maskAccount（兼容手机号与非手机号账号）
 * - 其余字段中凡是「11位纯数字」的字符串值，按手机号脱敏，避免遗漏
 * - 非字符串值（如地区选择、数组）保持原样
 * 返回新对象，不修改入参
 */
export function maskAttach(attach: Record<string, any> | undefined | null): Record<string, any> {
  if (!attach || typeof attach !== 'object') {
    return {};
  }
  const result: Record<string, any> = {};
  for (const key of Object.keys(attach)) {
    const value = attach[key];
    if (typeof value !== 'string') {
      // 非字符串字段原样保留
      result[key] = value;
      continue;
    }
    if (ACCOUNT_KEYS.includes(key)) {
      // 明确的账号字段：按通用账号脱敏
      result[key] = maskAccount(value);
    } else if (/^\d{11}$/.test(value)) {
      // 防御性脱敏：任意字段中的 11 位手机号
      result[key] = maskPhone(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}
