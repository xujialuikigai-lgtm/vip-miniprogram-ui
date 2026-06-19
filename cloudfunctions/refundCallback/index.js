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
// 退款回调云函数入口（独立部署）
// 任务 9.1：微信退款结果回调处理
// 设计依据：Requirements 6.4（退款回调成功后订单状态流转为 refunded）
// 处理流程：
//   1. 解析回调报文，验证回调签名（已配置平台证书公钥时执行 RSA 验签）
//   2. 复用 wechatpay 的 AES-256-GCM 解密退款回调资源体
//   3. 幂等处理（已退款订单直接返回成功）
//   4. 退款成功更新订单状态为 refunded，记录退款时间并追加 timeline 节点
//   5. 写入审计日志，并尽力触发退款到账订阅消息通知
//   6. 返回微信支付要求的应答报文（{ code, message }）
const cloud = __importStar(require("wx-server-sdk"));
const order_1 = require("./shared/types/order");
const audit_1 = require("./shared/types/audit");
const logger_1 = require("./shared/utils/logger");
const wechatpay_1 = require("../payment/wechatpay");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
/** 订单集合名 */
const ORDERS_COLLECTION = 'orders';
/** 退款成功的事件类型 */
const EVENT_REFUND_SUCCESS = 'REFUND.SUCCESS';
/** 退款成功状态值 */
const REFUND_STATUS_SUCCESS = 'SUCCESS';
/** 微信支付要求的成功应答 */
const ACK_SUCCESS = { code: 'SUCCESS', message: '成功' };
/** 微信支付要求的失败应答（微信将按策略重试推送） */
function ackFail(message) {
    return { code: 'FAIL', message };
}
/**
 * 从云函数 HTTP 触发事件中解析回调报文与请求头
 * 兼容 HTTP 触发（body 为字符串，可能 Base64 编码）与直接调用（event 即报文对象）两种入参
 */
function parseEvent(event) {
    if (event && typeof event.body === 'string') {
        const raw = event.isBase64Encoded
            ? Buffer.from(event.body, 'base64').toString('utf8')
            : event.body;
        return {
            body: raw,
            notification: safeJsonParse(raw),
            headers: normalizeHeaders(event.headers)
        };
    }
    // 直接传入已解析对象（便于测试或内部调用）
    if (event && event.body && typeof event.body === 'object') {
        return {
            body: JSON.stringify(event.body),
            notification: event.body,
            headers: normalizeHeaders(event.headers)
        };
    }
    return {
        body: JSON.stringify(event || {}),
        notification: event || {},
        headers: normalizeHeaders(event && event.headers)
    };
}
/** 将请求头统一转为小写键，便于大小写无关读取 */
function normalizeHeaders(headers) {
    const result = {};
    if (headers && typeof headers === 'object') {
        for (const key of Object.keys(headers)) {
            result[key.toLowerCase()] = String(headers[key]);
        }
    }
    return result;
}
/** 安全 JSON 解析，失败返回空对象 */
function safeJsonParse(raw) {
    try {
        return raw ? JSON.parse(raw) : {};
    }
    catch (_a) {
        return {};
    }
}
/**
 * 验证回调签名
 * 仅当配置了微信支付平台证书公钥时执行 RSA 验签；
 * 未配置公钥时返回 true（由后续 AES-256-GCM 解密的认证标签保证报文完整性，防篡改）。
 */
function checkSignature(body, headers, config) {
    if (!config.platformPublicKey) {
        return true;
    }
    const timestamp = headers['wechatpay-timestamp'];
    const nonce = headers['wechatpay-nonce'];
    const signature = headers['wechatpay-signature'];
    if (!timestamp || !nonce || !signature) {
        return false;
    }
    return (0, wechatpay_1.verifyNotifySignature)({ timestamp, nonce, body, signature }, config.platformPublicKey);
}
// 微信退款结果回调处理
async function main(event, _context) {
    const db = cloud.database();
    const { body, notification, headers } = parseEvent(event);
    // 读取回调配置（API v3 密钥必需，缺失会抛错并返回 FAIL）
    let config;
    try {
        config = (0, wechatpay_1.loadWechatPayCallbackConfig)();
    }
    catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error('[refundCallback] 读取回调配置失败：', errorMsg);
        return ackFail('回调配置缺失');
    }
    // 1. 验证回调签名（配置了平台公钥时）
    if (!checkSignature(body, headers, config)) {
        console.error('[refundCallback] 回调签名验证失败');
        return ackFail('签名验证失败');
    }
    // 2. 解密退款回调资源体
    if (!notification || !notification.resource) {
        console.error('[refundCallback] 回调报文缺少 resource 字段');
        return ackFail('报文格式错误');
    }
    let resource;
    try {
        const plaintext = (0, wechatpay_1.decryptResource)(notification.resource, config.apiV3Key);
        resource = JSON.parse(plaintext);
    }
    catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error('[refundCallback] 退款回调报文解密失败：', errorMsg);
        return ackFail('解密失败');
    }
    const orderId = resource.out_trade_no ? String(resource.out_trade_no) : '';
    if (!orderId) {
        console.error('[refundCallback] 解密报文缺少 out_trade_no');
        return ackFail('缺少订单号');
    }
    // 3. 查询订单
    const orderRes = await db.collection(ORDERS_COLLECTION).where({ orderId }).limit(1).get();
    const orderList = orderRes && Array.isArray(orderRes.data) ? orderRes.data : [];
    if (orderList.length === 0) {
        console.error('[refundCallback] 订单不存在：', orderId);
        // 订单不存在时返回成功，避免微信无意义重试
        return ACK_SUCCESS;
    }
    const order = orderList[0];
    // 仅处理退款成功事件，其余事件（退款异常/关闭）记录日志后确认接收
    const isSuccess = notification.event_type === EVENT_REFUND_SUCCESS &&
        (!resource.refund_status || resource.refund_status === REFUND_STATUS_SUCCESS);
    if (!isSuccess) {
        console.warn(`[refundCallback] 非退款成功事件，订单：${orderId}，事件：${notification.event_type}，状态：${resource.refund_status}`);
        await safeWriteRefundLog(db, {
            orderId,
            amount: order.amount,
            refundId: resource.refund_id,
            result: 'failed',
            errorMsg: `退款未成功：event=${notification.event_type}, status=${resource.refund_status}`
        });
        return ACK_SUCCESS;
    }
    // 4. 幂等处理：已退款订单直接返回成功
    if (order.status === order_1.OrderStatus.REFUNDED) {
        console.info('[refundCallback] 订单已处理退款，幂等返回：', orderId);
        return ACK_SUCCESS;
    }
    // 5. 退款成功：更新订单状态为 refunded，记录退款时间并追加 timeline 节点
    const now = new Date();
    const timelineNode = {
        status: order_1.OrderStatus.REFUNDED,
        time: now,
        desc: '退款已到账'
    };
    const _ = db.command;
    await db
        .collection(ORDERS_COLLECTION)
        .where({ orderId })
        .update({
        data: {
            status: order_1.OrderStatus.REFUNDED,
            refundId: resource.refund_id || order.refundId,
            refundedAt: now,
            timeline: _.push([timelineNode]),
            updatedAt: now
        }
    });
    // 6. 写入审计日志（操作人标记为系统）
    await safeWriteRefundLog(db, {
        orderId,
        amount: order.amount,
        refundId: resource.refund_id,
        result: 'success'
    });
    // 7. 尽力触发退款到账订阅消息通知（失败不影响订单流转，也不影响应答）
    await safeNotifyRefund(order.openid, orderId, order.amount);
    return ACK_SUCCESS;
}
/**
 * 写入退款审计日志，写库失败不阻断主流程
 */
async function safeWriteRefundLog(db, params) {
    try {
        const log = (0, logger_1.createAuditLog)({
            type: audit_1.AuditType.REFUND_SUCCESS,
            operator: 'system',
            orderId: params.orderId,
            action: '退款到账',
            result: params.result,
            detail: {
                refundAmount: params.amount,
                refundId: params.refundId
            },
            errorMsg: params.errorMsg
        });
        await (0, logger_1.writeAuditLog)(db, log);
    }
    catch (logErr) {
        console.error('[refundCallback] 写入退款审计日志失败：', logErr);
    }
}
/**
 * 尽力触发退款到账订阅消息通知（调用 notify 云函数），异常吞掉不阻断回调应答
 */
async function safeNotifyRefund(openid, orderId, amount) {
    try {
        await cloud.callFunction({
            name: 'notify',
            data: {
                action: 'send',
                type: 'refund_success',
                openid,
                orderId,
                amount
            }
        });
    }
    catch (notifyErr) {
        console.error('[refundCallback] 触发退款到账通知失败：', notifyErr);
    }
}
