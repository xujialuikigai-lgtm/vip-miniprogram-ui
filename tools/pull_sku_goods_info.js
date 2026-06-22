/**
 * 拉取同步范围内每个 SKU 的 goods_info / goods_notice 到本地。
 *
 * 用法：
 *   SS_USER_ID=xxx SS_API_KEY=xxx node tools/pull_sku_goods_info.js
 * 或：
 *   SHUNSHI_USER_ID=xxx SHUNSHI_API_KEY=xxx node tools/pull_sku_goods_info.js
 *
 * 输入：
 *   data-export/shunshi-direct-raw.json
 *
 * 输出：
 *   data-export/sku-goods-info.json
 *   data-export/sku-goods-info-samples.md
 */
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { URL } = require('url');

const BASE_URL = 'https://shop.mxmm666.com';
const USER_ID = process.env.SS_USER_ID || process.env.SHUNSHI_USER_ID;
const API_KEY = process.env.SS_API_KEY || process.env.SHUNSHI_API_KEY;

if (!USER_ID || !API_KEY) {
  console.error('缺少 SS_USER_ID/SS_API_KEY 或 SHUNSHI_USER_ID/SHUNSHI_API_KEY 环境变量');
  process.exit(1);
}

const inputPath = path.join(__dirname, '..', 'data-export', 'shunshi-direct-raw.json');
const outputPath = path.join(__dirname, '..', 'data-export', 'sku-goods-info.json');
const samplePath = path.join(__dirname, '..', 'data-export', 'sku-goods-info-samples.md');

function sortKeys(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const result = {};
  for (const key of Object.keys(value).sort()) {
    result[key] = sortKeys(value[key]);
  }
  return result;
}

function sign(timestamp, body) {
  return crypto
    .createHash('sha1')
    .update(timestamp + JSON.stringify(sortKeys(body)) + API_KEY)
    .digest('hex');
}

function request(pathname, body = {}) {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now().toString();
    const postData = JSON.stringify(body);
    const url = new URL(pathname, BASE_URL);
    const req = https.request(
      {
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Sign: sign(timestamp, body),
          Timestamp: timestamp,
          UserId: USER_ID,
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 15000
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
            return;
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.code !== 200) {
              reject(new Error(`API ${parsed.code}: ${parsed.msg || data}`));
              return;
            }
            resolve(parsed.data);
          } catch (err) {
            reject(new Error(`响应解析失败: ${data}`));
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`timeout ${pathname}`));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function uniqueSkus(rawByBrand) {
  const seen = new Set();
  const skus = [];
  for (const brandInfo of Object.values(rawByBrand)) {
    for (const sku of brandInfo.skus || []) {
      if (seen.has(sku.id)) continue;
      seen.add(sku.id);
      skus.push({
        productId: brandInfo.productId,
        categoryId: brandInfo.categoryId,
        categoryName: brandInfo.categoryName,
        brand: brandInfo.brand,
        ...sku
      });
    }
  }
  return skus;
}

function clip(text, max = 300) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? value.slice(0, max) + '...' : value;
}

(async () => {
  const rawByBrand = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const skus = uniqueSkus(rawByBrand);
  console.log(`[sku-info] 待拉取 SKU：${skus.length}`);

  const rows = await runPool(skus, 5, async (sku, index) => {
    if ((index + 1) % 20 === 0 || index === skus.length - 1) {
      console.log(`[sku-info] 进度 ${index + 1}/${skus.length}`);
    }
    try {
      const detail = await request('/api/v1/goods/info', { id: sku.id });
      return {
        categoryId: sku.categoryId,
        categoryName: sku.categoryName,
        brand: sku.brand,
        id: sku.id,
        goods_name: detail.goods_name || sku.goods_name,
        goods_price: detail.goods_price || sku.goods_price,
        face_value: detail.face_value || sku.face_value,
        status: detail.status,
        stock_num: detail.stock_num,
        goods_info: detail.goods_info || '',
        goods_notice: detail.goods_notice || '',
        attach: detail.attach || [],
        error: ''
      };
    } catch (err) {
      return {
        categoryId: sku.categoryId,
        categoryName: sku.categoryName,
        brand: sku.brand,
        id: sku.id,
        goods_name: sku.goods_name,
        goods_price: sku.goods_price,
        face_value: sku.face_value,
        status: sku.status,
        stock_num: sku.stock_num,
        goods_info: '',
        goods_notice: '',
        attach: [],
        error: err && err.message ? err.message : String(err)
      };
    }
  });

  const payload = {
    exportedAt: new Date().toISOString(),
    source: '/api/v1/goods/info',
    count: rows.length,
    successCount: rows.filter((row) => !row.error).length,
    failedCount: rows.filter((row) => row.error).length,
    rows
  };
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));

  const samples = rows
    .filter((row) => !row.error && (row.goods_info || row.goods_notice))
    .slice(0, 20);
  const md = [
    '# SKU goods_info / goods_notice 样例',
    '',
    `导出时间：${payload.exportedAt}`,
    `总数：${payload.count}，成功：${payload.successCount}，失败：${payload.failedCount}`,
    '',
    ...samples.flatMap((row, idx) => [
      `## ${idx + 1}. ${row.brand} / SKU ${row.id}`,
      '',
      `商品名：${row.goods_name}`,
      '',
      `goods_info：${clip(row.goods_info) || '-'}`,
      '',
      `goods_notice：${clip(row.goods_notice) || '-'}`,
      ''
    ])
  ].join('\n');
  fs.writeFileSync(samplePath, md);

  console.log(`[sku-info] 已输出：${outputPath}`);
  console.log(`[sku-info] 样例：${samplePath}`);
})();
