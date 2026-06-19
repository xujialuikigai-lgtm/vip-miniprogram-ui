// 商品业务云函数入口
import * as cloud from 'wx-server-sdk';
import { Product, Category, Package } from './shared/types/product';
import {
  CloudFunctionResult,
  ShunshiCategoryNode,
  ShunshiProductListItem
} from './shared/types/api';
import { ConfigKey } from './shared/types/config';
import { searchProducts, sortByPrice } from './shared/utils/filter';
import { maskPhone } from './shared/utils/mask';
import { getShunshiClient } from './shared/utils/shunshi';
import { requireAdmin } from './shared/utils/adminAuth';
import { computeSyncUpdateData } from './syncMerge';
import {
  BROADCAST_MAX_COUNT,
  DEFAULT_PAGE_SIZE
} from './shared/constants';

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 搜索排序类型
type SortType = 'comprehensive' | 'price' | 'fast' | 'tv';

// 播报记录返回结构
interface BroadcastItem {
  phone: string;
  productName: string;
  createdAt: Date;
}

// action 路由分发
export async function main(event: any, context: any): Promise<CloudFunctionResult> {
  const { action } = event;

  switch (action) {
    case 'getList':
      // 商品列表（任务 5.1）
      return handleGetList(event);
    case 'getDetail':
      // 商品详情（任务 5.1）
      return handleGetDetail(event);
    case 'search':
      // 搜索商品
      return handleSearch(event);
    case 'getCategories':
      // 分类列表（任务 5.1）
      return handleGetCategories();
    case 'getBroadcast':
      // 播报数据
      return handleGetBroadcast();
    case 'getConfig':
      // 获取系统配置
      return handleGetConfig(event);
    case 'getArticle':
      // 富文本内容页
      return handleGetArticle(event);
    case 'syncProducts':
      // 同步商品（任务 5.3）——仅此 action 需管理员鉴权，面向用户端的 action 保持无需鉴权
      return handleSyncProductsWithAuth(event);
    default:
      return { success: false, errCode: 'INVALID_ACTION', errMsg: '无效的操作类型' };
  }
}

/**
 * 商品列表（任务 5.1，需求 1.1/1.2/1.4/1.5/2.1）
 * - 按 categoryId（非空时）+ online=true 过滤
 * - 按 sortWeight 升序
 * - skip/limit 分页（默认每页 DEFAULT_PAGE_SIZE，page/pageSize 非法回退）
 * - 返回 { list, total }，total 使用 .count()
 */
async function handleGetList(
  event: any
): Promise<CloudFunctionResult<{ list: Product[]; total: number }>> {
  const categoryId: string = (event.categoryId || '').trim();

  // 分页参数：非法（非正整数）时回退到默认值
  const page = normalizePositiveInt(event.page, 1);
  const pageSize = normalizePositiveInt(event.pageSize, DEFAULT_PAGE_SIZE);

  // 过滤条件：仅展示已上架商品；指定分类时附加分类过滤
  const where: Record<string, any> = { online: true };
  if (categoryId) {
    where.categoryId = categoryId;
  }

  const collection = db.collection('products').where(where);

  // 总数使用 count()，与分页查询分离
  const countRes = await collection.count();
  const total = countRes.total;

  // 按 sortWeight 升序，skip/limit 分页
  const listRes = await collection
    .orderBy('sortWeight', 'asc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get();

  return { success: true, data: { list: listRes.data as Product[], total } };
}

/**
 * 商品详情（任务 5.1，需求 2.1）
 * - 按 productId 查询完整商品（含 packages、attachTemplate）
 * - 缺参返回 INVALID_PARAM，未找到返回 PRODUCT_NOT_FOUND
 * - 返回 { product, packages }
 */
async function handleGetDetail(
  event: any
): Promise<CloudFunctionResult<{ product: Product; packages: Package[] }>> {
  const productId: string = (event.productId || '').trim();
  if (!productId) {
    return { success: false, errCode: 'INVALID_PARAM', errMsg: '缺少商品ID参数' };
  }

  const res = await db.collection('products').where({ productId }).limit(1).get();
  const products = res.data as Product[];
  if (products.length === 0) {
    return { success: false, errCode: 'PRODUCT_NOT_FOUND', errMsg: '商品不存在' };
  }

  const product = products[0];
  return { success: true, data: { product, packages: product.packages || [] } };
}

/**
 * 分类列表（任务 5.1，需求 1.4/1.5）
 * - 返回全部分类，按 sortWeight 升序
 * - 返回 { categories }
 */
async function handleGetCategories(): Promise<CloudFunctionResult<{ categories: Category[] }>> {
  const res = await db
    .collection('categories')
    .orderBy('sortWeight', 'asc')
    .get();
  return { success: true, data: { categories: res.data as Category[] } };
}

/**
 * 将入参规范化为正整数，非法（NaN、<=0、非整数）时回退到默认值
 */
function normalizePositiveInt(value: any, fallback: number): number {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) {
    return fallback;
  }
  return num;
}

/**
 * 搜索商品：模糊匹配 name 和 categoryName（仅已上架），并按指定方式排序
 * - comprehensive 综合：按 sortWeight 升序，再按 salesCount 降序
 * - price 价格低：按默认套餐售价升序
 * - fast 到账快：自动开通商品优先，再按 sortWeight 升序
 * - tv 电视端：仅保留标记支持电视端的商品（tags 含"电视"），其余按综合排序
 */
async function handleSearch(event: any): Promise<CloudFunctionResult<{ list: Product[]; total: number }>> {
  const keyword: string = (event.keyword || '').trim();
  const sortType: SortType = event.sortType || 'comprehensive';

  // 空关键词直接返回空结果，避免全表返回
  if (!keyword) {
    return { success: true, data: { list: [], total: 0 } };
  }

  // 仅查询已上架商品，缩小匹配范围
  const res = await db
    .collection('products')
    .where({ online: true })
    .limit(1000)
    .get();
  const products = res.data as Product[];

  // 复用 shared 的模糊匹配（名称 + 分类名，已过滤上架）
  let matched = searchProducts(products, keyword);

  // 按排序类型处理
  matched = applySort(matched, sortType);

  return { success: true, data: { list: matched, total: matched.length } };
}

/**
 * 按排序类型对搜索结果排序/过滤
 */
function applySort(products: Product[], sortType: SortType): Product[] {
  switch (sortType) {
    case 'price':
      // 复用 shared 的默认套餐售价升序
      return sortByPrice(products);
    case 'fast':
      // 自动开通商品到账更快，优先展示；其次按权重
      return [...products].sort((a, b) => {
        if (a.autoActivate !== b.autoActivate) {
          return a.autoActivate ? -1 : 1;
        }
        return a.sortWeight - b.sortWeight;
      });
    case 'tv':
      // 仅展示支持电视端的商品（标签含"电视"），按综合排序
      return sortComprehensive(products.filter(isTvSupported));
    case 'comprehensive':
    default:
      return sortComprehensive(products);
  }
}

/**
 * 综合排序：sortWeight 升序（越小越靠前），权重相同按销量降序
 */
function sortComprehensive(products: Product[]): Product[] {
  return [...products].sort((a, b) => {
    if (a.sortWeight !== b.sortWeight) {
      return a.sortWeight - b.sortWeight;
    }
    return b.salesCount - a.salesCount;
  });
}

/**
 * 判断商品是否支持电视端（标签中包含"电视"关键字）
 */
function isTvSupported(product: Product): boolean {
  return product.tags.some((tag) => tag.includes('电视'));
}

/**
 * 获取播报数据：读取 broadcast_cache 最近 20 条，手机号脱敏返回
 */
async function handleGetBroadcast(): Promise<CloudFunctionResult<BroadcastItem[]>> {
  const res = await db
    .collection('broadcast_cache')
    .orderBy('createdAt', 'desc')
    .limit(BROADCAST_MAX_COUNT)
    .get();

  const list: BroadcastItem[] = (res.data as any[]).map((item) => ({
    // 防御性脱敏：即使存储为完整手机号也保证返回脱敏值（已脱敏值幂等）
    phone: maskPhone(String(item.phone || '')),
    productName: item.productName || '',
    createdAt: item.createdAt
  }));

  return { success: true, data: list };
}

/**
 * 获取系统配置：支持单个 key 或多个 keys 批量读取
 */
async function handleGetConfig(event: any): Promise<CloudFunctionResult> {
  const { key, keys } = event;

  // 批量读取：返回 { key: value } 映射
  if (Array.isArray(keys) && keys.length > 0) {
    const res = await db
      .collection('system_config')
      .where({ key: db.command.in(keys) })
      .get();
    const map: Record<string, any> = {};
    (res.data as any[]).forEach((item) => {
      map[item.key] = item.value;
    });
    return { success: true, data: map };
  }

  // 单个读取
  if (typeof key === 'string' && key) {
    const res = await db.collection('system_config').where({ key }).limit(1).get();
    if ((res.data as any[]).length === 0) {
      return { success: false, errCode: 'CONFIG_NOT_FOUND', errMsg: '配置项不存在' };
    }
    return { success: true, data: (res.data as any[])[0].value };
  }

  return { success: false, errCode: 'INVALID_PARAM', errMsg: '缺少配置键参数' };
}

/**
 * 获取富文本内容页：仅允许 purchase_notice / account_guide / platform_announcement
 */
async function handleGetArticle(event: any): Promise<CloudFunctionResult<{ key: string; content: any }>> {
  const key: string = event.key;

  // 仅放行允许的富文本配置键
  const allowedKeys: string[] = [
    ConfigKey.PURCHASE_NOTICE,
    ConfigKey.ACCOUNT_GUIDE,
    ConfigKey.PLATFORM_ANNOUNCEMENT
  ];

  if (!allowedKeys.includes(key)) {
    return { success: false, errCode: 'INVALID_ARTICLE_KEY', errMsg: '无效的内容页标识' };
  }

  const res = await db.collection('system_config').where({ key }).limit(1).get();
  if ((res.data as any[]).length === 0) {
    return { success: false, errCode: 'ARTICLE_NOT_FOUND', errMsg: '内容暂未配置' };
  }

  return { success: true, data: { key, content: (res.data as any[])[0].value } };
}

/** 同步结果摘要 */
interface SyncResult {
  /** 新增商品数 */
  added: number;
  /** 更新商品数 */
  updated: number;
  /** 自动下架商品数 */
  offlined: number;
  /** 同步耗时（毫秒） */
  duration: number;
  /** 批次同步：本次处理的分类数 */
  processedCategories?: number;
  /** 批次同步：全部分类数 */
  totalCategories?: number;
  /** 批次同步：下一批游标 */
  nextCursor?: number;
  /** 批次同步：下一页页码 */
  nextPage?: number;
  /** 批次同步：是否全部完成 */
  done?: boolean;
}

/** 拍平后的顺势分类节点 */
interface FlatShunshiCategory {
  /** 顺势分类 ID */
  id: number;
  /** 分类名称 */
  name: string;
  /** 父级 ID（0 为顶级） */
  pid: number;
  /** 层级：顶级1，子级2，三级3（由递归深度推导） */
  level: number;
}

/** 关联了分类 ID 的顺势商品列表项 */
interface ShunshiProductWithCate {
  item: ShunshiProductListItem;
  cate_id: number;
}

/**
 * 同步商品鉴权前置（安全修复）
 * - 通过 cloud.getWXContext().OPENID 获取调用者 openid
 * - 复用 shared/utils/adminAuth 的 requireAdmin 做管理员白名单校验
 * - 鉴权不通过时直接返回其错误结构（NO_PERMISSION / MISSING_IDENTITY / AUTH_SYSTEM_ERROR），与管理端一致
 * - 鉴权通过后再执行既有同步逻辑（逻辑保持不变）
 */
async function handleSyncProductsWithAuth(event: any): Promise<CloudFunctionResult<SyncResult>> {
  // 取调用者 openid（与管理端一致：cloud.getWXContext().OPENID）
  const { OPENID } = cloud.getWXContext();
  const auth = await requireAdmin(db, OPENID || '', { action: 'syncProducts' });
  if (!auth.allowed) {
    // 直接透传统一错误结构，保持与管理端返回一致
    return auth.error as CloudFunctionResult<SyncResult>;
  }

  // 鉴权通过，执行原有同步逻辑
  return handleSyncProducts(event);
}

/** 顺势接口并发上限（控制对上游 API 的并发请求数，避免被限流） */
const NET_CONCURRENCY = 8;
/** 数据库读写并发上限 */
const DB_CONCURRENCY = 10;
/** 数据库 in 查询单批 ID 数量上限 */
const IN_CHUNK_SIZE = 200;
/** 批次同步每次拉取的商品条数；按页处理，避免单次云函数超过 60 秒 */
const SYNC_PAGE_SIZE = 100;

/**
 * 带并发上限的 map：以 limit 个 worker 轮流取任务执行，结果按原索引回填（保持顺序）。
 * 用于把原本串行的网络/数据库调用并行化，同时避免一次性发起过多请求。
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length || 1);

  const runWorker = async (): Promise<void> => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };

  const workers: Promise<void>[] = [];
  for (let w = 0; w < workerCount; w++) {
    workers.push(runWorker());
  }
  await Promise.all(workers);
  return results;
}

/**
 * 将数组按固定大小切块（用于数据库 in 查询分批）
 */
function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

/**
 * 一次性批量查出已存在商品，建立 shunshiGoodsId -> Product 映射。
 * 用 in 分批 + 并发查询，替代逐个商品的串行 DB 往返。
 */
async function loadExistingProducts(ids: number[]): Promise<Map<number, Product>> {
  const map = new Map<number, Product>();
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) {
    return map;
  }

  const chunks = chunk(uniqueIds, IN_CHUNK_SIZE);
  const lists = await mapWithConcurrency(chunks, DB_CONCURRENCY, async (group) => {
    const res = await db
      .collection('products')
      .where({ shunshiGoodsId: db.command.in(group) })
      .limit(1000)
      .get();
    return res.data as Product[];
  });

  for (const list of lists) {
    for (const p of list) {
      map.set(p.shunshiGoodsId, p);
    }
  }
  return map;
}

/**
 * 同步商品（任务 5.3，需求 17.1-17.6）
 * 1. 调用顺势 getCategories（返回数组）同步分类树（递归拍平，保留管理员字段，仅更新 name/parentId/level）
 * 2. 因商品列表无 cate_id，遍历各分类调用 getProductList({cate_id, page, limit:100}) 自动翻页，
 *    将商品关联到对应分类（按商品 id 去重，保留首个分类）
 * 3. 同步商品（已批量查出存在记录后并发处理）：
 *    - 已存在：仅更新顺势字段（复用 computeSyncUpdateData），保留管理员配置
 *    - 新增：仅用列表基础字段写入，attachTemplate/description 留空（不拉详情），默认下架
 *    - status=2/3 自动下架（原为上架才计入 offlined），status=1 不改 online
 * 4. 返回 { added, updated, offlined, duration }
 * 5. 任一接口异常 catch 返回 { success:false, errCode:'SYNC_FAILED', errMsg }
 *
 * 性能优化（方案 A）：分类拉取、详情拉取、DB 读写均改为带并发上限的并行，
 * 已存在商品改为一次性批量查询，避免逐条串行往返导致 60s 超时。
 */
async function handleSyncProducts(event: any = {}): Promise<CloudFunctionResult<SyncResult>> {
  const startedAt = Date.now();

  try {
    const client = getShunshiClient();
    const batchMode = !!event.batch;
    const cursor = Math.max(0, normalizeNonNegativeInt(event.cursor, 0));
    const page = normalizePositiveInt(event.page, 1);

    // 步骤 1：同步分类树（接口 data 直接是数组）
    const cateNodes: ShunshiCategoryNode[] = await client.getCategories();
    const flatCategories = flattenCategories(cateNodes || []);
    await syncCategories(flatCategories);

    // 分类 ID -> 名称映射，用于新增商品时回填 categoryName
    const cateNameMap = new Map<number, string>();
    flatCategories.forEach((c) => cateNameMap.set(c.id, c.name));

    let shunshiProducts: ShunshiProductWithCate[] = [];
    let nextCursor = flatCategories.length;
    let nextPage = 1;
    let done = true;
    let processedCategories = flatCategories.length;

    if (batchMode) {
      if (cursor >= flatCategories.length) {
        return {
          success: true,
          data: {
            added: 0,
            updated: 0,
            offlined: 0,
            duration: Date.now() - startedAt,
            processedCategories: 0,
            totalCategories: flatCategories.length,
            nextCursor: flatCategories.length,
            nextPage: 1,
            done: true
          }
        };
      }

      // 批次模式：一次只处理一个分类的一页商品，彻底避免全量同步触发 60 秒上限。
      const cate = flatCategories[cursor];
      const res = await client.getProductList({ cate_id: cate.id, page, limit: SYNC_PAGE_SIZE });
      const list = res.list || [];
      shunshiProducts = list.map((item) => ({ item, cate_id: cate.id }));

      const categoryDone = list.length < SYNC_PAGE_SIZE || page * SYNC_PAGE_SIZE >= (res.total || 0);
      nextCursor = categoryDone ? cursor + 1 : cursor;
      nextPage = categoryDone ? 1 : page + 1;
      done = nextCursor >= flatCategories.length;
      processedCategories = categoryDone ? 1 : 0;
    } else {
      // 兼容旧调用：仍支持一次性全量同步，但大数据量下推荐前端批次模式。
      shunshiProducts = await fetchAllShunshiProducts(client, flatCategories);
    }

    // 步骤 3：一次性批量查出已存在商品，按是否存在拆分为「更新」与「新增」两组
    const existingMap = await loadExistingProducts(shunshiProducts.map((p) => p.item.id));

    const toUpdate: Array<{ existing: Product; item: ShunshiProductListItem }> = [];
    const toAdd: ShunshiProductWithCate[] = [];
    for (const { item, cate_id } of shunshiProducts) {
      const existing = existingMap.get(item.id);
      if (existing) {
        toUpdate.push({ existing, item });
      } else {
        toAdd.push({ item, cate_id });
      }
    }

    // 并发更新已存在商品，汇总自动下架计数
    const offlinedDeltas = await mapWithConcurrency(
      toUpdate,
      DB_CONCURRENCY,
      ({ existing, item }) => updateExistingProduct(existing, item)
    );
    const offlined = offlinedDeltas.reduce((sum, d) => sum + d, 0);

    // 并发新增商品（仅写入，不逐个拉详情）。
    // 不调用 getProductDetail：首次同步全部为新增时，逐个详情请求会拖垮 60s 限制。
    // attachTemplate 留空、description 留空，由管理员在商品编辑页按需配置。
    await mapWithConcurrency(toAdd, DB_CONCURRENCY, ({ item, cate_id }) =>
      addNewProduct(item, cate_id, cateNameMap.get(cate_id) || '')
    );

    return {
      success: true,
      data: {
        added: toAdd.length,
        updated: toUpdate.length,
        offlined,
        duration: Date.now() - startedAt,
        processedCategories,
        totalCategories: flatCategories.length,
        nextCursor,
        nextPage,
        done
      }
    };
  } catch (err: any) {
    // 任一接口异常：中止同步，已成功写入的数据不回滚
    return {
      success: false,
      errCode: 'SYNC_FAILED',
      errMsg: err && err.message ? err.message : String(err)
    };
  }
}

/**
 * 将入参规范化为非负整数，非法时回退到默认值。
 */
function normalizeNonNegativeInt(value: any, fallback: number): number {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) {
    return fallback;
  }
  return num;
}

/**
 * 递归拍平顺势分类树（最多三级），按递归深度推导 level（顶级1）
 */
function flattenCategories(
  list: ShunshiCategoryNode[],
  level = 1,
  result: FlatShunshiCategory[] = []
): FlatShunshiCategory[] {
  for (const node of list) {
    result.push({
      id: node.id,
      name: node.name,
      pid: node.pid,
      level
    });
    if (node.children && node.children.length > 0) {
      flattenCategories(node.children, level + 1, result);
    }
  }
  return result;
}

/**
 * 一次性批量查出已存在分类，建立 shunshiCateId -> Category 映射。
 */
async function loadExistingCategories(ids: number[]): Promise<Map<number, Category>> {
  const map = new Map<number, Category>();
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) {
    return map;
  }

  const chunks = chunk(uniqueIds, IN_CHUNK_SIZE);
  const lists = await mapWithConcurrency(chunks, DB_CONCURRENCY, async (group) => {
    const res = await db
      .collection('categories')
      .where({ shunshiCateId: db.command.in(group) })
      .limit(1000)
      .get();
    return res.data as Category[];
  });

  for (const list of lists) {
    for (const c of list) {
      map.set(c.shunshiCateId, c);
    }
  }
  return map;
}

/**
 * 同步分类：已存在仅更新 name/parentId/level（保留管理员字段 icon/sortWeight/showInTab/tabSort）；
 * 新增则写入默认管理员字段。
 * 性能优化：先批量查出已存在分类，再并发执行更新/新增，避免逐个串行 DB 往返。
 */
async function syncCategories(flatCategories: FlatShunshiCategory[]): Promise<void> {
  if (flatCategories.length === 0) {
    return;
  }

  const existingMap = await loadExistingCategories(flatCategories.map((c) => c.id));

  await mapWithConcurrency(flatCategories, DB_CONCURRENCY, async (c) => {
    const now = new Date();
    // parentId 以本地 categoryId 形式引用上级；顶级（pid=0）为空串
    const parentId = c.pid > 0 ? `cate_${c.pid}` : '';
    const existed = existingMap.get(c.id);

    if (existed) {
      // 仅更新顺势字段，保留管理员配置
      await db.collection('categories').doc(existed._id as string).update({
        data: {
          name: c.name,
          parentId,
          level: c.level,
          updatedAt: now
        }
      });
    } else {
      // 新增分类：管理员字段使用默认值
      const newCategory: Category = {
        categoryId: `cate_${c.id}`,
        shunshiCateId: c.id,
        name: c.name,
        icon: '',
        parentId,
        level: c.level,
        sortWeight: 0,
        productCount: 0,
        showInTab: false,
        tabSort: 0,
        createdAt: now,
        updatedAt: now
      };
      await db.collection('categories').add({ data: newCategory });
    }
  });
}

/**
 * 并发拉取各分类的顺势商品（每页 100 条，单个分类内翻页串行直到取完）。
 * 商品列表无 cate_id，故由分类关联；按商品 id 去重，保留首个出现的分类。
 * 性能优化：分类之间并发拉取（受 NET_CONCURRENCY 控制），结果按原分类顺序合并，
 * 保证去重时「首个分类胜出」的结果与串行版本一致（确定性）。
 */
async function fetchAllShunshiProducts(
  client: ReturnType<typeof getShunshiClient>,
  flatCategories: FlatShunshiCategory[]
): Promise<ShunshiProductWithCate[]> {
  const limit = 100;

  // 并发拉取每个分类的全部商品（结果按输入分类顺序回填）
  const perCate = await mapWithConcurrency(flatCategories, NET_CONCURRENCY, async (cate) => {
    const items: ShunshiProductListItem[] = [];
    let page = 1;
    let fetched = 0;

    while (true) {
      const res = await client.getProductList({ cate_id: cate.id, page, limit });
      const list = res.list || [];
      items.push(...list);

      fetched += list.length;
      // 已取满或本页不足一页则结束翻页
      if (list.length < limit || fetched >= (res.total || 0)) {
        break;
      }
      page += 1;
    }

    return { cateId: cate.id, items };
  });

  // 按原分类顺序合并并去重（同一商品保留首个出现的分类）
  const seen = new Set<number>();
  const all: ShunshiProductWithCate[] = [];
  for (const { cateId, items } of perCate) {
    for (const item of items) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        all.push({ item, cate_id: cateId });
      }
    }
  }

  return all;
}

/**
 * 更新已存在商品：复用 computeSyncUpdateData 计算顺势字段更新，
 * 保留管理员配置（name/sortWeight/online/packages[].price），不覆盖 attachTemplate/description。
 * @returns 本次自动下架计数增量（0 或 1）
 */
async function updateExistingProduct(
  existing: Product,
  item: ShunshiProductListItem
): Promise<number> {
  const { data, offlinedDelta } = computeSyncUpdateData(existing, item);
  await db.collection('products').doc(existing._id as string).update({ data });
  return offlinedDelta;
}

/**
 * 新增商品：默认 online=false，生成默认套餐 price=0，
 * 顺势字段（进货价/面值/库存/上游状态）写入对应位置。
 * 不拉取商品详情：attachTemplate 留空、description 留空，由管理员在商品编辑页按需配置，
 * 以避免首次全量同步时逐个详情请求导致 60s 超时。
 * face_value/goods_price 为字符串，用 Number()/parseFloat 转数字存储。
 */
async function addNewProduct(
  item: ShunshiProductListItem,
  cateId: number,
  categoryName: string
): Promise<void> {
  const now = new Date();

  // 默认套餐：售价 price=0，由管理员后续配置；成本/面值/库存来自顺势（字符串转数字）
  const defaultPackage: Package = {
    packageId: `pkg_${item.id}_default`,
    name: '默认套餐',
    memberType: '',
    price: 0,
    costPrice: parseFloat(item.goods_price),
    faceValue: parseFloat(item.face_value),
    shunshiGoodsId: item.id,
    stock: Number(item.stock_num),
    online: true,
    isDefault: true,
    sortWeight: 0
  };

  const newProduct: Product = {
    productId: `prod_${item.id}`,
    shunshiGoodsId: item.id,
    name: item.goods_name,
    shunshiName: item.goods_name,
    categoryId: `cate_${cateId}`,
    categoryName,
    brandIcon: '',
    shunshiImg: item.goods_img,
    tags: [],
    description: '',
    rechargeMethod: '',
    accountType: '',
    autoActivate: false,
    online: false,
    sortWeight: 0,
    salesCount: 0,
    todaySales: 0,
    shunshiStatus: item.status,
    stockNum: Number(item.stock_num),
    attachTemplate: [],
    packages: [defaultPackage],
    rules: { deviceSupport: '', arrivalTime: '', safetyNote: '' },
    createdAt: now,
    updatedAt: now
  };

  await db.collection('products').add({ data: newProduct });
}
