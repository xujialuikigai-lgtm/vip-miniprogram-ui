const fs = require('fs');

const inputPath = 'data-export/sku-goods-info.json';
const outputPath = 'data-export/sku-goods-info-readable.md';

const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const rows = payload.rows || [];

function stripHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function clip(value, max = 700) {
  const text = stripHtml(value);
  return text.length > max ? `${text.slice(0, max)}...` : text || '-';
}

function imageUrls(value) {
  const result = [];
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let match;
  while ((match = re.exec(String(value || ''))) && result.length < 8) {
    result.push(match[1]);
  }
  return result;
}

const byCategory = new Map();
for (const row of rows) {
  const key = row.categoryName || '未分类';
  if (!byCategory.has(key)) byCategory.set(key, []);
  byCategory.get(key).push(row);
}

const lines = [
  '# SKU goods_info / goods_notice 本地查看报告',
  '',
  `导出时间：${payload.exportedAt}`,
  `详情接口：${payload.source}`,
  `总 SKU：${payload.count}，成功：${payload.successCount}，失败：${payload.failedCount}`,
  `goods_info 有值：${rows.filter((row) => row.goods_info).length}`,
  `goods_notice 有值：${rows.filter((row) => row.goods_notice).length}`,
  '',
  '## 分类覆盖',
  ''
];

for (const [categoryName, list] of byCategory) {
  lines.push(
    `- ${categoryName}: ${list.length} 个，goods_info ${list.filter((row) => row.goods_info).length} 个，goods_notice ${list.filter((row) => row.goods_notice).length} 个`
  );
}

lines.push('', '## 按分类抽样', '');

for (const [categoryName, list] of byCategory) {
  lines.push(`### ${categoryName}`, '');
  const samples = list
    .filter((row) => !row.error && (row.goods_info || row.goods_notice))
    .slice(0, 3);

  if (!samples.length) {
    lines.push('- 暂无 goods_info/goods_notice 样例', '');
    continue;
  }

  for (const row of samples) {
    const images = imageUrls(row.goods_info);
    lines.push(
      `#### ${row.brand} / SKU ${row.id}`,
      '',
      `商品名：${row.goods_name}`,
      '',
      `成本价：${row.goods_price || '-'}，面值：${row.face_value || '-'}`,
      '',
      `goods_info：${clip(row.goods_info)}`,
      '',
      `goods_notice：${clip(row.goods_notice)}`,
      ''
    );

    if (images.length) {
      lines.push('图片链接：', ...images.map((url) => `- ${url}`), '');
    }

    if (Array.isArray(row.attach) && row.attach.length) {
      lines.push(
        '下单表单字段：',
        ...row.attach.map(
          (field) =>
            `- ${field.name || field.key || '-'} / key=${field.key || '-'} / 校验=${field.vali || '-'} / 提示=${field.tip || '-'}`
        ),
        ''
      );
    }
  }
}

const failed = rows.filter((row) => row.error);
if (failed.length) {
  lines.push('## 失败 SKU', '', ...failed.map((row) => `- SKU ${row.id} ${row.goods_name}: ${row.error}`));
}

fs.writeFileSync(outputPath, lines.join('\n'));
console.log(`已生成 ${outputPath}`);
