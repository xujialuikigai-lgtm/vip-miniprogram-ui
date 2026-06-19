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
// 订单业务云函数入口
const cloud = __importStar(require("wx-server-sdk"));
const create_1 = require("./create");
const refresh_1 = require("./refresh");
const list_1 = require("./list");
const detail_1 = require("./detail");
const stats_1 = require("./stats");
const rebuyCheck_1 = require("./rebuyCheck");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
// action 路由分发
async function main(event, context) {
    const { action } = event;
    const db = cloud.database();
    // 获取当前调用用户的 openid
    const { OPENID } = cloud.getWXContext();
    switch (action) {
        case 'create':
            // 创建订单
            return (0, create_1.createOrder)(db, OPENID, event);
        case 'list':
            // 订单列表
            return (0, list_1.listOrders)(db, OPENID, event);
        case 'detail':
            // 订单详情
            return (0, detail_1.getOrderDetail)(db, OPENID, event);
        case 'refresh':
            // 刷新订单状态
            return (0, refresh_1.refreshOrder)(db, OPENID, event);
        case 'stats':
            // 用户订单统计
            return (0, stats_1.getOrderStats)(db, OPENID);
        case 'rebuyCheck':
            // 再买一次验证
            return (0, rebuyCheck_1.rebuyCheck)(db, event);
        default:
            return { success: false, errCode: 'INVALID_ACTION', errMsg: '无效的操作类型' };
    }
}
