/// <reference types="miniprogram-api-typings" />

// 全局应用实例类型
interface IAppOption {
  globalData: {
    userInfo: WechatMiniprogram.UserInfo | null;
    isLoggedIn: boolean;
    isAdmin: boolean;
    // 跨页通信：订单列表页默认选中 Tab
    orderTab?: string;
    // 最近一次全局异常记录（调试用）
    lastError?: { type: string; message: string; time: string } | null;
  };
}
