// 审计日志相关类型定义

/** 审计操作类型枚举 */
export enum AuditType {
  ORDER_CREATE = 'order_create',
  ORDER_PAY = 'order_pay',
  SHUNSHI_SUBMIT = 'shunshi_submit',
  SHUNSHI_CALLBACK = 'shunshi_callback',
  STATUS_UPDATE = 'status_update',
  RETRY_ACTIVATION = 'retry_activation',
  REFUND_INITIATE = 'refund_initiate',
  REFUND_SUCCESS = 'refund_success',
  ORDER_CANCEL = 'order_cancel',
  PRODUCT_SYNC = 'product_sync',
  PRODUCT_UPDATE = 'product_update',
  CONFIG_UPDATE = 'config_update',
  ADMIN_LOGIN = 'admin_login'
}

/** 审计日志接口 */
export interface AuditLog {
  _id?: string;
  logId: string;
  type: AuditType;
  operator: string;
  operatorName: string;
  orderId?: string;
  productId?: string;
  action: string;
  detail?: Record<string, any>;
  result: 'success' | 'failed';
  errorCode?: string;
  errorMsg?: string;
  note?: string;
  createdAt: string; // ISO 8601 精确到毫秒
}
