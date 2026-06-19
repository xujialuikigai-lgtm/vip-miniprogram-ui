// 共享常量定义

/** 订单超时时间（分钟） */
export const ORDER_TIMEOUT_MINUTES = 30;

/** 开通超时轮询时间（分钟） */
export const ACTIVATION_TIMEOUT_MINUTES = 10;

/** 最大重试次数 */
export const MAX_RETRY_COUNT = 3;

/** 顺势 API 超时时间（毫秒） */
export const SHUNSHI_API_TIMEOUT = 15000;

/** 顺势 API 基础 URL（对接域名，来自商户中心 → 接口管理 提示） */
export const SHUNSHI_BASE_URL = 'https://shop.mxmm666.com';

/** 顺势订单状态码 */
export enum ShunshiOrderStatus {
  /** 待处理 */
  PENDING = 1,
  /** 处理中 */
  PROCESSING = 2,
  /** 交易成功 */
  SUCCESS = 3,
  /** 交易取消 */
  CANCELLED = 4,
  /** 退款 */
  REFUNDED = 5
}

/** 顺势商品状态码 */
export enum ShunshiProductStatus {
  /** 销售中 */
  ON_SALE = 1,
  /** 暂停 */
  PAUSED = 2,
  /** 禁售 */
  FORBIDDEN = 3
}

/** 订单号前缀 */
export const ORDER_ID_PREFIX = 'VIP';

/** 每页默认条数 */
export const DEFAULT_PAGE_SIZE = 20;

/** 播报最大条数 */
export const BROADCAST_MAX_COUNT = 20;

/** 播报最小展示条数 */
export const BROADCAST_MIN_DISPLAY = 5;

/** 商品名称最大长度 */
export const PRODUCT_NAME_MAX_LENGTH = 30;

/** 备注最大长度 */
export const NOTE_MAX_LENGTH = 200;

/**
 * 判断当前是否为 Mock 模式（开发调试用）
 * 设置云函数环境变量 MOCK_PAYMENT=true 即可跳过真实微信支付与顺势 API
 */
export function isMockMode(): boolean {
  return process.env.MOCK_PAYMENT === 'true';
}
