// 管理端 - 订单处理列表页
// 功能：状态筛选 Tab（全部/开通中/接口失败/退款中，默认"全部"）→ 订单卡片列表（按下单时间倒序）→
//       每张卡片展示商品名/状态/脱敏手机号/订单号/三方单号/实付/成本/预计利润 →
//       分页触底加载（每页 20 条）→ 点击卡片进入管理端订单详情页 →
//       加载/空/异常/无权限态完整。
// 调用云函数：admin.orderList
// Requirements: 8.1, 8.2
import { requestSilent } from '../../../utils/request';
import { formatTime } from '../../../utils/format';
import { ADMIN_ORDER_TAB_LIST, PAGE_SIZE, PRIMARY_COLOR, ORDER_STATUS_MAP, ORDER_STATUS_COLOR } from '../../../utils/constants';
/** 无权限相关错误码（与云函数 adminAuth 返回一致） */
const NO_PERMISSION_CODES = ['NO_PERMISSION', 'MISSING_IDENTITY', 'AUTH_SYSTEM_ERROR'];
/** 合法的状态 Tab 值（与云函数 orderList 的 status 入参对齐） */
const VALID_TABS = ADMIN_ORDER_TAB_LIST.map((t) => t.value);
Page({
    data: {
        /** 主题色，供 wxml 内联使用 */
        primaryColor: PRIMARY_COLOR,
        /** 状态筛选 Tab 列表（全部/开通中/接口失败/退款中） */
        tabs: ADMIN_ORDER_TAB_LIST,
        /** 当前选中 Tab，默认"全部" */
        activeTab: 'all',
        /** 订单列表（已格式化） */
        list: [],
        /** 订单总数 */
        total: 0,
        /** 当前页码 */
        page: 1,
        /** 是否还有下一页 */
        hasMore: false,
        /** 是否正在加载下一页（触底加载态） */
        loadingMore: false,
        /** 页面状态 */
        state: 'loading',
        /** 无权限提示文案 */
        permMsg: ''
    },
    onLoad(options) {
        // 支持外部跳转携带初始状态 Tab
        const target = (options && options.status) || 'all';
        const activeTab = VALID_TABS.indexOf(target) !== -1 ? target : 'all';
        this.setData({ activeTab });
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
    /**
     * 拉取一页订单数据
     * @param page 页码
     * @returns 列表与总数；失败时返回 null（错误码已写入 _lastErrCode）
     */
    async fetchPage(page) {
        // status 为 all 时不传，云函数返回全部（含已取消）
        const status = this.data.activeTab === 'all' ? undefined : this.data.activeTab;
        const res = await requestSilent({
            name: 'admin',
            action: 'orderList',
            data: { status, page, pageSize: PAGE_SIZE }
        });
        if (!res.success) {
            this._lastErrCode = res.errCode || '';
            this._lastErrMsg = res.errMsg || '';
            return null;
        }
        return {
            list: (res.data && res.data.list) || [],
            total: (res.data && res.data.total) || 0
        };
    },
    /**
     * 加载订单列表
     * @param reset 是否重置到第一页（切换 Tab / 下拉刷新 / 首次加载）
     */
    async loadList(reset) {
        if (reset) {
            this.setData({ state: 'loading', page: 1, list: [], total: 0, hasMore: false });
        }
        const result = await this.fetchPage(1);
        if (!result) {
            // 无权限错误单独提示，其余按网络异常处理
            if (NO_PERMISSION_CODES.indexOf(this._lastErrCode) !== -1) {
                this.setData({
                    state: 'noperm',
                    permMsg: this._lastErrMsg || '无权限访问管理端功能'
                });
                return;
            }
            this.setData({ state: 'error' });
            return;
        }
        const list = result.list.map(formatOrder);
        this.setData({
            list,
            total: result.total,
            page: 1,
            hasMore: list.length < result.total,
            state: list.length > 0 ? 'success' : 'empty'
        });
    },
    /** 触底加载下一页 */
    async loadMore() {
        const nextPage = this.data.page + 1;
        this.setData({ loadingMore: true });
        const result = await this.fetchPage(nextPage);
        if (!result) {
            this.setData({ loadingMore: false });
            wx.showToast({ title: '加载失败，请稍后重试', icon: 'none' });
            return;
        }
        const more = result.list.map(formatOrder);
        const list = this.data.list.concat(more);
        this.setData({
            list,
            total: result.total,
            page: nextPage,
            hasMore: list.length < result.total,
            loadingMore: false
        });
    },
    /** 骨架屏超时 / 异常态重试 */
    onRetry() {
        this.loadList(true);
    },
    /** 点击订单卡片：进入管理端订单详情处理页，携带 orderId */
    onCardTap(e) {
        const orderId = e.currentTarget.dataset.id;
        if (!orderId)
            return;
        wx.navigateTo({
            url: `/pages/admin/order-detail/order-detail?orderId=${orderId}`
        });
    }
});
/** 金额保留两位小数（后端返回单位为元，直接展示，不做分→元转换） */
function toMoney(n) {
    const v = typeof n === 'number' && !isNaN(n) ? n : 0;
    return v.toFixed(2);
}
/**
 * 将云函数返回的订单项格式化为卡片展示模型
 * 金额单位为元（与 dashboard / productList 一致），直接保留两位小数
 */
function formatOrder(o) {
    const status = o.status;
    return Object.assign(Object.assign({}, o), { statusName: ORDER_STATUS_MAP[status] || o.status, statusColor: ORDER_STATUS_COLOR[status] || '#999999', displayAmount: toMoney(o.amount), displayCost: toMoney(o.costPrice), displayProfit: toMoney(o.profit), isLoss: (o.profit || 0) < 0, displayTime: formatTime(o.createdAt).slice(0, 16) });
}
