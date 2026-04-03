# Orders And Accounts CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐账号管理与订单管理的标准增查改删能力，特别是订单页的单条读取、完整更新和删除能力。

**Architecture:** 后端在现有 Express + PostgreSQL 路由上补全缺失的 `DELETE /api/accounts/:id`、`GET /api/orders/:id`、`PUT /api/orders/:id`、`DELETE /api/orders/:id`，并显式处理账号删前引用校验。前端将订单创建与编辑收敛到统一表单状态，账号页补删除按钮，订单页补删除和完整编辑链路，同时维持结算页只负责收款子域。

**Tech Stack:** React 19, TypeScript, Express 5, PostgreSQL 16, Node test runner, Docker Compose

---

### Task 1: Back-End Route Tests

**Files:**
- Create: `backend/src/ordersAccounts.routes.test.ts`
- Modify: `backend/src/createApp.test.ts`

- [ ] 为账号删除引用约束、订单单条读取、订单完整更新、订单删除写失败测试
- [ ] 运行后端目标测试，确认当前实现失败

### Task 2: Back-End CRUD Routes

**Files:**
- Modify: `backend/src/createApp.ts`
- Modify: `backend/db/init.sql`（仅当约束需补充时）

- [ ] 实现 `DELETE /api/accounts/:id`，存在订单引用时返回 `409`
- [ ] 实现 `GET /api/orders/:id`
- [ ] 实现 `PUT /api/orders/:id`
- [ ] 实现 `DELETE /api/orders/:id`
- [ ] 运行后端全量测试，确认通过

### Task 3: Front-End Order Form Refactor

**Files:**
- Create: `frontend/src/lib/orderForm.ts`
- Create: `frontend/src/lib/orderForm.test.ts`
- Modify: `frontend/src/components/AccountSelect.tsx`
- Modify: `frontend/src/components/SkuPicker.tsx`
- Modify: `frontend/src/pages/OrdersPage.tsx`

- [ ] 提取订单表单初始化与 payload 构造逻辑
- [ ] 补纯函数测试覆盖创建态、编辑态和金额汇总
- [ ] 将订单页改成统一创建/编辑表单，并补订单删除按钮
- [ ] 用本地状态更新替代不必要的全量重拉

### Task 4: Front-End Account Delete

**Files:**
- Modify: `frontend/src/pages/AccountsPage.tsx`

- [ ] 补账号删除按钮和冲突提示
- [ ] 删除成功后本地列表即时移除

### Task 5: Docs And Verification

**Files:**
- Modify: `README.md`
- Modify: `scripts/smoke-test.mjs`

- [ ] README 补齐账号/订单 CRUD 接口与行为约束
- [ ] 扩展 smoke 覆盖账号删除约束和订单 CRUD
- [ ] 运行后端测试、前端测试、前后端 build、smoke、现网重建验证
- [ ] 提交并推送 `main`
