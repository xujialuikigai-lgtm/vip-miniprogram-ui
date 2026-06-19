/**
 * 数据库初始化脚本
 *
 * 使用方式：作为云函数一次性执行，完成集合创建和初始数据插入。
 * 索引创建需通过微信开发者工具控制台或 tcb CLI 手动配置。
 *
 * 集合列表：
 * - orders（订单集合）
 * - products（商品集合）
 * - categories（分类集合）
 * - admin_whitelist（管理员白名单集合）
 * - audit_logs（审计日志集合）
 * - system_config（系统配置集合）
 * - broadcast_cache（播报缓存集合）
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

// ============================================================
// 集合定义
// ============================================================

/** 需要创建的集合列表 */
const COLLECTIONS = [
  'orders',
  'products',
  'categories',
  'admin_whitelist',
  'audit_logs',
  'system_config',
  'broadcast_cache'
] as const;

// ============================================================
// 索引定义（需在控制台/CLI 手动创建）
// ============================================================

/**
 * 索引配置声明
 *
 * 由于微信云开发数据库索引只能通过以下方式创建：
 * 1. 微信开发者工具 → 云开发控制台 → 数据库 → 集合 → 索引管理
 * 2. tcb CLI：tcb storage:create-index
 *
 * 以下配置作为文档记录，指导手动操作。
 */
export const INDEX_DEFINITIONS = {
  orders: [
    {
      name: 'idx_openid_status_createdAt',
      fields: [
        { fieldPath: 'openid', order: 'asc' },
        { fieldPath: 'status', order: 'asc' },
        { fieldPath: 'createdAt', order: 'desc' }
      ],
      unique: false,
      description: '用户订单列表查询：按用户+状态+时间排序'
    },
    {
      name: 'idx_status_createdAt',
      fields: [
        { fieldPath: 'status', order: 'asc' },
        { fieldPath: 'createdAt', order: 'desc' }
      ],
      unique: false,
      description: '管理端订单列表、定时任务扫描'
    },
    {
      name: 'idx_orderId_unique',
      fields: [
        { fieldPath: 'orderId', order: 'asc' }
      ],
      unique: true,
      description: '订单号唯一索引，防重复创建'
    },
    {
      name: 'idx_shunshiOrderSn',
      fields: [
        { fieldPath: 'shunshiOrderSn', order: 'asc' }
      ],
      unique: false,
      description: '顺势订单号查询，回调时快速定位订单'
    }
  ],

  products: [
    {
      name: 'idx_categoryId_online_sortWeight',
      fields: [
        { fieldPath: 'categoryId', order: 'asc' },
        { fieldPath: 'online', order: 'asc' },
        { fieldPath: 'sortWeight', order: 'asc' }
      ],
      unique: false,
      description: '分类商品列表查询'
    },
    {
      name: 'idx_online_sortWeight',
      fields: [
        { fieldPath: 'online', order: 'asc' },
        { fieldPath: 'sortWeight', order: 'asc' }
      ],
      unique: false,
      description: '首页商品列表查询'
    },
    {
      name: 'idx_shunshiGoodsId',
      fields: [
        { fieldPath: 'shunshiGoodsId', order: 'asc' }
      ],
      unique: false,
      description: '商品同步时按顺势商品ID匹配'
    },
    {
      name: 'idx_name_text',
      fields: [
        { fieldPath: 'name', order: 'asc' }
      ],
      unique: false,
      description: '商品名称文本索引，搜索用（需在控制台配置为文本索引类型）'
    }
  ],

  categories: [
    {
      name: 'idx_categoryId_unique',
      fields: [
        { fieldPath: 'categoryId', order: 'asc' }
      ],
      unique: true,
      description: '分类ID唯一索引'
    },
    {
      name: 'idx_parentId_level',
      fields: [
        { fieldPath: 'parentId', order: 'asc' },
        { fieldPath: 'level', order: 'asc' }
      ],
      unique: false,
      description: '按父级分类和层级查询子分类'
    }
  ],

  audit_logs: [
    {
      name: 'idx_createdAt',
      fields: [
        { fieldPath: 'createdAt', order: 'desc' }
      ],
      unique: false,
      description: '时间倒序查询审计日志'
    },
    {
      name: 'idx_orderId_createdAt',
      fields: [
        { fieldPath: 'orderId', order: 'asc' },
        { fieldPath: 'createdAt', order: 'desc' }
      ],
      unique: false,
      description: '按订单号查询关联审计日志'
    },
    {
      name: 'idx_type_createdAt',
      fields: [
        { fieldPath: 'type', order: 'asc' },
        { fieldPath: 'createdAt', order: 'desc' }
      ],
      unique: false,
      description: '按操作类型筛选审计日志'
    }
  ],

  admin_whitelist: [
    {
      name: 'idx_openid_unique',
      fields: [
        { fieldPath: 'openid', order: 'asc' }
      ],
      unique: true,
      description: '管理员openid唯一索引'
    }
  ],

  system_config: [
    {
      name: 'idx_key_unique',
      fields: [
        { fieldPath: 'key', order: 'asc' }
      ],
      unique: true,
      description: '配置键名唯一索引'
    }
  ],

  broadcast_cache: []
};

// ============================================================
// 初始系统配置数据
// ============================================================

/** 预设系统配置项 */
const INITIAL_CONFIGS = [
  {
    key: 'homepage_order_count',
    value: '8.2万+',
    desc: '首页累计订单数展示',
    updatedAt: new Date()
  },
  {
    key: 'customer_service_qrcode',
    value: 'cloud://xxx.png',
    desc: '客服二维码图片',
    updatedAt: new Date()
  },
  {
    key: 'purchase_notice',
    value: '<p>购买须知内容</p>',
    desc: '购买须知',
    updatedAt: new Date()
  },
  {
    key: 'account_guide',
    value: '<p>账号填写说明</p>',
    desc: '账号填写说明',
    updatedAt: new Date()
  },
  {
    key: 'platform_announcement',
    value: '<p>平台公告</p>',
    desc: '平台公告',
    updatedAt: new Date()
  }
];

// ============================================================
// 初始化逻辑
// ============================================================

/**
 * 创建集合（如果不存在）
 */
async function createCollections(): Promise<{ created: string[]; existed: string[] }> {
  const created: string[] = [];
  const existed: string[] = [];

  for (const name of COLLECTIONS) {
    try {
      await db.createCollection(name);
      created.push(name);
      console.log(`[初始化] 集合 "${name}" 创建成功`);
    } catch (err: any) {
      // 错误码 -502005 表示集合已存在
      if (err.errCode === -502005 || err.message?.includes('already exists')) {
        existed.push(name);
        console.log(`[初始化] 集合 "${name}" 已存在，跳过`);
      } else {
        console.error(`[初始化] 集合 "${name}" 创建失败:`, err);
        throw err;
      }
    }
  }

  return { created, existed };
}

/**
 * 插入初始系统配置数据
 * 使用 upsert 逻辑：如果 key 已存在则跳过，不覆盖已有配置
 */
async function insertInitialConfigs(): Promise<{ inserted: string[]; skipped: string[] }> {
  const inserted: string[] = [];
  const skipped: string[] = [];
  const collection = db.collection('system_config');

  for (const config of INITIAL_CONFIGS) {
    try {
      // 检查是否已存在
      const { data } = await collection.where({ key: config.key }).get();
      if (data.length > 0) {
        skipped.push(config.key);
        console.log(`[初始化] 配置 "${config.key}" 已存在，跳过`);
        continue;
      }

      // 插入新配置
      await collection.add({ data: config });
      inserted.push(config.key);
      console.log(`[初始化] 配置 "${config.key}" 插入成功`);
    } catch (err: any) {
      console.error(`[初始化] 配置 "${config.key}" 插入失败:`, err);
      throw err;
    }
  }

  return { inserted, skipped };
}

/**
 * 打印索引配置指南
 */
function printIndexGuide(): void {
  console.log('\n========================================');
  console.log('索引配置指南（需在控制台手动创建）');
  console.log('========================================\n');

  for (const [collectionName, indexes] of Object.entries(INDEX_DEFINITIONS)) {
    if (indexes.length === 0) continue;

    console.log(`\n【${collectionName}】集合索引：`);
    for (const index of indexes) {
      const fieldsStr = index.fields
        .map(f => `${f.fieldPath}(${f.order})`)
        .join(' + ');
      const uniqueStr = index.unique ? ' [唯一]' : '';
      console.log(`  - ${index.name}: ${fieldsStr}${uniqueStr}`);
      console.log(`    说明: ${index.description}`);
    }
  }

  console.log('\n========================================');
  console.log('请在微信开发者工具 → 云开发控制台 → 数据库中创建以上索引');
  console.log('或使用 tcb CLI: tcb storage:create-index');
  console.log('========================================\n');
}

// ============================================================
// 云函数入口
// ============================================================

export async function main() {
  console.log('[数据库初始化] 开始执行...\n');

  const startTime = Date.now();

  // 步骤1：创建集合
  console.log('--- 步骤1: 创建集合 ---');
  const collectionResult = await createCollections();

  // 步骤2：插入初始配置
  console.log('\n--- 步骤2: 插入初始配置 ---');
  const configResult = await insertInitialConfigs();

  // 步骤3：打印索引配置指南
  console.log('\n--- 步骤3: 索引配置指南 ---');
  printIndexGuide();

  const duration = Date.now() - startTime;

  const summary = {
    success: true,
    duration: `${duration}ms`,
    collections: collectionResult,
    configs: configResult,
    indexNote: '索引需在控制台手动创建，详见上方日志输出'
  };

  console.log('\n[数据库初始化] 执行完成！');
  console.log('摘要:', JSON.stringify(summary, null, 2));

  return summary;
}

// 云函数入口导出
exports.main = main;
