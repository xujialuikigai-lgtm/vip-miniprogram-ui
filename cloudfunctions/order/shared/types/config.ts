// 系统配置相关类型定义

/** 系统配置接口 */
export interface SystemConfig {
  _id?: string;
  key: string;
  value: any;
  desc: string;
  updatedAt: Date;
}

/** 预设配置键名 */
export enum ConfigKey {
  HOMEPAGE_ORDER_COUNT = 'homepage_order_count',
  CUSTOMER_SERVICE_QRCODE = 'customer_service_qrcode',
  PURCHASE_NOTICE = 'purchase_notice',
  ACCOUNT_GUIDE = 'account_guide',
  PLATFORM_ANNOUNCEMENT = 'platform_announcement'
}
