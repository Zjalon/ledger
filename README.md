# Cent（oncent-next）

基于 **Vue 3 + Vite** 的协作记账 **PWA**：纯前端应用，账本数据以 JSON 存放在用户的 **Gitee** 私有仓库中，通过增量同步与协作者共享。

## 功能概览

- Gitee OAuth 或手动 Token 登录
- 多账本（每个账本对应一个 Gitee 仓库）
- 首页流水、统计、资产账户、个人设置
- 支出 / 收入 / 转账记账（底部「记一笔」）
- 自定义分类（`meta.json` 与账单一并同步）
- 离线优先：IndexedDB 暂存，联网后同步到远端

## 开发与构建

```bash
pnpm install
pnpm dev      # 本地开发（--host）
pnpm lint     # vue-tsc + Biome（仅 error 级别）
pnpm build    # 先 lint 再生产构建
pnpm check    # Biome 写入式格式化与修复
```

提交前 Husky 会运行 `pnpm lint` 与 commitlint（Conventional Commits）。

## 目录说明（节选）

| 路径 | 说明 |
|------|------|
| `src/pages/` | 路由页面，按路径分子目录（如 `login/`、`home/`、`profile/categories/`） |
| `src/router/` | 路由与导航守卫（内存 history） |
| `src/tidal/` | 与 Gitee 交互的同步引擎 |
| `src/database/` | IndexedDB、Stash、调度器 |
| `src/api/endpoints/gitee/` | Gitee 同步端点实现 |
| `src/ledger/` | 账单与分类等类型与中文预设 |

## 架构要点（协作 / AI 辅助）

- 路由与守卫见 `src/router/index.ts`；Token `localStorage` 键 `gitee_user_token`，当前账本 `selected_book_id`。
- 同步：`src/tidal/index.ts` 协调分片与 `meta.json`；`src/api/endpoints/gitee/index.ts` 暴露 `SyncEndpoint`。
- 数据模型与内置分类：`src/ledger/type.ts`、`src/ledger/category-zh-presets.ts`。

## 环境变量

在 `.env` 或部署平台中配置（前缀 `VITE_`）：

- `VITE_LOGIN_API_HOST` — OAuth 登录回调所用服务（若有）
- `VITE_RATE_API_HOST` — 汇率接口（若有）
- `VITE_GTAG_SCRIPT` — Google Analytics 脚本（可选）

## 贡献

1. 提交前执行 `pnpm lint`，提交说明遵循 Conventional Commits（如 `feat:`、`fix:`）。
2. 报告问题请使用 GitHub Issues，并附复现步骤与环境信息。

## 许可证

见仓库根目录 [LICENSE](./LICENSE)（CC BY-NC-SA 4.0）。
