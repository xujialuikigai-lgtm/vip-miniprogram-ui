// 审计日志工具函数

import { AuditLog, AuditType } from '../types/audit';

export interface CreateAuditLogParams {
  type: AuditType;
  operator: string;
  operatorName?: string;
  orderId?: string;
  productId?: string;
  action: string;
  detail?: Record<string, any>;
  result: 'success' | 'failed';
  errorCode?: string;
  errorMsg?: string;
  note?: string;
}

/** 11位手机号正则 */
const PHONE_REGEX = /1[3-9]\d{9}/g;

/** 40位十六进制签名正则 */
const SIGN_REGEX = /[0-9a-f]{40}/gi;

/**
 * 生成唯一日志ID（时间戳 + 随机数）
 */
function generateLogId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `log_${timestamp}_${random}`;
}

/**
 * 对手机号进行脱敏：前3位 + **** + 后4位
 */
function maskPhoneInText(text: string): string {
  return text.replace(PHONE_REGEX, (match) => {
    return match.substring(0, 3) + '****' + match.substring(7);
  });
}

/**
 * 对单个字符串值进行脱敏处理
 * - 移除 apikey 原文（替换为 [REDACTED]）
 * - 移除完整的40位签名值（截断展示）
 * - 对未脱敏的11位手机号进行脱敏
 */
function sanitizeValue(value: string, apikey?: string): string {
  let result = value;

  // 移除 apikey 原文
  if (apikey && apikey.length > 0 && result.includes(apikey)) {
    result = result.replace(new RegExp(escapeRegExp(apikey), 'g'), '[REDACTED]');
  }

  // 对40位完整签名值进行截断脱敏（保留前8位 + ... + 后4位）
  result = result.replace(SIGN_REGEX, (match) => {
    return match.substring(0, 8) + '***' + match.substring(36);
  });

  // 对11位手机号进行脱敏
  result = maskPhoneInText(result);

  return result;
}

/**
 * 转义正则表达式中的特殊字符
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 递归脱敏对象中的所有字符串值
 */
function sanitizeObject(obj: Record<string, any>, apikey?: string): Record<string, any> {
  const result: Record<string, any> = {};

  for (const key of Object.keys(obj)) {
    const value = obj[key];

    // 跳过 key 本身包含 apikey/secret/key 等敏感字段名
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'apikey' || lowerKey === 'api_key' || lowerKey === 'secret') {
      result[key] = '[REDACTED]';
      continue;
    }

    if (typeof value === 'string') {
      result[key] = sanitizeValue(value, apikey);
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = sanitizeObject(value, apikey);
    } else if (Array.isArray(value)) {
      result[key] = value.map(item => {
        if (typeof item === 'string') {
          return sanitizeValue(item, apikey);
        } else if (item !== null && typeof item === 'object') {
          return sanitizeObject(item, apikey);
        }
        return item;
      });
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * 生成审计日志对象
 * 
 * 包含 operator、createdAt（ISO 8601 毫秒精度）、type、action 等必填字段
 * 对 detail 中的敏感信息（apikey、签名、手机号）进行脱敏
 */
export function createAuditLog(params: CreateAuditLogParams): AuditLog {
  const logId = generateLogId();
  const createdAt = new Date().toISOString();

  // 获取环境变量中的 apikey，用于脱敏检测
  const apikey = typeof process !== 'undefined' && process.env
    ? process.env.SHUNSHI_API_KEY
    : undefined;

  // 对 detail 进行脱敏处理
  const sanitizedDetail = params.detail
    ? sanitizeObject(params.detail, apikey)
    : undefined;

  // 对 note 进行脱敏处理
  const sanitizedNote = params.note
    ? sanitizeValue(params.note, apikey)
    : undefined;

  // 对 errorMsg 进行脱敏处理
  const sanitizedErrorMsg = params.errorMsg
    ? sanitizeValue(params.errorMsg, apikey)
    : undefined;

  const log: AuditLog = {
    logId,
    type: params.type,
    operator: params.operator,
    operatorName: params.operatorName || (params.operator === 'system' ? '系统' : ''),
    action: params.action,
    result: params.result,
    createdAt,
  };

  // 可选字段
  if (params.orderId) {
    log.orderId = params.orderId;
  }
  if (params.productId) {
    log.productId = params.productId;
  }
  if (sanitizedDetail) {
    log.detail = sanitizedDetail;
  }
  if (params.errorCode) {
    log.errorCode = params.errorCode;
  }
  if (sanitizedErrorMsg) {
    log.errorMsg = sanitizedErrorMsg;
  }
  if (sanitizedNote) {
    log.note = sanitizedNote;
  }

  return log;
}

/**
 * 写入审计日志到数据库，失败重试1次
 * 
 * 策略：
 * 1. 首次写入失败后重试1次
 * 2. 重试仍失败则将日志内容输出至云函数运行日志（console.error）作为兜底
 */
export async function writeAuditLog(db: any, log: AuditLog): Promise<void> {
  const collection = db.collection('audit_logs');

  try {
    await collection.add({ data: log });
  } catch (firstError) {
    // 第一次写入失败，重试1次
    try {
      await collection.add({ data: log });
    } catch (retryError) {
      // 重试仍失败，输出到云函数日志作为兜底
      console.error('[AuditLog] 写入审计日志失败（已重试），日志内容：', JSON.stringify(log));
      console.error('[AuditLog] 错误信息：', retryError);
    }
  }
}
