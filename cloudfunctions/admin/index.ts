// 管理端云函数入口
import * as cloud from 'wx-server-sdk';
import { requireAdmin } from './shared/utils/adminAuth';
import { CloudFunctionResult } from './shared/types/api';
import { handleDashboard } from './dashboard';
import {
  handleOrderList,
  handleOrderDetail,
  handleRetryActivation,
  handleQueryShunshi,
  handleInitiateRefund,
} from './orderManage';
import {
  handleProductList,
  handleProductSave,
  handleToggleOnline,
  handleGetConfigs,
  handleUpdateConfig,
  Operator,
} from './productManage';
import { handleAuditLogs } from './auditLog';

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// action 路由分发，每个 action 前置统一的管理员权限校验
export async function main(event: any, _context: any): Promise<CloudFunctionResult> {
  const { action } = event;

  // 获取调用者身份并执行统一权限校验
  const { OPENID } = cloud.getWXContext();
  const db = cloud.database();
  const auth = await requireAdmin(db, OPENID || '', { action });
  if (!auth.allowed) {
    // 拒绝访问，返回明确的无权限错误码
    return auth.error as CloudFunctionResult;
  }

  // 当前操作者身份（用于商品管理 / 配置变更的审计日志）
  const operator: Operator = { openid: OPENID || '' };

  switch (action) {
    case 'dashboard':
      // 数据看板（任务 14.3）
      return handleDashboard(db, event);
    case 'orderList':
      // 管理订单列表（任务 14.4）
      return handleOrderList(db, event);
    case 'orderDetail':
      // 管理订单详情（任务 14.4）
      return handleOrderDetail(db, event);
    case 'retryActivation':
      // 重试开通（任务 14.4）
      return handleRetryActivation(db, OPENID || '', event);
    case 'queryShunshi':
      // 查询接口状态（任务 14.4）
      return handleQueryShunshi(db, OPENID || '', event);
    case 'initiateRefund':
      // 发起退款（任务 14.4）
      return handleInitiateRefund(db, OPENID || '', event);
    case 'productList':
      // 商品列表（任务 14.5）
      return handleProductList(db, event);
    case 'productSave':
      // 商品编辑保存（任务 14.5）
      return handleProductSave(db, event, operator);
    case 'toggleOnline':
      // 上下架切换（任务 14.5）
      return handleToggleOnline(db, event, operator);
    case 'auditLogs':
      // 审计日志查询（任务 14.6）
      return handleAuditLogs(db, event);
    case 'updateConfig':
      // 更新系统配置（任务 14.5）
      return handleUpdateConfig(db, event, operator);
    case 'getConfigs':
      // 获取系统配置列表（任务 14.5）
      return handleGetConfigs(db);
    default:
      return { success: false, errCode: 'INVALID_ACTION', errMsg: '无效的操作类型' };
  }

  // 各 action 的具体业务逻辑将在后续任务（14.3-14.6）中实现
  return { success: true };
}
