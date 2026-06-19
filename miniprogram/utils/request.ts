// 封装 wx.cloud.callFunction，统一错误处理

import { CloudFunctionResult, CloudFunctionParams } from './types';
import { REQUEST_TIMEOUT } from './constants';
import { getFriendlyMessage, isPermissionError } from './errorCode';

/** 首页路径（无权限时统一重定向目标） */
const HOME_PAGE_PATH = 'pages/index/index';

/**
 * 统一云函数调用封装
 * 自动处理 success: false 的响应，统一 Toast 提示
 * 超时控制 10 秒
 * @param params - 云函数调用参数（name、action、data）
 * @returns 云函数返回的 data 字段
 */
export async function request<T = any>(params: CloudFunctionParams): Promise<T> {
  const { name, action, data = {} } = params;

  try {
    // 使用 Promise.race 实现超时控制
    const result = await Promise.race([
      wx.cloud.callFunction({
        name,
        data: { action, ...data }
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('REQUEST_TIMEOUT'));
        }, REQUEST_TIMEOUT);
      })
    ]);

    const res = (result as any).result as CloudFunctionResult<T>;

    // 云函数返回 success: false，按错误码统一处理
    if (!res || !res.success) {
      const errCode = res?.errCode;
      const errMsg = getFriendlyMessage(errCode, res?.errMsg);

      // 无权限 / 身份失效：提示后重定向首页（与管理端页面处理保持一致）
      if (isPermissionError(errCode)) {
        showToast(errMsg);
        redirectToHome();
      } else {
        showToast(errMsg);
      }
      return Promise.reject(new Error(errMsg));
    }

    return res.data as T;
  } catch (err: any) {
    // 超时错误
    if (err?.message === 'REQUEST_TIMEOUT') {
      const msg = getFriendlyMessage('TIMEOUT');
      showToast(msg);
      return Promise.reject(new Error(msg));
    }

    // 网络异常统一提示
    const msg = getFriendlyMessage('NETWORK_ERROR');
    showToast(msg);
    return Promise.reject(new Error(msg));
  }
}

/**
 * 静默调用（不自动弹 Toast，由调用方自行处理错误）
 * 返回完整结果，调用方可读取 errCode 自行决定处理策略（如管理端无权限拦截）。
 * errMsg 经过统一映射，确保即使云函数未下发文案也有友好提示。
 * @param params - 云函数调用参数
 * @returns 云函数返回的完整结果
 */
export async function requestSilent<T = any>(
  params: CloudFunctionParams
): Promise<CloudFunctionResult<T>> {
  const { name, action, data = {} } = params;

  try {
    const result = await Promise.race([
      wx.cloud.callFunction({
        name,
        data: { action, ...data }
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('REQUEST_TIMEOUT'));
        }, REQUEST_TIMEOUT);
      })
    ]);

    const res = (result as any).result as CloudFunctionResult<T>;
    if (!res) {
      return { success: false, errCode: 'EMPTY_RESULT', errMsg: '返回数据为空' };
    }
    // 失败时补全友好文案（不改变 errCode，保证调用方判断逻辑不受影响）
    if (!res.success) {
      res.errMsg = getFriendlyMessage(res.errCode, res.errMsg);
    }
    return res;
  } catch (err: any) {
    if (err?.message === 'REQUEST_TIMEOUT') {
      return { success: false, errCode: 'TIMEOUT', errMsg: getFriendlyMessage('TIMEOUT') };
    }
    return {
      success: false,
      errCode: 'NETWORK_ERROR',
      errMsg: getFriendlyMessage('NETWORK_ERROR')
    };
  }
}

/**
 * 统一 Toast 提示（封装 wx.showToast）
 * @param msg - 提示文案
 */
function showToast(msg: string): void {
  wx.showToast({
    title: msg,
    icon: 'none',
    duration: 2500
  });
}

/**
 * 重定向到首页（无权限 / 身份失效场景）
 * 已在首页时不重复跳转，避免无意义重启；延迟跳转让 Toast 有展示时间。
 */
function redirectToHome(): void {
  const pages = getCurrentPages();
  const current = pages.length > 0 ? pages[pages.length - 1].route : '';
  if (current === HOME_PAGE_PATH) {
    return;
  }
  setTimeout(() => {
    wx.reLaunch({ url: `/${HOME_PAGE_PATH}` });
  }, 1200);
}
