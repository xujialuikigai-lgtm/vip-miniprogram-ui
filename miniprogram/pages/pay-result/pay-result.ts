// 支付结果页
// 支付成功后跳转至本页，通过 order.detail 查询订单最新状态与开通进度，
// 展示支付成功图标/文案、订单摘要（商品名、金额、订单号）与开通进度时间轴，
// 提供刷新进度、查看订单详情、返回首页等引导操作。
// Requirements: 3.5

import { request } from '../../utils/request';
import { formatPrice } from '../../utils/format';
import { REFRESH_DEBOUNCE } from '../../utils/constants';
import { Order, OrderStatus, TimelineNode, PageState } from '../../utils/types';

/** order.detail 返回结构 */
interface DetailData {
  order: Order;
  timeline: TimelineNode[];
  failReason?: string;
}

/** order.refresh 返回结构 */
interface RefreshData {
  order: Order;
  timeline: TimelineNode[];
}

/** Hero 区展示文案（依据开通状态动态变化） */
interface HeroText {
  /** 主标题 */
  title: string;
  /** 副标题描述 */
  subtitle: string;
  /** 图标名（TDesign icon） */
  icon: string;
}

Page({
  data: {
    /** 页面状态：loading / success / error */
    state: PageState.LOADING as PageState,
    /** 错误提示文案 */
    errorMsg: '',
    /** 订单号 */
    orderId: '',
    /** 订单信息 */
    order: null as Order | null,
    /** 开通进度时间轴 */
    timeline: [] as TimelineNode[],
    /** 实付金额（元） */
    amountText: '0.00',
    /** Hero 区文案 */
    hero: { title: '支付成功', subtitle: '正在为你开通权益…', icon: 'check-circle-filled' } as HeroText,
    /** 摘要状态 */
    statusLabel: '开通中',
    /** 是否正在刷新进度 */
    refreshing: false,
    /** 失败原因（开通失败时展示） */
    failReason: ''
  },

  /** 上次刷新时间戳，用于刷新按钮防抖 */
  lastRefreshTime: 0,

  onLoad(options: { orderId?: string }) {
    const orderId = options && options.orderId ? options.orderId : '';
    if (!orderId) {
      this.setData({ state: PageState.ERROR, errorMsg: '缺少订单号，无法展示支付结果' });
      return;
    }
    this.setData({ orderId });
    this.loadDetail();
  },

  /**
   * 加载订单详情（order.detail）
   * 首次进入展示加载态，失败展示异常态并提供重试。
   */
  async loadDetail() {
    this.setData({ state: PageState.LOADING, errorMsg: '' });
    try {
      const data = await request<DetailData>({
        name: 'order',
        action: 'detail',
        data: { orderId: this.data.orderId }
      });
      this.applyOrder(data.order, data.timeline, data.failReason);
      this.setData({ state: PageState.SUCCESS });
    } catch (err: any) {
      this.setData({
        state: PageState.ERROR,
        errorMsg: (err && err.message) || '加载失败，请重试'
      });
    }
  },

  /**
   * 刷新开通进度（order.refresh）
   * 5 秒内防重复点击；刷新期间按钮置 loading。
   */
  async onRefresh() {
    const now = Date.now();
    if (this.data.refreshing) return;
    if (now - this.lastRefreshTime < REFRESH_DEBOUNCE) {
      wx.showToast({ title: '操作过于频繁，请稍后再试', icon: 'none' });
      return;
    }
    this.lastRefreshTime = now;
    this.setData({ refreshing: true });
    try {
      const data = await request<RefreshData>({
        name: 'order',
        action: 'refresh',
        data: { orderId: this.data.orderId }
      });
      this.applyOrder(data.order, data.timeline, data.order.failReason);
      wx.showToast({ title: '进度已更新', icon: 'none' });
    } catch (err) {
      // request 已统一 Toast 提示，此处无需重复处理
    } finally {
      this.setData({ refreshing: false });
    }
  },

  /**
   * 将订单数据落到页面 data，并依据订单状态计算 Hero 文案。
   * @param order - 订单信息
   * @param timeline - 时间轴节点
   * @param failReason - 失败原因
   */
  applyOrder(order: Order, timeline: TimelineNode[], failReason?: string) {
    this.setData({
      order,
      timeline: timeline || order.timeline || [],
      amountText: formatPrice(order.amount),
      failReason: failReason || '',
      hero: this.buildHero(order.status),
      statusLabel: this.buildStatusLabel(order.status)
    });
  },

  /**
   * 依据开通状态构建 Hero 区文案。
   * 微信支付已成功，标题固定为「支付成功」，副标题反映开通进度。
   * @param status - 订单状态
   */
  buildHero(status: OrderStatus): HeroText {
    switch (status) {
      case OrderStatus.SUCCESS:
        return { title: '开通成功', subtitle: '权益已到账，可前往查看订单详情', icon: 'check-circle-filled' };
      case OrderStatus.API_FAILED:
        return { title: '开通失败', subtitle: '系统将自动为你退款，可联系客服处理', icon: 'error-circle-filled' };
      case OrderStatus.REFUNDING:
        return { title: '退款处理中', subtitle: '退款将原路返回，请留意到账', icon: 'time-filled' };
      case OrderStatus.REFUNDED:
        return { title: '已退款', subtitle: '款项已原路退回', icon: 'check-circle-filled' };
      default:
        // paid / activating：支付成功，正在开通
        return { title: '支付成功', subtitle: '正在为你开通权益，预计很快到账', icon: 'check-circle-filled' };
    }
  },

  buildStatusLabel(status: OrderStatus): string {
    switch (status) {
      case OrderStatus.SUCCESS:
        return '开通成功';
      case OrderStatus.API_FAILED:
        return '开通失败';
      case OrderStatus.REFUNDING:
        return '退款中';
      case OrderStatus.REFUNDED:
        return '已退款';
      default:
        return '开通中';
    }
  },

  /** 长按复制订单号 */
  onCopyOrderId() {
    if (!this.data.orderId) return;
    wx.setClipboardData({
      data: this.data.orderId,
      success: () => wx.showToast({ title: '订单号已复制', icon: 'none' })
    });
  },

  /** 查看订单详情 */
  onViewOrder() {
    wx.redirectTo({
      url: `/pages/order-detail/order-detail?orderId=${this.data.orderId}`
    });
  },

  /** 返回首页 */
  onBackHome() {
    wx.switchTab({ url: '/pages/index/index' });
  }
});
