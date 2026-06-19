// API 响应相关类型定义

/** 云函数统一返回结构 */
export interface CloudFunctionResult<T = any> {
  success: boolean;
  data?: T;
  errCode?: string;
  errMsg?: string;
}

/** 顺势 API 统一响应结构 */
export interface ShunshiResponse<T = any> {
  code: number;
  msg: string;
  data?: T;
}

/** 顺势下单响应（/api/v1/order/buy） */
export interface ShunshiOrderResponse {
  /** 顺势订单号 */
  ordersn: string;
  /** 外部订单号（下单时传入的商户订单号） */
  external_orderno: string;
}

/**
 * 顺势订单查询单项（/api/v1/order/info，接口返回 data 为数组）
 * recharge_info 为充值结果明细（n=名称 v=值 k=键）
 */
export interface ShunshiOrderInfoItem {
  /** 顺势订单号 */
  ordersn: string;
  /** 外部订单号（商户订单号） */
  external_orderno: string;
  /** 充值结果明细 */
  recharge_info?: Array<{ n: string; v: string; k: string }>;
  /** 充值提示 */
  recharge_hints?: string;
  /** 订单状态码（-1/1/2/3/4/5） */
  status: number;
  /** 卡密列表 */
  card_list?: any[];
}

/** 顺势下单模板字段（仅商品详情接口返回 attach） */
export interface ShunshiAttachField {
  /** 字段键名 */
  key: string;
  /** 字段类型：text/password/checkbox/select/radio/cascader */
  type: string;
  /** 字段提示 */
  tip: string;
  /** 字段显示名 */
  name: string;
  /** 选项（select/radio 等，原始字符串） */
  options?: string;
}

/** 顺势商品列表单项（/api/v1/goods/list 的 data.list 项） */
export interface ShunshiProductListItem {
  /** 商品 ID（注意是 id，不是 goods_id） */
  id: number;
  /** 商品名称 */
  goods_name: string;
  /** 商品图片 */
  goods_img: string;
  /** 商品类型：1卡密/2直充 */
  goods_type: number;
  /** 面值（字符串，如 "30.00"） */
  face_value: string;
  /** 售价（字符串，如 "18.00"） */
  goods_price: string;
  /** 状态：1销售中/2暂停/3禁售 */
  status: number;
  /** 库存数量 */
  stock_num: number;
}

/** 顺势商品列表响应（/api/v1/goods/list 的 data） */
export interface ShunshiProductListResponse {
  list: ShunshiProductListItem[];
  total: number;
}

/** 顺势商品详情（/api/v1/goods/info 的 data，含下单模板 attach） */
export interface ShunshiProductDetail extends ShunshiProductListItem {
  /** 商品详情富文本 */
  goods_info: string;
  /** 购买须知 */
  goods_notice: string;
  /** 起购数量 */
  start_count: number;
  /** 限购数量 */
  end_count: number;
  /** 下单模板字段 */
  attach: ShunshiAttachField[];
}

/** 顺势分类节点（/api/v1/goods/cate 的 data 直接为数组） */
export interface ShunshiCategoryNode {
  /** 分类 ID */
  id: number;
  /** 分类名称 */
  name: string;
  /** 父级 ID（0 为顶级） */
  pid: number;
  /** 分类图片 */
  img: string;
  /** 子分类（递归） */
  children?: ShunshiCategoryNode[];
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
