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
// 定时任务云函数入口（每5分钟由定时触发器执行）
const cloud = __importStar(require("wx-server-sdk"));
const cancelExpired_1 = require("./cancelExpired");
const queryPending_1 = require("./queryPending");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
/**
 * 定时触发入口
 *
 * 每5分钟执行两项任务（需求 4.8 / 23.1 / 23.2 / 23.3）：
 * 1. cancelExpiredOrders：扫描并取消超时30分钟未支付订单
 * 2. queryPendingOrders：查询超10分钟未回调的开通中订单
 *
 * 两个任务相互独立，单个失败不影响另一个。
 */
async function main(_event, _context) {
    const db = cloud.database();
    const result = { success: true };
    // 任务一：超时未支付订单自动取消
    try {
        result.cancelExpired = await (0, cancelExpired_1.cancelExpiredOrders)(db);
    }
    catch (err) {
        result.success = false;
        result.errMsg = `cancelExpiredOrders 执行失败: ${err && err.message ? err.message : err}`;
        console.error('[Timer]', result.errMsg);
    }
    // 任务二：开通中订单超时轮询
    try {
        result.queryPending = await (0, queryPending_1.queryPendingOrders)(db);
    }
    catch (err) {
        result.success = false;
        const msg = `queryPendingOrders 执行失败: ${err && err.message ? err.message : err}`;
        result.errMsg = result.errMsg ? `${result.errMsg}; ${msg}` : msg;
        console.error('[Timer]', msg);
    }
    return result;
}
