// 云函数错误码 → 前端友好文案集中映射
// 错误码与各云函数返回的 errCode 字段保持一致（详见 cloudfunctions/**/*.ts）。
// 集中维护，便于统一调整提示文案与处理策略。
/** 无权限相关错误码（命中后应引导用户离开管理端 / 返回首页） */
export const PERMISSION_ERROR_CODES = [
    'NO_PERMISSION', // openid 不在管理员白名单
    'MISSING_IDENTITY', // 无法获取调用者身份
    'AUTH_SYSTEM_ERROR' // 白名单查询异常，默认拒绝
];
/** 网络层错误码（由 request 封装在超时 / 断网时生成） */
export const NETWORK_ERROR_CODES = [
    'TIMEOUT', // 请求超时
    'REQUEST_TIMEOUT', // 请求超时（内部抛出标识）
    'NETWORK_ERROR' // 断网 / 调用异常
];
/**
 * 错误码 → 友好文案映射表
 * 仅收录需要向用户清晰展示的业务错误码；未命中时回退到云函数下发的 errMsg 或通用文案。
 */
export const ERROR_CODE_MESSAGE = {
    // —— 权限与身份 ——
    NO_PERMISSION: '无权限访问管理端功能',
    MISSING_IDENTITY: '登录状态已失效，请重新进入小程序',
    AUTH_SYSTEM_ERROR: '权限校验失败，请稍后重试',
    UNAUTHORIZED: '登录状态已失效，请重新进入小程序',
    FORBIDDEN: '无权操作该资源',
    // —— 参数与操作 ——
    INVALID_ACTION: '操作不支持，请稍后重试',
    INVALID_PARAM: '请求参数有误，请重试',
    INVALID_PARAMS: '请求参数有误，请重试',
    // —— 订单 ——
    ORDER_NOT_FOUND: '订单不存在或已被删除',
    ORDER_STATUS: '当前订单状态不支持该操作',
    ORDER_STATUS_INVALID: '订单状态异常，无法继续操作',
    ORDER_CREATE_FAILED: '下单失败，请稍后重试',
    QUERY_FAILED: '查询失败，请稍后重试',
    // —— 商品与套餐 ——
    PRODUCT_NOT_FOUND: '商品不存在或已下架',
    PRODUCT_OFFLINE: '该商品已下架，暂不可购买',
    PACKAGE_NOT_FOUND: '套餐不存在，请重新选择',
    PACKAGE_OFFLINE: '该套餐已下架，请重新选择',
    // —— 支付 ——
    PRICE_CHANGED: '套餐价格已变更，请重新选择套餐',
    WXPAY_FAILED: '支付发起失败，请重试',
    // —— 内容页 ——
    INVALID_ARTICLE_KEY: '内容不存在',
    ARTICLE_NOT_FOUND: '内容暂未配置',
    // —— 同步 ——
    SYNC_FAILED: '商品同步失败，请稍后重试',
    // —— 网络层 ——
    TIMEOUT: '请求超时，请重试',
    REQUEST_TIMEOUT: '请求超时，请重试',
    NETWORK_ERROR: '网络异常，请重试'
};
/** 通用兜底文案 */
export const DEFAULT_ERROR_MESSAGE = '操作失败，请重试';
/**
 * 判断是否为无权限类错误码
 * @param errCode - 云函数返回的错误码
 */
export function isPermissionError(errCode) {
    return !!errCode && PERMISSION_ERROR_CODES.indexOf(errCode) !== -1;
}
/**
 * 判断是否为网络层错误码
 * @param errCode - 错误码
 */
export function isNetworkError(errCode) {
    return !!errCode && NETWORK_ERROR_CODES.indexOf(errCode) !== -1;
}
/**
 * 根据错误码获取友好文案
 * 优先级：映射表精确命中 > WXPAY_ 前缀归并 > 云函数下发 errMsg > 通用兜底
 * @param errCode - 错误码
 * @param fallbackMsg - 云函数下发的 errMsg（可选）
 */
export function getFriendlyMessage(errCode, fallbackMsg) {
    if (errCode) {
        // 精确命中映射表
        if (ERROR_CODE_MESSAGE[errCode]) {
            return ERROR_CODE_MESSAGE[errCode];
        }
        // 微信支付错误码统一归并（WXPAY_xxx）
        if (errCode.indexOf('WXPAY_') === 0) {
            return ERROR_CODE_MESSAGE.WXPAY_FAILED;
        }
    }
    // 回退到云函数文案或通用兜底
    return fallbackMsg || DEFAULT_ERROR_MESSAGE;
}
