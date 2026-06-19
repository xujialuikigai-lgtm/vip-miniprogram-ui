"use strict";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sortObjectKeys = sortObjectKeys;
exports.generateSign = generateSign;
exports.verifyCallbackSign = verifyCallbackSign;
// 签名工具函数
const crypto_js_1 = __importDefault(require("crypto-js"));
/**
 * 递归按 ASCII 码升序排列对象的 key
 * 嵌套对象和数组中的对象都会递归处理
 */
function sortObjectKeys(obj) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    // 数组：对每个元素递归处理
    if (Array.isArray(obj)) {
        return obj.map((item) => item !== null && typeof item === 'object' ? sortObjectKeys(item) : item);
    }
    // 对象：按 key 的 ASCII 码升序排列
    const sortedKeys = Object.keys(obj).sort();
    const sorted = {};
    for (const key of sortedKeys) {
        const value = obj[key];
        if (value !== null && typeof value === 'object') {
            sorted[key] = sortObjectKeys(value);
        }
        else {
            sorted[key] = value;
        }
    }
    return sorted;
}
/**
 * 生成签名
 * 计算方式: sha1(timestamp + JSON.stringify(按key字典序排列的body) + apikey)
 * @param timestamp - 13位时间戳字符串
 * @param body - 请求体对象
 * @param apikey - API 密钥
 * @returns 40位小写十六进制 SHA1 哈希值
 */
function generateSign(timestamp, body, apikey) {
    const sortedBody = sortObjectKeys(body);
    const jsonStr = JSON.stringify(sortedBody);
    const raw = timestamp + jsonStr + apikey;
    return crypto_js_1.default.SHA1(raw).toString(crypto_js_1.default.enc.Hex);
}
/**
 * 验证回调签名
 * 移除 sign、card_list、express_list 字段，用 time 字段作为时间戳计算期望签名并比对
 * @param params - 回调参数对象（包含 sign、time 等字段）
 * @param apikey - API 密钥
 * @returns 签名是否验证通过
 */
function verifyCallbackSign(params, apikey) {
    const { sign, card_list, express_list, time } = params, rest = __rest(params, ["sign", "card_list", "express_list", "time"]);
    // 缺少 sign 或 time 字段时验证失败
    if (!sign || !time) {
        return false;
    }
    const sorted = sortObjectKeys(rest);
    const jsonStr = JSON.stringify(sorted);
    const expected = crypto_js_1.default.SHA1(time + jsonStr + apikey).toString(crypto_js_1.default.enc.Hex);
    return expected === sign;
}
