// 格式化工具函数

/**
 * 补零：将数字格式化为两位字符串
 */
function padZero(num: number): string {
  return num < 10 ? '0' + num : String(num);
}

/**
 * 格式化时间为 YYYY-MM-DD HH:mm:ss
 * @param date - Date 对象或时间戳字符串
 */
export function formatTime(date: Date | string | number): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = padZero(d.getMonth() + 1);
  const day = padZero(d.getDate());
  const hour = padZero(d.getHours());
  const minute = padZero(d.getMinutes());
  const second = padZero(d.getSeconds());
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

/**
 * 格式化日期为 YYYY-MM-DD
 * @param date - Date 对象或时间戳字符串
 */
export function formatDate(date: Date | string | number): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = padZero(d.getMonth() + 1);
  const day = padZero(d.getDate());
  return `${year}-${month}-${day}`;
}

/**
 * 金额格式化：保留2位小数
 * 全系统金额（order.amount、pkg.price、faceValue 等）统一以「元」为单位，
 * 此处直接对元值做小数补齐，不再做分→元换算。
 * @param yuan - 金额（单位：元）
 * @returns 格式化后的金额字符串（如 15 → "15.00"，15.9 → "15.90"）
 */
export function formatPrice(yuan: number): string {
  if (typeof yuan !== 'number' || isNaN(yuan)) return '0.00';
  return yuan.toFixed(2);
}

/**
 * 手机号脱敏：11位手机号 → 前3+****+后4
 * 与后端 maskPhone 逻辑一致
 * @param phone - 手机号字符串
 */
export function maskPhone(phone: string): string {
  if (!phone || phone.length !== 11) {
    return phone || '';
  }
  return phone.slice(0, 3) + '****' + phone.slice(7);
}

/**
 * 通用账号脱敏
 * - 11位纯数字（手机号）：走 maskPhone 逻辑
 * - 长度≥5且非11位纯数字：首2位 + 星号（数量=原长度-4）+ 末2位
 * - 长度<5：全部替换为星号
 * 与后端 maskAccount 逻辑一致
 * @param account - 账号字符串
 */
export function maskAccount(account: string): string {
  if (!account) return '';

  // 11位纯数字视为手机号
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

/**
 * 相对时间格式化
 * 刚刚 / X分钟前 / X小时前 / X天前 / 具体日期
 * @param date - Date 对象或时间戳字符串
 */
export function formatRelativeTime(date: Date | string | number): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';

  const now = Date.now();
  const diff = now - d.getTime();

  // 不到1分钟
  if (diff < 60 * 1000) {
    return '刚刚';
  }

  // 不到1小时
  if (diff < 60 * 60 * 1000) {
    const minutes = Math.floor(diff / (60 * 1000));
    return `${minutes}分钟前`;
  }

  // 不到1天
  if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    return `${hours}小时前`;
  }

  // 不到30天
  if (diff < 30 * 24 * 60 * 60 * 1000) {
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    return `${days}天前`;
  }

  // 超过30天展示具体日期
  return formatDate(d);
}
