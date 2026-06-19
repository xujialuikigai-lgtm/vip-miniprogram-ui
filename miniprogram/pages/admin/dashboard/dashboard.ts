// 管理端 - 数据看板
// 功能：四大核心指标卡片（今日销售额/订单数/开通成功率/接口失败数）→
//       近7日销售额+订单量双指标柱状趋势 → 近30日分类占比 → 待办订单（状态筛选，最多50条）→
//       商品销量排行 Top10 → 最近20条审计日志。
//       统一调用 admin.dashboard；无权限（NO_PERMISSION/MISSING_IDENTITY）时提示并返回首页。
// Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6

import { requestSilent } from '../../../utils/request';
import {
  PRIMARY_COLOR,
  ADMIN_ORDER_TAB_LIST,
  ORDER_STATUS_MAP,
  ORDER_STATUS_COLOR
} from '../../../utils/constants';
import { OrderStatus } from '../../../utils/types';

/** 页面状态机 */
type DashboardState = 'loading' | 'success' | 'error';

/** 核心指标（与云函数 admin.dashboard 出参对齐，金额单位为元） */
interface DashboardStats {
  todaySales: number;
  todayOrderCount: number;
  successRate: number;
  apiFailedCount: number;
}

/** 近7日趋势单日数据 */
interface DailyTrendItem {
  date: string;
  sales: number;
  count: number;
}

/** 分类占比单项 */
interface CategoryRatioItem {
  categoryName: string;
  count: number;
  ratio: number;
}

/** 销量排行单项 */
interface RankingItem {
  productId: string;
  productName: string;
  salesCount: number;
}

/** 待办订单单项 */
interface TodoOrderItem {
  orderId: string;
  productName: string;
  status: OrderStatus;
  account: string;
  amount: number;
  createdAt: string;
}

/** 审计日志单项 */
interface AuditLogItem {
  operatorName: string;
  time: string;
  action: string;
  note: string;
}

/** 数据看板出参 */
interface DashboardResult {
  stats: DashboardStats;
  chart: { dailyTrend: DailyTrendItem[]; categoryRatio: CategoryRatioItem[] };
  ranking: RankingItem[];
  todoOrders: TodoOrderItem[];
  auditLogs: AuditLogItem[];
}

/** 分类占比配色（主题金为首色，循环取用） */
const RATIO_COLORS = ['#c99a3a', '#e0b860', '#8a6d3b', '#bba26a', '#d9c79a', '#a98b4f'];

/** 待办订单无权限相关错误码 */
const PERMISSION_ERR_CODES = ['NO_PERMISSION', 'MISSING_IDENTITY'];

Page({
  data: {
    /** 主题色，供 wxml 内联使用 */
    primaryColor: PRIMARY_COLOR,
    /** 页面状态：loading/success/error */
    state: 'loading' as DashboardState,

    /** 核心指标卡片（已格式化展示文案） */
    cards: [] as Array<{ label: string; value: string; unit: string; color: string }>,

    /** 近7日趋势（含归一化柱高，单位百分比） */
    trend: [] as Array<{
      label: string;
      sales: number;
      count: number;
      salesText: string;
      salesH: number;
      countH: number;
    }>,

    /** 分类占比（含配色与占比文案） */
    categoryRatio: [] as Array<{
      categoryName: string;
      count: number;
      ratio: number;
      ratioText: string;
      color: string;
    }>,

    /** 销量排行 Top10 */
    ranking: [] as RankingItem[],

    /** 待办订单筛选 Tab（全部/开通中/接口失败/退款中） */
    todoTabs: ADMIN_ORDER_TAB_LIST,
    /** 当前选中的待办状态 */
    activeTodoStatus: 'all',
    /** 当前展示的待办订单（按 Tab 客户端过滤后的结果） */
    todoOrders: [] as Array<TodoOrderItem & { statusText: string; statusColor: string; amountText: string }>,

    /** 最近审计日志 */
    auditLogs: [] as AuditLogItem[]
  },

  /** 待办订单全量缓存（最多50条，前端按 Tab 过滤展示） */
  _allTodoOrders: [] as Array<TodoOrderItem & { statusText: string; statusColor: string; amountText: string }>,

  onLoad(this: any) {
    this.loadDashboard();
  },

  onPullDownRefresh(this: any) {
    this.loadDashboard().then(() => wx.stopPullDownRefresh());
  },

  /** 加载看板数据 */
  async loadDashboard(this: any): Promise<void> {
    this.setData({ state: 'loading' });

    const res = await requestSilent<DashboardResult>({
      name: 'admin',
      action: 'dashboard'
    });

    if (!res.success || !res.data) {
      // 无权限 / 身份缺失：提示并返回首页
      if (res.errCode && PERMISSION_ERR_CODES.indexOf(res.errCode) !== -1) {
        this.handleNoPermission(res.errMsg);
        return;
      }
      this.setData({ state: 'error' });
      return;
    }

    this.applyData(res.data);
  },

  /** 将云函数返回数据加工为视图模型 */
  applyData(this: any, data: DashboardResult): void {
    const stats = data.stats || ({} as DashboardStats);

    // 核心指标卡片
    const cards = [
      { label: '今日销售额', value: this.toMoney(stats.todaySales), unit: '元', color: PRIMARY_COLOR },
      { label: '今日订单数', value: String(stats.todayOrderCount || 0), unit: '单', color: '#2196f3' },
      { label: '开通成功率', value: this.toRate(stats.successRate), unit: '%', color: '#4caf50' },
      { label: '接口失败数', value: String(stats.apiFailedCount || 0), unit: '单', color: '#f44336' }
    ];

    // 近7日趋势：归一化柱高，便于纯 CSS 柱状图展示
    const dailyTrend = (data.chart && data.chart.dailyTrend) || [];
    const maxSales = Math.max(1, ...dailyTrend.map((d) => d.sales || 0));
    const maxCount = Math.max(1, ...dailyTrend.map((d) => d.count || 0));
    const trend = dailyTrend.map((d) => ({
      label: (d.date || '').slice(5), // YYYY-MM-DD → MM-DD
      sales: d.sales || 0,
      count: d.count || 0,
      salesText: this.toMoney(d.sales),
      salesH: Math.round(((d.sales || 0) / maxSales) * 100),
      countH: Math.round(((d.count || 0) / maxCount) * 100)
    }));

    // 分类占比：补充配色与占比文案
    const ratioList = (data.chart && data.chart.categoryRatio) || [];
    const categoryRatio = ratioList.map((c, i) => ({
      categoryName: c.categoryName,
      count: c.count,
      ratio: c.ratio,
      ratioText: this.toRate(c.ratio),
      color: RATIO_COLORS[i % RATIO_COLORS.length]
    }));

    // 待办订单：补充状态文案/颜色与金额文案，缓存全量后按当前 Tab 过滤
    const allTodo = (data.todoOrders || []).map((o) => ({
      ...o,
      statusText: ORDER_STATUS_MAP[o.status] || o.status,
      statusColor: ORDER_STATUS_COLOR[o.status] || '#999999',
      amountText: this.toMoney(o.amount)
    }));
    this._allTodoOrders = allTodo;

    this.setData({
      state: 'success',
      cards,
      trend,
      categoryRatio,
      ranking: data.ranking || [],
      auditLogs: data.auditLogs || []
    });

    this.filterTodo();
  },

  /** 切换待办订单状态筛选（客户端过滤，无需重新请求） */
  onTodoTabChange(this: any, e: WechatMiniprogram.CustomEvent): void {
    const value: string = e.detail.value;
    if (value === this.data.activeTodoStatus) return;
    this.setData({ activeTodoStatus: value });
    this.filterTodo();
  },

  /** 按当前选中状态过滤待办订单 */
  filterTodo(this: any): void {
    const status = this.data.activeTodoStatus;
    const todoOrders =
      status === 'all'
        ? this._allTodoOrders
        : this._allTodoOrders.filter((o: TodoOrderItem) => o.status === status);
    this.setData({ todoOrders });
  },

  /** 点击待办订单：跳转管理端订单详情 */
  onTodoTap(this: any, e: WechatMiniprogram.TouchEvent): void {
    const orderId = e.currentTarget.dataset.id;
    if (!orderId) return;
    wx.navigateTo({
      url: `/pages/admin/order-detail/order-detail?orderId=${orderId}`
    });
  },

  /** 重试加载 */
  onRetry(this: any): void {
    this.loadDashboard();
  },

  /** 无权限处理：提示后返回首页 */
  handleNoPermission(this: any, msg?: string): void {
    this.setData({ state: 'error' });
    wx.showToast({
      title: msg || '无权限访问管理端',
      icon: 'none',
      duration: 1800
    });
    setTimeout(() => {
      wx.switchTab({
        url: '/pages/index/index',
        fail: () => wx.reLaunch({ url: '/pages/index/index' })
      });
    }, 1800);
  },

  /** 金额格式化：保留2位小数（后端金额单位为元） */
  toMoney(this: any, n: number): string {
    const v = typeof n === 'number' && !isNaN(n) ? n : 0;
    return v.toFixed(2);
  },

  /** 百分比格式化：保留1位小数 */
  toRate(this: any, n: number): string {
    const v = typeof n === 'number' && !isNaN(n) ? n : 0;
    return v.toFixed(1);
  }
});
