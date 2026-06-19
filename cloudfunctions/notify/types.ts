// 通知云函数相关类型定义

/** 微信订阅消息单个数据字段（微信要求格式：{ value: string }） */
export interface SubscribeDataField {
  value: string;
}

/** 微信订阅消息 data 结构：key 为模板字段名（如 thing1、time2） */
export type SubscribeData = Record<string, SubscribeDataField>;

/**
 * 通知业务类型
 * - 与三类订单状态变更一一对应，用于选择对应的订阅消息模板
 */
export enum NotifyType {
  /** 开通成功通知 */
  ACTIVATION_SUCCESS = 'activation_success',
  /** 开通失败通知 */
  ACTIVATION_FAILED = 'activation_failed',
  /** 退款到账通知 */
  REFUND_SUCCESS = 'refund_success',
}

/** send 操作入参 */
export interface SendParams {
  /** 接收用户的 openid */
  openid: string;
  /**
   * 通知业务类型，用于按环境变量映射模板ID。
   * 与 templateId 二选一：显式传入 templateId 时优先使用 templateId。
   */
  type?: NotifyType;
  /** 显式指定的模板ID（优先级高于 type 映射），便于扩展 */
  templateId?: string;
  /** 微信订阅消息数据（key 为模板字段名，已由调用方按模板组装） */
  data: SubscribeData;
  /** 关联订单号，用于审计日志追踪 */
  orderId?: string;
  /** 点击通知后跳转的小程序页面路径（可选） */
  page?: string;
  /**
   * 调用方已知的订阅授权状态：
   * - 显式为 false 时直接跳过发送（事前检查）
   * - 省略或为 true 时尝试发送，并依据微信返回码判定授权状态
   */
  subscribed?: boolean;
}

/** send 操作出参 */
export interface SendResult {
  success: boolean;
  /** 是否因未授权/无需发送而跳过 */
  skipped?: boolean;
  errCode?: string;
  errMsg?: string;
}
