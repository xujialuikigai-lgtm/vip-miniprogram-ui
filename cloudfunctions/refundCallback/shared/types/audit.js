"use strict";
// 审计日志相关类型定义
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditType = void 0;
/** 审计操作类型枚举 */
var AuditType;
(function (AuditType) {
    AuditType["ORDER_CREATE"] = "order_create";
    AuditType["ORDER_PAY"] = "order_pay";
    AuditType["SHUNSHI_SUBMIT"] = "shunshi_submit";
    AuditType["SHUNSHI_CALLBACK"] = "shunshi_callback";
    AuditType["STATUS_UPDATE"] = "status_update";
    AuditType["RETRY_ACTIVATION"] = "retry_activation";
    AuditType["REFUND_INITIATE"] = "refund_initiate";
    AuditType["REFUND_SUCCESS"] = "refund_success";
    AuditType["ORDER_CANCEL"] = "order_cancel";
    AuditType["PRODUCT_SYNC"] = "product_sync";
    AuditType["PRODUCT_UPDATE"] = "product_update";
    AuditType["CONFIG_UPDATE"] = "config_update";
    AuditType["ADMIN_LOGIN"] = "admin_login";
})(AuditType || (exports.AuditType = AuditType = {}));
