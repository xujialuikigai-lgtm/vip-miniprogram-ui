"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrderDetail = getOrderDetail;
const mask_1 = require("./shared/utils/mask");
/**
 * 查询单个订单完整信息
 *
 * 业务规则（需求 7.8、20）：
 * 1. 按 orderId 查询，且必须属于当前用户（防止越权查看他人订单）
 * 2. 返回完整订单信息、时间轴（按时间正序）和失败原因
 * 3. attach 中的手机号/账号脱敏后返回（需求 15.4）
 *
 * @param db - 云数据库实例
 * @param openid - 当前用户 openid
 * @param params - 详情查询入参
 */
async function getOrderDetail(db, openid, params) {
    if (!openid) {
        return { success: false, errCode: 'UNAUTHORIZED', errMsg: '无法获取用户身份' };
    }
    if (!params.orderId) {
        return { success: false, errCode: 'INVALID_PARAMS', errMsg: '缺少订单号参数' };
    }
    // 按订单号 + openid 查询，确保只能查看自己的订单
    const res = await db
        .collection('orders')
        .where({ orderId: params.orderId, openid })
        .limit(1)
        .get();
    const order = res.data && res.data[0];
    if (!order) {
        return { success: false, errCode: 'ORDER_NOT_FOUND', errMsg: '订单不存在' };
    }
    // 时间轴按时间正序排列（需求 20.3）
    const timeline = [...(order.timeline || [])].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    // 脱敏后的订单信息
    const maskedOrder = Object.assign(Object.assign({}, order), { attach: (0, mask_1.maskAttach)(order.attach), timeline });
    return {
        success: true,
        data: {
            order: maskedOrder,
            timeline,
            failReason: order.failReason
        }
    };
}
