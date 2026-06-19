// 微信支付 API v3 客户端封装
// 仅依赖 Node 内置模块（crypto / https），不引入额外第三方依赖
// 所有敏感配置（商户号、私钥、证书序列号、API v3 密钥）仅从环境变量读取，禁止硬编码
import * as crypto from 'crypto';
import * as https from 'https';

/** 微信支付配置（全部来自云函数环境变量） */
export interface WechatPayConfig {
  /** 小程序 appid */
  appid: string;
  /** 商户号 */
  mchid: string;
  /** 商户 API 私钥（PEM 格式） */
  privateKey: string;
  /** 商户证书序列号 */
  serialNo: string;
  /** 支付结果回调地址 */
  notifyUrl: string;
}

/** JSAPI 统一下单入参 */
export interface UnifiedOrderRequest {
  /** 商品描述 */
  description: string;
  /** 商户订单号（即系统 orderId） */
  outTradeNo: string;
  /** 支付金额（单位：分） */
  totalFee: number;
  /** 支付用户 openid */
  openid: string;
}

/** 前端唤起支付所需参数（wx.requestPayment） */
export interface PayParams {
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: 'RSA';
  paySign: string;
}

/** 退款申请入参 */
export interface RefundRequest {
  /** 原商户订单号（系统 orderId） */
  outTradeNo: string;
  /** 商户退款单号 */
  outRefundNo: string;
  /** 退款金额（单位：分） */
  refundFee: number;
  /** 原订单总金额（单位：分） */
  totalFee: number;
  /** 退款原因（可选，超过 80 字符自动截断） */
  reason?: string;
  /** 退款结果回调地址（可选） */
  notifyUrl?: string;
}

/** 退款申请结果 */
export interface RefundResult {
  /** 微信退款单号 */
  refundId: string;
  /** 商户退款单号 */
  outRefundNo: string;
  /** 退款状态（SUCCESS/PROCESSING/ABNORMAL/CLOSED） */
  status: string;
}

/** 解密后的支付成功通知核心字段 */
export interface PayTransactionResult {
  /** 小程序 appid */
  appid: string;
  /** 商户号 */
  mchid: string;
  /** 商户订单号（系统 orderId） */
  out_trade_no: string;
  /** 微信支付交易号 */
  transaction_id: string;
  /** 交易状态（SUCCESS 表示支付成功） */
  trade_state: string;
  /** 交易状态描述 */
  trade_state_desc?: string;
  /** 支付完成时间 */
  success_time?: string;
  /** 支付者信息 */
  payer?: { openid: string };
  /** 金额信息（单位：分） */
  amount?: { total: number; payer_total?: number; currency?: string };
}

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
export function loadWechatPayConfig(): WechatPayConfig {
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
export class WechatPayClient {
  private readonly config: WechatPayConfig;

  constructor(config?: WechatPayConfig) {
    this.config = config || loadWechatPayConfig();
  }

  /** 生成随机串 */
  private nonceStr(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /** 当前秒级时间戳字符串 */
  private timestamp(): string {
    return Math.floor(Date.now() / 1000).toString();
  }

  /**
   * 使用商户私钥进行 RSA-SHA256 签名
   * @param message 待签名串
   * @returns base64 编码签名值
   */
  private rsaSign(message: string): string {
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(message);
    signer.end();
    return signer.sign(this.config.privateKey, 'base64');
  }

  /**
   * 构造请求 Authorization 头
   * 签名串格式：HTTP方法\nURL\n时间戳\n随机串\n请求报文主体\n
   */
  private buildAuthorization(
    method: string,
    urlPath: string,
    body: string,
    timestamp: string,
    nonce: string
  ): string {
    const message = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`;
    const signature = this.rsaSign(message);
    return (
      'WECHATPAY2-SHA256-RSA2048 ' +
      `mchid="${this.config.mchid}",` +
      `nonce_str="${nonce}",` +
      `signature="${signature}",` +
      `timestamp="${timestamp}",` +
      `serial_no="${this.config.serialNo}"`
    );
  }

  /**
   * 发送 HTTPS POST 请求至微信支付
   * @returns 解析后的响应体与 HTTP 状态码
   */
  private httpsPost(
    urlPath: string,
    body: string,
    authorization: string
  ): Promise<{ statusCode: number; data: any }> {
    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
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
          let parsed: any = {};
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch (e) {
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
  async unifiedOrder(req: UnifiedOrderRequest): Promise<PayParams> {
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
  private buildPayParams(prepayId: string): PayParams {
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
  async refund(req: RefundRequest): Promise<RefundResult> {
    // 1. 组装请求体（金额单位：分）
    const requestBody: Record<string, any> = {
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

/** 微信支付业务错误 */
export class WechatPayError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'WechatPayError';
  }
}

/** 回调相关配置（用于报文解密与签名验证），独立于下单/退款配置 */
export interface WechatPayCallbackConfig {
  /** API v3 密钥（32 字节），用于 AES-256-GCM 解密回调报文 */
  apiV3Key: string;
  /** 微信支付平台证书公钥（PEM 格式），用于验证回调签名；未配置时跳过验签 */
  platformPublicKey?: string;
}

/** 微信回调加密资源体（notify 报文中的 resource 字段） */
export interface EncryptedResource {
  /** 加密算法，固定为 AEAD_AES_256_GCM */
  algorithm: string;
  /** Base64 编码的密文（尾部 16 字节为 GCM 认证标签） */
  ciphertext: string;
  /** 附加数据（参与 GCM 校验，可为空） */
  associated_data?: string;
  /** 加密随机串 */
  nonce: string;
  /** 原始类型（如 transaction / refund） */
  original_type?: string;
}

/** 回调签名验证入参 */
export interface NotifySignatureParams {
  /** 应答时间戳（请求头 Wechatpay-Timestamp） */
  timestamp: string;
  /** 应答随机串（请求头 Wechatpay-Nonce） */
  nonce: string;
  /** 原始回调报文主体 */
  body: string;
  /** 应答签名（请求头 Wechatpay-Signature，base64） */
  signature: string;
}

/** GCM 认证标签长度（字节） */
const GCM_AUTH_TAG_LENGTH = 16;
/** API v3 密钥长度（字节） */
const APIV3_KEY_LENGTH = 32;

/**
 * 从环境变量读取回调相关配置（API v3 密钥与平台证书公钥）
 * apiV3Key 缺失时抛出错误（解密回调报文必需）；platformPublicKey 可选
 */
export function loadWechatPayCallbackConfig(): WechatPayCallbackConfig {
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
export function decryptResource(resource: EncryptedResource, apiV3Key: string): string {
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
  } catch (err) {
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
export function verifyNotifySignature(
  params: NotifySignatureParams,
  publicKeyPem: string
): boolean {
  const message = `${params.timestamp}\n${params.nonce}\n${params.body}\n`;
  try {
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(message);
    verifier.end();
    return verifier.verify(publicKeyPem, params.signature, 'base64');
  } catch {
    // 公钥格式错误或签名非法时视为验签失败
    return false;
  }
}

