// 我的订单列表页
// 功能：状态筛选 Tab（全部/开通中/开通成功/退款，默认"全部"）→ 订单卡片列表（按下单时间倒序）→
//       分页触底加载（每页 20 条）→ 开通中订单刷新进度（loading + 防重复点击）→
//       再买一次（先调 rebuyCheck 校验是否上架，已下架弹窗提示）→ 空态/异常态 → 登录态处理。
// Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 16.1
import { requestSilent, request } from '../../utils/request';
import { ORDER_TAB_LIST, PAGE_SIZE, PRIMARY_COLOR } from '../../utils/constants';
/** 合法的状态 Tab 值（与云函数 order.list 的 status 入参对齐） */
const VALID_TABS = ORDER_TAB_LIST.map((t) => t.value);
Page({
    data: {
        /** 主题色，供 wxml 内联使用 */
        primaryColor: PRIMARY_COLOR,
        /** 状态筛选 Tab 列表（全部/开通中/开通成功/退款） */
        tabs: ORDER_TAB_LIST,
        /** 当前选中 Tab，默认"全部" */
        activeTab: 'all',
        /** 订单列表 */
        list: [],
        /** 订单总数 */
        total: 0,
        /** 当前页码 */
        page: 1,
        /** 是否还有下一页 */
        hasMore: false,
        /** 是否正在加载下一页（触底加载态） */
        loadingMore: false,
        /** 当前正在刷新进度的订单号（用于控制对应卡片的 loading） */
        refreshingId: '',
        /** 页面状态：loading/success/empty/error */
        state: 'loading'
    },
    /** 再买一次校验中标记，防止重复点击 */
    _rebuyChecking: false,
    /** 是否已完成首次加载（用于区分 onLoad 与后续 onShow） */
    _loadedOnce: false,
    onLoad(options) {
        // 支持从个人中心统计卡片跳转时携带的 Tab（全部/开通中/退款）
        const target = (options && (options.status || options.tab)) || 'all';
        const activeTab = VALID_TABS.indexOf(target) !== -1 ? target : 'all';
        this.setData({ activeTab });
        this._loadedOnce = true;
        this.loadList(true);
    },
    onShow() {
        // 作为 tabBar 页，onLoad 仅触发一次；首次由 onLoad 加载，这里跳过避免重复
        if (!this._loadedOnce) {
            this._loadedOnce = true;
            this.loadList(true);
            return;
        }
        // 个人中心通过全局约定字段传入目标 Tab（switchTab 无法携带参数）
        const app = getApp();
        const pending = app && app.globalData && app.globalData.orderTab;
        if (pending && VALID_TABS.indexOf(pending) !== -1) {
            app.globalData.orderTab = '';
            this.setData({ activeTab: pending });
        }
        // 再次进入时刷新列表，反映新下单/状态变更
        this.loadList(true);
    },
    /** 下拉刷新：重置到第一页重新加载 */
    onPullDownRefresh() {
        this.loadList(true).then(() => {
            wx.stopPullDownRefresh();
        });
    },
    /** 触底：加载下一页 */
    onReachBottom() {
        if (this.data.hasMore && !this.data.loadingMore && this.data.state === 'success') {
            this.loadMore();
        }
    },
    /** 切换状态筛选 Tab：重置列表并重新加载 */
    onTabChange(e) {
        const value = e.detail.value;
        if (value === this.data.activeTab)
            return;
        this.setData({ activeTab: value });
        this.loadList(true);
    },
    /** 自绘胶囊 Tab 点击 */
    onTabTap(e) {
        const value = e.currentTarget.dataset.value;
        if (!value || value === this.data.activeTab)
            return;
        this.setData({ activeTab: value });
        this.loadList(true);
    },
    /**
     * 加载订单列表
     * @param reset 是否重置到第一页（切换 Tab / 下拉刷新 / 首次加载）
     */
    async loadList(reset) {
        if (reset) {
            this.setData({ state: 'loading', page: 1, list: [], total: 0, hasMore: false });
        }
        const res = await requestSilent({
            name: 'order',
            action: 'list',
            data: { status: this.data.activeTab, page: 1, pageSize: PAGE_SIZE }
        });
        if (!res.success) {
            // 登录态异常单独提示，其余按网络异常处理
            if (res.errCode === 'UNAUTHORIZED') {
                this.setData({ state: 'error' });
                wx.showToast({ title: '请重新进入小程序后再试', icon: 'none' });
                return;
            }
            this.setData({ state: 'error' });
            return;
        }
        const list = (res.data && res.data.list) || [];
        const total = (res.data && res.data.total) || 0;
        this.setData({
            list,
            total,
            page: 1,
            hasMore: list.length < total,
            state: list.length > 0 ? 'success' : 'empty'
        });
    },
    /** 触底加载下一页 */
    async loadMore() {
        const nextPage = this.data.page + 1;
        this.setData({ loadingMore: true });
        const res = await requestSilent({
            name: 'order',
            action: 'list',
            data: { status: this.data.activeTab, page: nextPage, pageSize: PAGE_SIZE }
        });
        if (!res.success) {
            this.setData({ loadingMore: false });
            wx.showToast({ title: '加载失败，请稍后重试', icon: 'none' });
            return;
        }
        const more = (res.data && res.data.list) || [];
        const total = (res.data && res.data.total) || this.data.total;
        const list = this.data.list.concat(more);
        this.setData({
            list,
            total,
            page: nextPage,
            hasMore: list.length < total,
            loadingMore: false
        });
    },
    /** 骨架屏超时 / 异常态重试 */
    onRetry() {
        this.loadList(true);
    },
    /** 点击订单卡片：进入订单详情页 */
    onCardTap(e) {
        const orderId = e.detail && e.detail.orderId;
        if (!orderId)
            return;
        wx.navigateTo({
            url: `/pages/order-detail/order-detail?orderId=${orderId}`
        });
    },
    /**
     * 刷新进度（开通中订单）
     * 刷新期间对应卡片显示 loading，且通过 refreshingId 防止重复点击
     * 失败时恢复按钮并提示（Req 7.4、7.5）
     */
    async onRefresh(e) {
        const orderId = e.detail && e.detail.orderId;
        if (!orderId || this.data.refreshingId)
            return;
        this.setData({ refreshingId: orderId });
        const res = await requestSilent({
            name: 'order',
            action: 'refresh',
            data: { orderId }
        });
        if (!res.success || !res.data) {
            this.setData({ refreshingId: '' });
            wx.showToast({ title: '查询失败，请稍后重试', icon: 'none' });
            return;
        }
        // 用最新订单替换列表中对应项（状态可能已变更，卡片按钮随之刷新）
        const latest = res.data.order;
        const list = this.data.list.map((item) => item.orderId === orderId ? Object.assign(Object.assign({}, item), latest) : item);
        this.setData({ list, refreshingId: '' });
        wx.showToast({ title: '已是最新进度', icon: 'none' });
    },
    /**
     * 再买一次：先调 rebuyCheck 校验商品/套餐是否仍上架
     * 可购买 → 跳转详情页并自动选中相同套餐（Req 7.6）
     * 已下架 → 弹窗提示（Req 7.7）
     */
    async onRebuy(e) {
        if (this._rebuyChecking)
            return;
        const detail = e.detail || {};
        const productId = detail.productId;
        const packageId = detail.packageId;
        if (!productId) {
            wx.showToast({ title: '商品信息缺失', icon: 'none' });
            return;
        }
        this._rebuyChecking = true;
        let data;
        try {
            data = await request({
                name: 'order',
                action: 'rebuyCheck',
                data: { productId, packageId }
            });
        }
        catch (err) {
            // request 已统一 Toast 提示
            this._rebuyChecking = false;
            return;
        }
        this._rebuyChecking = false;
        if (!data || !data.available) {
            wx.showModal({
                title: '提示',
                content: (data && data.reason) || '该商品暂不可购买，可返回分类选择其他商品',
                showCancel: false,
                confirmText: '我知道了',
                confirmColor: PRIMARY_COLOR
            });
            return;
        }
        // 跳转详情页，携带套餐 ID 以自动选中相同套餐
        const pkgQuery = packageId ? `&packageId=${packageId}` : '';
        wx.navigateTo({
            url: `/pages/detail/detail?productId=${productId}${pkgQuery}`
        });
    },
    /** 空态引导按钮：前往首页浏览商品（Req 16.1） */
    onGoHome() {
        wx.switchTab({
            url: '/pages/index/index',
            fail: () => {
                // 首页非 tabBar 时兜底用 reLaunch
                wx.reLaunch({ url: '/pages/index/index' });
            }
        });
    }
});
