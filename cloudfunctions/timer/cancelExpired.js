"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancelExpiredOrders = cancelExpiredOrders;
// 待支付订单超时自动取消逻辑
const order_1 = require("./shared/types/order");
const audit_1 = require("./shared/types/audit");
const logger_1 = require("./shared/utils/logger");
const filter_1 = require("./shared/utils/filter");
const constants_1 = require("./shared/constants");
/** 单次任务最多处理的订单数，避免单次执行超时 */
const BATCH_LIMIT = 100;
/** 系统操作人标识 */
const SYSTEM_OPERATOR = 'system';
/** 取消备注（需求 23.3 固定文案） */
const CANCEL_NOTE = '超时未支付自动取消';
/**
 * 扫描并取消超时未支付订单
 *
 * 业务流程（需求 23.1 / 23.2 / 23.3）：
 * 1. 查询 status=pending_pay 的订单（限制单批数量）
 * 2. 用 isOrderExpired 判断是否超过 30 分钟
 * 3. 超时订单更新为 cancelled，追加时间轴节点并记录 cancelledAt
 * 4. 写入审计日志，操作人标记为"系统"，备注"超时未支付自动取消"
 *
 * @param db - 云数据库实例
 */
async function cancelExpiredOrders(db) {
    const result = { scanned: 0, cancelled: 0, failed: 0 };
    // 1. 查询待支付订单
    const orderRes = await db
        .collection('orders')
        .where({ status: order_1.OrderStatus.PENDING_PAY })
        .limit(BATCH_LIMIT)
        .get();
    const orders = (orderRes && orderRes.data) || [];
    result.scanned = orders.length;
    // 2. 过滤出已超时的订单
    const expiredOrders = orders.filter((order) => (0, filter_1.isOrderExpired)(order, constants_1.ORDER_TIMEOUT_MINUTES));
    // 3. 逐个取消
    for (const order of expiredOrders) {
        const now = new Date();
        const node = {
            status: order_1.OrderStatus.CANCELLED,
            time: now,
            desc: CANCEL_NOTE
        };
        const newTimeline = (order.timeline || []).concat([node]);
        try {
            await db
                .collection('orders')
                .where({ orderId: order.orderId, status: order_1.OrderStatus.PENDING_PAY })
                .update({
                data: {
                    status: order_1.OrderStatus.CANCELLED,
                    timeline: newTimeline,
                    cancelledAt: now,
                    updatedAt: now
                }
            });
            result.cancelled += 1;
            // 4. 写入审计日志（操作人为系统）
            const log = (0, logger_1.createAuditLog)({
                type: audit_1.AuditType.ORDER_CANCEL,
                operator: SYSTEM_OPERATOR,
                operatorName: '系统',
                orderId: order.orderId,
                action: '超时自动取消订单',
                result: 'success',
                note: CANCEL_NOTE
            });
            await (0, logger_1.writeAuditLog)(db, log);
        }
        catch (err) {
            result.failed += 1;
            // 记录失败审计日志，不中断整体任务
            const failLog = (0, logger_1.createAuditLog)({
                type: audit_1.AuditType.ORDER_CANCEL,
                operator: SYSTEM_OPERATOR,
                operatorName: '系统',
                orderId: order.orderId,
                action: '超时自动取消订单（失败）',
                result: 'failed',
                errorMsg: err && err.message ? err.message : '订单取消更新失败',
                note: CANCEL_NOTE
            });
            await (0, logger_1.writeAuditLog)(db, failLog);
        }
    }
    return result;
}
