// 订单卡片组件 order-card
// 通过 properties 接收订单数据，展示订单号、商品信息、状态标签（按状态显示不同颜色）、
// 脱敏账号、金额、下单时间，并按订单状态展示操作按钮（刷新进度 / 再买一次），
// 点击时向父级冒泡 tap / refresh / rebuy 事件。
// Requirements: 7.2, 7.3

import { Order, OrderStatus } from '../../utils/types';
import { ORDER_STATUS_MAP, ORDER_STATUS_COLOR } from '../../utils/constants';
import { formatTime, formatPrice, maskAccount } from '../../utils/format';

/** 商品名最大展示字符数（超出截断） */
const MAX_NAME_LENGTH = 20;

/** 充值账号在 attach 中的可能字段名（按优先级匹配） */
const ACCOUNT_KEYS = ['phone', 'mobile', 'account', 'qq', 'email', 'username'];

/**
 * 从订单 attach 中提取充值账号原始值
 * @param order 订单数据
 * @param fallback 父级直接传入的账号（优先使用）
 */
function extractAccount(order: Order | null, fallback: string): string {
  if (fallback) return fallback;
  const attach = order && order.attach;
  if (!attach || typeof attach !== 'object') return '';
  for (const key of ACCOUNT_KEYS) {
    const val = (attach as Record<string, any>)[key];
    if (typeof val === 'string' && val) return val;
    if (typeof val === 'number') return String(val);
  }
  return '';
}

Component({
  options: {
    // 允许使用全局样式（TDesign 主题变量）
    addGlobalClass: true,
    // 支持外部传入 class 控制布局
    styleIsolation: 'apply-shared',
  },

  properties: {
    // 订单数据（前端精简版 Order）
    order: {
      type: Object,
      value: null,
      // 订单变化时重新计算展示字段
      observer(this: any, value: any) {
        this.updateDisplay(value as Order | null, this.data.account);
      },
    },
    // 充值账号原始值（可选，未传时从 order.attach 中提取）
    account: {
      type: String,
      value: '',
      observer(this: any, value: string) {
        this.updateDisplay(this.data.order, value);
      },
    },
    // 刷新进度按钮的 loading 状态（由父级控制，防重复点击）
    refreshing: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    // 截断后的商品名
    displayName: '',
    // 状态中文文案
    statusText: '',
    // 状态颜色
    statusColor: '#9e9e9e',
    // 脱敏后的充值账号
    maskedAccount: '',
    // 格式化金额（元，保留2位小数）
    displayAmount: '0.00',
    // 下单时间 YYYY-MM-DD HH:mm
    displayTime: '',
    // 是否展示刷新进度按钮（开通中订单）
    showRefresh: false,
    // 是否展示再买一次按钮（已结束订单）
    showRebuy: false,
  },

  methods: {
    /**
     * 根据订单数据计算所有展示字段
     */
    updateDisplay(this: any, order: Order | null, account: string) {
      if (!order) return;

      const status = order.status;

      // 商品名截断（超出 20 字符省略）
      const name = order.productName || '';
      const displayName =
        name.length > MAX_NAME_LENGTH ? name.slice(0, MAX_NAME_LENGTH) + '…' : name;

      // 状态文案与颜色
      const statusText = ORDER_STATUS_MAP[status as OrderStatus] || status;
      const statusColor = ORDER_STATUS_COLOR[status as OrderStatus] || '#9e9e9e';

      // 脱敏账号
      const maskedAccount = maskAccount(extractAccount(order, account));

      // 金额（元）
      const displayAmount = formatPrice(order.amount);

      // 下单时间，取到分钟：YYYY-MM-DD HH:mm
      const displayTime = formatTime(order.createdAt).slice(0, 16);

      // 操作按钮：开通中/已支付 展示刷新进度；已结束（成功/失败/退款/取消）展示再买一次
      const showRefresh =
        status === OrderStatus.ACTIVATING || status === OrderStatus.PAID;
      const showRebuy =
        status === OrderStatus.SUCCESS ||
        status === OrderStatus.API_FAILED ||
        status === OrderStatus.REFUNDED ||
        status === OrderStatus.CANCELLED;

      this.setData({
        displayName,
        statusText,
        statusColor,
        maskedAccount,
        displayAmount,
        displayTime,
        showRefresh,
        showRebuy,
      });
    },

    /**
     * 点击卡片：冒泡 tap 事件，携带订单
     */
    onCardTap(this: any) {
      const order: Order | null = this.data.order;
      this.triggerEvent('tap', { order, orderId: order && order.orderId });
    },

    /**
     * 点击刷新进度：冒泡 refresh 事件
     * 刷新中（refreshing=true）时不再触发，防止重复点击
     */
    onRefreshTap(this: any) {
      if (this.data.refreshing) return;
      const order: Order | null = this.data.order;
      this.triggerEvent('refresh', { orderId: order && order.orderId, order });
    },

    /**
     * 点击再买一次：冒泡 rebuy 事件，携带商品与套餐
     */
    onRebuyTap(this: any) {
      const order: Order | null = this.data.order;
      this.triggerEvent('rebuy', {
        productId: order && order.productId,
        packageId: order && order.packageId,
        order,
      });
    },

    /**
     * 拦截按钮区域点击冒泡到卡片（配合 wxml catchtap 使用）
     */
    catchActionTap() {
      // 占位方法，仅用于阻止事件冒泡
    },
  },
});
