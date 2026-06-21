// 在同步范围内拉取所有直充(goods_type=2)商品到本地
// 用法：SS_USER_ID=xxx SS_API_KEY=xxx node tools/pull_direct_products.js
// 输出：
//   data-export/shunshi-direct-raw.json   范围内全部直充原始 SKU（按品牌分组）
//   data-export/shunshi-brands.json       按品牌聚合后的套餐矩阵（去重择优）
//   data-export/shunshi-summary.txt       概览
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { dedupSkusToPackages, isChannelSellable, isChannelExcluded } = require('../cloudfunctions/product/parseGoods.js');

const BASE_URL = 'https://shop.mxmm666.com';
const USER_ID = process.env.SS_USER_ID;
const API_KEY = process.env.SS_API_KEY;
if (!USER_ID || !API_KEY) {
  console.error('缺少 SS_USER_ID / SS_API_KEY 环境变量');
  process.exit(1);
}

// 与 cloudfunctions/product/index.ts 的 TARGET_SYNC_GROUPS 保持一致（同步范围）
const TARGET_SYNC_GROUPS = [
  { categoryId: 'target_video', name: '视频会员', keywords: ['腾讯视频', '腾讯体育', '爱奇艺', '芒果TV', '优酷视频', '哔哩哔哩', '咪咕视频', '央视频'] },
  { categoryId: 'target_music', name: '音乐', keywords: ['汽水音乐', 'QQ音乐', '喜马拉雅', '网易云音乐', '全民K歌', '酷狗音乐', '酷我音乐'] },
  { categoryId: 'target_audio_book', name: '阅读听书', keywords: ['懒人听书', '蜻蜓FM', 'QQ阅读', '樊登读书'] },
  { categoryId: 'target_cloud', name: '网盘', keywords: ['百度网盘', '夸克', '迅雷'] },
  { categoryId: 'target_tool', name: '办公工具', keywords: ['剪映', 'WPS', '醒图', '百度文库', '乐播投屏'] },
  { categoryId: 'target_fitness', name: '运动健身', keywords: [] },
  { categoryId: 'target_bike', name: '共享单车', keywords: ['哈啰', '美团单车', '美团电单车', '青桔'] }
];

function sortKeys(o) { if (o === null || typeof o !== 'object') return o; if (Array.isArray(o)) return o.map((i) => (i && typeof i === 'object' ? sortKeys(i) : i)); const s = {}; for (const k of Object.keys(o).sort()) { const v = o[k]; s[k] = v && typeof v === 'object' ? sortKeys(v) : v; } return s; }
function sign(ts, b, k) { return crypto.createHash('sha1').update(ts + JSON.stringify(sortKeys(b)) + k).digest('hex'); }
function req(p, body = {}) {
  return new Promise((resolve, reject) => {
    const ts = Date.now().toString();
    const pd = JSON.stringify(body);
    const url = new URL(p, BASE_URL);
    const r = https.request({ hostname: url.hostname, port: 443, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', Sign: sign(ts, body, API_KEY), Timestamp: ts, UserId: USER_ID, 'Content-Length': Buffer.byteLength(pd) }, timeout: 15000 },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({ raw: d }); } }); });
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout ' + p)); });
    r.on('error', reject); r.write(pd); r.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

// 拉取单个关键词全部分页的直充商品（带关键词包含校验，与 shouldSyncTargetProduct 一致）
async function fetchKeyword(keyword) {
  const items = [];
  let page = 1;
  while (true) {
    const res = await req('/api/v1/goods/list', { keyword, page, limit: 100 });
    const raw = (res.data && res.data.list) || [];
    for (const g of raw) {
      if (Number(g.goods_type) === 2 && isChannelSellable(g.can_buy) && !isChannelExcluded(g.goods_name) && norm(g.goods_name).indexOf(norm(keyword)) >= 0) {
        items.push(g);
      }
    }
    const total = res.data ? res.data.total : 0;
    if (raw.length < 100 || page * 100 >= total) break;
    page += 1;
    await sleep(120);
  }
  return items;
}

(async () => {
  const outDir = path.join(__dirname, '..', 'data-export');
  fs.mkdirSync(outDir, { recursive: true });

  const rawByBrand = {};
  const brands = [];
  const summaryLines = [];
  const seen = new Set(); // 全局按 SKU id 去重，避免一个 SKU 同时命中多个关键词

  for (const group of TARGET_SYNC_GROUPS) {
    for (const keyword of group.keywords) {
      const all = await fetchKeyword(keyword);
      const items = all.filter((g) => { if (seen.has(g.id)) return false; seen.add(g.id); return true; });
      const productId = `brand_${group.categoryId}_${keyword}`;

      rawByBrand[productId] = {
        categoryId: group.categoryId,
        categoryName: group.name,
        brand: keyword,
        skuCount: items.length,
        skus: items.map((g) => ({ id: g.id, goods_name: g.goods_name, goods_price: g.goods_price, face_value: g.face_value, stock_num: g.stock_num, status: g.status }))
      };

      const packages = dedupSkusToPackages(items.map((g) => ({ id: g.id, goods_name: g.goods_name, goods_price: g.goods_price, face_value: g.face_value, stock_num: g.stock_num })));
      brands.push({ productId, categoryId: group.categoryId, categoryName: group.name, brand: keyword, skuCount: items.length, packageCount: packages.length, packages });

      const line = `[${group.name}] ${keyword}: 直充SKU ${items.length} → 套餐 ${packages.length}`;
      summaryLines.push(line);
      console.log(line);
      await sleep(150);
    }
  }

  const totalSku = brands.reduce((s, b) => s + b.skuCount, 0);
  const totalPkg = brands.reduce((s, b) => s + b.packageCount, 0);
  const head = `拉取时间：${new Date().toISOString()}\n品牌数：${brands.length}，直充SKU合计：${totalSku}，聚合套餐合计：${totalPkg}\n`;

  fs.writeFileSync(path.join(outDir, 'shunshi-direct-raw.json'), JSON.stringify(rawByBrand, null, 2));
  fs.writeFileSync(path.join(outDir, 'shunshi-brands.json'), JSON.stringify(brands, null, 2));
  fs.writeFileSync(path.join(outDir, 'shunshi-summary.txt'), head + '\n' + summaryLines.join('\n') + '\n');

  console.log('\n' + head);
  console.log('已输出到 data-export/：shunshi-direct-raw.json / shunshi-brands.json / shunshi-summary.txt');
})().catch((e) => console.error('ERROR:', e.message));
