"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.WechatPayError = exports.WechatPayClient = void 0;
exports.loadWechatPayConfig = loadWechatPayConfig;
exports.loadWechatPayCallbackConfig = loadWechatPayCallbackConfig;
exports.decryptResource = decryptResource;
exports.verifyNotifySignature = verifyNotifySignature;
// 微信支付 API v3 客户端封装
// 仅依赖 Node 内置模块（crypto / https），不引入额外第三方依赖
// 所有敏感配置（商户号、私钥、证书序列号、API v3 密钥）仅从环境变量读取，禁止硬编码
const crypto = __importStar(require("crypto"));
const https = __importStar(require("https"));
/** 微信支付主机 */
const WXPAY_HOST = 'api.mch.weixin.qq.com';
/** JSAPI 统一下单路径 */
const JSAPI_PATH = '/v3/pay/transactions/jsapi';
/** 退款申请路径 */
const REFUND_PATH = '/v3/refund/domestic/refunds';
/** 微信退款原因最大长度 */
const REFUND_REASON_MAX_LENGTH = 80;
/**
 * 从环境变量读取微信支付配置
 * 缺少任一必填项时抛出错误，避免使用空配置发起请求
 */
function loadWechatPayConfig() {
    const appid = process.env.WXPAY_APPID;
    const mchid = process.env.WXPAY_MCHID;
    // 私钥支持以 \n 转义形式存储在环境变量中，读取后还原换行
    const privateKeyRaw = process.env.WXPAY_PRIVATE_KEY;
    const serialNo = process.env.WXPAY_SERIAL_NO;
    const notifyUrl = process.env.WXPAY_NOTIFY_URL;
    if (!appid || !mchid || !privateKeyRaw || !serialNo || !notifyUrl) {
        throw new Error('微信支付配置缺失，请检查云函数环境变量');
    }
    return {
        appid,
        mchid,
        privateKey: privateKeyRaw.replace(/\\n/g, '\n'),
        serialNo,
        notifyUrl
    };
}
/** 微信支付 v3 客户端 */
class WechatPayClient {
    constructor(config) {
        this.config = config || loadWechatPayConfig();
    }
    /** 生成随机串 */
    nonceStr() {
        return crypto.randomBytes(16).toString('hex');
    }
    /** 当前秒级时间戳字符串 */
    timestamp() {
        return Math.floor(Date.now() / 1000).toString();
    }
    /**
     * 使用商户私钥进行 RSA-SHA256 签名
     * @param message 待签名串
     * @returns base64 编码签名值
     */
    rsaSign(message) {
        const signer = crypto.createSign('RSA-SHA256');
        signer.update(message);
        signer.end();
        return signer.sign(this.config.privateKey, 'base64');
    }
    /**
     * 构造请求 Authorization 头
     * 签名串格式：HTTP方法\nURL\n时间戳\n随机串\n请求报文主体\n
     */
    buildAuthorization(method, urlPath, body, timestamp, nonce) {
        const message = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`;
        const signature = this.rsaSign(message);
        return ('WECHATPAY2-SHA256-RSA2048 ' +
            `mchid="${this.config.mchid}",` +
            `nonce_str="${nonce}",` +
            `signature="${signature}",` +
            `timestamp="${timestamp}",` +
            `serial_no="${this.config.serialNo}"`);
    }
    /**
     * 发送 HTTPS POST 请求至微信支付
     * @returns 解析后的响应体与 HTTP 状态码
     */
    httpsPost(urlPath, body, authorization) {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: WXPAY_HOST,
                port: 443,
                path: urlPath,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    // 微信支付要求携带 User-Agent
                    'User-Agent': 'vip-miniprogram-payment/1.0',
                    Authorization: authorization
                }
            };
            const req = https.request(options, (res) => {
                let raw = '';
                res.on('data', (chunk) => {
                    raw += chunk;
                });
                res.on('end', () => {
                    let parsed = {};
                    try {
                        parsed = raw ? JSON.parse(raw) : {};
                    }
                    catch (e) {
                        parsed = { raw };
                    }
                    resolve({ statusCode: res.statusCode || 0, data: parsed });
                });
            });
            req.on('error', (err) => reject(err));
            req.write(body);
            req.end();
        });
    }
    /**
     * JSAPI 统一下单，获取 prepay_id 并生成前端唤起支付参数
     * @param req 下单入参
     * @returns 前端 wx.requestPayment 所需的 payParams
     */
    async unifiedOrder(req) {
        // 1. 组装请求体
        const requestBody = {
            appid: this.config.appid,
            mchid: this.config.mchid,
            description: req.description,
            out_trade_no: req.outTradeNo,
            notify_url: this.config.notifyUrl,
            amount: {
                total: req.totalFee,
                currency: 'CNY'
            },
            payer: {
                openid: req.openid
            }
        };
        const bodyStr = JSON.stringify(requestBody);
        // 2. 生成 Authorization 头并发起请求
        const ts = this.timestamp();
        const nonce = this.nonceStr();
        const authorization = this.buildAuthorization('POST', JSAPI_PATH, bodyStr, ts, nonce);
        const { statusCode, data } = await this.httpsPost(JSAPI_PATH, bodyStr, authorization);
        // 3. 校验响应，提取 prepay_id
        if (statusCode !== 200 || !data || !data.prepay_id) {
            const code = (data && data.code) || `HTTP_${statusCode}`;
            const message = (data && data.message) || '微信支付统一下单失败';
            throw new WechatPayError(code, message);
        }
        // 4. 生成前端唤起支付参数并对其签名
        return this.buildPayParams(data.prepay_id);
    }
    /**
     * 生成前端唤起支付参数（含 RSA 签名）
     * 签名串格式：appId\n时间戳\n随机串\npackage\n
     */
    buildPayParams(prepayId) {
        const timeStamp = this.timestamp();
        const nonceStr = this.nonceStr();
        const packageStr = `prepay_id=${prepayId}`;
        const message = `${this.config.appid}\n${timeStamp}\n${nonceStr}\n${packageStr}\n`;
        const paySign = this.rsaSign(message);
        return {
            timeStamp,
            nonceStr,
            package: packageStr,
            signType: 'RSA',
            paySign
        };
    }
    /**
     * 申请退款（微信支付 API v3 /v3/refund/domestic/refunds）
     * 按原支付路径退回指定金额，退款受理成功（HTTP 200 且含 refund_id）即返回结果
     * @param req 退款入参
     * @returns 退款受理结果
     */
    async refund(req) {
        // 1. 组装请求体（金额单位：分）
        const requestBody = {
            out_trade_no: req.outTradeNo,
            out_refund_no: req.outRefundNo,
            amount: {
                refund: req.refundFee,
                total: req.totalFee,
                currency: 'CNY'
            }
        };
        if (req.reason) {
            // 微信退款原因长度限制 80 字符
            requestBody.reason = req.reason.slice(0, REFUND_REASON_MAX_LENGTH);
        }
        if (req.notifyUrl) {
            requestBody.notify_url = req.notifyUrl;
        }
        const bodyStr = JSON.stringify(requestBody);
        // 2. 生成 Authorization 头并发起请求
        const ts = this.timestamp();
        const nonce = this.nonceStr();
        const authorization = this.buildAuthorization('POST', REFUND_PATH, bodyStr, ts, nonce);
        const { statusCode, data } = await this.httpsPost(REFUND_PATH, bodyStr, authorization);
        // 3. 校验响应，退款受理成功返回 refund_id
        if (statusCode !== 200 || !data || !data.refund_id) {
            const code = (data && data.code) || `HTTP_${statusCode}`;
            const message = (data && data.message) || '微信支付退款失败';
            throw new WechatPayError(code, message);
        }
        return {
            refundId: data.refund_id,
            outRefundNo: data.out_refund_no,
            status: data.status
        };
    }
}
exports.WechatPayClient = WechatPayClient;
/** 微信支付业务错误 */
class WechatPayError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'WechatPayError';
    }
}
exports.WechatPayError = WechatPayError;
/** GCM 认证标签长度（字节） */
const GCM_AUTH_TAG_LENGTH = 16;
/** API v3 密钥长度（字节） */
const APIV3_KEY_LENGTH = 32;
/**
 * 从环境变量读取回调相关配置（API v3 密钥与平台证书公钥）
 * apiV3Key 缺失时抛出错误（解密回调报文必需）；platformPublicKey 可选
 */
function loadWechatPayCallbackConfig() {
    const apiV3Key = process.env.WXPAY_APIV3_KEY || process.env.WXPAY_API_V3_KEY;
    // 平台证书公钥支持以 \n 转义形式存储，读取后还原换行
    const platformPublicKeyRaw = process.env.WXPAY_PLATFORM_PUBLIC_KEY;
    if (!apiV3Key) {
        throw new Error('微信支付回调配置缺失：WXPAY_APIV3_KEY 未设置');
    }
    return {
        apiV3Key,
        platformPublicKey: platformPublicKeyRaw
            ? platformPublicKeyRaw.replace(/\\n/g, '\n')
            : undefined
    };
}
/**
 * 解密微信支付回调报文（算法 AEAD_AES_256_GCM）
 * 密文为 Base64 编码，尾部 16 字节为 GCM 认证标签；解密失败说明报文被篡改或密钥错误。
 *
 * @param resource 回调报文中的 resource 加密对象
 * @param apiV3Key API v3 密钥（32 字节）
 * @returns 解密后的明文 JSON 字符串
 */
function decryptResource(resource, apiV3Key) {
    const key = Buffer.from(apiV3Key, 'utf8');
    if (key.length !== APIV3_KEY_LENGTH) {
        throw new WechatPayError('INVALID_APIV3_KEY', 'API v3 密钥长度必须为 32 字节');
    }
    if (resource.algorithm && resource.algorithm !== 'AEAD_AES_256_GCM') {
        throw new WechatPayError('UNSUPPORTED_ALGORITHM', `不支持的回调加密算法：${resource.algorithm}`);
    }
    // 拆分密文与认证标签（尾部 16 字节为认证标签）
    const cipherBuffer = Buffer.from(resource.ciphertext, 'base64');
    if (cipherBuffer.length <= GCM_AUTH_TAG_LENGTH) {
        throw new WechatPayError('INVALID_CIPHERTEXT', '回调密文长度异常');
    }
    const authTag = cipherBuffer.subarray(cipherBuffer.length - GCM_AUTH_TAG_LENGTH);
    const data = cipherBuffer.subarray(0, cipherBuffer.length - GCM_AUTH_TAG_LENGTH);
    try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(resource.nonce, 'utf8'));
        decipher.setAuthTag(authTag);
        if (resource.associated_data) {
            decipher.setAAD(Buffer.from(resource.associated_data, 'utf8'));
        }
        return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new WechatPayError('DECRYPT_FAILED', `回调报文解密失败：${message}`);
    }
}
/**
 * 验证微信支付回调签名（RSA-SHA256）
 * 验签串格式：应答时间戳\n应答随机串\n应答报文主体\n
 * @param params 验签所需的时间戳、随机串、报文主体与签名
 * @param publicKeyPem 微信支付平台证书公钥（PEM 格式）
 * @returns 验签通过返回 true，否则返回 false
 */
function verifyNotifySignature(params, publicKeyPem) {
    const message = `${params.timestamp}\n${params.nonce}\n${params.body}\n`;
    try {
        const verifier = crypto.createVerify('RSA-SHA256');
        verifier.update(message);
        verifier.end();
        return verifier.verify(publicKeyPem, params.signature, 'base64');
    }
    catch (_a) {
        // 公钥格式错误或签名非法时视为验签失败
        return false;
    }
}
