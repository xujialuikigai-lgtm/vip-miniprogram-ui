"use strict";
// 订单相关类型定义
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrderStatus = void 0;
/** 订单状态枚举 */
var OrderStatus;
(function (OrderStatus) {
    /** 待支付 */
    OrderStatus["PENDING_PAY"] = "pending_pay";
    /** 已支付 */
    OrderStatus["PAID"] = "paid";
    /** 开通中 */
    OrderStatus["ACTIVATING"] = "activating";
    /** 开通成功 */
    OrderStatus["SUCCESS"] = "success";
    /** 接口失败 */
    OrderStatus["API_FAILED"] = "api_failed";
    /** 退款中 */
    OrderStatus["REFUNDING"] = "refunding";
    /** 已退款 */
    OrderStatus["REFUNDED"] = "refunded";
    /** 已取消 */
    OrderStatus["CANCELLED"] = "cancelled";
})(OrderStatus || (exports.OrderStatus = OrderStatus = {}));
