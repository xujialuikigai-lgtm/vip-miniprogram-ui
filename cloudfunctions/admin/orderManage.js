"use strict";
// 管理端订单管理接口实现（任务 14.4）
// 设计依据：Requirements 8.1 - 8.7
//
// 包含以下 action：
// - orderList：管理端订单列表（按状态筛选，可见全部订单含已取消），展示三方单号/成本/预计利润，分页 20 条
// - orderDetail：订单详情（完整手机号、时间轴、操作按钮状态、接口调用日志）
// - retryActivation：重试开通（复用顺势 submitOrder，最多 3 次，safe_price=order.amount）
// - queryShunshi：查询顺势接口状态并更新本地记录
// - initiateRefund：发起退款（复用 payment 模块退款逻辑）
//
// 说明：管理端经入口 requireAdmin 校验，已确认为管理员，故订单详情可返回完整手机号。
Object.defineProperty(exports, "__esModule", { value: true });
exports.ERR_QUERY_FAILED = exports.ERR_INVALID_PARAM = exports.ERR_ORDER_STATUS = exports.ERR_ORDER_NOT_FOUND = void 0;
exports.handleOrderList = handleOrderList;
exports.handleOrderDetail = handleOrderDetail;
exports.handleRetryActivation = handleRetryActivation;
exports.handleQueryShunshi = handleQueryShunshi;
exports.handleInitiateRefund = handleInitiateRefund;
const order_1 = require("./shared/types/order");
const audit_1 = require("./shared/types/audit");
const mask_1 = require("./shared/utils/mask");
const logger_1 = require("./shared/utils/logger");
const shunshi_1 = require("./shared/utils/shunshi");
const constants_1 = require("./shared/constants");
const refund_1 = require("./payment/refund");
/** 订单集合名 */
const ORDERS_COLLECTION = 'orders';
/** 审计日志集合名 */
const AUDIT_LOGS_COLLECTION = 'audit_logs';
/** 北京时间相对 UTC 的偏移（+8 小时，单位毫秒） */
const TZ_OFFSET = 8 * 60 * 60 * 1000;
/** 全部订单状态枚举值集合（用于校验 status 入参合法性） */
const ALL_STATUSES = Object.values(order_1.OrderStatus);
/** 与接口调用相关的审计日志类型（用于订单详情接口日志区展示） */
const INTERFACE_LOG_TYPES = [
    audit_1.AuditType.SHUNSHI_SUBMIT,
    audit_1.AuditType.SHUNSHI_CALLBACK,
    audit_1.AuditType.RETRY_ACTIVATION,
    audit_1.AuditType.STATUS_UPDATE,
];
/** 错误码常量 */
exports.ERR_ORDER_NOT_FOUND = 'ORDER_NOT_FOUND';
exports.ERR_ORDER_STATUS = 'ORDER_STATUS_INVALID';
exports.ERR_INVALID_PARAM = 'INVALID_PARAM';
exports.ERR_QUERY_FAILED = 'SHUNSHI_QUERY_FAILED';
/* =============================== 状态文案 =============================== */
/** 订单状态中文名映射 */
const STATUS_NAME_MAP = {
    [order_1.OrderStatus.PENDING_PAY]: '待支付',
    [order_1.OrderStatus.PAID]: '已支付',
    [order_1.OrderStatus.ACTIVATING]: '开通中',
    [order_1.OrderStatus.SUCCESS]: '开通成功',
    [order_1.OrderStatus.API_FAILED]: '接口失败',
    [order_1.OrderStatus.REFUNDING]: '退款中',
    [order_1.OrderStatus.REFUNDED]: '已退款',
    [order_1.OrderStatus.CANCELLED]: '已取消',
};
/* =============================== orderList =============================== */
/**
 * 管理端订单列表（8.1 / 8.2）
 *
 * - 支持按状态筛选（status 合法时按单一状态过滤，否则返回全部，含已取消订单）
 * - 按下单时间倒序，分页（默认每页 20 条）
 * - 每项展示三方单号、实付、成本、预计利润，账号脱敏
 *
 * @param db    云数据库实例
 * @param event 入参 { status?, page?, pageSize? }
 */
async function handleOrderList(db, event) {
    const page = normalizePage(event && event.page);
    const pageSize = normalizePageSize(event && event.pageSize);
    // 状态筛选：仅当传入合法订单状态时生效，否则查询全部（管理端可见已取消订单）
    const status = event && event.status;
    const where = status && ALL_STATUSES.includes(status) ? { status } : {};
    const collection = db.collection(ORDERS_COLLECTION);
    // 总数与当前页数据
    const countRes = await collection.where(where).count();
    const total = (countRes && countRes.total) || 0;
    const res = await collection
        .where(where)
        .orderBy('createdAt', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get();
    const orders = res && Array.isArray(res.data) ? res.data : [];
    const list = orders.map((o) => {
        const amount = o.amount || 0;
        const costPrice = o.costPrice || 0;
        return {
            orderId: o.orderId,
            productName: o.productName,
            packageName: o.packageName,
            categoryName: o.categoryName,
            status: o.status,
            account: (0, mask_1.maskAccount)(extractAccount(o.attach)),
            shunshiOrderSn: o.shunshiOrderSn || '',
            amount,
            costPrice,
            profit: round2(amount - costPrice),
            createdAt: o.createdAt,
            updatedAt: o.updatedAt,
        };
    });
    return { success: true, data: { list, total } };
}
/* =============================== orderDetail =============================== */
/**
 * 管理端订单详情（8.3 / 8.7）
 *
 * 返回完整手机号（管理端已授权）、状态时间轴、操作按钮状态和接口调用日志。
 *
 * @param db    云数据库实例
 * @param event 入参 { orderId }
 */
async function handleOrderDetail(db, event) {
    const orderId = event && event.orderId ? String(event.orderId).trim() : '';
    if (!orderId) {
        return { success: false, errCode: exports.ERR_INVALID_PARAM, errMsg: '缺少订单号' };
    }
    const order = await findOrder(db, orderId);
    if (!order) {
        return { success: false, errCode: exports.ERR_ORDER_NOT_FOUND, errMsg: '订单不存在' };
    }
    // 时间轴格式化（正序）
    const timeline = (order.timeline || []).map((node) => ({
        status: node.status,
        statusName: STATUS_NAME_MAP[node.status] || node.status,
        time: formatBeijingDateTime(node.time),
        desc: node.desc,
    }));
    // 接口调用日志（从 audit_logs 取该订单相关接口日志，按时间正序）
    const logs = await fetchInterfaceLogs(db, orderId);
    // 操作按钮状态
    const actions = computeActions(order);
    return { success: true, data: { order, timeline, logs, actions } };
}
/* =============================== retryActivation =============================== */
/**
 * 重试开通（8.4 / 8.5）
 *
 * - 仅 开通中 / 接口失败 的订单允许重试
 * - 同一订单最多重试 3 次，超限返回提示且不再调用接口
 * - 重新调用顺势 submitOrder，safe_price = order.amount（防止上游调价亏本）
 * - 每次重试均写入审计日志（含耗时）
 *
 * @param db     云数据库实例
 * @param openid 操作管理员 openid（审计记录用）
 * @param event  入参 { orderId }
 */
async function handleRetryActivation(db, openid, event) {
    const orderId = event && event.orderId ? String(event.orderId).trim() : '';
    if (!orderId) {
        return { success: false, errCode: exports.ERR_INVALID_PARAM, errMsg: '缺少订单号' };
    }
    const order = await findOrder(db, orderId);
    if (!order) {
        return { success: false, errCode: exports.ERR_ORDER_NOT_FOUND, errMsg: '订单不存在' };
    }
    // 状态校验：仅开通中/接口失败可重试
    if (order.status !== order_1.OrderStatus.ACTIVATING && order.status !== order_1.OrderStatus.API_FAILED) {
        return {
            success: false,
            errCode: exports.ERR_ORDER_STATUS,
            errMsg: `当前订单状态（${order.status}）不支持重试开通`,
        };
    }
    // 重试次数上限校验（达到上限禁止再次调用接口）
    const retryCount = order.retryCount || 0;
    if (retryCount >= constants_1.MAX_RETRY_COUNT) {
        return {
            success: true,
            data: { success: false, msg: '已达最大重试次数，请手动处理' },
        };
    }
    const _ = db.command;
    const collection = db.collection(ORDERS_COLLECTION);
    const account = extractAccount(order.attach);
    const nextRetry = retryCount + 1;
    const startedAt = Date.now();
    try {
        const shunshi = (0, shunshi_1.getShunshiClient)();
        // 组装 attach，确保包含充值账号 recharge_account（顺势要求账号放在 attach 内）
        const attach = Object.assign({}, order.attach);
        if (!attach.recharge_account && account) {
            attach.recharge_account = account;
        }
        const result = await shunshi.submitOrder({
            id: order.shunshiGoodsId || 0,
            quantity: 1,
            safe_price: order.amount, // 单位：元，发送时内部转字符串
            attach,
            external_orderno: order.orderId,
        });
        const duration = Date.now() - startedAt;
        // 重试成功：更新为开通中，记录三方单号、累加重试次数、追加时间轴
        const activatingNode = {
            status: order_1.OrderStatus.ACTIVATING,
            time: new Date(),
            desc: `管理员重试开通（第${nextRetry}次），已提交等待到账`,
        };
        await collection.doc(order._id).update({
            data: {
                status: order_1.OrderStatus.ACTIVATING,
                shunshiOrderSn: result.ordersn,
                retryCount: nextRetry,
                failReason: '',
                updatedAt: new Date(),
                timeline: _.push([activatingNode]),
            },
        });
        await safeWriteRetryLog(db, {
            openid,
            orderId,
            retryCount: nextRetry,
            result: 'success',
            duration,
            detail: { requestPath: '/api/v1/order/buy', ordersn: result.ordersn, code: '200' },
        });
        return { success: true, data: { success: true, msg: '已重新提交开通，请稍后查询进度' } };
    }
    catch (err) {
        const duration = Date.now() - startedAt;
        const errMsg = err instanceof Error ? err.message : String(err);
        // 重试失败：更新为接口失败，记录失败原因、累加重试次数、追加时间轴
        const failedNode = {
            status: order_1.OrderStatus.API_FAILED,
            time: new Date(),
            desc: `管理员重试开通（第${nextRetry}次）失败`,
        };
        await collection.doc(order._id).update({
            data: {
                status: order_1.OrderStatus.API_FAILED,
                failReason: errMsg,
                retryCount: nextRetry,
                updatedAt: new Date(),
                timeline: _.push([failedNode]),
            },
        });
        await safeWriteRetryLog(db, {
            openid,
            orderId,
            retryCount: nextRetry,
            result: 'failed',
            duration,
            errorMsg: errMsg,
            detail: { requestPath: '/api/v1/order/buy' },
        });
        return { success: true, data: { success: false, msg: '重试开通失败，请稍后再试或手动处理' } };
    }
}
/* =============================== queryShunshi =============================== */
/**
 * 查询顺势接口状态（8.6）
 *
 * 调用顺势 queryOrder 查询订单最新状态并更新本地记录，返回最新顺势状态码。
 *
 * @param db     云数据库实例
 * @param openid 操作管理员 openid（审计记录用）
 * @param event  入参 { orderId }
 */
async function handleQueryShunshi(db, openid, event) {
    const orderId = event && event.orderId ? String(event.orderId).trim() : '';
    if (!orderId) {
        return { success: false, errCode: exports.ERR_INVALID_PARAM, errMsg: '缺少订单号' };
    }
    const order = await findOrder(db, orderId);
    if (!order) {
        return { success: false, errCode: exports.ERR_ORDER_NOT_FOUND, errMsg: '订单不存在' };
    }
    const startedAt = Date.now();
    let info;
    try {
        const shunshi = (0, shunshi_1.getShunshiClient)();
        info = await shunshi.queryOrder({
            ordersn: order.shunshiOrderSn,
            external_orderno: order.orderId,
        });
    }
    catch (err) {
        const duration = Date.now() - startedAt;
        const errMsg = err instanceof Error ? err.message : String(err);
        await safeWriteQueryLog(db, {
            openid,
            orderId,
            result: 'failed',
            duration,
            errorMsg: errMsg,
        });
        return { success: false, errCode: exports.ERR_QUERY_FAILED, errMsg: '查询接口失败，请稍后重试' };
    }
    const duration = Date.now() - startedAt;
    const _ = db.command;
    // 依据顺势状态映射本地订单状态
    const mappedStatus = mapShunshiStatus(info.status, order.status);
    const updateData = {
        shunshiStatus: info.status,
        updatedAt: new Date(),
    };
    if (info.recharge_hints) {
        updateData.rechargeHints = info.recharge_hints;
    }
    // 状态发生变化时同步更新并追加时间轴
    if (mappedStatus !== order.status) {
        updateData.status = mappedStatus;
        if (mappedStatus === order_1.OrderStatus.SUCCESS) {
            updateData.activatedAt = new Date();
        }
        const node = {
            status: mappedStatus,
            time: new Date(),
            desc: `管理员查询接口，状态更新为「${STATUS_NAME_MAP[mappedStatus] || mappedStatus}」`,
        };
        updateData.timeline = _.push([node]);
    }
    await db.collection(ORDERS_COLLECTION).doc(order._id).update({ data: updateData });
    await safeWriteQueryLog(db, {
        openid,
        orderId,
        result: 'success',
        duration,
        detail: { requestPath: '/api/v1/order/info', shunshiStatus: info.status, code: '200' },
    });
    return {
        success: true,
        data: {
            shunshiStatus: info.status,
            status: mappedStatus,
            rechargeHints: info.recharge_hints,
        },
    };
}
/* =============================== initiateRefund =============================== */
/**
 * 发起退款（8.x，复用 payment 模块退款实现）
 *
 * 校验订单状态（api_failed）、调用微信退款、更新状态为 refunding 并写审计日志。
 * 退款核心逻辑统一收敛在 payment/refund，避免重复实现。
 *
 * @param db     云数据库实例
 * @param openid 操作管理员 openid
 * @param event  入参 { orderId, reason, note? }
 */
async function handleInitiateRefund(db, openid, event) {
    const params = {
        orderId: event && event.orderId,
        reason: event && event.reason,
        note: event && event.note,
    };
    return (0, refund_1.refund)(db, openid, params);
}
/* =============================== 工具函数 =============================== */
/** 查询单个订单（按 orderId） */
async function findOrder(db, orderId) {
    const res = await db.collection(ORDERS_COLLECTION).where({ orderId }).limit(1).get();
    const list = res && Array.isArray(res.data) ? res.data : [];
    return list.length > 0 ? list[0] : null;
}
/**
 * 拉取订单相关接口调用日志（8.7）
 * 仅取接口调用类日志，按时间正序，最多 50 条
 */
async function fetchInterfaceLogs(db, orderId) {
    const _ = db.command;
    const res = await db
        .collection(AUDIT_LOGS_COLLECTION)
        .where({ orderId, type: _.in(INTERFACE_LOG_TYPES) })
        .orderBy('createdAt', 'asc')
        .limit(50)
        .get();
    const logs = res && Array.isArray(res.data) ? res.data : [];
    return logs.map((log) => {
        const detail = log.detail || {};
        // 返回码优先取 detail.code，其次错误码，成功无码时默认 200
        const code = detail.code !== undefined && detail.code !== null
            ? String(detail.code)
            : log.errorCode || (log.result === 'success' ? '200' : '');
        // 耗时优先取 detail.duration / detail.durationMs
        const rawDuration = detail.duration !== undefined ? detail.duration : detail.durationMs;
        const duration = typeof rawDuration === 'number' ? rawDuration : null;
        // 返回描述：失败时拼接错误信息
        const desc = log.result === 'failed' && log.errorMsg ? `${log.action}：${log.errorMsg}` : log.action;
        return {
            time: formatBeijingDateTime(log.createdAt),
            code,
            desc,
            duration,
        };
    });
}
/** 计算订单详情操作按钮状态 */
function computeActions(order) {
    const retryCount = order.retryCount || 0;
    const isRetryable = order.status === order_1.OrderStatus.ACTIVATING || order.status === order_1.OrderStatus.API_FAILED;
    return {
        canRetry: isRetryable && retryCount < constants_1.MAX_RETRY_COUNT,
        retryCount,
        maxRetry: constants_1.MAX_RETRY_COUNT,
        canQuery: isRetryable,
        canRefund: order.status === order_1.OrderStatus.API_FAILED,
    };
}
/**
 * 顺势状态码映射本地订单状态
 * - 3 成功 → success
 * - 4 取消 / 5 退款 → api_failed（交由管理员决定后续退款）
 * - 1 待处理 / 2 处理中 → 维持开通中
 * 其余未知状态保持原状态不变
 */
function mapShunshiStatus(shunshiStatus, current) {
    switch (shunshiStatus) {
        case constants_1.ShunshiOrderStatus.SUCCESS:
            return order_1.OrderStatus.SUCCESS;
        case constants_1.ShunshiOrderStatus.CANCELLED:
        case constants_1.ShunshiOrderStatus.REFUNDED:
            return order_1.OrderStatus.API_FAILED;
        case constants_1.ShunshiOrderStatus.PENDING:
        case constants_1.ShunshiOrderStatus.PROCESSING:
            return order_1.OrderStatus.ACTIVATING;
        default:
            return current;
    }
}
/** 从订单 attach 中提取首个可展示的账号值 */
function extractAccount(attach) {
    if (!attach) {
        return '';
    }
    // 优先匹配常见账号字段
    const candidates = ['recharge_account', 'account', 'phone', 'mobile'];
    for (const key of candidates) {
        const value = attach[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
        if (typeof value === 'number') {
            return String(value);
        }
    }
    // 兜底：取第一个非空字符串值
    for (const key of Object.keys(attach)) {
        const value = attach[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    return '';
}
/** 规范化页码（最小为 1） */
function normalizePage(page) {
    const n = Number(page);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}
/** 规范化每页条数（默认 20，范围 1-100） */
function normalizePageSize(pageSize) {
    const n = Number(pageSize);
    if (!Number.isFinite(n) || n < 1) {
        return constants_1.DEFAULT_PAGE_SIZE;
    }
    return Math.min(Math.floor(n), 100);
}
/** 将时间格式化为北京时间 YYYY-MM-DD HH:mm:ss */
function formatBeijingDateTime(value) {
    if (!value) {
        return '';
    }
    const date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) {
        return '';
    }
    const b = new Date(date.getTime() + TZ_OFFSET);
    const y = b.getUTCFullYear();
    const mo = pad2(b.getUTCMonth() + 1);
    const d = pad2(b.getUTCDate());
    const h = pad2(b.getUTCHours());
    const mi = pad2(b.getUTCMinutes());
    const s = pad2(b.getUTCSeconds());
    return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}
/** 个位数补零 */
function pad2(n) {
    return n < 10 ? `0${n}` : `${n}`;
}
/** 保留2位小数 */
function round2(n) {
    return Math.round(n * 100) / 100;
}
/** 写入重试开通审计日志（写库失败不阻断主流程） */
async function safeWriteRetryLog(db, params) {
    try {
        const log = (0, logger_1.createAuditLog)({
            type: audit_1.AuditType.RETRY_ACTIVATION,
            operator: params.openid,
            orderId: params.orderId,
            action: `重试开通（第${params.retryCount}次）`,
            result: params.result,
            detail: Object.assign(Object.assign({}, (params.detail || {})), { retryCount: params.retryCount, duration: params.duration }),
            errorMsg: params.errorMsg,
        });
        await (0, logger_1.writeAuditLog)(db, log);
    }
    catch (logErr) {
        console.error('[orderManage] 写入重试开通审计日志失败：', logErr);
    }
}
/** 写入查询接口审计日志（写库失败不阻断主流程） */
async function safeWriteQueryLog(db, params) {
    try {
        const log = (0, logger_1.createAuditLog)({
            type: audit_1.AuditType.STATUS_UPDATE,
            operator: params.openid,
            orderId: params.orderId,
            action: '查询顺势接口状态',
            result: params.result,
            detail: Object.assign(Object.assign({}, (params.detail || {})), { duration: params.duration }),
            errorMsg: params.errorMsg,
        });
        await (0, logger_1.writeAuditLog)(db, log);
    }
    catch (logErr) {
        console.error('[orderManage] 写入查询接口审计日志失败：', logErr);
    }
}
