// 订单列表查询逻辑（用户端）
import { Order, OrderStatus } from './shared/types/order';
import { CloudFunctionResult } from './shared/types/api';
import { maskAttach } from './shared/utils/mask';
import { DEFAULT_PAGE_SIZE } from './shared/constants';

/** 订单列表入参 */
export interface ListOrderParams {
  /** 状态筛选 Tab：all/activating/success/refund，缺省为 all */
  status?: string;
  /** 页码，从 1 开始 */
  page?: number;
  /** 每页条数，默认 20 */
  pageSize?: number;
}

/** 订单列表返回数据 */
export interface ListOrderData {
  list: Order[];
  total: number;
}

/**
 * 状态 Tab → 实际订单状态集合的映射
 * 对应需求 7.1 的筛选 Tab：全部/开通中/开通成功/退款
 * - all：全部（不含已取消）
 * - activating（开通中）：已支付 + 开通中
 * - success（开通成功）
 * - refund（退款）：退款中 + 已退款
 */
function resolveStatusFilter(status?: string): OrderStatus[] | null {
  switch (status) {
    case 'activating':
      return [OrderStatus.PAID, OrderStatus.ACTIVATING];
    case 'success':
      return [OrderStatus.SUCCESS];
    case 'refund':
      return [OrderStatus.REFUNDING, OrderStatus.REFUNDED];
    case 'all':
    case undefined:
    case '':
      // null 表示不限定具体状态，仅排除已取消
      return null;
    default:
      return null;
  }
}

/**
 * 查询用户订单列表
 *
 * 业务规则（需求 7.1、23.4）：
 * 1. 仅查询当前用户（openid）的订单
 * 2. 支持按状态 Tab 筛选
 * 3. 始终排除已取消（cancelled）订单 —— 已取消订单仅管理端可见
 * 4. 按下单时间（createdAt）倒序排列
 * 5. 分页，每页默认 20 条
 * 6. 返回前对 attach 中的手机号/账号脱敏（需求 15.4）
 *
 * @param db - 云数据库实例
 * @param openid - 当前用户 openid
 * @param params - 列表查询入参
 */
export async function listOrders(
  db: any,
  openid: string,
  params: ListOrderParams
): Promise<CloudFunctionResult<ListOrderData>> {
  if (!openid) {
    return { success: false, errCode: 'UNAUTHORIZED', errMsg: '无法获取用户身份' };
  }

  const _ = db.command;

  // 解析分页参数（页码至少为 1，每页条数限制在 1~DEFAULT_PAGE_SIZE）
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = Math.min(Math.max(1, Number(params.pageSize) || DEFAULT_PAGE_SIZE), DEFAULT_PAGE_SIZE);
  const skip = (page - 1) * pageSize;

  // 构造查询条件：openid 匹配 + 排除已取消
  const statusFilter = resolveStatusFilter(params.status);
  const where: Record<string, any> = {
    openid,
    // 始终排除已取消订单（需求 23.4）
    status: _.neq(OrderStatus.CANCELLED)
  };
  if (statusFilter) {
    // 指定 Tab：限定为对应状态集合（这些状态本身不含 cancelled）
    where.status = _.in(statusFilter);
  }

  // 查询总数（用于分页）
  const countRes = await db.collection('orders').where(where).count();
  const total: number = countRes.total || 0;

  // 分页查询，按下单时间倒序
  const listRes = await db
    .collection('orders')
    .where(where)
    .orderBy('createdAt', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get();

  // 脱敏：对返回给用户端的 attach 手机号/账号脱敏
  const list: Order[] = (listRes.data as Order[]).map((order) => ({
    ...order,
    attach: maskAttach(order.attach)
  }));

  return { success: true, data: { list, total } };
}
