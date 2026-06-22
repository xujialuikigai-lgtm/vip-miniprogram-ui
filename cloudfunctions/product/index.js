"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
// 商品业务云函数入口
const cloud = __importStar(require("wx-server-sdk"));
const http = __importStar(require("http"));
const https = __importStar(require("https"));
const config_1 = require("./shared/types/config");
const filter_1 = require("./shared/utils/filter");
const mask_1 = require("./shared/utils/mask");
const shunshi_1 = require("./shared/utils/shunshi");
const adminAuth_1 = require("./shared/utils/adminAuth");
const parseGoods_1 = require("./parseGoods");
const syncMerge_1 = require("./syncMerge");
const constants_1 = require("./shared/constants");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
// action 路由分发
async function main(event, context) {
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
        case 'clearSyncedProducts':
            // 清空顺势同步商品：管理员专用，用于重新按当前筛选规则获取
            return handleClearSyncedProductsWithAuth(event);
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
async function handleGetList(event) {
    const categoryId = (event.categoryId || '').trim();
    // 分页参数：非法（非正整数）时回退到默认值
    const page = normalizePositiveInt(event.page, 1);
    const pageSize = normalizePositiveInt(event.pageSize, constants_1.DEFAULT_PAGE_SIZE);
    // 过滤条件：仅展示已上架商品；指定分类时附加分类过滤
    const where = { online: true };
    if (categoryId) {
        where.categoryId = categoryId;
    }
    else {
        where.categoryId = db.command.in(TARGET_CATEGORY_IDS);
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
    return { success: true, data: { list: listRes.data, total } };
}
/**
 * 商品详情（任务 5.1，需求 2.1）
 * - 按 productId 查询完整商品（含 packages、attachTemplate）
 * - 缺参返回 INVALID_PARAM，未找到返回 PRODUCT_NOT_FOUND
 * - 返回 { product, packages }
 */
async function handleGetDetail(event) {
    const productId = (event.productId || '').trim();
    if (!productId) {
        return { success: false, errCode: 'INVALID_PARAM', errMsg: '缺少商品ID参数' };
    }
    const res = await db.collection('products').where({ productId }).limit(1).get();
    const products = res.data;
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
async function handleGetCategories() {
    const res = await db
        .collection('categories')
        .orderBy('sortWeight', 'asc')
        .get();
    const existing = new Map();
    res.data
        .filter((c) => TARGET_CATEGORY_IDS.indexOf(c.categoryId) >= 0)
        .forEach((c) => existing.set(c.categoryId, c));
    const now = new Date();
    const categories = TARGET_SYNC_GROUPS.map((group, index) => (existing.get(group.categoryId) || {
        categoryId: group.categoryId,
        shunshiCateId: group.id,
        name: group.name,
        icon: '',
        parentId: '',
        level: 1,
        sortWeight: index + 1,
        productCount: 0,
        showInTab: true,
        tabSort: index + 1,
        createdAt: now,
        updatedAt: now
    }));
    return { success: true, data: { categories } };
}
/**
 * 将入参规范化为正整数，非法（NaN、<=0、非整数）时回退到默认值
 */
function normalizePositiveInt(value, fallback) {
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
async function handleSearch(event) {
    const keyword = (event.keyword || '').trim();
    const sortType = event.sortType || 'comprehensive';
    // 空关键词直接返回空结果，避免全表返回
    if (!keyword) {
        return { success: true, data: { list: [], total: 0 } };
    }
    // 仅查询已上架商品，缩小匹配范围
    const res = await db
        .collection('products')
        .where({ online: true, categoryId: db.command.in(TARGET_CATEGORY_IDS) })
        .limit(1000)
        .get();
    const products = res.data;
    // 复用 shared 的模糊匹配（名称 + 分类名，已过滤上架）
    let matched = (0, filter_1.searchProducts)(products, keyword);
    // 按排序类型处理
    matched = applySort(matched, sortType);
    return { success: true, data: { list: matched, total: matched.length } };
}
/**
 * 按排序类型对搜索结果排序/过滤
 */
function applySort(products, sortType) {
    switch (sortType) {
        case 'price':
            // 复用 shared 的默认套餐售价升序
            return (0, filter_1.sortByPrice)(products);
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
function sortComprehensive(products) {
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
function isTvSupported(product) {
    return product.tags.some((tag) => tag.includes('电视'));
}
/**
 * 获取播报数据：读取 broadcast_cache 最近 20 条，手机号脱敏返回
 */
async function handleGetBroadcast() {
    const res = await db
        .collection('broadcast_cache')
        .orderBy('createdAt', 'desc')
        .limit(constants_1.BROADCAST_MAX_COUNT)
        .get();
    const list = res.data.map((item) => ({
        // 防御性脱敏：即使存储为完整手机号也保证返回脱敏值（已脱敏值幂等）
        phone: (0, mask_1.maskPhone)(String(item.phone || '')),
        productName: item.productName || '',
        createdAt: item.createdAt
    }));
    return { success: true, data: list };
}
/**
 * 获取系统配置：支持单个 key 或多个 keys 批量读取
 */
async function handleGetConfig(event) {
    const { key, keys } = event;
    // 批量读取：返回 { key: value } 映射
    if (Array.isArray(keys) && keys.length > 0) {
        const res = await db
            .collection('system_config')
            .where({ key: db.command.in(keys) })
            .get();
        const map = {};
        res.data.forEach((item) => {
            map[item.key] = item.value;
        });
        return { success: true, data: map };
    }
    // 单个读取
    if (typeof key === 'string' && key) {
        const res = await db.collection('system_config').where({ key }).limit(1).get();
        if (res.data.length === 0) {
            return { success: false, errCode: 'CONFIG_NOT_FOUND', errMsg: '配置项不存在' };
        }
        return { success: true, data: res.data[0].value };
    }
    return { success: false, errCode: 'INVALID_PARAM', errMsg: '缺少配置键参数' };
}
/**
 * 获取富文本内容页：仅允许 purchase_notice / account_guide / platform_announcement
 */
async function handleGetArticle(event) {
    const key = event.key;
    // 仅放行允许的富文本配置键
    const allowedKeys = [
        config_1.ConfigKey.PURCHASE_NOTICE,
        config_1.ConfigKey.ACCOUNT_GUIDE,
        config_1.ConfigKey.PLATFORM_ANNOUNCEMENT
    ];
    if (!allowedKeys.includes(key)) {
        return { success: false, errCode: 'INVALID_ARTICLE_KEY', errMsg: '无效的内容页标识' };
    }
    const res = await db.collection('system_config').where({ key }).limit(1).get();
    if (res.data.length === 0) {
        return { success: false, errCode: 'ARTICLE_NOT_FOUND', errMsg: '内容暂未配置' };
    }
    return { success: true, data: { key, content: res.data[0].value } };
}
/**
 * 同步商品鉴权前置（安全修复）
 * - 通过 cloud.getWXContext().OPENID 获取调用者 openid
 * - 复用 shared/utils/adminAuth 的 requireAdmin 做管理员白名单校验
 * - 鉴权不通过时直接返回其错误结构（NO_PERMISSION / MISSING_IDENTITY / AUTH_SYSTEM_ERROR），与管理端一致
 * - 鉴权通过后再执行既有同步逻辑（逻辑保持不变）
 */
async function handleSyncProductsWithAuth(event) {
    // 取调用者 openid（与管理端一致：cloud.getWXContext().OPENID）
    const { OPENID } = cloud.getWXContext();
    const auth = await (0, adminAuth_1.requireAdmin)(db, OPENID || '', { action: 'syncProducts' });
    if (!auth.allowed) {
        // 直接透传统一错误结构，保持与管理端返回一致
        return auth.error;
    }
    // 鉴权通过，执行原有同步逻辑
    return handleSyncProducts(event);
}
async function handleClearSyncedProductsWithAuth(event) {
    const { OPENID } = cloud.getWXContext();
    const auth = await (0, adminAuth_1.requireAdmin)(db, OPENID || '', { action: 'clearSyncedProducts' });
    if (!auth.allowed) {
        return auth.error;
    }
    return handleClearSyncedProducts(event);
}
/** 顺势接口并发上限（控制对上游 API 的并发请求数，避免被限流） */
const NET_CONCURRENCY = 8;
/** 数据库读写并发上限 */
const DB_CONCURRENCY = 10;
/** 图片转存并发上限，避免同步任务被图片下载拖慢 */
const IMAGE_CACHE_CONCURRENCY = 3;
/** 单张接口图片下载超时时间 */
const IMAGE_DOWNLOAD_TIMEOUT_MS = 5000;
/** 单张接口图片最大体积 */
const IMAGE_MAX_BYTES = 3 * 1024 * 1024;
/** 数据库 in 查询单批 ID 数量上限 */
const IN_CHUNK_SIZE = 200;
/** 批次同步每次拉取的商品条数；按页处理，避免单次云函数超过 60 秒 */
const SYNC_PAGE_SIZE = 100;
/** 目标商品池：只同步这些品牌关键词，避免拉取顺势全量商品池 */
const TARGET_SYNC_GROUPS = [
    {
        id: -900001,
        categoryId: 'target_video',
        name: '视频会员',
        keywords: ['腾讯视频', '腾讯体育', '爱奇艺', '芒果TV', '优酷视频', '哔哩哔哩', '咪咕视频', '央视频']
    },
    {
        id: -900002,
        categoryId: 'target_music',
        name: '音乐',
        keywords: ['汽水音乐', 'QQ音乐', '喜马拉雅', '网易云音乐', '全民K歌', '酷狗音乐', '酷我音乐']
    },
    {
        id: -900003,
        categoryId: 'target_audio_book',
        name: '阅读听书',
        keywords: ['懒人听书', '蜻蜓FM', 'QQ阅读', '樊登读书']
    },
    {
        id: -900004,
        categoryId: 'target_cloud',
        name: '网盘',
        keywords: ['百度网盘', '夸克', '迅雷']
    },
    {
        id: -900005,
        categoryId: 'target_tool',
        name: '办公工具',
        keywords: ['剪映', 'WPS', '醒图', '百度文库', '乐播投屏']
    },
    {
        id: -900006,
        categoryId: 'target_fitness',
        name: '运动健身',
        keywords: []
    },
    {
        id: -900007,
        categoryId: 'target_bike',
        name: '共享单车',
        keywords: ['哈啰', '美团单车', '美团电单车', '青桔']
    }
];
const TARGET_SYNC_ITEMS = [];
for (const group of TARGET_SYNC_GROUPS) {
    for (const keyword of group.keywords) {
        TARGET_SYNC_ITEMS.push({ group, keyword });
    }
}
const TARGET_CATEGORY_IDS = TARGET_SYNC_GROUPS.map((group) => group.categoryId);
/** 顺势商品类型：1=卡密，2=直充。直充范围以接口字段为准，便于运营对账。 */
const SHUNSHI_GOODS_TYPE_DIRECT = 2;
/** 测试售价倍率：未人工定价的新套餐按成本价 1.1 倍生成售价，用于跑通下单支付链路。 */
const TEST_PRICE_MARKUP = 1.1;
/**
 * 带并发上限的 map：以 limit 个 worker 轮流取任务执行，结果按原索引回填（保持顺序）。
 * 用于把原本串行的网络/数据库调用并行化，同时避免一次性发起过多请求。
 */
async function mapWithConcurrency(items, limit, fn) {
    const results = new Array(items.length);
    let cursor = 0;
    const workerCount = Math.min(Math.max(1, limit), items.length || 1);
    const runWorker = async () => {
        while (true) {
            const i = cursor++;
            if (i >= items.length)
                return;
            results[i] = await fn(items[i], i);
        }
    };
    const workers = [];
    for (let w = 0; w < workerCount; w++) {
        workers.push(runWorker());
    }
    await Promise.all(workers);
    return results;
}
/**
 * 将数组按固定大小切块（用于数据库 in 查询分批）
 */
function chunk(arr, size) {
    const result = [];
    for (let i = 0; i < arr.length; i += size) {
        result.push(arr.slice(i, i + size));
    }
    return result;
}
/**
 * 一次性批量查出已存在商品，建立 shunshiGoodsId -> Product 映射。
 * 用 in 分批 + 并发查询，替代逐个商品的串行 DB 往返。
 */
async function loadExistingProducts(ids) {
    const map = new Map();
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
        return res.data;
    });
    for (const list of lists) {
        for (const p of list) {
            map.set(p.shunshiGoodsId, p);
        }
    }
    return map;
}
async function handleClearSyncedProducts(event = {}) {
    const scope = event.scope === 'allSynced' ? 'allSynced' : 'target';
    const where = scope === 'allSynced'
        ? { shunshiGoodsId: db.command.gt(0) }
        : { categoryId: db.command.in(TARGET_CATEGORY_IDS) };
    let removed = 0;
    while (true) {
        const res = await db.collection('products').where(where).limit(100).get();
        const products = (res.data || []);
        if (products.length === 0)
            break;
        await mapWithConcurrency(products, DB_CONCURRENCY, async (product) => {
            if (!product._id)
                return;
            await db.collection('products').doc(product._id).remove();
        });
        removed += products.length;
        // 防止单次云函数过久；如还有剩余，用户再次调用即可继续清。
        if (removed >= 500)
            break;
    }
    await resetTargetCategoryProductCount();
    return {
        success: true,
        data: { removed, scope }
    };
}
async function resetTargetCategoryProductCount() {
    const res = await db
        .collection('categories')
        .where({ categoryId: db.command.in(TARGET_CATEGORY_IDS) })
        .limit(100)
        .get();
    const categories = (res.data || []);
    await mapWithConcurrency(categories, DB_CONCURRENCY, async (category) => {
        if (!category._id)
            return;
        await db.collection('categories').doc(category._id).update({
            data: {
                productCount: 0,
                updatedAt: new Date()
            }
        });
    });
}
/**
 * 数据迁移兜底：旧同步模型会把顺势 SKU 直接写成商品（如 productId=prod_72794、
 * name=【转单资源】腾讯视频...），导致视频会员分类按 SKU 展示，而不是像音乐会员一样按品牌展示。
 * 新同步逻辑只写 brand_<categoryId>_<brand> 聚合商品；这里把目标分类中的旧 SKU 商品下架，
 * 保留数据方便回溯，不再出现在用户端分类页。
 */
async function offlineLegacyTargetSkuProducts() {
    const all = [];
    let skip = 0;
    while (true) {
        const res = await db
            .collection('products')
            .where({ categoryId: db.command.in(TARGET_CATEGORY_IDS), online: true })
            .skip(skip)
            .limit(100)
            .get();
        const batch = (res.data || []);
        all.push(...batch);
        if (batch.length < 100)
            break;
        skip += 100;
    }
    const legacyProducts = all.filter(isLegacyTargetSkuProduct);
    await mapWithConcurrency(legacyProducts, DB_CONCURRENCY, async (product) => {
        if (!product._id)
            return;
        await db.collection('products').doc(product._id).update({
            data: {
                online: false,
                updatedAt: new Date()
            }
        });
    });
    return legacyProducts.length;
}
function isLegacyTargetSkuProduct(product) {
    const productId = String(product.productId || '');
    const name = String(product.name || '');
    const isBrandAggregate = productId.indexOf(`brand_${product.categoryId}_`) === 0;
    if (isBrandAggregate)
        return false;
    return /^prod_\d+$/.test(productId) || /^【[^】]+】/.test(name);
}
/**
 * 同步商品（任务 5.3，需求 17.1-17.6）
 * 1. 同步本地目标分类（来自 会员多多.docx）
 * 2. 按目标品牌关键词调用 getProductList({keyword, page, limit:100})，不再遍历顺势全量分类
 * 3. 同步商品（已批量查出存在记录后并发处理）：
 *    - 已存在：仅更新顺势字段（复用 computeSyncUpdateData），保留管理员配置
 *    - 新增：仅用列表基础字段写入，attachTemplate/description 留空（不拉详情），默认展示但禁购
 *    - status=2/3 自动下架（原为上架才计入 offlined），status=1 不改 online
 * 4. 返回 { added, updated, offlined, duration }
 * 5. 任一接口异常 catch 返回 { success:false, errCode:'SYNC_FAILED', errMsg }
 */
async function handleSyncProducts(event = {}) {
    const startedAt = Date.now();
    try {
        const client = (0, shunshi_1.getShunshiClient)();
        const batchMode = !!event.batch;
        const cursor = Math.max(0, normalizeNonNegativeInt(event.cursor, 0));
        const page = normalizePositiveInt(event.page, 1);
        // 步骤 1：同步本地目标分类，不再拉取顺势全量分类树
        await syncTargetCategories(TARGET_SYNC_GROUPS);
        const legacyOfflined = !batchMode || cursor === 0 ? await offlineLegacyTargetSkuProducts() : 0;
        let shunshiProducts = [];
        let nextCursor = TARGET_SYNC_ITEMS.length;
        let nextPage = 1;
        let done = true;
        let processedCategories = TARGET_SYNC_ITEMS.length;
        if (batchMode) {
            if (cursor >= TARGET_SYNC_ITEMS.length) {
                return {
                    success: true,
                    data: {
                        added: 0,
                        updated: 0,
                        offlined: 0,
                        duration: Date.now() - startedAt,
                        processedCategories: 0,
                        totalCategories: TARGET_SYNC_ITEMS.length,
                        totalTargets: TARGET_SYNC_ITEMS.length,
                        nextCursor: TARGET_SYNC_ITEMS.length,
                        nextPage: 1,
                        done: true
                    }
                };
            }
            // 批次模式：一次完整处理一个目标关键词（品牌）的全部分页，
            // 保证该品牌的套餐去重在单次调用内完成（避免跨调用导致渠道降级）。
            const target = TARGET_SYNC_ITEMS[cursor];
            const items = await fetchKeywordAllPages(client, target.keyword);
            shunshiProducts = items.map((item) => ({
                item,
                cate_id: target.group.id,
                categoryId: target.group.categoryId,
                categoryName: target.group.name,
                brand: target.keyword
            }));
            nextCursor = cursor + 1;
            nextPage = 1;
            done = nextCursor >= TARGET_SYNC_ITEMS.length;
            processedCategories = 1;
        }
        else {
            // 兼容旧调用：一次性同步目标关键词，不再全量同步顺势商品池。
            shunshiProducts = await fetchAllTargetProducts(client);
        }
        // 步骤 3：按「分类 + 品牌」聚合 SKU 为品牌商品（含套餐矩阵），创建或合并落库。
        const { added, updated } = await aggregateAndUpsertBrands(shunshiProducts);
        const offlined = legacyOfflined;
        return {
            success: true,
            data: {
                added,
                updated,
                offlined,
                duration: Date.now() - startedAt,
                processedCategories,
                totalCategories: TARGET_SYNC_ITEMS.length,
                totalTargets: TARGET_SYNC_ITEMS.length,
                nextCursor,
                nextPage,
                done
            }
        };
    }
    catch (err) {
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
function normalizeNonNegativeInt(value, fallback) {
    const num = Number(value);
    if (!Number.isInteger(num) || num < 0) {
        return fallback;
    }
    return num;
}
/**
 * 目标关键词匹配：顺势 keyword 搜索结果可能较宽，这里再做一层本地包含校验。
 */
function shouldSyncTargetProduct(item, keyword) {
    if (!isDirectRechargeProduct(item))
        return false;
    // 渠道授权：仅同步可在自有平台销售的商品（can_buy 空或「所有渠道均可销售」）
    if (!(0, parseGoods_1.isChannelSellable)(item.can_buy))
        return false;
    // 排除指定渠道（如转单资源）
    if ((0, parseGoods_1.isChannelExcluded)(item.goods_name))
        return false;
    const name = normalizeSearchText(item.goods_name || '');
    const key = normalizeSearchText(keyword);
    return !!key && name.indexOf(key) >= 0;
}
function isDirectRechargeProduct(item) {
    return Number(item.goods_type) === SHUNSHI_GOODS_TYPE_DIRECT;
}
function normalizeSearchText(text) {
    return String(text || '').replace(/\s+/g, '').toLowerCase();
}
/**
 * 同步本地目标分类。目标分类不是顺势原始分类，使用负数 shunshiCateId 避免和上游分类冲突。
 */
async function syncTargetCategories(groups) {
    if (groups.length === 0)
        return;
    const existingMap = await loadExistingCategories(groups.map((g) => g.id));
    await mapWithConcurrency(groups, DB_CONCURRENCY, async (group, index) => {
        const now = new Date();
        const existed = existingMap.get(group.id);
        if (existed) {
            await db.collection('categories').doc(existed._id).update({
                data: {
                    categoryId: group.categoryId,
                    name: group.name,
                    parentId: '',
                    level: 1,
                    showInTab: true,
                    tabSort: index + 1,
                    updatedAt: now
                }
            });
            return;
        }
        const category = {
            categoryId: group.categoryId,
            shunshiCateId: group.id,
            name: group.name,
            icon: '',
            parentId: '',
            level: 1,
            sortWeight: index + 1,
            productCount: 0,
            showInTab: true,
            tabSort: index + 1,
            createdAt: now,
            updatedAt: now
        };
        await db.collection('categories').add({ data: category });
    });
}
/**
 * 兼容非 batch 调用：一次性拉取目标关键词商品，而不是全量遍历顺势分类。
 */
async function fetchAllTargetProducts(client) {
    const perTarget = await mapWithConcurrency(TARGET_SYNC_ITEMS, NET_CONCURRENCY, async (target) => {
        const items = [];
        let page = 1;
        let fetched = 0;
        while (true) {
            const res = await client.getProductList({ keyword: target.keyword, page, limit: SYNC_PAGE_SIZE });
            const list = (res.list || []).filter((item) => shouldSyncTargetProduct(item, target.keyword));
            items.push(...list);
            fetched += res.list ? res.list.length : 0;
            if ((res.list || []).length < SYNC_PAGE_SIZE || fetched >= (res.total || 0)) {
                break;
            }
            page += 1;
        }
        return { target, items };
    });
    const seen = new Set();
    const all = [];
    for (const { target, items } of perTarget) {
        for (const item of items) {
            if (!seen.has(item.id)) {
                seen.add(item.id);
                all.push({
                    item,
                    cate_id: target.group.id,
                    categoryId: target.group.categoryId,
                    categoryName: target.group.name,
                    brand: target.keyword
                });
            }
        }
    }
    return all;
}
/**
 * 拉取单个关键词（品牌）的全部分页商品，并做直充类型 + 关键词包含校验。
 * 用于批次模式：一次完整取完一个品牌，保证品牌内套餐去重在单次调用完成。
 */
async function fetchKeywordAllPages(client, keyword) {
    const items = [];
    let page = 1;
    let fetched = 0;
    while (true) {
        const res = await client.getProductList({ keyword, page, limit: SYNC_PAGE_SIZE });
        const raw = res.list || [];
        items.push(...raw.filter((item) => shouldSyncTargetProduct(item, keyword)));
        fetched += raw.length;
        if (raw.length < SYNC_PAGE_SIZE || fetched >= (res.total || 0))
            break;
        page += 1;
    }
    return items;
}
/** 按 productId 批量查出已存在的品牌商品 */
async function loadBrandProducts(productIds) {
    const map = new Map();
    const unique = Array.from(new Set(productIds));
    if (unique.length === 0)
        return map;
    const chunks = chunk(unique, IN_CHUNK_SIZE);
    const lists = await mapWithConcurrency(chunks, DB_CONCURRENCY, async (group) => {
        const res = await db
            .collection('products')
            .where({ productId: db.command.in(group) })
            .limit(1000)
            .get();
        return res.data;
    });
    for (const list of lists) {
        for (const p of list) {
            map.set(p.productId, p);
        }
    }
    return map;
}
/**
 * 按「分类 + 品牌」聚合 SKU：
 * - 同品牌的 SKU 去重为套餐矩阵（会员类型 × 周期，渠道择优）
 * - 已存在品牌商品则合并套餐（保留管理员售价/上下架），否则新建
 * @returns { added: 新建品牌商品数, updated: 合并更新品牌商品数 }
 */
async function aggregateAndUpsertBrands(rows) {
    const groups = new Map();
    for (const row of rows) {
        const brand = (row.brand || '').trim();
        if (!brand)
            continue;
        const categoryId = row.categoryId || `cate_${row.cate_id}`;
        const productId = (0, parseGoods_1.buildBrandProductId)(categoryId, brand);
        let g = groups.get(productId);
        if (!g) {
            g = { categoryId, categoryName: row.categoryName || '', brand, items: [] };
            groups.set(productId, g);
        }
        g.items.push(row.item);
    }
    if (groups.size === 0)
        return { added: 0, updated: 0 };
    const existingMap = await loadBrandProducts(Array.from(groups.keys()));
    let added = 0;
    let updated = 0;
    const entries = Array.from(groups.entries());
    await mapWithConcurrency(entries, IMAGE_CACHE_CONCURRENCY, async ([productId, g]) => {
        const descriptors = (0, parseGoods_1.dedupSkusToPackages)(g.items.map((it) => ({
            id: it.id,
            goods_name: it.goods_name,
            goods_price: it.goods_price,
            face_value: it.face_value,
            stock_num: it.stock_num
        })));
        if (descriptors.length === 0)
            return;
        const repItem = pickRepresentativeItem(g.items, descriptors[0].shunshiGoodsId);
        const existing = existingMap.get(productId);
        if (existing) {
            await mergeBrandProduct(existing, g, descriptors, repItem);
            updated += 1;
        }
        else {
            await createBrandProduct(productId, g, descriptors, repItem);
            added += 1;
        }
    });
    return { added, updated };
}
/** 取代表 SKU：优先取首个套餐对应的 SKU（用于品牌图标），兜底首个 */
function pickRepresentativeItem(items, preferId) {
    return items.find((it) => it.id === preferId) || items[0];
}
function makeTestSalePrice(costPrice) {
    const cost = Number(costPrice) || 0;
    const price = cost > 0 ? cost * TEST_PRICE_MARKUP : 0.01;
    return Math.ceil(price * 100) / 100;
}
function fillTestPriceForUnconfiguredPackage(pkg) {
    if (Number(pkg.price) > 0) {
        return pkg;
    }
    return Object.assign(Object.assign({}, pkg), { price: makeTestSalePrice(pkg.costPrice), online: true });
}
async function loadPackageDetails(client, descriptors) {
    const ids = Array.from(new Set(descriptors.map((d) => d.shunshiGoodsId).filter((id) => id > 0)));
    const map = new Map();
    await mapWithConcurrency(ids, IMAGE_CACHE_CONCURRENCY, async (id) => {
        try {
            const detail = await client.getProductDetail(id);
            map.set(id, detail);
        }
        catch (err) {
            console.warn('[product.syncProducts] 获取商品详情失败，跳过 goods_info/goods_notice:', id, err);
        }
    });
    return map;
}
/** 套餐描述转 Package（新套餐：测试期按成本 1.1 倍生成售价并可售） */
function buildPackageFromDescriptor(d, isDefault, detail) {
    const pkg = {
        packageId: `pkg_${d.shunshiGoodsId}`,
        name: d.period || d.shunshiName || `SKU ${d.shunshiGoodsId}`,
        memberType: d.memberType,
        goodsInfo: detail ? detail.goods_info || '' : '',
        goodsNotice: detail ? detail.goods_notice || '' : '',
        price: makeTestSalePrice(d.costPrice),
        costPrice: d.costPrice,
        faceValue: d.faceValue,
        shunshiGoodsId: d.shunshiGoodsId,
        shunshiName: d.shunshiName,
        stock: d.stock,
        online: true,
        isDefault,
        sortWeight: d.periodDays
    };
    const variants = buildAccountVariants(d);
    if (variants.length > 0) {
        pkg.accountVariants = variants;
    }
    return pkg;
}
/** 从套餐描述中提取账号形式变体（仅 phone/qq） */
function buildAccountVariants(d) {
    return (d.accountVariants || [])
        .filter((v) => v.accountType === 'phone' || v.accountType === 'qq')
        .map((v) => ({
        accountType: v.accountType,
        shunshiGoodsId: v.shunshiGoodsId,
        shunshiName: v.shunshiName,
        costPrice: v.costPrice,
        faceValue: v.faceValue,
        stock: v.stock
    }));
}
/** 新建品牌商品 */
async function createBrandProduct(productId, g, descriptors, repItem) {
    const now = new Date();
    const client = (0, shunshi_1.getShunshiClient)();
    const detailMap = await loadPackageDetails(client, descriptors);
    const packages = descriptors.map((d, i) => buildPackageFromDescriptor(d, i === 0, detailMap.get(d.shunshiGoodsId)));
    const stockNum = descriptors.reduce((sum, d) => sum + (d.stock || 0), 0);
    const repDetail = detailMap.get(repItem.id) || detailMap.get(descriptors[0].shunshiGoodsId);
    const product = {
        productId,
        // 品牌商品由多 SKU 聚合，product 级 shunshiGoodsId 仅保留代表值（套餐各自绑定真实 SKU）
        shunshiGoodsId: repItem.id,
        // name 是用户端展示名，shunshiName 是接口原始代表商品名，供管理端对账查看
        name: g.brand,
        shunshiName: repItem.goods_name,
        categoryId: g.categoryId,
        categoryName: g.categoryName,
        brandIcon: await resolveProductBrandIcon(repItem),
        shunshiImg: repItem.goods_img,
        goodsInfo: repDetail ? repDetail.goods_info || '' : '',
        goodsNotice: repDetail ? repDetail.goods_notice || '' : '',
        tags: [],
        description: repDetail ? repDetail.goods_info || '' : '',
        rechargeMethod: '手机号直充',
        accountType: '',
        autoActivate: false,
        // 商品展示到前台，但套餐未定价前由前端与下单云函数禁购
        online: true,
        sortWeight: 0,
        salesCount: 0,
        todaySales: 0,
        shunshiStatus: repItem.status,
        stockNum,
        attachTemplate: [],
        packages,
        rules: { deviceSupport: '', arrivalTime: '', safetyNote: '' },
        createdAt: now,
        updatedAt: now
    };
    await db.collection('products').add({ data: product });
}
/**
 * 合并已存在品牌商品：
 * - 按「会员类型 + 周期」匹配已有套餐：更新成本/面值/库存/绑定 SKU，保留管理员售价与上下架
 * - 新增的会员类型/周期：追加为新套餐（售价 0、下架）
 * - 已有但本次未出现的套餐：原样保留（不删除）
 * - 商品级仅更新顺势字段，不覆盖管理员配置（name/online/sortWeight/rules 等）
 */
async function mergeBrandProduct(existing, g, descriptors, repItem) {
    var _a, _b;
    const packages = (existing.packages || []).map((p) => (Object.assign({}, p)));
    const client = (0, shunshi_1.getShunshiClient)();
    const detailMap = await loadPackageDetails(client, descriptors);
    // 已有套餐按去重键建索引（品牌套餐 name 即周期）
    const keyToIndex = new Map();
    packages.forEach((p, i) => {
        keyToIndex.set((0, parseGoods_1.packageDedupKey)(p.memberType, p.name), i);
        // 同时按 SKU 建索引，兼容历史数据
        keyToIndex.set(`sku:${p.shunshiGoodsId}`, i);
    });
    for (const d of descriptors) {
        const key = (0, parseGoods_1.packageDedupKey)(d.memberType, d.period);
        const idx = keyToIndex.has(key) ? keyToIndex.get(key) : keyToIndex.get(`sku:${d.shunshiGoodsId}`);
        if (idx !== undefined && packages[idx]) {
            // 更新顺势字段与绑定 SKU，保留管理员售价/上下架/默认标记/名称
            packages[idx] = fillTestPriceForUnconfiguredPackage(Object.assign(Object.assign({}, packages[idx]), { memberType: packages[idx].memberType || d.memberType, goodsInfo: ((_a = detailMap.get(d.shunshiGoodsId)) === null || _a === void 0 ? void 0 : _a.goods_info) || packages[idx].goodsInfo || '', goodsNotice: ((_b = detailMap.get(d.shunshiGoodsId)) === null || _b === void 0 ? void 0 : _b.goods_notice) || packages[idx].goodsNotice || '', shunshiGoodsId: d.shunshiGoodsId, shunshiName: d.shunshiName, costPrice: d.costPrice, faceValue: d.faceValue, stock: d.stock }));
            const variants = buildAccountVariants(d);
            if (variants.length > 0) {
                packages[idx].accountVariants = variants;
            }
        }
        else {
            const np = buildPackageFromDescriptor(d, false, detailMap.get(d.shunshiGoodsId));
            packages.push(np);
            keyToIndex.set(key, packages.length - 1);
        }
    }
    // 保证恰有一个默认套餐
    if (!packages.some((p) => p.isDefault) && packages.length > 0) {
        packages[0].isDefault = true;
    }
    const brandIcon = await resolveProductBrandIcon(repItem, existing);
    const repDetail = detailMap.get(repItem.id) || detailMap.get(descriptors[0].shunshiGoodsId);
    const data = {
        packages,
        brandIcon,
        shunshiName: repItem.goods_name,
        shunshiGoodsId: repItem.id,
        shunshiImg: repItem.goods_img,
        goodsInfo: repDetail ? repDetail.goods_info || '' : existing.goodsInfo || '',
        goodsNotice: repDetail ? repDetail.goods_notice || '' : existing.goodsNotice || '',
        shunshiStatus: repItem.status,
        stockNum: descriptors.reduce((sum, d) => sum + (d.stock || 0), 0),
        categoryId: g.categoryId,
        categoryName: g.categoryName,
        updatedAt: new Date()
    };
    await db.collection('products').doc(existing._id).update({ data });
}
/**
 * 递归拍平顺势分类树（最多三级），按递归深度推导 level（顶级1）
 */
function flattenCategories(list, level = 1, result = []) {
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
async function loadExistingCategories(ids) {
    const map = new Map();
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
        return res.data;
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
async function syncCategories(flatCategories) {
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
            await db.collection('categories').doc(existed._id).update({
                data: {
                    name: c.name,
                    parentId,
                    level: c.level,
                    updatedAt: now
                }
            });
        }
        else {
            // 新增分类：管理员字段使用默认值
            const newCategory = {
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
async function fetchAllShunshiProducts(client, flatCategories) {
    const limit = 100;
    // 并发拉取每个分类的全部商品（结果按输入分类顺序回填）
    const perCate = await mapWithConcurrency(flatCategories, NET_CONCURRENCY, async (cate) => {
        const items = [];
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
    const seen = new Set();
    const all = [];
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
async function updateExistingProduct(existing, item, categoryId, categoryName) {
    const { data, offlinedDelta } = (0, syncMerge_1.computeSyncUpdateData)(existing, item);
    data.brandIcon = await resolveProductBrandIcon(item, existing);
    if (categoryId) {
        data.categoryId = categoryId;
    }
    if (categoryName) {
        data.categoryName = categoryName;
    }
    await db.collection('products').doc(existing._id).update({ data });
    return offlinedDelta;
}
/**
 * 新增商品：默认 online=true，生成默认套餐测试价（成本价 * 1.1），
 * 顺势字段（进货价/面值/库存/上游状态）写入对应位置。
 * 不拉取商品详情：attachTemplate 留空、description 留空，由管理员在商品编辑页按需配置，
 * 以避免首次全量同步时逐个详情请求导致 60s 超时。
 * face_value/goods_price 为字符串，用 Number()/parseFloat 转数字存储。
 */
async function addNewProduct(item, cateId, categoryName, categoryId) {
    const now = new Date();
    let detail;
    try {
        detail = await (0, shunshi_1.getShunshiClient)().getProductDetail(item.id);
    }
    catch (err) {
        console.warn('[product.syncProducts] 获取商品详情失败，跳过 goods_info/goods_notice:', item.id, err);
    }
    const costPrice = parseFloat(item.goods_price);
    // 默认套餐：测试期按成本价 1.1 倍生成售价；成本/面值/库存来自顺势（字符串转数字）
    const defaultPackage = {
        packageId: `pkg_${item.id}_default`,
        name: item.goods_name,
        memberType: '',
        goodsInfo: detail ? detail.goods_info || '' : '',
        goodsNotice: detail ? detail.goods_notice || '' : '',
        price: makeTestSalePrice(costPrice),
        costPrice,
        faceValue: parseFloat(item.face_value),
        shunshiGoodsId: item.id,
        shunshiName: item.goods_name,
        stock: Number(item.stock_num),
        // 测试期默认可售，用于跑通下单、支付、订单链路；后续可在管理端改价或下架。
        online: true,
        isDefault: true,
        sortWeight: 0
    };
    const newProduct = {
        productId: `prod_${item.id}`,
        shunshiGoodsId: item.id,
        name: item.goods_name,
        shunshiName: item.goods_name,
        categoryId: categoryId || `cate_${cateId}`,
        categoryName,
        brandIcon: await resolveProductBrandIcon(item),
        shunshiImg: item.goods_img,
        goodsInfo: detail ? detail.goods_info || '' : '',
        goodsNotice: detail ? detail.goods_notice || '' : '',
        tags: [],
        description: detail ? detail.goods_info || '' : '',
        rechargeMethod: '手机号直充',
        accountType: '',
        autoActivate: false,
        // 商品先展示到前台，套餐未定价前由前端和下单云函数共同禁购。
        online: true,
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
function toHttpsImageUrl(url) {
    const value = String(url || '').trim();
    if (!value)
        return '';
    if (/^http:\/\//i.test(value)) {
        return value.replace(/^http:\/\//i, 'https://');
    }
    return value;
}
async function resolveProductBrandIcon(item, existing) {
    const sourceUrl = String(item.goods_img || '').trim();
    if (!sourceUrl)
        return '';
    // 已经转存过且上游图片未变化时，保留云存储图片，避免重复下载。
    if (existing &&
        /^cloud:\/\//i.test(existing.brandIcon || '') &&
        existing.shunshiImg === sourceUrl) {
        return existing.brandIcon;
    }
    const cached = await cacheRemoteProductImage(item.id, sourceUrl);
    return cached || toHttpsImageUrl(sourceUrl);
}
async function cacheRemoteProductImage(goodsId, sourceUrl) {
    if (!/^https?:\/\//i.test(sourceUrl))
        return '';
    try {
        const fileContent = await downloadRemoteImage(sourceUrl, 0);
        const ext = getImageExt(sourceUrl);
        const cloudPath = `product-icons/${goodsId}-${hashString(sourceUrl)}.${ext}`;
        const uploadRes = await cloud.uploadFile({
            cloudPath,
            fileContent
        });
        return uploadRes && uploadRes.fileID ? uploadRes.fileID : '';
    }
    catch (err) {
        // 图片转存失败不阻断商品同步；前端会屏蔽已知 403 外链并显示占位。
        return '';
    }
}
function downloadRemoteImage(sourceUrl, redirectCount) {
    return new Promise((resolve, reject) => {
        if (redirectCount > 3) {
            reject(new Error('IMAGE_REDIRECT_LIMIT'));
            return;
        }
        const client = /^https:\/\//i.test(sourceUrl) ? https : http;
        const req = client.get(sourceUrl, {
            timeout: IMAGE_DOWNLOAD_TIMEOUT_MS,
            headers: {
                Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                Referer: 'https://shop.mxmm666.com/',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
            }
        }, (res) => {
            const statusCode = res.statusCode || 0;
            const location = res.headers.location;
            if ([301, 302, 303, 307, 308].indexOf(statusCode) >= 0 &&
                location) {
                res.resume();
                const nextUrl = /^https?:\/\//i.test(location)
                    ? location
                    : new URL(location, sourceUrl).toString();
                downloadRemoteImage(nextUrl, redirectCount + 1).then(resolve).catch(reject);
                return;
            }
            if (statusCode < 200 || statusCode >= 300) {
                res.resume();
                reject(new Error(`IMAGE_HTTP_${statusCode}`));
                return;
            }
            const chunks = [];
            let total = 0;
            res.on('data', (chunk) => {
                total += chunk.length;
                if (total > IMAGE_MAX_BYTES) {
                    req.destroy(new Error('IMAGE_TOO_LARGE'));
                    return;
                }
                chunks.push(chunk);
            });
            res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('timeout', () => req.destroy(new Error('IMAGE_TIMEOUT')));
        req.on('error', reject);
    });
}
function getImageExt(sourceUrl) {
    const clean = sourceUrl.split('?')[0].toLowerCase();
    const match = clean.match(/\.([a-z0-9]{3,4})$/);
    const ext = match ? match[1] : 'jpg';
    return ['jpg', 'jpeg', 'png', 'webp', 'gif'].indexOf(ext) >= 0 ? ext : 'jpg';
}
function hashString(value) {
    let hash = 5381;
    for (let i = 0; i < value.length; i += 1) {
        hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
    }
    return (hash >>> 0).toString(36);
}
