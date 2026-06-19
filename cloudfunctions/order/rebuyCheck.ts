// 再买一次验证逻辑
import { Product, Package } from './shared/types/product';
import { CloudFunctionResult } from './shared/types/api';

/** 再买一次验证入参 */
export interface RebuyCheckParams {
  /** 本地商品ID */
  productId: string;
  /** 套餐ID（可选，传入则一并校验套餐是否可购买） */
  packageId?: string;
}

/** 再买一次验证返回数据 */
export interface RebuyCheckData {
  /** 商品（及套餐）是否仍可购买 */
  available: boolean;
  /** 商品完整信息（不存在时为 null） */
  product: Product | null;
  /** 不可购买时的原因说明 */
  reason?: string;
}

/**
 * 验证商品/套餐是否仍然上架可购买（再买一次）
 *
 * 业务规则（需求 7.6、7.7）：
 * - 商品不存在或已下架 → available=false
 * - 指定套餐不存在或已下架 → available=false
 * - 均上架 → available=true，并返回商品完整信息供前端自动选中套餐
 *
 * @param db - 云数据库实例
 * @param params - 验证入参
 */
export async function rebuyCheck(
  db: any,
  params: RebuyCheckParams
): Promise<CloudFunctionResult<RebuyCheckData>> {
  if (!params.productId) {
    return { success: false, errCode: 'INVALID_PARAMS', errMsg: '缺少商品参数' };
  }

  // 查询商品
  const res = await db
    .collection('products')
    .where({ productId: params.productId })
    .limit(1)
    .get();
  const product: Product | undefined = res.data && res.data[0];

  // 商品不存在
  if (!product) {
    return {
      success: true,
      data: { available: false, product: null, reason: '该商品暂不可购买，可返回分类选择其他商品' }
    };
  }

  // 商品已下架
  if (!product.online) {
    return {
      success: true,
      data: { available: false, product, reason: '该商品暂不可购买，可返回分类选择其他商品' }
    };
  }

  // 指定了套餐则校验套餐可购买
  if (params.packageId) {
    const pkg: Package | undefined = (product.packages || []).find(
      (p) => p.packageId === params.packageId
    );
    if (!pkg || !pkg.online) {
      return {
        success: true,
        data: { available: false, product, reason: '该商品暂不可购买，可返回分类选择其他商品' }
      };
    }
  }

  // 商品（及套餐）均可购买
  return { success: true, data: { available: true, product } };
}
