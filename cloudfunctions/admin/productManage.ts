// 管理端商品管理接口实现
// 设计依据：Requirements 9.1 - 9.9
//
// 包含 action：
// - productList   商品列表 + 概览统计（全部/已上架/已下架），含单单利润计算（9.1、9.2）
// - productSave   商品编辑保存，复用 validateProductForm 校验，售价低于成本返回亏损警告（9.5、9.6、9.9）
// - toggleOnline  上下架切换，下架后用户端不再展示（9.3、9.4）
// - getConfigs    获取系统配置列表
// - updateConfig  更新系统配置
//
// 说明：商品价格、成本、利润单位均为元；金额计算统一保留2位小数。

import { CloudFunctionResult } from './shared/types/api';
import { Product, Package } from './shared/types/product';
import { SystemConfig, ConfigKey } from './shared/types/config';
import { AuditType } from './shared/types/audit';
import { createAuditLog, writeAuditLog } from './shared/utils/logger';
import { validateProductForm } from './shared/utils/validator';
import { PRODUCT_NAME_MAX_LENGTH } from './shared/constants';

/** 商品集合名 */
const PRODUCT_COLLECTION = 'products';

/** 系统配置集合名 */
const CONFIG_COLLECTION = 'system_config';

/** 会员多多目标分类，管理端商品运营只展示这些分类下的商品 */
const TARGET_CATEGORY_IDS = [
  'target_video',
  'target_music',
  'target_audio_book',
  'target_cloud',
  'target_tool',
  'target_fitness',
  'target_bike'
];

/** 排序权重取值范围（9.5） */
const SORT_WEIGHT_MIN = 0;
const SORT_WEIGHT_MAX = 9999;

/** 套餐售价上限（9.6，单位：元） */
const PACKAGE_PRICE_MAX = 99999.99;

/** 单次查询分页大小与防御性总量上限 */
const PAGE_SIZE = 100;
const MAX_RECORDS = 2000;

/** 操作者身份信息 */
export interface Operator {
  /** 操作者 openid */
  openid: string;
  /** 操作者名称（可选，缺省时审计日志使用 openid） */
  name?: string;
}

/* ============================================================
 * 商品列表（9.1、9.2）
 * ============================================================ */

/** 商品列表概览统计 */
export interface ProductStats {
  /** 商品总数 */
  total: number;
  /** 已上架数量 */
  online: number;
  /** 已下架数量 */
  offline: number;
}

/** 商品列表单项（用于商品卡片展示） */
export interface ProductListItem {
  productId: string;
  name: string;
  /** 上架状态 */
  online: boolean;
  /** 售价（默认套餐售价，元） */
  price: number;
  /** 接口成本（默认套餐成本，元） */
  costPrice: number;
  /** 单单利润（售价 - 接口成本，元） */
  profit: number;
  /** 接口商品ID */
  shunshiGoodsId: number;
  /** 商品分类 */
  categoryName: string;
  /** 待配置套餐数 */
  pendingPackages: number;
  /** 可售套餐数 */
  sellablePackages: number;
  /** 今日销量 */
  todaySales: number;
  /** 排序权重 */
  sortWeight: number;
}

/** 商品列表出参 */
export interface ProductListResult {
  list: ProductListItem[];
  stats: ProductStats;
}

/**
 * 商品列表入口
 *
 * @param db    云数据库实例
 * @param event 入参，可选 status：'all' | 'online' | 'offline'（默认 all）
 *
 * 概览统计始终基于全部商品计算；list 按 status 过滤后返回。
 */
export async function handleProductList(
  db: any,
  event: any
): Promise<CloudFunctionResult<ProductListResult>> {
  const status: string = (event && event.status) || 'all';
  const products = await fetchAllProducts(db);

  // 概览统计（全部/已上架/已下架）始终基于全量商品
  const stats: ProductStats = {
    total: products.length,
    online: products.filter((p) => p.online).length,
    offline: products.filter((p) => !p.online).length,
  };

  // 按状态过滤待展示列表
  const filtered = products.filter((p) => {
    if (status === 'online') {
      return p.online;
    }
    if (status === 'offline') {
      return !p.online;
    }
    return true;
  });

  // 按排序权重降序、今日销量降序展示
  filtered.sort((a, b) => {
    const w = (b.sortWeight || 0) - (a.sortWeight || 0);
    return w !== 0 ? w : (b.todaySales || 0) - (a.todaySales || 0);
  });

  const list: ProductListItem[] = filtered.map((p) => {
    const pkg = pickDefaultPackage(p.packages);
    const price = pkg ? round2(pkg.price) : 0;
    const costPrice = pkg ? round2(pkg.costPrice) : 0;
    const packages = p.packages || [];
    const sellablePackages = packages.filter(
      (item: Package) => item.online !== false && typeof item.price === 'number' && item.price > 0
    ).length;
    const pendingPackages = packages.filter(
      (item: Package) => !item.price || item.price <= 0 || item.online === false
    ).length;
    return {
      productId: p.productId,
      name: p.name,
      online: !!p.online,
      price,
      costPrice,
      // 单单利润 = 售价 - 接口成本
      profit: round2(price - costPrice),
      shunshiGoodsId: p.shunshiGoodsId,
      categoryName: p.categoryName || '',
      pendingPackages,
      sellablePackages,
      todaySales: p.todaySales || 0,
      sortWeight: p.sortWeight || 0,
    };
  });

  return { success: true, data: { list, stats } };
}

/* ============================================================
 * 商品编辑保存（9.5、9.6、9.9）
 * ============================================================ */

/** 商品保存出参 */
export interface ProductSaveResult {
  /** 保存后的商品ID */
  productId: string;
  /** 是否为新增 */
  isNew: boolean;
  /** 亏损警告信息（存在售价低于成本的套餐时返回，不阻止保存，9.9） */
  warning?: string;
}

/**
 * 商品编辑保存入口
 *
 * 校验顺序：
 * 1. 复用 validateProductForm 做必填项 / 套餐数量 / 默认套餐 / 上架套餐售价校验（9.6）
 * 2. 管理端补充校验：商品名长度、排序权重范围、套餐售价上限（9.5、9.6）
 * 3. 售价低于成本仅返回亏损警告，不阻止保存（9.9）
 *
 * 价格调整仅对后续新订单生效，不回溯已有订单（9.7：订单已锁定下单时价格，此处无需处理）。
 *
 * @param db       云数据库实例
 * @param event    入参 { product }
 * @param operator 操作者身份
 */
export async function handleProductSave(
  db: any,
  event: any,
  operator: Operator
): Promise<CloudFunctionResult<ProductSaveResult>> {
  const product: Partial<Product> = (event && event.product) || {};

  // 1. 复用通用表单完整性校验
  const base = validateProductForm(product);
  const errors = [...base.errors];

  // 2. 管理端补充校验
  if (product.name && product.name.trim().length > PRODUCT_NAME_MAX_LENGTH) {
    errors.push(`商品名称不能超过${PRODUCT_NAME_MAX_LENGTH}个字符`);
  }
  if (
    product.sortWeight !== undefined &&
    (typeof product.sortWeight !== 'number' ||
      product.sortWeight < SORT_WEIGHT_MIN ||
      product.sortWeight > SORT_WEIGHT_MAX)
  ) {
    errors.push(`排序权重需在${SORT_WEIGHT_MIN}-${SORT_WEIGHT_MAX}之间`);
  }
  if (Array.isArray(product.packages)) {
    const overPrice = product.packages.some((pkg) => pkg.price > PACKAGE_PRICE_MAX);
    if (overPrice) {
      errors.push(`套餐售价不能超过${PACKAGE_PRICE_MAX}元`);
    }
  }

  if (errors.length > 0) {
    return {
      success: false,
      errCode: 'INVALID_PRODUCT',
      errMsg: errors.join('；'),
    };
  }

  // 3. 亏损警告（不阻止保存）
  const hasLoss = (product.packages || []).some((pkg) => pkg.price < pkg.costPrice);
  const warning = hasLoss ? '售价低于成本，将产生亏损' : undefined;

  // 判断新增或更新：有 productId 视为更新
  const isNew = !product.productId;
  const productId = product.productId || generateProductId();
  const now = new Date();

  try {
    if (isNew) {
      // 新增：写入完整文档
      const doc = {
        ...product,
        productId,
        online: product.online !== undefined ? product.online : false,
        salesCount: product.salesCount || 0,
        todaySales: product.todaySales || 0,
        createdAt: now,
        updatedAt: now,
      };
      await db.collection(PRODUCT_COLLECTION).add({ data: doc });
    } else {
      // 更新：按 productId 定位，更新可编辑字段（不覆盖 createdAt）
      const updateData: Record<string, any> = { ...product, updatedAt: now };
      delete updateData._id;
      delete updateData.createdAt;
      await db
        .collection(PRODUCT_COLLECTION)
        .where({ productId })
        .update({ data: updateData });
    }

    // 写审计日志
    await writeAudit(db, operator, {
      type: AuditType.PRODUCT_UPDATE,
      productId,
      action: isNew ? '新增商品' : '编辑商品',
      result: 'success',
      detail: {
        name: product.name,
        online: product.online,
        packageCount: (product.packages || []).length,
        hasLoss,
      },
    });

    return { success: true, data: { productId, isNew, warning } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await writeAudit(db, operator, {
      type: AuditType.PRODUCT_UPDATE,
      productId,
      action: isNew ? '新增商品' : '编辑商品',
      result: 'failed',
      errorMsg: msg,
    });
    return { success: false, errCode: 'SAVE_FAILED', errMsg: `商品保存失败：${msg}` };
  }
}

/* ============================================================
 * 上下架切换（9.3、9.4）
 * ============================================================ */

/**
 * 上下架切换入口
 *
 * 下架后该商品在用户端不再展示（用户端查询以 online=true 为条件，此处仅更新状态字段）。
 *
 * @param db       云数据库实例
 * @param event    入参 { productId, online }
 * @param operator 操作者身份
 */
export async function handleToggleOnline(
  db: any,
  event: any,
  operator: Operator
): Promise<CloudFunctionResult<{ productId: string; online: boolean }>> {
  const productId: string = event && event.productId;
  const online: boolean = !!(event && event.online);

  if (!productId) {
    return { success: false, errCode: 'INVALID_PARAM', errMsg: '缺少 productId' };
  }

  try {
    const productRes = await db
      .collection(PRODUCT_COLLECTION)
      .where({ productId })
      .limit(1)
      .get();
    const product = productRes && productRes.data && productRes.data[0] as Product | undefined;
    if (!product) {
      return { success: false, errCode: 'PRODUCT_NOT_FOUND', errMsg: '商品不存在' };
    }

    const updateData: Record<string, any> = { online, updatedAt: new Date() };
    if (online) {
      const packages = product.packages || [];
      const hasPricedPackage = packages.some((pkg: Package) => typeof pkg.price === 'number' && pkg.price > 0);
      if (!hasPricedPackage) {
        return {
          success: false,
          errCode: 'PACKAGE_NOT_READY',
          errMsg: '请先进入商品编辑页配置售价，再上架商品'
        };
      }
      updateData.packages = packages.map((pkg: Package) => ({
        ...pkg,
        online: typeof pkg.price === 'number' && pkg.price > 0 ? true : pkg.online
      }));
    }

    const res = await db
      .collection(PRODUCT_COLLECTION)
      .where({ productId })
      .update({ data: updateData });

    // 未匹配到商品（updated 为 0）视为目标不存在
    const updated = res && res.stats ? res.stats.updated : res && res.updated;
    if (updated === 0) {
      return { success: false, errCode: 'PRODUCT_NOT_FOUND', errMsg: '商品不存在' };
    }

    await writeAudit(db, operator, {
      type: AuditType.PRODUCT_UPDATE,
      productId,
      action: online ? '上架商品' : '下架商品',
      result: 'success',
      detail: { online },
    });

    return { success: true, data: { productId, online } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await writeAudit(db, operator, {
      type: AuditType.PRODUCT_UPDATE,
      productId,
      action: online ? '上架商品' : '下架商品',
      result: 'failed',
      errorMsg: msg,
    });
    return { success: false, errCode: 'TOGGLE_FAILED', errMsg: `上下架操作失败：${msg}` };
  }
}

/* ============================================================
 * 系统配置管理
 * ============================================================ */

/**
 * 获取系统配置列表
 *
 * @param db 云数据库实例
 */
export async function handleGetConfigs(
  db: any
): Promise<CloudFunctionResult<{ configs: SystemConfig[] }>> {
  const res = await db.collection(CONFIG_COLLECTION).limit(100).get();
  const configs = (res && Array.isArray(res.data) ? res.data : []) as SystemConfig[];
  return { success: true, data: { configs } };
}

/** 合法配置键集合 */
const VALID_CONFIG_KEYS: string[] = Object.values(ConfigKey);

/**
 * 更新系统配置（按 key 覆盖式更新，不存在则新增）
 *
 * @param db       云数据库实例
 * @param event    入参 { key, value }
 * @param operator 操作者身份
 */
export async function handleUpdateConfig(
  db: any,
  event: any,
  operator: Operator
): Promise<CloudFunctionResult<{ key: string }>> {
  const key: string = event && event.key;
  const value = event ? event.value : undefined;

  if (!key) {
    return { success: false, errCode: 'INVALID_PARAM', errMsg: '缺少配置键 key' };
  }
  if (!VALID_CONFIG_KEYS.includes(key)) {
    return { success: false, errCode: 'INVALID_CONFIG_KEY', errMsg: `不支持的配置键：${key}` };
  }
  if (value === undefined) {
    return { success: false, errCode: 'INVALID_PARAM', errMsg: '缺少配置值 value' };
  }

  try {
    const now = new Date();
    // 查询配置是否已存在
    const existRes = await db.collection(CONFIG_COLLECTION).where({ key }).limit(1).get();
    const exists = existRes && Array.isArray(existRes.data) && existRes.data.length > 0;

    if (exists) {
      await db.collection(CONFIG_COLLECTION).where({ key }).update({ data: { value, updatedAt: now } });
    } else {
      await db.collection(CONFIG_COLLECTION).add({ data: { key, value, desc: '', updatedAt: now } });
    }

    await writeAudit(db, operator, {
      type: AuditType.CONFIG_UPDATE,
      action: `更新系统配置：${key}`,
      result: 'success',
      detail: { key, value },
    });

    return { success: true, data: { key } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await writeAudit(db, operator, {
      type: AuditType.CONFIG_UPDATE,
      action: `更新系统配置：${key}`,
      result: 'failed',
      errorMsg: msg,
    });
    return { success: false, errCode: 'CONFIG_UPDATE_FAILED', errMsg: `配置更新失败：${msg}` };
  }
}

/* ============================================================
 * 工具函数
 * ============================================================ */

/**
 * 分页拉取全部商品（设置防御性上限避免超时）
 */
async function fetchAllProducts(db: any): Promise<Product[]> {
  const all: Product[] = [];
  let skip = 0;

  while (skip < MAX_RECORDS) {
    const res = await db
      .collection(PRODUCT_COLLECTION)
      .skip(skip)
      .limit(PAGE_SIZE)
      .get();

    const batch = (res && Array.isArray(res.data) ? res.data : []) as Product[];
    all.push(...batch.filter((p) => TARGET_CATEGORY_IDS.indexOf(p.categoryId) >= 0));

    if (batch.length < PAGE_SIZE) {
      break;
    }
    skip += PAGE_SIZE;
  }

  return all;
}

/**
 * 选取默认套餐：优先 isDefault，其次第一个
 */
function pickDefaultPackage(packages: Package[] | undefined): Package | undefined {
  if (!packages || packages.length === 0) {
    return undefined;
  }
  return packages.find((p) => p.isDefault) || packages[0];
}

/**
 * 生成商品ID（时间戳 + 随机数）
 */
function generateProductId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `prod_${timestamp}_${random}`;
}

/** writeAudit 入参 */
interface WriteAuditParams {
  type: AuditType;
  action: string;
  result: 'success' | 'failed';
  productId?: string;
  detail?: Record<string, any>;
  errorMsg?: string;
}

/**
 * 统一写入审计日志（失败仅输出云函数日志，不阻断主流程）
 */
async function writeAudit(db: any, operator: Operator, params: WriteAuditParams): Promise<void> {
  try {
    const log = createAuditLog({
      type: params.type,
      operator: operator.openid || 'unknown',
      operatorName: operator.name,
      productId: params.productId,
      action: params.action,
      result: params.result,
      detail: params.detail,
      errorMsg: params.errorMsg,
    });
    await writeAuditLog(db, log);
  } catch (err) {
    console.error('[productManage] 写入审计日志失败：', err);
  }
}

/** 保留2位小数 */
function round2(n: number): number {
  return Math.round((n || 0) * 100) / 100;
}
