// 订单创建逻辑
import { Order, OrderStatus, TimelineNode } from './shared/types/order';
import { Product, Package, PackageAccountVariant } from './shared/types/product';
import { CloudFunctionResult } from './shared/types/api';
import { AuditType } from './shared/types/audit';
import { createAuditLog, writeAuditLog } from './shared/utils/logger';
import { ORDER_ID_PREFIX } from './shared/constants';

/** 创建订单入参 */
export interface CreateOrderParams {
  /** 本地商品ID */
  productId: string;
  /** 套餐ID */
  packageId: string;
  /** 用户填写的开通参数（如充值账号） */
  attach?: Record<string, any>;
}

/** 创建订单返回数据 */
export interface CreateOrderData {
  /** 系统订单号 */
  orderId: string;
}

/**
 * 生成唯一订单号
 * 格式：VIP + 13位毫秒时间戳 + 4位随机数字
 * 例如：VIP17041234567890123
 */
function generateOrderId(): string {
  const timestamp = Date.now().toString();
  // 生成 4 位随机数字（0000-9999），不足补零
  const random = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
  return `${ORDER_ID_PREFIX}${timestamp}${random}`;
}

/**
 * 从用户填写的开通参数中提取充值账号字符串。
 * 兼容常见 key：recharge_account / phone / account / mobile / qq；
 * 找不到约定 key 时取首个字符串值。
 */
function extractAccountFromAttach(attach?: Record<string, any>): string {
  if (!attach || typeof attach !== 'object') return '';
  const preferKeys = ['recharge_account', 'phone', 'account', 'mobile', 'qq'];
  for (const k of preferKeys) {
    if (typeof attach[k] === 'string' && attach[k].trim()) return attach[k].trim();
  }
  for (const k of Object.keys(attach)) {
    if (typeof attach[k] === 'string' && attach[k].trim()) return attach[k].trim();
  }
  return '';
}

/**
 * 按用户输入的账号格式选择账号形式变体：
 * - 1 开头 11 位数字 → phone；5~10 位纯数字 → qq
 * - 套餐无变体或无匹配时返回 undefined（调用方用套餐主 SKU）
 */
function pickAccountVariant(
  variants: PackageAccountVariant[] | undefined,
  account: string
): PackageAccountVariant | undefined {
  if (!variants || variants.length === 0) return undefined;
  const s = String(account || '').trim();
  let type: 'phone' | 'qq' | '' = '';
  if (/^1\d{10}$/.test(s)) type = 'phone';
  else if (/^[1-9]\d{4,9}$/.test(s)) type = 'qq';
  if (type) {
    const matched = variants.find((v) => v.accountType === type);
    if (matched) return matched;
  }
  // 无法判断或无精确匹配：回退首个变体
  return variants[0];
}

/**
 * 创建订单
 *
 * 业务流程：
 * 1. 校验商品存在且已上架
 * 2. 校验套餐存在且已上架
 * 3. 锁定当前套餐价格（写入后不再随商品改价变更）
 * 4. 生成唯一订单号，创建订单记录（status=pending_pay）
 * 5. 记录 timeline 第一个节点（创建订单）
 * 6. 写入审计日志
 *
 * @param db - 云数据库实例
 * @param openid - 当前用户 openid
 * @param params - 创建订单入参
 */
export async function createOrder(
  db: any,
  openid: string,
  params: CreateOrderParams
): Promise<CloudFunctionResult<CreateOrderData>> {
  const { productId, packageId, attach } = params;

  // 入参校验
  if (!openid) {
    return { success: false, errCode: 'UNAUTHORIZED', errMsg: '无法获取用户身份' };
  }
  if (!productId || !packageId) {
    return { success: false, errCode: 'INVALID_PARAMS', errMsg: '缺少商品或套餐参数' };
  }

  // 1. 查询商品
  const productRes = await db
    .collection('products')
    .where({ productId })
    .limit(1)
    .get();
  const product: Product | undefined = productRes.data && productRes.data[0];

  if (!product) {
    return { success: false, errCode: 'PRODUCT_NOT_FOUND', errMsg: '商品不存在' };
  }
  // 校验商品已上架
  if (!product.online) {
    return { success: false, errCode: 'PRODUCT_OFFLINE', errMsg: '该商品已下架，暂不可购买' };
  }

  // 2. 查询套餐
  const pkg: Package | undefined = (product.packages || []).find(
    (p) => p.packageId === packageId
  );
  if (!pkg) {
    return { success: false, errCode: 'PACKAGE_NOT_FOUND', errMsg: '套餐不存在' };
  }
  // 校验套餐已上架
  if (!pkg.online) {
    return { success: false, errCode: 'PACKAGE_OFFLINE', errMsg: '该套餐已下架，请重新选择' };
  }
  if (typeof pkg.price !== 'number' || pkg.price <= 0) {
    return { success: false, errCode: 'PACKAGE_NOT_READY', errMsg: '该商品正在配置中，暂不可购买' };
  }

  // 3. 锁定当前价格：下单时套餐 price 即为用户实付金额，写入订单后不再变更
  const amount = pkg.price;

  // 3.1 账号形式路由：套餐同时支持手机号/QQ号时，按用户输入的账号格式选对应上游 SKU
  const account = extractAccountFromAttach(attach);
  const variant = pickAccountVariant(pkg.accountVariants, account);
  const shunshiGoodsId = variant ? variant.shunshiGoodsId : pkg.shunshiGoodsId;
  const costPrice = variant ? variant.costPrice : pkg.costPrice;

  const now = new Date();

  // 4. 生成唯一订单号
  const orderId = generateOrderId();

  // 5. 记录 timeline 第一个节点（创建订单）
  const firstTimelineNode: TimelineNode = {
    status: OrderStatus.PENDING_PAY,
    time: now,
    desc: '创建订单'
  };

  // 组装订单记录
  const order: Order = {
    orderId,
    openid,
    productId: product.productId,
    productName: product.name,
    packageId: pkg.packageId,
    packageName: pkg.name,
    categoryName: product.categoryName,
    attach: attach || {},
    amount,
    costPrice,
    status: OrderStatus.PENDING_PAY,
    shunshiGoodsId,
    retryCount: 0,
    timeline: [firstTimelineNode],
    createdAt: now,
    updatedAt: now
  };

  // 写入订单记录
  try {
    await db.collection('orders').add({ data: order });
  } catch (err: any) {
    return {
      success: false,
      errCode: 'ORDER_CREATE_FAILED',
      errMsg: '订单创建失败，请稍后重试'
    };
  }

  // 6. 写入审计日志（创建订单）
  const auditLog = createAuditLog({
    type: AuditType.ORDER_CREATE,
    operator: openid,
    orderId,
    productId: product.productId,
    action: '创建订单',
    detail: { productName: product.name, packageName: pkg.name, amount },
    result: 'success'
  });
  await writeAuditLog(db, auditLog);

  return { success: true, data: { orderId } };
}
