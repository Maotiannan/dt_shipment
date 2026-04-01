# 发货管家系统端到端验收清单（QA）

> 目标：验证 PRD v1.0（Phase 1~Phase 3）核心闭环在真实数据与真实权限下可用。

## 0. 前置条件
1. 已完成 Supabase 项目配置：启用 Auth（Email/密码）、配置环境变量：
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - （如要测推送）`VITE_VAPID_PUBLIC_KEY`
2. Supabase 已应用迁移：
   - `0001_init.sql`（fish_accounts / orders / skus + RLS）
   - `0002_settlement_paid_fields.sql`（paid_at / paid_remark）
   - `0003_push_subscriptions.sql`（push_subscriptions + RLS）
   - `0004_inventory_fields.sql`（skus 预留 inventory_id / inventory_quantity）
3. 测试账号至少准备 2 个（用于验证 RLS 隔离）。

## 1. 登录与权限（Auth + RLS）
1. 使用账号 A 登录后：
   - 能查看/新增账号（`fish_accounts`）
   - 能查看/新增订单（`orders`）
   - 能查看/新增 SKU（`skus`）
2. 使用账号 B 登录后：
   - 账号 A 的数据不可见（至少在列表与详情都看不到）
3. 退出登录后：
   - 受保护页面会跳转回 `/login`

## 2. 账号管理（Accounts CRUD）
1. 新增账号：
   - `account_name / biz_type / status` 保存正确
2. 停用账号：
   - 状态变为 `inactive`
   - 不删除历史订单
3. 列表筛选：
   - 按账号名/备注/业务类型能定位到对应账号

## 3. 产品库（SKU CRUD + 启停）
1. 新增 SKU：
   - `name / unit_price / status` 保存正确
2. 编辑 SKU：
   - 更新后订单录入的自动单价能同步使用最新 `unit_price`
3. 停用 SKU：
   - `SkuPicker` 不再展示该 SKU

## 4. 订单管理（Phase1：录入/发货/异常）
1. 新建订单（批发/零售）：
   - 可选择所属闲鱼账号
   - 订单商品明细支持 SKU 搜索下拉
   - 选择 SKU 后自动带出 `unit_price`
   - 金额合计与商品数量/单价联动正确
2. 更新发货状态：
   - pending -> shipped_private / shipped_uploaded
   - 保存快递单号、快递方式字段
   - `shipped_at` 在发货后有值
3. 标记异常订单：
   - 勾选异常后可选择异常类型并保存异常备注
4. 超时逻辑（24h）：
   - 创建超过 24 小时且 `ship_status=pending` 的订单在订单列表会红色标记“超时（24h）”

## 5. 首页看板（Dashboard）
1. 待处理：
   - 待处理数与订单表中“超时 pending”数量一致
2. 异常订单：
   - 异常订单数与 `is_abnormal=true` 一致
3. 待收尾款：
   - 批发订单欠款 = `total_amount - paid_amount`，且仅统计 `unpaid/partial_paid`
4. 多账号统计（Phase3 区域）：
   - 按账号维度展示：订单量、发货状态分布、批发结算分布、欠款金额、异常数量

## 6. 批发结算（Settlements：收款更新 + 汇总）
1. 打开订单级收款更新：
   - 输入已收金额后，系统推导：
     - paid<=0 => `unpaid`
     - 0 < paid < total => `partial_paid`
     - paid>=total => `settled`
2. 保存收款后：
   - `paid_at / paid_remark` 写入正确
   - 首页“待收尾款”金额随之变化
3. 客户欠款汇总：
   - 汇总金额与订单欠款累加一致

## 7. Excel 导出（OrdersPage）
1. 在订单列表当前筛选条件下点击导出：
   - 导出文件可正常打开
   - 订单号、金额合计、发货状态、异常字段、创建/发货时间、商品明细摘要列均存在且格式合理
2. 边界：
   - 当前筛选无数据时导出按钮提示“暂无订单可导出”

## 8. CSV 导入（OrdersCsvImport）
1. 下载模板后：
   - 用模板新建 1~3 行数据，正确导入并进入订单列表
2. 校验逻辑：
   - 缺字段、qty/单价非法、异常订单缺异常类型/备注时，能给出行级错误提示
3. 幂等性：
   - 重复导入同一 `order_id`（同一用户）时不会产生重复记录（upsert 生效）

## 9. Web Push / 通知提醒（Phase2 客户端侧）
1. 开启推送提醒：
   - 请求通知权限成功后能保存订阅信息到 `push_subscriptions`
2. 触发展示：
   - 当看板存在超时 pending 或异常订单时，能弹出通知（客户端侧 showNotification）
3. 取消/拒绝权限：
   - 点击“开启推送提醒”不会导致页面崩溃

## 10. 移动端可用性检查
1. 底部 Tab：
   - 5 个入口在小屏下不重叠
   - 点击命中区域足够大（无误触）
2. 表单：
   - 新建订单、SKU、收款更新等弹窗在小屏下可滚动，不遮挡底部 Tab
3. 单手操作：
   - 核心按钮（保存/导出/开启提醒）尽量在右侧或底部可达范围内
4. 弱网/离线体验（PWA）：
   - 首次可用后，基础页面刷新不出现空白（由 SW 缓存支持）

## 11. 性能与异常
1. 500+ 订单数据量下：
   - Dashboard、Orders 列表加载不出现明显卡死（建议 < 3s 以内）
2. Supabase 失败处理：
   - 连接异常时能展示错误提示（不会空白无反馈）

## 12. 验收结论输出
1. 每条用例记录：通过/不通过 + 失败截图/日志
2. 对不通过项给出：
   - 影响范围（订单/结算/导出/通知）
   - 修复优先级（高/中/低）

