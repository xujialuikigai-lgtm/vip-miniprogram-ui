"use strict";
// 管理端审计日志查询接口实现
// 设计依据：Requirements 13.3、13.4
// 出参结构对齐 design.md：{ list, total }
//
// 能力说明：
// - 按时间倒序分页查询，每页最多 50 条（13.3）。
// - 支持按操作类型（type）筛选。
// - 支持按订单号（orderId）查询该订单关联的全部日志（13.4）。
// - 支持按时间范围（startTime / endTime）筛选。
//
// 存储说明：audit_logs.createdAt 以 ISO 8601 字符串（毫秒精度）存储，
// ISO 8601 字符串可直接进行字典序比较与排序，因此时间范围筛选与倒序排序均基于字符串。
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleAuditLogs = handleAuditLogs;
const audit_1 = require("./shared/types/audit");
/** 每页最大条数（需求 13.3：每页最多 50 条） */
const MAX_PAGE_SIZE = 50;
/** 默认每页条数 */
const DEFAULT_PAGE_SIZE = 50;
/**
 * 审计日志查询入口
 *
 * @param db    云数据库实例
 * @param event 调用入参，结构见 AuditLogQuery
 */
async function handleAuditLogs(db, event) {
    const _ = db.command;
    // 归一化分页参数：页码至少为 1，每页条数限制在 [1, 50]
    const page = normalizePage(event && event.page);
    const pageSize = normalizePageSize(event && event.pageSize);
    // 构造筛选条件
    const where = buildWhere(_, event || {});
    const collection = db.collection('audit_logs');
    // 先统计总数，用于前端分页展示
    const countRes = await collection.where(where).count();
    const total = (countRes && typeof countRes.total === 'number' ? countRes.total : 0);
    // 按时间倒序分页拉取
    const res = await collection
        .where(where)
        .orderBy('createdAt', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get();
    const list = (res && Array.isArray(res.data) ? res.data : []);
    return {
        success: true,
        data: { list, total },
    };
}
/* ----------------------------- 工具函数 ----------------------------- */
/**
 * 构造数据库筛选条件
 * 仅当对应参数有效时才加入条件，避免无效筛选
 */
function buildWhere(_, query) {
    const where = {};
    // 按操作类型筛选（需为合法枚举值）
    if (query.type && isValidAuditType(query.type)) {
        where.type = query.type;
    }
    // 按关联订单号筛选
    if (query.orderId && query.orderId.trim() !== '') {
        where.orderId = query.orderId.trim();
    }
    // 按时间范围筛选（createdAt 为 ISO 8601 字符串，可直接比较）
    const start = toIsoString(query.startTime);
    const end = toIsoString(query.endTime);
    if (start && end) {
        where.createdAt = _.gte(start).and(_.lte(end));
    }
    else if (start) {
        where.createdAt = _.gte(start);
    }
    else if (end) {
        where.createdAt = _.lte(end);
    }
    return where;
}
/** 归一化页码：非法值回退为 1 */
function normalizePage(page) {
    const n = Number(page);
    if (!Number.isFinite(n) || n < 1) {
        return 1;
    }
    return Math.floor(n);
}
/** 归一化每页条数：限制在 [1, MAX_PAGE_SIZE]，非法值回退为默认值 */
function normalizePageSize(pageSize) {
    const n = Number(pageSize);
    if (!Number.isFinite(n) || n < 1) {
        return DEFAULT_PAGE_SIZE;
    }
    return Math.min(Math.floor(n), MAX_PAGE_SIZE);
}
/** 判断是否为合法的审计操作类型枚举值 */
function isValidAuditType(type) {
    return Object.values(audit_1.AuditType).includes(type);
}
/**
 * 将时间入参转为 ISO 8601 字符串；无法解析时返回 undefined
 * @param value ISO 字符串、时间戳或可被 Date 解析的值
 */
function toIsoString(value) {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }
    const date = new Date(value);
    if (isNaN(date.getTime())) {
        return undefined;
    }
    return date.toISOString();
}
