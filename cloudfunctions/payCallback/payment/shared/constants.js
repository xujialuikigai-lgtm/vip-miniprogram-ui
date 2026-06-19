"use strict";
// 共享常量定义
Object.defineProperty(exports, "__esModule", { value: true });
exports.NOTE_MAX_LENGTH = exports.PRODUCT_NAME_MAX_LENGTH = exports.BROADCAST_MIN_DISPLAY = exports.BROADCAST_MAX_COUNT = exports.DEFAULT_PAGE_SIZE = exports.ORDER_ID_PREFIX = exports.ShunshiProductStatus = exports.ShunshiOrderStatus = exports.SHUNSHI_BASE_URL = exports.SHUNSHI_API_TIMEOUT = exports.MAX_RETRY_COUNT = exports.ACTIVATION_TIMEOUT_MINUTES = exports.ORDER_TIMEOUT_MINUTES = void 0;
exports.isMockMode = isMockMode;
/** 订单超时时间（分钟） */
exports.ORDER_TIMEOUT_MINUTES = 30;
/** 开通超时轮询时间（分钟） */
exports.ACTIVATION_TIMEOUT_MINUTES = 10;
/** 最大重试次数 */
exports.MAX_RETRY_COUNT = 3;
/** 顺势 API 超时时间（毫秒） */
exports.SHUNSHI_API_TIMEOUT = 15000;
/** 顺势 API 基础 URL（对接域名，来自商户中心 → 接口管理 提示） */
exports.SHUNSHI_BASE_URL = 'https://shop.mxmm666.com';
/** 顺势订单状态码 */
var ShunshiOrderStatus;
(function (ShunshiOrderStatus) {
    /** 待处理 */
    ShunshiOrderStatus[ShunshiOrderStatus["PENDING"] = 1] = "PENDING";
    /** 处理中 */
    ShunshiOrderStatus[ShunshiOrderStatus["PROCESSING"] = 2] = "PROCESSING";
    /** 交易成功 */
    ShunshiOrderStatus[ShunshiOrderStatus["SUCCESS"] = 3] = "SUCCESS";
    /** 交易取消 */
    ShunshiOrderStatus[ShunshiOrderStatus["CANCELLED"] = 4] = "CANCELLED";
    /** 退款 */
    ShunshiOrderStatus[ShunshiOrderStatus["REFUNDED"] = 5] = "REFUNDED";
})(ShunshiOrderStatus || (exports.ShunshiOrderStatus = ShunshiOrderStatus = {}));
/** 顺势商品状态码 */
var ShunshiProductStatus;
(function (ShunshiProductStatus) {
    /** 销售中 */
    ShunshiProductStatus[ShunshiProductStatus["ON_SALE"] = 1] = "ON_SALE";
    /** 暂停 */
    ShunshiProductStatus[ShunshiProductStatus["PAUSED"] = 2] = "PAUSED";
    /** 禁售 */
    ShunshiProductStatus[ShunshiProductStatus["FORBIDDEN"] = 3] = "FORBIDDEN";
})(ShunshiProductStatus || (exports.ShunshiProductStatus = ShunshiProductStatus = {}));
/** 订单号前缀 */
exports.ORDER_ID_PREFIX = 'VIP';
/** 每页默认条数 */
exports.DEFAULT_PAGE_SIZE = 20;
/** 播报最大条数 */
exports.BROADCAST_MAX_COUNT = 20;
/** 播报最小展示条数 */
exports.BROADCAST_MIN_DISPLAY = 5;
/** 商品名称最大长度 */
exports.PRODUCT_NAME_MAX_LENGTH = 30;
/** 备注最大长度 */
exports.NOTE_MAX_LENGTH = 200;
/**
 * 判断当前是否为 Mock 模式（开发调试用）
 * 设置云函数环境变量 MOCK_PAYMENT=true 即可跳过真实微信支付与顺势 API
 */
function isMockMode() {
    return process.env.MOCK_PAYMENT === 'true';
}
