"use strict";
// 管理端数据看板接口实现
// 设计依据：Requirements 10.1 - 10.6
// 出参结构对齐 design.md：{ stats, chart, ranking }，并扩展 todoOrders（10.4）与 auditLogs（10.5）。
//
// 统计口径说明（自然日均以北京时间 UTC+8 计算）：
// - "已支付订单"：已完成支付、进入后续流转的订单（排除待支付 pending_pay 与已取消 cancelled）。
// - 今日：当日 0:00 至当前时刻。
// - 销售额、金额单位均为元（与下单锁定的套餐售价一致）。
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleDashboard = handleDashboard;
const order_1 = require("./shared/types/order");
const mask_1 = require("./shared/utils/mask");
/** 一天的毫秒数 */
const DAY_MS = 24 * 60 * 60 * 1000;
/** 北京时间相对 UTC 的偏移（+8 小时） */
const TZ_OFFSET = 8 * 60 * 60 * 1000;
/** 已支付订单状态集合（已通过支付、进入后续流转） */
const PAID_STATUSES = [
    order_1.OrderStatus.PAID,
    order_1.OrderStatus.ACTIVATING,
    order_1.OrderStatus.SUCCESS,
    order_1.OrderStatus.API_FAILED,
    order_1.OrderStatus.REFUNDING,
    order_1.OrderStatus.REFUNDED,
];
/** 待办订单状态集合（需要管理员关注/处理） */
const TODO_STATUSES = [
    order_1.OrderStatus.ACTIVATING,
    order_1.OrderStatus.API_FAILED,
    order_1.OrderStatus.REFUNDING,
];
/**
 * 数据看板入口
 *
 * @param db    云数据库实例
 * @param event 调用入参，可选 todoStatus 用于筛选待办订单状态（10.4）
 */
async function handleDashboard(db, event) {
    const now = new Date();
    const todayStart = beijingDayStart(now);
    // 近30个自然日起点（含今日，共30天）
    const thirtyDayStart = new Date(todayStart.getTime() - 29 * DAY_MS);
    // 近7个自然日起点（含今日，共7天）
    const sevenDayStart = new Date(todayStart.getTime() - 6 * DAY_MS);
    // 拉取近30天订单，覆盖今日/近7日/近30日的全部聚合统计，减少数据库往返
    const recentOrders = await fetchOrdersSince(db, thirtyDayStart);
    const stats = computeStats(recentOrders, todayStart, now);
    const dailyTrend = computeDailyTrend(recentOrders, todayStart);
    const categoryRatio = computeCategoryRatio(recentOrders);
    const ranking = computeRanking(recentOrders, sevenDayStart);
    // 待办订单与时间无关（可能存在超过30天仍未处理的订单），单独查询
    const todoOrders = await fetchTodoOrders(db, event && event.todoStatus);
    const auditLogs = await fetchRecentAuditLogs(db);
    return {
        success: true,
        data: {
            stats,
            chart: { dailyTrend, categoryRatio },
            ranking,
            todoOrders,
            auditLogs,
        },
    };
}
/* ----------------------------- 统计计算 ----------------------------- */
/**
 * 计算今日核心指标（10.1）
 */
function computeStats(orders, todayStart, now) {
    const todayPaid = orders.filter((o) => isPaidOrder(o) && inRange(toTime(o.createdAt), todayStart.getTime(), now.getTime()));
    const todaySales = round2(todayPaid.reduce((sum, o) => sum + (o.amount || 0), 0));
    const todayOrderCount = todayPaid.length;
    const successCount = todayPaid.filter((o) => o.status === order_1.OrderStatus.SUCCESS).length;
    // 开通成功率 = 开通成功订单数 ÷ 已支付总订单数 × 100%
    const successRate = todayOrderCount > 0 ? round1((successCount / todayOrderCount) * 100) : 0;
    const apiFailedCount = todayPaid.filter((o) => o.status === order_1.OrderStatus.API_FAILED).length;
    return { todaySales, todayOrderCount, successRate, apiFailedCount };
}
/**
 * 计算近7个自然日销售额与订单量趋势（10.2）
 */
function computeDailyTrend(orders, todayStart) {
    const result = [];
    // 从6天前到今日，按自然日逐日统计
    for (let i = 6; i >= 0; i--) {
        const dayStart = new Date(todayStart.getTime() - i * DAY_MS);
        const dayEnd = new Date(dayStart.getTime() + DAY_MS);
        const dayOrders = orders.filter((o) => isPaidOrder(o) && inRange(toTime(o.createdAt), dayStart.getTime(), dayEnd.getTime(), false));
        result.push({
            date: formatBeijingDate(dayStart),
            sales: round2(dayOrders.reduce((sum, o) => sum + (o.amount || 0), 0)),
            count: dayOrders.length,
        });
    }
    return result;
}
/**
 * 计算近30个自然日成功订单的分类占比（10.3）
 */
function computeCategoryRatio(orders) {
    // recentOrders 已限定在近30天范围内，这里仅取开通成功订单
    const successOrders = orders.filter((o) => o.status === order_1.OrderStatus.SUCCESS);
    const total = successOrders.length;
    if (total === 0) {
        return [];
    }
    const countMap = new Map();
    for (const o of successOrders) {
        const name = o.categoryName || '其他';
        countMap.set(name, (countMap.get(name) || 0) + 1);
    }
    const list = [];
    countMap.forEach((count, categoryName) => {
        list.push({ categoryName, count, ratio: round1((count / total) * 100) });
    });
    // 占比从高到低排序
    return list.sort((a, b) => b.count - a.count);
}
/**
 * 计算近7个自然日商品销量排行 Top10（10.6）
 */
function computeRanking(orders, sevenDayStart) {
    const sevenDayOrders = orders.filter((o) => isPaidOrder(o) && toTime(o.createdAt) >= sevenDayStart.getTime());
    const map = new Map();
    for (const o of sevenDayOrders) {
        const existing = map.get(o.productId);
        if (existing) {
            existing.salesCount += 1;
        }
        else {
            map.set(o.productId, {
                productId: o.productId,
                productName: o.productName,
                salesCount: 1,
            });
        }
    }
    return Array.from(map.values())
        .sort((a, b) => b.salesCount - a.salesCount)
        .slice(0, 10);
}
/* ----------------------------- 数据库查询 ----------------------------- */
/**
 * 分页拉取指定时间之后创建的订单（按 createdAt 倒序）
 * 设置防御性上限，避免极端数据量导致云函数超时
 */
async function fetchOrdersSince(db, since) {
    const _ = db.command;
    const pageSize = 100;
    const maxRecords = 5000;
    const all = [];
    let skip = 0;
    while (skip < maxRecords) {
        const res = await db
            .collection('orders')
            .where({ createdAt: _.gte(since) })
            .orderBy('createdAt', 'desc')
            .skip(skip)
            .limit(pageSize)
            .get();
        const batch = (res && Array.isArray(res.data) ? res.data : []);
        all.push(...batch);
        if (batch.length < pageSize) {
            break;
        }
        skip += pageSize;
    }
    return all;
}
/**
 * 查询待办订单列表（10.4）
 * - 默认返回全部待办状态（开通中/接口失败/退款中）
 * - 传入合法 todoStatus 时按单一状态筛选
 * - 最多50条，按创建时间倒序
 */
async function fetchTodoOrders(db, todoStatus) {
    const _ = db.command;
    const statusCond = todoStatus && TODO_STATUSES.includes(todoStatus)
        ? todoStatus
        : _.in(TODO_STATUSES);
    const res = await db
        .collection('orders')
        .where({ status: statusCond })
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();
    const list = (res && Array.isArray(res.data) ? res.data : []);
    return list.map((o) => ({
        orderId: o.orderId,
        productName: o.productName,
        status: o.status,
        // 看板列表展示脱敏账号，避免泄露完整手机号
        account: (0, mask_1.maskAccount)(extractAccount(o.attach)),
        amount: o.amount,
        createdAt: o.createdAt,
    }));
}
/**
 * 查询最近20条审计日志（10.5）
 */
async function fetchRecentAuditLogs(db) {
    const res = await db
        .collection('audit_logs')
        .orderBy('createdAt', 'desc')
        .limit(20)
        .get();
    const list = (res && Array.isArray(res.data) ? res.data : []);
    return list.map((log) => ({
        operatorName: log.operatorName || (log.operator === 'system' ? '系统' : log.operator || ''),
        time: formatBeijingMMDDHHmm(log.createdAt),
        action: log.action || '',
        note: log.note || '',
    }));
}
/* ----------------------------- 工具函数 ----------------------------- */
/** 判断订单是否已支付（进入后续流转） */
function isPaidOrder(order) {
    return PAID_STATUSES.includes(order.status);
}
/** 将订单时间字段统一转为毫秒时间戳（兼容 Date 与字符串存储） */
function toTime(value) {
    if (!value) {
        return 0;
    }
    return value instanceof Date ? value.getTime() : new Date(value).getTime();
}
/**
 * 判断时间戳是否落在 [start, end] 区间
 * @param inclusiveEnd 是否包含右端点（默认 true；按天分桶时传 false 取左闭右开）
 */
function inRange(t, start, end, inclusiveEnd = true) {
    return t >= start && (inclusiveEnd ? t <= end : t < end);
}
/** 从订单 attach 中提取首个可展示的账号值（用于脱敏展示） */
function extractAccount(attach) {
    if (!attach) {
        return '';
    }
    for (const key of Object.keys(attach)) {
        const value = attach[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
        if (typeof value === 'number') {
            return String(value);
        }
    }
    return '';
}
/** 计算某时刻所属北京自然日的 0:00（返回对应的 UTC 时间实例） */
function beijingDayStart(date) {
    // 平移到北京墙上时间后取整到天，再平移回 UTC
    const shifted = date.getTime() + TZ_OFFSET;
    const dayCount = Math.floor(shifted / DAY_MS);
    return new Date(dayCount * DAY_MS - TZ_OFFSET);
}
/** 将时间格式化为北京时间 YYYY-MM-DD */
function formatBeijingDate(date) {
    const b = new Date(date.getTime() + TZ_OFFSET);
    const y = b.getUTCFullYear();
    const m = pad2(b.getUTCMonth() + 1);
    const d = pad2(b.getUTCDate());
    return `${y}-${m}-${d}`;
}
/** 将时间格式化为北京时间 MM-DD HH:mm */
function formatBeijingMMDDHHmm(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) {
        return '';
    }
    const b = new Date(date.getTime() + TZ_OFFSET);
    const mo = pad2(b.getUTCMonth() + 1);
    const d = pad2(b.getUTCDate());
    const h = pad2(b.getUTCHours());
    const mi = pad2(b.getUTCMinutes());
    return `${mo}-${d} ${h}:${mi}`;
}
/** 个位数补零 */
function pad2(n) {
    return n < 10 ? `0${n}` : `${n}`;
}
/** 保留2位小数 */
function round2(n) {
    return Math.round(n * 100) / 100;
}
/** 保留1位小数 */
function round1(n) {
    return Math.round(n * 10) / 10;
}
