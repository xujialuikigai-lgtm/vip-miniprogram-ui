// 订阅消息发送逻辑

import { AuditType } from './shared/types/audit';
import { createAuditLog, writeAuditLog } from './shared/utils/logger';
import { NotifyType, SendParams, SendResult } from './types';

/**
 * 通知业务类型 → 模板ID 环境变量名映射。
 * 模板ID 一律从云函数环境变量读取，不在代码或数据库中硬编码。
 */
const TEMPLATE_ENV_KEYS: Record<NotifyType, string> = {
  [NotifyType.ACTIVATION_SUCCESS]: 'WX_SUBSCRIBE_TPL_ACTIVATION_SUCCESS',
  [NotifyType.ACTIVATION_FAILED]: 'WX_SUBSCRIBE_TPL_ACTIVATION_FAILED',
  [NotifyType.REFUND_SUCCESS]: 'WX_SUBSCRIBE_TPL_REFUND_SUCCESS',
};

/**
 * 微信「用户未授权/拒绝接收」相关错误码集合。
 * 命中这些错误码时视为未授权，按需求跳过发送并记录日志，不算作失败。
 * - 43101: 用户未订阅或已拒绝接收该模板消息
 */
const UNSUBSCRIBED_ERR_CODES = new Set<number>([43101]);

/**
 * 从环境变量解析模板ID。
 * 优先使用显式传入的 templateId，否则按业务类型从环境变量读取。
 */
function resolveTemplateId(params: SendParams): string | undefined {
  if (params.templateId && params.templateId.trim().length > 0) {
    return params.templateId.trim();
  }
  if (params.type) {
    const envKey = TEMPLATE_ENV_KEYS[params.type];
    const value =
      typeof process !== 'undefined' && process.env ? process.env[envKey] : undefined;
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

/**
 * 发送微信订阅消息。
 *
 * 行为约定（对应需求 11.1~11.6）：
 * - 模板ID 从环境变量读取，缺失时记录日志并跳过，不影响订单流转
 * - 调用方显式标记 subscribed=false 时，事前跳过发送并记录日志
 * - 微信返回未授权错误码（43101）时，视为未授权跳过，记录日志
 * - 发送失败时记录失败日志，不重试，返回 success=false（调用方应忽略，不影响订单流转）
 *
 * @param cloudApi  已 init 的 wx-server-sdk 实例（用于 openapi 与 database）
 * @param params    发送参数
 */
export async function send(cloudApi: any, params: SendParams): Promise<SendResult> {
  const db = cloudApi.database();

  // 基础参数校验
  if (!params || !params.openid || !params.data) {
    return { success: false, errCode: 'INVALID_PARAM', errMsg: '缺少 openid 或 data' };
  }

  const templateId = resolveTemplateId(params);
  if (!templateId) {
    // 模板ID 未配置：记录日志并跳过，不影响订单流转
    const log = createAuditLog({
      type: AuditType.STATUS_UPDATE,
      operator: 'system',
      action: '发送订阅消息-跳过(模板未配置)',
      result: 'failed',
      orderId: params.orderId,
      errorCode: 'TEMPLATE_NOT_CONFIGURED',
      errorMsg: `未找到通知类型 ${params.type ?? '-'} 对应的模板ID环境变量`,
    });
    await writeAuditLog(db, log);
    return {
      success: false,
      skipped: true,
      errCode: 'TEMPLATE_NOT_CONFIGURED',
      errMsg: '订阅消息模板未配置',
    };
  }

  // 事前订阅授权检查：调用方明确告知未授权时直接跳过
  if (params.subscribed === false) {
    const log = createAuditLog({
      type: AuditType.STATUS_UPDATE,
      operator: 'system',
      action: '发送订阅消息-跳过(用户未授权)',
      result: 'success',
      orderId: params.orderId,
      detail: { templateId },
    });
    await writeAuditLog(db, log);
    return { success: true, skipped: true, errCode: 'NOT_SUBSCRIBED', errMsg: '用户未授权订阅' };
  }

  // 调用微信订阅消息接口
  try {
    const sendPayload: Record<string, any> = {
      touser: params.openid,
      templateId,
      data: params.data,
    };
    if (params.page) {
      sendPayload.page = params.page;
    }

    const res = await cloudApi.openapi.subscribeMessage.send(sendPayload);
    const errCode: number = res && typeof res.errCode === 'number' ? res.errCode : 0;

    if (errCode === 0) {
      // 发送成功
      const log = createAuditLog({
        type: AuditType.STATUS_UPDATE,
        operator: 'system',
        action: '发送订阅消息-成功',
        result: 'success',
        orderId: params.orderId,
        detail: { templateId, type: params.type },
      });
      await writeAuditLog(db, log);
      return { success: true };
    }

    if (UNSUBSCRIBED_ERR_CODES.has(errCode)) {
      // 用户未授权：跳过，不算失败，不影响订单流转
      const log = createAuditLog({
        type: AuditType.STATUS_UPDATE,
        operator: 'system',
        action: '发送订阅消息-跳过(用户未授权)',
        result: 'success',
        orderId: params.orderId,
        detail: { templateId, wxErrCode: errCode },
      });
      await writeAuditLog(db, log);
      return {
        success: true,
        skipped: true,
        errCode: 'NOT_SUBSCRIBED',
        errMsg: '用户未授权订阅',
      };
    }

    // 其它错误：记录失败日志，不重试
    const log = createAuditLog({
      type: AuditType.STATUS_UPDATE,
      operator: 'system',
      action: '发送订阅消息-失败',
      result: 'failed',
      orderId: params.orderId,
      errorCode: String(errCode),
      errorMsg: res && res.errMsg ? String(res.errMsg) : '订阅消息发送失败',
      detail: { templateId, type: params.type },
    });
    await writeAuditLog(db, log);
    return {
      success: false,
      errCode: String(errCode),
      errMsg: '订阅消息发送失败',
    };
  } catch (error: any) {
    // 接口异常（网络错误、频率限制等）：记录失败日志，不重试，不影响订单流转
    const errMsg = error && error.errMsg ? String(error.errMsg) : String(error);
    const log = createAuditLog({
      type: AuditType.STATUS_UPDATE,
      operator: 'system',
      action: '发送订阅消息-异常',
      result: 'failed',
      orderId: params.orderId,
      errorCode: 'SEND_EXCEPTION',
      errorMsg: errMsg,
      detail: { templateId, type: params.type },
    });
    await writeAuditLog(db, log);
    return { success: false, errCode: 'SEND_EXCEPTION', errMsg: '订阅消息发送异常' };
  }
}
