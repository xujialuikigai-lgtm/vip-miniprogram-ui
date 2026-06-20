/**
 * 会员多多购商品接口信息导出脚本
 *
 * 用法：
 * 1. 打开微信开发者工具，确认已初始化云开发环境并能正常调用云函数。
 * 2. 打开调试器 Console。
 * 3. 整个文件复制进去执行。
 *
 * 输出：
 * - 小程序本地文件：wx.env.USER_DATA_PATH/product-interface-info-*.json
 * - 云存储文件：debug-exports/product-interface-info-*.json（默认上传）
 * - Console 会打印统计、样例、云文件下载链接。
 */
(async function exportProductInterfaceInfo() {
  const options = {
    pageSize: 50,
    detailConcurrency: 4,
    uploadToCloud: true,
    cloudDir: 'debug-exports',
    includeTempImageUrls: true,
    samplePerCategory: 4
  };

  if (typeof wx === 'undefined' || !wx.cloud) {
    throw new Error('请在微信开发者工具的小程序 Console 中运行本脚本');
  }

  const pad = (n) => String(n).padStart(2, '0');
  const stamp = (() => {
    const d = new Date();
    return [
      d.getFullYear(),
      pad(d.getMonth() + 1),
      pad(d.getDate()),
      '-',
      pad(d.getHours()),
      pad(d.getMinutes()),
      pad(d.getSeconds())
    ].join('');
  })();

  const fileName = `product-interface-info-${stamp}.json`;
  const localFilePath = `${wx.env.USER_DATA_PATH}/${fileName}`;
  const cloudPath = `${options.cloudDir}/${fileName}`;

  const callFunction = async (name, data) => {
    const res = await wx.cloud.callFunction({ name, data });
    return res && res.result;
  };

  const toTempUrl = async (url) => {
    const value = String(url || '').trim();
    if (!value || !options.includeTempImageUrls) return '';
    if (!/^cloud:\/\//i.test(value)) return value;
    try {
      const res = await wx.cloud.getTempFileURL({ fileList: [value] });
      return (res.fileList && res.fileList[0] && res.fileList[0].tempFileURL) || value;
    } catch (err) {
      return value;
    }
  };

  const runPool = async (items, limit, worker) => {
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
  };

  const getCategories = async () => {
    const res = await callFunction('product', { action: 'getCategories' });
    return (res && res.success && res.data && res.data.categories) || [];
  };

  const getAdminProductIds = async () => {
    try {
      const res = await callFunction('admin', { action: 'productList', status: 'all' });
      if (!res || !res.success || !res.data || !Array.isArray(res.data.list)) {
        return { source: 'admin.productList_failed', list: [] };
      }
      return { source: 'admin.productList', list: res.data.list };
    } catch (err) {
      return { source: 'admin.productList_unavailable', list: [] };
    }
  };

  const getVisibleProductIdsByCategory = async (categories) => {
    const seen = new Set();
    const list = [];

    for (const category of categories) {
      let page = 1;
      while (true) {
        const res = await callFunction('product', {
          action: 'getList',
          categoryId: category.categoryId,
          page,
          pageSize: options.pageSize
        });

        const pageList = (res && res.success && res.data && res.data.list) || [];
        for (const item of pageList) {
          if (item && item.productId && !seen.has(item.productId)) {
            seen.add(item.productId);
            list.push(item);
          }
        }

        const total = (res && res.data && res.data.total) || pageList.length;
        if (page * options.pageSize >= total || pageList.length === 0) break;
        page += 1;
      }
    }

    return list;
  };

  const getProductDetail = async (productId) => {
    const res = await callFunction('product', { action: 'getDetail', productId });
    if (!res || !res.success || !res.data || !res.data.product) {
      return { productId, error: (res && (res.errMsg || res.errCode)) || 'detail_failed' };
    }
    return res.data;
  };

  console.log('[export] 正在读取分类...');
  const categories = await getCategories();

  console.log('[export] 正在读取商品 ID...');
  const adminProducts = await getAdminProductIds();
  let productRefs = adminProducts.list;
  let productSource = adminProducts.source;

  if (!productRefs.length) {
    console.log('[export] admin.productList 不可用，回退到 product.getList。注意：回退模式只能导出前台已展示商品。');
    productRefs = await getVisibleProductIdsByCategory(categories);
    productSource = 'product.getList';
  }

  const productIds = Array.from(
    new Set(productRefs.map((item) => item && item.productId).filter(Boolean))
  );

  console.log(`[export] 共发现 ${productIds.length} 个商品，正在读取详情...`);
  const details = await runPool(productIds, options.detailConcurrency, async (productId, index) => {
    if ((index + 1) % 20 === 0 || index === productIds.length - 1) {
      console.log(`[export] 商品详情进度 ${index + 1}/${productIds.length}`);
    }
    return getProductDetail(productId);
  });

  const products = await runPool(details, options.detailConcurrency, async (detail) => {
    if (detail.error) return detail;

    const p = detail.product;
    const packages = detail.packages || p.packages || [];
    const brandIconTempUrl = await toTempUrl(p.brandIcon);
    const shunshiImgTempUrl = await toTempUrl(p.shunshiImg);

    return {
      productId: p.productId,
      shunshiGoodsId: p.shunshiGoodsId,
      name: p.name,
      shunshiName: p.shunshiName,
      categoryId: p.categoryId,
      categoryName: p.categoryName,
      rechargeMethod: p.rechargeMethod,
      accountType: p.accountType,
      autoActivate: p.autoActivate,
      online: p.online,
      sortWeight: p.sortWeight,
      salesCount: p.salesCount,
      todaySales: p.todaySales,
      shunshiStatus: p.shunshiStatus,
      stockNum: p.stockNum,
      tags: p.tags || [],
      description: p.description || '',
      rules: p.rules || {},
      attachTemplate: p.attachTemplate || [],
      images: {
        brandIcon: p.brandIcon || '',
        brandIconTempUrl,
        shunshiImg: p.shunshiImg || '',
        shunshiImgTempUrl,
        candidates: [brandIconTempUrl, shunshiImgTempUrl, p.brandIcon, p.shunshiImg].filter(Boolean)
      },
      packages: packages.map((pkg) => ({
        packageId: pkg.packageId,
        name: pkg.name,
        memberType: pkg.memberType,
        price: pkg.price,
        costPrice: pkg.costPrice,
        faceValue: pkg.faceValue,
        shunshiGoodsId: pkg.shunshiGoodsId,
        stock: pkg.stock,
        online: pkg.online,
        isDefault: pkg.isDefault,
        sortWeight: pkg.sortWeight
      })),
      rawProduct: p
    };
  });

  const okProducts = products.filter((p) => !p.error);
  const failedProducts = products.filter((p) => p.error);
  const categoryMap = new Map(categories.map((c) => [c.categoryId, c]));

  const sampleByCategory = categories.map((category) => ({
    categoryId: category.categoryId,
    categoryName: category.name,
    samples: okProducts
      .filter((p) => p.categoryId === category.categoryId)
      .slice(0, options.samplePerCategory)
      .map((p) => ({
        productId: p.productId,
        name: p.name,
        image: p.images.brandIconTempUrl || p.images.shunshiImgTempUrl,
        shunshiImg: p.images.shunshiImg,
        price: p.packages && p.packages[0] ? p.packages[0].price : 0,
        costPrice: p.packages && p.packages[0] ? p.packages[0].costPrice : 0,
        packageCount: p.packages.length
      }))
  }));

  const exportData = {
    exportedAt: new Date().toISOString(),
    source: {
      productIds: productSource,
      detail: 'product.getDetail',
      categories: 'product.getCategories'
    },
    schema: {
      productListFieldsFromShunshi: [
        'id',
        'goods_name',
        'goods_img',
        'goods_type',
        'face_value',
        'goods_price',
        'status',
        'stock_num'
      ],
      productFieldsSavedInDatabase: [
        'productId',
        'shunshiGoodsId',
        'name',
        'shunshiName',
        'categoryId',
        'categoryName',
        'brandIcon',
        'shunshiImg',
        'tags',
        'description',
        'rechargeMethod',
        'accountType',
        'autoActivate',
        'online',
        'sortWeight',
        'salesCount',
        'todaySales',
        'shunshiStatus',
        'stockNum',
        'attachTemplate',
        'packages',
        'rules'
      ],
      packageFields: [
        'packageId',
        'name',
        'memberType',
        'price',
        'costPrice',
        'faceValue',
        'shunshiGoodsId',
        'stock',
        'online',
        'isDefault',
        'sortWeight'
      ]
    },
    counts: {
      categories: categories.length,
      productRefs: productRefs.length,
      products: okProducts.length,
      failedProducts: failedProducts.length,
      onlineProducts: okProducts.filter((p) => p.online).length,
      packages: okProducts.reduce((sum, p) => sum + p.packages.length, 0),
      cloudImages: okProducts.filter((p) => /^cloud:\/\//i.test(p.images.brandIcon || '')).length,
      remoteImages: okProducts.filter((p) => /^https?:\/\//i.test(p.images.shunshiImg || '')).length
    },
    categories,
    sampleByCategory,
    failedProducts,
    products
  };

  const json = JSON.stringify(exportData, null, 2);
  const fs = wx.getFileSystemManager();
  fs.writeFileSync(localFilePath, json, 'utf8');

  let cloudFile = null;
  if (options.uploadToCloud) {
    try {
      const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath: localFilePath });
      const tempRes = await wx.cloud.getTempFileURL({ fileList: [uploadRes.fileID] });
      cloudFile = {
        cloudPath,
        fileID: uploadRes.fileID,
        tempFileURL:
          (tempRes.fileList && tempRes.fileList[0] && tempRes.fileList[0].tempFileURL) || ''
      };
    } catch (err) {
      cloudFile = { cloudPath, error: err && (err.message || err.errMsg || String(err)) };
    }
  }

  const summary = {
    fileName,
    localFilePath,
    cloudFile,
    counts: exportData.counts,
    samples: sampleByCategory
  };

  wx.setClipboardData({
    data: JSON.stringify(summary, null, 2),
    success: () => console.log('[export] 摘要已复制到剪贴板')
  });

  console.log('[export] 导出完成');
  console.log('[export] 本地文件：', localFilePath);
  console.log('[export] 云文件：', cloudFile);
  console.log('[export] 统计：', exportData.counts);
  console.log('[export] 分类样例：', sampleByCategory);
  return exportData;
})();
