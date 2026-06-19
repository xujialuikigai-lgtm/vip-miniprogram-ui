# 顺势权益 API 对接文档

**平台地址**：https://www.mxmm666.com  
**文档来源**：https://www.yuque.com/shunshiquanyi/cotkg9  
**角色**：上游供货系统（货源），小程序通过调用此 API 自动完成会员充值

---

## 一、接入配置

### 1.1 必要凭证

| 凭证 | 获取方式 | 用途 |
|------|----------|------|
| **UserId（APPID）** | 电脑端：用户中心 → 账户管理 → 接口管理 | 请求 Header 必传 |
| **apikey（密钥）** | 同上，或手机端：我的 → 安全设置 → 接口密钥 | 签名计算 |

### 1.2 协议规范

- 传输协议：HTTP/HTTPS
- 请求方式：POST
- Content-Type：`application/json`
- 编码：UTF-8

---

## 二、签名规范

### 2.1 签名规则

```
sign = sha1(timestamp + json_body + apikey)
```

- **timestamp**：13 位毫秒时间戳
- **json_body**：Body 参数按 key 字典序（a-z）排列后的 JSON 字符串；无参数时为 `{}`
- **apikey**：你的密钥

### 2.2 Header 参数（每次请求必传）

| 参数 | 类型 | 说明 | 示例 |
|------|------|------|------|
| Sign | string | 签名 | `20d6ed7224f6ecedda74548aff9cb1a54e5c0033` |
| Timestamp | string | 13位毫秒时间戳 | `1696645385740` |
| UserId | string | 你的 APPID | `2uIkTrXNdAFc7OKhbRenzjDtgPoZ6s5C` |

### 2.3 签名示例

假设：
- UserId = `2uIkTrXNdAFc7OKhbRenzjDtgPoZ6s5C`
- apikey = `H0YnuPpcVtx7rQdMTbjN6932s5oDOqFa`
- timestamp = `1696645385740`
- body = `{"day":10,"external_orderno":"","ordersn":"D100759082558859640832"}`

待签名字符串：
```
1696645385740{"day":10,"external_orderno":"","ordersn":"D100759082558859640832"}H0YnuPpcVtx7rQdMTbjN6932s5oDOqFa
```

sign 结果：
```
15b8f541eb10e3fbb33efd92c8d52d50ddca0784
```

### 2.4 注意事项

- Body 参数按参数名 ASCII 码从小到大排序
- Body 为空时传 `{}`，签名也用 `{}` 参与计算
- 回调地址原样参与签名
- 参数名区分大小写

---

## 三、商品接口

### 3.1 商品分类列表

**URL**：`/api/v1/goods/cate`  
**Body 参数**：无（传 `{}`）

**返回结构**（树形，最多三级）：

```json
{
  "code": 200,
  "msg": "成功",
  "data": [
    {
      "id": 365,
      "name": "视频会员",
      "pid": 0,
      "img": "http://...",
      "children": [
        {
          "id": 366,
          "name": "爱奇艺",
          "pid": 365,
          "img": "http://...",
          "children": [...]
        }
      ]
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 分类 ID |
| name | string | 分类名称 |
| pid | int | 上级 ID（0 为顶级） |
| img | string | 分类图片 |
| children | array | 子分类列表 |

---

### 3.2 商品列表

**URL**：`/api/v1/goods/list`

**Body 参数**：

| 参数 | 类型 | 必填 | 说明 | 默认值 |
|------|------|------|------|--------|
| cate_id | int | 否 | 二级分类 ID | 0（全部） |
| keyword | string | 否 | 商品名称搜索 | 空 |
| limit | int | 否 | 每页数量 | 100 |
| page | int | 否 | 当前页码 | 1 |

**返回结构**：

```json
{
  "code": 200,
  "msg": "成功",
  "data": {
    "list": [
      {
        "id": 2909,
        "goods_name": "爱奇艺黄金VIP月卡",
        "goods_img": "http://...",
        "goods_type": 2,
        "face_value": "30.00",
        "goods_price": "18.00",
        "status": 1,
        "stock_num": 9999
      }
    ],
    "total": 42
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 商品 ID（下单用） |
| goods_name | string | 商品名称 |
| goods_img | string | 商品图片 URL |
| goods_type | int | 1=卡密商品，2=虚拟商品（直充） |
| face_value | string | 商品面值（原价） |
| goods_price | string | 商品价格（你的进货价） |
| status | int | 1=销售中，2=暂停，3=禁售 |
| stock_num | int | 库存数量 |

---

### 3.3 商品详情

**URL**：`/api/v1/goods/info`

**Body 参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | int | 是 | 商品 ID |

**返回结构**：

```json
{
  "code": 200,
  "msg": "成功",
  "data": {
    "id": 1,
    "goods_name": "爱奇艺黄金VIP月卡",
    "goods_img": "http://...",
    "goods_type": 2,
    "face_value": "30.00",
    "goods_price": "18.00",
    "status": 1,
    "stock_num": 9999,
    "goods_info": "商品详情内容",
    "goods_notice": "注意事项",
    "start_count": 1,
    "end_count": 10,
    "attach": [
      {
        "key": "recharge_account",
        "type": "text",
        "tip": "请输入手机号",
        "name": "充值账号"
      }
    ]
  }
}
```

**新增字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| goods_info | string | 商品详情（富文本） |
| goods_notice | string | 注意事项 |
| start_count | int | 最小购买数量 |
| end_count | int | 最大购买数量 |
| attach | array | **下单模板**（虚拟商品下单时需要的参数） |

**attach 下单模板说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| key | string | 下单参数变量名（如 `recharge_account`） |
| type | string | 输入类型：text/password/checkbox/select/radio/cascader |
| tip | string | 提示信息 |
| name | string | 参数显示名称 |
| options | string | 多选/单选/下拉/级联 类型才有此字段 |

> **重要**：`attach` 决定了用户下单时需要填写什么信息。比如充值手机号就是一个 `text` 类型的 attach 参数。UI 中的"充值账号"输入框就是基于 attach 动态渲染的。

---

## 四、订单接口

### 4.1 订单提交（下单）

**URL**：`/api/v1/order/buy`

> ⚠️ **异步接口**：下单成功 ≠ 充值成功。充值结果需通过回调或轮询订单查询获取。

**Body 参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | int | 是 | 商品 ID |
| quantity | int | 是 | 下单数量 |
| external_orderno | string | 是 | 你的系统订单号（防重复，唯一值） |
| url | string | 否 | 异步回调地址 |
| safe_price | string | 否 | 安全价格（防止上游调价导致亏本，不能小于售价） |
| mark | string | 否 | 下单备注 |
| attach | object | 否 | 下单参数（根据商品详情的 attach 模板填充） |

**attach 参数示例**：

```json
{
  "recharge_account": "13812345678",
  "lblName1": "其他参数值"
}
```

**返回结构**：

```json
{
  "code": 200,
  "msg": "成功",
  "data": {
    "ordersn": "D100759274105949519872",
    "external_orderno": "你的订单号"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| ordersn | string | 顺势系统订单号 |
| external_orderno | string | 你的系统订单号 |

---

### 4.2 订单查询

**URL**：`/api/v1/order/info`

**Body 参数**（二选一）：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| ordersn | string | 否 | 顺势订单号（多个用逗号隔开） |
| external_orderno | string | 否 | 你的订单号（多个用逗号隔开） |
| day | string | 否 | 查多少天内的订单，默认 30 天，传 0 查全部 |

**返回结构**：

```json
{
  "code": 200,
  "msg": "成功",
  "data": [
    {
      "ordersn": "D100759324935205552128",
      "external_orderno": "你的订单号",
      "recharge_info": [
        { "n": "充值账号", "v": "13812345678", "k": "recharge_account" }
      ],
      "recharge_hints": "充值成功",
      "status": 3,
      "card_list": []
    }
  ]
}
```

**订单状态码**：

| 状态码 | 含义 | 对应小程序状态 |
|--------|------|----------------|
| -1 | 未支付 | — |
| 1 | 等待处理 | 已支付待处理 |
| 2 | 正在处理 | 充值中 |
| 3 | 交易成功 | 充值成功 |
| 4 | 取消交易 | 已取消 |
| 5 | 已退款 | 已退款 |

---

### 4.3 订单异步回调

> 顺势处理完订单后，会主动 POST 到你在下单时传的 `url` 地址。

**回调参数（POST Body）**：

| 参数 | 类型 | 说明 |
|------|------|------|
| external_orderno | string | 你的订单号 |
| ordersn | string | 顺势订单号 |
| status | string | 状态：2=正在处理，3=已完成，4=取消交易，5=已退款 |
| has_back_money | string | 退款金额（如 "0.00"） |
| total_price | string | 下单金额 |
| recharge_hints | string | 订单处理返回信息（如"充值成功"） |
| time | string | 13位毫秒时间戳 |
| sign | string | 签名（用于验证） |
| card_list | string | 卡密信息（卡密商品才有，不参与签名） |

**回调签名验证**：

```
验证 sign 时：
1. 移除 sign、card_list、express_list 字段
2. 剩余字段按 key 字典序排列
3. sha1(time + json_encode(排序后的参数) + apikey) == sign
```

**回调响应要求**：
- 收到后返回字符串 `ok`
- 不返回 `ok` 则视为失败，顺势会阶梯延迟重试：5/10/15/20/25 分钟，最多 5 次

---

## 五、业务流程映射

### 5.1 完整充值链路

```
用户支付成功
    ↓
小程序后端创建本地订单
    ↓
调用顺势 /api/v1/order/buy（传入商品ID、手机号、你的订单号、回调地址）
    ↓
顺势返回 ordersn（下单成功，开始处理）
    ↓
小程序订单状态 → "充值中"
    ↓
顺势处理完成，POST 回调通知你的服务端
    ↓
验证签名 → 更新本地订单状态 → 通知用户（订阅消息）
    ↓
返回 "ok"
```

### 5.2 状态映射关系

| 顺势状态 | 顺势含义 | 小程序订单状态 | 用户看到的文案 |
|----------|----------|----------------|----------------|
| 1 | 等待处理 | 充值中 | 充值中，请稍候 |
| 2 | 正在处理 | 充值中 | 正在充值，预计 1-5 分钟 |
| 3 | 交易成功 | 充值成功 | 充值成功 |
| 4 | 取消交易 | 充值失败 | 充值失败，已退款 |
| 5 | 已退款 | 已退款 | 已退款，请查看微信支付 |

### 5.3 商品数据同步策略

| 数据 | 来源 | 你维护的额外信息 |
|------|------|------------------|
| 商品名称 | 顺势 `goods_name` | 可覆盖自定义名称 |
| 商品图片 | 顺势 `goods_img` | 可覆盖为自定义品牌图标 |
| 进货价 | 顺势 `goods_price` | — |
| 销售价 | 你自己定 | 基于进货价加利润 |
| 面值（原价） | 顺势 `face_value` | 用于展示"划线价" |
| 下单模板 | 顺势 `attach` | 据此动态渲染用户输入表单 |
| 分类 | 顺势分类树 | 可自定义前端展示分类 |
| 库存 | 顺势 `stock_num` | 实时同步或定时同步 |
| 商品状态 | 顺势 `status` | 顺势暂停/禁售时自动下架 |

---

## 六、需求文档需要更新的点

基于这个 API 文档，之前的需求文档有以下点需要修正或补充：

### 6.1 充值不是纯人工

之前 UI 中管理员"标记成功/标记失败"的操作，实际上是**异常兜底**。正常流程是：
1. 用户支付 → 自动调顺势下单 → 回调自动更新状态
2. 只有回调超时或状态异常时，管理员才需要手动介入

### 6.2 商品管理可半自动化

- 可以从顺势 API 批量同步商品和分类
- 管理员主要维护：销售价格、前端展示名称、排序、上下架
- 上游调价或下架时需要同步更新（顺势有商品变更通知接口）

### 6.3 下单参数是动态的

- 不是所有商品都是"输入手机号"，attach 模板决定了需要什么输入
- UI 中的"充值账号"输入框应根据商品的 attach 动态渲染
- 可能有 text、select、radio 等多种输入类型

### 6.4 safe_price 防亏

- 下单时传 `safe_price` = 你的售价，如果上游价格突然涨到高于你的售价，下单会被拒绝
- 避免"卖一单亏一单"的情况

### 6.5 需要一个回调接收服务

- 小程序云函数需要暴露一个 HTTP 接口，用于接收顺势的异步回调
- 回调逻辑：验签 → 更新订单状态 → 发送用户通知 → 返回 `ok`

---

## 七、相关子文档链接

| 文档 | 地址 |
|------|------|
| 签名规范 | https://www.yuque.com/shunshiquanyi/cotkg9/scgslptlw2k59cu4 |
| 商品分类列表 | https://www.yuque.com/shunshiquanyi/cotkg9/lk8o696ikfawsocd |
| 商品列表接口 | https://www.yuque.com/shunshiquanyi/cotkg9/llgs4i61f31qkyyz |
| 商品详情接口 | https://www.yuque.com/shunshiquanyi/cotkg9/kvn4abe0nim45868 |
| 商品下单模板 | https://www.yuque.com/shunshiquanyi/cotkg9/mnrx6rgo7std2hr1 |
| 商品变更通知 | https://www.yuque.com/shunshiquanyi/cotkg9/wknfe92nipggvqvf |
| 商品调价记录 | https://www.yuque.com/shunshiquanyi/cotkg9/fptg6xfavqbxhb3c |
| 订单提交接口 | https://www.yuque.com/shunshiquanyi/cotkg9/yzy153avugg0hrzo |
| 订单查询接口 | https://www.yuque.com/shunshiquanyi/cotkg9/gx9g5srvb22uqhy0 |
| 订单异步回调 | https://www.yuque.com/shunshiquanyi/cotkg9/tqeoms5qr5067d1a |
| 订单撤单接口 | https://www.yuque.com/shunshiquanyi/cotkg9/hfcxw7ugovhz5yn3 |
| 售后申请接口 | https://www.yuque.com/shunshiquanyi/cotkg9/ztteaq4b7ikwb658 |
| 售后处理回调 | https://www.yuque.com/shunshiquanyi/cotkg9/kg1u43qu6xkl05qs |
| 全局状态码 | https://www.yuque.com/shunshiquanyi/cotkg9/rn34yfitq2l5u8tm |
