// 会员多多购 - 小程序入口文件
App({
  onLaunch() {
    // 初始化云开发环境
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
      return;
    }

    wx.cloud.init({
      // 云开发环境ID
      env: 'cloudbase-d6gkjnoz780cb33dc',
      traceUser: true
    });
  },

  /**
   * 全局 JS 错误捕获
   * 捕获页面 / 组件未处理的同步异常，统一记录日志，避免静默崩溃。
   * @param error - 错误堆栈字符串
   */
  onError(error: string) {
    console.error('[全局异常] onError:', error);
    this.recordError('js_error', error);
  },

  /**
   * 全局未处理 Promise rejection 捕获
   * 兜底页面中漏掉 catch 的异步异常（如未捕获的 request reject）。
   * @param res - 包含 reason 与 promise 的对象
   */
  onUnhandledRejection(res: WechatMiniprogram.OnUnhandledRejectionListenerResult) {
    const reason: unknown = res && res.reason;
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.error('[全局异常] onUnhandledRejection:', msg);
    this.recordError('unhandled_rejection', msg);
  },

  /**
   * 页面无法找到时的兜底处理，重定向回首页。
   * @param res - 跳转失败信息
   */
  onPageNotFound(res: WechatMiniprogram.OnPageNotFoundListenerResult) {
    console.error('[全局异常] onPageNotFound:', res && res.path);
    wx.reLaunch({ url: '/pages/index/index' });
  },

  /**
   * 记录最近一次全局异常（仅本地，便于调试与后续上报扩展）
   * @param type - 异常类型
   * @param message - 异常信息
   */
  recordError(this: any, type: string, message: string) {
    this.globalData.lastError = {
      type,
      message,
      time: new Date().toISOString()
    };
  },

  globalData: {
    // 用户信息
    userInfo: null as WechatMiniprogram.UserInfo | null,
    // 是否已登录
    isLoggedIn: false,
    // 是否为管理员
    isAdmin: false,
    // 跨页通信：订单列表页默认选中 Tab（orders 页 onShow 读取后清空）
    orderTab: '',
    // 最近一次全局异常记录（调试用）
    lastError: null as { type: string; message: string; time: string } | null
  }
});
