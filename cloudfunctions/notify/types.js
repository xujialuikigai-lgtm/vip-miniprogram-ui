"use strict";
// 通知云函数相关类型定义
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotifyType = void 0;
/**
 * 通知业务类型
 * - 与三类订单状态变更一一对应，用于选择对应的订阅消息模板
 */
var NotifyType;
(function (NotifyType) {
    /** 开通成功通知 */
    NotifyType["ACTIVATION_SUCCESS"] = "activation_success";
    /** 开通失败通知 */
    NotifyType["ACTIVATION_FAILED"] = "activation_failed";
    /** 退款到账通知 */
    NotifyType["REFUND_SUCCESS"] = "refund_success";
})(NotifyType || (exports.NotifyType = NotifyType = {}));
