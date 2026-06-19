// 分类页（tabBar）
// 左右双栏布局：左侧分类侧边栏 + 右侧该分类商品面板
// - 左侧分类数据来自 product.getCategories
// - 点击左侧分类切换右侧商品列表与数量统计（product.getList）
// - 商品分页触底加载；加载态用骨架屏，空态/异常分别提示
// Requirements: 1.4, 1.5, 16.2

import { request } from '../../utils/request';
import { PAGE_SIZE } from '../../utils/constants';
import { Category, Product, PageState } from '../../utils/types';

interface CategoryPageData {
  /** 左侧分类列表（顶级分类） */
  categories: Category[];
  /** 当前选中的分类ID */
  activeCategoryId: string;
  /** 当前选中分类名称（右侧标题展示） */
  activeCategoryName: string;
  /** 右侧商品列表 */
  products: Product[];
  /** 当前分类商品总数 */
  total: number;
  /** 当前页码（从 1 开始） */
  page: number;
  /** 是否还有下一页 */
  hasMore: boolean;
  /** 触底加载下一页中 */
  loadingMore: boolean;
  /** 整页（分类侧边栏）加载态：首次进入展示骨架屏 */
  pageLoading: boolean;
  /** 分类加载是否异常 */
  categoryError: boolean;
  /** 右侧商品面板状态：loading/success/empty/error */
  listState: PageState;
}

Page<CategoryPageData, WechatMiniprogram.IAnyObject>({
  data: {
    categories: [],
    activeCategoryId: '',
    activeCategoryName: '',
    products: [],
    total: 0,
    page: 1,
    hasMore: false,
    loadingMore: false,
    pageLoading: true,
    categoryError: false,
    listState: PageState.LOADING
  },

  onLoad() {
    this.loadCategories();
  },

  /**
   * 加载左侧分类列表
   * 仅展示顶级分类（无 parentId 或 level<=1），加载后默认选中第一个
   */
  async loadCategories() {
    this.setData({ pageLoading: true, categoryError: false });
    try {
      const res = await request<{ categories: Category[] }>({
        name: 'product',
        action: 'getCategories'
      });

      const all = (res && res.categories) || [];
      // 优先取顶级分类；若无层级信息则回退展示全部
      const topLevel = all.filter((c) => !c.parentId || c.level <= 1);
      const categories = topLevel.length > 0 ? topLevel : all;

      if (categories.length === 0) {
        // 无分类数据：整页空态
        this.setData({
          categories: [],
          pageLoading: false,
          listState: PageState.EMPTY
        });
        return;
      }

      const first = categories[0];
      this.setData({
        categories,
        activeCategoryId: first.categoryId,
        activeCategoryName: first.name,
        pageLoading: false
      });

      // 加载首个分类的商品
      this.loadProducts(true);
    } catch (e) {
      // 分类加载失败：展示异常态，提供重试
      this.setData({ pageLoading: false, categoryError: true });
    }
  },

  /**
   * 点击左侧分类项：切换右侧商品列表
   */
  onSelectCategory(e: WechatMiniprogram.TouchEvent) {
    const { id, name } = e.currentTarget.dataset as { id: string; name: string };
    if (!id || id === this.data.activeCategoryId) return;

    this.setData({
      activeCategoryId: id,
      activeCategoryName: name,
      products: [],
      total: 0,
      page: 1,
      hasMore: false
    });
    this.loadProducts(true);
  },

  /**
   * 加载右侧商品列表
   * @param reset true=切换分类/首次加载（重置列表）；false=触底加载下一页
   */
  async loadProducts(reset: boolean) {
    const categoryId = this.data.activeCategoryId;
    if (!categoryId) return;

    const page = reset ? 1 : this.data.page + 1;

    if (reset) {
      this.setData({ listState: PageState.LOADING });
    } else {
      // 触底加载更多：防重复
      if (this.data.loadingMore || !this.data.hasMore) return;
      this.setData({ loadingMore: true });
    }

    try {
      const res = await request<{ list: Product[]; total: number }>({
        name: 'product',
        action: 'getList',
        data: { categoryId, page, pageSize: PAGE_SIZE }
      });

      const list = (res && res.list) || [];
      const total = (res && res.total) || 0;
      const products = reset ? list : this.data.products.concat(list);
      const hasMore = products.length < total;

      this.setData({
        products,
        total,
        page,
        hasMore,
        loadingMore: false,
        // 重置加载后若无商品则空态，否则成功态
        listState: products.length === 0 ? PageState.EMPTY : PageState.SUCCESS
      });
    } catch (e) {
      if (reset) {
        // 首次加载失败：右侧异常态
        this.setData({ listState: PageState.ERROR, loadingMore: false });
      } else {
        // 加载更多失败：恢复可继续触底，页码不前进
        this.setData({ loadingMore: false });
      }
    }
  },

  /**
   * 触底加载下一页
   */
  onReachBottom() {
    this.loadProducts(false);
  },

  /**
   * 点击商品卡片：跳转商品详情页
   */
  onProductTap(e: WechatMiniprogram.CustomEvent<{ productId: string }>) {
    const productId = e.detail && e.detail.productId;
    if (!productId) return;
    wx.navigateTo({
      url: `/pages/detail/detail?productId=${productId}`
    });
  },

  /**
   * 分类加载异常重试
   */
  onRetryCategories() {
    this.loadCategories();
  },

  /**
   * 右侧商品加载异常重试
   */
  onRetryProducts() {
    this.loadProducts(true);
  }
});
