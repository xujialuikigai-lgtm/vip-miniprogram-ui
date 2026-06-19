// 个人中心页（tabBar 我的）
// 功能：用户信息/授权登录、订单统计入口、客服二维码、常用功能内容页入口、管理员入口、服务保障说明
// 依赖云函数：order.stats（订单统计）、product.getConfig（客服二维码）、admin.getConfigs（管理员身份探测）

import { request, requestSilent } from '../../utils/request';
import { OrderStats } from '../../utils/types';

/** 本地缓存：用户授权信息 */
const USER_INFO_STORAGE_KEY = 'profile_user_info';
/** 客服二维码配置键 */
const QRCODE_CONFIG_KEY = 'customer_service_qrcode';

/** 用户授权信息结构 */
interface UserInfo {
  avatarUrl: string;
  nickName: string;
}

/** 常用功能菜单项（跳转富文本内容页时携带 articleKey） */
interface MenuItem {
  /** 菜单标题 */
  title: string;
  /** 副文案 */
  desc: string;
  /** 图标名（TDesign icon） */
  icon: string;
  /** 跳转动作：order=我的订单，article=富文本内容页 */
  type: 'order' | 'article';
  /** 富文本内容页 key（type=article 时有效） */
  articleKey?: string;
}

Page({
  data: {
    /** 用户授权信息，null 表示未授权（展示占位符 U / 微信用户） */
    userInfo: null as UserInfo | null,
    /** 订单统计：全部、处理中（开通中）、待退款 */
    stats: { total: 0, activating: 0, refunding: 0 } as OrderStats,
    /** 统计数据加载中 */
    statsLoading: true,
    /** 当前用户是否为管理员（控制管理员入口显隐） */
    isAdmin: false,
    /** 客服二维码弹窗是否可见 */
    qrcodeVisible: false,
    /** 客服二维码图片地址 */
    qrcodeUrl: '',
    /** 二维码图片加载失败（展示兜底文案） */
    qrcodeError: false,
    /** 客服配置是否加载中 */
    qrcodeLoading: false,
    /** 常用功能菜单 */
    menuList: [
      { title: '我的订单', desc: '查看全部订单与开通进度', icon: 'order-adjustment', type: 'order' },
      { title: '购买须知', desc: '下单前必读说明', icon: 'info-circle', type: 'article', articleKey: 'purchase_notice' },
      { title: '账号填写说明', desc: '如何正确填写充值账号', icon: 'user-circle', type: 'article', articleKey: 'account_guide' },
      { title: '平台公告', desc: '最新平台动态', icon: 'notification', type: 'article', articleKey: 'platform_announcement' }
    ] as MenuItem[],
    /** 底部服务保障说明（3 条固定文案） */
    serviceList: [
      '官方直充 · 不自动续费，到期自然失效',
      '专属客服 · 工作时间内快速响应订单问题',
      '安全保障 · 开通失败原路退款，资金有保障'
    ]
  },

  onLoad() {
    // 读取本地缓存的授权信息（若用户曾授权）
    this.restoreUserInfo();
  },

  onShow() {
    // 每次进入页面刷新订单统计与管理员身份（数据需实时）
    this.loadStats();
    this.checkAdmin();
  },

  /** 从本地缓存恢复用户授权信息 */
  restoreUserInfo() {
    try {
      const cached = wx.getStorageSync(USER_INFO_STORAGE_KEY);
      if (cached && cached.avatarUrl) {
        this.setData({ userInfo: cached });
      }
    } catch (e) {
      // 缓存读取失败忽略，展示默认占位符
    }
  },

  /** 加载订单统计（order.stats） */
  async loadStats() {
    this.setData({ statsLoading: true });
    try {
      const stats = await request<OrderStats>({ name: 'order', action: 'stats' });
      this.setData({
        stats: {
          total: stats?.total || 0,
          activating: stats?.activating || 0,
          refunding: stats?.refunding || 0
        },
        statsLoading: false
      });
    } catch (e) {
      // request 已统一 Toast，这里仅复位 loading，保留默认 0
      this.setData({ statsLoading: false });
    }
  },

  /** 探测管理员身份：调用管理端轻量 action，成功即为白名单管理员 */
  async checkAdmin() {
    const res = await requestSilent({ name: 'admin', action: 'getConfigs' });
    this.setData({ isAdmin: !!res.success });
  },

  /** 微信授权登录：获取头像昵称并缓存 */
  handleLogin() {
    wx.getUserProfile({
      desc: '用于完善个人中心展示',
      success: (res) => {
        const info: UserInfo = {
          avatarUrl: res.userInfo.avatarUrl,
          nickName: res.userInfo.nickName
        };
        this.setData({ userInfo: info });
        try {
          wx.setStorageSync(USER_INFO_STORAGE_KEY, info);
        } catch (e) {
          // 缓存写入失败忽略，不影响当前展示
        }
      },
      fail: () => {
        // 用户取消授权，保持默认占位符
      }
    });
  },

  /** 点击统计卡片：跳转订单列表并切换对应 Tab */
  onStatTap(e: WechatMiniprogram.BaseEvent) {
    // 统计项 → 订单 Tab 映射：全部→all，处理中→activating，待退款→refund
    const tab = e.currentTarget.dataset.tab as string;
    this.toOrders(tab);
  },

  /** 菜单点击分发 */
  onMenuTap(e: WechatMiniprogram.BaseEvent) {
    const index = e.currentTarget.dataset.index as number;
    const item = this.data.menuList[index];
    if (!item) return;

    if (item.type === 'order') {
      this.toOrders('all');
    } else if (item.type === 'article' && item.articleKey) {
      // 跳转静态富文本内容页，携带 key 与标题
      wx.navigateTo({
        url: `/pages/article/article?key=${item.articleKey}&title=${encodeURIComponent(item.title)}`
      });
    }
  },

  /** 跳转订单列表 Tab 页（通过 globalData 传递目标 Tab，与 orders 页 onShow 读取一致） */
  toOrders(tab: string) {
    const app = getApp<{ globalData: Record<string, any> }>();
    if (app && app.globalData) {
      app.globalData.orderTab = tab;
    }
    wx.switchTab({ url: '/pages/orders/orders' });
  },

  /** 打开客服二维码弹窗：读取配置中的图片地址 */
  async showQrcode() {
    this.setData({ qrcodeVisible: true, qrcodeError: false });

    // 已加载过则复用，避免重复请求
    if (this.data.qrcodeUrl) return;

    this.setData({ qrcodeLoading: true });
    const res = await requestSilent<string>({
      name: 'product',
      action: 'getConfig',
      data: { key: QRCODE_CONFIG_KEY }
    });

    if (res.success && res.data) {
      this.setData({ qrcodeUrl: res.data, qrcodeLoading: false });
    } else {
      // 未配置二维码：展示兜底提示
      this.setData({ qrcodeError: true, qrcodeLoading: false });
    }
  },

  /** 关闭客服二维码弹窗 */
  hideQrcode() {
    this.setData({ qrcodeVisible: false });
  },

  /** 二维码图片加载失败兜底 */
  onQrcodeError() {
    this.setData({ qrcodeError: true });
  },

  /** 跳转管理端数据看板 */
  goAdmin() {
    wx.navigateTo({ url: '/pages/admin/dashboard/dashboard' });
  }
});
