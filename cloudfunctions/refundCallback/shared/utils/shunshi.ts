// 顺势 API 客户端封装
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { generateSign } from './sign';
import { SHUNSHI_API_TIMEOUT, SHUNSHI_BASE_URL } from '../constants';
import {
  ShunshiResponse,
  ShunshiCategoryNode,
  ShunshiProductListResponse,
  ShunshiProductDetail,
  ShunshiOrderResponse,
  ShunshiOrderInfoItem,
} from '../types/api';

/** 下单参数（对应 /api/v1/order/buy） */
export interface SubmitOrderParams {
  /** 商品 ID（注意参数名是 id，不是 goods_id） */
  id: number;
  /** 购买数量 */
  quantity: number;
  /** 外部订单号（商户侧，唯一） */
  external_orderno: string;
  /** 安全价（不低于售价，单位元，发送时转字符串） */
  safe_price: number;
  /** 附加模板字段（充值账号放入 attach.recharge_account 等） */
  attach?: Record<string, string>;
  /** 异步回调地址 */
  url?: string;
  /** 备注 */
  mark?: string;
}

/** 查询订单参数（对应 /api/v1/order/info） */
export interface QueryOrderParams {
  /** 顺势订单号（多个逗号隔开） */
  ordersn?: string;
  /** 外部订单号 */
  external_orderno?: string;
  /** 查询天数（默认30，传0全部） */
  day?: string;
}

/** 商品列表请求参数（对应 /api/v1/goods/list） */
export interface ProductListParams {
  /** 分类 ID（默认0全部） */
  cate_id?: number;
  /** 页码，从1开始 */
  page?: number;
  /** 每页条数（注意是 limit，不是 page_size） */
  limit?: number;
  /** 关键词搜索 */
  keyword?: string;
}

/**
 * 顺势权益 API 客户端
 * 封装签名、请求、超时控制和错误处理
 */
export class ShunshiClient {
  private baseUrl: string;
  private userId: string;
  private apikey: string;

  constructor() {
    this.baseUrl = SHUNSHI_BASE_URL;
    this.userId = process.env.SHUNSHI_USER_ID || '';
    this.apikey = process.env.SHUNSHI_API_KEY || '';

    if (!this.userId || !this.apikey) {
      console.warn('[ShunshiClient] 环境变量 SHUNSHI_USER_ID 或 SHUNSHI_API_KEY 未设置');
    }
  }

  /**
   * 发起 HTTP POST 请求
   * 自动生成签名，设置 Header，处理超时和错误
   * @param path - API 路径，如 /api/v1/goods/cate
   * @param body - 请求体对象
   * @returns 解析后的响应数据
   */
  async request<T = any>(path: string, body: Record<string, any> = {}): Promise<T> {
    const timestamp = Date.now().toString();
    const sign = generateSign(timestamp, body, this.apikey);

    const postData = JSON.stringify(body);
    const url = new URL(path, this.baseUrl);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Sign': sign,
      'Timestamp': timestamp,
      'UserId': this.userId,
    };

    return new Promise<T>((resolve, reject) => {
      const protocol = url.protocol === 'https:' ? https : http;

      const req = protocol.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname + url.search,
          method: 'POST',
          headers: {
            ...headers,
            'Content-Length': Buffer.byteLength(postData),
          },
          timeout: SHUNSHI_API_TIMEOUT,
        },
        (res) => {
          let data = '';

          res.on('data', (chunk: string) => {
            data += chunk;
          });

          res.on('end', () => {
            // HTTP 状态码非 200 时抛出错误
            if (res.statusCode !== 200) {
              reject(
                new Error(
                  `[ShunshiClient] HTTP 请求失败: status=${res.statusCode}, path=${path}, body=${data}`
                )
              );
              return;
            }

            try {
              const result: ShunshiResponse<T> = JSON.parse(data);

              // 业务状态码非 200 时抛出错误
              if (result.code !== 200) {
                reject(
                  new Error(
                    `[ShunshiClient] API 业务错误: code=${result.code}, msg=${result.msg}, path=${path}`
                  )
                );
                return;
              }

              resolve(result.data as T);
            } catch (e) {
              reject(
                new Error(
                  `[ShunshiClient] 响应解析失败: path=${path}, body=${data}`
                )
              );
            }
          });
        }
      );

      // 超时处理
      req.on('timeout', () => {
        req.destroy();
        reject(
          new Error(
            `[ShunshiClient] 请求超时(${SHUNSHI_API_TIMEOUT}ms): path=${path}`
          )
        );
      });

      // 网络错误处理
      req.on('error', (err) => {
        reject(
          new Error(
            `[ShunshiClient] 网络请求错误: path=${path}, error=${err.message}`
          )
        );
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * 获取商品分类列表
   * 调用 /api/v1/goods/cate，接口 data 直接是分类节点数组
   */
  async getCategories(): Promise<ShunshiCategoryNode[]> {
    return this.request<ShunshiCategoryNode[]>('/api/v1/goods/cate');
  }

  /**
   * 获取商品列表（支持分页和筛选）
   * 调用 /api/v1/goods/list
   * @param params - 查询参数（分类、页码、每页条数 limit、关键词）
   */
  async getProductList(params: ProductListParams = {}): Promise<ShunshiProductListResponse> {
    const body: Record<string, any> = {};
    if (params.cate_id !== undefined) body.cate_id = params.cate_id;
    if (params.page !== undefined) body.page = params.page;
    if (params.limit !== undefined) body.limit = params.limit;
    if (params.keyword !== undefined) body.keyword = params.keyword;

    return this.request<ShunshiProductListResponse>('/api/v1/goods/list', body);
  }

  /**
   * 获取商品详情（含下单模板 attach）
   * 调用 /api/v1/goods/info
   * @param id - 商品 ID
   */
  async getProductDetail(id: number): Promise<ShunshiProductDetail> {
    return this.request<ShunshiProductDetail>('/api/v1/goods/info', { id });
  }

  /**
   * 提交订单（下单）
   * 调用 /api/v1/order/buy
   * @param params - 下单参数（id=商品ID，external_orderno=商户订单号，safe_price 单位元）
   */
  async submitOrder(params: SubmitOrderParams): Promise<ShunshiOrderResponse> {
    const body: Record<string, any> = {
      id: params.id,
      quantity: params.quantity,
      external_orderno: params.external_orderno,
      // 文档要求 safe_price 为字符串（单位元，不做元分换算）
      safe_price: String(params.safe_price),
    };

    if (params.attach) {
      body.attach = params.attach;
    }
    if (params.url) {
      body.url = params.url;
    }
    if (params.mark) {
      body.mark = params.mark;
    }

    return this.request<ShunshiOrderResponse>('/api/v1/order/buy', body);
  }

  /**
   * 查询订单信息
   * 调用 /api/v1/order/info（接口返回 data 为数组）
   * 为兼容现有按单对象使用的调用方，这里取 data[0] 返回单个订单项；
   * 数组为空时返回 status=0 的安全默认对象（0 不在任何映射分支，调用方视为"处理中/未知"不流转终态）。
   * @param params - 查询参数（顺势订单号或外部订单号，至少传一个）
   */
  async queryOrder(params: QueryOrderParams): Promise<ShunshiOrderInfoItem> {
    const body: Record<string, any> = {};
    if (params.ordersn) body.ordersn = params.ordersn;
    if (params.external_orderno) body.external_orderno = params.external_orderno;
    if (params.day !== undefined) body.day = params.day;

    const list = await this.request<ShunshiOrderInfoItem[]>('/api/v1/order/info', body);
    if (Array.isArray(list) && list.length > 0) {
      return list[0];
    }
    // 查询无结果：返回安全默认对象，status=0 表示未知（不触发终态流转）
    return {
      ordersn: params.ordersn || '',
      external_orderno: params.external_orderno || '',
      status: 0,
    };
  }
}

/** 默认客户端实例（单例） */
let defaultClient: ShunshiClient | null = null;

/**
 * 获取默认 ShunshiClient 实例（单例模式）
 * 适用于云函数中复用连接
 */
export function getShunshiClient(): ShunshiClient {
  if (!defaultClient) {
    defaultClient = new ShunshiClient();
  }
  return defaultClient;
}
