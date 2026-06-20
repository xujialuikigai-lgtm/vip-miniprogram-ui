// 订单状态时间轴组件 timeline
// 通过 properties 接收 timeline 节点数组（{ status, time, desc }），
// 按时间正序渲染竖向时间轴；每个节点展示状态文案、时间与描述。
// 已发生节点为已完成态（实心、深色），最新一个节点为当前节点（高亮主题色）。
// 复用 utils/constants 的订单状态映射/颜色 与 utils/format 的时间格式化。
// Requirements: 7.8, 20.3
import { ORDER_STATUS_MAP, ORDER_STATUS_COLOR, PRIMARY_COLOR } from '../../utils/constants';
import { formatTime } from '../../utils/format';
/**
 * 安全解析时间为毫秒数，无法解析时返回 0（排到最前）
 */
function parseTime(time) {
    const t = new Date(time).getTime();
    return isNaN(t) ? 0 : t;
}
/**
 * 将状态值转换为中文文案：
 * - 若 status 命中订单状态枚举，返回对应中文
 * - 否则视为已是可读文案，原样返回
 */
function toStatusText(status) {
    return ORDER_STATUS_MAP[status] || status || '';
}
/**
 * 获取状态颜色，未命中枚举时回退到主题色
 */
function toStatusColor(status) {
    return ORDER_STATUS_COLOR[status] || PRIMARY_COLOR;
}
Component({
    options: {
        // 允许使用全局样式（TDesign 主题变量）
        addGlobalClass: true,
        // 支持外部传入 class 控制布局
        styleIsolation: 'apply-shared',
    },
    properties: {
        // 时间轴节点数组，元素结构 { status, time, desc }
        timeline: {
            type: Array,
            value: [],
            observer(value) {
                this.updateNodes(value, this.data.timeFormat);
            },
        },
        // 时间展示格式：'full' → YYYY-MM-DD HH:mm:ss；'time' → HH:mm:ss
        timeFormat: {
            type: String,
            value: 'full',
            observer(value) {
                this.updateNodes(this.data.timeline, value);
            },
        },
    },
    data: {
        // 处理后的展示节点列表（已按时间正序排列）
        nodes: [],
    },
    methods: {
        /**
         * 根据原始 timeline 计算展示节点：
         * 1. 过滤空节点
         * 2. 按时间正序排序
         * 3. 计算状态文案/颜色/时间字符串
         * 4. 最后一个节点标记为当前节点
         */
        updateNodes(timeline, timeFormat) {
            const list = Array.isArray(timeline) ? timeline.filter((n) => !!n) : [];
            // 按时间正序排序（不修改原数组）
            const sorted = list.slice().sort((a, b) => parseTime(a.time) - parseTime(b.time));
            const lastIndex = sorted.length - 1;
            const nodes = sorted.map((node, index) => {
                // 完整时间 YYYY-MM-DD HH:mm:ss；'time' 模式仅取时分秒
                const full = formatTime(node.time);
                const timeStr = timeFormat === 'time' ? full.slice(11) : full;
                return {
                    statusText: toStatusText(node.status),
                    statusColor: toStatusColor(node.status),
                    timeStr,
                    desc: node.desc || '',
                    isCurrent: index === lastIndex,
                };
            });
            this.setData({ nodes });
        },
    },
});
