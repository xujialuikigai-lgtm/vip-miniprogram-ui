"use strict";
// 管理端权限校验中间件
// 校验调用者 openid 是否在 admin_whitelist 集合中，并提供管理端云函数统一的权限校验入口。
// 设计依据：Requirements 12.3 / 12.4 / 12.5 / 12.6（默认拒绝原则）。
Object.defineProperty(exports, "__esModule", { value: true });
exports.ERR_AUTH_SYSTEM = exports.ERR_MISSING_IDENTITY = exports.ERR_NO_PERMISSION = void 0;
exports.checkAdmin = checkAdmin;
exports.requireAdmin = requireAdmin;
const audit_1 = require("../types/audit");
const logger_1 = require("./logger");
/** 管理员白名单集合名 */
const ADMIN_WHITELIST_COLLECTION = 'admin_whitelist';
/** 无权限错误码：openid 不在白名单中 */
exports.ERR_NO_PERMISSION = 'NO_PERMISSION';
/** 缺少身份信息错误码：无法获取调用者 openid */
exports.ERR_MISSING_IDENTITY = 'MISSING_IDENTITY';
/** 权限校验系统异常错误码：白名单查询失败，默认拒绝 */
exports.ERR_AUTH_SYSTEM = 'AUTH_SYSTEM_ERROR';
/**
 * 校验 openid 是否存在于管理员白名单中（纯成员判断）
 *
 * - 存在返回 true（允许）
 * - 不存在或 openid 为空返回 false（拒绝）
 * - 数据库查询异常时抛出错误，由上层中间件按"默认拒绝"原则处理
 *
 * @param db    云数据库实例（cloud.database()）
 * @param openid 调用者微信 openid
 */
async function checkAdmin(db, openid) {
    // openid 为空直接判定为非管理员
    if (!openid) {
        return false;
    }
    const res = await db
        .collection(ADMIN_WHITELIST_COLLECTION)
        .where({ openid })
        .limit(1)
        .get();
    const list = res && Array.isArray(res.data) ? res.data : [];
    return list.length > 0;
}
/**
 * 管理端云函数统一权限校验入口（中间件）
 *
 * 在每个管理端 action 执行前调用：
 * - openid 缺失：返回 MISSING_IDENTITY 错误并记录审计日志
 * - openid 不在白名单：返回 NO_PERMISSION 错误并记录审计日志
 * - 白名单查询异常：遵循默认拒绝原则返回 AUTH_SYSTEM_ERROR，记录异常审计日志
 * - 校验通过：返回 { allowed: true }
 *
 * @param db      云数据库实例
 * @param openid  调用者微信 openid
 * @param options 可选参数（action 名称等）
 */
async function requireAdmin(db, openid, options = {}) {
    const action = options.action || 'unknown';
    // 1. 缺少身份信息：无法获取 openid，直接拒绝
    if (!openid) {
        await recordAuthLog(db, {
            openid: 'unknown',
            action,
            errorCode: exports.ERR_MISSING_IDENTITY,
            errorMsg: '无法获取调用者身份信息',
        });
        return {
            allowed: false,
            error: {
                success: false,
                errCode: exports.ERR_MISSING_IDENTITY,
                errMsg: '无法获取用户身份，请重新登录',
            },
        };
    }
    // 2. 查询白名单，异常时默认拒绝
    let isAdmin;
    try {
        isAdmin = await checkAdmin(db, openid);
    }
    catch (err) {
        // 数据库异常：遵循默认拒绝原则，并记录异常审计日志
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error('[adminAuth] 管理员白名单查询失败，默认拒绝访问：', errorMsg);
        await recordAuthLog(db, {
            openid,
            action,
            errorCode: exports.ERR_AUTH_SYSTEM,
            errorMsg: `白名单查询失败：${errorMsg}`,
        });
        return {
            allowed: false,
            error: {
                success: false,
                errCode: exports.ERR_AUTH_SYSTEM,
                errMsg: '权限校验失败，请稍后重试',
            },
        };
    }
    // 3. 不在白名单：拒绝访问
    if (!isAdmin) {
        await recordAuthLog(db, {
            openid,
            action,
            errorCode: exports.ERR_NO_PERMISSION,
            errorMsg: 'openid 不在管理员白名单中',
        });
        return {
            allowed: false,
            error: {
                success: false,
                errCode: exports.ERR_NO_PERMISSION,
                errMsg: '无权限访问管理端功能',
            },
        };
    }
    // 4. 校验通过
    return { allowed: true };
}
/**
 * 记录权限校验失败的审计日志（写库失败不影响主流程）
 */
async function recordAuthLog(db, params) {
    try {
        const log = (0, logger_1.createAuditLog)({
            type: audit_1.AuditType.ADMIN_LOGIN,
            operator: params.openid,
            action: `管理端权限校验拒绝：${params.action}`,
            result: 'failed',
            errorCode: params.errorCode,
            errorMsg: params.errorMsg,
        });
        await (0, logger_1.writeAuditLog)(db, log);
    }
    catch (logErr) {
        // 审计日志记录失败仅输出云函数日志，不阻断权限校验流程
        console.error('[adminAuth] 记录权限校验审计日志失败：', logErr);
    }
}
