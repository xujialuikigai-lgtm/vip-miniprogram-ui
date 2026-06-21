// 商品相关类型定义

/** 套餐账号形式变体（手机号/QQ号对应不同上游 SKU） */
export interface PackageAccountVariant {
  accountType: 'phone' | 'qq';
  shunshiGoodsId: number;
  costPrice: number;
  faceValue: number;
  stock: number;
}

/** 套餐接口 */
export interface Package {
  packageId: string;
  name: string;
  memberType: string;
  price: number;
  costPrice: number;
  faceValue: number;
  shunshiGoodsId: number;
  stock: number;
  online: boolean;
  isDefault: boolean;
  sortWeight: number;
  /** 账号形式变体；存在多个时表示同时支持手机号/QQ号充值，下单按输入路由 */
  accountVariants?: PackageAccountVariant[];
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
