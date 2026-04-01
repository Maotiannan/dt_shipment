import { useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../lib/apiClient'
import AccountSelect from '../components/AccountSelect'
import SkuPicker from '../components/SkuPicker'
import OrdersCsvImport from '../components/OrdersCsvImport'
import { isTimeoutPendingOrder } from '../lib/orderTimeout'
import * as XLSX from 'xlsx'

type BizOrderType = 'wholesale' | 'retail'
type ShipStatus = 'pending' | 'shipped_private' | 'shipped_uploaded'
type TrackingMethod = 'private_chat' | 'platform_upload'
type AbnormalType = 'resend' | 'address_error' | 'reject' | 'other'

type OrderItem = {
  sku_id: string | null
  inventory_id: string | null
  name: string
  qty: number
  unit_price: number
}

type FishOrder = {
  order_id: string
  account_id: string
  order_type: BizOrderType
  buyer_name: string
  shipping_address: string
  items: OrderItem[] | any
  total_amount: number
  ship_status: ShipStatus
  tracking_number: string | null
  tracking_method: TrackingMethod | null
  is_abnormal: boolean
  abnormal_type: AbnormalType | null
  remark: string | null
  settlement_status: 'unpaid' | 'partial_paid' | 'settled' | null
  paid_amount: number
  created_at: string
  shipped_at: string | null
}

function toNumber(v: unknown, fallback = 0) {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

export default function OrdersPage() {
  const [loading, setLoading] = useState(true)
  const [orders, setOrders] = useState<FishOrder[]>([])

  const [query, setQuery] = useState('')
  const [shipFilter, setShipFilter] = useState<
    'all' | ShipStatus
  >('all')
  const [abnormalOnly, setAbnormalOnly] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return orders.filter((o) => {
      const matchQuery =
        !q ||
        o.order_id.toLowerCase().includes(q) ||
        o.buyer_name.toLowerCase().includes(q)
      const matchShip = shipFilter === 'all' ? true : o.ship_status === shipFilter
      const matchAbnormal = abnormalOnly ? o.is_abnormal : true
      return matchQuery && matchShip && matchAbnormal
    })
  }, [orders, query, shipFilter, abnormalOnly])

  // Create modal
  const [createOpen, setCreateOpen] = useState(false)
  const [createSaving, setCreateSaving] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [accountId, setAccountId] = useState<string | null>(null)
  const [formOrderId, setFormOrderId] = useState('')
  const [formOrderType, setFormOrderType] = useState<BizOrderType>('wholesale')
  const [formBuyerName, setFormBuyerName] = useState('')
  const [formAddress, setFormAddress] = useState('')
  const [items, setItems] = useState<OrderItem[]>([
    { sku_id: null, inventory_id: null, name: '', qty: 1, unit_price: 0 },
  ])

  const [isAbnormal, setIsAbnormal] = useState(false)
  const [abnormalType, setAbnormalType] = useState<AbnormalType>('resend')
  const [abnormalRemark, setAbnormalRemark] = useState('')

  const computedTotal = useMemo(() => {
    return items.reduce((sum, it) => {
      const qty = toNumber(it.qty, 0)
      const price = toNumber(it.unit_price, 0)
      return sum + qty * price
    }, 0)
  }, [items])

  // Detail modal
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailSaving, setDetailSaving] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<FishOrder | null>(null)

  async function loadOrders() {
    setLoading(true)
    setOrders([])
    try {
      const data = await apiRequest<FishOrder[]>('/api/orders')
      setOrders((data ?? []) as FishOrder[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadOrders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleExportExcel() {
    const rows = filtered
    if (!rows.length) {
      alert('当前筛选条件下没有订单可导出。')
      return
    }

    const exportRows = rows.map((o) => {
      const itemsArr = Array.isArray(o.items) ? (o.items as any[]) : []
      const itemsSummary = itemsArr
        .map((it) => {
          const name = String(it.name ?? it.sku_code ?? '')
          const qty = Number(it.qty ?? 0)
          const price = Number(it.unit_price ?? 0)
          if (!name.trim()) return ''
          return `${name} x${qty} @ ${price.toFixed(2)}`
        })
        .filter(Boolean)
        .join('\n')

      const created = o.created_at ? new Date(o.created_at) : null
      const shipped = o.shipped_at ? new Date(o.shipped_at) : null

      return {
        订单号: o.order_id,
        订单类型: o.order_type,
        账号ID: o.account_id,
        买家: o.buyer_name,
        地址: o.shipping_address,
        发货状态: o.ship_status,
        快递单号: o.tracking_number ?? '',
        快递方式: o.tracking_method ?? '',
        是否异常: o.is_abnormal ? '是' : '否',
        异常类型: o.is_abnormal ? o.abnormal_type ?? '' : '',
        异常备注: o.is_abnormal ? o.remark ?? '' : '',
        金额合计: Number(o.total_amount).toFixed(2),
        批发结算状态: o.order_type === 'wholesale' ? o.settlement_status ?? '' : '',
        已收金额: o.order_type === 'wholesale' ? Number(o.paid_amount ?? 0).toFixed(2) : '',
        创建时间: created ? created.toLocaleString() : '',
        发货时间: shipped ? shipped.toLocaleString() : '',
        商品明细: itemsSummary,
      }
    })

    const worksheet = XLSX.utils.json_to_sheet(exportRows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'orders')

    const d = new Date()
    const filename = `发货管家_订单导出_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}.xlsx`
    XLSX.writeFile(workbook, filename)
  }

  function resetCreateForm() {
    setAccountId(null)
    setFormOrderId('')
    setFormOrderType('wholesale')
    setFormBuyerName('')
    setFormAddress('')
    setItems([{ sku_id: null, inventory_id: null, name: '', qty: 1, unit_price: 0 }])
    setIsAbnormal(false)
    setAbnormalType('resend')
    setAbnormalRemark('')
    setCreateError(null)
  }

  function openCreate() {
    resetCreateForm()
    setCreateOpen(true)
  }

  async function handleCreateSave() {
    if (!accountId) {
      setCreateError('请选择所属闲鱼账号')
      return
    }
    if (!formOrderId.trim()) {
      setCreateError('订单号不能为空')
      return
    }
    if (!formBuyerName.trim()) {
      setCreateError('买家昵称不能为空')
      return
    }
    if (!formAddress.trim()) {
      setCreateError('收货地址不能为空')
      return
    }
    if (items.length === 0 || items.some((it) => !it.name.trim())) {
      setCreateError('请填写至少一件商品名称')
      return
    }

    setCreateSaving(true)
    setCreateError(null)
    try {
      const itemsPayload = items.map((it) => ({
        sku_id: it.sku_id,
        inventory_id: it.inventory_id,
        name: it.name.trim(),
        qty: toNumber(it.qty, 1),
        unit_price: toNumber(it.unit_price, 0),
      }))

      const payload: Partial<FishOrder> = {
        order_id: formOrderId.trim(),
        account_id: accountId,
        order_type: formOrderType,
        buyer_name: formBuyerName.trim(),
        shipping_address: formAddress.trim(),
        items: itemsPayload,
        total_amount: computedTotal,
        ship_status: 'pending',
        tracking_number: null,
        tracking_method: null,
        is_abnormal: isAbnormal,
        abnormal_type: isAbnormal ? abnormalType : null,
        remark: isAbnormal ? abnormalRemark.trim() : null,
        settlement_status:
          formOrderType === 'wholesale' ? 'unpaid' : null,
        paid_amount: formOrderType === 'wholesale' ? 0 : 0,
      }

      await apiRequest('/api/orders', {
        method: 'POST',
        body: JSON.stringify(payload),
      })

      setCreateOpen(false)
      await loadOrders()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setCreateSaving(false)
    }
  }

  async function openDetail(orderId: string) {
    setDetailError(null)
    setSelectedId(orderId)
    try {
      const data = await apiRequest<FishOrder[]>('/api/orders')
      const one = (data ?? []).find((o) => o.order_id === orderId)
      if (!one) {
        setDetailError('未找到订单')
        return
      }
      setDetail(one)
      setDetailOpen(true)
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : '加载订单失败')
    }
  }

  function parseItemsFromDetail(o: FishOrder | null): OrderItem[] {
    if (!o) return []
    const raw = o.items as any
    if (!Array.isArray(raw)) return []
    return raw
      .map((r: any) => ({
        sku_id: r.sku_id ?? null,
        inventory_id: r.inventory_id ?? null,
        name: String(r.name ?? r.sku_code ?? ''),
        qty: toNumber(r.qty, 1),
        unit_price: toNumber(r.unit_price, 0),
      }))
      .filter((it: OrderItem) => it.name.trim())
  }

  async function handleDetailSave() {
    if (!detail || !selectedId) return
    setDetailSaving(true)
    setDetailError(null)
    try {
      const nextShipStatus = detail.ship_status
      const payload: Partial<FishOrder> = {
        ship_status: nextShipStatus,
        tracking_number: detail.tracking_number ?? null,
        tracking_method: detail.tracking_method ?? null,
        is_abnormal: detail.is_abnormal,
        abnormal_type: detail.is_abnormal ? detail.abnormal_type : null,
        remark: detail.is_abnormal ? detail.remark : null,
        shipped_at: nextShipStatus === 'pending' ? null : new Date().toISOString(),
      }

      await apiRequest(`/api/orders/${selectedId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })

      setDetailOpen(false)
      await loadOrders()
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : '更新失败')
    } finally {
      setDetailSaving(false)
    }
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div className="pageHeaderLeft">
          <h2 className="pageTitle">订单管理</h2>
          <p className="pageSub">手动录入订单、更新发货状态、标记异常。</p>
        </div>
        <div className="pageHeaderRight">
          <button className="primaryBtn" onClick={openCreate} disabled={loading}>
            新建订单
          </button>
        </div>
      </div>

      <div className="filtersRow">
        <input
          className="control grow"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索：订单号 / 买家"
        />

        <select
          className="control"
          value={shipFilter}
          onChange={(e) => setShipFilter(e.target.value as any)}
        >
          <option value="all">全部发货状态</option>
          <option value="pending">未发货</option>
          <option value="shipped_private">已发货·私发</option>
          <option value="shipped_uploaded">已发货·上传</option>
        </select>

        <label className="ghostBtn" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={abnormalOnly}
            onChange={(e) => setAbnormalOnly(e.target.checked)}
          />
          仅异常
        </label>
      </div>

      <div className="btnRow">
        <button
          className="ghostBtn btnFull"
          onClick={handleExportExcel}
          disabled={loading}
        >
          导出 Excel（当前筛选）
        </button>
      </div>

      <div className="btnRow">
        <OrdersCsvImport onImported={loadOrders} />
      </div>

      {loading ? (
        <div style={{ marginTop: 16, opacity: 0.8 }}>加载中...</div>
      ) : null}

      <div style={{ marginTop: 14 }}>
        <div className="tableWrap">
          <table className="dataTable">
            <thead>
              <tr>
                <th>订单号</th>
                <th>状态</th>
                <th>买家</th>
                <th className="right">金额</th>
                <th>异常</th>
                <th className="right">创建时间</th>
                <th className="right">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => {
                const timeout = isTimeoutPendingOrder({
                  ship_status: o.ship_status,
                  created_at: o.created_at,
                })
                return (
                  <tr key={o.order_id}>
                    <td>
                      <div style={{ fontWeight: 700, color: 'var(--text-h)' }}>
                        {o.order_id}
                      </div>
                      <div style={{ opacity: 0.7, fontSize: 12 }}>
                        {o.order_type === 'wholesale' ? '批发' : '零售'}
                      </div>
                    </td>
                    <td className={timeout ? 'tagDanger' : undefined}>
                      {o.ship_status}
                      {timeout ? ' / 超时(24h)' : ''}
                    </td>
                    <td className="wrap">{o.buyer_name}</td>
                    <td className="right">{Number(o.total_amount).toFixed(2)}</td>
                    <td>
                      {o.is_abnormal ? (
                        <span className="tagDanger">
                          {o.abnormal_type ?? 'other'}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="right">
                      {new Date(o.created_at).toLocaleString()}
                    </td>
                    <td className="right">
                      <button
                        className="ghostBtn"
                        onClick={() => openDetail(o.order_id)}
                      >
                        查看/更新
                      </button>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && !loading ? (
                <tr>
                  <td colSpan={7} style={{ padding: 14, opacity: 0.8 }}>
                    暂无订单
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {createOpen ? (
        <div className="modalOverlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}>新建订单</h3>
              <button className="ghostBtn" onClick={() => setCreateOpen(false)} disabled={createSaving}>
                关闭
              </button>
            </div>

            <div style={{ marginTop: 14 }}>
              <label style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>
                所属闲鱼账号
              </label>
              <AccountSelect
                value={accountId}
                onChange={(next) => setAccountId(next)}
                disabled={createSaving}
              />
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>
                订单号
              </label>
              <input
                value={formOrderId}
                onChange={(e) => setFormOrderId(e.target.value)}
                placeholder="请输入订单号"
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>
                订单类型
              </label>
              <select
                value={formOrderType}
                onChange={(e) => setFormOrderType(e.target.value as BizOrderType)}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                  boxSizing: 'border-box',
                  background: 'rgba(255,255,255,0.6)',
                }}
              >
                <option value="wholesale">批发</option>
                <option value="retail">零售</option>
              </select>
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>
                买家昵称
              </label>
              <input
                value={formBuyerName}
                onChange={(e) => setFormBuyerName(e.target.value)}
                placeholder="请输入买家昵称/联系人"
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>
                收货地址
              </label>
              <textarea
                value={formAddress}
                onChange={(e) => setFormAddress(e.target.value)}
                placeholder="请输入完整收货地址"
                rows={3}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                  boxSizing: 'border-box',
                  background: 'rgba(255,255,255,0.6)',
                  resize: 'vertical',
                }}
              />
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: 16 }}>产品明细（手动）</h3>
                <button
                  className="ghostBtn"
                  onClick={() =>
                    setItems((prev) => [
                      ...prev,
                      { sku_id: null, inventory_id: null, name: '', qty: 1, unit_price: 0 },
                    ])
                  }
                  disabled={createSaving}
                  style={{ padding: '8px 10px' }}
                >
                  + 添加
                </button>
              </div>

              <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
                {items.map((it, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: 12,
                      borderRadius: 12,
                      border: '1px solid var(--border)',
                      background: 'rgba(255,255,255,0.55)',
                    }}
                  >
                    <div style={{ display: 'grid', gap: 10 }}>
                      <SkuPicker
                        skuId={it.sku_id}
                        disabled={createSaving}
                        onChange={(next) => {
                          setItems((prev) =>
                            prev.map((p, i) =>
                              i === idx
                                ? {
                                    ...p,
                                    sku_id: next.sku_id,
                                    name: next.name,
                                    unit_price: next.unit_price,
                                    inventory_id: next.inventory_id,
                                  }
                                : p
                            )
                          )
                        }}
                      />

                      <div style={{ display: 'flex', gap: 10 }}>
                        <input
                          type="number"
                          value={it.qty}
                          onChange={(e) => {
                            const qty = Number(e.target.value)
                            setItems((prev) =>
                              prev.map((p, i) =>
                                i === idx ? { ...p, qty: Number.isFinite(qty) ? qty : 1 } : p
                              )
                            )
                          }}
                          min={1}
                          step={1}
                          style={{
                            flex: 1,
                            padding: '12px 14px',
                            borderRadius: 12,
                            border: '1px solid var(--border)',
                            boxSizing: 'border-box',
                          }}
                        />
                        <input
                          type="number"
                          value={it.unit_price}
                          onChange={(e) => {
                            const price = Number(e.target.value)
                            setItems((prev) =>
                              prev.map((p, i) =>
                                i === idx
                                  ? {
                                      ...p,
                                      unit_price: Number.isFinite(price) ? price : 0,
                                    }
                                  : p
                              )
                            )
                          }}
                          min={0}
                          step={0.01}
                          style={{
                            flex: 1,
                            padding: '12px 14px',
                            borderRadius: 12,
                            border: '1px solid var(--border)',
                            boxSizing: 'border-box',
                          }}
                        />
                      </div>

                      {items.length > 1 ? (
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <button
                            className="ghostBtn"
                            onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                            disabled={createSaving}
                            style={{ padding: '8px 10px' }}
                          >
                            删除
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 12, color: 'var(--text-h)' }}>
                合计：<b>{computedTotal.toFixed(2)}</b>
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                  background: 'rgba(255,255,255,0.55)',
                }}
              >
                <input
                  type="checkbox"
                  checked={isAbnormal}
                  onChange={(e) => setIsAbnormal(e.target.checked)}
                />
                标记异常订单
              </label>

              {isAbnormal ? (
                <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
                  <select
                    value={abnormalType}
                    onChange={(e) =>
                      setAbnormalType(e.target.value as AbnormalType)
                    }
                    style={{
                      width: '100%',
                      padding: '12px 14px',
                      borderRadius: 12,
                      border: '1px solid var(--border)',
                      boxSizing: 'border-box',
                      background: 'rgba(255,255,255,0.6)',
                    }}
                  >
                    <option value="resend">补发</option>
                    <option value="address_error">地址异常</option>
                    <option value="reject">拒收</option>
                    <option value="other">其他</option>
                  </select>

                  <textarea
                    value={abnormalRemark}
                    onChange={(e) => setAbnormalRemark(e.target.value)}
                    rows={3}
                    placeholder="异常备注（Phase1 简化）"
                    style={{
                      width: '100%',
                      padding: '12px 14px',
                      borderRadius: 12,
                      border: '1px solid var(--border)',
                      boxSizing: 'border-box',
                      background: 'rgba(255,255,255,0.6)',
                      resize: 'vertical',
                    }}
                  />
                </div>
              ) : null}
            </div>

            {createError ? (
              <div
                style={{
                  marginTop: 12,
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: '1px solid rgba(255,0,0,0.25)',
                  color: '#b91c1c',
                  background: 'rgba(255,0,0,0.05)',
                  fontSize: 13,
                }}
              >
                {createError}
              </div>
            ) : null}

            <div className="modalFooter">
              <button className="primaryBtn" onClick={handleCreateSave} disabled={createSaving}>
                {createSaving ? '保存中...' : '保存订单'}
              </button>
              <button className="ghostBtn" onClick={() => setCreateOpen(false)} disabled={createSaving}>
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {detailOpen && detail ? (
        <div className="modalOverlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}>订单详情（{detail.order_id}）</h3>
              <button
                className="ghostBtn"
                onClick={() => setDetailOpen(false)}
                disabled={detailSaving}
              >
                关闭
              </button>
            </div>

            <div style={{ marginTop: 12, opacity: 0.9, fontSize: 13 }}>
              买家：{detail.buyer_name} / {detail.order_type} / 创建：{new Date(detail.created_at).toLocaleString()}
            </div>
            <div style={{ marginTop: 10, color: 'var(--text-h)' }}>
              合计：<b>{Number(detail.total_amount).toFixed(2)}</b>
            </div>

            <div style={{ marginTop: 12 }}>
              <h3 style={{ margin: '8px 0 10px', fontSize: 16 }}>商品明细</h3>
              {parseItemsFromDetail(detail).length ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  {parseItemsFromDetail(detail).map((it, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: 10,
                        borderRadius: 12,
                        border: '1px solid var(--border)',
                        background: 'rgba(255,255,255,0.55)',
                      }}
                    >
                      {it.name} × {it.qty} = {(it.qty * it.unit_price).toFixed(2)}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ opacity: 0.7 }}>未录入明细（Phase1 简化）</div>
              )}
            </div>

            <div style={{ marginTop: 14 }}>
              <h3 style={{ margin: '8px 0 10px', fontSize: 16 }}>发货信息</h3>
              <div style={{ display: 'grid', gap: 12 }}>
                <select
                  value={detail.ship_status}
                  onChange={(e) =>
                    setDetail((prev) =>
                      prev ? { ...prev, ship_status: e.target.value as ShipStatus } : prev
                    )
                  }
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: 12,
                    border: '1px solid var(--border)',
                    boxSizing: 'border-box',
                    background: 'rgba(255,255,255,0.6)',
                  }}
                >
                  <option value="pending">未发货（pending）</option>
                  <option value="shipped_private">已发货（私发）</option>
                  <option value="shipped_uploaded">已发货（平台上传）</option>
                </select>

                <input
                  value={detail.tracking_number ?? ''}
                  onChange={(e) =>
                    setDetail((prev) =>
                      prev ? { ...prev, tracking_number: e.target.value } : prev
                    )
                  }
                  placeholder="快递单号（可留空）"
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: 12,
                    border: '1px solid var(--border)',
                    boxSizing: 'border-box',
                  }}
                />

                <select
                  value={detail.tracking_method ?? 'private_chat'}
                  onChange={(e) =>
                    setDetail((prev) =>
                      prev ? { ...prev, tracking_method: e.target.value as TrackingMethod } : prev
                    )
                  }
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: 12,
                    border: '1px solid var(--border)',
                    boxSizing: 'border-box',
                    background: 'rgba(255,255,255,0.6)',
                  }}
                >
                  <option value="private_chat">private_chat（私发）</option>
                  <option value="platform_upload">platform_upload（平台上传）</option>
                </select>
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                  background: 'rgba(255,255,255,0.55)',
                }}
              >
                <input
                  type="checkbox"
                  checked={detail.is_abnormal}
                  onChange={(e) =>
                    setDetail((prev) =>
                      prev ? { ...prev, is_abnormal: e.target.checked } : prev
                    )
                  }
                />
                标记异常订单
              </label>

              {detail.is_abnormal ? (
                <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
                  <select
                    value={detail.abnormal_type ?? 'other'}
                    onChange={(e) =>
                      setDetail((prev) =>
                        prev
                          ? { ...prev, abnormal_type: e.target.value as AbnormalType }
                          : prev
                      )
                    }
                    style={{
                      width: '100%',
                      padding: '12px 14px',
                      borderRadius: 12,
                      border: '1px solid var(--border)',
                      boxSizing: 'border-box',
                      background: 'rgba(255,255,255,0.6)',
                    }}
                  >
                    <option value="resend">补发</option>
                    <option value="address_error">地址异常</option>
                    <option value="reject">拒收</option>
                    <option value="other">其他</option>
                  </select>

                  <textarea
                    value={detail.remark ?? ''}
                    onChange={(e) =>
                      setDetail((prev) => (prev ? { ...prev, remark: e.target.value } : prev))
                    }
                    rows={3}
                    placeholder="异常备注"
                    style={{
                      width: '100%',
                      padding: '12px 14px',
                      borderRadius: 12,
                      border: '1px solid var(--border)',
                      boxSizing: 'border-box',
                      background: 'rgba(255,255,255,0.6)',
                      resize: 'vertical',
                    }}
                  />
                </div>
              ) : null}
            </div>

            {detailError ? (
              <div
                style={{
                  marginTop: 12,
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: '1px solid rgba(255,0,0,0.25)',
                  color: '#b91c1c',
                  background: 'rgba(255,0,0,0.05)',
                  fontSize: 13,
                }}
              >
                {detailError}
              </div>
            ) : null}

            <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
              <button className="primaryBtn" onClick={handleDetailSave} disabled={detailSaving}>
                {detailSaving ? '保存中...' : '保存更新'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

