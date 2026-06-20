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
exports.UNKNOWN_CHANNEL_PRIORITY = exports.CHANNEL_PRIORITY = void 0;
exports.parseChannel = parseChannel;
exports.parsePeriod = parsePeriod;
exports.parseMemberType = parseMemberType;
exports.parseGoodsName = parseGoodsName;
exports.packageDedupKey = packageDedupKey;
exports.brandSlug = brandSlug;
exports.buildBrandProductId = buildBrandProductId;
exports.dedupSkusToPackages = dedupSkusToPackages;
/** 渠道优先级表：数字越小优先级越高，去重时保留优先级最高的一条 */
exports.CHANNEL_PRIORITY = [
    { keyword: '零售直充', priority: 1 },
    { keyword: '转单资源', priority: 2 },
    { keyword: '账号直充', priority: 3 },
    { keyword: '官方直充', priority: 3 },
    { keyword: '多多渠道', priority: 5 },
    { keyword: '淘淘渠道', priority: 6 },
    { keyword: '闲鱼渠道', priority: 7 },
    { keyword: '人工代充', priority: 8 },
    { keyword: '人工充值', priority: 8 }
];
/** 未知渠道兜底优先级（排在所有已知渠道之后） */
exports.UNKNOWN_CHANNEL_PRIORITY = 9;
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
    '超级影视',
    '超级会员',
    '大会员',
    '普通会员'
];
/**
 * 周期规整规则：命中关键词即归一化为标准档位。
 * days 用于排序（升序），并非精确天数。
 * 顺序很重要：先匹配更具体/更长的词（如「双年卡」先于「年卡」，「半年」先于「年」）。
 */
const PERIOD_RULES = [
    { test: /(7\s*天|七天)/, period: '7天', days: 7 },
    { test: /(双年卡|24\s*个月|２４个月|2\s*年|两年)/, period: '24个月', days: 730 },
    // 12 个月须先于 2 个月匹配，避免「12个月」被「2个月」子串命中
    { test: /(年卡|12\s*个月|十二个月|1\s*年|一年)/, period: '12个月', days: 365 },
    { test: /(半年|6\s*个月|六个月)/, period: '6个月', days: 180 },
    { test: /(季卡|3\s*个月|三个月)/, period: '3个月', days: 90 },
    { test: /(2\s*个月|两个月|二个月)/, period: '2个月', days: 60 },
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
/** 综合解析商品名 */
function parseGoodsName(name) {
    const { channel, priority } = parseChannel(name);
    const { period, days } = parsePeriod(name);
    return {
        channel,
        channelPriority: priority,
        memberType: parseMemberType(name),
        period,
        periodDays: days
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
/**
 * 将一个品牌下的多条 SKU 去重为套餐列表。
 * 规则：
 * - 按「会员类型 + 周期」分组（packageDedupKey）
 * - 同组只保留渠道优先级最高的一条（priority 数字最小）；
 *   并列时取成本价更低的，再并列取 id 更小的（保证确定性）
 * - 结果排序：会员类型按首次出现顺序，组内按周期天数升序
 */
function dedupSkusToPackages(skus) {
    const best = new Map();
    const memberTypeOrder = [];
    for (const sku of skus) {
        const parsed = parseGoodsName(sku.goods_name);
        const key = packageDedupKey(parsed.memberType, parsed.period);
        const candidate = {
            memberType: parsed.memberType,
            period: parsed.period,
            periodDays: parsed.periodDays,
            shunshiGoodsId: sku.id,
            costPrice: toNumber(sku.goods_price),
            faceValue: toNumber(sku.face_value),
            stock: toNumber(sku.stock_num),
            channel: parsed.channel,
            channelPriority: parsed.channelPriority
        };
        const existing = best.get(key);
        if (!existing) {
            best.set(key, candidate);
            if (memberTypeOrder.indexOf(parsed.memberType) < 0) {
                memberTypeOrder.push(parsed.memberType);
            }
            continue;
        }
        if (isBetterCandidate(candidate, existing)) {
            best.set(key, candidate);
        }
    }
    const list = Array.from(best.values());
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
/** 候选 a 是否优于当前 b（优先级更高 / 成本更低 / id 更小） */
function isBetterCandidate(a, b) {
    if (a.channelPriority !== b.channelPriority)
        return a.channelPriority < b.channelPriority;
    if (a.costPrice !== b.costPrice)
        return a.costPrice < b.costPrice;
    return a.shunshiGoodsId < b.shunshiGoodsId;
}
