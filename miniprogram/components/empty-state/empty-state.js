"use strict";
// 空状态组件 empty-state
// 在列表为空、搜索无结果等场景展示统一的空状态占位：
// 支持自定义图标（图片 URL 或 emoji/文本）、主文案、辅助说明，
// 以及可选的引导操作按钮（点击向父级冒泡 action 事件）。
// Requirements: 1.7, 16.1, 16.2
Component({
    options: {
        addGlobalClass: true,
        styleIsolation: 'apply-shared',
    },
    properties: {
        // 图标：以 http 开头视为图片 URL，否则按 emoji/文本展示
        icon: {
            type: String,
            value: '📭',
        },
        // 主文案（如"还没有订单""没有找到相关会员"）
        description: {
            type: String,
            value: '暂无数据',
            observer() {
                this.updateState();
            },
        },
        // 辅助说明（可选，展示在主文案下方的小字）
        tip: {
            type: String,
            value: '',
        },
        // 引导按钮文案（为空时不展示按钮）
        buttonText: {
            type: String,
            value: '',
            observer() {
                this.updateState();
            },
        },
    },
    data: {
        // 图标是否为图片 URL
        isImage: false,
        // 是否展示引导按钮
        showButton: false,
    },
    lifetimes: {
        attached() {
            this.updateState();
        },
    },
    observers: {
        icon(icon) {
            this.setData({ isImage: /^https?:\/\//.test(icon || '') });
        },
    },
    methods: {
        /**
         * 计算图标类型与按钮显隐
         */
        updateState() {
            this.setData({
                isImage: /^https?:\/\//.test(this.data.icon || ''),
                showButton: !!this.data.buttonText,
            });
        },
        /**
         * 点击引导按钮：向父级冒泡 action 事件
         */
        onActionTap() {
            this.triggerEvent('action');
        },
    },
});
