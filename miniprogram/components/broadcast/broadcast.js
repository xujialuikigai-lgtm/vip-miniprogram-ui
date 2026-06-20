// 购买播报组件 broadcast
// 接收最近开通成功的订单列表，以"{脱敏手机号} 刚刚购买 {商品名}"格式
// 垂直滚动轮播展示，每 3~5 秒随机间隔切换一条；
// 当数据少于 minCount（默认 5 条）时整体隐藏，不展示空播报。
// Requirements: 1.8, 22.3, 22.4, 22.5
import { maskPhone } from '../../utils/format';
/** 轮播最小间隔（毫秒） */
const MIN_INTERVAL = 3000;
/** 轮播最大间隔（毫秒） */
const MAX_INTERVAL = 5000;
/**
 * 生成 [MIN_INTERVAL, MAX_INTERVAL] 之间的随机间隔
 */
function randomInterval() {
    return MIN_INTERVAL + Math.floor(Math.random() * (MAX_INTERVAL - MIN_INTERVAL + 1));
}
Component({
    options: {
        addGlobalClass: true,
        styleIsolation: 'apply-shared',
    },
    properties: {
        // 播报数据列表 [{ phone, productName }]
        dataList: {
            type: Array,
            value: [],
            observer(value) {
                this.rebuild(value);
            },
        },
        // 少于该数量时隐藏整个播报模块（默认 5，满足需求 22.5）
        minCount: {
            type: Number,
            value: 5,
            observer() {
                this.rebuild(this.data.rawList);
            },
        },
    },
    data: {
        // 处理后的展示列表
        displayList: [],
        // 原始列表缓存
        rawList: [],
        // 当前展示索引
        index: 0,
        // 轮播轨道纵向偏移（rpx）
        offset: 0,
        // 是否可见（数量达标时为 true）
        visible: false,
        // 单条高度（rpx），需与样式保持一致
        itemHeight: 56,
    },
    lifetimes: {
        detached() {
            // 销毁时清理计时器
            this.clearTimer();
        },
    },
    pageLifetimes: {
        // 页面隐藏时暂停轮播，显示时恢复，避免后台空跑
        hide() {
            this.clearTimer();
        },
        show() {
            if (this.data.visible)
                this.scheduleNext();
        },
    },
    methods: {
        /**
         * 重建展示列表：脱敏手机号 + 判断是否达到展示阈值
         */
        rebuild(list) {
            const raw = Array.isArray(list) ? list : [];
            const displayList = raw.map((item) => ({
                maskedPhone: maskPhone(String(item.phone || '')),
                productName: String(item.productName || ''),
            }));
            const visible = displayList.length >= Number(this.data.minCount);
            this.clearTimer();
            this.setData({
                rawList: raw,
                displayList,
                visible,
                index: 0,
                offset: 0,
            }, () => {
                // 达标且多于一条时启动轮播
                if (visible && displayList.length > 1) {
                    this.scheduleNext();
                }
            });
        },
        /**
         * 安排下一次切换（随机 3~5 秒）
         */
        scheduleNext() {
            this.clearTimer();
            this._timer = setTimeout(() => {
                this.next();
                this.scheduleNext();
            }, randomInterval());
        },
        /**
         * 切换到下一条，到末尾后回到第一条
         */
        next() {
            const len = this.data.displayList.length;
            if (len <= 1)
                return;
            const index = (this.data.index + 1) % len;
            this.setData({
                index,
                offset: -index * this.data.itemHeight,
            });
        },
        /**
         * 清理轮播计时器
         */
        clearTimer() {
            if (this._timer) {
                clearTimeout(this._timer);
                this._timer = null;
            }
        },
    },
});
