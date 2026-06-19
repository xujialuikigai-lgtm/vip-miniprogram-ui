// 校验工具函数

import { Product, AttachTemplate } from '../types/product';

/**
 * 校验是否为合法的大陆手机号
 * 规则：以1开头，第二位为3-9，后接9位数字，共11位
 */
export function isValidPhone(str: string): boolean {
  return /^1[3-9]\d{9}$/.test(str);
}

/**
 * 检查表单是否完整（所有必填字段都有非空值）
 * @param template - AttachTemplate 数组，定义表单字段
 * @param values - 用户填写的表单值，key 为字段 key，value 为填写内容
 * @returns 当所有必填字段都有非空值时返回 true
 */
export function isFormComplete(
  template: AttachTemplate[],
  values: Record<string, string>
): boolean {
  return template
    .filter((field) => field.required)
    .every((field) => {
      const value = values[field.key];
      return value !== undefined && value !== null && value.toString().trim() !== '';
    });
}

/**
 * 商品编辑表单完整性校验
 * 校验规则：
 * - 商品名非空
 * - categoryId 非空
 * - packages 至少有1个
 * - 至少有一个 package 的 isDefault 为 true
 * - 每个 package 的 price > 0
 */
export function validateProductForm(product: Partial<Product>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // 商品名非空
  if (!product.name || product.name.trim() === '') {
    errors.push('商品名称不能为空');
  }

  // categoryId 非空
  if (!product.categoryId || product.categoryId.trim() === '') {
    errors.push('商品分类不能为空');
  }

  // packages 至少有1个
  if (!product.packages || product.packages.length === 0) {
    errors.push('至少需要一个套餐');
  } else {
    // 至少有一个 package 的 isDefault 为 true
    const hasDefault = product.packages.some((pkg) => pkg.isDefault === true);
    if (!hasDefault) {
      errors.push('至少需要指定一个默认套餐');
    }

    // 每个 package 的 price > 0
    const invalidPrice = product.packages.some((pkg) => pkg.price <= 0);
    if (invalidPrice) {
      errors.push('每个套餐的售价必须大于0');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
