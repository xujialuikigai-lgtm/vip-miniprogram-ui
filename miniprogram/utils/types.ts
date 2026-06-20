// 前端全局类型定义

/** 订单状态枚举 */
export enum OrderStatus {
  /** 待支付 */
  PENDING_PAY = 'pending_pay',
  /** 已支付 */
  PAID = 'paid',
  /** 开通中 */
  ACTIVATING = 'activating',
  /** 开通成功 */
  SUCCESS = 'success',
  /** 接口失败 */
  API_FAILED = 'api_failed',
  /** 退款中 */
  REFUNDING = 'refunding',
  /** 已退款 */
  REFUNDED = 'refunded',
  /** 已取消 */
  CANCELLED = 'cancelled'
}

/** 时间轴节点 */
export interface TimelineNode {
  status: string;
  time: string;
  desc: string;
}

/** 套餐接口（前端精简版） */
export interface Package {
  packageId: string;
  name: string;
  memberType: string;
  price: number;
  costPrice: number;
  faceValue: number;
  stock: number;
  online: boolean;
  isDefault: boolean;
  sortWeight: number;
}

/** Attach 模板字段 */
export interface AttachTemplate {
  key: string;
  type: 'text' | 'select' | 'radio' | 'checkbox' | 'cascader';
  label: string;
  tip?: string;
  required: boolean;
  options?: Array<{ label: string; value: string }>;
}

/** 售前规则 */
export interface ProductRules {
  deviceSupport: string;
  arrivalTime: string;
  safetyNote: string;
}

/** 商品接口（前端精简版） */
export interface Product {
  _id?: string;
  productId: string;
  name: string;
  categoryId: string;
  categoryName: string;
  brandIcon: string;
  displayIcon?: string;
  shunshiImg?: string;
  shunshiName?: string;
  tags: string[];
  description: string;
  rechargeMethod: string;
  accountType: string;
  autoActivate: boolean;
  online: boolean;
  sortWeight: number;
  salesCount: number;
  todaySales: number;
  stockNum: number;
  attachTemplate: AttachTemplate[];
  packages: Package[];
  rules: ProductRules;
}

/** 分类接口（前端精简版） */
export interface Category {
  _id?: string;
  categoryId: string;
  name: string;
  icon: string;
  parentId: string;
  level: number;
  sortWeight: number;
  productCount: number;
  showInTab: boolean;
  tabSort: number;
}

/** 订单接口（前端精简版） */
export interface Order {
  _id?: string;
  orderId: string;
  productId: string;
  productName: string;
  packageId: string;
  packageName: string;
  categoryName: string;
  attach: Record<string, any>;
  amount: number;
  status: OrderStatus;
  rechargeHints?: string;
  failReason?: string;
  timeline: TimelineNode[];
  createdAt: string;
  paidAt?: string;
  activatedAt?: string;
  refundedAt?: string;
  cancelledAt?: string;
  updatedAt: string;
}

/** 播报数据（与云函数 product.getBroadcast 返回结构对齐） */
export interface BroadcastItem {
  phone: string;
  productName: string;
  /** 开通成功时间（云函数返回 createdAt，序列化为 ISO 字符串） */
  createdAt?: string;
}

/** 云函数统一返回结构 */
export interface CloudFunctionResult<T = any> {
  success: boolean;
  data?: T;
  errCode?: string;
  errMsg?: string;
}

/** 云函数调用参数 */
export interface CloudFunctionParams {
  /** 云函数名称 */
  name: string;
  /** action 名称 */
  action: string;
  /** 请求参数 */
  data?: Record<string, any>;
}

/** 分页参数 */
export interface PaginationParams {
  page: number;
  pageSize: number;
}

/** 分页结果 */
export interface PaginationResult<T> {
  list: T[];
  total: number;
}

/** 页面加载状态 */
export enum PageState {
  /** 加载中 */
  LOADING = 'loading',
  /** 加载成功 */
  SUCCESS = 'success',
  /** 加载失败 */
  ERROR = 'error',
  /** 空数据 */
  EMPTY = 'empty'
}

/** Tab 配置项 */
export interface TabItem {
  label: string;
  value: string;
  icon?: string;
  badge?: number;
}

/** 系统配置项 */
export interface SystemConfig {
  key: string;
  value: any;
  label: string;
}

/** 管理端看板统计 */
export interface DashboardStats {
  todaySales: number;
  todayOrders: number;
  successRate: number;
  failedCount: number;
}

/** 用户订单统计 */
export interface OrderStats {
  total: number;
  activating: number;
  refunding: number;
}
