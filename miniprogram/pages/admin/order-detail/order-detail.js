// 管理端 - 订单详情处理页
// 展示完整订单信息（含完整手机号，已通过管理员权限校验）、状态时间轴、接口调用日志，
// 并按后端返回的 actions 状态显隐三类操作：重试开通（最多3次）、查询接口、发起退款。
// 发起退款需先选择失败原因分类 + 补充说明，再经 confirm-dialog 二次确认后调用。
// 复用 timeline、confirm-dialog 组件与 utils（request / format / constants / types）。
// 调用 admin 云函数：orderDetail / retryActivation / queryShunshi / initiateRefund。
// Requirements: 8.3, 8.4, 8.5, 8.6, 8.7, 6.1
import { requestSilent } from '../../../utils/request';
import { formatTime } from '../../../utils/format';
import { ORDER_STATUS_MAP, ORDER_STATUS_COLOR } from '../../../utils/constants';
import { PageState } from '../../../utils/types';
/** 退款失败原因分类选项（reason 为提交给后端的字符串值） */
const REFUND_REASONS = [
    { label: '接口开通失败', value: '接口开通失败' },
    { label: '账号信息有误', value: '账号信息有误' },
    { label: '商品库存不足', value: '商品库存不足' },
    { label: '用户申请退款', value: '用户申请退款' },
    { label: '其他原因', value: '其他原因' }
];
/** 补充说明最大长度（与后端 NOTE_MAX_LENGTH 保持一致） */
const NOTE_MAX_LENGTH = 200;
/** 权限相关错误码：命中后引导返回，避免无效停留 */
const PERMISSION_ERR_CODES = ['NO_PERMISSION', 'MISSING_IDENTITY', 'AUTH_SYSTEM_ERROR'];
/** 充值账号在 attach 中的候选字段（按优先级匹配） */
const ACCOUNT_KEYS = ['recharge_account', 'account', 'phone', 'mobile', 'qq', 'email', 'username'];
/**
 * 从订单 attach 中提取充值账号（管理端展示完整值，不脱敏）
 * @param order 订单数据
 */
function extractAccount(order) {
    const attach = order && order.attach;
    if (!attach || typeof attach !== 'object')
        return '';
    for (const key of ACCOUNT_KEYS) {
        const val = attach[key];
        if (typeof val === 'string' && val.trim())
            return val.trim();
        if (typeof val === 'number')
            return String(val);
    }
    // 兜底：取第一个非空字符串值
    for (const key of Object.keys(attach)) {
        const val = attach[key];
        if (typeof val === 'string' && val.trim())
            return val.trim();
    }
    return '';
}
/** 金额保留两位小数（后端返回单位为元，直接展示，不做分→元转换） */
function toMoney(n) {
    const v = typeof n === 'number' && !isNaN(n) ? n : 0;
    return v.toFixed(2);
}
Page({
    data: {
        // 页面状态：loading / success / error
        pageState: PageState.LOADING,
        PageState,
        // 订单数据
        order: null,
        // 时间轴节点（传给 timeline 组件，使用订单原始节点以便组件自行格式化时间）
        timeline: [],
        // 接口调用日志
        logs: [],
        // 操作按钮状态
        actions: {
            canRetry: false,
            retryCount: 0,
            maxRetry: 3,
            canQuery: false,
            canRefund: false
        },
        // 状态文案与颜色
        statusText: '',
        statusColor: '#9e9e9e',
        // 完整充值账号
        account: '',
        // 金额展示（元）
        amountText: '0.00',
        costText: '0.00',
        profitText: '0.00',
        // 利润是否为负（亏损，红色提示）
        profitLoss: false,
        // 时间展示
        createdTimeText: '',
        updatedTimeText: '',
        // 操作按钮 loading 状态
        retrying: false,
        querying: false,
        refunding: false,
        // 退款表单弹窗
        refundFormVisible: false,
        refundReasons: REFUND_REASONS,
        selectedReason: '',
        refundNote: '',
        noteMaxLength: NOTE_MAX_LENGTH,
        // 退款二次确认弹窗（confirm-dialog）
        confirmVisible: false,
        confirmContent: ''
    },
    // 当前订单号（不参与渲染）
    _orderId: '',
    onLoad(options) {
        // 正确使用 options.orderId，避免参数未使用告警
        this._orderId = (options && options.orderId) || '';
        if (!this._orderId) {
            this.setData({ pageState: PageState.ERROR });
            return;
        }
        this.loadDetail();
    },
    /**
     * 加载订单详情（8.3 / 8.7）
     */
    async loadDetail() {
        this.setData({ pageState: PageState.LOADING });
        const res = await requestSilent({
            name: 'admin',
            action: 'orderDetail',
            data: { orderId: this._orderId }
        });
        if (this.handlePermissionError(res))
            return;
        if (!res.success || !res.data) {
            this.setData({ pageState: PageState.ERROR });
            return;
        }
        this.applyDetail(res.data);
        this.setData({ pageState: PageState.SUCCESS });
    },
    /**
     * 将接口返回数据映射为页面展示字段
     * @param data 订单详情数据
     */
    applyDetail(data) {
        const order = data.order;
        const status = order.status;
        const amount = order.amount || 0;
        const costPrice = order.costPrice || 0;
        const profit = Math.round((amount - costPrice) * 100) / 100;
        this.setData({
            order,
            // 使用订单原始时间轴节点，交由 timeline 组件按 ISO 时间格式化（兼容 iOS）
            timeline: order.timeline || [],
            logs: data.logs || [],
            actions: data.actions || this.data.actions,
            statusText: ORDER_STATUS_MAP[status] || status,
            statusColor: ORDER_STATUS_COLOR[status] || '#9e9e9e',
            account: extractAccount(order) || '—',
            amountText: toMoney(amount),
            costText: toMoney(costPrice),
            profitText: toMoney(profit),
            profitLoss: profit < 0,
            createdTimeText: formatTime(order.createdAt),
            updatedTimeText: order.updatedAt ? formatTime(order.updatedAt) : ''
        });
    },
    /**
     * 统一处理权限相关错误：命中后弹窗提示并返回上一页
     * @returns 是否已作为权限错误处理（true 表示已拦截）
     */
    handlePermissionError(res) {
        if (res.success || !res.errCode || PERMISSION_ERR_CODES.indexOf(res.errCode) === -1) {
            return false;
        }
        wx.showModal({
            title: '无权限',
            content: res.errMsg || '无权限访问管理端功能',
            showCancel: false,
            confirmColor: '#c99a3a',
            success: () => {
                wx.navigateBack({ delta: 1 });
            }
        });
        return true;
    },
    /**
     * 重试开通（8.4 / 8.5）
     * 达到最大重试次数时后端返回 data.success=false 并附提示文案
     */
    async onRetryActivation() {
        if (this.data.retrying || !this.data.actions.canRetry)
            return;
        this.setData({ retrying: true });
        const res = await requestSilent({
            name: 'admin',
            action: 'retryActivation',
            data: { orderId: this._orderId }
        });
        this.setData({ retrying: false });
        if (this.handlePermissionError(res))
            return;
        if (!res.success) {
            wx.showToast({ title: res.errMsg || '重试开通失败，请稍后重试', icon: 'none' });
            return;
        }
        // 业务结果提示（含已达上限提示）
        const msg = (res.data && res.data.msg) || '操作完成';
        wx.showToast({ title: msg, icon: 'none' });
        // 刷新详情，更新状态、时间轴、接口日志与按钮状态
        this.loadDetail();
    },
    /**
     * 查询接口状态（8.6）
     */
    async onQueryShunshi() {
        if (this.data.querying || !this.data.actions.canQuery)
            return;
        this.setData({ querying: true });
        const res = await requestSilent({
            name: 'admin',
            action: 'queryShunshi',
            data: { orderId: this._orderId }
        });
        this.setData({ querying: false });
        if (this.handlePermissionError(res))
            return;
        if (!res.success) {
            wx.showToast({ title: res.errMsg || '查询接口失败，请稍后重试', icon: 'none' });
            return;
        }
        wx.showToast({ title: '查询成功，状态已更新', icon: 'none' });
        this.loadDetail();
    },
    /**
     * 打开退款表单弹窗（6.1）
     */
    onShowRefund() {
        if (!this.data.actions.canRefund)
            return;
        this.setData({
            refundFormVisible: true,
            selectedReason: '',
            refundNote: ''
        });
    },
    /**
     * 退款表单弹窗可见性变化（点击蒙层 / 手势关闭）
     */
    onRefundFormVisibleChange(e) {
        const visible = !!(e.detail && e.detail.visible);
        if (!visible) {
            this.setData({ refundFormVisible: false });
        }
    },
    /**
     * 取消退款表单
     */
    onRefundFormCancel() {
        this.setData({ refundFormVisible: false });
    },
    /**
     * 选择失败原因分类
     */
    onReasonChange(e) {
        this.setData({ selectedReason: e.detail.value });
    },
    /**
     * 输入补充说明
     */
    onNoteInput(e) {
        const value = (e.detail && e.detail.value) || '';
        this.setData({ refundNote: String(value).slice(0, NOTE_MAX_LENGTH) });
    },
    /**
     * 退款表单「下一步」：校验已选原因后，打开二次确认弹窗
     */
    onRefundFormNext() {
        if (!this.data.selectedReason) {
            wx.showToast({ title: '请选择失败原因分类', icon: 'none' });
            return;
        }
        const order = this.data.order;
        const amountText = order ? toMoney(order.amount) : this.data.amountText;
        const note = this.data.refundNote ? `\n补充说明：${this.data.refundNote}` : '';
        this.setData({
            refundFormVisible: false,
            confirmVisible: true,
            confirmContent: `将按原路退回实付金额 ¥${amountText}\n失败原因：${this.data.selectedReason}${note}\n退款发起后不可撤销，请确认。`
        });
    },
    /**
     * 二次确认弹窗 - 取消
     */
    onConfirmCancel() {
        this.setData({ confirmVisible: false });
    },
    /**
     * 二次确认弹窗 - 确认发起退款（6.1）
     */
    async onConfirmRefund() {
        if (this.data.refunding)
            return;
        this.setData({ refunding: true });
        const res = await requestSilent({
            name: 'admin',
            action: 'initiateRefund',
            data: {
                orderId: this._orderId,
                reason: this.data.selectedReason,
                note: this.data.refundNote
            }
        });
        this.setData({ refunding: false, confirmVisible: false });
        if (this.handlePermissionError(res))
            return;
        if (!res.success) {
            wx.showToast({ title: res.errMsg || '退款发起失败，请稍后重试', icon: 'none' });
            return;
        }
        wx.showToast({ title: '退款已发起', icon: 'success' });
        this.loadDetail();
    },
    /**
     * 复制订单号 / 三方单号
     */
    onCopy(e) {
        const text = (e.currentTarget.dataset && e.currentTarget.dataset.text) || '';
        if (!text)
            return;
        wx.setClipboardData({
            data: String(text),
            success: () => wx.showToast({ title: '已复制', icon: 'none' })
        });
    },
    /**
     * 加载失败重试
     */
    onReload() {
        this.loadDetail();
    }
});
