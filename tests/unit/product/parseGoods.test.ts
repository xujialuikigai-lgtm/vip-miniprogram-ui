/**
 * 顺势商品名解析与品牌聚合 - 单元测试
 * 用例取自真实接口采样的视频会员商品名
 */
import {
  parseChannel,
  parsePeriod,
  parseMemberType,
  parseGoodsName,
  packageDedupKey,
  brandSlug,
  buildBrandProductId,
  dedupSkusToPackages,
  detectAccountType,
  pickVariantByAccount,
  isChannelSellable,
  isChannelExcluded,
  UNKNOWN_CHANNEL_PRIORITY
} from '../../../cloudfunctions/product/parseGoods';

describe('parseChannel 渠道与优先级', () => {
  it('识别常见渠道前缀', () => {
    expect(parseChannel('【零售直充】爱奇艺黄金会员『1个月』')).toEqual({ channel: '零售直充', priority: 1 });
    expect(parseChannel('【账号直充】小米影视VIP畅享会员『1个月+爱奇艺黄金VIP月卡』').priority).toBe(3);
    expect(parseChannel('【多多渠道】爱奇艺星钻VIP会员『1个月』').priority).toBe(5);
    expect(parseChannel('【淘淘渠道】爱奇艺星钻VIP会员『1个月』').priority).toBe(6);
    expect(parseChannel('【闲鱼渠道】爱奇艺星钻VIP会员『3个月』').priority).toBe(7);
    expect(parseChannel('【人工代充】爱奇艺黄金VIP会员 『7天』').priority).toBe(8);
  });

  it('未知/无前缀渠道兜底为最低优先级', () => {
    expect(parseChannel('爱奇艺黄金会员月卡').priority).toBe(UNKNOWN_CHANNEL_PRIORITY);
    expect(parseChannel('【某新渠道】爱奇艺黄金『月卡』').priority).toBe(UNKNOWN_CHANNEL_PRIORITY);
  });
});

describe('parsePeriod 周期规整', () => {
  it('『』内的周期归一化为标准档位', () => {
    expect(parsePeriod('爱奇艺黄金『7天』')).toEqual({ period: '7天', days: 7 });
    expect(parsePeriod('爱奇艺黄金『月卡』')).toEqual({ period: '1个月', days: 30 });
    expect(parsePeriod('爱奇艺黄金『季卡』')).toEqual({ period: '3个月', days: 90 });
    expect(parsePeriod('爱奇艺黄金『年卡』')).toEqual({ period: '12个月', days: 365 });
    expect(parsePeriod('爱奇艺黄金VIP会员 『1个月』')).toEqual({ period: '1个月', days: 30 });
    expect(parsePeriod('爱奇艺黄金VIP会员 『3个月』')).toEqual({ period: '3个月', days: 90 });
    expect(parsePeriod('爱奇艺黄金VIP会员 『6个月』')).toEqual({ period: '6个月', days: 180 });
    expect(parsePeriod('爱奇艺黄金VIP会员 『12个月』')).toEqual({ period: '12个月', days: 365 });
  });

  it('双年卡/半年 等优先于年卡/年匹配', () => {
    expect(parsePeriod('小米影视『24个月+爱奇艺黄金VIP双年卡』')).toEqual({ period: '24个月', days: 730 });
    expect(parsePeriod('小米影视『6个月+爱奇艺黄金VIP半年』')).toEqual({ period: '6个月', days: 180 });
  });

  it('N天/365天 等天数写法归一化到标准档', () => {
    expect(parsePeriod('优酷SVIP『365天』')).toEqual({ period: '12个月', days: 365 });
    expect(parsePeriod('某会员『180天』')).toEqual({ period: '6个月', days: 180 });
    expect(parsePeriod('某会员『90天』')).toEqual({ period: '3个月', days: 90 });
  });

  it('非标准天数保留为独立周期并按天数排序', () => {
    expect(parsePeriod('喜马拉雅『15天』')).toEqual({ period: '15天', days: 15 });
    expect(parsePeriod('优酷『5天』')).toEqual({ period: '5天', days: 5 });
  });

  it('无法规整时保留原文并排到最后', () => {
    const r = parsePeriod('爱奇艺黄金VIP会员 『学生会员-超长特殊档』');
    expect(r.days).toBe(9999);
    expect(r.period).toBe('学生会员-超长特殊档');
  });
});

describe('parseMemberType 会员档位', () => {
  it('识别爱奇艺三档', () => {
    expect(parseMemberType('【转单资源】爱奇艺星钻『月卡』')).toBe('星钻');
    expect(parseMemberType('【转单资源】爱奇艺白金『季卡』')).toBe('白金');
    expect(parseMemberType('【零售直充】爱奇艺黄金会员『7天』')).toBe('黄金');
  });

  it('识别 SVIP', () => {
    expect(parseMemberType('【转单资源】腾讯视频SVIP云视听手机号『月卡』')).toBe('SVIP');
  });

  it('只有普通会员字样时返回会员，不显示默认档位', () => {
    expect(parseMemberType('某不知名会员『月卡』')).toBe('会员');
  });
});

describe('parseGoodsName 综合解析', () => {
  it('完整解析一条真实商品名', () => {
    const r = parseGoodsName('【转单资源】爱奇艺星钻『季卡』支持抖音以及无任何限制30分钟不成功自动失败');
    expect(r).toEqual({
      channel: '转单资源',
      channelPriority: UNKNOWN_CHANNEL_PRIORITY,
      memberType: '星钻',
      period: '3个月',
      periodDays: 90,
      accountType: 'any'
    });
  });
});

describe('packageDedupKey / brandSlug / buildBrandProductId', () => {
  it('去重键按 会员类型+周期', () => {
    expect(packageDedupKey('星钻', '3个月')).toBe('星钻|3个月');
    expect(packageDedupKey('', '')).toBe('默认|其他');
  });

  it('brandSlug 保留中英文数字', () => {
    expect(brandSlug('腾讯视频')).toBe('腾讯视频');
    expect(brandSlug('芒果TV')).toBe('芒果TV');
    expect(brandSlug('爱奇艺 & 奇异果')).toBe('爱奇艺_奇异果');
  });

  it('buildBrandProductId 稳定可复现', () => {
    expect(buildBrandProductId('target_video', '爱奇艺')).toBe('brand_target_video_爱奇艺');
    expect(buildBrandProductId('target_video', '腾讯视频')).toBe('brand_target_video_腾讯视频');
  });
});

describe('dedupSkusToPackages 品牌SKU去重为套餐', () => {
  it('同档位同周期只保留优先级最高的渠道', () => {
    const skus = [
      { id: 101, goods_name: '【闲鱼渠道】爱奇艺星钻VIP会员『1个月』', goods_price: '20', face_value: '30', stock_num: 99 },
      { id: 102, goods_name: '【零售直充】爱奇艺星钻VIP会员『1个月』', goods_price: '18', face_value: '30', stock_num: 99 },
      { id: 103, goods_name: '【多多渠道】爱奇艺星钻VIP会员『1个月』', goods_price: '19', face_value: '30', stock_num: 99 }
    ];
    const pkgs = dedupSkusToPackages(skus);
    expect(pkgs).toHaveLength(1);
    expect(pkgs[0].shunshiGoodsId).toBe(102); // 零售直充 优先级最高
    expect(pkgs[0].memberType).toBe('星钻');
    expect(pkgs[0].period).toBe('1个月');
    expect(pkgs[0].costPrice).toBe(18);
    expect(pkgs[0].accountVariants).toEqual([]); // 未标注账号形式
  });

  it('多档位多周期分别成套餐，并按 类型→周期 排序', () => {
    const skus = [
      { id: 1, goods_name: '【零售直充】爱奇艺黄金『年卡』', goods_price: '100', face_value: '0', stock_num: 1 },
      { id: 2, goods_name: '【零售直充】爱奇艺黄金『月卡』', goods_price: '20', face_value: '0', stock_num: 1 },
      { id: 3, goods_name: '【零售直充】爱奇艺星钻『月卡』', goods_price: '30', face_value: '0', stock_num: 1 }
    ];
    const pkgs = dedupSkusToPackages(skus);
    expect(pkgs.map((p) => `${p.memberType}/${p.period}`)).toEqual([
      '黄金/1个月',
      '黄金/12个月',
      '星钻/1个月'
    ]);
  });

  it('普通 VIP/会员商品不会落到空档位', () => {
    const pkgs = dedupSkusToPackages([
      { id: 11, goods_name: '【零售直充】腾讯视频VIP会员『1个月』', goods_price: '20', face_value: '30', stock_num: 1 },
      { id: 12, goods_name: '【零售直充】腾讯视频会员『7天』', goods_price: '8', face_value: '10', stock_num: 1 }
    ]);

    expect(pkgs.map((p) => p.memberType)).toEqual(['VIP', '会员']);
  });

  it('手机号与QQ号合并为一个套餐，作为两个账号变体', () => {
    const skus = [
      { id: 201, goods_name: '【转单资源】腾讯视频SVIP云视听手机号『月卡』', goods_price: '25', face_value: '30', stock_num: 9 },
      { id: 202, goods_name: '【转单资源】腾讯视频SVIP云视听QQ号『月卡』', goods_price: '26', face_value: '30', stock_num: 9 }
    ];
    const pkgs = dedupSkusToPackages(skus);
    expect(pkgs).toHaveLength(1); // 合并为一个套餐
    // 主 SKU 取手机号变体（phone 优先）
    expect(pkgs[0].shunshiGoodsId).toBe(201);
    const types = pkgs[0].accountVariants.map((v) => `${v.accountType}:${v.shunshiGoodsId}`);
    expect(types).toEqual(['phone:201', 'qq:202']);
  });
});

describe('detectAccountType / pickVariantByAccount 下单路由', () => {
  it('按输入判断账号形式', () => {
    expect(detectAccountType('13812345678')).toBe('phone');
    expect(detectAccountType('123456')).toBe('qq');
    expect(detectAccountType('1234567890')).toBe('qq');
    expect(detectAccountType('abc')).toBe('any');
  });

  it('按输入选对应 SKU 变体，命中失败回退首个', () => {
    const variants = [
      { accountType: 'phone' as const, shunshiGoodsId: 201, costPrice: 25, faceValue: 30, stock: 9, channel: '转单资源', channelPriority: 2 },
      { accountType: 'qq' as const, shunshiGoodsId: 202, costPrice: 26, faceValue: 30, stock: 9, channel: '转单资源', channelPriority: 2 }
    ];
    expect(pickVariantByAccount(variants, '13812345678')!.shunshiGoodsId).toBe(201);
    expect(pickVariantByAccount(variants, '123456')!.shunshiGoodsId).toBe(202);
    expect(pickVariantByAccount([], '123')).toBeUndefined();
  });
});

describe('isChannelSellable 自有平台销售授权', () => {
  it('can_buy 为空 / 含所有渠道 / 含其他渠道 时可售（自营=其他渠道）', () => {
    expect(isChannelSellable('')).toBe(true);
    expect(isChannelSellable(undefined)).toBe(true);
    expect(isChannelSellable('  ')).toBe(true);
    expect(isChannelSellable('所有渠道均可销售')).toBe(true);
    expect(isChannelSellable('其他无限制')).toBe(true);
    expect(isChannelSellable('闲鱼,拼多多,淘宝,京东,其他渠道')).toBe(true);
  });

  it('仅具名平台、不含其他渠道的一律排除', () => {
    expect(isChannelSellable('闲鱼,拼多多,淘宝,京东,抖音,快手,小红书')).toBe(false);
    expect(isChannelSellable('仅限异业企业采购')).toBe(false);
    expect(isChannelSellable('拼多多')).toBe(false);
  });
});

describe('isChannelExcluded 渠道排除', () => {
  it('转单资源 一律排除', () => {
    expect(isChannelExcluded('【转单资源】爱奇艺星钻『月卡』')).toBe(true);
    expect(isChannelExcluded('【零售直充】爱奇艺黄金会员『1个月』')).toBe(false);
    expect(isChannelExcluded('【账号直充】腾讯视频VIP升级 SVIP 『1个月』')).toBe(false);
  });
});
