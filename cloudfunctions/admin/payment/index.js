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
// 支付业务云函数入口
const cloud = __importStar(require("wx-server-sdk"));
const unifiedOrder_1 = require("./unifiedOrder");
const refund_1 = require("./refund");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
// action 路由分发
async function main(event, context) {
    const { action } = event;
    const db = cloud.database();
    const { OPENID } = cloud.getWXContext();
    switch (action) {
        case 'unifiedOrder':
            // 统一下单（任务 7.1）
            return (0, unifiedOrder_1.unifiedOrder)(db, OPENID || '', event);
        case 'refund':
            // 退款发起（任务 7.2）
            return (0, refund_1.refund)(db, OPENID || '', event);
        default:
            return { success: false, errCode: 'INVALID_ACTION', errMsg: '无效的操作类型' };
    }
}
