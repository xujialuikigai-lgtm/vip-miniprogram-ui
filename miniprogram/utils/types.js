// 前端全局类型定义
/** 订单状态枚举 */
export var OrderStatus;
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
})(OrderStatus || (OrderStatus = {}));
/** 页面加载状态 */
export var PageState;
(function (PageState) {
    /** 加载中 */
    PageState["LOADING"] = "loading";
    /** 加载成功 */
    PageState["SUCCESS"] = "success";
    /** 加载失败 */
    PageState["ERROR"] = "error";
    /** 空数据 */
    PageState["EMPTY"] = "empty";
})(PageState || (PageState = {}));
