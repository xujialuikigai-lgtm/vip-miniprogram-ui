# Requirements Document

## Introduction

"会员多多购"是一款基于微信云开发的虚拟会员代充小程序，为用户提供视频、音乐、网盘、工具类会员的官方直充服务。系统通过对接顺势权益API实现支付后自动开通，全程无需人工干预。前端使用微信小程序原生框架，后端使用云函数 + 云数据库 + 云存储，支付使用微信支付，无需额外域名和服务器。

本期范围覆盖15个核心页面（用户端9个 + 管理端5个 + 1个用户订单详情页）、微信支付与退款流程、第三方API自动开通链路、管理员后台、订阅消息通知和操作审计日志。

## Glossary

- **Miniprogram**: 微信小程序前端应用，运行在微信环境中
- **Cloud_Function**: 微信云开发云函数，运行在服务端，处理业务逻辑和敏感操作
- **Cloud_Database**: 微信云开发云数据库，存储订单、商品、用户等数据
- **Shunshi_API**: 顺势权益第三方接口，提供会员充值的下单、查询、回调等功能
- **Order_System**: 订单管理系统，包含订单创建、状态流转、退款等功能
- **Product_System**: 商品管理系统，包含商品同步、价格配置、上下架等功能
- **Payment_System**: 支付系统，包含微信支付下单、回调处理、退款等功能
- **Admin_Panel**: 管理员后台，包含数据看板、订单处理、商品运营等功能
- **Notification_Service**: 通知服务，通过微信订阅消息向用户发送订单状态变更通知
- **Audit_Logger**: 审计日志服务，记录所有系统操作和管理员操作
- **Attach_Template**: 顺势API返回的下单参数模板，定义用户下单时需要填写的字段（如充值账号）
- **Safe_Price**: 安全价格，下单时传给顺势API防止上游调价导致亏本的保护机制
- **Admin_Whitelist**: 管理员白名单，存储在云数据库中的授权管理员微信openid列表
- **Order_Status**: 订单状态枚举，包含待支付、已支付、开通中、开通成功、接口失败、退款中、已退款
- **Callback_Endpoint**: 云函数暴露的HTTP触发接口，用于接收顺势API的异步回调通知

## Requirements

### Requirement 1: 商品展示与浏览

**User Story:** 作为普通用户，我想浏览和搜索各类会员商品，以便找到需要购买的会员服务。

#### Acceptance Criteria

1. WHEN 用户进入首页, THE Miniprogram SHALL 展示搜索栏、信任Hero区、实时购买播报、分类Tab和商品列表
2. WHEN 用户切换分类Tab（热门/视频/音乐/网盘/工具）, THE Miniprogram SHALL 刷新商品列表仅展示对应分类下已上架的商品
3. THE Miniprogram SHALL 在每个商品卡片中展示品牌图标、商品名称、标签、销量信息、现价和划线原价
4. WHEN 用户进入分类页, THE Miniprogram SHALL 以左右双栏布局展示左侧分类侧边栏和右侧商品面板
5. WHEN 用户点击左侧分类项, THE Miniprogram SHALL 切换右侧面板展示该分类下的商品列表及商品数量
6. WHEN 用户在搜索栏输入关键词并提交, THE Miniprogram SHALL 跳转到搜索结果页展示匹配的商品列表
7. WHEN 搜索结果为空, THE Miniprogram SHALL 展示空状态图标和提示文案"没有找到相关会员"
8. THE Miniprogram SHALL 在首页实时购买播报中滚动展示最近真实订单的脱敏信息，每3至5秒切换一条

### Requirement 2: 商品详情与动态表单

**User Story:** 作为普通用户，我想查看商品详情并根据商品要求填写开通信息，以便正确下单。

#### Acceptance Criteria

1. WHEN 用户点击商品卡片, THE Miniprogram SHALL 跳转到商品详情页展示品牌Hero区、会员类型选择、套餐选择、关键须知和权益对比表
2. WHEN 商品包含多个会员类型, THE Miniprogram SHALL 展示会员类型选择卡片，用户切换类型时刷新下方套餐和价格
3. WHEN 用户选择套餐, THE Miniprogram SHALL 同步更新底部支付栏的合计金额
4. THE Miniprogram SHALL 根据商品的Attach_Template动态渲染底部输入表单，支持text、select、radio、checkbox、cascader输入类型
5. WHILE Attach_Template中某字段type为text且tip包含手机号提示, THE Miniprogram SHALL 对该输入框进行11位大陆手机号格式校验
6. WHILE 用户未完成Attach_Template中所有必填字段, THE Miniprogram SHALL 将购买按钮置为不可点击的禁用状态
7. THE Miniprogram SHALL 在商品详情页底部固定展示支付栏，包含动态渲染的输入区域和购买按钮

### Requirement 3: 下单与支付

**User Story:** 作为普通用户，我想确认订单信息后完成微信支付，以便购买会员服务。

#### Acceptance Criteria

1. WHEN 用户点击购买按钮, THE Miniprogram SHALL 弹出购买核对底部弹窗，展示开通商品、会员类型、套餐周期、充值账号（脱敏）和应付金额
2. WHEN 购买核对弹窗弹出时, THE Payment_System SHALL 重新校验当前商品套餐价格是否与用户选择时一致
3. IF 弹窗校验时发现价格已变更, THEN THE Miniprogram SHALL 关闭弹窗并提示用户重新选择套餐
4. WHEN 用户点击确认并微信支付, THE Payment_System SHALL 调用微信支付统一下单接口生成预付单并唤起微信支付
5. WHEN 微信支付成功, THE Miniprogram SHALL 跳转到支付结果页展示支付成功信息和订单摘要
6. IF 微信支付取消或失败, THEN THE Miniprogram SHALL 保留购买核对弹窗供用户重试，不清空已填写信息
7. THE Payment_System SHALL 在创建订单时锁定用户实付金额，后续套餐改价不影响已创建订单

### Requirement 4: 自动开通链路

**User Story:** 作为普通用户，我想在支付成功后系统自动为我开通会员，无需等待人工处理。

#### Acceptance Criteria

1. WHEN 微信支付回调确认支付成功, THE Cloud_Function SHALL 创建本地订单记录并将状态设为已支付
2. WHEN 订单状态变为已支付, THE Cloud_Function SHALL 携带商品ID、用户填写的attach参数、系统订单号和Callback_Endpoint调用Shunshi_API的/api/v1/order/buy接口
3. THE Cloud_Function SHALL 在调用Shunshi_API下单时传入Safe_Price参数，其值等于用户实付金额，防止上游调价导致亏本
4. WHEN Shunshi_API返回下单成功（含ordersn）, THE Order_System SHALL 记录顺势订单号并将订单状态更新为开通中
5. IF Shunshi_API下单返回错误, THEN THE Order_System SHALL 记录错误返回码和失败原因，将订单状态设为接口失败
6. WHEN Shunshi_API通过Callback_Endpoint发送异步回调且status为3（交易成功）, THE Cloud_Function SHALL 验证回调签名后将订单状态更新为开通成功
7. WHEN Shunshi_API通过Callback_Endpoint发送异步回调且status为4或5（取消或退款）, THE Cloud_Function SHALL 验证回调签名后将订单状态更新为接口失败
8. WHILE 订单处于开通中状态超过10分钟未收到回调, THE Cloud_Function SHALL 主动调用Shunshi_API的/api/v1/order/info接口查询订单最新状态
9. THE Cloud_Function SHALL 在接收到顺势回调后返回字符串"ok"，确认已成功处理

### Requirement 5: 回调签名验证

**User Story:** 作为系统运维方，我想确保接收到的回调通知来自顺势权益平台，防止伪造请求篡改订单状态。

#### Acceptance Criteria

1. WHEN Callback_Endpoint接收到POST请求, THE Cloud_Function SHALL 从请求体中提取sign字段进行签名验证
2. THE Cloud_Function SHALL 按照以下规则验证回调签名：移除sign、card_list、express_list字段，剩余字段按key字典序排列，计算sha1(time + json_encode(排序后参数) + apikey)并与sign字段比对
3. IF 回调签名验证失败, THEN THE Cloud_Function SHALL 拒绝处理该回调请求并记录异常日志
4. THE Cloud_Function SHALL 将apikey仅存储在云函数环境变量中，前端代码和云数据库中不存储密钥

### Requirement 6: 退款流程

**User Story:** 作为普通用户，我想在会员开通失败时获得原路退款，保障资金安全。

#### Acceptance Criteria

1. WHEN 管理员在订单处理页对接口失败的订单点击发起退款, THE Admin_Panel SHALL 弹出退款弹窗要求选择失败原因分类并可填写补充说明
2. WHEN 管理员确认退款, THE Payment_System SHALL 调用微信支付退款接口按原路退回用户实付金额
3. WHEN 退款发起成功, THE Order_System SHALL 将订单状态更新为退款中
4. WHEN 微信支付退款回调确认退款成功, THE Order_System SHALL 将订单状态更新为已退款
5. THE Audit_Logger SHALL 记录退款操作，包含操作人、操作时间、退款金额和失败原因

### Requirement 7: 订单管理（用户端）

**User Story:** 作为普通用户，我想查看和追踪我的订单状态，了解会员开通进度。

#### Acceptance Criteria

1. WHEN 用户进入我的订单页, THE Miniprogram SHALL 展示状态筛选Tab（全部/开通中/开通成功/退款）和对应的订单卡片列表，默认选中"全部"Tab，按下单时间倒序排列，每页加载20条，触底加载下一页
2. THE Miniprogram SHALL 在每张订单卡片中展示商品名称（最多显示20个字符，超出截断）、订单状态、充值账号（保留前3位和后4位，中间用4个星号替代）、订单号、支付金额（精确到分）和下单时间（格式：YYYY-MM-DD HH:mm）
3. WHEN 订单状态为开通中, THE Miniprogram SHALL 展示查看进度和刷新进度按钮
4. WHEN 用户点击刷新进度, THE Order_System SHALL 在5秒内调用Shunshi_API的/api/v1/order/info接口重新查询该订单最新状态并更新本地记录，刷新期间按钮显示loading状态且不可重复点击
5. IF 用户点击刷新进度时Shunshi_API请求失败或超时, THEN THE Miniprogram SHALL 恢复按钮为可点击状态并提示"查询失败，请稍后重试"
6. WHEN 用户点击再买一次, THE Miniprogram SHALL 跳转到对应商品详情页并自动选中相同套餐
7. IF 用户点击再买一次时该商品已下架, THEN THE Miniprogram SHALL 弹窗提示"该商品暂不可购买，可返回分类选择其他商品"
8. THE Miniprogram SHALL 在订单详情页以时间轴形式展示订单完整流转记录，每个节点包含状态名称和对应时间（格式：YYYY-MM-DD HH:mm:ss），节点包括：支付成功、提交开通、开通中、开通成功/接口失败/已退款

### Requirement 8: 订单管理（管理端）

**User Story:** 作为管理员，我想查看和处理异常订单，保障用户权益和系统正常运行。

#### Acceptance Criteria

1. WHEN 管理员进入订单处理页, THE Admin_Panel SHALL 展示状态筛选Tab（全部/开通中/接口失败/退款中）和对应的订单卡片列表，默认选中"全部"Tab，按下单时间倒序排列，每页加载20条
2. THE Admin_Panel SHALL 在每张订单卡片中展示商品名、状态、充值手机号（保留前3位和后4位，中间用4个星号替代）、订单号、三方单号（顺势ordersn）、用户实付金额、接口成本和预计利润（实付金额减去接口成本）
3. WHEN 管理员点击订单卡片进入订单详情, THE Admin_Panel SHALL 展示完整手机号、状态时间轴、操作按钮（重试开通、查询接口、发起退款）和接口调用日志
4. WHEN 管理员对开通中或接口失败的订单点击重试开通, THE Cloud_Function SHALL 重新调用Shunshi_API的/api/v1/order/buy接口提交开通请求，同一订单最多允许重试3次
5. IF 管理员重试开通时该订单已达到最大重试次数（3次）, THEN THE Admin_Panel SHALL 禁用重试按钮并提示"已达最大重试次数，请手动处理"
6. WHEN 管理员点击查询接口, THE Cloud_Function SHALL 调用Shunshi_API的/api/v1/order/info接口查询订单最新状态并更新本地记录，查询结果在3秒内返回
7. THE Admin_Panel SHALL 在订单详情页展示接口日志区，包含每次API调用的请求时间（格式：YYYY-MM-DD HH:mm:ss）、返回码、返回描述和耗时（单位：毫秒）

### Requirement 9: 商品运营管理

**User Story:** 作为管理员，我想管理商品的上下架状态、价格和分类，保持商品信息的准确性。

#### Acceptance Criteria

1. WHEN 管理员进入商品运营页, THE Admin_Panel SHALL 展示商品数据概览（全部/已上架/已下架数量）、快捷操作按钮（同步商品、新增商品）和商品列表
2. THE Admin_Panel SHALL 在每张商品卡片中展示商品名、上架状态（已上架/已下架）、售价、接口成本、单单利润（售价减去接口成本）、接口商品ID和今日销量
3. WHEN 管理员切换商品的上下架开关, THE Admin_Panel SHALL 弹出确认弹窗显示即将执行的操作（上架或下架），管理员确认后立即更新商品状态
4. WHEN 商品被下架, THE Product_System SHALL 在用户端首页、分类页和搜索结果中不再展示该商品，已在用户购物流程中的该商品页面提示"该商品已下架"
5. WHEN 管理员编辑商品, THE Admin_Panel SHALL 展示基础信息表单（商品名最多30个字符、分类选择、充值方式、接口商品ID、排序权重范围0-9999）、套餐价格管理和售前规则配置
6. THE Product_System SHALL 要求每个商品至少配置一个套餐，且必须指定一个默认套餐；套餐售价必须大于0且不超过99999.99元
7. WHEN 管理员修改套餐价格并保存, THE Product_System SHALL 使新价格仅对后续新订单生效，已创建的待支付订单保持原锁定价格
8. WHEN 管理员点击同步商品按钮, THE Admin_Panel SHALL 从Shunshi_API同步商品分类和商品列表，同步完成后展示同步结果（新增数量、更新数量、失败数量），管理员在此基础上配置售价和展示信息
9. IF 管理员设置的套餐售价低于该商品的接口成本, THEN THE Admin_Panel SHALL 显示亏损警告提示"售价低于成本，将产生亏损"，但不阻止保存

### Requirement 10: 数据看板

**User Story:** 作为管理员，我想查看核心运营数据和订单状态概览，掌握业务运行情况。

#### Acceptance Criteria

1. WHEN 管理员进入数据看板, THE Admin_Panel SHALL 展示今日（当日0:00至当前时刻）销售额、今日订单数、开通成功率（开通成功订单数÷已支付总订单数×100%）和接口失败数四个核心指标
2. THE Admin_Panel SHALL 以双折线图展示近7个自然日（含今日）的每日销售额和每日订单量趋势
3. THE Admin_Panel SHALL 以圆环图展示开通成功订单中各分类的占比（视频/音乐/网盘/工具），统计范围为近30个自然日
4. THE Admin_Panel SHALL 展示待办订单列表，支持按状态（开通中/接口失败/退款中）筛选，最多展示最近50条，按时间倒序排列
5. THE Admin_Panel SHALL 展示最近20条操作记录审计日志，每条记录包含操作人、时间（格式：MM-DD HH:mm）、动作描述和备注
6. THE Admin_Panel SHALL 展示商品销量排行榜前10名商品，展示商品名和对应销量，统计范围为近7个自然日

### Requirement 11: 通知服务

**User Story:** 作为普通用户，我想在订单状态发生变化时收到微信通知，及时了解开通进度。

#### Acceptance Criteria

1. WHEN 订单状态变为开通成功, THE Notification_Service SHALL 在状态变更后60秒内通过微信订阅消息通知用户，消息内容包含商品名称、充值账号（脱敏）和开通成功时间
2. WHEN 订单状态变为接口失败, THE Notification_Service SHALL 在状态变更后60秒内通过微信订阅消息通知用户开通失败，消息内容包含商品名称和退款进度说明
3. WHEN 订单状态变为已退款, THE Notification_Service SHALL 在状态变更后60秒内通过微信订阅消息通知用户退款已到账，消息内容包含退款金额和退款时间
4. THE Notification_Service SHALL 在发送订阅消息前检查用户是否已授权对应模板的订阅权限
5. IF 用户未授权订阅消息权限, THEN THE Notification_Service SHALL 跳过消息发送并记录日志，不影响订单状态正常流转
6. IF 订阅消息发送失败（接口错误或频率限制）, THEN THE Notification_Service SHALL 记录失败日志，不重试发送，不影响订单状态正常流转

### Requirement 12: 权限控制

**User Story:** 作为系统运维方，我想确保管理功能仅对授权人员开放，防止未授权访问。

#### Acceptance Criteria

1. WHILE 当前用户的openid存在于Admin_Whitelist中, THE Miniprogram SHALL 在我的页面展示管理员入口模块
2. WHILE 当前用户的openid不在Admin_Whitelist中, THE Miniprogram SHALL 隐藏管理员入口模块，不展示任何管理相关UI元素
3. WHEN 用户尝试访问管理端页面路由, THE Cloud_Function SHALL 校验该用户openid是否存在于Admin_Whitelist，校验在每次管理端API请求时执行
4. IF 用户openid不存在于Admin_Whitelist, THEN THE Cloud_Function SHALL 拒绝访问并返回无权限错误提示，Miniprogram将用户重定向到首页
5. THE Cloud_Function SHALL 将Admin_Whitelist存储在云数据库中，支持动态增删管理员，变更即时生效无需重启服务
6. IF Admin_Whitelist查询失败（数据库异常）, THEN THE Cloud_Function SHALL 拒绝该次管理端访问请求并记录异常日志，遵循默认拒绝原则

### Requirement 13: 审计日志

**User Story:** 作为管理员，我想追溯所有系统操作和人工操作记录，保障操作的可追踪性。

#### Acceptance Criteria

1. WHEN 管理员执行订单操作（重试开通、发起退款、标记已退款）, THE Audit_Logger SHALL 记录操作人openid、操作时间（精确到毫秒的ISO 8601格式）、操作类型、目标订单号和备注信息（备注最大长度200个字符）
2. WHEN Cloud_Function执行系统自动操作（调用Shunshi_API、处理回调、更新订单状态）, THE Audit_Logger SHALL 记录操作时间（精确到毫秒的ISO 8601格式）、操作类型、操作结果（成功/失败及错误码）和相关订单号
3. THE Audit_Logger SHALL 将所有日志记录存储在Cloud_Database中，保留期限不少于90天，支持按时间倒序分页查询（每页最多50条）
4. THE Admin_Panel SHALL 在数据看板中展示最近20条操作记录，在订单详情页展示该订单关联的全部审计日志记录
5. IF Audit_Logger写入日志失败, THEN THE Cloud_Function SHALL 将该日志条目重试写入1次，若仍失败则将日志内容输出至云函数运行日志作为兜底

### Requirement 14: 接口安全与签名

**User Story:** 作为系统运维方，我想确保与顺势权益API的所有通信安全可靠，防止数据被篡改。

#### Acceptance Criteria

1. THE Cloud_Function SHALL 在每次调用Shunshi_API时按照规则生成签名：sha1(timestamp + json_body_按key的ASCII码从小到大字典序排列后的JSON字符串 + apikey)，当请求Body无参数时json_body使用"{}"参与签名计算
2. THE Cloud_Function SHALL 在每次请求Header中传入Sign（40位小写十六进制SHA1值）、Timestamp（13位毫秒时间戳，与服务器当前时间偏差不超过5分钟）和UserId三个必填参数
3. THE Cloud_Function SHALL 将Shunshi_API的UserId和apikey仅存储在云函数环境变量中，不在前端代码、云数据库或日志中暴露
4. THE Audit_Logger SHALL 记录每次Shunshi_API调用的请求时间、接口路径（如/api/v1/order/buy）、HTTP状态码、业务返回码和请求耗时（毫秒），但不记录apikey、完整签名和用户敏感信息
5. IF Cloud_Function调用Shunshi_API时网络超时（超过15秒未响应）, THEN THE Cloud_Function SHALL 记录超时日志并将该次调用标记为失败，不进行自动重试

### Requirement 15: 隐私与数据脱敏

**User Story:** 作为普通用户，我想确保我的手机号等敏感信息在展示时得到保护。

#### Acceptance Criteria

1. THE Miniprogram SHALL 在用户端所有页面中将11位手机号以脱敏格式展示（保留前3位和后4位，中间4位以星号替代，格式为138****6066）
2. THE Admin_Panel SHALL 在订单列表页以脱敏格式展示手机号（格式同上），仅在订单详情页向已通过Admin_Whitelist校验的管理员展示完整手机号
3. THE Miniprogram SHALL 在实时购买播报中以脱敏格式展示购买用户的手机号（格式同上）
4. THE Cloud_Database SHALL 存储完整手机号原文，脱敏处理仅在前端展示层（Miniprogram和Admin_Panel）实施，Cloud_Function返回给用户端的接口响应中手机号已脱敏
5. IF 待脱敏的账号信息不符合11位手机号格式, THEN THE Miniprogram SHALL 保留首2位和末2位字符，中间以星号替代

### Requirement 16: 空状态与异常处理

**User Story:** 作为普通用户，我想在页面无数据或网络异常时看到明确的提示，了解当前状况和下一步操作。

#### Acceptance Criteria

1. WHILE 订单列表为空, THE Miniprogram SHALL 展示空状态图标和提示文案"还没有订单"及引导用户前往首页浏览商品的引导按钮
2. WHILE 当前分类下无商品, THE Miniprogram SHALL 展示空状态图标和提示文案"当前分类暂无商品"
3. WHILE 页面数据正在加载, THE Miniprogram SHALL 展示骨架屏并使用渐变动画效果，若加载时间超过10秒仍未返回数据则自动切换为网络异常提示状态
4. IF 网络请求失败（HTTP错误、超时或云函数返回错误）, THEN THE Miniprogram SHALL 展示网络异常提示文案和重试按钮，保留用户已填写的表单数据，用户点击重试后重新发起该请求
5. IF 用户输入的手机号格式不符合11位大陆手机号规则（正则：^1[3-9]\d{9}$）, THEN THE Miniprogram SHALL 在输入框下方显示红色提示文案"请输入11位大陆手机号"并阻止表单提交
6. IF 用户连续点击重试按钮3次仍失败, THEN THE Miniprogram SHALL 在异常提示中追加客服入口引导文案

### Requirement 17: 商品数据同步

**User Story:** 作为管理员，我想从顺势权益API同步商品和分类信息，减少手动录入工作量。

#### Acceptance Criteria

1. WHEN 管理员触发商品同步操作, THE Cloud_Function SHALL 调用Shunshi_API的/api/v1/goods/cate接口获取最新分类树（最多三级）并更新Cloud_Database中的分类数据
2. WHEN 管理员触发商品同步操作, THE Cloud_Function SHALL 调用Shunshi_API的/api/v1/goods/list接口分页获取全部商品列表（每页100条，自动翻页直到获取完毕）并更新Cloud_Database中的商品基础信息（goods_name、goods_img、goods_price、face_value、status、stock_num）
3. THE Product_System SHALL 在同步商品时保留管理员已配置的售价、展示名称、排序权重和上下架状态，仅更新来自Shunshi_API的字段（进货价、面值、库存、上游状态）
4. WHEN Shunshi_API返回的商品status为2（暂停）或3（禁售）, THE Product_System SHALL 自动将对应商品在小程序端设为下架状态，不覆盖管理员对status为1（销售中）商品的手动下架决定
5. WHEN 商品同步完成, THE Admin_Panel SHALL 展示同步结果摘要，包含新增商品数、更新商品数、自动下架商品数和同步耗时
6. IF 商品同步过程中Shunshi_API调用失败, THEN THE Cloud_Function SHALL 中止同步并向管理员展示错误提示（包含失败的接口路径和错误码），已成功同步的数据保留不回滚

### Requirement 18: 客服入口

**User Story:** 作为普通用户，我想快速联系客服解决订单问题。

#### Acceptance Criteria

1. WHEN 用户在我的页面点击客服图标, THE Miniprogram SHALL 弹出客服二维码弹窗，展示企业微信客服二维码图片，弹窗支持点击遮罩层或关闭按钮关闭
2. THE Miniprogram SHALL 从Cloud_Database读取客服二维码图片URL，支持管理员在后台更换，更换后用户下次打开弹窗时展示最新图片
3. WHEN 用户长按弹窗中的客服二维码图片, THE Miniprogram SHALL 调用微信识别图中二维码能力或提供保存图片到相册功能
4. IF Cloud_Database中未配置客服二维码图片URL或图片加载失败, THEN THE Miniprogram SHALL 在弹窗中展示兜底提示文案"客服暂不可用，请稍后再试"

### Requirement 19: 个人中心

**User Story:** 作为普通用户，我想在个人中心查看我的账户信息和订单统计，快速访问常用功能。

#### Acceptance Criteria

1. WHEN 用户进入我的页面, THE Miniprogram SHALL 展示用户信息区（圆形头像、用户名、副文案）、快速统计卡片、常用功能菜单和服务保障说明
2. THE Miniprogram SHALL 默认展示圆形头像占位符"U"和用户名"微信用户"，用户授权后展示微信头像和昵称
3. THE Miniprogram SHALL 展示快速统计卡片（3列）：全部订单数、处理中订单数和待退款订单数，数据从Cloud_Database实时查询
4. WHEN 用户点击快速统计卡片中的任一项, THE Miniprogram SHALL 跳转到我的订单页并自动切换到对应状态的Tab（全部订单→全部Tab，处理中→开通中Tab，待退款→退款Tab）
5. THE Miniprogram SHALL 展示常用功能菜单列表：我的订单、购买须知、账号填写说明、平台公告，每行包含菜单名称和副文案
6. WHEN 用户点击购买须知、账号填写说明或平台公告菜单项, THE Miniprogram SHALL 跳转到对应的静态富文本内容页，内容从Cloud_Database读取
7. THE Miniprogram SHALL 在页面底部展示服务保障说明（3条固定文案：不自动续费、客服联系方式、管理员入口说明）

### Requirement 20: 订单详情页（用户视角）

**User Story:** 作为普通用户，我想查看订单的完整详情和进度，了解当前开通状态和预计到账时间。

#### Acceptance Criteria

1. WHEN 用户从订单列表进入订单详情页, THE Miniprogram SHALL 展示状态Hero区（暗色卡片）、订单进度时间轴、订单信息卡片和异常说明
2. THE Miniprogram SHALL 在状态Hero区展示当前订单状态（如"开通中"）、描述文案（含脱敏账号和商品名）和三个指标：实付金额、下单时间（格式：YYYY-MM-DD HH:mm）、预计到账时间（如"1-5分钟"）
3. THE Miniprogram SHALL 以时间轴形式按时间正序展示订单流转节点，每个节点包含：状态名称、时间（格式：HH:mm:ss）和描述文案，未完成节点显示为灰色
4. THE Miniprogram SHALL 在订单信息卡片中展示：订单号（支持长按复制）、商品名、充值账号（脱敏）、当前状态（带颜色标识）
5. WHEN 用户在订单详情页点击刷新进度按钮, THE Order_System SHALL 调用Shunshi_API查询最新状态并刷新页面显示，刷新期间按钮显示loading状态
6. THE Miniprogram SHALL 在订单详情页底部展示异常说明：超过10分钟未到账系统自动重新查询、开通失败后原路退款、可复制订单号联系客服
7. WHEN 订单状态为开通失败, THE Miniprogram SHALL 在状态Hero区额外展示失败原因文案（来自Shunshi_API的recharge_hints或管理员填写的原因）

### Requirement 21: 搜索与排序筛选

**User Story:** 作为普通用户，我想通过关键词搜索并按条件筛选商品，快速找到符合需求的会员服务。

#### Acceptance Criteria

1. WHEN 用户在首页或分类页点击搜索栏, THE Miniprogram SHALL 跳转到搜索结果页并自动聚焦输入框
2. WHEN 用户输入关键词并提交搜索, THE Miniprogram SHALL 从Cloud_Database中模糊匹配商品名称和分类名称，返回所有已上架的匹配商品
3. THE Miniprogram SHALL 在搜索结果页顶部展示结果提示条，格式为"找到 X 个相关会员权益"
4. THE Miniprogram SHALL 在搜索结果页提供排序筛选Tab（综合/价格低/到账快/电视端），默认选中"综合"
5. WHEN 用户切换排序Tab为"价格低", THE Miniprogram SHALL 按商品默认套餐售价从低到高排列商品列表
6. WHEN 用户切换排序Tab为"电视端", THE Miniprogram SHALL 仅展示标记为支持电视端的商品
7. THE Miniprogram SHALL 支持用户清空搜索关键词后重新输入搜索，搜索结果实时刷新

### Requirement 22: 首页信任数据与播报配置

**User Story:** 作为管理员，我想配置首页展示的信任数据和购买播报策略，提升用户信任感。

#### Acceptance Criteria

1. THE Miniprogram SHALL 在首页信任Hero区展示三个数据指标：常规到账时间（固定文案"1-5分钟"）、累计订单数和续费说明（固定文案"0续费"）
2. THE Admin_Panel SHALL 支持管理员在Cloud_Database中配置首页累计订单数的展示值（如"8.2万+"），配置更新后用户端实时生效
3. THE Miniprogram SHALL 从Cloud_Database中读取最近20条开通成功的真实订单作为实时购买播报数据源
4. THE Miniprogram SHALL 每3至5秒随机间隔切换一条购买播报记录，播报格式为"{脱敏手机号} 刚刚购买 {商品名}"
5. IF Cloud_Database中开通成功的订单数少于5条, THEN THE Miniprogram SHALL 隐藏实时购买播报模块，不展示空播报

### Requirement 23: 订单超时与自动取消

**User Story:** 作为系统运维方，我想自动取消长时间未支付的订单，避免占用系统资源。

#### Acceptance Criteria

1. WHILE 订单处于待支付状态超过30分钟未完成支付, THE Cloud_Function SHALL 自动将该订单状态更新为已取消
2. THE Cloud_Function SHALL 通过定时触发器（每5分钟执行一次）扫描超时的待支付订单并执行自动取消
3. WHEN 订单被自动取消, THE Audit_Logger SHALL 记录取消操作，操作人标记为"系统"，备注为"超时未支付自动取消"
4. THE Miniprogram SHALL 不在用户端订单列表中展示已取消的订单（已取消订单仅管理端可见）

### Requirement 24: 商品编辑与套餐管理

**User Story:** 作为管理员，我想完整配置商品的基础信息、套餐价格和售前规则，确保商品信息准确展示给用户。

#### Acceptance Criteria

1. WHEN 管理员进入商品编辑页, THE Admin_Panel SHALL 展示基础信息表单、套餐价格列表和售前规则编辑区，底部固定预览和保存按钮
2. THE Admin_Panel SHALL 在基础信息表单中包含：商品名称（必填，最多30字符）、所属分类（必填，下拉选择）、充值方式（必填，可选项：手机号直充/账号密码/卡密/其他）、账号类型（如"大陆手机号"含校验规则提示）、接口商品ID（必填，对应Shunshi_API的商品ID）、自动开通开关（默认开启）、排序权重（数字0-9999，越小越靠前）
3. THE Admin_Panel SHALL 在套餐价格区域展示已配置的套餐列表，每个套餐显示：套餐名、会员类型、售价、成本价、接口SKU、上架状态和"默认套餐"标签
4. WHEN 管理员点击新增套餐或改价按钮, THE Admin_Panel SHALL 弹出套餐编辑弹窗，包含：套餐名（必填）、会员类型（必填）、售价（必填，大于0）、成本价（必填）、接口SKU（必填，对应Shunshi_API下单时的商品标识）、库存（可选，-1表示无限）、是否上架开关
5. THE Admin_Panel SHALL 在售前规则区域支持编辑3条规则：设备支持说明、到账时间说明和安全说明，首次创建时提供默认模板文案
6. WHEN 管理员点击保存修改, THE Product_System SHALL 校验必填项（商品名、分类、接口商品ID、至少一个套餐、已指定默认套餐），校验不通过时高亮对应字段并提示具体缺失项
7. WHEN 管理员点击预览商品按钮, THE Miniprogram SHALL 以用户视角展示该商品详情页效果，不影响实际数据和线上展示
8. WHEN 管理员修改套餐价格并保存时, THE Admin_Panel SHALL 弹出确认弹窗提示"新价格只影响后续订单；已支付订单仍按支付时锁定价格处理"
