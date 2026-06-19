# Implementation Plan: 会员多多购微信小程序

## Overview

基于微信云开发（CloudBase）构建完整的虚拟会员代充小程序，采用 TypeScript 全栈开发。按照依赖关系从底层基础设施到上层页面逐步构建，确保每一步可独立验证。核心实现路径：项目初始化 → 共享模块 → 数据库 → 云函数 → 前端组件 → 前端页面 → 管理端 → 属性测试。

## Tasks

- [x] 1. 项目初始化与基础配置
  - [x] 1.1 创建微信小程序项目结构与 TypeScript 配置
    - 初始化 miniprogram 目录，配置 tsconfig.json（strict 模式）
    - 配置 project.config.json 设置云开发环境
    - 配置 app.json 注册所有页面路由和 tabBar（首页/分类/个人中心）
    - 创建 app.ts 初始化云开发环境 `wx.cloud.init()`
    - _Requirements: 全局基础设施_

  - [x] 1.2 引入 TDesign Miniprogram 组件库
    - 通过 npm 安装 tdesign-miniprogram，配置构建 npm
    - 在 app.json 中全局注册常用组件（Toast、Dialog、Tabs、Cell、Skeleton、Tag）
    - 配置自定义主题色 #c99a3a（修改 CSS 变量）
    - _Requirements: 全局基础设施_

  - [x] 1.3 创建云函数项目结构与 TypeScript 配置
    - 初始化 cloudfunctions 目录，每个云函数子目录配置独立 tsconfig.json
    - 配置 package.json（含 wx-server-sdk、crypto-js 等依赖）
    - 创建 shared/ 共享模块目录结构（types/、utils/、constants.ts）
    - 配置 Jest + fast-check 测试框架
    - _Requirements: 全局基础设施_

- [x] 2. 共享模块：类型定义与工具函数
  - [x] 2.1 定义核心 TypeScript 类型和枚举
    - 创建 shared/types/order.ts：OrderStatus 枚举、Order 接口、Timeline 接口
    - 创建 shared/types/product.ts：Product、Package、Category、AttachTemplate 接口
    - 创建 shared/types/api.ts：CloudFunctionResult、ShunshiResponse 等 API 响应类型
    - 创建 shared/types/audit.ts：AuditLog、AuditType 枚举
    - 创建 shared/types/config.ts：SystemConfig 接口
    - _Requirements: 全局类型安全_

  - [x] 2.2 实现签名工具函数（sign.ts）
    - 实现 generateSign(timestamp, body, apikey)：按 key 字典序排列 body，计算 sha1(timestamp + jsonStr + apikey)
    - 实现 verifyCallbackSign(params, apikey)：移除 sign/card_list/express_list，用 time 字段计算验证
    - 实现 sortObjectKeys(obj)：递归按 ASCII 码升序排列对象 key
    - _Requirements: 5.2, 14.1, 14.2_

  - [ ]* 2.3 编写签名工具属性测试
    - **Property 7: 签名生成与验证 Round-Trip**
    - **Property 8: 请求 Header 格式正确性**
    - **Validates: Requirements 5.2, 14.1, 14.2**

  - [x] 2.4 实现脱敏工具函数（mask.ts）
    - 实现 maskPhone(phone)：11位手机号 → 前3+****+后4
    - 实现 maskAccount(account)：非手机号格式 → 首2+星号+末2；长度<5 → 全星号
    - _Requirements: 15.1, 15.3, 15.5_

  - [ ]* 2.5 编写脱敏工具属性测试
    - **Property 12: 11位手机号脱敏格式**
    - **Property 13: 非手机号格式脱敏规则**
    - **Validates: Requirements 15.1, 15.3, 15.5**

  - [x] 2.6 实现校验工具函数（validator.ts）
    - 实现 isValidPhone(str)：正则 ^1[3-9]\d{9}$ 校验
    - 实现 isFormComplete(template, values)：检查所有必填字段非空
    - 实现 validateProductForm(product)：商品编辑表单完整性校验
    - _Requirements: 2.5, 2.6, 16.5_

  - [ ]* 2.7 编写校验工具属性测试
    - **Property 3: 手机号格式校验正确性**
    - **Property 4: 表单完整性与按钮状态联动**
    - **Validates: Requirements 2.5, 2.6, 16.5**

  - [x] 2.8 实现审计日志工具函数（logger.ts）
    - 实现 createAuditLog(params)：生成包含 operator、createdAt（ISO 8601 毫秒）、type、action 的审计日志对象
    - 实现 writeAuditLog(db, log)：写入数据库，失败重试1次，仍失败则输出云函数日志
    - 实现日志脱敏：确保日志中不包含 apikey、完整签名、未脱敏手机号
    - _Requirements: 13.1, 13.2, 13.5, 14.4_

  - [ ]* 2.9 编写审计日志属性测试
    - **Property 9: 日志不含敏感信息**
    - **Property 11: 审计日志字段完整性**
    - **Validates: Requirements 13.1, 13.2, 14.4**

  - [x] 2.10 实现过滤与排序工具函数（filter.ts）
    - 实现 filterByCategory(products, categoryId)：按分类过滤已上架商品
    - 实现 searchProducts(products, keyword)：模糊匹配名称和分类名，仅返回已上架
    - 实现 sortByPrice(products)：按默认套餐售价升序
    - 实现 filterByTag(products, tag)：按标签过滤
    - 实现 filterCancelledOrders(orders)：排除已取消订单
    - 实现 isOrderExpired(order, minutes)：判断待支付订单是否超时
    - _Requirements: 1.2, 1.6, 21.2, 21.5, 21.6, 23.1, 23.4_

  - [ ]* 2.11 编写过滤排序属性测试
    - **Property 1: 分类过滤正确性**
    - **Property 15: 搜索匹配正确性**
    - **Property 16: 价格排序单调性**
    - **Property 17: 标签过滤正确性**
    - **Property 18: 订单超时判断正确性**
    - **Property 19: 用户端排除已取消订单**
    - **Validates: Requirements 1.2, 1.6, 21.2, 21.5, 21.6, 23.1, 23.4**

  - [x] 2.12 实现顺势 API 客户端封装（shunshi.ts）
    - 实现 ShunshiClient 类：baseUrl、userId、apikey 从环境变量读取
    - 实现 request(path, body)：自动生成签名、设置 Header（Sign/Timestamp/UserId）
    - 实现 getCategories()：调用 /api/v1/goods/cate
    - 实现 getProductList(params)：调用 /api/v1/goods/list（支持分页）
    - 实现 submitOrder(params)：调用 /api/v1/order/buy，传入 safe_price
    - 实现 queryOrder(params)：调用 /api/v1/order/info
    - 实现超时控制（15秒）和错误处理
    - _Requirements: 4.2, 4.3, 14.1, 14.2, 14.3, 14.5_

  - [x] 2.13 实现前端工具函数
    - 创建 miniprogram/utils/request.ts：封装 wx.cloud.callFunction，统一错误处理
    - 创建 miniprogram/utils/format.ts：时间格式化、金额格式化（分→元）、脱敏
    - 创建 miniprogram/utils/validator.ts：前端表单校验（手机号、必填项）
    - 创建 miniprogram/utils/constants.ts：订单状态映射、分类映射、颜色常量
    - 创建 miniprogram/utils/types.ts：前端全局类型定义
    - _Requirements: 全局前端基础_

- [x] 3. Checkpoint - 基础模块验证
  - 确保所有共享模块类型正确编译，Jest 测试通过，询问用户是否有疑问。

- [x] 4. 云数据库集合创建与索引
  - [x] 4.1 创建数据库初始化脚本
    - 编写 database/init.ts 脚本，创建7个集合：orders、products、categories、admin_whitelist、audit_logs、system_config、broadcast_cache
    - 为 orders 集合创建索引：openid+status+createdAt、status+createdAt、orderId（唯一）、shunshiOrderSn
    - 为 products 集合创建索引：categoryId+online+sortWeight、online+sortWeight、shunshiGoodsId、name（文本索引）
    - 为 categories 集合创建索引：categoryId（唯一）、parentId+level
    - 为 audit_logs 集合创建索引：createdAt、orderId+createdAt、type+createdAt
    - 为 admin_whitelist 集合创建索引：openid（唯一）
    - 为 system_config 集合创建索引：key（唯一）
    - 插入初始系统配置数据（homepage_order_count、customer_service_qrcode、purchase_notice 等）
    - _Requirements: 全局数据层_

- [x] 5. 商品云函数实现
  - [x] 5.1 实现商品列表与详情接口
    - 创建 cloudfunctions/product/index.ts：action 路由分发
    - 实现 getList：按分类ID + online=true + sortWeight 排序查询，分页返回
    - 实现 getDetail：按 productId 查询商品完整信息（含 packages 和 attachTemplate）
    - 实现 getCategories：返回所有分类列表，按 sortWeight 排序
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 2.1_

  - [x] 5.2 实现商品搜索与播报接口
    - 实现 search：模糊匹配 name 和 categoryName，支持排序（综合/价格低/到账快/电视端）
    - 实现 getBroadcast：从 broadcast_cache 集合读取最近20条记录，手机号脱敏返回
    - 实现 getConfig：从 system_config 集合读取指定配置
    - 实现 getArticle：从 system_config 读取富文本内容（purchase_notice、account_guide、platform_announcement）
    - _Requirements: 1.6, 1.8, 21.2, 21.4, 21.5, 21.6, 22.3, 22.4, 22.5_

  - [x] 5.3 实现商品同步接口
    - 实现 syncProducts：调用顺势 API 获取分类树（/api/v1/goods/cate）和商品列表（/api/v1/goods/list，自动翻页）
    - 实现同步逻辑：保留管理员已配置字段（name、sortWeight、online、packages[].price），仅更新顺势字段
    - 实现自动下架：顺势 status 为 2 或 3 时自动下架对应商品
    - 返回同步结果摘要（新增数、更新数、自动下架数、耗时）
    - 同步失败时中止并返回错误信息，已同步数据保留
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6_

  - [ ]* 5.4 编写商品同步属性测试
    - **Property 14: 商品同步保留管理员配置**
    - **Validates: Requirements 17.3**

- [x] 6. 订单云函数实现
  - [x] 6.1 实现订单创建接口
    - 创建 cloudfunctions/order/index.ts：action 路由分发
    - 实现 create：校验商品/套餐存在且上架，锁定当前价格，生成唯一 orderId（VIP+时间戳+4位随机），创建订单记录（status=pending_pay）
    - 记录 timeline 第一个节点（创建订单）
    - 实现价格锁定：amount = 下单时套餐 price，写入订单后不再变更
    - _Requirements: 3.1, 3.2, 3.7_

  - [ ]* 6.2 编写订单金额锁定属性测试
    - **Property 5: 订单金额锁定不变量**
    - **Property 6: Safe_Price 等于用户实付金额**
    - **Validates: Requirements 3.7, 4.3**

  - [x] 6.3 实现订单列表与详情接口
    - 实现 list：按 openid 查询，支持状态筛选，排除 cancelled 订单，按 createdAt 倒序，分页20条
    - 实现 detail：查询单个订单完整信息（含 timeline、failReason），手机号脱敏
    - 实现 stats：返回用户订单统计（全部、开通中、待退款数量）
    - 实现 rebuyCheck：验证商品/套餐是否仍然上架可购买
    - _Requirements: 7.1, 7.2, 7.8, 19.3, 23.4_

  - [x] 6.4 实现订单刷新进度接口
    - 实现 refresh：调用顺势 API queryOrder 查询最新状态
    - 更新本地订单状态和 timeline
    - 刷新按钮5秒内响应，失败返回友好提示
    - _Requirements: 7.4, 7.5, 20.5_

- [x] 7. 支付云函数实现
  - [x] 7.1 实现统一下单接口
    - 创建 cloudfunctions/payment/index.ts：action 路由
    - 实现 unifiedOrder：调用微信支付 API v3 统一下单，生成 prepay_id
    - 实现支付参数签名（RSA）并返回前端唤起支付所需的 payParams
    - 重新校验价格一致性（弹窗校验），价格变更时返回错误码
    - _Requirements: 3.2, 3.3, 3.4_

  - [x] 7.2 实现退款发起接口
    - 实现 refund：校验管理员权限，校验订单状态为 api_failed
    - 调用微信支付退款接口，退款金额等于用户实付金额
    - 更新订单状态为 refunding，记录退款原因和补充说明
    - 写入审计日志
    - _Requirements: 6.1, 6.2, 6.3, 6.5_

- [x] 8. 支付回调云函数（独立部署）
  - [x] 8.1 实现微信支付回调处理
    - 创建 cloudfunctions/payCallback/index.ts
    - 验证微信支付回调签名（AES-256-GCM 解密）
    - 更新订单状态为 paid，记录 payTransactionId
    - 调用顺势 API submitOrder（传入 safe_price = order.amount）
    - 成功时更新状态为 activating，记录 shunshiOrderSn
    - 失败时更新状态为 api_failed，记录错误码和原因
    - 写入 timeline 节点和审计日志
    - 实现幂等：已处理订单直接返回成功
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 9. 退款回调云函数（独立部署）
  - [x] 9.1 实现微信退款回调处理
    - 创建 cloudfunctions/refundCallback/index.ts
    - 验证退款回调签名并解密
    - 更新订单状态为 refunded，记录退款时间
    - 触发通知云函数发送退款到账订阅消息
    - 写入 timeline 节点和审计日志
    - _Requirements: 6.4_

- [x] 10. 顺势回调云函数（HTTP触发，独立部署）
  - [x] 10.1 实现顺势异步回调处理
    - 创建 cloudfunctions/callback/index.ts（配置为 HTTP 触发）
    - 实现回调签名验证：verifyCallbackSign
    - status=3（成功）：更新订单为 success，触发开通成功通知
    - status=4/5（取消/退款）：更新订单为 api_failed
    - 更新 broadcast_cache（开通成功时写入播报数据）
    - 返回字符串 "ok" 确认处理
    - 签名验证失败时拒绝处理并记录异常日志
    - _Requirements: 4.6, 4.7, 4.9, 5.1, 5.2, 5.3_

- [x] 11. 定时任务云函数
  - [x] 11.1 实现订单超时取消与开通超时轮询
    - 创建 cloudfunctions/timer/index.ts
    - 实现 cancelExpiredOrders：扫描 pending_pay 且 createdAt 超30分钟的订单，批量更新为 cancelled
    - 实现 queryPendingOrders：扫描 activating 且超10分钟未更新的订单，调用顺势 queryOrder 查询状态
    - 配置定时触发器（每5分钟执行）
    - 写入审计日志（操作人标记为"系统"）
    - _Requirements: 4.8, 23.1, 23.2, 23.3_

- [x] 12. 通知云函数
  - [x] 12.1 实现订阅消息通知发送
    - 创建 cloudfunctions/notify/index.ts
    - 实现 send：根据模板ID和数据调用微信订阅消息接口
    - 发送前检查用户订阅权限
    - 未授权时跳过发送，记录日志
    - 发送失败时记录日志，不重试，不影响订单流转
    - 支持三种模板：开通成功、开通失败、退款到账
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

- [x] 13. Checkpoint - 云函数核心逻辑验证
  - 确保所有云函数 TypeScript 编译通过，核心流程（下单→支付→开通→回调）逻辑正确，询问用户是否有疑问。

- [x] 14. 管理端云函数实现
  - [x] 14.1 实现权限校验中间件
    - 创建 shared/utils/adminAuth.ts：从 admin_whitelist 集合校验 openid
    - 实现 checkAdmin(openid)：存在返回允许，不存在返回拒绝
    - 数据库查询失败时默认拒绝，记录异常日志
    - 在管理端云函数入口统一调用，拒绝时返回无权限错误
    - _Requirements: 12.3, 12.4, 12.5, 12.6_

  - [ ]* 14.2 编写权限校验属性测试
    - **Property 10: 白名单权限校验一致性**
    - **Validates: Requirements 12.3, 12.4**

  - [x] 14.3 实现管理端数据看板接口
    - 创建 cloudfunctions/admin/index.ts：action 路由，每个 action 前置 checkAdmin
    - 实现 dashboard：今日销售额、今日订单数、开通成功率、接口失败数
    - 实现近7日销售额/订单量双折线图数据
    - 实现近30日分类占比圆环图数据
    - 实现待办订单列表（按状态筛选，最多50条）
    - 实现近20条审计日志
    - 实现近7日商品销量排行 Top10
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [x] 14.4 实现管理端订单管理接口
    - 实现 orderList：按状态筛选，展示三方单号、成本、预计利润，分页20条
    - 实现 orderDetail：返回完整手机号、时间轴、操作按钮状态、接口调用日志
    - 实现 retryActivation：重新调用顺势 API，限制最多3次，超限禁用
    - 实现 queryShunshi：调用顺势 queryOrder，3秒内返回结果
    - 实现 initiateRefund：校验状态，调用微信退款，更新状态，记录审计日志
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [x] 14.5 实现管理端商品管理接口
    - 实现 productList：返回全部/已上架/已下架统计，含单单利润计算
    - 实现 productSave：校验必填项、套餐至少1个、已指定默认套餐；售价低于成本时返回亏损警告
    - 实现 toggleOnline：上下架切换，下架后用户端不展示
    - 实现 updateConfig / getConfigs：系统配置管理
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9_

  - [x] 14.6 实现管理端审计日志查询接口
    - 实现 auditLogs：按时间倒序分页查询（每页50条）
    - 支持按 orderId 查询关联日志
    - _Requirements: 13.3, 13.4_

- [x] 15. 前端公共组件开发
  - [x] 15.1 实现商品卡片组件（product-card）
    - 展示品牌图标、商品名称、标签（Tag）、销量、现价、划线原价
    - 点击触发跳转事件，传递 productId
    - 使用 TDesign Cell 和 Tag 组件
    - _Requirements: 1.3_

  - [x] 15.2 实现订单卡片组件（order-card）
    - 展示商品名（截断20字符）、状态（带颜色）、脱敏账号、订单号、金额、时间
    - 按状态展示操作按钮（刷新进度/再买一次）
    - 刷新按钮 loading 状态控制
    - _Requirements: 7.2, 7.3_

  - [x] 15.3 实现时间轴组件（timeline）
    - 按时间正序展示节点列表
    - 每个节点：状态名称 + 时间 + 描述文案
    - 未完成节点灰色显示，当前节点高亮
    - _Requirements: 7.8, 20.3_

  - [x] 15.4 实现骨架屏、空状态与播报组件
    - 骨架屏组件：使用 TDesign Skeleton 或自定义渐变动画，10秒超时切换异常状态
    - 空状态组件：支持自定义图标、文案和引导按钮
    - 播报组件（broadcast）：接收数据列表，3-5秒随机间隔滚动切换，脱敏格式展示
    - _Requirements: 1.8, 16.1, 16.2, 16.3, 22.3, 22.4_

  - [x] 15.5 实现动态表单组件（dynamic-form）
    - 根据 AttachTemplate 数组动态渲染表单字段
    - 支持 text、select、radio、checkbox、cascader 输入类型
    - text 类型含手机号提示时，进行11位手机号校验
    - 所有必填字段未完成时触发禁用状态事件
    - 表单值变更触发 change 事件
    - _Requirements: 2.4, 2.5, 2.6_

  - [ ]* 15.6 编写动态表单属性测试
    - **Property 2: 动态表单渲染一致性**
    - **Property 4: 表单完整性与按钮状态联动**
    - **Property 20: 套餐选择与金额同步**
    - **Validates: Requirements 2.3, 2.4, 2.6**

  - [x] 15.7 实现确认弹窗组件（confirm-dialog）
    - 封装 TDesign Dialog，支持购买核对弹窗场景
    - 展示商品、会员类型、套餐周期、脱敏账号、应付金额
    - 确认按钮触发支付流程，取消关闭弹窗
    - _Requirements: 3.1, 3.6_

- [x] 16. Checkpoint - 组件与云函数集成验证
  - 确保所有组件编译正确，云函数部署配置完整，询问用户是否有疑问。

- [x] 17. 前端页面：首页
  - [x] 17.1 实现首页完整功能
    - 搜索栏（点击跳转搜索页）
    - 信任 Hero 区：到账时间、累计订单数（从 system_config 读取）、续费说明
    - 实时购买播报（调用 getBroadcast，<5条时隐藏）
    - 分类 Tab 切换（热门/视频/音乐/网盘/工具）
    - 商品列表（调用 getList，按 Tab 过滤，分页加载）
    - 使用骨架屏加载态
    - _Requirements: 1.1, 1.2, 1.3, 1.8, 22.1, 22.2, 22.3, 22.4, 22.5_

- [x] 18. 前端页面：分类页
  - [x] 18.1 实现分类页完整功能
    - 左右双栏布局：左侧分类侧边栏 + 右侧商品面板
    - 左侧列表从 getCategories 获取数据
    - 点击分类切换右侧商品列表和数量统计
    - 商品为空时展示空状态
    - _Requirements: 1.4, 1.5, 16.2_

- [x] 19. 前端页面：搜索结果页
  - [x] 19.1 实现搜索结果页完整功能
    - 自动聚焦搜索输入框
    - 调用 search 接口，展示结果提示条"找到 X 个相关会员权益"
    - 排序筛选 Tab（综合/价格低/到账快/电视端）
    - 空结果展示空状态"没有找到相关会员"
    - 支持清空重新搜索
    - _Requirements: 1.6, 1.7, 21.1, 21.2, 21.3, 21.4, 21.5, 21.6, 21.7_

- [x] 20. 前端页面：商品详情页（含动态表单、购买核对弹窗）
  - [x] 20.1 实现商品详情页完整功能
    - 品牌 Hero 区
    - 会员类型选择卡片（多类型切换刷新套餐和价格）
    - 套餐选择（切换同步底部金额）
    - 关键须知和权益对比表
    - 底部固定支付栏：动态表单 + 购买按钮（表单未完成时禁用）
    - 购买核对弹窗：展示确认信息，校验价格一致性
    - 确认支付：调用统一下单 → 唤起 wx.requestPayment
    - 支付成功跳转支付结果页，取消/失败保留弹窗不清空数据
    - 网络异常重试保留表单数据
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 16.4_

- [x] 21. 前端页面：支付结果页
  - [x] 21.1 实现支付结果页
    - 展示支付成功图标和文案
    - 展示订单摘要（商品名、金额、订单号）
    - 提供查看订单和返回首页按钮
    - _Requirements: 3.5_

- [x] 22. 前端页面：订单列表页
  - [x] 22.1 实现用户订单列表页完整功能
    - 状态筛选 Tab（全部/开通中/开通成功/退款），默认"全部"
    - 订单卡片列表（使用 order-card 组件），按下单时间倒序
    - 分页加载（每页20条，触底加载下一页）
    - 开通中订单：刷新进度按钮（loading + 防重复点击）
    - 再买一次：校验商品是否上架，已下架弹窗提示
    - 空状态引导：无订单时展示引导按钮到首页
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 16.1_

- [x] 23. 前端页面：订单详情页（用户视角）
  - [x] 23.1 实现用户订单详情页完整功能
    - 状态 Hero 区（暗色卡片）：当前状态、描述文案（含脱敏账号）、实付金额、下单时间、预计到账
    - 订单进度时间轴（使用 timeline 组件），未完成节点灰色
    - 订单信息卡片：订单号（长按复制）、商品名、脱敏账号、状态颜色标识
    - 刷新进度按钮（loading 状态）
    - 异常说明区（超时重查、失败退款、联系客服）
    - 开通失败时展示失败原因（recharge_hints 或管理员填写）
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7_

- [x] 24. 前端页面：个人中心页
  - [x] 24.1 实现个人中心页完整功能
    - 用户信息区：头像占位符"U" + "微信用户"（授权后显示真实信息）
    - 快速统计卡片（3列）：全部订单、处理中、待退款（实时查询 stats 接口）
    - 点击统计卡片跳转订单列表对应 Tab
    - 常用功能菜单：我的订单、购买须知、账号填写说明、平台公告
    - 客服入口：点击弹出二维码弹窗（从 system_config 读取图片URL）
    - 长按二维码保存图片/识别
    - 图片加载失败兜底提示
    - 管理员入口：检查 admin_whitelist，非管理员隐藏
    - 底部服务保障说明（3条固定文案）
    - _Requirements: 12.1, 12.2, 18.1, 18.2, 18.3, 18.4, 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7_

- [x] 25. 前端页面：富文本内容页
  - [x] 25.1 实现静态富文本内容页
    - 从 cloud_database 读取对应 key 的富文本内容
    - 使用 rich-text 组件渲染
    - 支持购买须知、账号填写说明、平台公告三个页面复用
    - _Requirements: 19.6_

- [x] 26. Checkpoint - 用户端页面完整性验证
  - 确保所有用户端页面编译通过，页面路由配置正确，核心交互逻辑完整，询问用户是否有疑问。

- [x] 27. 管理端页面：数据看板
  - [x] 27.1 实现管理端数据看板页面
    - 四大核心指标卡片：今日销售额、今日订单数、开通成功率、接口失败数
    - 近7日双折线图（销售额 + 订单量）- 使用 wx-charts 或 canvas 绘制
    - 近30日分类占比圆环图
    - 待办订单列表（状态筛选，最多50条）
    - 近20条审计日志列表
    - 商品销量排行 Top10
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

- [x] 28. 管理端页面：订单处理 + 订单详情
  - [x] 28.1 实现管理端订单处理页面
    - 状态筛选 Tab（全部/开通中/接口失败/退款中），分页20条
    - 订单卡片：商品名、状态、脱敏手机号、订单号、三方单号、实付、成本、预计利润
    - 点击进入管理端订单详情页
    - _Requirements: 8.1, 8.2_

  - [x] 28.2 实现管理端订单详情页面
    - 展示完整手机号（已通过权限校验）
    - 状态时间轴
    - 操作按钮：重试开通（最多3次限制）、查询接口、发起退款
    - 退款弹窗：选择失败原因分类 + 补充说明
    - 接口日志区：每次 API 调用的时间、返回码、描述、耗时
    - _Requirements: 8.3, 8.4, 8.5, 8.6, 8.7, 6.1_

- [x] 29. 管理端页面：商品运营 + 商品编辑
  - [x] 29.1 实现管理端商品运营页面
    - 数据概览卡片：全部/已上架/已下架数量
    - 快捷操作按钮：同步商品、新增商品
    - 商品卡片列表：商品名、上架状态、售价、成本、利润、接口ID、今日销量
    - 上下架开关（确认弹窗）
    - 同步商品按钮：触发同步，展示结果摘要
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.8_

  - [x] 29.2 实现管理端商品编辑页面
    - 基础信息表单：商品名（30字限制）、分类选择、充值方式、账号类型、接口商品ID、自动开通开关、排序权重
    - 套餐价格列表：展示已有套餐，支持新增/改价
    - 套餐编辑弹窗：套餐名、会员类型、售价、成本价、接口SKU、库存、上架开关
    - 售价低于成本时显示亏损警告（不阻止保存）
    - 售前规则编辑：设备支持、到账时间、安全说明（首次提供默认模板）
    - 保存校验：必填项、至少1个套餐、已指定默认套餐
    - 改价确认弹窗：提示新价格只影响后续订单
    - 预览商品按钮（用户视角预览）
    - _Requirements: 9.5, 9.6, 9.7, 9.9, 24.1, 24.2, 24.3, 24.4, 24.5, 24.6, 24.7, 24.8_

- [x] 30. Checkpoint - 管理端页面验证
  - 确保管理端所有页面编译通过，权限校验正确拦截非管理员访问，询问用户是否有疑问。

- [x] 31. 全局异常处理与网络重试
  - [x] 31.1 实现前端全局异常处理机制
    - 在 request.ts 中实现统一网络错误拦截（超时、断网、云函数错误）
    - 页面级骨架屏加载态（10秒超时切换异常提示）
    - 网络异常提示 + 重试按钮（保留用户已填写表单数据）
    - 连续重试3次失败后追加客服入口引导
    - _Requirements: 16.3, 16.4, 16.6_

- [x] 32. 全链路集成与 Wiring
  - [x] 32.1 端到端流程串联
    - 首页 → 详情 → 支付 → 结果页 → 订单列表 完整链路验证
    - 个人中心 → 统计跳转 → 订单 Tab 联动
    - 管理员入口 → 看板 → 订单处理 → 退款 完整链路
    - 商品同步 → 编辑 → 上架 → 用户端可见 完整链路
    - 订单超时 → 自动取消 → 用户端不可见
    - 确保所有页面间跳转参数传递正确
    - _Requirements: 全局集成_

  - [ ]* 32.2 编写集成测试
    - 支付完整流程 Mock 测试
    - 退款流程 Mock 测试
    - 超时取消流程测试
    - 开通超时轮询流程测试
    - 重试开通流程测试（含3次上限）
    - _Requirements: 全局集成_

- [x] 33. Final Checkpoint - 全项目验证
  - 确保所有代码编译通过，测试通过，云函数配置完整，前后端接口对齐，询问用户是否有疑问。

## Notes

- 任务标记 `*` 的为可选测试任务，可跳过以加速 MVP 交付
- 每个任务引用具体需求编号，确保全覆盖可追溯
- Checkpoint 任务确保增量验证，及时发现问题
- Property 测试验证通用正确性属性，单元测试验证具体边界场景
- 云函数独立部署策略：payCallback、refundCallback、callback 三个回调函数独立部署，保证冷启动速度
- 定时任务通过云函数定时触发器配置，无需额外基础设施
- 所有敏感信息（apikey、userId）仅存储在云函数环境变量中

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "2.4", "2.6", "2.8", "2.10", "2.13"] },
    { "id": 3, "tasks": ["2.3", "2.5", "2.7", "2.9", "2.11", "2.12"] },
    { "id": 4, "tasks": ["4.1"] },
    { "id": 5, "tasks": ["5.1", "5.2", "5.3", "6.1", "14.1"] },
    { "id": 6, "tasks": ["5.4", "6.2", "6.3", "6.4", "7.1", "7.2", "14.2"] },
    { "id": 7, "tasks": ["8.1", "9.1", "10.1", "11.1", "12.1"] },
    { "id": 8, "tasks": ["14.3", "14.4", "14.5", "14.6"] },
    { "id": 9, "tasks": ["15.1", "15.2", "15.3", "15.4", "15.5", "15.7"] },
    { "id": 10, "tasks": ["15.6"] },
    { "id": 11, "tasks": ["17.1", "18.1", "19.1", "21.1", "24.1", "25.1"] },
    { "id": 12, "tasks": ["20.1", "22.1", "23.1"] },
    { "id": 13, "tasks": ["27.1", "28.1", "29.1"] },
    { "id": 14, "tasks": ["28.2", "29.2"] },
    { "id": 15, "tasks": ["31.1"] },
    { "id": 16, "tasks": ["32.1"] },
    { "id": 17, "tasks": ["32.2"] }
  ]
}
```
