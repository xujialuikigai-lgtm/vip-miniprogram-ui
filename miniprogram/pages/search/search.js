// 搜索结果页
// 功能：自动聚焦搜索框 → 调用 product.search 模糊匹配已上架商品 →
//       顶部展示"找到 X 个相关会员权益"提示条 → 排序筛选 Tab（综合/价格低/到账快/电视端）→
//       无结果空态 → 支持清空重新搜索并实时刷新。
// Requirements: 1.6, 1.7, 21.1, 21.2, 21.3, 21.4, 21.5, 21.6, 21.7
import { request } from '../../utils/request';
import { PRIMARY_COLOR } from '../../utils/constants';
/**
 * 排序 Tab 配置（value 与 product 云函数 search 的 sortType 完全对齐）
 * - comprehensive 综合（默认）
 * - price        价格低
 * - fast         到账快
 * - tv           电视端
 */
const SORT_TABS = [
    { label: '综合', value: 'comprehensive' },
    { label: '价格低', value: 'price' },
    { label: '到账快', value: 'fast' },
    { label: '电视端', value: 'tv' }
];
/** 自动搜索防抖间隔（毫秒），用于清空后重新输入时实时刷新 */
const SEARCH_DEBOUNCE = 500;
Page({
    data: {
        /** 主题色，供 wxml 内联使用 */
        primaryColor: PRIMARY_COLOR,
        /** 当前关键词 */
        keyword: '',
        /** 输入框自动聚焦 */
        autoFocus: true,
        /** 排序 Tab 列表 */
        sortTabs: SORT_TABS,
        /** 当前排序类型 */
        sortType: 'comprehensive',
        /** 搜索结果列表 */
        list: [],
        /** 结果总数 */
        total: 0,
        /** 结果提示文案 */
        resultText: '',
        /** 页面状态 */
        state: 'idle'
    },
    /** 防抖计时器 */
    _debounceTimer: null,
    onLoad(options) {
        // 接收来自首页/分类页传入的关键词
        const keyword = decodeURIComponent(options.keyword || '').trim();
        if (keyword) {
            this.setData({ keyword });
            this.doSearch(keyword);
        }
    },
    onUnload() {
        this.clearDebounce();
    },
    /** 输入框内容变化：更新关键词并防抖触发实时搜索 */
    onSearchChange(e) {
        const keyword = (e.detail.value || '').trim();
        this.setData({ keyword });
        this.clearDebounce();
        // 清空关键词时回到初始态
        if (!keyword) {
            this.setData({ state: 'idle', list: [], total: 0, resultText: '' });
            return;
        }
        // 防抖后自动搜索，实现"实时刷新"
        this._debounceTimer = setTimeout(() => {
            this.doSearch(keyword);
        }, SEARCH_DEBOUNCE);
    },
    /** 提交搜索（点击键盘"搜索"或确认）：立即搜索 */
    onSearchSubmit(e) {
        this.clearDebounce();
        const keyword = (e.detail.value || this.data.keyword || '').trim();
        this.setData({ keyword });
        if (keyword) {
            this.doSearch(keyword);
        }
    },
    /** 清空关键词：回到初始态，等待重新输入 */
    onSearchClear() {
        this.clearDebounce();
        this.setData({
            keyword: '',
            state: 'idle',
            list: [],
            total: 0,
            resultText: ''
        });
    },
    /** 切换排序 Tab：保持当前关键词重新搜索 */
    onSortChange(e) {
        const sortType = e.detail.value;
        if (sortType === this.data.sortType)
            return;
        this.setData({ sortType });
        const keyword = (this.data.keyword || '').trim();
        if (keyword) {
            this.doSearch(keyword);
        }
    },
    /** 执行搜索 */
    async doSearch(keyword) {
        this.setData({ state: 'loading' });
        try {
            const data = await request({
                name: 'product',
                action: 'search',
                data: { keyword, sortType: this.data.sortType }
            });
            const list = this.decorateProducts(data.list || []);
            const total = data.total || 0;
            this.setData({
                list,
                total,
                resultText: total > 0 ? `找到 ${total} 个相关会员权益` : '',
                state: total > 0 ? 'success' : 'empty'
            });
        }
        catch (err) {
            // request 已统一 Toast 提示，这里仅切换异常态供重试
            this.setData({ state: 'error' });
        }
    },
    /** 异常态重试 */
    onRetry() {
        const keyword = (this.data.keyword || '').trim();
        if (keyword) {
            this.doSearch(keyword);
        }
    },
    decorateProducts(products) {
        return (products || []).map((product) => (Object.assign(Object.assign({}, product), { displayIcon: this.pickRenderableImageUrl(product.brandIcon) })));
    },
    pickRenderableImageUrl(url) {
        const value = String(url || '').trim();
        if (/^https:\/\//i.test(value) || /^cloud:\/\//i.test(value) || /^\//.test(value)) {
            return value;
        }
        return '';
    },
    /** 点击商品卡片：跳转详情页 */
    onProductTap(e) {
        const productId = (e.detail && e.detail.productId) || (e.currentTarget && e.currentTarget.dataset.id);
        if (!productId)
            return;
        wx.navigateTo({
            url: `/pages/detail/detail?productId=${productId}`
        });
    },
    /** 清理防抖计时器 */
    clearDebounce() {
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
            this._debounceTimer = null;
        }
    }
});
