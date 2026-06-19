"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryPendingOrders = queryPendingOrders;
// 开通中订单超时轮询逻辑
const order_1 = require("./shared/types/order");
const audit_1 = require("./shared/types/audit");
const logger_1 = require("./shared/utils/logger");
const shunshi_1 = require("./shared/utils/shunshi");
const constants_1 = require("./shared/constants");
/** 单次任务最多处理的订单数，避免单次执行超时 */
const BATCH_LIMIT = 100;
/** 系统操作人标识 */
const SYSTEM_OPERATOR = 'system';
/**
 * 将顺势订单状态码映射为本地订单状态
 * status=3 → 开通成功；status=4/5 → 开通失败；其余保持开通中
 * @param shunshiStatus - 顺势返回的状态码
 */
function mapShunshiStatus(shunshiStatus) {
    switch (shunshiStatus) {
        case constants_1.ShunshiOrderStatus.SUCCESS: // 3
            return { status: order_1.OrderStatus.SUCCESS, desc: '开通成功' };
        case constants_1.ShunshiOrderStatus.CANCELLED: // 4
            return { status: order_1.OrderStatus.API_FAILED, desc: '开通失败（订单已取消）' };
        case constants_1.ShunshiOrderStatus.REFUNDED: // 5
            return { status: order_1.OrderStatus.API_FAILED, desc: '开通失败（已退款）' };
        default: // 1 待处理 / 2 处理中
            return { status: order_1.OrderStatus.ACTIVATING, desc: '开通处理中' };
    }
}
/**
 * 判断开通中订单是否已超过轮询阈值（默认10分钟未更新）
 * @param order - 订单记录
 * @param minutes - 超时分钟数
 */
function isActivationTimeout(order, minutes) {
    // 优先以 updatedAt 作为"最近一次状态变化"的依据，缺失时回退到 createdAt
    const baseTime = order.updatedAt || order.createdAt;
    const baseMs = new Date(baseTime).getTime();
    return Date.now() - baseMs > minutes * 60 * 1000;
}
/**
 * 扫描并轮询超时未回调的开通中订单
 *
 * 业务流程（需求 4.8）：
 * 1. 查询 status=activating 的订单（限制单批数量）
 * 2. 过滤出超过 10 分钟未更新的订单
 * 3. 对存在顺势订单号的订单调用 /api/v1/order/info 查询最新状态
 * 4. 状态有变化时更新本地状态并追加时间轴节点
 * 5. 写入审计日志，操作人标记为"系统"
 *
 * @param db - 云数据库实例
 */
async function queryPendingOrders(db) {
    const result = { scanned: 0, queried: 0, updated: 0, failed: 0 };
    // 1. 查询开通中订单
    const orderRes = await db
        .collection('orders')
        .where({ status: order_1.OrderStatus.ACTIVATING })
        .limit(BATCH_LIMIT)
        .get();
    const orders = (orderRes && orderRes.data) || [];
    result.scanned = orders.length;
    // 2. 过滤出超时未更新且有顺势订单号的订单
    const timeoutOrders = orders.filter((order) => !!order.shunshiOrderSn &&
        isActivationTimeout(order, constants_1.ACTIVATION_TIMEOUT_MINUTES));
    const client = (0, shunshi_1.getShunshiClient)();
    // 3. 逐个查询顺势最新状态
    for (const order of timeoutOrders) {
        result.queried += 1;
        let info;
        try {
            info = await client.queryOrder({ ordersn: order.shunshiOrderSn });
        }
        catch (err) {
            result.failed += 1;
            // 查询失败记录审计日志，不中断整体任务
            const failLog = (0, logger_1.createAuditLog)({
                type: audit_1.AuditType.STATUS_UPDATE,
                operator: SYSTEM_OPERATOR,
                operatorName: '系统',
                orderId: order.orderId,
                action: '开通超时轮询（查询失败）',
                result: 'failed',
                errorMsg: err && err.message ? err.message : '顺势接口查询失败'
            });
            await (0, logger_1.writeAuditLog)(db, failLog);
            continue;
        }
        // 4. 映射并判断状态是否变化
        const mapped = mapShunshiStatus(info.status);
        const now = new Date();
        const updateData = {
            shunshiStatus: info.status,
            updatedAt: now
        };
        if (info.recharge_hints) {
            updateData.rechargeHints = info.recharge_hints;
        }
        const statusChanged = mapped.status !== order.status;
        if (statusChanged) {
            const node = {
                status: mapped.status,
                time: now,
                desc: mapped.desc
            };
            updateData.status = mapped.status;
            updateData.timeline = (order.timeline || []).concat([node]);
            // 开通成功记录到账时间
            if (mapped.status === order_1.OrderStatus.SUCCESS) {
                updateData.activatedAt = now;
            }
            // 开通失败记录失败原因（优先使用顺势 recharge_hints）
            if (mapped.status === order_1.OrderStatus.API_FAILED) {
                updateData.failReason = info.recharge_hints || mapped.desc;
            }
        }
        // 5. 写入数据库并记录审计日志
        try {
            await db
                .collection('orders')
                .where({ orderId: order.orderId, status: order_1.OrderStatus.ACTIVATING })
                .update({ data: updateData });
            if (statusChanged) {
                result.updated += 1;
            }
            const log = (0, logger_1.createAuditLog)({
                type: audit_1.AuditType.STATUS_UPDATE,
                operator: SYSTEM_OPERATOR,
                operatorName: '系统',
                orderId: order.orderId,
                action: statusChanged ? '开通超时轮询（状态更新）' : '开通超时轮询（状态未变）',
                detail: { shunshiStatus: info.status, status: mapped.status },
                result: 'success'
            });
            await (0, logger_1.writeAuditLog)(db, log);
        }
        catch (err) {
            result.failed += 1;
            const failLog = (0, logger_1.createAuditLog)({
                type: audit_1.AuditType.STATUS_UPDATE,
                operator: SYSTEM_OPERATOR,
                operatorName: '系统',
                orderId: order.orderId,
                action: '开通超时轮询（更新失败）',
                result: 'failed',
                errorMsg: err && err.message ? err.message : '订单状态更新失败'
            });
            await (0, logger_1.writeAuditLog)(db, failLog);
        }
    }
    return result;
}
