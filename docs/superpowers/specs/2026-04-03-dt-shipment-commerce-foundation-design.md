# DT_SHIPMENT Commerce Foundation Design

Date: 2026-04-03
Status: Draft for review
Scope: 订单管理、结算管理、产品库、库存、商品图片、设置中心基础架构

## 1. 目标

本次改造的目标不是只修几个表单，而是把 `dt_shipment` 从“可录入”提升为“可长期维护的交易后台”。

本次设计要解决以下现存问题：

- 订单发货信息重复表达，`发货状态` 和 `私发/平台上传` 存在语义重叠
- 订单编辑明显偏手机交互，桌面端操作效率低
- 结算页只展示批发订单，不符合“所有有应收金额订单都进入结算”的业务要求
- SKU 仍使用 `spec/category` 自由文本，类目、颜色、规格没有结构化表达
- 库存字段存在但没有真实事务逻辑，订单创建、修改、删除不会自动扣减或回滚库存
- 新建 SKU 时不能直接上传图片，流程割裂
- 商品图片只生成缩略图，不对原图做优化，NAS 占用和加载成本偏高
- 系统缺少设置中心，无法把高频规则逐步沉淀为可治理配置

## 2. 非目标

本次设计不包含以下内容：

- 不重做认证体系
- 不引入独立的 ERP/WMS 子系统
- 不把数据库热数据迁移到 NAS 共享目录
- 不在本轮做复杂审批流、角色权限矩阵
- 不把所有业务规则一次性全部配置化

## 3. 分阶段交付

### 阶段 1：业务核心重构

阶段 1 直接解决当前可用性和数据一致性问题：

- 重构订单发货模型和订单编辑界面
- 结算页改为“所有有应收金额订单”
- SKU 改为 `类目 / 颜色 / 规格` 三字段
- 引入真实库存扣减和回滚事务
- 新建 SKU 时支持同流程上传图片
- 商品图片增加原图优化和缩略图
- 前端为桌面端和手机端分别优化布局
- 增加候选词自动沉淀机制，但不先做完整设置后台

### 阶段 2：设置中心与治理

阶段 2 把阶段 1 已经稳定的业务规则抽象成设置中心：

- 管理类目、颜色、规格候选项
- 管理图片压缩策略
- 管理库存安全阈值和默认规则
- 管理结算默认策略

阶段 2 不改变阶段 1 的业务事实表，只在其上增加治理层。

## 4. 数据模型

### 4.1 SKU 主表

保留现有 `skus` 主表，但升级字段结构。

现有字段：

- `sku_id`
- `sku_code`
- `name`
- `spec`
- `category`
- `unit_price`
- `status`
- `inventory_id`
- `inventory_quantity`

调整方案：

- 新增 `category_name text`
- 新增 `color_name text`
- 新增 `variant_name text`

兼容策略：

- 阶段 1 中保留 `spec`、`category` 作为历史兼容字段
- 前端新表单只使用 `category_name`、`color_name`、`variant_name`
- 旧数据迁移时：
  - `category` 迁入 `category_name`
  - `spec` 迁入 `variant_name`
  - `color_name` 初始为空
- 旧接口字段兼容一段时间，但页面和新测试不再依赖旧字段

### 4.2 订单表

现有订单表保留为交易事实源，但调整发货字段语义。

当前字段问题：

- `ship_status` 已经区分 `pending / shipped_private / shipped_uploaded`
- `tracking_method` 又重复表达 `private_chat / platform_upload`

调整后：

- `ship_status` 只表示是否已发货
  - `pending`
  - `shipped`
- `delivery_channel` 表示发货后通过什么渠道通知或上传
  - `private_chat`
  - `platform_upload`
  - `null`
- `tracking_number` 保留
- `shipped_at` 保留

迁移策略：

- 历史 `shipped_private` 迁为 `ship_status=shipped` + `delivery_channel=private_chat`
- 历史 `shipped_uploaded` 迁为 `ship_status=shipped` + `delivery_channel=platform_upload`
- 历史 `pending` 迁为 `ship_status=pending` + `delivery_channel=null`

### 4.3 库存流水

新增库存流水表 `inventory_movements`。

字段：

- `movement_id uuid primary key`
- `sku_id uuid not null`
- `order_id text null`
- `delta_quantity integer not null`
- `reason text not null`
- `remark text null`
- `created_at timestamptz not null default now()`

约束：

- `reason` 取值至少包含：
  - `order_create`
  - `order_update_revert`
  - `order_update_apply`
  - `order_delete_revert`
  - `manual_adjustment`

库存事实模型：

- `inventory_movements` 是审计事实源
- `skus.inventory_quantity` 是当前快照值
- 每次库存变更必须同时写流水和更新快照
- 两者必须在同一数据库事务中完成

### 4.4 候选项与设置中心

新增候选项表 `sku_attribute_suggestions`。

字段：

- `suggestion_id uuid primary key`
- `attribute_type text not null`
- `scope_key text null`
- `value text not null`
- `usage_count integer not null default 1`
- `source text not null`
- `is_enabled boolean not null default true`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

语义：

- `attribute_type`:
  - `category`
  - `color`
  - `variant`
- `scope_key`:
  - `category` 候选项时固定为 `null`
  - `color` / `variant` 候选项时为所属 `category_name`
- `source`:
  - `user_input`
  - `settings_panel`
  - `migration`

规则：

- `类目` 为全局候选
- `颜色/规格` 按当前类目提供候选
- 允许自由输入
- 每次录入成功时，对应候选项增加 `usage_count`

阶段 2 另增系统设置表，集中保存压缩参数、库存阈值等；阶段 1 先不引入通用 key-value 配置表。

## 5. 核心业务规则

### 5.1 订单与库存

- 创建订单时即扣库存
- 修改订单时，必须在同一事务中先回滚旧商品数量，再应用新商品数量
- 删除订单时，必须回滚该订单所产生的库存占用
- 库存不足时，订单创建或更新必须失败，不允许扣成负数，除非未来设置中心明确允许超卖
- 没有关联 SKU 的自由文本商品项不参与库存扣减
- 已停用 SKU 可以保留在历史订单里，但不再允许新建订单选用

### 5.2 结算规则

- 结算页展示范围为所有 `应收金额 > 0` 的订单
- 应收金额计算公式为 `max(total_amount - paid_amount, 0)`
- 不再只筛选批发订单
- 结算页是订单资金视图，不创建独立的结算主表
- 收款更新仍直接回写 `orders`

### 5.3 SKU 候选项

- 新录入的类目、颜色、规格在保存成功后自动沉淀到候选项表
- 候选项只提供建议，不限制录入
- 如果用户录入的新值已存在，则只增加使用次数
- 阶段 2 中设置中心可对候选项进行启停和整理

### 5.4 商品图片

- 图片文件继续落 NAS 私有目录
- 列表和编辑页默认展示缩略图
- 用户点击后再加载原图
- 新建 SKU 时支持同流程上传图片
- 删除 SKU 时，图片及其元数据一并按既有回收站策略处理
- 上传图片时保留优化后的原图和缩略图，不再直接无条件存入原始大文件

## 6. 图片处理策略

### 6.1 文件存储

继续沿用现有私有图片仓结构：

- 原图目录
- 缩略图目录
- 回收站目录

不复用现有 Alist/PicList 的公开图片目录，不改变其可见范围。

### 6.2 压缩策略

上传时执行两层处理：

- 生成网页列表用缩略图
- 对原图做“优化保存”

原图优化规则：

- 保留足够用于查看大图的清晰度
- 对超大图片重编码和合理压缩
- 保留必要尺寸信息供前端使用

本轮不追求复杂自适应压缩算法，采用稳定、可预测的服务器端压缩策略。

### 6.3 新建 SKU 即上传

交互流程：

1. 用户在“新增 SKU”弹窗填写基础信息
2. 首次保存创建 SKU，后端返回 `sku_id`
3. 弹窗不关闭，直接切换为“可上传图片”的已创建状态
4. 用户继续上传图片并完成商品录入

这样用户感知上是一个连续流程，而不是“先建完、再退出、再编辑”。

## 7. 接口设计

### 7.1 SKU

保留并升级：

- `GET /api/skus`
- `POST /api/skus`
- `PUT /api/skus/:id`
- `DELETE /api/skus/:id`

新增或调整字段：

- `category_name`
- `color_name`
- `variant_name`
- `inventory_quantity`

新增建议接口：

- `GET /api/sku-attribute-suggestions?attribute_type=category`
- `GET /api/sku-attribute-suggestions?attribute_type=color&category_name=...`
- `GET /api/sku-attribute-suggestions?attribute_type=variant&category_name=...`

### 7.2 订单

保留：

- `GET /api/orders`
- `GET /api/orders/:id`
- `POST /api/orders`
- `PUT /api/orders/:id`
- `DELETE /api/orders/:id`

字段调整：

- `ship_status`
- `delivery_channel`
- `tracking_number`
- `items`
- `settlement_status`
- `paid_amount`

服务端要求：

- 订单创建、修改、删除都必须包裹事务
- 库存变更不得在事务外异步补写

### 7.3 结算

阶段 1 继续复用订单接口，不单独创建新事实接口。

可新增更聚焦的只读接口以优化前端：

- `GET /api/settlements/orders`
- `GET /api/settlements/summary`

这两个接口都由 `orders` 派生，不能自行维护独立数据。

### 7.4 设置中心

阶段 2 引入：

- `GET /api/settings/sku-attributes`
- `PUT /api/settings/sku-attributes`
- `GET /api/settings/media`
- `PUT /api/settings/media`
- `GET /api/settings/inventory`
- `PUT /api/settings/inventory`
- `GET /api/settings/settlement`
- `PUT /api/settings/settlement`

阶段 1 不强行暴露全部设置接口，只先为候选项和媒体配置留出边界。

## 8. 前端交互设计

### 8.1 订单管理

桌面端：

- 使用更宽的弹窗或详情面板
- 分区展示：
  - 基础信息
  - 商品明细
  - 发货信息
  - 结算信息
  - 异常信息
- 按钮改为桌面尺寸，不使用移动端全宽主按钮

手机端：

- 保持单列
- 保留更大的点击热区
- 关键操作固定到底部

发货区字段收敛为：

- 是否已发货
- 发货渠道
- 快递单号

不再展示重复表达的两个“私发/平台上传”字段。

### 8.2 结算管理

桌面端：

- 保留汇总卡片和数据表格
- 增加按客户、订单号、未收金额、订单类型筛选

手机端：

- 改为卡片流
- 重点展示订单号、客户、应收金额、已收金额、最近收款时间

### 8.3 产品库

SKU 表单字段：

- SKU 编码
- 产品名称
- 类目
- 颜色
- 规格
- 单价
- 库存数量
- 状态
- 图片

输入模式：

- 输入框支持自由录入
- 输入过程中显示候选建议
- `类目` 提供全局候选
- `颜色/规格` 基于当前类目提供候选

桌面端：

- 商品基础信息与图片区并排布局
- 缩略图区域紧凑，不占用过高纵向空间

手机端：

- 基础信息优先
- 图片区折叠或置于下方

## 9. 事务与一致性

下列操作必须使用数据库事务：

- 创建订单并扣库存
- 修改订单并回滚/重扣库存
- 删除订单并恢复库存
- 删除 SKU 并清理图片元数据
- 新建 SKU 后首次上传图片时写入图片元数据

文件系统与数据库的一致性原则：

- 先完成文件写入，再写入数据库记录
- 任一步失败时必须回滚已完成的文件或数据库操作
- 对缺失文件要容错，避免历史脏数据阻塞正常删除

## 10. 错误处理

- 库存不足：返回 409，提示哪些 SKU 库存不足
- 候选项查询失败：不阻塞主表单，只降级为自由输入
- 图片压缩失败：返回 400 或 500，并清理临时文件
- 订单库存回滚失败：整个事务失败，不允许部分成功
- 桌面和手机布局差异只存在于表现层，不允许业务校验分叉

## 11. 测试策略

本项目优先 API 自动化测试，不依赖人工点点点验收。

新增或更新测试覆盖：

- SKU 字段迁移和读写兼容
- 类目、颜色、规格候选项自动沉淀
- 创建订单即扣库存
- 修改订单时库存回滚与重算
- 删除订单恢复库存
- 结算页查询范围变为所有应收订单
- 新建 SKU 后同流程上传图片
- 图片原图优化与缩略图生成
- 桌面端和手机端的关键表单状态切换

Smoke 测试新增断言：

- 创建带 SKU 的订单后库存减少
- 删除该订单后库存恢复
- 新建 SKU 后在同一流程完成图片上传
- 零售订单只要有应收金额，也能进入结算数据源

## 12. 迁移策略

迁移顺序：

1. 新增字段和新表
2. 回填历史订单发货字段
3. 回填 SKU 结构化字段
4. 兼容旧接口返回
5. 前端切换到新字段
6. 补充自动化测试
7. 验证通过后再考虑下线旧字段依赖

迁移要求：

- 迁移脚本可重复执行或具备安全幂等性
- 不修改历史订单文本快照
- 不直接破坏现有商品图片目录结构

## 13. 文档与版本同步

实施时同步更新：

- `README.md`
- 数据库初始化与迁移说明
- API 说明
- 图片与库存规则说明
- 版本号单一来源及前端展示

所有实现改动必须伴随：

- 测试更新
- Docker 运行说明更新
- Git 提交同步

## 14. 风险与权衡

主要风险：

- 订单库存回滚逻辑引入后，若事务边界处理不严，会造成库存错账
- SKU 字段迁移期间，前后端若混用新旧字段，容易出现显示不一致
- 新建 SKU 即上传图片会引入“半完成商品”的中间状态，需要明确清理策略

控制策略：

- 先用测试锁定库存行为，再改实现
- 前后端字段切换期间明确兼容窗口
- 为新建未完成的 SKU 制定最小化中间状态，只允许在创建成功后上传图片

## 15. 实施结论

本设计选择以 `C. 完整设置中心方案` 为目标架构，但以“阶段 1 先修业务核心、阶段 2 再补治理中心”的方式落地。

这样可以同时满足：

- 现在就把订单、结算、SKU、库存、图片流程改顺
- 后续把高频业务规则沉淀为设置中心
- 保持现有系统连续可运行，不做一次性高风险翻修
