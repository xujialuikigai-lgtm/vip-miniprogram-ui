// 订单详情页（用户视角）
// 展示状态 Hero 区（暗色卡片）、订单进度时间轴、订单信息卡片、异常说明区，
// 支持刷新进度、长按/点击复制订单号、再买一次（先校验商品是否上架）、联系客服。
// 复用 timeline 组件、utils/request、utils/format、utils/constants。
// Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7
import { request, requestSilent } from '../../utils/request';
import { formatTime, formatPrice } from '../../utils/format';
import { ORDER_STATUS_MAP, ORDER_STATUS_COLOR, REFRESH_DEBOUNCE } from '../../utils/constants';
import { OrderStatus, PageState } from '../../utils/types';
/** 充值账号在 attach 中的可能字段名（按优先级匹配，与 order-card 保持一致） */
const ACCOUNT_KEYS = ['phone', 'mobile', 'account', 'qq', 'email', 'username'];
/**
 * 从订单 attach 中提取充值账号（detail 接口返回的 attach 已脱敏，直接展示，不二次脱敏）
 * @param order 订单数据
 */
function extractAccount(order) {
    const attach = order && order.attach;
    if (!attach || typeof attach !== 'object')
        return '';
    for (const key of ACCOUNT_KEYS) {
        const val = attach[key];
        if (typeof val === 'string' && val)
            return val;
        if (typeof val === 'number')
            return String(val);
    }
    return '';
}
/**
 * 根据订单状态计算预计到账文案（需求 20.2）
 * @param status 订单状态
 */
function getEstimatedText(status) {
    switch (status) {
        case OrderStatus.PENDING_PAY:
            return '待支付';
        case OrderStatus.PAID:
        case OrderStatus.ACTIVATING:
            return '1-5分钟';
        case OrderStatus.SUCCESS:
            return '已到账';
        case OrderStatus.REFUNDING:
            return '退款处理中';
        case OrderStatus.REFUNDED:
            return '已退款';
        case OrderStatus.API_FAILED:
            return '开通失败';
        case OrderStatus.CANCELLED:
            return '已取消';
        default:
            return '—';
    }
}
/**
 * 生成 Hero 区描述文案（含脱敏账号与商品名，需求 20.2）
 * @param order 订单
 * @param account 脱敏账号
 */
function buildHeroDesc(order, account) {
    const acc = account || '所选账号';
    switch (order.status) {
        case OrderStatus.PENDING_PAY:
            return `订单待支付，请尽快完成「${order.productName}」的支付`;
        case OrderStatus.PAID:
        case OrderStatus.ACTIVATING:
            return `正在为账号 ${acc} 开通「${order.productName}」，请耐心等待`;
        case OrderStatus.SUCCESS:
            return `账号 ${acc} 的「${order.productName}」已开通成功`;
        case OrderStatus.API_FAILED:
            return `账号 ${acc} 的「${order.productName}」开通失败，可联系客服处理`;
        case OrderStatus.REFUNDING:
            return `账号 ${acc} 的「${order.productName}」正在退款中`;
        case OrderStatus.REFUNDED:
            return `账号 ${acc} 的「${order.productName}」已原路退款`;
        case OrderStatus.CANCELLED:
            return `「${order.productName}」订单已取消`;
        default:
            return order.productName;
    }
}
Page({
    data: {
        // 页面状态：loading / success / error
        pageState: PageState.LOADING,
        PageState,
        // 订单数据
        order: null,
        // 时间轴节点
        timeline: [],
        // 失败原因（开通失败时展示）
        failReason: '',
        // 状态文案与颜色
        statusText: '',
        statusColor: '#9e9e9e',
        // 脱敏账号
        maskedAccount: '',
        // 实付金额（元）
        amountText: '0.00',
        // 下单时间 YYYY-MM-DD HH:mm
        createdTimeText: '',
        // 预计到账文案
        estimatedText: '',
        // Hero 区描述文案（含脱敏账号与商品名）
        heroDesc: '',
        // 是否展示刷新进度按钮（开通中订单）
        showRefresh: false,
        // 是否展示再买一次按钮（已结束订单）
        showRebuy: false,
        // 是否开通失败（展示失败原因区）
        isFailed: false,
        // 刷新中状态（防重复点击 + loading）
        refreshing: false
    },
    // 当前订单号（不参与渲染）
    _orderId: '',
    // 上次刷新时间戳（节流，需求 20.5 刷新按钮防抖）
    _lastRefreshAt: 0,
    // 再买一次校验中标记，防止重复点击
    _rebuyChecking: false,
    onLoad(options) {
        this._orderId = (options && options.orderId) || '';
        if (!this._orderId) {
            this.setData({ pageState: PageState.ERROR });
            return;
        }
        this.loadDetail();
    },
    /**
     * 加载订单详情（需求 20.1~20.4、20.7）
     */
    async loadDetail() {
        this.setData({ pageState: PageState.LOADING });
        try {
            const data = await request({
                name: 'order',
                action: 'detail',
                data: { orderId: this._orderId }
            });
            this.applyDetail(data);
            this.setData({ pageState: PageState.SUCCESS });
        }
        catch (e) {
            this.setData({ pageState: PageState.ERROR });
        }
    },
    /**
     * 将接口返回数据映射为页面展示字段
     * @param data 订单详情数据
     */
    applyDetail(data) {
        const order = data.order;
        const status = order.status;
        const maskedAccount = extractAccount(order);
        const statusText = ORDER_STATUS_MAP[status] || status;
        const statusColor = ORDER_STATUS_COLOR[status] || '#9e9e9e';
        // 开通中（含已支付）展示刷新进度；已结束订单展示再买一次
        const showRefresh = status === OrderStatus.ACTIVATING || status === OrderStatus.PAID;
        const showRebuy = status === OrderStatus.SUCCESS ||
            status === OrderStatus.API_FAILED ||
            status === OrderStatus.REFUNDED ||
            status === OrderStatus.CANCELLED;
        const isFailed = status === OrderStatus.API_FAILED;
        // 失败原因优先取管理员/接口填写的 failReason，其次取顺势 rechargeHints
        const failReason = isFailed
            ? data.failReason || order.failReason || order.rechargeHints || '开通失败，请联系客服处理'
            : '';
        this.setData({
            order,
            timeline: data.timeline || order.timeline || [],
            failReason,
            isFailed,
            statusText,
            statusColor,
            maskedAccount,
            amountText: formatPrice(order.amount),
            createdTimeText: formatTime(order.createdAt).slice(0, 16),
            estimatedText: getEstimatedText(status),
            heroDesc: buildHeroDesc(order, maskedAccount),
            showRefresh,
            showRebuy
        });
    },
    /**
     * 刷新进度（需求 20.5）
     * 调用 order.refresh 查询最新状态，按钮 loading + 5 秒节流防重复点击
     */
    async onRefresh() {
        if (this.data.refreshing)
            return;
        // 节流：距上次刷新不足间隔时间则提示
        const now = Date.now();
        if (now - this._lastRefreshAt < REFRESH_DEBOUNCE) {
            wx.showToast({ title: '操作太频繁，请稍后再试', icon: 'none' });
            return;
        }
        this._lastRefreshAt = now;
        this.setData({ refreshing: true });
        const res = await requestSilent({
            name: 'order',
            action: 'refresh',
            data: { orderId: this._orderId }
        });
        this.setData({ refreshing: false });
        if (res.success && res.data) {
            // refresh 返回 { order, timeline }，统一走 applyDetail
            this.applyDetail({
                order: res.data.order,
                timeline: res.data.timeline,
                failReason: res.data.order.failReason
            });
            wx.showToast({ title: '已是最新进度', icon: 'none' });
        }
        else {
            wx.showToast({ title: res.errMsg || '查询失败，请稍后重试', icon: 'none' });
        }
    },
    /**
     * 复制订单号（需求 20.4 长按复制 / 20.6 复制联系客服）
     */
    onCopyOrderId() {
        const order = this.data.order;
        if (!order || !order.orderId)
            return;
        wx.setClipboardData({
            data: order.orderId,
            success: () => {
                wx.showToast({ title: '订单号已复制', icon: 'none' });
            }
        });
    },
    /**
     * 再买一次（需求 7.6、7.7）
     * 先调用 order.rebuyCheck 校验商品/套餐是否仍可购买，可购买则跳转商品详情并预选套餐
     */
    async onRebuy() {
        if (this._rebuyChecking)
            return;
        const order = this.data.order;
        if (!order)
            return;
        this._rebuyChecking = true;
        const res = await requestSilent({
            name: 'order',
            action: 'rebuyCheck',
            data: { productId: order.productId, packageId: order.packageId }
        });
        this._rebuyChecking = false;
        if (!res.success) {
            wx.showToast({ title: res.errMsg || '校验失败，请重试', icon: 'none' });
            return;
        }
        // 商品已下架或不可购买，弹窗提示
        if (!res.data || !res.data.available) {
            wx.showModal({
                title: '提示',
                content: (res.data && res.data.reason) || '该商品暂不可购买，可返回分类选择其他商品',
                showCancel: false,
                confirmColor: '#c99a3a'
            });
            return;
        }
        // 可购买：跳转商品详情页，携带套餐 ID 自动预选相同套餐
        wx.navigateTo({
            url: `/pages/detail/detail?productId=${order.productId}&packageId=${order.packageId}`
        });
    },
    /**
     * 联系客服：复制订单号后跳转个人中心客服入口提示（需求 20.6）
     * 这里复制订单号并提示用户，便于在客服处快速报单
     */
    onContactService() {
        const order = this.data.order;
        if (order && order.orderId) {
            wx.setClipboardData({
                data: order.orderId,
                success: () => {
                    wx.showModal({
                        title: '联系客服',
                        content: '订单号已复制，请前往「我的-联系客服」添加客服并发送订单号处理',
                        showCancel: false,
                        confirmColor: '#c99a3a'
                    });
                }
            });
        }
    },
    /**
     * 加载失败重试
     */
    onRetry() {
        this.loadDetail();
    }
});
