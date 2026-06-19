// 前端表单校验工具函数

import { AttachTemplate } from './types';

/**
 * 校验手机号格式
 * 规则：1开头，第2位为3-9，共11位数字
 * @param str - 手机号字符串
 */
export function isValidPhone(str: string): boolean {
  if (!str) return false;
  return /^1[3-9]\d{9}$/.test(str);
}

/**
 * 校验表单是否完整
 * 根据 AttachTemplate 模板检查所有必填字段是否已填写
 * @param template - 表单模板配置
 * @param values - 当前表单值
 * @returns 所有必填字段是否都已填写非空值
 */
export function isFormComplete(
  template: AttachTemplate[],
  values: Record<string, any>
): boolean {
  if (!template || template.length === 0) return true;

  return template.every((field) => {
    // 非必填字段跳过
    if (!field.required) return true;

    const value = values[field.key];

    // 未填写
    if (value === undefined || value === null) return false;

    // 字符串类型检查空值
    if (typeof value === 'string') {
      return value.trim().length > 0;
    }

    // 数组类型（checkbox/cascader）检查空数组
    if (Array.isArray(value)) {
      return value.length > 0;
    }

    return true;
  });
}

/**
 * 校验手机号字段
 * 判断模板中是否含手机号相关字段，若有则做格式校验
 * @param template - 表单模板配置
 * @param values - 当前表单值
 * @returns 所有手机号字段是否格式正确
 */
export function validatePhoneFields(
  template: AttachTemplate[],
  values: Record<string, any>
): boolean {
  const phoneFields = template.filter(
    (field) =>
      field.type === 'text' &&
      (field.tip?.includes('手机号') || field.label.includes('手机号'))
  );

  if (phoneFields.length === 0) return true;

  return phoneFields.every((field) => {
    const value = values[field.key];
    if (!value && !field.required) return true;
    if (!value && field.required) return false;
    return isValidPhone(value);
  });
}
