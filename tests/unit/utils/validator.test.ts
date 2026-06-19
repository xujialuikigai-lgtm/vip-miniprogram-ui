import { isValidPhone, isFormComplete, validateProductForm } from '../../../cloudfunctions/shared/utils/validator';
import { AttachTemplate, Package } from '../../../cloudfunctions/shared/types/product';

describe('isValidPhone - 手机号格式校验', () => {
  test('合法手机号应返回 true', () => {
    expect(isValidPhone('13800138000')).toBe(true);
    expect(isValidPhone('15912345678')).toBe(true);
    expect(isValidPhone('18600001111')).toBe(true);
    expect(isValidPhone('19999999999')).toBe(true);
  });

  test('以1开头但第二位为0/1/2应返回 false', () => {
    expect(isValidPhone('10800138000')).toBe(false);
    expect(isValidPhone('11800138000')).toBe(false);
    expect(isValidPhone('12800138000')).toBe(false);
  });

  test('非11位应返回 false', () => {
    expect(isValidPhone('1380013800')).toBe(false);   // 10位
    expect(isValidPhone('138001380001')).toBe(false);  // 12位
    expect(isValidPhone('')).toBe(false);
  });

  test('包含非数字字符应返回 false', () => {
    expect(isValidPhone('1380013800a')).toBe(false);
    expect(isValidPhone('138-0013800')).toBe(false);
    expect(isValidPhone('138 0013800')).toBe(false);
  });

  test('不以1开头应返回 false', () => {
    expect(isValidPhone('23800138000')).toBe(false);
    expect(isValidPhone('03800138000')).toBe(false);
  });
});

describe('isFormComplete - 表单完整性校验', () => {
  const template: AttachTemplate[] = [
    { key: 'phone', type: 'text', label: '手机号', required: true },
    { key: 'region', type: 'select', label: '地区', required: true },
    { key: 'remark', type: 'text', label: '备注', required: false },
  ];

  test('所有必填字段都有值时应返回 true', () => {
    const values = { phone: '13800138000', region: 'beijing', remark: '' };
    expect(isFormComplete(template, values)).toBe(true);
  });

  test('必填字段为空字符串时应返回 false', () => {
    const values = { phone: '', region: 'beijing' };
    expect(isFormComplete(template, values)).toBe(false);
  });

  test('必填字段只有空格时应返回 false', () => {
    const values = { phone: '   ', region: 'beijing' };
    expect(isFormComplete(template, values)).toBe(false);
  });

  test('必填字段缺失时应返回 false', () => {
    const values = { phone: '13800138000' };
    expect(isFormComplete(template, values)).toBe(false);
  });

  test('没有必填字段时应返回 true', () => {
    const optionalTemplate: AttachTemplate[] = [
      { key: 'remark', type: 'text', label: '备注', required: false },
    ];
    expect(isFormComplete(optionalTemplate, {})).toBe(true);
  });

  test('空模板时应返回 true', () => {
    expect(isFormComplete([], {})).toBe(true);
  });
});

describe('validateProductForm - 商品编辑表单校验', () => {
  const validPackage: Package = {
    packageId: 'pkg1',
    name: '月卡',
    memberType: '黄金VIP',
    price: 1500,
    costPrice: 1000,
    faceValue: 3000,
    shunshiGoodsId: 12345,
    stock: -1,
    online: true,
    isDefault: true,
    sortWeight: 0,
  };

  test('完整有效的商品应通过校验', () => {
    const result = validateProductForm({
      name: '爱奇艺会员',
      categoryId: 'cat_video',
      packages: [validPackage],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('商品名为空应校验失败', () => {
    const result = validateProductForm({
      name: '',
      categoryId: 'cat_video',
      packages: [validPackage],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('商品名称不能为空');
  });

  test('商品名只有空格应校验失败', () => {
    const result = validateProductForm({
      name: '   ',
      categoryId: 'cat_video',
      packages: [validPackage],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('商品名称不能为空');
  });

  test('categoryId 为空应校验失败', () => {
    const result = validateProductForm({
      name: '爱奇艺会员',
      categoryId: '',
      packages: [validPackage],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('商品分类不能为空');
  });

  test('packages 为空数组应校验失败', () => {
    const result = validateProductForm({
      name: '爱奇艺会员',
      categoryId: 'cat_video',
      packages: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('至少需要一个套餐');
  });

  test('没有默认套餐应校验失败', () => {
    const result = validateProductForm({
      name: '爱奇艺会员',
      categoryId: 'cat_video',
      packages: [{ ...validPackage, isDefault: false }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('至少需要指定一个默认套餐');
  });

  test('套餐价格为0应校验失败', () => {
    const result = validateProductForm({
      name: '爱奇艺会员',
      categoryId: 'cat_video',
      packages: [{ ...validPackage, price: 0 }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('每个套餐的售价必须大于0');
  });

  test('套餐价格为负数应校验失败', () => {
    const result = validateProductForm({
      name: '爱奇艺会员',
      categoryId: 'cat_video',
      packages: [{ ...validPackage, price: -100 }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('每个套餐的售价必须大于0');
  });

  test('多个错误应全部返回', () => {
    const result = validateProductForm({
      name: '',
      categoryId: '',
      packages: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});
