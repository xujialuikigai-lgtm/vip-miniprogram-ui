// 确认弹窗组件 confirm-dialog
// 封装 TDesign Popup（底部弹出），用于下单前的「购买核对」二次确认场景：
// 展示开通商品、会员类型、套餐周期、充值账号（脱敏）、应付金额，并提供确认/取消按钮。
// 通过 properties 控制显示与内容；确认/取消通过事件向父级冒泡：
//   - confirm：用户点击确认按钮（父级据此触发支付流程）
//   - cancel ：用户点击取消按钮 / 蒙层关闭弹窗
// 同时兼容通用确认场景：可仅传 title + content 文本使用。
// Requirements: 3.1, 3.6
import { formatPrice, maskAccount } from '../../utils/format';
Component({
    options: {
        // 允许使用全局样式（TDesign 主题变量）
        addGlobalClass: true,
        styleIsolation: 'apply-shared',
    },
    properties: {
        // 是否显示弹窗（受控属性，由父级控制）
        visible: {
            type: Boolean,
            value: false,
        },
        // 弹窗标题
        title: {
            type: String,
            value: '购买核对',
        },
        // 通用内容文本（购买核对场景留空，使用结构化信息行）
        content: {
            type: String,
            value: '',
        },
        // 开通商品名称
        productName: {
            type: String,
            value: '',
        },
        // 会员类型（如「会员」「SVIP」）
        memberType: {
            type: String,
            value: '',
        },
        // 套餐周期（如「连续包月」「12个月」）
        packageName: {
            type: String,
            value: '',
        },
        // 充值账号（原始值，组件内部自动脱敏展示）
        account: {
            type: String,
            value: '',
            observer(value) {
                this.setData({ maskedAccount: maskAccount(value) });
            },
        },
        // 应付金额（单位：分，组件内部转为元展示）
        amount: {
            type: Number,
            value: 0,
            observer(value) {
                this.setData({ displayAmount: formatPrice(value) });
            },
        },
        // 确认按钮文案
        confirmText: {
            type: String,
            value: '确认支付',
        },
        // 取消按钮文案
        cancelText: {
            type: String,
            value: '取消',
        },
        // 确认按钮 loading 状态（由父级控制，防止重复支付）
        confirmLoading: {
            type: Boolean,
            value: false,
        },
    },
    data: {
        // 脱敏后的充值账号
        maskedAccount: '',
        // 格式化金额（元，保留 2 位小数）
        displayAmount: '0.00',
    },
    methods: {
        /**
         * 点击确认按钮：冒泡 confirm 事件，由父级触发支付流程
         * confirmLoading 期间不再响应，避免重复下单
         */
        onConfirm() {
            if (this.data.confirmLoading)
                return;
            this.triggerEvent('confirm');
        },
        /**
         * 点击取消按钮：冒泡 cancel 事件
         */
        onCancel() {
            this.triggerEvent('cancel');
        },
        /**
         * 弹窗可见性变化（点击蒙层 / 返回手势关闭）
         * 关闭时视为取消，冒泡 cancel 事件
         */
        onVisibleChange(e) {
            const visible = e.detail && e.detail.visible;
            if (!visible) {
                this.triggerEvent('cancel');
            }
        },
    },
});
