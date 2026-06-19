// 商品卡片组件 product-card
// 通过 properties 接收商品数据，展示品牌图标、名称、标签、销量、现价与划线原价
// 点击卡片向上冒泡 tap 事件，携带 productId 供页面跳转使用
// Requirements: 1.3

import { formatPrice } from '../../utils/format';
import { Product, Package } from '../../utils/types';

Component({
  options: {
    // 允许使用全局样式（TDesign 主题变量）
    addGlobalClass: true,
    // 支持外部传入 class 控制布局
    styleIsolation: 'apply-shared',
  },

  properties: {
    // 商品数据（前端精简版 Product）
    product: {
      type: Object,
      value: null,
      // 商品数据变化时重新计算展示字段
      observer(this: any, value: any) {
        this.updateDisplay(value as Product | null);
      },
    },
  },

  data: {
    // 现价（元，已格式化）
    displayPrice: '0.00',
    // 划线原价（元，已格式化）
    displayOriginalPrice: '',
    // 是否展示划线原价（仅当原价高于现价时展示）
    showOriginalPrice: false,
    // 是否待配置售价 / 可售套餐
    pricePending: false,
    // 商品图：优先后台配置 brandIcon，兜底顺势图片
    displayIcon: '',
    // 销量文案
    salesText: '',
    // 品牌图标是否加载失败（失败时展示文字占位符）
    iconError: false,
  },

  methods: {
    /**
     * 根据商品数据计算卡片展示字段
     */
    updateDisplay(this: any, product: Product | null) {
      if (!product) {
        this.setData({
          displayPrice: '0.00',
          displayOriginalPrice: '',
          showOriginalPrice: false,
          pricePending: false,
          displayIcon: '',
          salesText: '',
          iconError: false,
        });
        return;
      }

      // 选取用于展示价格的套餐：优先默认套餐，其次最低价已上架套餐
      const pkg = this.pickPackage(product.packages || []);
      const price = pkg ? pkg.price : 0;
      const faceValue = pkg ? pkg.faceValue : 0;
      const pricePending = !pkg || !pkg.online || price <= 0;

      // 现价（元）
      const displayPrice = formatPrice(price);
      // 仅当面值（划线原价）高于现价时才展示
      const showOriginalPrice = !pricePending && faceValue > price && price > 0;
      const displayOriginalPrice = showOriginalPrice ? formatPrice(faceValue) : '';

      this.setData({
        displayPrice: pricePending ? '待配置' : displayPrice,
        displayOriginalPrice,
        showOriginalPrice,
        pricePending,
        displayIcon: product.brandIcon || product.shunshiImg || '',
        salesText: this.buildSalesText(product.salesCount || 0),
        iconError: false,
      });
    },

    /**
     * 选取展示价格的套餐
     * 优先：已上架且 isDefault 的套餐
     * 次选：已上架套餐中售价最低者
     * 兜底：第一个套餐
     */
    pickPackage(packages: Package[]): Package | null {
      if (!packages || packages.length === 0) return null;
      const online = packages.filter((p) => p && p.online);
      const list = online.length > 0 ? online : packages;

      const def = list.find((p) => p.isDefault);
      if (def) return def;

      // 按售价升序取最低价
      return list.slice().sort((a, b) => a.price - b.price)[0] || null;
    },

    /**
     * 生成销量文案，超过 9999 时展示 "9999+"
     */
    buildSalesText(count: number): string {
      if (!count || count <= 0) return '';
      return count > 9999 ? '已售9999+' : `已售${count}`;
    },

    /**
     * 点击卡片：向上冒泡 tap 事件，携带 productId
     */
    onTap(this: any) {
      const product: Product | null = this.data.product;
      if (!product) return;
      this.triggerEvent(
        'tap',
        { productId: product.productId, product },
        // 开启事件冒泡与跨组件传递
        { bubbles: true, composed: true }
      );
    },

    /**
     * 品牌图标加载失败时切换为文字占位符
     */
    onIconError(this: any) {
      this.setData({ iconError: true });
    },
  },
});
