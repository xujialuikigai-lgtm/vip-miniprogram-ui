"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.unifiedOrder = unifiedOrder;
// 统一下单业务逻辑
const order_1 = require("./shared/types/order");
const wechatpay_1 = require("./wechatpay");
const constants_1 = require("./shared/constants");
/**
 * 统一下单
 *
 * 业务流程：
 * 1. 校验订单存在且属于当前用户
 * 2. 校验订单状态为待支付
 * 3. 重新校验价格一致性：订单锁定金额需与当前套餐售价一致，
 *    价格已变更时返回错误码，前端关闭弹窗并提示重新选择套餐（Req 3.2/3.3）
 * 4. 调用微信支付 API v3 统一下单生成 prepay_id（Req 3.4）
 * 5. 返回前端唤起支付所需的 payParams
 *
 * @param db 云数据库实例
 * @param openid 当前用户 openid
 * @param params 统一下单入参
 * @param payClient 微信支付客户端（可注入，便于测试；默认从环境变量构建）
 */
async function unifiedOrder(db, openid, params, payClient) {
    const { orderId } = params;
    // 入参与身份校验
    if (!openid) {
        return { success: false, errCode: 'UNAUTHORIZED', errMsg: '无法获取用户身份' };
    }
    if (!orderId) {
        return { success: false, errCode: 'INVALID_PARAMS', errMsg: '缺少订单参数' };
    }
    // 1. 查询订单
    const orderRes = await db.collection('orders').where({ orderId }).limit(1).get();
    const order = orderRes.data && orderRes.data[0];
    if (!order) {
        return { success: false, errCode: 'ORDER_NOT_FOUND', errMsg: '订单不存在' };
    }
    // 校验订单归属，防止越权支付他人订单
    if (order.openid !== openid) {
        return { success: false, errCode: 'FORBIDDEN', errMsg: '无权操作该订单' };
    }
    // 2. 校验订单状态为待支付
    if (order.status !== order_1.OrderStatus.PENDING_PAY) {
        return { success: false, errCode: 'ORDER_STATUS_INVALID', errMsg: '订单状态异常，无法支付' };
    }
    if (typeof order.amount !== 'number' || order.amount <= 0) {
        return { success: false, errCode: 'INVALID_AMOUNT', errMsg: '订单金额异常，无法支付' };
    }
    // 3. 重新校验价格一致性（弹窗校验）
    const productRes = await db
        .collection('products')
        .where({ productId: order.productId })
        .limit(1)
        .get();
    const product = productRes.data && productRes.data[0];
    if (!product) {
        return { success: false, errCode: 'PRODUCT_NOT_FOUND', errMsg: '商品不存在' };
    }
    const pkg = (product.packages || []).find((p) => p.packageId === order.packageId);
    if (!pkg) {
        return { success: false, errCode: 'PACKAGE_NOT_FOUND', errMsg: '套餐不存在' };
    }
    // 当前套餐售价与订单锁定金额不一致，说明套餐已改价，需重新选择
    if (pkg.price !== order.amount) {
        return {
            success: false,
            errCode: 'PRICE_CHANGED',
            errMsg: '套餐价格已变更，请重新选择套餐'
        };
    }
    if (typeof pkg.price !== 'number' || pkg.price <= 0) {
        return { success: false, errCode: 'PACKAGE_NOT_READY', errMsg: '该商品正在配置中，暂不可购买' };
    }
    // 4. 调用微信支付统一下单
    // ====== Mock 模式：跳过真实微信支付，直接模拟支付成功+开通成功 ======
    if ((0, constants_1.isMockMode)()) {
        const _ = db.command;
        const now = new Date();
        // 模拟支付成功：pending_pay → paid → activating → success（一步到位）
        const mockTimeline = [
            { status: order_1.OrderStatus.PAID, time: now, desc: '[Mock] 模拟支付成功' },
            { status: order_1.OrderStatus.ACTIVATING, time: now, desc: '[Mock] 模拟提交开通' },
            { status: order_1.OrderStatus.SUCCESS, time: now, desc: '[Mock] 模拟开通成功' }
        ];
        await db.collection('orders').where({ orderId }).update({
            data: {
                status: order_1.OrderStatus.SUCCESS,
                payTransactionId: 'MOCK_TRANS_' + Date.now(),
                shunshiOrderSn: 'MOCK_SS_' + Date.now(),
                paidAt: now,
                activatedAt: now,
                updatedAt: now,
                timeline: _.push(mockTimeline)
            }
        });
        // 返回假 payParams，前端收到后识别 mock 标记跳过 wx.requestPayment
        const mockPayParams = {
            timeStamp: String(Math.floor(Date.now() / 1000)),
            nonceStr: 'mock_nonce_' + Date.now(),
            package: 'prepay_id=MOCK_PREPAY_ID',
            signType: 'RSA',
            paySign: 'MOCK_PAY_SIGN'
        };
        return { success: true, data: { payParams: mockPayParams, mock: true } };
    }
    const client = payClient || new wechatpay_1.WechatPayClient();
    let payParams;
    try {
        // order.amount 单位为「元」，微信支付 API v3 的 amount.total 要求「分」（整数）
        // 用 Math.round 做元→分转换，规避浮点误差，确保传给微信的是整数分
        const totalFeeInCents = Math.round(order.amount * 100);
        payParams = await client.unifiedOrder({
            description: order.productName,
            outTradeNo: order.orderId,
            totalFee: totalFeeInCents, // 单位：分
            openid
        });
    }
    catch (err) {
        const errCode = err instanceof wechatpay_1.WechatPayError ? `WXPAY_${err.code}` : 'WXPAY_FAILED';
        return {
            success: false,
            errCode,
            errMsg: '支付发起失败，请重试'
        };
    }
    // 5. 返回前端唤起支付参数
    return { success: true, data: { payParams } };
}
