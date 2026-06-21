"use strict";
/**
 * 顺势商品名解析与品牌聚合纯逻辑
 *
 * 上游同一逻辑商品存在多渠道重复（零售直充/转单资源/多多/淘淘/闲鱼/人工代充等），
 * 命名信息全部糊在 goods_name 里：渠道在【】、周期在『』、会员档位在名字中。
 *
 * 本模块提供纯函数：
 * - parseChannel  解析渠道与优先级（数字越小优先级越高）
 * - parsePeriod   解析并规整套餐周期（统一档位 + 排序天数）
 * - parseMemberType 识别会员档位（星钻/白金/黄金/SVIP…），识别不到返回空串
 * - parseGoodsName 综合解析
 * - buildBrandProductId / brandSlug 生成品牌商品的稳定 ID
 *
 * 全部为纯函数，便于单元测试。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXCLUDED_CHANNELS = exports.UNKNOWN_CHANNEL_PRIORITY = exports.CHANNEL_PRIORITY = void 0;
exports.isChannelExcluded = isChannelExcluded;
exports.parseChannel = parseChannel;
exports.parsePeriod = parsePeriod;
exports.parseMemberType = parseMemberType;
exports.parseAccountType = parseAccountType;
exports.parseGoodsName = parseGoodsName;
exports.packageDedupKey = packageDedupKey;
exports.brandSlug = brandSlug;
exports.buildBrandProductId = buildBrandProductId;
exports.dedupSkusToPackages = dedupSkusToPackages;
exports.detectAccountType = detectAccountType;
exports.pickVariantByAccount = pickVariantByAccount;
exports.isChannelSellable = isChannelSellable;
/** 渠道优先级表：数字越小优先级越高，去重时保留优先级最高的一条 */
exports.CHANNEL_PRIORITY = [
    { keyword: '零售直充', priority: 1 },
    { keyword: '账号直充', priority: 3 },
    { keyword: '官方直充', priority: 3 },
    { keyword: '自动充值', priority: 3 },
    { keyword: '多多渠道', priority: 5 },
    { keyword: '淘淘渠道', priority: 6 },
    { keyword: '闲鱼渠道', priority: 7 },
    { keyword: '人工代充', priority: 8 },
    { keyword: '人工充值', priority: 8 }
];
/** 未知渠道兜底优先级（排在所有已知渠道之后） */
exports.UNKNOWN_CHANNEL_PRIORITY = 9;
/** 排除渠道：这些渠道的商品一律不同步（按业务约定） */
exports.EXCLUDED_CHANNELS = ['转单资源'];
/** 商品是否属于被排除的渠道（按商品名包含判断） */
function isChannelExcluded(name) {
    const full = String(name || '');
    return exports.EXCLUDED_CHANNELS.some((c) => full.indexOf(c) >= 0);
}
/** 会员档位识别 token（按优先顺序匹配，靠前的更具体） */
const MEMBER_TYPE_TOKENS = [
    '星钻',
    '白金',
    '黄金',
    '豪华黄钻',
    '黄钻',
    '绿钻',
    '钻石',
    'SVIP',
    'VIP',
    '超级影视',
    '超级会员',
    '大会员',
    '普通会员',
    '会员'
];
/**
 * 周期规整规则：命中关键词即归一化为标准档位。
 * days 用于排序（升序），并非精确天数。
 * 顺序很重要：先匹配更具体/更长的词（如「双年卡」先于「年卡」，「半年」先于「年」）。
 */
const PERIOD_RULES = [
    { test: /(7\s*天|七天)/, period: '7天', days: 7 },
    { test: /(双年卡|24\s*个月|２４个月|2\s*年|两年|730\s*天)/, period: '24个月', days: 730 },
    // 12 个月须先于 2 个月匹配，避免「12个月」被「2个月」子串命中
    { test: /(年卡|12\s*个月|十二个月|1\s*年|一年|365\s*天)/, period: '12个月', days: 365 },
    { test: /(半年|6\s*个月|六个月|180\s*天)/, period: '6个月', days: 180 },
    { test: /(季卡|3\s*个月|三个月|90\s*天)/, period: '3个月', days: 90 },
    { test: /(2\s*个月|两个月|二个月|60\s*天)/, period: '2个月', days: 60 },
    { test: /(连续包月)/, period: '连续包月', days: 30 },
    { test: /(月卡|1\s*个月|一个月|30\s*天|31\s*天)/, period: '1个月', days: 30 }
];
/** 提取首个【】或[]中的前缀内容（渠道/资源类型） */
function extractBracketPrefix(name) {
    const m = String(name || '').match(/^[\s]*[【\[]([^】\]]+)[】\]]/);
    return m ? m[1].trim() : '';
}
/** 提取首个『』或「」或《》中的内容（周期描述） */
function extractQuoted(name) {
    const m = String(name || '').match(/[『「《]([^』」》]+)[』」》]/);
    return m ? m[1].trim() : '';
}
/** 解析渠道与优先级 */
function parseChannel(name) {
    const prefix = extractBracketPrefix(name);
    const full = String(name || '');
    // 优先用前缀匹配，未命中再在全名里找渠道关键词
    for (const c of exports.CHANNEL_PRIORITY) {
        if (prefix.indexOf(c.keyword) >= 0 || full.indexOf(c.keyword) >= 0) {
            return { channel: c.keyword, priority: c.priority };
        }
    }
    return { channel: prefix || '其他', priority: exports.UNKNOWN_CHANNEL_PRIORITY };
}
/** 解析并规整周期；识别不到返回 { period: '', days: 9999 } */
function parsePeriod(name) {
    const quoted = extractQuoted(name);
    // 先在『』内容里找，找不到再在全名里找
    const candidates = [quoted, String(name || '')];
    for (const text of candidates) {
        if (!text)
            continue;
        for (const rule of PERIOD_RULES) {
            if (rule.test.test(text)) {
                return { period: rule.period, days: rule.days };
            }
        }
    }
    // 通用「N天」兜底：未命中标准月档时，按天数保留为独立周期（短期体验卡等）
    for (const text of candidates) {
        if (!text)
            continue;
        const m = text.match(/(\d+)\s*天/);
        if (m) {
            const n = parseInt(m[1], 10);
            if (n > 0)
                return { period: `${n}天`, days: n };
        }
    }
    // 无法规整：保留『』原文作为周期名，排到最后
    return { period: quoted || '', days: 9999 };
}
/** 识别会员档位；识别不到返回空串（前端按「默认」展示） */
function parseMemberType(name) {
    const full = String(name || '');
    for (const token of MEMBER_TYPE_TOKENS) {
        if (full.indexOf(token) >= 0) {
            return token;
        }
    }
    return '';
}
/**
 * 识别充值账号形式：
 * - 名字含「手机号」→ phone
 * - 名字含「QQ」(QQ号/QQ账号) → qq
 * - 否则 any（未标注，由管理员或下单时按输入判断）
 */
function parseAccountType(name) {
    const full = String(name || '');
    if (full.indexOf('手机号') >= 0)
        return 'phone';
    if (/QQ/i.test(full))
        return 'qq';
    return 'any';
}
/** 综合解析商品名 */
function parseGoodsName(name) {
    const { channel, priority } = parseChannel(name);
    const { period, days } = parsePeriod(name);
    return {
        channel,
        channelPriority: priority,
        memberType: parseMemberType(name),
        period,
        periodDays: days,
        accountType: parseAccountType(name)
    };
}
/** 去重分组键：会员类型 + 周期（同档位同周期视为同一套餐，只保留优先渠道一条） */
function packageDedupKey(memberType, period) {
    return `${memberType || '默认'}|${period || '其他'}`;
}
/** 品牌名转 ID 片段：保留中英文数字，其余转为下划线 */
function brandSlug(brand) {
    return String(brand || '')
        .trim()
        .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}
/** 生成品牌商品的稳定 productId：brand_<categoryId>_<brandSlug> */
function buildBrandProductId(categoryId, brand) {
    return `brand_${categoryId}_${brandSlug(brand)}`;
}
function toNumber(v) {
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : 0;
}
/** 账号形式优先级：选主 SKU 时 phone > qq > any */
const ACCOUNT_TYPE_PRIORITY = { phone: 1, qq: 2, any: 3 };
/**
 * 将一个品牌下的多条 SKU 去重为套餐列表。
 * 规则：
 * - 按「会员类型 + 周期」分组（packageDedupKey），账号形式（手机号/QQ号）**不**进分组键，
 *   即同档位同周期的手机号 SKU 与 QQ号 SKU 合并为一个套餐，分别作为账号变体保留
 * - 每个「账号形式」桶内只保留渠道优先级最高的一条（priority 数字最小）；
 *   并列时取成本价更低的，再并列取 id 更小的（保证确定性）
 * - 主 SKU 取 phone>qq>any 优先；accountVariants 仅在出现 phone/qq 标注时填充
 * - 结果排序：会员类型按首次出现顺序，组内按周期天数升序
 */
function dedupSkusToPackages(skus) {
    // key -> (accountType -> 最优变体)
    const groups = new Map();
    const groupMeta = new Map();
    const memberTypeOrder = [];
    for (const sku of skus) {
        const parsed = parseGoodsName(sku.goods_name);
        const key = packageDedupKey(parsed.memberType, parsed.period);
        const variant = {
            accountType: parsed.accountType,
            shunshiGoodsId: sku.id,
            shunshiName: sku.goods_name,
            costPrice: toNumber(sku.goods_price),
            faceValue: toNumber(sku.face_value),
            stock: toNumber(sku.stock_num),
            channel: parsed.channel,
            channelPriority: parsed.channelPriority
        };
        if (!groups.has(key)) {
            groups.set(key, new Map());
            groupMeta.set(key, { memberType: parsed.memberType, period: parsed.period, periodDays: parsed.periodDays });
            if (memberTypeOrder.indexOf(parsed.memberType) < 0) {
                memberTypeOrder.push(parsed.memberType);
            }
        }
        const bucket = groups.get(key);
        const cur = bucket.get(parsed.accountType);
        if (!cur || isBetterVariant(variant, cur)) {
            bucket.set(parsed.accountType, variant);
        }
    }
    const list = [];
    for (const [key, bucket] of groups) {
        const meta = groupMeta.get(key);
        const variants = Array.from(bucket.values());
        // 选主变体：phone > qq > any，同级再按渠道优先级
        const primary = variants.slice().sort((a, b) => {
            const pa = ACCOUNT_TYPE_PRIORITY[a.accountType];
            const pb = ACCOUNT_TYPE_PRIORITY[b.accountType];
            if (pa !== pb)
                return pa - pb;
            return a.channelPriority - b.channelPriority;
        })[0];
        // 仅保留 phone/qq 类型变体；纯 any 时不暴露变体
        const typedVariants = variants
            .filter((v) => v.accountType !== 'any')
            .sort((a, b) => ACCOUNT_TYPE_PRIORITY[a.accountType] - ACCOUNT_TYPE_PRIORITY[b.accountType]);
        list.push({
            memberType: meta.memberType,
            period: meta.period,
            periodDays: meta.periodDays,
            shunshiGoodsId: primary.shunshiGoodsId,
            shunshiName: primary.shunshiName || '',
            costPrice: primary.costPrice,
            faceValue: primary.faceValue,
            stock: primary.stock,
            channel: primary.channel,
            channelPriority: primary.channelPriority,
            accountVariants: typedVariants
        });
    }
    list.sort((a, b) => {
        const ai = memberTypeOrder.indexOf(a.memberType);
        const bi = memberTypeOrder.indexOf(b.memberType);
        if (ai !== bi)
            return ai - bi;
        if (a.periodDays !== b.periodDays)
            return a.periodDays - b.periodDays;
        return a.shunshiGoodsId - b.shunshiGoodsId;
    });
    return list;
}
/** 候选变体 a 是否优于当前 b（优先级更高 / 成本更低 / id 更小） */
function isBetterVariant(a, b) {
    if (a.channelPriority !== b.channelPriority)
        return a.channelPriority < b.channelPriority;
    if (a.costPrice !== b.costPrice)
        return a.costPrice < b.costPrice;
    return a.shunshiGoodsId < b.shunshiGoodsId;
}
/**
 * 按用户输入的账号判断账号形式：
 * - 1 开头的 11 位数字 → phone（手机号）
 * - 5~10 位纯数字 → qq（QQ号）
 * - 其它无法判断 → any
 */
function detectAccountType(account) {
    const s = String(account || '').trim();
    if (/^1\d{10}$/.test(s))
        return 'phone';
    if (/^[1-9]\d{4,9}$/.test(s))
        return 'qq';
    return 'any';
}
/**
 * 从套餐变体中按账号形式选出对应 SKU，找不到精确匹配则回退首个变体。
 * @returns 命中的变体；variants 为空时返回 undefined（调用方用套餐主 SKU）
 */
function pickVariantByAccount(variants, account) {
    if (!variants || variants.length === 0)
        return undefined;
    const type = detectAccountType(account);
    return variants.find((v) => v.accountType === type) || variants[0];
}
/**
 * 判断商品是否允许在我们自有平台销售。
 * 规则：自营小程序视为「其他渠道」。可售条件为 can_buy 满足以下任一：
 * - 为空（未限制）
 * - 含「所有渠道」（所有渠道均可销售）
 * - 含「其他渠道」/「其他无限制」（显式授权其他渠道，即包含我们）
 * 仅列了具名平台（闲鱼/拼多多/淘宝/京东/抖音…）而不含「其他渠道」的一律排除。
 */
function isChannelSellable(canBuy) {
    const s = String(canBuy || '').trim();
    if (s === '')
        return true;
    return /其他渠道|其他无限制|所有渠道/.test(s);
}
