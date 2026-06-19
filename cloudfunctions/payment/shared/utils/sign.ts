// 签名工具函数
import CryptoJS from 'crypto-js';

/**
 * 递归按 ASCII 码升序排列对象的 key
 * 嵌套对象和数组中的对象都会递归处理
 */
export function sortObjectKeys(obj: Record<string, any>): Record<string, any> {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  // 数组：对每个元素递归处理
  if (Array.isArray(obj)) {
    return obj.map((item) =>
      item !== null && typeof item === 'object' ? sortObjectKeys(item) : item
    ) as any;
  }

  // 对象：按 key 的 ASCII 码升序排列
  const sortedKeys = Object.keys(obj).sort();
  const sorted: Record<string, any> = {};
  for (const key of sortedKeys) {
    const value = obj[key];
    if (value !== null && typeof value === 'object') {
      sorted[key] = sortObjectKeys(value);
    } else {
      sorted[key] = value;
    }
  }
  return sorted;
}

/**
 * 生成签名
 * 计算方式: sha1(timestamp + JSON.stringify(按key字典序排列的body) + apikey)
 * @param timestamp - 13位时间戳字符串
 * @param body - 请求体对象
 * @param apikey - API 密钥
 * @returns 40位小写十六进制 SHA1 哈希值
 */
export function generateSign(timestamp: string, body: Record<string, any>, apikey: string): string {
  const sortedBody = sortObjectKeys(body);
  const jsonStr = JSON.stringify(sortedBody);
  const raw = timestamp + jsonStr + apikey;
  return CryptoJS.SHA1(raw).toString(CryptoJS.enc.Hex);
}

/**
 * 验证回调签名
 * 移除 sign、card_list、express_list 字段，用 time 字段作为时间戳计算期望签名并比对
 * @param params - 回调参数对象（包含 sign、time 等字段）
 * @param apikey - API 密钥
 * @returns 签名是否验证通过
 */
export function verifyCallbackSign(params: Record<string, any>, apikey: string): boolean {
  const { sign, card_list, express_list, time, ...rest } = params;

  // 缺少 sign 或 time 字段时验证失败
  if (!sign || !time) {
    return false;
  }

  const sorted = sortObjectKeys(rest);
  const jsonStr = JSON.stringify(sorted);
  const expected = CryptoJS.SHA1(time + jsonStr + apikey).toString(CryptoJS.enc.Hex);
  return expected === sign;
}
