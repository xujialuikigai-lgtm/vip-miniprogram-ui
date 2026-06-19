// 订单相关类型定义

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
  time: Date;
  desc: string;
}

/** 订单接口 */
export interface Order {
  _id?: string;
  orderId: string;
  openid: string;
  productId: string;
  productName: string;
  packageId: string;
  packageName: string;
  categoryName: string;
  attach: Record<string, any>;
  amount: number;
  costPrice: number;
  status: OrderStatus;
  shunshiOrderSn?: string;
  shunshiGoodsId?: number;
  shunshiStatus?: number;
  rechargeHints?: string;
  failReason?: string;
  refundReason?: string;
  refundNote?: string;
  retryCount: number;
  payTransactionId?: string;
  refundId?: string;
  timeline: TimelineNode[];
  createdAt: Date;
  paidAt?: Date;
  activatedAt?: Date;
  refundedAt?: Date;
  cancelledAt?: Date;
  updatedAt: Date;
}
