import {
  filterByCategory,
  searchProducts,
  sortByPrice,
  filterByTag,
  filterCancelledOrders,
  isOrderExpired
} from '../../../cloudfunctions/shared/utils/filter';
import { Product } from '../../../cloudfunctions/shared/types/product';
import { Order, OrderStatus } from '../../../cloudfunctions/shared/types/order';

// 辅助函数：创建测试用商品
function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    productId: 'p001',
    shunshiGoodsId: 1001,
    name: '爱奇艺黄金会员',
    shunshiName: '爱奇艺黄金会员月卡',
    categoryId: 'cat-video',
    categoryName: '视频会员',
    brandIcon: '',
    shunshiImg: '',
    tags: ['热销', '视频'],
    description: '爱奇艺黄金VIP会员',
    rechargeMethod: 'account',
    accountType: 'phone',
    autoActivate: true,
    online: true,
    sortWeight: 100,
    salesCount: 500,
    todaySales: 10,
    shunshiStatus: 1,
    stockNum: 999,
    attachTemplate: [],
    packages: [
      {
        packageId: 'pkg001',
        name: '月卡',
        memberType: 'month',
        price: 1500,
        costPrice: 1200,
        faceValue: 1980,
        shunshiGoodsId: 1001,
        stock: 100,
        online: true,
        isDefault: true,
        sortWeight: 1
      }
    ],
    rules: { deviceSupport: '', arrivalTime: '', safetyNote: '' },
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides
  };
}

// 辅助函数：创建测试用订单
function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    orderId: 'ord001',
    openid: 'user001',
    productId: 'p001',
    productName: '爱奇艺黄金会员',
    packageId: 'pkg001',
    packageName: '月卡',
    categoryName: '视频会员',
    attach: {},
    amount: 1500,
    costPrice: 1200,
    status: OrderStatus.PAID,
    retryCount: 0,
    timeline: [],
    createdAt: new Date('2024-01-01T10:00:00Z'),
    updatedAt: new Date('2024-01-01T10:00:00Z'),
    ...overrides
  };
}

describe('filterByCategory - 按分类过滤已上架商品', () => {
  it('返回匹配分类且已上架的商品', () => {
    const products = [
      makeProduct({ productId: 'p1', categoryId: 'cat-video', online: true }),
      makeProduct({ productId: 'p2', categoryId: 'cat-music', online: true }),
      makeProduct({ productId: 'p3', categoryId: 'cat-video', online: false })
    ];
    const result = filterByCategory(products, 'cat-video');
    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe('p1');
  });

  it('空数组返回空数组', () => {
    expect(filterByCategory([], 'cat-video')).toEqual([]);
  });

  it('无匹配结果返回空数组', () => {
    const products = [
      makeProduct({ categoryId: 'cat-music', online: true })
    ];
    expect(filterByCategory(products, 'cat-video')).toEqual([]);
  });
});

describe('searchProducts - 模糊搜索已上架商品', () => {
  it('匹配商品名称（不区分大小写）', () => {
    const products = [
      makeProduct({ productId: 'p1', name: 'Netflix Premium', online: true }),
      makeProduct({ productId: 'p2', name: '爱奇艺黄金会员', online: true })
    ];
    const result = searchProducts(products, 'netflix');
    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe('p1');
  });

  it('匹配分类名称', () => {
    const products = [
      makeProduct({ productId: 'p1', categoryName: '视频会员', online: true }),
      makeProduct({ productId: 'p2', categoryName: '音乐会员', online: true })
    ];
    const result = searchProducts(products, '视频');
    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe('p1');
  });

  it('不返回已下架商品', () => {
    const products = [
      makeProduct({ name: '爱奇艺黄金会员', online: false })
    ];
    expect(searchProducts(products, '爱奇艺')).toEqual([]);
  });

  it('空关键字返回所有已上架商品', () => {
    const products = [
      makeProduct({ productId: 'p1', online: true }),
      makeProduct({ productId: 'p2', online: false })
    ];
    const result = searchProducts(products, '');
    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe('p1');
  });
});

describe('sortByPrice - 按默认套餐售价升序排序', () => {
  it('按默认套餐价格升序排列', () => {
    const products = [
      makeProduct({
        productId: 'p1',
        packages: [{ packageId: 'pkg1', name: '月卡', memberType: 'month', price: 3000, costPrice: 2500, faceValue: 3500, shunshiGoodsId: 1, stock: 10, online: true, isDefault: true, sortWeight: 1 }]
      }),
      makeProduct({
        productId: 'p2',
        packages: [{ packageId: 'pkg2', name: '月卡', memberType: 'month', price: 1000, costPrice: 800, faceValue: 1500, shunshiGoodsId: 2, stock: 10, online: true, isDefault: true, sortWeight: 1 }]
      }),
      makeProduct({
        productId: 'p3',
        packages: [{ packageId: 'pkg3', name: '月卡', memberType: 'month', price: 2000, costPrice: 1500, faceValue: 2500, shunshiGoodsId: 3, stock: 10, online: true, isDefault: true, sortWeight: 1 }]
      })
    ];
    const result = sortByPrice(products);
    expect(result[0].productId).toBe('p2');
    expect(result[1].productId).toBe('p3');
    expect(result[2].productId).toBe('p1');
  });

  it('无默认套餐时取第一个套餐价格', () => {
    const products = [
      makeProduct({
        productId: 'p1',
        packages: [{ packageId: 'pkg1', name: '年卡', memberType: 'year', price: 5000, costPrice: 4000, faceValue: 6000, shunshiGoodsId: 1, stock: 10, online: true, isDefault: false, sortWeight: 1 }]
      }),
      makeProduct({
        productId: 'p2',
        packages: [{ packageId: 'pkg2', name: '月卡', memberType: 'month', price: 1000, costPrice: 800, faceValue: 1500, shunshiGoodsId: 2, stock: 10, online: true, isDefault: true, sortWeight: 1 }]
      })
    ];
    const result = sortByPrice(products);
    expect(result[0].productId).toBe('p2');
    expect(result[1].productId).toBe('p1');
  });

  it('不修改原数组', () => {
    const products = [
      makeProduct({ productId: 'p1', packages: [{ packageId: 'pkg1', name: '月卡', memberType: 'month', price: 2000, costPrice: 1500, faceValue: 2500, shunshiGoodsId: 1, stock: 10, online: true, isDefault: true, sortWeight: 1 }] }),
      makeProduct({ productId: 'p2', packages: [{ packageId: 'pkg2', name: '月卡', memberType: 'month', price: 1000, costPrice: 800, faceValue: 1500, shunshiGoodsId: 2, stock: 10, online: true, isDefault: true, sortWeight: 1 }] })
    ];
    const original = [...products];
    sortByPrice(products);
    expect(products[0].productId).toBe(original[0].productId);
  });
});

describe('filterByTag - 按标签过滤', () => {
  it('返回包含指定标签的商品', () => {
    const products = [
      makeProduct({ productId: 'p1', tags: ['热销', '视频'] }),
      makeProduct({ productId: 'p2', tags: ['音乐', '新品'] }),
      makeProduct({ productId: 'p3', tags: ['热销', '游戏'] })
    ];
    const result = filterByTag(products, '热销');
    expect(result).toHaveLength(2);
    expect(result.map(p => p.productId)).toEqual(['p1', 'p3']);
  });

  it('无匹配标签返回空数组', () => {
    const products = [makeProduct({ tags: ['视频'] })];
    expect(filterByTag(products, '不存在')).toEqual([]);
  });
});

describe('filterCancelledOrders - 排除已取消订单', () => {
  it('过滤掉状态为 CANCELLED 的订单', () => {
    const orders = [
      makeOrder({ orderId: 'o1', status: OrderStatus.PAID }),
      makeOrder({ orderId: 'o2', status: OrderStatus.CANCELLED }),
      makeOrder({ orderId: 'o3', status: OrderStatus.PENDING_PAY }),
      makeOrder({ orderId: 'o4', status: OrderStatus.CANCELLED })
    ];
    const result = filterCancelledOrders(orders);
    expect(result).toHaveLength(2);
    expect(result.map(o => o.orderId)).toEqual(['o1', 'o3']);
  });

  it('无取消订单时返回全部', () => {
    const orders = [
      makeOrder({ orderId: 'o1', status: OrderStatus.PAID }),
      makeOrder({ orderId: 'o2', status: OrderStatus.SUCCESS })
    ];
    expect(filterCancelledOrders(orders)).toHaveLength(2);
  });

  it('空数组返回空数组', () => {
    expect(filterCancelledOrders([])).toEqual([]);
  });
});

describe('isOrderExpired - 判断待支付订单超时', () => {
  it('待支付订单超过指定分钟数返回 true', () => {
    const now = Date.now();
    // 创建时间为 31 分钟前
    const order = makeOrder({
      status: OrderStatus.PENDING_PAY,
      createdAt: new Date(now - 31 * 60 * 1000)
    });
    expect(isOrderExpired(order, 30)).toBe(true);
  });

  it('待支付订单未超时返回 false', () => {
    const now = Date.now();
    // 创建时间为 10 分钟前
    const order = makeOrder({
      status: OrderStatus.PENDING_PAY,
      createdAt: new Date(now - 10 * 60 * 1000)
    });
    expect(isOrderExpired(order, 30)).toBe(false);
  });

  it('非待支付状态始终返回 false', () => {
    const now = Date.now();
    const order = makeOrder({
      status: OrderStatus.PAID,
      createdAt: new Date(now - 60 * 60 * 1000) // 1小时前
    });
    expect(isOrderExpired(order, 30)).toBe(false);
  });

  it('默认超时时间为 30 分钟', () => {
    const now = Date.now();
    const order = makeOrder({
      status: OrderStatus.PENDING_PAY,
      createdAt: new Date(now - 31 * 60 * 1000)
    });
    expect(isOrderExpired(order)).toBe(true);
  });

  it('恰好等于超时时间不算超时', () => {
    const now = Date.now();
    const order = makeOrder({
      status: OrderStatus.PENDING_PAY,
      createdAt: new Date(now - 30 * 60 * 1000)
    });
    expect(isOrderExpired(order, 30)).toBe(false);
  });
});
