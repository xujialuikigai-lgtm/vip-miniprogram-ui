# 会员多多购（主项目）

本目录是**唯一主项目**，包含完整的小程序前端、云函数、设计文档与 git 版本管理。
微信开发者工具 / 云开发的部署均以本目录为准。

> 旧的 `小程序` 目录仅作历史存档，不再用于开发或部署，避免出现「改了 A、部署了 B」的分叉问题。

## 目录说明

| 目录 / 文件 | 说明 |
| --- | --- |
| `miniprogram/` | 小程序前端源码（页面、组件） |
| `cloudfunctions/` | 云函数源码（`.ts`）与编译产物（`.js`） |
| `database/` | 数据库相关 |
| `i18n/` `miniapp/` | 多语言与 miniapp 配置 |
| `.kiro/specs/vip-miniprogram/` | 需求 / 设计 / 任务 规格文档 |
| `vip-miniprogram-requirements.md` | 需求文档 |
| `vip-miniprogram-ui.html` | UI 设计原型 |
| `shunshi-api-reference.md` | 顺势接口参考 |
| `会员多多.docx` | 原始需求 Word |

## 云函数构建与部署

云函数用 TypeScript 编写，运行时只认编译后的 JavaScript。

- 编辑代码 → 只改 `.ts`，不要手改 `.js`（会被编译覆盖）。
- 部署实际运行的是各云函数根目录的 `index.js`（由 `tsconfig.build.json` 编译，`outDir: "."`）。
- 改完 `.ts` 后，在对应云函数目录执行编译再上传部署：

```bash
# 以 product 为例
cd cloudfunctions/product
npx tsc -p tsconfig.build.json   # 生成根目录 index.js（部署用）
```

> 编译时会出现若干 wx-server-sdk 类型告警（如 `res.data`、`countRes.total`），属既有问题，`tsc` 仍会正常产出 `.js`，可忽略。

## product 商品同步（syncProducts）注意事项

`product` 云函数的 `syncProducts` 用于从顺势同步分类与商品。已做如下性能优化以规避云函数 60 秒超时：

- 分类商品列表**并发拉取**（`NET_CONCURRENCY=8`）。
- 已存在商品**一次性批量查询**（`db.command.in` 分批 + 并发），不再逐条串行查询。
- 更新 / 新增**并发执行**（`DB_CONCURRENCY=10`）。
- **新增商品不再逐个调用 `getProductDetail`**：首次全量同步时商品都算新增，逐个拉详情会必然超时。
  - 因此新增商品的 `attachTemplate` 留空、`description` 留空，需要这些字段的商品请在**管理端商品编辑页手动配置**。

若商品量极大、并发优化后仍接近 60 秒，则需改为**异步任务化**（后台分批处理 + 前端轮询进度），彻底摆脱 60 秒限制。
