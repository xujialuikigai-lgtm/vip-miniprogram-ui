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
// 管理端云函数入口
const cloud = __importStar(require("wx-server-sdk"));
const adminAuth_1 = require("./shared/utils/adminAuth");
const dashboard_1 = require("./dashboard");
const orderManage_1 = require("./orderManage");
const productManage_1 = require("./productManage");
const auditLog_1 = require("./auditLog");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
// action 路由分发，每个 action 前置统一的管理员权限校验
async function main(event, _context) {
    const { action } = event;
    // 获取调用者身份并执行统一权限校验
    const { OPENID } = cloud.getWXContext();
    const db = cloud.database();
    const auth = await (0, adminAuth_1.requireAdmin)(db, OPENID || '', { action });
    if (!auth.allowed) {
        // 拒绝访问，返回明确的无权限错误码
        return auth.error;
    }
    // 当前操作者身份（用于商品管理 / 配置变更的审计日志）
    const operator = { openid: OPENID || '' };
    switch (action) {
        case 'dashboard':
            // 数据看板（任务 14.3）
            return (0, dashboard_1.handleDashboard)(db, event);
        case 'orderList':
            // 管理订单列表（任务 14.4）
            return (0, orderManage_1.handleOrderList)(db, event);
        case 'orderDetail':
            // 管理订单详情（任务 14.4）
            return (0, orderManage_1.handleOrderDetail)(db, event);
        case 'retryActivation':
            // 重试开通（任务 14.4）
            return (0, orderManage_1.handleRetryActivation)(db, OPENID || '', event);
        case 'queryShunshi':
            // 查询接口状态（任务 14.4）
            return (0, orderManage_1.handleQueryShunshi)(db, OPENID || '', event);
        case 'initiateRefund':
            // 发起退款（任务 14.4）
            return (0, orderManage_1.handleInitiateRefund)(db, OPENID || '', event);
        case 'productList':
            // 商品列表（任务 14.5）
            return (0, productManage_1.handleProductList)(db, event);
        case 'productSave':
            // 商品编辑保存（任务 14.5）
            return (0, productManage_1.handleProductSave)(db, event, operator);
        case 'toggleOnline':
            // 上下架切换（任务 14.5）
            return (0, productManage_1.handleToggleOnline)(db, event, operator);
        case 'auditLogs':
            // 审计日志查询（任务 14.6）
            return (0, auditLog_1.handleAuditLogs)(db, event);
        case 'updateConfig':
            // 更新系统配置（任务 14.5）
            return (0, productManage_1.handleUpdateConfig)(db, event, operator);
        case 'getConfigs':
            // 获取系统配置列表（任务 14.5）
            return (0, productManage_1.handleGetConfigs)(db);
        default:
            return { success: false, errCode: 'INVALID_ACTION', errMsg: '无效的操作类型' };
    }
    // 各 action 的具体业务逻辑将在后续任务（14.3-14.6）中实现
    return { success: true };
}
