// 首页
// 功能：搜索入口、信任 Hero 区、实时购买播报、分类 Tab 切换、商品列表（分页）、
//       骨架屏加载态、空状态、异常重试、下拉刷新、触底加载。
// 数据来源：product 云函数 action（getConfig / getBroadcast / getCategories / getList）
// Requirements: 1.1, 1.2, 1.3, 1.8, 22.1, 22.2, 22.3, 22.4, 22.5

import { requestSilent } from '../../utils/request';
import { PAGE_SIZE, BROADCAST_MIN_DISPLAY } from '../../utils/constants';
import { readPageCache, writePageCache } from '../../utils/pageCache';
import {
  Product,
  Category,
  BroadcastItem,
  PageState
} from '../../utils/types';

/** 首页分类 Tab 项（含真实 categoryId，热门为空串表示全部） */
interface HomeTab {
  label: string;
  categoryId: string;
}

interface HomeProductCache {
  products: Product[];
  total: number;
  hasMore: boolean;
}

const HOME_CACHE_TTL = 60 * 1000;
const HOME_CATEGORIES_CACHE_KEY = 'home:categories';

Page({
  data: {
    // 累计订单数（信任 Hero 区，22.1/22.2），默认占位待配置回填
    orderCount: '',
    // 实时购买播报数据源（22.3），少于 5 条由组件自动隐藏
    broadcastList: [] as BroadcastItem[],
    // 播报隐藏阈值（22.5）
    broadcastMin: BROADCAST_MIN_DISPLAY,
    // 分类 Tab 列表（首项固定为"热门"）
    tabs: [{ label: '热门', categoryId: '' }] as HomeTab[],
    // 当前选中 Tab 索引
    activeTab: 0,
    // 当前 Tab 下的商品列表
    products: [] as Product[],
    // 列表整体状态：loading / success / error / empty
    listState: PageState.LOADING,
    // 触底加载下一页的 loading 标记
    loadingMore: false,
    // 是否还有更多数据
    hasMore: false,
    // 主题色（供 wxml 内联使用）
    primaryColor: '#c99a3a'
  },

  // 分页游标（不参与渲染，放在实例上）
  _page: 1,
  _total: 0,

  onLoad() {
    // 首屏：并行加载信任数据、播报、分类 Tab；分类就绪后加载商品列表
    this.loadHeroAndBroadcast();
    this.loadCategories();
  },

  /**
   * 下拉刷新：重载全部数据
   */
  async onPullDownRefresh() {
    this.loadHeroAndBroadcast();
    await this.loadCategories();
    wx.stopPullDownRefresh();
  },

  /**
   * 触底：加载下一页商品
   */
  onReachBottom() {
    this.loadMore();
  },

  /**
   * 加载信任 Hero 数据与播报（静默失败，不阻塞主流程）
   */
  async loadHeroAndBroadcast(this: any) {
    const [cfgRes, bcRes] = await Promise.all([
      requestSilent<string>({
        name: 'product',
        action: 'getConfig',
        data: { key: 'homepage_order_count' }
      }),
      requestSilent<BroadcastItem[]>({
        name: 'product',
        action: 'getBroadcast'
      })
    ]);

    if (cfgRes.success && cfgRes.data) {
      this.setData({ orderCount: String(cfgRes.data) });
    }

    if (bcRes.success && Array.isArray(bcRes.data)) {
      this.setData({ broadcastList: bcRes.data });
    }
  },

  /**
   * 加载分类 Tab：从 getCategories 取 showInTab=true 的分类，
   * 按 tabSort 升序拼到"热门"之后；失败时退化为仅"热门"。
   * 分类就绪后加载首个 Tab 的商品列表。
   */
  async loadCategories(this: any) {
    const cached = readPageCache<HomeTab[]>(HOME_CATEGORIES_CACHE_KEY, HOME_CACHE_TTL);
    if (cached && cached.length > 0) {
      this.setData({ tabs: cached, activeTab: 0 });
      this.loadProducts(true);
      this.refreshCategories();
      return;
    }

    await this.refreshCategories();
  },

  async refreshCategories(this: any) {
    const res = await requestSilent<{ categories: Category[] }>({
      name: 'product',
      action: 'getCategories'
    });

    const tabs: HomeTab[] = [{ label: '热门', categoryId: '' }];
    if (res.success && res.data && Array.isArray(res.data.categories)) {
      res.data.categories
        .filter((c) => c.showInTab)
        .sort((a, b) => (a.tabSort || 0) - (b.tabSort || 0))
        .forEach((c) => tabs.push({ label: this.formatTabLabel(c.name), categoryId: c.categoryId }));
    }

    const currentCategoryId = (this.data.tabs[this.data.activeTab] || { categoryId: '' }).categoryId;
    const nextActive = currentCategoryId
      ? Math.max(0, tabs.findIndex((tab) => tab.categoryId === currentCategoryId))
      : 0;
    this.setData({ tabs, activeTab: nextActive });
    writePageCache(HOME_CATEGORIES_CACHE_KEY, tabs);
    // 首次进入或仍在热门 Tab 时刷新当前列表；用户已切到其他 Tab 时不打断其选择。
    if (!currentCategoryId) await this.loadProducts(true);
  },

  /**
   * 切换分类 Tab：重置分页并刷新商品列表（1.2 仅展示对应分类已上架商品）
   */
  onTabChange(this: any, e: any) {
    const index = Number(e.currentTarget.dataset.index);
    if (index === this.data.activeTab) return;
    this.setData({ activeTab: index, products: [], listState: PageState.LOADING });
    this.loadProducts(true);
  },

  /**
   * 加载商品列表
   * @param reset true=首屏/切Tab/刷新（重置到第1页并替换），false=触底加载下一页
   */
  async loadProducts(this: any, reset: boolean) {
    if (reset) {
      this._page = 1;
      this._total = 0;
    }

    const tab: HomeTab = this.data.tabs[this.data.activeTab] || { categoryId: '' };
    const cacheKey = `home:products:${tab.categoryId || 'all'}`;

    if (reset) {
      const cached = readPageCache<HomeProductCache>(cacheKey, HOME_CACHE_TTL);
      if (cached) {
        this._total = cached.total;
        this.setData({
          products: cached.products,
          hasMore: cached.hasMore,
          loadingMore: false,
          listState: cached.products.length === 0 ? PageState.EMPTY : PageState.SUCCESS
        });
        this.refreshProducts(reset, true);
        return;
      }
    }

    await this.refreshProducts(reset, false);
  },

  async refreshProducts(this: any, reset: boolean, silent: boolean) {
    const tab: HomeTab = this.data.tabs[this.data.activeTab] || { categoryId: '' };
    const requestCategoryId = tab.categoryId;
    const cacheKey = `home:products:${tab.categoryId || 'all'}`;

    const res = await requestSilent<{ list: Product[]; total: number }>({
      name: 'product',
      action: 'getList',
      data: { categoryId: tab.categoryId, page: this._page, pageSize: PAGE_SIZE }
    });

    const latestTab: HomeTab = this.data.tabs[this.data.activeTab] || { categoryId: '' };
    if (latestTab.categoryId !== requestCategoryId) return;

    // 加载失败：首页展示异常态（可重试），翻页失败仅复位 loadingMore
    if (!res.success || !res.data) {
      if (reset && !silent) {
        this.setData({ listState: PageState.ERROR });
      }
      this.setData({ loadingMore: false });
      return;
    }

    const { list, total } = res.data;
    this._total = total;

    const decorated = this.decorateProducts(list);
    const products = reset ? decorated : this.data.products.concat(decorated);
    const hasMore = products.length < total;

    this.setData({
      products,
      hasMore,
      loadingMore: false,
      listState: products.length === 0 ? PageState.EMPTY : PageState.SUCCESS
    });

    if (reset) {
      writePageCache<HomeProductCache>(cacheKey, { products, total, hasMore });
    }
  },

  /**
   * 触底加载下一页（无更多 / 正在加载 / 非成功态时跳过）
   */
  loadMore(this: any) {
    if (
      !this.data.hasMore ||
      this.data.loadingMore ||
      this.data.listState !== PageState.SUCCESS
    ) {
      return;
    }
    this._page += 1;
    this.setData({ loadingMore: true });
    this.loadProducts(false);
  },

  /**
   * 骨架屏超时 / 异常态点击重试：重新加载当前 Tab 商品
   */
  onRetry(this: any) {
    this.setData({ listState: PageState.LOADING });
    this.loadProducts(true);
  },

  decorateProducts(products: Product[]): Product[] {
    return (products || []).map((product) => ({
      ...product,
      displayIcon: this.pickRenderableImageUrl(product.brandIcon)
    }));
  },

  pickRenderableImageUrl(url?: string): string {
    const value = String(url || '').trim();
    if (/^https?:\/\/imgs\.mxmm666\.com\//i.test(value)) return '';
    if (/^https:\/\//i.test(value) || /^cloud:\/\//i.test(value) || /^\//.test(value)) {
      return value;
    }
    return '';
  },

  formatTabLabel(name: string): string {
    const map: Record<string, string> = {
      视频会员: '视频',
      音乐: '音乐',
      阅读听书: '阅读',
      网盘: '网盘',
      办公工具: '工具',
      运动健身: '健身',
      共享单车: '单车'
    };
    return map[name] || String(name || '').replace(/会员$/, '');
  },

  /**
   * 点击搜索栏：跳转搜索页（1.6）
   */
  goSearch() {
    wx.navigateTo({ url: '/pages/search/search' });
  },

  /**
   * 点击商品卡片：跳转商品详情页（2.1）
   */
  onProductTap(e: any) {
    const productId = (e.detail && e.detail.productId) || (e.currentTarget && e.currentTarget.dataset.id);
    if (!productId) return;
    wx.navigateTo({ url: `/pages/detail/detail?productId=${productId}` });
  }
});
