// 商品详情页
// 功能：品牌 Hero 区、会员类型选择（多类型切换刷新套餐与价格）、套餐选择（同步底部金额）、
//       关键须知 / 权益对比、底部固定支付栏（动态表单 + 购买按钮，表单未完成禁用）、
//       购买核对弹窗（二次确认 + 价格一致性校验）、下单支付链路
//       （order.create → payment.unifiedOrder → wx.requestPayment → 支付结果页）。
//       加载态骨架屏、异常态重试（保留表单数据）、价格变更（PRICE_CHANGED）提示重选。
// 数据来源：product.getDetail / order.create / payment.unifiedOrder
// Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 16.4

import { requestSilent } from '../../utils/request';
import { formatPrice } from '../../utils/format';
import { isValidPhone } from '../../utils/validator';
import {
  Product,
  Package,
  AttachTemplate,
  PageState
} from '../../utils/types';

type DisplayPackage = Package & {
  pricePending: boolean;
  priceText: string;
  faceValueText: string;
};

function pickRenderableImageUrl(...urls: Array<string | undefined>): string {
  for (const url of urls) {
    const value = String(url || '').trim();
    if (isBlockedRemoteImage(value)) continue;
    if (
      /^https:\/\//i.test(value) ||
      /^cloud:\/\//i.test(value) ||
      /^\//.test(value)
    ) {
      return value;
    }
  }
  return '';
}

function isBlockedRemoteImage(url: string): boolean {
  return /^https?:\/\/imgs\.mxmm666\.com\//i.test(url);
}

/** 微信支付参数（与云函数 payment.unifiedOrder 返回的 payParams 对齐） */
interface PayParams {
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: 'RSA';
  paySign: string;
}

Page({
  data: {
    // 页面整体状态：loading / success / error
    pageState: PageState.LOADING,
    // 商品信息
    product: null as Product | null,
    // 商品图：优先后台配置 brandIcon，兜底顺势图片
    productIcon: '',
    // 动态表单模板
    attachTemplate: [] as AttachTemplate[],

    // —— 会员类型 ——
    // 去重后的会员类型列表（顺序保留套餐定义顺序）
    memberTypes: [] as string[],
    // 当前选中会员类型
    activeMemberType: '',

    // —— 套餐 ——
    // 当前会员类型下的可选套餐（含待配置套餐，展示但禁购）
    visiblePackages: [] as DisplayPackage[],
    // 当前选中套餐 ID
    selectedPackageId: '',
    // 当前选中套餐对象
    selectedPackage: null as Package | null,
    // 底部支付栏合计金额（元，展示用）
    amountText: '0.00',

    // —— 动态表单 ——
    // 当前表单值
    formValues: {} as Record<string, any>,
    // 表单是否完整（联动购买按钮禁用态）
    formComplete: false,
    // 接口未返回 attach 模板时，默认走手机号直充输入
    fallbackPhone: '',
    fallbackPhoneValid: false,

    // —— 购买核对弹窗 ——
    // 弹窗是否可见
    dialogVisible: false,
    // 确认按钮 loading（防重复下单）
    confirmLoading: false,
    // 弹窗展示：充值账号原文（组件内部脱敏）
    dialogAccount: '',
    // 弹窗展示：安全套餐名称，避免未选中时传 null 给组件
    dialogPackageName: '',
    // 弹窗展示：安全金额，避免未选中时传非数字给组件
    dialogAmount: 0,

    // 主题色（供 wxml 内联使用）
    primaryColor: '#c99a3a'
  },

  // 商品 ID 与「再买一次」预选套餐 ID（不参与渲染）
  _productId: '',
  _rebuyPackageId: '',

  onLoad(this: any, options: { productId?: string; packageId?: string }) {
    this._productId = (options && options.productId) || '';
    // 「再买一次」携带 packageId，加载后自动选中相同套餐（Req 7.6）
    this._rebuyPackageId = (options && options.packageId) || '';
    if (!this._productId) {
      this.setData({ pageState: PageState.ERROR });
      return;
    }
    this.loadDetail();
  },

  /**
   * 加载商品详情（Req 2.1）
   * 失败时展示异常态，重试时保留已填写表单数据（Req 16.4）。
   * @param keepForm 是否保留当前表单值（重试 / 价格刷新场景）
   */
  async loadDetail(this: any, keepForm: boolean = false) {
    const res = await requestSilent<{ product: Product; packages: Package[] }>({
      name: 'product',
      action: 'getDetail',
      data: { productId: this._productId }
    });

    if (!res.success || !res.data || !res.data.product) {
      this.setData({ pageState: PageState.ERROR });
      return;
    }

    const product = res.data.product;
    const packages = res.data.packages || product.packages || [];

    // 会员类型去重（保留套餐定义顺序）
    const memberTypes: string[] = [];
    packages.forEach((p) => {
      const t = p.memberType || '默认';
      if (memberTypes.indexOf(t) < 0) memberTypes.push(t);
    });

    // 设置导航栏标题为商品名
    if (product.name) {
      wx.setNavigationBarTitle({ title: product.name });
    }

    this.setData(
      {
        pageState: PageState.SUCCESS,
        product,
        productIcon: pickRenderableImageUrl(product.brandIcon, product.shunshiImg),
        attachTemplate: product.attachTemplate || [],
        memberTypes
      },
      () => {
        // 初始化会员类型与套餐选择
        this.initSelection(packages, keepForm);
      }
    );

    // 缓存全部上架套餐到实例，供切换会员类型时筛选
    this._allPackages = packages;
  },

  /**
   * 初始化 / 刷新选中状态
   * 优先选中「再买一次」携带的套餐，其次默认套餐，再次首个套餐。
   */
  initSelection(this: any, packages: Package[], keepForm: boolean) {
    let target: Package | undefined;

    // 1. 再买一次预选
    if (this._rebuyPackageId) {
      target = packages.find((p) => p.packageId === this._rebuyPackageId);
    }
    // 2. 默认套餐
    if (!target) target = packages.find((p) => p.isDefault);
    // 3. 首个套餐
    if (!target) target = packages[0];

    const activeMemberType = target ? target.memberType || '默认' : '';

    this.refreshMemberType(activeMemberType, target ? target.packageId : '');

    // 非保留场景重置表单
    if (!keepForm) {
      this.setData({ formValues: {}, formComplete: false, fallbackPhone: '', fallbackPhoneValid: false });
    }
  },

  /**
   * 切换会员类型：刷新该类型下的套餐列表与价格（Req 2.2）
   */
  onMemberTypeTap(this: any, e: any) {
    const type = e.currentTarget.dataset.type;
    if (!type || type === this.data.activeMemberType) return;
    this.refreshMemberType(type, '');
  },

  /**
   * 刷新指定会员类型下的可选套餐，并选中目标套餐（或默认/首个）
   * @param memberType 会员类型
   * @param preferPackageId 优先选中的套餐 ID（为空则取默认/首个）
   */
  refreshMemberType(this: any, memberType: string, preferPackageId: string) {
    const all: Package[] = this._allPackages || [];
    const visiblePackages = all
      .filter((p) => (p.memberType || '默认') === memberType)
      .map((p) => this.toDisplayPackage(p));

    let selected: Package | undefined;
    if (preferPackageId) {
      selected = visiblePackages.find((p) => p.packageId === preferPackageId);
    }
    if (!selected) selected = visiblePackages.find((p) => p.isDefault);
    if (!selected) selected = visiblePackages[0];

    this.setData({
      activeMemberType: memberType,
      visiblePackages,
      selectedPackageId: selected ? selected.packageId : '',
      selectedPackage: selected || null,
      dialogPackageName: selected ? selected.name || '' : '',
      dialogAmount: selected && Number(selected.price) > 0 ? Number(selected.price) : 0,
      amountText: selected && selected.online && selected.price > 0 ? formatPrice(selected.price) : '待配置'
    });
  },

  /**
   * 选择套餐：同步底部支付栏合计金额（Req 2.3）
   */
  onPackageTap(this: any, e: any) {
    const packageId = e.currentTarget.dataset.id;
    if (!packageId || packageId === this.data.selectedPackageId) return;
    const selected = (this.data.visiblePackages as DisplayPackage[]).find(
      (p) => p.packageId === packageId
    );
    if (!selected) return;
    this.setData({
      selectedPackageId: packageId,
      selectedPackage: selected,
      dialogPackageName: selected.name || '',
      dialogAmount: selected.online && Number(selected.price) > 0 ? Number(selected.price) : 0,
      amountText: selected.online && selected.price > 0 ? formatPrice(selected.price) : '待配置'
    });
  },

  /**
   * 动态表单值变更：同步表单值（Req 2.4/2.5）
   */
  onFormChange(this: any, e: any) {
    const detail = e.detail || {};
    this.setData({
      formValues: detail.values || {},
      formComplete: !!detail.complete
    });
  },

  /**
   * 动态表单完整性变更：联动购买按钮禁用态（Req 2.6）
   */
  onFormStatusChange(this: any, e: any) {
    this.setData({ formComplete: !!(e.detail && e.detail.complete) });
  },

  onFallbackPhoneInput(this: any, e: any) {
    const value = String((e.detail && e.detail.value) || '').replace(/\D/g, '').slice(0, 11);
    this.setData({
      fallbackPhone: value,
      fallbackPhoneValid: isValidPhone(value),
      formValues: { ...this.data.formValues, phone: value }
    });
  },

  /**
   * 从表单值中提取充值账号（用于核对弹窗脱敏展示）
   * 优先取手机号字段，其次首个 text 字段。
   */
  extractAccount(this: any): string {
    const template: AttachTemplate[] = this.data.attachTemplate || [];
    const values: Record<string, any> = this.data.formValues || {};
    if (template.length === 0 && this.data.fallbackPhone) {
      return String(this.data.fallbackPhone);
    }

    // 优先手机号字段
    const phoneField = template.find(
      (f) =>
        f.type === 'text' &&
        ((f.tip || '').indexOf('手机号') >= 0 ||
          (f.label || '').indexOf('手机号') >= 0)
    );
    if (phoneField && values[phoneField.key]) {
      return String(values[phoneField.key]);
    }

    // 退化：首个 text 字段
    const textField = template.find((f) => f.type === 'text');
    if (textField && values[textField.key]) {
      return String(values[textField.key]);
    }
    return '';
  },

  toDisplayPackage(this: any, pkg: Package): DisplayPackage {
    const pricePending = !pkg.online || pkg.price <= 0;
    return {
      ...pkg,
      pricePending,
      priceText: pricePending ? '待配置' : formatPrice(pkg.price),
      faceValueText: pkg.faceValue ? formatPrice(pkg.faceValue) : ''
    };
  },

  /**
   * 点击购买：校验表单 → 价格一致性校验 → 弹出购买核对弹窗（Req 3.1/3.2）
   */
  async onBuyTap(this: any) {
    const pkg: Package | null = this.data.selectedPackage;
    if (!pkg) {
      wx.showToast({ title: '请选择套餐', icon: 'none' });
      return;
    }
    if (!pkg.online || pkg.price <= 0) {
      wx.showToast({ title: '商品正在配置中，暂不可购买', icon: 'none' });
      return;
    }

    // 校验动态表单（手机号格式等），不通过则提示并阻止（Req 16.5）
    const form: any = this.selectComponent('#dynamicForm');
    if (form) {
      const result = form.validate();
      if (!result.valid || !result.complete) {
        wx.showToast({ title: '请完整填写开通信息', icon: 'none' });
        return;
      }
      this.setData({ formValues: result.values });
    } else if (!this.data.fallbackPhoneValid) {
      wx.showToast({ title: '请输入11位手机号', icon: 'none' });
      return;
    } else {
      this.setData({ formValues: { phone: this.data.fallbackPhone } });
    }

    // 价格一致性校验（Req 3.2/3.3）：重新拉取详情比对当前套餐价格
    const fresh = await requestSilent<{ product: Product; packages: Package[] }>({
      name: 'product',
      action: 'getDetail',
      data: { productId: this._productId }
    });
    if (fresh.success && fresh.data) {
      const latest = (fresh.data.packages || []).find(
        (p) => p.packageId === pkg.packageId
      );
      // 套餐下架或价格变更：提示重新选择并刷新页面（保留表单）
      if (!latest || !latest.online || latest.price <= 0 || latest.price !== pkg.price) {
        wx.showToast({ title: '套餐价格已变更，请重新选择', icon: 'none' });
        this.loadDetail(true);
        return;
      }
    }

    // 打开核对弹窗（Req 3.1）
    this.setData({
      dialogAccount: this.extractAccount(),
      dialogPackageName: pkg.name || '',
      dialogAmount: Number(pkg.price) || 0,
      dialogVisible: true
    });
  },

  /**
   * 取消核对：关闭弹窗，保留已填写信息（Req 3.6）
   */
  onDialogCancel(this: any) {
    if (this.data.confirmLoading) return;
    this.setData({ dialogVisible: false });
  },

  /**
   * 确认支付：下单 → 统一下单 → 唤起微信支付（Req 3.4）
   * 成功跳转支付结果页（Req 3.5）；取消/失败保留弹窗与数据（Req 3.6）。
   */
  async onConfirmPay(this: any) {
    if (this.data.confirmLoading) return;
    const pkg: Package | null = this.data.selectedPackage;
    const product: Product | null = this.data.product;
    if (!pkg || !product) return;

    this.setData({ confirmLoading: true });

    try {
      // 1. 创建订单（锁定实付金额）
      const createRes = await requestSilent<{ orderId: string }>({
        name: 'order',
        action: 'create',
        data: {
          productId: product.productId,
          packageId: pkg.packageId,
          attach: this.data.formValues
        }
      });
      if (!createRes.success || !createRes.data) {
        this.handleOrderError(createRes.errCode, createRes.errMsg);
        return;
      }
      const orderId = createRes.data.orderId;

      // 2. 统一下单（含价格一致性校验，价格变更返回 PRICE_CHANGED）
      const payRes = await requestSilent<{ payParams: PayParams }>({
        name: 'payment',
        action: 'unifiedOrder',
        data: { orderId }
      });
      if (!payRes.success || !payRes.data) {
        this.handleOrderError(payRes.errCode, payRes.errMsg);
        return;
      }

      // 3. 唤起微信支付（Mock 模式下跳过，后端已直接模拟开通成功）
      const payData = payRes.data as any;
      if (!payData.mock) {
        const payParams = payData.payParams;
        await this.requestPayment(payParams);
      }

      // 4. 支付成功：跳转支付结果页（Req 3.5）
      this.setData({ confirmLoading: false, dialogVisible: false });
      wx.redirectTo({ url: `/pages/pay-result/pay-result?orderId=${orderId}` });
    } catch (err: any) {
      // 用户取消或支付失败：保留弹窗与已填写信息（Req 3.6）
      this.setData({ confirmLoading: false });
      const msg = err && err.errMsg ? String(err.errMsg) : '';
      if (msg.indexOf('cancel') >= 0) {
        wx.showToast({ title: '已取消支付', icon: 'none' });
      } else {
        wx.showToast({ title: '支付未完成，可重试', icon: 'none' });
      }
    }
  },

  /**
   * 唤起微信支付（Promise 封装）
   */
  requestPayment(this: any, payParams: PayParams): Promise<void> {
    return new Promise((resolve, reject) => {
      wx.requestPayment({
        timeStamp: payParams.timeStamp,
        nonceStr: payParams.nonceStr,
        package: payParams.package,
        signType: payParams.signType,
        paySign: payParams.paySign,
        success: () => resolve(),
        fail: (err) => reject(err)
      });
    });
  },

  /**
   * 下单 / 统一下单错误处理
   * PRICE_CHANGED：关闭弹窗，提示重选，刷新详情（保留表单）（Req 3.3）。
   * 其余错误：关闭 loading，弹窗保留供重试。
   */
  handleOrderError(this: any, errCode?: string, errMsg?: string) {
    this.setData({ confirmLoading: false });
    if (errCode === 'PRICE_CHANGED') {
      this.setData({ dialogVisible: false });
      wx.showToast({ title: '套餐价格已变更，请重新选择', icon: 'none' });
      this.loadDetail(true);
      return;
    }
    if (errCode === 'PRODUCT_OFFLINE' || errCode === 'PACKAGE_OFFLINE') {
      this.setData({ dialogVisible: false });
      wx.showToast({ title: errMsg || '商品已下架', icon: 'none' });
      this.loadDetail(true);
      return;
    }
    // 其余错误：保留弹窗，提示重试
    wx.showToast({ title: errMsg || '下单失败，请重试', icon: 'none' });
  },

  /**
   * 异常态点击重试：重新加载详情（保留表单数据，Req 16.4）
   */
  onRetry(this: any) {
    this.setData({ pageState: PageState.LOADING });
    this.loadDetail(true);
  }
});
