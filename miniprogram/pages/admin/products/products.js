// 管理端 - 商品运营列表页
// 功能：商品数据概览（全部/已上架/已下架）→ 状态筛选 Tab → 快捷操作（同步商品/新增商品）→
//       商品卡片列表（名称/上架状态/售价/成本/单单利润/接口商品ID/今日销量）→
//       上下架开关（确认弹窗后调用 admin.toggleOnline）→ 同步商品（调用 product.syncProducts 并展示结果摘要）→
//       点击卡片进入商品编辑页（携带 productId）→ 加载/空/异常态完整 → 无权限错误码处理。
// 调用云函数：admin.productList、admin.toggleOnline、product.syncProducts
// Requirements: 9.1, 9.2, 9.3, 9.4, 9.8
import { requestSilent } from '../../../utils/request';
import { PRIMARY_COLOR } from '../../../utils/constants';
/** 无权限相关错误码（与 shared/utils/adminAuth.ts 保持一致） */
const PERMISSION_ERR_CODES = ['NO_PERMISSION', 'MISSING_IDENTITY', 'AUTH_SYSTEM_ERROR'];
/** 状态筛选 Tab（value 与云函数 productList 的 status 入参对齐） */
const STATUS_TABS = [
    { label: '全部', value: 'all' },
    { label: '已上架', value: 'online' },
    { label: '已下架', value: 'offline' }
];
/** 保留2位小数文案 */
function toFixed2(n) {
    const v = typeof n === 'number' && !isNaN(n) ? n : 0;
    return v.toFixed(2);
}
Page({
    data: {
        /** 主题色，供 wxml 内联使用 */
        primaryColor: PRIMARY_COLOR,
        /** 状态筛选 Tab */
        tabs: STATUS_TABS,
        /** 当前选中 Tab，默认"全部" */
        activeTab: 'all',
        /** 数据概览统计 */
        stats: { total: 0, online: 0, offline: 0 },
        /** 商品列表（渲染用） */
        list: [],
        /** 页面状态：loading/success/empty/error */
        state: 'loading',
        /** 同步中标记（控制同步按钮 loading 与防重复点击） */
        syncing: false,
        /** 正在切换上下架的商品ID（控制对应开关禁用，防重复点击） */
        togglingId: ''
    },
    onLoad() {
        this.loadList();
    },
    onShow() {
        // 从商品编辑页返回时刷新列表，反映最新的售价/上下架/今日销量
        if (this._loadedOnce) {
            this.loadList();
        }
        this._loadedOnce = true;
    },
    onPullDownRefresh() {
        this.loadList().then(() => wx.stopPullDownRefresh());
    },
    /** 切换状态筛选 Tab */
    onTabChange(e) {
        const value = e.detail.value;
        if (value === this.data.activeTab)
            return;
        this.setData({ activeTab: value });
        this.loadList();
    },
    /** 骨架屏超时 / 异常态重试 */
    onRetry() {
        this.loadList();
    },
    /**
     * 加载商品列表与概览统计
     */
    async loadList() {
        this.setData({ state: 'loading' });
        const res = await requestSilent({
            name: 'admin',
            action: 'productList',
            data: { status: this.data.activeTab }
        });
        if (!res.success) {
            // 无权限错误码：明确提示并停留在异常态
            if (PERMISSION_ERR_CODES.indexOf(res.errCode || '') !== -1) {
                this.setData({ state: 'error' });
                wx.showToast({ title: res.errMsg || '无权限访问管理端功能', icon: 'none' });
                return;
            }
            this.setData({ state: 'error' });
            return;
        }
        const stats = (res.data && res.data.stats) || { total: 0, online: 0, offline: 0 };
        const rawList = (res.data && res.data.list) || [];
        // 补充格式化字段
        const list = rawList.map((p) => (Object.assign(Object.assign({}, p), { priceText: toFixed2(p.price), costText: toFixed2(p.costPrice), profitText: toFixed2(p.profit), loss: (p.profit || 0) < 0 })));
        this.setData({
            stats,
            list,
            state: list.length > 0 ? 'success' : 'empty'
        });
    },
    /** 空操作：用于阻止开关区域点击冒泡到卡片 */
    noop() { },
    /** 点击商品卡片：进入商品编辑页（携带 productId） */
    onCardTap(e) {
        const productId = e.currentTarget.dataset.id;
        if (!productId)
            return;
        wx.navigateTo({
            url: `/pages/admin/product-edit/product-edit?productId=${productId}`
        });
    },
    /** 新增商品：进入商品编辑页（不携带 productId 表示新增） */
    onAddProduct() {
        wx.navigateTo({
            url: '/pages/admin/product-edit/product-edit'
        });
    },
    /**
     * 上下架开关变更：弹出确认弹窗，确认后调用 admin.toggleOnline
     * 取消或失败时回滚开关视觉状态（开关为受控组件，重置 list 即恢复）
     */
    onToggleOnline(e) {
        const productId = e.currentTarget.dataset.id;
        const name = e.currentTarget.dataset.name || '该商品';
        const target = !!e.detail.value;
        if (!productId || this.data.togglingId) {
            // 切换进行中：强制刷新以撤销开关的临时位移
            this.setData({ list: this.data.list.slice() });
            return;
        }
        const actionText = target ? '上架' : '下架';
        const current = this.data.list.find((item) => item.productId === productId);
        if (target && current && !(current.price > 0)) {
            wx.showModal({
                title: '先配置售价',
                content: '该商品还没有可售价格，请先进入商品编辑页配置售价，再上架商品。',
                confirmText: '去编辑',
                confirmColor: PRIMARY_COLOR,
                success: (modalRes) => {
                    this.setData({ list: this.data.list.slice() });
                    if (modalRes.confirm) {
                        wx.navigateTo({
                            url: `/pages/admin/product-edit/product-edit?productId=${productId}`
                        });
                    }
                }
            });
            return;
        }
        wx.showModal({
            title: '操作确认',
            content: `确定要${actionText}「${name}」吗？${target ? '' : '下架后用户端将不再展示该商品。'}`,
            confirmText: `确定${actionText}`,
            confirmColor: PRIMARY_COLOR,
            success: (modalRes) => {
                if (modalRes.confirm) {
                    this.doToggle(productId, target);
                }
                else {
                    // 取消：撤销开关视觉位移，恢复原状态
                    this.setData({ list: this.data.list.slice() });
                }
            },
            fail: () => {
                this.setData({ list: this.data.list.slice() });
            }
        });
    },
    /** 执行上下架切换 */
    async doToggle(productId, online) {
        this.setData({ togglingId: productId });
        const res = await requestSilent({
            name: 'admin',
            action: 'toggleOnline',
            data: { productId, online }
        });
        if (!res.success) {
            this.setData({ togglingId: '', list: this.data.list.slice() });
            if (PERMISSION_ERR_CODES.indexOf(res.errCode || '') !== -1) {
                wx.showToast({ title: res.errMsg || '无权限操作', icon: 'none' });
                return;
            }
            wx.showToast({ title: res.errMsg || '操作失败，请重试', icon: 'none' });
            return;
        }
        // 更新本地状态与概览统计（避免整页重载）
        const list = this.data.list.map((item) => item.productId === productId ? Object.assign(Object.assign({}, item), { online }) : item);
        const stats = Object.assign({}, this.data.stats);
        if (online) {
            stats.online += 1;
            stats.offline = Math.max(0, stats.offline - 1);
        }
        else {
            stats.offline += 1;
            stats.online = Math.max(0, stats.online - 1);
        }
        // 若当前处于"已上架/已下架"筛选下，被切换的商品可能需要移出列表
        let nextList = list;
        if (this.data.activeTab === 'online') {
            nextList = list.filter((item) => item.online);
        }
        else if (this.data.activeTab === 'offline') {
            nextList = list.filter((item) => !item.online);
        }
        this.setData({
            togglingId: '',
            stats,
            list: nextList,
            state: nextList.length > 0 ? 'success' : 'empty'
        });
        wx.showToast({ title: online ? '已上架' : '已下架', icon: 'success' });
    },
    /**
     * 同步商品：分批调用 product.syncProducts，避免单次云函数超过 60 秒上限。
     */
    async onSync() {
        if (this.data.syncing)
            return;
        this.setData({ syncing: true });
        wx.showLoading({ title: '正在同步...', mask: true });
        let cursor = 0;
        let page = 1;
        let done = false;
        let totalCategories = 0;
        const total = { added: 0, updated: 0, offlined: 0, duration: 0 };
        while (!done) {
            wx.showLoading({
                title: totalCategories > 0 ? `同步 ${Math.min(cursor, totalCategories)}/${totalCategories}` : '正在同步...',
                mask: true
            });
            const res = await requestSilent({
                name: 'product',
                action: 'syncProducts',
                data: {
                    batch: true,
                    cursor,
                    page
                }
            });
            if (!res.success) {
                wx.hideLoading();
                this.setData({ syncing: false });
                if (PERMISSION_ERR_CODES.indexOf(res.errCode || '') !== -1) {
                    wx.showToast({ title: res.errMsg || '无权限操作', icon: 'none' });
                    return;
                }
                wx.showModal({
                    title: '同步失败',
                    content: res.errMsg || '商品同步失败，请稍后重试',
                    showCancel: false,
                    confirmText: '我知道了',
                    confirmColor: PRIMARY_COLOR
                });
                return;
            }
            const data = res.data || { added: 0, updated: 0, offlined: 0, duration: 0, done: true };
            total.added += data.added || 0;
            total.updated += data.updated || 0;
            total.offlined += data.offlined || 0;
            total.duration += data.duration || 0;
            totalCategories = data.totalCategories || totalCategories;
            cursor = typeof data.nextCursor === 'number' ? data.nextCursor : cursor + 1;
            page = typeof data.nextPage === 'number' ? data.nextPage : 1;
            done = !!data.done;
        }
        wx.hideLoading();
        this.setData({ syncing: false });
        const seconds = (total.duration / 1000).toFixed(1);
        wx.showModal({
            title: '同步完成',
            content: `新增 ${total.added} 个，更新 ${total.updated} 个，自动下架 ${total.offlined} 个，累计耗时 ${seconds} 秒。`,
            showCancel: false,
            confirmText: '完成',
            confirmColor: PRIMARY_COLOR,
            success: () => {
                // 刷新列表反映同步结果
                this.loadList();
            }
        });
    }
});
