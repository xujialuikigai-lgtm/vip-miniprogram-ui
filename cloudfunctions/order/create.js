"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOrder = createOrder;
// 订单创建逻辑
const order_1 = require("./shared/types/order");
const audit_1 = require("./shared/types/audit");
const logger_1 = require("./shared/utils/logger");
const constants_1 = require("./shared/constants");
/**
 * 生成唯一订单号
 * 格式：VIP + 13位毫秒时间戳 + 4位随机数字
 * 例如：VIP17041234567890123
 */
function generateOrderId() {
    const timestamp = Date.now().toString();
    // 生成 4 位随机数字（0000-9999），不足补零
    const random = Math.floor(Math.random() * 10000)
        .toString()
        .padStart(4, '0');
    return `${constants_1.ORDER_ID_PREFIX}${timestamp}${random}`;
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
async function createOrder(db, openid, params) {
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
    const product = productRes.data && productRes.data[0];
    if (!product) {
        return { success: false, errCode: 'PRODUCT_NOT_FOUND', errMsg: '商品不存在' };
    }
    // 校验商品已上架
    if (!product.online) {
        return { success: false, errCode: 'PRODUCT_OFFLINE', errMsg: '该商品已下架，暂不可购买' };
    }
    // 2. 查询套餐
    const pkg = (product.packages || []).find((p) => p.packageId === packageId);
    if (!pkg) {
        return { success: false, errCode: 'PACKAGE_NOT_FOUND', errMsg: '套餐不存在' };
    }
    // 校验套餐已上架
    if (!pkg.online) {
        return { success: false, errCode: 'PACKAGE_OFFLINE', errMsg: '该套餐已下架，请重新选择' };
    }
    // 3. 锁定当前价格：下单时套餐 price 即为用户实付金额，写入订单后不再变更
    const amount = pkg.price;
    const costPrice = pkg.costPrice;
    const now = new Date();
    // 4. 生成唯一订单号
    const orderId = generateOrderId();
    // 5. 记录 timeline 第一个节点（创建订单）
    const firstTimelineNode = {
        status: order_1.OrderStatus.PENDING_PAY,
        time: now,
        desc: '创建订单'
    };
    // 组装订单记录
    const order = {
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
        status: order_1.OrderStatus.PENDING_PAY,
        shunshiGoodsId: pkg.shunshiGoodsId,
        retryCount: 0,
        timeline: [firstTimelineNode],
        createdAt: now,
        updatedAt: now
    };
    // 写入订单记录
    try {
        await db.collection('orders').add({ data: order });
    }
    catch (err) {
        return {
            success: false,
            errCode: 'ORDER_CREATE_FAILED',
            errMsg: '订单创建失败，请稍后重试'
        };
    }
    // 6. 写入审计日志（创建订单）
    const auditLog = (0, logger_1.createAuditLog)({
        type: audit_1.AuditType.ORDER_CREATE,
        operator: openid,
        orderId,
        productId: product.productId,
        action: '创建订单',
        detail: { productName: product.name, packageName: pkg.name, amount },
        result: 'success'
    });
    await (0, logger_1.writeAuditLog)(db, auditLog);
    return { success: true, data: { orderId } };
}
