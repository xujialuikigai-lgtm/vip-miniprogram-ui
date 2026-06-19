"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
// 顺势回调云函数入口（HTTP 触发，独立部署）
// 接收顺势权益 API 的异步开通结果回调：验签 → 幂等 → 更新订单 → 写播报/通知 → 返回 "ok"
const cloud = __importStar(require("wx-server-sdk"));
const querystring = __importStar(require("querystring"));
const sign_1 = require("./shared/utils/sign");
const order_1 = require("./shared/types/order");
const audit_1 = require("./shared/types/audit");
const logger_1 = require("./shared/utils/logger");
const mask_1 = require("./shared/utils/mask");
const constants_1 = require("./shared/constants");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
/**
 * 解析 HTTP 触发回调的请求体
 * 兼容三种来源：
 * 1. 结构化对象（云函数直接调用 / 单元测试场景，参数直接在 event 上）
 * 2. event.body 为字符串（HTTP 触发，可能 base64 编码，JSON 或 form-urlencoded）
 * 3. event.body 为对象
 * @param event - 云函数入参
 * @returns 回调参数对象
 */
function parseCallbackBody(event) {
    if (!event || typeof event !== 'object') {
        return {};
    }
    // body 为字符串：HTTP 触发的原始报文
    if (typeof event.body === 'string') {
        let raw = event.body;
        // base64 编码时先解码
        if (event.isBase64Encoded) {
            raw = Buffer.from(raw, 'base64').toString('utf-8');
        }
        raw = raw.trim();
        // 优先尝试按 JSON 解析
        if (raw.startsWith('{') || raw.startsWith('[')) {
            try {
                return JSON.parse(raw);
            }
            catch (e) {
                // 解析失败则继续按 form 处理
            }
        }
        // 按 application/x-www-form-urlencoded 解析
        return querystring.parse(raw);
    }
    // body 为对象：直接使用
    if (event.body && typeof event.body === 'object') {
        return event.body;
    }
    // 参数直接挂在 event 上（直接调用 / 测试）
    return event;
}
/**
 * 将顺势订单状态码映射为本地订单状态
 * status=3 → 开通成功；status=4/5 → 开通失败（取消/退款）；其余（1/2 处理中）不映射终态
 * @param shunshiStatus - 顺势返回的状态码
 * @returns 映射结果，处理中状态返回 null
 */
function mapShunshiStatus(shunshiStatus) {
    switch (shunshiStatus) {
        case constants_1.ShunshiOrderStatus.SUCCESS: // 3 交易成功
            return { status: order_1.OrderStatus.SUCCESS, desc: '开通成功' };
        case constants_1.ShunshiOrderStatus.CANCELLED: // 4 交易取消
            return { status: order_1.OrderStatus.API_FAILED, desc: '开通失败（订单已取消）' };
        case constants_1.ShunshiOrderStatus.REFUNDED: // 5 退款
            return { status: order_1.OrderStatus.API_FAILED, desc: '开通失败（已退款）' };
        default: // 1 待处理 / 2 处理中
            return null;
    }
}
/**
 * 从订单的开通参数（attach）中提取并脱敏账号，用于播报展示
 * 优先取常见账号字段，兜底取第一个非空字符串字段
 * @param order - 订单
 * @returns 脱敏后的账号（无可用账号时返回空串）
 */
function extractMaskedAccount(order) {
    const attach = order.attach || {};
    const preferredKeys = [
        'account', 'phone', 'mobile', 'recharge_account', 'tel',
        '充值账号', '账号', '手机号'
    ];
    for (const key of preferredKeys) {
        const value = attach[key];
        if (typeof value === 'string' && value) {
            return (0, mask_1.maskAccount)(value);
        }
    }
    for (const key of Object.keys(attach)) {
        const value = attach[key];
        if (typeof value === 'string' && value) {
            return (0, mask_1.maskAccount)(value);
        }
    }
    return '';
}
/**
 * 开通成功时写入播报缓存，并仅保留最近 BROADCAST_MAX_COUNT 条
 * 失败不抛出（播报为非关键路径，不影响订单流转）
 * @param db - 云数据库实例
 * @param order - 已开通成功的订单
 */
async function writeBroadcastCache(db, order) {
    try {
        await db.collection('broadcast_cache').add({
            data: {
                phone: extractMaskedAccount(order),
                productName: order.productName,
                createdAt: new Date()
            }
        });
        // 清理超出上限的旧记录（按时间倒序，跳过最近 N 条，其余删除）
        const extra = await db
            .collection('broadcast_cache')
            .orderBy('createdAt', 'desc')
            .skip(constants_1.BROADCAST_MAX_COUNT)
            .get();
        if (extra.data && extra.data.length > 0) {
            for (const item of extra.data) {
                await db.collection('broadcast_cache').doc(item._id).remove();
            }
        }
    }
    catch (e) {
        console.error('[callback] 写入播报缓存失败：', e);
    }
}
/**
 * 触发通知云函数发送订阅消息（开通成功 / 开通失败）
 * 失败不抛出（通知为非关键路径，不影响订单流转）
 * @param order - 订单
 * @param success - 是否开通成功
 */
async function triggerNotify(order, success) {
    try {
        await cloud.callFunction({
            name: 'notify',
            data: {
                action: 'send',
                openid: order.openid,
                orderId: order.orderId,
                type: success ? 'activation_success' : 'activation_failed',
                data: {
                    productName: order.productName,
                    amount: order.amount,
                    failReason: order.failReason || ''
                }
            }
        });
    }
    catch (e) {
        console.error('[callback] 触发通知云函数失败：', e);
    }
}
/**
 * 顺势异步回调处理主入口
 *
 * 业务流程：
 * 1. 解析回调报文
 * 2. verifyCallbackSign 验签（apikey 取自环境变量），失败拒绝并记录异常日志
 * 3. 定位订单（优先外部订单号 external_orderno，回退顺势单号 ordersn）
 * 4. 幂等：终态订单直接返回 ok
 * 5. 按顺势状态更新订单状态、timeline、failReason、卡密等
 * 6. 开通成功写播报缓存并触发通知；失败触发通知
 * 7. 返回字符串 "ok" 确认处理
 *
 * @param event - 云函数入参（HTTP 触发报文）
 * @param context - 云函数上下文
 * @returns 处理结果字符串（成功 "ok"，验签失败 "fail"）
 */
async function main(event, context) {
    const db = cloud.database();
    const apikey = process.env.SHUNSHI_API_KEY || '';
    // 1. 解析回调参数
    const params = parseCallbackBody(event);
    const externalOrderno = typeof params.external_orderno === 'string' ? params.external_orderno : '';
    const ordersn = typeof params.ordersn === 'string' ? params.ordersn : '';
    // 2. 验证回调签名（apikey 仅来自环境变量）
    if (!apikey || !(0, sign_1.verifyCallbackSign)(params, apikey)) {
        const failLog = (0, logger_1.createAuditLog)({
            type: audit_1.AuditType.SHUNSHI_CALLBACK,
            operator: 'system',
            orderId: externalOrderno || ordersn || undefined,
            action: '顺势回调签名验证失败',
            detail: { ordersn, status: params.status },
            result: 'failed',
            errorCode: 'INVALID_SIGN',
            errorMsg: '回调签名验证失败，拒绝处理'
        });
        await (0, logger_1.writeAuditLog)(db, failLog);
        return 'fail';
    }
    // 3. 定位订单（优先外部订单号 external_orderno，回退顺势单号 ordersn）
    let order;
    if (externalOrderno) {
        const r = await db.collection('orders').where({ orderId: externalOrderno }).limit(1).get();
        order = r.data && r.data[0];
    }
    if (!order && ordersn) {
        const r = await db.collection('orders').where({ shunshiOrderSn: ordersn }).limit(1).get();
        order = r.data && r.data[0];
    }
    if (!order) {
        // 找不到订单：记录日志，仍返回 ok 避免顺势持续重试堆积
        const notFoundLog = (0, logger_1.createAuditLog)({
            type: audit_1.AuditType.SHUNSHI_CALLBACK,
            operator: 'system',
            orderId: externalOrderno || ordersn || undefined,
            action: '顺势回调未匹配到订单',
            detail: { ordersn, externalOrderno, status: params.status },
            result: 'failed',
            errorCode: 'ORDER_NOT_FOUND',
            errorMsg: '回调订单不存在'
        });
        await (0, logger_1.writeAuditLog)(db, notFoundLog);
        return 'ok';
    }
    // 4. 状态映射
    const shunshiStatus = Number(params.status);
    const mapped = mapShunshiStatus(shunshiStatus);
    // 处理中状态（1/2）：仅同步状态码，不流转终态
    if (!mapped) {
        try {
            await db.collection('orders').where({ orderId: order.orderId }).update({
                data: { shunshiStatus, updatedAt: new Date() }
            });
        }
        catch (e) {
            console.error('[callback] 同步处理中状态失败：', e);
        }
        const processingLog = (0, logger_1.createAuditLog)({
            type: audit_1.AuditType.SHUNSHI_CALLBACK,
            operator: 'system',
            orderId: order.orderId,
            action: '顺势回调（处理中，暂不流转）',
            detail: { shunshiStatus },
            result: 'success'
        });
        await (0, logger_1.writeAuditLog)(db, processingLog);
        return 'ok';
    }
    // 5. 幂等：已处于终态（成功/退款/退款中/取消）或已是目标状态，直接返回 ok
    const finalStatuses = [
        order_1.OrderStatus.SUCCESS,
        order_1.OrderStatus.REFUNDING,
        order_1.OrderStatus.REFUNDED,
        order_1.OrderStatus.CANCELLED
    ];
    if (order.status === mapped.status || finalStatuses.indexOf(order.status) !== -1) {
        const idempotentLog = (0, logger_1.createAuditLog)({
            type: audit_1.AuditType.SHUNSHI_CALLBACK,
            operator: 'system',
            orderId: order.orderId,
            action: '顺势回调（幂等，订单已处理）',
            detail: { currentStatus: order.status, shunshiStatus },
            result: 'success'
        });
        await (0, logger_1.writeAuditLog)(db, idempotentLog);
        return 'ok';
    }
    // 6. 组装更新数据
    const now = new Date();
    const node = { status: mapped.status, time: now, desc: mapped.desc };
    const newTimeline = (order.timeline || []).concat([node]);
    const updateData = {
        status: mapped.status,
        shunshiStatus,
        timeline: newTimeline,
        updatedAt: now
    };
    // 顺势返回的充值提示
    if (typeof params.recharge_hints === 'string' && params.recharge_hints) {
        updateData.rechargeHints = params.recharge_hints;
    }
    if (mapped.status === order_1.OrderStatus.SUCCESS) {
        updateData.activatedAt = now;
        // 卡密 / 物流信息（部分商品开通返回卡密）
        if (params.card_list !== undefined) {
            updateData.cardList = params.card_list;
        }
        if (params.express_list !== undefined) {
            updateData.expressList = params.express_list;
        }
    }
    if (mapped.status === order_1.OrderStatus.API_FAILED) {
        // 失败原因优先取顺势 recharge_hints，否则用映射描述
        updateData.failReason =
            typeof params.recharge_hints === 'string' && params.recharge_hints
                ? params.recharge_hints
                : mapped.desc;
    }
    // 写入订单更新
    try {
        await db.collection('orders').where({ orderId: order.orderId }).update({ data: updateData });
    }
    catch (e) {
        const updateFailLog = (0, logger_1.createAuditLog)({
            type: audit_1.AuditType.SHUNSHI_CALLBACK,
            operator: 'system',
            orderId: order.orderId,
            action: '顺势回调更新订单失败',
            detail: { shunshiStatus, targetStatus: mapped.status },
            result: 'failed',
            errorMsg: e && e.message ? e.message : '订单更新失败'
        });
        await (0, logger_1.writeAuditLog)(db, updateFailLog);
        // 更新失败返回 fail，等待顺势重试
        return 'fail';
    }
    // 7. 写入成功审计日志
    const successLog = (0, logger_1.createAuditLog)({
        type: audit_1.AuditType.SHUNSHI_CALLBACK,
        operator: 'system',
        orderId: order.orderId,
        action: mapped.status === order_1.OrderStatus.SUCCESS ? '顺势回调：开通成功' : '顺势回调：开通失败',
        detail: { shunshiStatus, targetStatus: mapped.status },
        result: 'success'
    });
    await (0, logger_1.writeAuditLog)(db, successLog);
    // 8. 副作用：成功写播报 + 通知，失败仅通知（合并最新订单字段后处理）
    const latestOrder = Object.assign(Object.assign(Object.assign({}, order), updateData), { timeline: newTimeline });
    if (mapped.status === order_1.OrderStatus.SUCCESS) {
        await writeBroadcastCache(db, latestOrder);
        await triggerNotify(latestOrder, true);
    }
    else {
        await triggerNotify(latestOrder, false);
    }
    // 9. 返回顺势要求的应答
    return 'ok';
}
