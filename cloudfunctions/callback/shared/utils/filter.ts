// 过滤与排序工具函数

import { Product } from '../types/product';
import { Order, OrderStatus } from '../types/order';

/**
 * 按分类过滤已上架商品
 * 返回 categoryId 匹配且 online === true 的商品
 */
export function filterByCategory(products: Product[], categoryId: string): Product[] {
  return products.filter(
    (product) => product.categoryId === categoryId && product.online === true
  );
}

/**
 * 模糊匹配名称和分类名，仅返回已上架商品
 * keyword 转小写后匹配 name 或 categoryName（不区分大小写）
 */
export function searchProducts(products: Product[], keyword: string): Product[] {
  const lowerKeyword = keyword.toLowerCase();
  return products.filter(
    (product) =>
      product.online === true &&
      (product.name.toLowerCase().includes(lowerKeyword) ||
        product.categoryName.toLowerCase().includes(lowerKeyword))
  );
}

/**
 * 按默认套餐售价升序排序
 * 找到每个商品 packages 中 isDefault === true 的套餐，按其 price 升序排序
 * 如无默认套餐则取第一个套餐的 price
 */
export function sortByPrice(products: Product[]): Product[] {
  return [...products].sort((a, b) => {
    const priceA = getDefaultPackagePrice(a);
    const priceB = getDefaultPackagePrice(b);
    return priceA - priceB;
  });
}

/**
 * 获取商品默认套餐的价格
 * 优先取 isDefault === true 的套餐，没有则取第一个
 */
function getDefaultPackagePrice(product: Product): number {
  const defaultPkg = product.packages.find((pkg) => pkg.isDefault === true);
  if (defaultPkg) {
    return defaultPkg.price;
  }
  // 无默认套餐则取第一个
  if (product.packages.length > 0) {
    return product.packages[0].price;
  }
  // 无套餐时返回 Infinity，排在最后
  return Infinity;
}

/**
 * 按标签过滤
 * 商品 tags 数组中 includes(tag) 即匹配
 */
export function filterByTag(products: Product[], tag: string): Product[] {
  return products.filter((product) => product.tags.includes(tag));
}

/**
 * 排除已取消订单
 * 过滤掉 status === OrderStatus.CANCELLED 的订单
 */
export function filterCancelledOrders(orders: Order[]): Order[] {
  return orders.filter((order) => order.status !== OrderStatus.CANCELLED);
}

/**
 * 判断待支付订单是否超时
 * 当 status 为 pending_pay 且 (当前时间 - createdAt) > minutes * 60 * 1000 时返回 true
 */
export function isOrderExpired(order: Order, minutes: number = 30): boolean {
  if (order.status !== OrderStatus.PENDING_PAY) {
    return false;
  }
  const now = Date.now();
  const createdTime = new Date(order.createdAt).getTime();
  return (now - createdTime) > minutes * 60 * 1000;
}
