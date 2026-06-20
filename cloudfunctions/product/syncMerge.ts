/**
 * 商品同步字段合并纯逻辑
 * 从 updateExistingProduct 中提取的纯函数，用于属性测试
 *
 * 核心规则：
 * - 管理员已配置字段（name、sortWeight、online（status=1时）、packages[].price）保持不变
 * - 仅更新顺势字段（shunshiName、shunshiImg、shunshiStatus、stockNum）
 * - 匹配套餐的 costPrice/faceValue/stock 更新，price 保留
 * - status=2/3 自动下架
 */

import { Product, Package } from './shared/types/product';
import { ShunshiProductStatus } from './shared/constants';

/** 顺势商品数据（来自 API，字段名与列表/详情一致） */
export interface ShunshiProductData {
  /** 商品 ID（注意是 id，不是 goods_id） */
  id: number;
  goods_name: string;
  goods_img: string;
  /** 售价（字符串，如 "18.00"） */
  goods_price: string;
  /** 面值（字符串，如 "30.00"） */
  face_value: string;
  status: number;
  stock_num: number;
}

/** 合并后的更新数据 */
export interface MergeUpdateData {
  shunshiName: string;
  brandIcon: string;
  shunshiImg: string;
  shunshiStatus: number;
  stockNum: number;
  packages: Package[];
  updatedAt: Date;
  categoryId?: string;
  categoryName?: string;
  online?: boolean;
}

/**
 * 计算商品同步更新数据（纯函数，不含数据库操作）
 * @param existing 已存在的本地商品
 * @param sp 顺势 API 返回的商品数据
 * @returns { data: 更新字段对象, offlinedDelta: 自动下架计数增量 }
 */
export function computeSyncUpdateData(
  existing: Product,
  sp: ShunshiProductData
): { data: MergeUpdateData; offlinedDelta: number } {
  const now = new Date();

  // 更新匹配套餐的顺势字段，保留管理员售价 price
  // 顺势 goods_price/face_value 为字符串，用 Number() 转为数字存储
  const packages: Package[] = (existing.packages || []).map((pkg) => {
    if (pkg.shunshiGoodsId === sp.id) {
      return {
        ...pkg,
        costPrice: Number(sp.goods_price),
        faceValue: Number(sp.face_value),
        stock: Number(sp.stock_num)
      };
    }
    return pkg;
  });

  const data: MergeUpdateData = {
    shunshiName: sp.goods_name,
    brandIcon: toHttpsImageUrl(sp.goods_img),
    shunshiImg: sp.goods_img,
    shunshiStatus: sp.status,
    stockNum: Number(sp.stock_num),
    packages,
    updatedAt: now
  };

  // 顺势暂停/禁售自动下架；仅当原本为上架才计入下架数
  let offlinedDelta = 0;
  if (
    sp.status === ShunshiProductStatus.PAUSED ||
    sp.status === ShunshiProductStatus.FORBIDDEN
  ) {
    data.online = false;
    if (existing.online) {
      offlinedDelta = 1;
    }
  }
  // status=1（销售中）不修改 online，保留管理员手动下架决定

  return { data, offlinedDelta };
}

function toHttpsImageUrl(url: string): string {
  const value = String(url || '').trim();
  if (!value) return '';
  if (/^http:\/\//i.test(value)) {
    return value.replace(/^http:\/\//i, 'https://');
  }
  return value;
}
