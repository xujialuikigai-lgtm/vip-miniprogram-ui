// 动态表单组件 dynamic-form
// 根据商品的 AttachTemplate（字段配置数组）动态渲染表单项，
// 支持 text、select、radio、checkbox、cascader 五种输入类型；
// 实时校验必填项与手机号格式，并在每次值变更时向父级冒泡 change 事件，
// 在表单整体完整性（complete）状态变化时冒泡 statuschange 事件，
// 供页面联动控制购买按钮的禁用态。
// Requirements: 2.4, 2.5, 2.6
import { isValidPhone, isFormComplete, validatePhoneFields, } from '../../utils/validator';
/** 判断字段是否为手机号字段：text 类型且 tip 或 label 含「手机号」 */
function isPhoneField(field) {
    if (field.type !== 'text')
        return false;
    const tip = field.tip || '';
    const label = field.label || '';
    return tip.indexOf('手机号') >= 0 || label.indexOf('手机号') >= 0;
}
/** 将模板选项标准化为 { label, value } 数组 */
function normalizeOptions(field) {
    const options = field.options || [];
    return options.map((opt) => ({
        label: String(opt.label),
        value: String(opt.value),
    }));
}
Component({
    options: {
        // 允许使用全局样式（TDesign 主题变量）
        addGlobalClass: true,
        // 支持外部传入 class 控制布局
        styleIsolation: 'apply-shared',
    },
    properties: {
        // 顺势 API 返回的 attach 模板（字段配置数组）
        attachTemplate: {
            type: Array,
            value: [],
            observer() {
                this.rebuild();
            },
        },
        // 外部传入的初始表单值（再买一次 / 异常重试场景回填）
        formValues: {
            type: Object,
            value: {},
            observer() {
                this.rebuild();
            },
        },
    },
    data: {
        // 渲染用字段列表
        fields: [],
        // 当前表单值集合 { [key]: value }
        values: {},
        // 上一次的整体完整状态（用于判断 statuschange 是否需要触发）
        lastComplete: false,
        // —— select / cascader 弹窗状态 ——
        // select 弹窗是否可见
        pickerVisible: false,
        // select 弹窗标题
        pickerTitle: '',
        // select 弹窗选项
        pickerOptions: [],
        // select 弹窗当前选中值（数组形式，picker 要求）
        pickerValue: [],
        // 当前正在编辑的 select 字段 key
        pickerKey: '',
        // cascader 弹窗是否可见
        cascaderVisible: false,
        // cascader 弹窗选项
        cascaderOptions: [],
        // cascader 弹窗当前选中值
        cascaderValue: '',
        // 当前正在编辑的 cascader 字段 key
        cascaderKey: '',
    },
    lifetimes: {
        attached() {
            this.rebuild();
        },
    },
    methods: {
        /**
         * 依据模板与当前/外部值重建字段列表，并刷新校验状态
         */
        rebuild() {
            const template = this.data.attachTemplate || [];
            const external = this.properties.formValues || {};
            // 合并：已有内部值优先，其次外部传入值
            const prev = this.data.values || {};
            const values = {};
            template.forEach((field) => {
                const key = field.key;
                let val = prev[key];
                if (val === undefined)
                    val = external[key];
                if (val === undefined) {
                    // checkbox 默认空数组，其余默认空字符串
                    val = field.type === 'checkbox' ? [] : '';
                }
                values[key] = val;
            });
            this.setData({ values }, () => {
                this.refresh(false);
            });
        },
        /**
         * 根据当前 values 重新计算字段展示、校验错误与完整状态
         * @param emit 是否向父级冒泡 change 事件
         */
        refresh(emit = true) {
            const template = this.data.attachTemplate || [];
            const values = this.data.values || {};
            const fields = template.map((field) => {
                const options = normalizeOptions(field);
                const value = values[field.key];
                const phone = isPhoneField(field);
                // 计算选中项展示文案（select/cascader）
                let valueText = '';
                if ((field.type === 'select' || field.type === 'cascader') && value) {
                    const hit = options.filter((o) => o.value === value)[0];
                    valueText = hit ? hit.label : String(value);
                }
                return {
                    key: field.key,
                    type: field.type,
                    label: field.label,
                    tip: field.tip || '',
                    required: !!field.required,
                    isPhone: phone,
                    options,
                    value,
                    valueText,
                    error: this.computeError(field, value),
                };
            });
            // 完整性：所有必填项已填 且 手机号字段格式正确
            const complete = isFormComplete(template, values) &&
                validatePhoneFields(template, values);
            this.setData({ fields });
            // 完整状态变化时冒泡 statuschange，供页面联动按钮禁用态
            if (complete !== this.data.lastComplete) {
                this.setData({ lastComplete: complete });
                this.triggerEvent('statuschange', { complete });
            }
            if (emit) {
                const { valid, errors } = this.collectErrors(template, values);
                // 每次值变更冒泡 change，携带完整表单值与状态
                this.triggerEvent('change', {
                    values: Object.assign({}, values),
                    complete,
                    valid,
                    errors,
                });
            }
        },
        /**
         * 计算单个字段的错误文案
         * - 手机号字段：已填写但格式不符 → 红色提示
         * - 其余字段：不在输入阶段展示「必填」错误（由 complete 控制按钮禁用）
         */
        computeError(field, value) {
            if (isPhoneField(field)) {
                if (value && !isValidPhone(value)) {
                    return '请输入11位大陆手机号';
                }
            }
            return '';
        },
        /**
         * 汇总所有字段错误，返回 { valid, errors }
         */
        collectErrors(template, values) {
            const errors = {};
            template.forEach((field) => {
                const err = this.computeError(field, values[field.key]);
                if (err)
                    errors[field.key] = err;
            });
            return { valid: Object.keys(errors).length === 0, errors };
        },
        /**
         * 更新某字段的值并刷新
         */
        setValue(key, value) {
            const values = Object.assign(Object.assign({}, this.data.values), { [key]: value });
            this.setData({ values }, () => this.refresh(true));
        },
        /** text 输入变更 */
        onTextChange(e) {
            const key = e.currentTarget.dataset.key;
            this.setValue(key, e.detail.value);
        },
        /** radio 单选变更 */
        onRadioChange(e) {
            const key = e.currentTarget.dataset.key;
            this.setValue(key, e.detail.value);
        },
        /** checkbox 多选变更 */
        onCheckboxChange(e) {
            const key = e.currentTarget.dataset.key;
            this.setValue(key, e.detail.value);
        },
        /** 点击 select 单元格：打开选择器弹窗 */
        onSelectTap(e) {
            const key = e.currentTarget.dataset.key;
            const field = this.data.fields.filter((f) => f.key === key)[0];
            if (!field)
                return;
            this.setData({
                pickerVisible: true,
                pickerTitle: field.label,
                pickerOptions: field.options,
                pickerValue: field.value ? [field.value] : [],
                pickerKey: key,
            });
        },
        /** select 选择器确认 */
        onPickerConfirm(e) {
            const key = this.data.pickerKey;
            // picker 返回 value 为数组（每列一个值），单列取第一个
            const arr = e.detail.value || [];
            const val = arr.length ? arr[0] : '';
            this.setData({ pickerVisible: false });
            if (key)
                this.setValue(key, val);
        },
        /** select 选择器取消 */
        onPickerCancel() {
            this.setData({ pickerVisible: false });
        },
        /** 点击 cascader 单元格：打开级联选择器 */
        onCascaderTap(e) {
            const key = e.currentTarget.dataset.key;
            const field = this.data.fields.filter((f) => f.key === key)[0];
            if (!field)
                return;
            this.setData({
                cascaderVisible: true,
                cascaderOptions: field.options,
                cascaderValue: field.value || '',
                cascaderKey: key,
            });
        },
        /** cascader 选择变更（选满末级会回传） */
        onCascaderChange(e) {
            const key = this.data.cascaderKey;
            const val = e.detail.value;
            this.setData({ cascaderVisible: false });
            if (key)
                this.setValue(key, val);
        },
        /** cascader 可见状态变更（点击遮罩关闭） */
        onCascaderVisibleChange(e) {
            this.setData({ cascaderVisible: !!e.detail.visible });
        },
        /**
         * 对外暴露：主动校验整个表单
         * @returns { valid, complete, errors, values }
         */
        validate() {
            const template = this.data.attachTemplate || [];
            const values = this.data.values || {};
            const { valid, errors } = this.collectErrors(template, values);
            const complete = isFormComplete(template, values) &&
                validatePhoneFields(template, values);
            // 刷新一次以展示错误
            this.refresh(false);
            return { valid, complete, errors, values: Object.assign({}, values) };
        },
        /**
         * 对外暴露：获取当前表单值
         */
        getValues() {
            return Object.assign({}, this.data.values);
        },
    },
});
