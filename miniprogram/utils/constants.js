// 前端常量定义
import { OrderStatus } from './types';
/** 品牌主色 */
export const PRIMARY_COLOR = '#c99a3a';
/** 辅助颜色 */
export const SECONDARY_COLOR = '#f5f0e6';
/** 背景色 */
export const BG_COLOR = '#f5f5f5';
/** 订单状态中文映射 */
export const ORDER_STATUS_MAP = {
    [OrderStatus.PENDING_PAY]: '待支付',
    [OrderStatus.PAID]: '已支付',
    [OrderStatus.ACTIVATING]: '开通中',
    [OrderStatus.SUCCESS]: '开通成功',
    [OrderStatus.API_FAILED]: '开通失败',
    [OrderStatus.REFUNDING]: '退款中',
    [OrderStatus.REFUNDED]: '已退款',
    [OrderStatus.CANCELLED]: '已取消'
};
/** 订单状态颜色映射 */
export const ORDER_STATUS_COLOR = {
    [OrderStatus.PENDING_PAY]: '#ff9800',
    [OrderStatus.PAID]: '#2196f3',
    [OrderStatus.ACTIVATING]: '#2196f3',
    [OrderStatus.SUCCESS]: '#4caf50',
    [OrderStatus.API_FAILED]: '#f44336',
    [OrderStatus.REFUNDING]: '#ff9800',
    [OrderStatus.REFUNDED]: '#9e9e9e',
    [OrderStatus.CANCELLED]: '#9e9e9e'
};
/** 首页分类 Tab 配置 */
export const CATEGORY_TAB_LIST = [
    { label: '热门', value: 'hot' },
    { label: '视频', value: 'video' },
    { label: '音乐', value: 'music' },
    { label: '网盘', value: 'cloud' },
    { label: '工具', value: 'tool' }
];
/** 订单列表筛选 Tab 配置 */
export const ORDER_TAB_LIST = [
    { label: '全部', value: 'all' },
    { label: '开通中', value: 'activating' },
    { label: '开通成功', value: 'success' },
    { label: '退款', value: 'refund' }
];
/** 管理端订单筛选 Tab 配置 */
export const ADMIN_ORDER_TAB_LIST = [
    { label: '全部', value: 'all' },
    { label: '开通中', value: 'activating' },
    { label: '接口失败', value: 'api_failed' },
    { label: '退款中', value: 'refunding' }
];
/** 搜索排序选项 */
export const SEARCH_SORT_LIST = [
    { label: '综合', value: 'default' },
    { label: '价格低', value: 'price_asc' },
    { label: '到账快', value: 'arrival_fast' },
    { label: '电视端', value: 'tv' }
];
/** 每页加载条数 */
export const PAGE_SIZE = 20;
/** 请求超时时间（毫秒） */
export const REQUEST_TIMEOUT = 10000;
/** 骨架屏超时时间（毫秒） */
export const SKELETON_TIMEOUT = 10000;
/** 播报最小展示条数 */
export const BROADCAST_MIN_DISPLAY = 5;
/** 刷新按钮防重复间隔（毫秒） */
export const REFRESH_DEBOUNCE = 5000;
/** 最大重试次数 */
export const MAX_RETRY_COUNT = 3;
