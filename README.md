# 发货管家 (dt_shipment)

> 专为电商卖家设计的轻量发货管理系统。支持多账号、多订单类型（零售 / 批发）、CSV 批量导入、发货状态追踪与批发结算管理。前端是 PWA，可以直接安装到手机桌面，当作 App 使用。

---

## 目录

- [功能概览](#功能概览)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [用户手册（小白必读）](#用户手册小白必读)
  - [第一步：安装必要工具](#第一步安装必要工具)
  - [第二步：拉取项目代码](#第二步拉取项目代码)
  - [第三步：启动数据库](#第三步启动数据库)
  - [第四步：配置并启动后端](#第四步配置并启动后端)
  - [第五步：配置并启动前端](#第五步配置并启动前端)
  - [第六步：打开页面，开始使用](#第六步打开页面开始使用)
- [各功能页面使用说明](#各功能页面使用说明)
  - [登录](#登录)
  - [数据看板](#数据看板)
  - [账号管理](#账号管理)
  - [商品管理](#商品管理)
  - [订单管理](#订单管理)
  - [结算管理](#结算管理)
- [安装到手机桌面（PWA）](#安装到手机桌面pwa)
- [常见问题排查](#常见问题排查)
- [API 接口一览](#api-接口一览)
- [环境变量说明](#环境变量说明)

---

## 功能概览

| 功能模块 | 说明 |
|---|---|
| 账号管理 | 管理多个电商平台账号（如闲鱼店铺、抖音小店等），区分混合 / 零售 / 批发业务类型 |
| 商品管理 | SKU 录入与维护，支持规格、单价、库存 ID 等字段 |
| 订单管理 | 新增 / 编辑订单，支持零售和批发两种类型，可批量 CSV 导入，支持发货状态更新和异常标记 |
| 结算管理 | 专为批发订单设计，记录收款金额和时间，自动汇总各客户欠款情况 |
| 数据看板 | 全局数据统计概览 |
| PWA 支持 | 可安装到手机 / 电脑桌面，像 App 一样使用，支持基础离线访问 |

---

## 技术栈

**前端**

- React 19 + TypeScript
- Vite（构建工具）
- antd-mobile（移动端 UI 组件库）
- react-router-dom（页面路由）
- vite-plugin-pwa + Workbox（PWA 离线缓存）
- xlsx（Excel / CSV 文件解析）

**后端**

- Node.js + Express 5
- TypeScript
- JWT（登录鉴权，Token 有效期 7 天）
- bcryptjs（密码加密）
- pg（PostgreSQL 客户端）

**数据库**

- PostgreSQL 16（通过 Docker 运行）

**部署**

- Docker Compose（负责启动数据库容器）

---

## 项目结构

```
dt_shipment/
├── docker-compose.yml          # 数据库容器配置
├── backend/                    # 后端（Node.js + Express）
│   ├── .env.example            # 环境变量模板
│   ├── package.json
│   ├── tsconfig.json
│   ├── db/
│   │   └── init.sql            # 数据库建表 SQL
│   └── src/
│       ├── server.ts           # 主服务入口，所有 API 路由
│       ├── auth.ts             # JWT 鉴权逻辑
│       ├── db.ts               # 数据库连接池
│       └── scripts/
│           └── initDb.ts       # 初始化数据库的脚本
└── frontend/                   # 前端（React + Vite）
    ├── .env.example            # 环境变量模板
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── App.tsx             # 路由入口
        ├── pages/              # 各功能页面
        │   ├── LoginPage.tsx
        │   ├── DashboardPage.tsx
        │   ├── AccountsPage.tsx
        │   ├── OrdersPage.tsx
        │   ├── ProductsPage.tsx
        │   └── SettlementsPage.tsx
        ├── components/         # 公共组件
        └── lib/                # 工具函数（API 请求、Session 等）
```

---

## 用户手册（小白必读）

> 如果你从来没有跑过这类项目，按照下面的步骤一步一步来，不要跳步骤。

### 第一步：安装必要工具

你需要在电脑上安装以下三样东西：

**1. Node.js（运行 JavaScript 的环境）**

打开 https://nodejs.org，下载并安装 **LTS 版本**（页面上标注"推荐"的那个）。

安装完成后，打开终端（Windows 叫"命令提示符"或"PowerShell"，Mac 叫"终端"），输入：

```bash
node -v
```

如果看到类似 `v20.x.x` 的版本号，说明安装成功。

**2. Docker Desktop（用来运行数据库）**

打开 https://www.docker.com/products/docker-desktop，下载并安装适合你系统的版本。

安装完后打开 Docker Desktop，等待它完全启动（任务栏里的小鲸鱼图标变成绿色）。

安装完成后在终端输入验证：

```bash
docker -v
```

看到版本号就说明正常。

**3. Git（用来下载代码）**

打开 https://git-scm.com，下载并安装。

安装完成后验证：

```bash
git -v
```

---

### 第二步：拉取项目代码

在终端里，先进入你想存放项目的目录（比如桌面），然后执行：

```bash
git clone https://github.com/Maotiannan/dt_shipment.git
cd dt_shipment
```

现在你的电脑上就有了项目的所有代码。

---

### 第三步：启动数据库

在项目根目录（`dt_shipment/` 文件夹里），执行：

```bash
docker-compose up -d
```

这条命令会自动下载 PostgreSQL 数据库镜像并在后台启动。

**第一次执行会下载镜像，需要等几分钟，视网速而定。**

验证数据库是否启动成功：

```bash
docker ps
```

如果看到 `dt_ship_postgres` 容器的状态是 `Up`，就说明数据库正在运行。

---

### 第四步：配置并启动后端

**4.1 进入后端目录并安装依赖**

```bash
cd backend
npm install
```

等待安装完成（大约 1-2 分钟）。

**4.2 创建环境配置文件**

将 `.env.example` 文件复制一份，命名为 `.env`：

- Mac / Linux：
  ```bash
  cp .env.example .env
  ```
- Windows（命令提示符）：
  ```cmd
  copy .env.example .env
  ```

用任意文本编辑器打开 `.env` 文件，内容如下，根据需要修改：

```env
PORT=8787                        # 后端端口号，默认 8787，不用改
JWT_SECRET=replace-this-secret   # ⚠️ 必须改成你自己的随机字符串，越长越安全
ADMIN_USERNAME=admin             # 登录账号，可以改成你想要的
ADMIN_PASSWORD=123456            # ⚠️ 登录密码，必须改成你自己的密码

DB_HOST=localhost                # 数据库地址，不用改
DB_PORT=5432                     # 数据库端口，不用改
DB_USER=postgres                 # 数据库用户名，不用改
DB_PASSWORD=postgres             # 数据库密码，不用改
DB_NAME=dt_ship_manager          # 数据库名，不用改
```

> **重要提示**：`JWT_SECRET` 和 `ADMIN_PASSWORD` 一定要改，不要用默认值上线。

**4.3 初始化数据库（只需要执行一次）**

```bash
npm run db:init
```

看到 `DB initialized.` 说明数据库表创建成功。

**4.4 启动后端服务**

```bash
npm run dev
```

看到 `backend running on http://localhost:8787` 说明后端已经成功运行。

> **注意**：这个终端窗口不要关，关掉后端就停了。

---

### 第五步：配置并启动前端

**新开一个终端窗口**，进入前端目录：

```bash
cd dt_shipment/frontend
npm install
```

等待安装完成。

**5.1 创建环境配置文件**

将 `.env.example` 复制为 `.env`：

- Mac / Linux：
  ```bash
  cp .env.example .env
  ```
- Windows：
  ```cmd
  copy .env.example .env
  ```

打开 `.env` 文件，内容如下：

```env
VITE_API_BASE=http://localhost:8787   # 后端地址，如果你没改端口号就不用动
VITE_VAPID_PUBLIC_KEY=                # Web Push 推送公钥，暂时留空即可
```

**5.2 启动前端开发服务**

```bash
npm run dev
```

看到类似以下输出就说明成功：

```
  VITE v7.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
```

> **注意**：这个终端窗口同样不要关。

---

### 第六步：打开页面，开始使用

打开浏览器，访问：

```
http://localhost:5173
```

你会看到登录页面。输入你在 `.env` 里配置的 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 登录即可。

**至此，系统已完整跑起来了。**

---

## 各功能页面使用说明

### 登录

打开系统后自动跳转到登录页。输入账号和密码后点击登录按钮，Token 会自动保存在浏览器里，有效期 **7 天**，期间不需要重复登录。

退出登录可以点击菜单中的退出按钮。

---

### 数据看板

登录后默认进入看板页，展示全局数据概览，包括订单总量、各状态订单数量等统计信息，方便快速掌握整体运营情况。

---

### 账号管理

这里管理你的各个电商平台账号，比如多个闲鱼店铺、抖音小店账号等。

**字段说明：**

| 字段 | 说明 |
|---|---|
| 账号名称 | 你给这个账号起的名字，方便识别 |
| 业务类型 | `mixed`（混合）/ `retail`（零售）/ `wholesale`（批发），用于区分该账号主要跑哪类订单 |
| 状态 | `active`（正常使用）/ `inactive`（已停用） |
| 备注 | 额外说明，比如平台名称、店铺链接等 |

**操作方法：**

- 点击"新增账号"按钮填写信息并保存
- 点击已有账号卡片上的"编辑"按钮可以修改信息
- 停用的账号不会出现在订单创建的账号选择列表里

---

### 商品管理

管理你销售的所有 SKU（商品款式）。

**字段说明：**

| 字段 | 说明 |
|---|---|
| SKU 编码 | 商品的内部编号，可以对应仓库或平台的编号，选填 |
| 商品名称 | 必填，商品的名称 |
| 规格 | 比如颜色、尺寸，选填 |
| 单价 | 该 SKU 的售价 |
| 分类 | 商品分类，选填 |
| 库存 ID | 对应外部库存系统的 ID，选填 |
| 状态 | `active`（在售）/ `inactive`（下架） |

**操作方法：**

- 点击"新增商品"填写信息保存
- 点击编辑可以修改已有商品信息
- 下架的商品不会出现在订单创建时的商品选择列表里

---

### 订单管理

核心模块，管理所有发货订单。

**订单类型：**

- `retail`（零售）：单笔消费者订单，通常来自电商平台
- `wholesale`（批发）：大客户批量采购，涉及结算管理

**发货状态说明：**

| 状态值 | 含义 |
|---|---|
| `pending` | 待发货，刚创建的订单默认为此状态 |
| `shipped` | 已发货，填写快递单号后标记 |
| `returned` | 已退货 |

**异常订单标记：**

如果订单出现问题（如地址错误、客户投诉等），可以勾选"异常"并选择异常类型，方便后续处理。

**新增订单（手动）：**

1. 点击"新增订单"按钮
2. 选择对应的账号
3. 选择订单类型（零售 / 批发）
4. 填写买家姓名、收货地址
5. 添加商品（从已录入的 SKU 中选择，可添加多个）
6. 系统会自动根据单价和数量计算总金额
7. 保存

**批量导入订单（CSV）：**

如果你有从平台导出的订单表格，可以通过 CSV 导入功能批量录入，节省手动录入时间。

1. 点击"导入 CSV"按钮
2. 选择符合格式要求的 CSV 文件
3. 系统会自动解析并导入，重复的订单 ID 会自动更新而非重复创建

**更新发货状态：**

1. 找到对应订单，点击"发货/更新"
2. 修改发货状态为 `shipped`
3. 填写快递单号和快递公司
4. 保存

---

### 结算管理

专门针对**批发订单**的收款管理模块。

**页面上半部分 - 客户欠款汇总：**

系统会按买家姓名自动汇总所有未完全收款的批发订单，显示每个客户的总欠款金额和涉及的订单数量。欠款越多的客户显示在越前面。

**页面下半部分 - 订单级收款更新：**

这里展示所有批发订单列表，每行显示：订单号、客户名、订单总金额、已收金额、当前欠款、结算状态、最近收款时间。

**结算状态说明：**

| 状态 | 含义 |
|---|---|
| `unpaid` | 未收款 |
| `partial` | 部分收款（已收金额大于 0 但小于总金额） |
| `paid` | 已全额收款 |

系统会根据你填写的已收金额**自动计算**并更新结算状态，不需要手动选择。

**更新收款操作：**

1. 找到对应订单，点击"收款/更新"按钮
2. 弹窗中会显示订单总金额（只读）
3. 在"已收金额"栏填写截至目前**实际收到的总金额**（注意：这是覆盖写入，不是追加）
4. 选择收款时间
5. 可以填写收款备注（如"收到定金 500"、"尾款已结清"）
6. 点击"保存更新"

可以在顶部搜索框输入订单号或客户姓名来快速筛选。

---

## 安装到手机桌面（PWA）

发货管家支持 PWA（渐进式 Web 应用），可以像 App 一样安装到手机或电脑桌面，不需要应用商店。

**iOS（Safari 浏览器）：**

1. 用 Safari 打开网站
2. 点击底部的"分享"按钮（方块加箭头的图标）
3. 在弹出菜单中找到"添加到主屏幕"
4. 点击"添加"

**Android（Chrome 浏览器）：**

1. 用 Chrome 打开网站
2. 点击右上角的三个点菜单
3. 选择"添加到主屏幕"或"安装应用"
4. 确认安装

**桌面端（Chrome / Edge）：**

打开网站后，地址栏右侧会出现一个安装图标，点击即可安装到桌面。

安装后可以全屏运行，体验和原生 App 基本一致，且支持基础离线缓存。

---

## 常见问题排查

**Q：启动后端时报错"connect ECONNREFUSED 127.0.0.1:5432"**

数据库没有正常运行。检查步骤：

1. 确认 Docker Desktop 是否已打开并正在运行
2. 执行 `docker ps` 查看是否有 `dt_ship_postgres` 容器在运行
3. 如果没有，重新执行 `docker-compose up -d`

**Q：执行 `npm install` 时报错**

1. 确认 Node.js 版本在 18 以上：`node -v`
2. 尝试删除 `node_modules` 文件夹后重新安装：
   ```bash
   rm -rf node_modules   # Mac/Linux
   rmdir /s node_modules  # Windows
   npm install
   ```

**Q：登录时提示"账号或密码错误"**

检查 `backend/.env` 文件中的 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 是否和你输入的一致。修改 `.env` 后需要重启后端服务（Ctrl+C 停止，再执行 `npm run dev`）。

**Q：前端页面打开是空白或一直加载**

1. 确认后端服务已正常启动，访问 `http://localhost:8787/api/health` 应该返回 `{"ok":true}`
2. 确认 `frontend/.env` 中的 `VITE_API_BASE` 地址和端口与后端一致

**Q：CSV 导入失败**

确认 CSV 文件的列字段与系统要求的格式一致。可以先手动创建一条订单，然后参照系统数据格式来整理你的 CSV 文件。

**Q：如何完全停止所有服务**

- 按 `Ctrl+C` 停止前端和后端的终端进程
- 执行 `docker-compose down` 停止数据库容器

---

## API 接口一览

所有接口（除登录外）都需要在请求头中携带 Token：

```
Authorization: Bearer <你的token>
```

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查，无需鉴权 |
| POST | `/api/auth/login` | 登录，返回 JWT Token |
| GET | `/api/auth/me` | 获取当前登录用户信息 |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/accounts` | 获取所有账号列表 |
| POST | `/api/accounts` | 创建账号 |
| PUT | `/api/accounts/:id` | 更新账号信息 |
| GET | `/api/skus` | 获取所有 SKU 列表 |
| POST | `/api/skus` | 创建 SKU |
| PUT | `/api/skus/:id` | 更新 SKU 信息 |
| GET | `/api/orders` | 获取订单列表（支持 `?order_type=retail/wholesale` 过滤） |
| POST | `/api/orders` | 创建订单 |
| PATCH | `/api/orders/:id` | 更新订单发货状态 |
| PATCH | `/api/orders/:id/paid` | 更新订单收款信息 |
| POST | `/api/orders/bulkUpsert` | 批量导入/更新订单 |
| POST | `/api/push-subscriptions` | 注册 Web Push 推送订阅 |

---

## 环境变量说明

### 后端 `backend/.env`

| 变量名 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8787` | 后端监听端口 |
| `JWT_SECRET` | `replace-this-secret` | JWT 签名密钥，**生产环境必须修改为强随机字符串** |
| `ADMIN_USERNAME` | `admin` | 管理员登录账号 |
| `ADMIN_PASSWORD` | `123456` | 管理员登录密码（明文），**必须修改** |
| `ADMIN_PASSWORD_HASH` | 空 | 如果填写，则优先使用 bcrypt 哈希值验证密码，填写后 `ADMIN_PASSWORD` 失效 |
| `DB_HOST` | `localhost` | 数据库主机地址 |
| `DB_PORT` | `5432` | 数据库端口 |
| `DB_USER` | `postgres` | 数据库用户名 |
| `DB_PASSWORD` | `postgres` | 数据库密码 |
| `DB_NAME` | `dt_ship_manager` | 数据库名称 |

### 前端 `frontend/.env`

| 变量名 | 默认值 | 说明 |
|---|---|---|
| `VITE_API_BASE` | `http://localhost:8787` | 后端 API 地址，部署到服务器时需要改成服务器地址 |
| `VITE_VAPID_PUBLIC_KEY` | 空 | Web Push 推送的 VAPID 公钥，暂未启用可以留空 |

---

## 生产部署建议

如果你想把这个系统部署到服务器上供多人访问：

1. 将前端打包为静态文件：
   ```bash
   cd frontend
   npm run build
   ```
   产物在 `frontend/dist/` 目录，可以用 Nginx 托管。

2. 后端打包并运行：
   ```bash
   cd backend
   npm run build
   npm start
   ```

3. 修改 `frontend/.env` 中的 `VITE_API_BASE` 为你服务器的真实地址（如 `https://api.yourdomain.com`）。

4. 生产环境务必：
   - 修改 `JWT_SECRET` 为一个高强度随机字符串
   - 修改 `ADMIN_PASSWORD` 为强密码
   - 为数据库配置独立的用户和密码，不使用默认的 `postgres/postgres`
   - 建议在 Nginx 前配置 HTTPS

---

*本项目目前为单管理员模式，不支持多用户注册。如有多人协作需求，需自行扩展用户系统。*
