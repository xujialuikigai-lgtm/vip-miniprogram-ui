// 商品相关类型定义

/** 套餐接口 */
export interface Package {
  packageId: string;
  name: string;
  memberType: string;
  /** 顺势 goods_info，来自 /api/v1/goods/info */
  goodsInfo?: string;
  /** 顺势 goods_notice，来自 /api/v1/goods/info */
  goodsNotice?: string;
  price: number;
  costPrice: number;
  faceValue: number;
  shunshiGoodsId: number;
  /** 顺势接口原始 SKU 商品名，仅供管理端对账查看 */
  shunshiName?: string;
  stock: number;
  online: boolean;
  isDefault: boolean;
  sortWeight: number;
  accountVariants?: Array<{
    accountType: 'phone' | 'qq';
    shunshiGoodsId: number;
    shunshiName?: string;
    costPrice: number;
    faceValue: number;
    stock: number;
  }>;
}

/** 售前规则 */
export interface ProductRules {
  deviceSupport: string;
  arrivalTime: string;
  safetyNote: string;
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

/** 商品接口 */
export interface Product {
  _id?: string;
  productId: string;
  shunshiGoodsId: number;
  name: string;
  shunshiName: string;
  categoryId: string;
  categoryName: string;
  brandIcon: string;
  shunshiImg: string;
  /** 顺势 goods_info，来自代表 SKU 的 /api/v1/goods/info */
  goodsInfo?: string;
  /** 顺势 goods_notice，来自代表 SKU 的 /api/v1/goods/info */
  goodsNotice?: string;
  tags: string[];
  description: string;
  rechargeMethod: string;
  accountType: string;
  autoActivate: boolean;
  online: boolean;
  sortWeight: number;
  salesCount: number;
  todaySales: number;
  shunshiStatus: number;
  stockNum: number;
  attachTemplate: AttachTemplate[];
  packages: Package[];
  rules: ProductRules;
  createdAt: Date;
  updatedAt: Date;
}

/** 分类接口 */
export interface Category {
  _id?: string;
  categoryId: string;
  shunshiCateId: number;
  name: string;
  icon: string;
  parentId: string;
  level: number;
  sortWeight: number;
  productCount: number;
  showInTab: boolean;
  tabSort: number;
  createdAt: Date;
  updatedAt: Date;
}
