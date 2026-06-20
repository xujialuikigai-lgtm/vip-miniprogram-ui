// 管理端 - 商品编辑页
// 功能：基础信息表单（商品名30字 / 分类 / 充值方式 / 账号类型 / 接口商品ID / 自动开通 / 排序权重）、
//       套餐价格列表（新增 / 改价，含售价、成本、接口SKU、库存、上架、默认套餐）、
//       售前规则编辑（设备支持 / 到账时间 / 安全说明，新增时提供默认模板）、
//       保存（前端必填校验 + 改价二次确认 + 亏损二次确认 → admin.productSave）、
//       预览商品（用户视角）。
// 数据来源：product.getDetail（编辑加载详情）、product.getCategories（分类下拉）、admin.productSave（保存）
// Requirements: 9.5, 9.6, 9.7, 9.9, 24.1-24.8

import { requestSilent } from '../../../utils/request';
import { PageState, Category } from '../../../utils/types';
import { PRIMARY_COLOR } from '../../../utils/constants';

/** 商品名最大长度（与后端 PRODUCT_NAME_MAX_LENGTH 对齐） */
const PRODUCT_NAME_MAX_LENGTH = 30;
/** 排序权重范围 */
const SORT_WEIGHT_MIN = 0;
const SORT_WEIGHT_MAX = 9999;
/** 充值方式可选项（Req 24.2） */
const RECHARGE_METHODS = ['手机号直充', '账号密码', '卡密', '其他'];

/** 售前规则默认模板（首次创建提供，Req 24.5） */
const DEFAULT_RULES = {
  deviceSupport: '支持手机、电脑、平板、电视等多端使用，具体以官方平台为准。',
  arrivalTime: '支付成功后系统自动开通，通常 1-5 分钟到账，高峰期可能略有延迟。',
  safetyNote: '官方直充渠道，安全可靠；若开通失败将原路全额退款，请放心购买。'
};

/** 套餐编辑模型（含后端所需 shunshiGoodsId 接口SKU 字段） */
interface EditPackage {
  packageId: string;
  name: string;
  memberType: string;
  price: number;
  costPrice: number;
  faceValue: number;
  shunshiGoodsId: number;
  stock: number;
  online: boolean;
  isDefault: boolean;
  sortWeight: number;
}

Page({
  data: {
    // 页面状态
    pageState: PageState.LOADING,
    // 是否编辑模式（false 为新增）
    isEdit: false,
    // 保存中（防重复提交）
    saving: false,

    // —— 基础信息 ——
    name: '',
    categoryId: '',
    categoryName: '',
    rechargeMethod: '',
    accountType: '',
    // 接口商品ID（产品级，对应 Shunshi 商品ID）
    shunshiGoodsId: '' as string,
    autoActivate: true,
    online: false,
    sortWeight: '0' as string,

    // —— 分类下拉 ——
    categories: [] as Category[],
    categoryPickerVisible: false,

    // —— 充值方式下拉 ——
    rechargeMethods: RECHARGE_METHODS,
    rechargePickerVisible: false,

    // —— 套餐列表（含展示用价格文案） ——
    packages: [] as Array<EditPackage & { priceText: string; costText: string }>,

    // —— 套餐编辑弹窗 ——
    packagePopupVisible: false,
    // 当前编辑的套餐下标（-1 表示新增）
    editingIndex: -1,
    packageForm: {
      packageId: '',
      name: '',
      memberType: '',
      price: '' as string,
      costPrice: '' as string,
      shunshiGoodsId: '' as string,
      stock: '-1' as string,
      online: true,
      isDefault: false
    },

    // —— 售前规则 ——
    rules: { deviceSupport: '', arrivalTime: '', safetyNote: '' },

    // 商品名最大长度（供 wxml 计数提示）
    nameMaxLength: PRODUCT_NAME_MAX_LENGTH,
    // 主题色
    primaryColor: PRIMARY_COLOR
  },

  // —— 实例字段（不参与渲染） ——
  // 商品ID（编辑模式有值，新增为空）
  _productId: '',
  // 加载的原始商品（保留 attachTemplate / tags / brandIcon 等未编辑字段）
  _rawProduct: null as any,
  // 原始套餐快照（用于改价检测）
  _originalPackages: [] as EditPackage[],

  /**
   * 页面加载：正确使用 options.productId（新增时可为空，Req 24.1）
   */
  onLoad(this: any, options: { productId?: string }) {
    this._productId = (options && options.productId) || '';
    const isEdit = !!this._productId;
    this.setData({ isEdit });

    // 先加载分类下拉，再按模式加载详情 / 初始化新增
    this.loadCategories().then(() => {
      if (isEdit) {
        this.loadDetail();
      } else {
        this.initNew();
      }
    });
  },

  /**
   * 加载分类列表（供下拉选择，Req 24.2）
   */
  async loadCategories(this: any) {
    const res = await requestSilent<{ categories: Category[] }>({
      name: 'product',
      action: 'getCategories'
    });
    if (res.success && res.data) {
      this.setData({ categories: res.data.categories || [] });
    }
  },

  /**
   * 新增模式初始化：填充默认售前规则模板
   */
  initNew(this: any) {
    wx.setNavigationBarTitle({ title: '新增商品' });
    this.setData({
      pageState: PageState.SUCCESS,
      rules: { ...DEFAULT_RULES }
    });
  },

  /**
   * 编辑模式加载商品详情（Req 24.1）
   */
  async loadDetail(this: any) {
    const res = await requestSilent<{ product: any; packages: EditPackage[] }>({
      name: 'product',
      action: 'getDetail',
      data: { productId: this._productId }
    });

    if (!res.success || !res.data || !res.data.product) {
      this.setData({ pageState: PageState.ERROR });
      return;
    }

    const product = res.data.product;
    this._rawProduct = product;
    const packages: EditPackage[] = (res.data.packages || product.packages || []).map(
      (p: any) => this.normalizePackage(p)
    );
    // 保存原始套餐快照（深拷贝）用于改价检测
    this._originalPackages = packages.map((p) => ({ ...p }));

    // 售前规则：缺省时回填默认模板
    const rules = product.rules || {};

    if (product.name) {
      wx.setNavigationBarTitle({ title: product.name });
    }

    this.setData({
      pageState: PageState.SUCCESS,
      name: product.name || '',
      categoryId: product.categoryId || '',
      categoryName: product.categoryName || '',
      rechargeMethod: product.rechargeMethod || '',
      accountType: product.accountType || '',
      shunshiGoodsId: product.shunshiGoodsId ? String(product.shunshiGoodsId) : '',
      autoActivate: product.autoActivate !== false,
      online: !!product.online,
      sortWeight: String(product.sortWeight || 0),
      packages: packages.map((p) => this.decoratePackage(p)),
      rules: {
        deviceSupport: rules.deviceSupport || '',
        arrivalTime: rules.arrivalTime || '',
        safetyNote: rules.safetyNote || ''
      }
    });
  },

  /** 规整后端套餐为编辑模型（补齐字段） */
  normalizePackage(this: any, p: any): EditPackage {
    return {
      packageId: p.packageId || '',
      name: p.name || '',
      memberType: p.memberType || '',
      price: Number(p.price) || 0,
      costPrice: Number(p.costPrice) || 0,
      faceValue: Number(p.faceValue) || 0,
      shunshiGoodsId: Number(p.shunshiGoodsId) || 0,
      stock: p.stock === undefined ? -1 : Number(p.stock),
      online: p.online !== false,
      isDefault: !!p.isDefault,
      sortWeight: Number(p.sortWeight) || 0
    };
  },

  /** 为套餐附加展示用价格文案 */
  decoratePackage(this: any, p: EditPackage): EditPackage & { priceText: string; costText: string } {
    return {
      ...p,
      priceText: p.price.toFixed(2),
      costText: p.costPrice.toFixed(2)
    };
  },

  /* ============================================================
   * 基础信息表单事件
   * ============================================================ */

  onNameInput(this: any, e: any) {
    this.setData({ name: (e.detail.value || '').slice(0, PRODUCT_NAME_MAX_LENGTH) });
  },

  onAccountTypeInput(this: any, e: any) {
    this.setData({ accountType: e.detail.value || '' });
  },

  onShunshiGoodsIdInput(this: any, e: any) {
    this.setData({ shunshiGoodsId: e.detail.value || '' });
  },

  onSortWeightInput(this: any, e: any) {
    this.setData({ sortWeight: e.detail.value || '' });
  },

  onAutoActivateChange(this: any, e: any) {
    this.setData({ autoActivate: !!e.detail.value });
  },

  onOnlineChange(this: any, e: any) {
    this.setData({ online: !!e.detail.value });
  },

  // —— 分类下拉 ——
  openCategoryPicker(this: any) {
    this.setData({ categoryPickerVisible: true });
  },
  closeCategoryPicker(this: any) {
    this.setData({ categoryPickerVisible: false });
  },
  onCategorySelect(this: any, e: any) {
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name;
    this.setData({ categoryId: id, categoryName: name, categoryPickerVisible: false });
  },

  // —— 充值方式下拉 ——
  openRechargePicker(this: any) {
    this.setData({ rechargePickerVisible: true });
  },
  closeRechargePicker(this: any) {
    this.setData({ rechargePickerVisible: false });
  },
  onRechargeSelect(this: any, e: any) {
    const method = e.currentTarget.dataset.method;
    this.setData({ rechargeMethod: method, rechargePickerVisible: false });
  },

  // —— 售前规则 ——
  onDeviceSupportInput(this: any, e: any) {
    this.setData({ 'rules.deviceSupport': e.detail.value || '' });
  },
  onArrivalTimeInput(this: any, e: any) {
    this.setData({ 'rules.arrivalTime': e.detail.value || '' });
  },
  onSafetyNoteInput(this: any, e: any) {
    this.setData({ 'rules.safetyNote': e.detail.value || '' });
  },

  /* ============================================================
   * 套餐编辑
   * ============================================================ */

  /** 新增套餐：打开空白弹窗 */
  onAddPackage(this: any) {
    this.setData({
      editingIndex: -1,
      packagePopupVisible: true,
      packageForm: {
        packageId: '',
        name: '',
        memberType: '',
        price: '',
        costPrice: '',
        shunshiGoodsId: '',
        stock: '-1',
        online: true,
        // 无套餐时默认勾选为默认套餐
        isDefault: (this.data.packages || []).length === 0
      }
    });
  },

  /** 编辑/改价：打开已有套餐弹窗 */
  onEditPackage(this: any, e: any) {
    const index = e.currentTarget.dataset.index;
    const pkg: EditPackage = this.data.packages[index];
    this.setData({
      editingIndex: index,
      packagePopupVisible: true,
      packageForm: {
        packageId: pkg.packageId,
        name: pkg.name,
        memberType: pkg.memberType,
        price: String(pkg.price),
        costPrice: String(pkg.costPrice),
        shunshiGoodsId: pkg.shunshiGoodsId ? String(pkg.shunshiGoodsId) : '',
        stock: String(pkg.stock),
        online: pkg.online,
        isDefault: pkg.isDefault
      }
    });
  },

  closePackagePopup(this: any) {
    this.setData({ packagePopupVisible: false });
  },

  // 套餐弹窗字段事件
  onPkgNameInput(this: any, e: any) {
    this.setData({ 'packageForm.name': e.detail.value || '' });
  },
  onPkgMemberTypeInput(this: any, e: any) {
    this.setData({ 'packageForm.memberType': e.detail.value || '' });
  },
  onPkgPriceInput(this: any, e: any) {
    this.setData({ 'packageForm.price': e.detail.value || '' });
  },
  onPkgCostInput(this: any, e: any) {
    this.setData({ 'packageForm.costPrice': e.detail.value || '' });
  },
  onPkgSkuInput(this: any, e: any) {
    this.setData({ 'packageForm.shunshiGoodsId': e.detail.value || '' });
  },
  onPkgStockInput(this: any, e: any) {
    this.setData({ 'packageForm.stock': e.detail.value || '' });
  },
  onPkgOnlineChange(this: any, e: any) {
    this.setData({ 'packageForm.online': !!e.detail.value });
  },
  onPkgDefaultChange(this: any, e: any) {
    this.setData({ 'packageForm.isDefault': !!e.detail.value });
  },

  /** 删除套餐 */
  onDeletePackage(this: any, e: any) {
    const index = e.currentTarget.dataset.index;
    wx.showModal({
      title: '删除套餐',
      content: '确定删除该套餐吗？',
      confirmColor: PRIMARY_COLOR,
      success: (res) => {
        if (!res.confirm) return;
        const packages: EditPackage[] = this.data.packages.slice();
        packages.splice(index, 1);
        this.setData({ packages: packages.map((p) => this.decoratePackage(p)) });
      }
    });
  },

  /** 保存套餐弹窗 */
  onSavePackage(this: any) {
    const f = this.data.packageForm;
    const name = (f.name || '').trim();
    const price = Number(f.price);
    const costPrice = Number(f.costPrice);
    const shunshiGoodsId = Number(f.shunshiGoodsId);

    // 套餐弹窗必填校验（Req 24.4）
    if (!name) {
      wx.showToast({ title: '请填写套餐名', icon: 'none' });
      return;
    }
    if (!(f.memberType || '').trim()) {
      wx.showToast({ title: '请填写会员类型', icon: 'none' });
      return;
    }
    if (isNaN(price) || price < 0) {
      wx.showToast({ title: '售价不能小于0', icon: 'none' });
      return;
    }
    if (f.online && !(price > 0)) {
      wx.showToast({ title: '上架套餐售价需大于0', icon: 'none' });
      return;
    }
    if (isNaN(costPrice) || costPrice < 0) {
      wx.showToast({ title: '请填写正确成本价', icon: 'none' });
      return;
    }
    if (!(shunshiGoodsId > 0)) {
      wx.showToast({ title: '请填写接口SKU', icon: 'none' });
      return;
    }

    const stock = f.stock === '' ? -1 : Number(f.stock);
    const index = this.data.editingIndex;
    const existing: EditPackage | undefined = index >= 0 ? this.data.packages[index] : undefined;

    const pkg: EditPackage = {
      packageId: f.packageId || this.generatePackageId(),
      name,
      memberType: (f.memberType || '').trim(),
      price,
      costPrice,
      // 编辑时保留原 faceValue，新增默认0
      faceValue: existing ? existing.faceValue : 0,
      shunshiGoodsId,
      stock: isNaN(stock) ? -1 : stock,
      online: !!f.online,
      isDefault: !!f.isDefault,
      sortWeight: existing ? existing.sortWeight : 0
    };

    let packages: EditPackage[] = this.data.packages.map((p: any) => this.stripPackage(p));
    if (index >= 0) {
      packages[index] = pkg;
    } else {
      packages.push(pkg);
    }

    // 默认套餐互斥：当前设为默认则清除其他默认标记
    if (pkg.isDefault) {
      packages = packages.map((p, i) => ({
        ...p,
        isDefault: i === (index >= 0 ? index : packages.length - 1)
      }));
    }

    this.setData({
      packages: packages.map((p) => this.decoratePackage(p)),
      packagePopupVisible: false
    });
  },

  /** 去除展示用字段，还原为纯 EditPackage */
  stripPackage(this: any, p: any): EditPackage {
    return {
      packageId: p.packageId,
      name: p.name,
      memberType: p.memberType,
      price: p.price,
      costPrice: p.costPrice,
      faceValue: p.faceValue,
      shunshiGoodsId: p.shunshiGoodsId,
      stock: p.stock,
      online: p.online,
      isDefault: p.isDefault,
      sortWeight: p.sortWeight
    };
  },

  generatePackageId(this: any): string {
    return `pkg_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
  },

  /* ============================================================
   * 保存商品
   * ============================================================ */

  /**
   * 点击保存：前端必填校验 → 改价二次确认 → 亏损二次确认 → 调用 productSave
   * Req 24.6 / 24.8 / 9.9
   */
  async onSave(this: any) {
    if (this.data.saving) return;

    const packages: EditPackage[] = this.data.packages.map((p: any) => this.stripPackage(p));

    // 1. 前端必填校验（Req 24.6）
    const error = this.validateForm(packages);
    if (error) {
      wx.showToast({ title: error, icon: 'none' });
      return;
    }

    // 2. 改价确认（编辑模式且存在套餐价格变更，Req 24.8）
    if (this.data.isEdit && this.isPriceChanged(packages)) {
      const ok = await this.confirmModal(
        '改价提示',
        '新价格只影响后续订单；已支付订单仍按支付时锁定价格处理。是否继续保存？'
      );
      if (!ok) return;
    }

    // 3. 亏损确认（存在售价低于成本，Req 9.9）
    const hasLoss = packages.some((p) => p.price < p.costPrice);
    if (hasLoss) {
      const ok = await this.confirmModal('亏损警告', '存在套餐售价低于成本，将产生亏损，是否继续保存？');
      if (!ok) return;
    }

    await this.doSave(packages);
  },

  /** 前端必填校验，返回首个错误文案（无错误返回空串） */
  validateForm(this: any, packages: EditPackage[]): string {
    if (!this.data.name.trim()) return '请填写商品名称';
    if (this.data.name.trim().length > PRODUCT_NAME_MAX_LENGTH) {
      return `商品名称不能超过${PRODUCT_NAME_MAX_LENGTH}个字符`;
    }
    if (!this.data.categoryId) return '请选择商品分类';
    if (!(Number(this.data.shunshiGoodsId) > 0)) return '请填写接口商品ID';
    const weight = Number(this.data.sortWeight);
    if (isNaN(weight) || weight < SORT_WEIGHT_MIN || weight > SORT_WEIGHT_MAX) {
      return `排序权重需在${SORT_WEIGHT_MIN}-${SORT_WEIGHT_MAX}之间`;
    }
    if (packages.length === 0) return '至少需要配置一个套餐';
    if (!packages.some((p) => p.isDefault)) return '请指定一个默认套餐';
    if (packages.some((p) => p.online && !(p.price > 0))) return '上架套餐的售价必须大于0';
    if (this.data.online && !packages.some((p) => p.online && p.price > 0)) {
      return '商品上架前至少需要一个已上架且售价大于0的套餐';
    }
    return '';
  },

  /** 检测套餐价格是否相对原始快照发生变更 */
  isPriceChanged(this: any, packages: EditPackage[]): boolean {
    const originals: EditPackage[] = this._originalPackages || [];
    return packages.some((p) => {
      const origin = originals.find((o) => o.packageId === p.packageId);
      // 新增套餐不算改价；已有套餐价格变化则视为改价
      return origin ? origin.price !== p.price : false;
    });
  },

  /** Promise 化的二次确认弹窗 */
  confirmModal(this: any, title: string, content: string): Promise<boolean> {
    return new Promise((resolve) => {
      wx.showModal({
        title,
        content,
        confirmColor: PRIMARY_COLOR,
        success: (res) => resolve(!!res.confirm),
        fail: () => resolve(false)
      });
    });
  },

  /** 组装 payload 并调用 admin.productSave */
  async doSave(this: any, packages: EditPackage[]) {
    this.setData({ saving: true });

    // 合并原始商品未编辑字段（attachTemplate / tags / brandIcon 等），覆盖已编辑字段
    const base = this._rawProduct || {};
    const product: any = {
      ...base,
      name: this.data.name.trim(),
      categoryId: this.data.categoryId,
      categoryName: this.data.categoryName,
      rechargeMethod: this.data.rechargeMethod,
      accountType: this.data.accountType,
      shunshiGoodsId: Number(this.data.shunshiGoodsId) || 0,
      autoActivate: this.data.autoActivate,
      online: this.data.online,
      sortWeight: Number(this.data.sortWeight) || 0,
      packages,
      rules: this.data.rules
    };
    // 编辑模式带 productId；新增不带（后端自动生成）
    if (this._productId) {
      product.productId = this._productId;
    } else {
      delete product.productId;
    }
    // _id 由后端忽略，主动剔除避免误更新
    delete product._id;

    const res = await requestSilent<{ productId: string; isNew: boolean; warning?: string }>({
      name: 'admin',
      action: 'productSave',
      data: { product }
    });

    this.setData({ saving: false });

    if (!res.success) {
      // 无权限：提示并重定向首页（Req 12.4）
      if (
        res.errCode === 'NO_PERMISSION' ||
        res.errCode === 'MISSING_IDENTITY' ||
        res.errCode === 'AUTH_SYSTEM_ERROR'
      ) {
        wx.showToast({ title: res.errMsg || '无权限访问', icon: 'none' });
        setTimeout(() => wx.reLaunch({ url: '/pages/index/index' }), 1200);
        return;
      }
      wx.showToast({ title: res.errMsg || '保存失败，请重试', icon: 'none' });
      return;
    }

    // 后端亏损警告提示（不阻止保存，Req 9.9）
    if (res.data && res.data.warning) {
      wx.showToast({ title: res.data.warning, icon: 'none', duration: 2500 });
    }

    wx.showToast({ title: '保存成功', icon: 'success' });
    // 返回商品运营页（已保存数据，列表刷新由上级页面处理）
    setTimeout(() => wx.navigateBack(), res.data && res.data.warning ? 2000 : 800);
  },

  /**
   * 预览商品（用户视角，Req 24.7）
   * 仅对已保存商品有效；新增未保存时提示先保存。
   */
  onPreview(this: any) {
    if (!this._productId) {
      wx.showToast({ title: '请先保存后再预览', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: `/pages/detail/detail?productId=${this._productId}` });
  },

  /** 异常态重试 */
  onRetry(this: any) {
    this.setData({ pageState: PageState.LOADING });
    this.loadCategories().then(() => {
      if (this._productId) {
        this.loadDetail();
      } else {
        this.initNew();
      }
    });
  }
});
