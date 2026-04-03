import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import AccountSelect from '../components/AccountSelect'
import OrdersCsvImport from '../components/OrdersCsvImport'
import SkuPicker from '../components/SkuPicker'
import { apiRequest } from '../lib/apiClient'
import { removeItemById, upsertItemById } from '../lib/collectionState'
import {
  buildOrderPayload,
  computeOrderTotal,
  createEmptyOrderForm,
  createEmptyOrderItem,
  createOrderFormFromOrder,
  type BizOrderType,
  type FishOrder,
  type OrderFormState,
  type OrderItem,
  type ShipStatus,
  type TrackingMethod,
  type AbnormalType,
} from '../lib/orderForm'
import { isTimeoutPendingOrder } from '../lib/orderTimeout'

function sortOrdersByCreatedAtDesc(left: FishOrder, right: FishOrder) {
  return right.created_at.localeCompare(left.created_at)
}

function parseFiniteNumber(value: string, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function deriveNextShippedAt(form: OrderFormState) {
  if (form.shipStatus === 'pending') {
    return null
  }

  return form.shippedAt ?? new Date().toISOString()
}

export default function OrdersPage() {
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [orders, setOrders] = useState<FishOrder[]>([])

  const [query, setQuery] = useState('')
  const [shipFilter, setShipFilter] = useState<'all' | ShipStatus>('all')
  const [abnormalOnly, setAbnormalOnly] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create')
  const [modalLoading, setModalLoading] = useState(false)
  const [modalSaving, setModalSaving] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null)
  const [form, setForm] = useState<OrderFormState>(() => createEmptyOrderForm())

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return orders.filter((order) => {
      const matchQuery =
        !q ||
        order.order_id.toLowerCase().includes(q) ||
        order.buyer_name.toLowerCase().includes(q)
      const matchShip = shipFilter === 'all' ? true : order.ship_status === shipFilter
      const matchAbnormal = abnormalOnly ? order.is_abnormal : true
      return matchQuery && matchShip && matchAbnormal
    })
  }, [orders, query, shipFilter, abnormalOnly])

  const computedTotal = useMemo(() => computeOrderTotal(form.items), [form.items])

  async function loadOrders() {
    setLoading(true)
    setErrorMsg(null)
    try {
      const data = await apiRequest<FishOrder[]>('/api/orders')
      setOrders((data ?? []) as FishOrder[])
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '加载订单失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadOrders()
  }, [])

  function closeModal() {
    setModalOpen(false)
    setModalLoading(false)
    setModalError(null)
    setEditingOrderId(null)
    setForm(createEmptyOrderForm())
  }

  function openCreate() {
    setModalMode('create')
    setEditingOrderId(null)
    setModalLoading(false)
    setModalError(null)
    setForm(createEmptyOrderForm())
    setModalOpen(true)
  }

  async function openEdit(orderId: string) {
    setModalMode('edit')
    setEditingOrderId(orderId)
    setModalLoading(true)
    setModalError(null)
    setModalOpen(true)

    try {
      const order = await apiRequest<FishOrder>(`/api/orders/${orderId}`)
      setForm(createOrderFormFromOrder(order))
    } catch (err) {
      setModalError(err instanceof Error ? err.message : '加载订单详情失败')
    } finally {
      setModalLoading(false)
    }
  }

  function updateForm(patch: Partial<OrderFormState>) {
    setForm((current) => ({ ...current, ...patch }))
  }

  function updateItem(index: number, patch: Partial<OrderItem>) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item
      ),
    }))
  }

  function addItem() {
    setForm((current) => ({
      ...current,
      items: [...current.items, createEmptyOrderItem()],
    }))
  }

  function removeItem(index: number) {
    setForm((current) => ({
      ...current,
      items:
        current.items.length > 1
          ? current.items.filter((_, itemIndex) => itemIndex !== index)
          : current.items,
    }))
  }

  function validateForm() {
    if (!form.accountId) return '请选择所属闲鱼账号'
    if (!form.orderId.trim()) return '订单号不能为空'
    if (!form.buyerName.trim()) return '买家昵称不能为空'
    if (!form.address.trim()) return '收货地址不能为空'

    const normalizedItems = form.items.filter((item) => item.name.trim())
    if (!normalizedItems.length) return '请填写至少一件商品名称'
    if (normalizedItems.some((item) => item.qty <= 0)) return '商品数量必须大于 0'
    if (normalizedItems.some((item) => item.unit_price < 0)) return '商品单价不能为负数'

    return null
  }

  async function handleSave() {
    const validationError = validateForm()
    if (validationError) {
      setModalError(validationError)
      return
    }

    setModalSaving(true)
    setModalError(null)

    try {
      const payload = buildOrderPayload({
        ...form,
        shippedAt: deriveNextShippedAt(form),
      })

      if (modalMode === 'create') {
        const saved = await apiRequest<FishOrder>('/api/orders', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        setOrders((current) =>
          upsertItemById(current, saved, (item) => item.order_id, sortOrdersByCreatedAtDesc)
        )
      } else {
        const saved = await apiRequest<FishOrder>(`/api/orders/${editingOrderId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })
        setOrders((current) =>
          upsertItemById(current, saved, (item) => item.order_id, sortOrdersByCreatedAtDesc)
        )
      }

      closeModal()
    } catch (err) {
      setModalError(err instanceof Error ? err.message : '保存订单失败')
    } finally {
      setModalSaving(false)
    }
  }

  async function handleDelete(orderId: string) {
    const ok = confirm(`确定删除订单「${orderId}」？删除后不可恢复。`)
    if (!ok) return

    setModalSaving(true)
    setErrorMsg(null)
    try {
      await apiRequest(`/api/orders/${orderId}`, {
        method: 'DELETE',
      })
      setOrders((current) => removeItemById(current, orderId, (item) => item.order_id))
      if (editingOrderId === orderId) {
        closeModal()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '删除订单失败'
      if (editingOrderId === orderId) {
        setModalError(message)
      } else {
        setErrorMsg(message)
      }
    } finally {
      setModalSaving(false)
    }
  }

  function handleExportExcel() {
    if (!filtered.length) {
      alert('当前筛选条件下没有订单可导出。')
      return
    }

    const exportRows = filtered.map((order) => {
      const itemsSummary = (Array.isArray(order.items) ? order.items : [])
        .map((item: any) => {
          const name = String(item.name ?? item.sku_code ?? '')
          const qty = Number(item.qty ?? 0)
          const price = Number(item.unit_price ?? 0)
          if (!name.trim()) return ''
          return `${name} x${qty} @ ${price.toFixed(2)}`
        })
        .filter(Boolean)
        .join('\n')

      return {
        订单号: order.order_id,
        订单类型: order.order_type,
        账号ID: order.account_id,
        买家: order.buyer_name,
        地址: order.shipping_address,
        发货状态: order.ship_status,
        快递单号: order.tracking_number ?? '',
        快递方式: order.tracking_method ?? '',
        是否异常: order.is_abnormal ? '是' : '否',
        异常类型: order.is_abnormal ? order.abnormal_type ?? '' : '',
        异常备注: order.is_abnormal ? order.remark ?? '' : '',
        金额合计: Number(order.total_amount).toFixed(2),
        批发结算状态: order.order_type === 'wholesale' ? order.settlement_status ?? '' : '',
        已收金额: order.order_type === 'wholesale' ? Number(order.paid_amount ?? 0).toFixed(2) : '',
        创建时间: order.created_at ? new Date(order.created_at).toLocaleString() : '',
        发货时间: order.shipped_at ? new Date(order.shipped_at).toLocaleString() : '',
        商品明细: itemsSummary,
      }
    })

    const worksheet = XLSX.utils.json_to_sheet(exportRows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'orders')

    const date = new Date()
    const filename = `发货管家_订单导出_${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate()
    ).padStart(2, '0')}.xlsx`
    XLSX.writeFile(workbook, filename)
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div className="pageHeaderLeft">
          <h2 className="pageTitle">订单管理</h2>
          <p className="pageSub">支持订单新增、查询、完整编辑、删除、导入和导出。</p>
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
          onChange={(e) => setShipFilter(e.target.value as 'all' | ShipStatus)}
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
        <button className="ghostBtn btnFull" onClick={handleExportExcel} disabled={loading}>
          导出 Excel（当前筛选）
        </button>
      </div>

      <div className="btnRow">
        <OrdersCsvImport onImported={loadOrders} />
      </div>

      {errorMsg ? (
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
          {errorMsg}
        </div>
      ) : null}

      {loading ? <div style={{ marginTop: 16, opacity: 0.8 }}>加载中...</div> : null}

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
              {filtered.map((order) => {
                const timeout = isTimeoutPendingOrder({
                  ship_status: order.ship_status,
                  created_at: order.created_at,
                })

                return (
                  <tr key={order.order_id}>
                    <td>
                      <div style={{ fontWeight: 700, color: 'var(--text-h)' }}>{order.order_id}</div>
                      <div style={{ opacity: 0.7, fontSize: 12 }}>
                        {order.order_type === 'wholesale' ? '批发' : '零售'}
                      </div>
                    </td>
                    <td className={timeout ? 'tagDanger' : undefined}>
                      {order.ship_status}
                      {timeout ? ' / 超时(24h)' : ''}
                    </td>
                    <td className="wrap">{order.buyer_name}</td>
                    <td className="right">{Number(order.total_amount).toFixed(2)}</td>
                    <td>
                      {order.is_abnormal ? (
                        <span className="tagDanger">{order.abnormal_type ?? 'other'}</span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="right">{new Date(order.created_at).toLocaleString()}</td>
                    <td className="right">
                      <button className="ghostBtn" onClick={() => openEdit(order.order_id)} disabled={modalSaving}>
                        编辑
                      </button>{' '}
                      <button className="ghostBtn" onClick={() => handleDelete(order.order_id)} disabled={modalSaving}>
                        删除
                      </button>
                    </td>
                  </tr>
                )
              })}
              {!loading && filtered.length === 0 ? (
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

      {modalOpen ? (
        <div className="modalOverlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}>{modalMode === 'create' ? '新建订单' : `编辑订单（${form.orderId || editingOrderId}）`}</h3>
              <button className="ghostBtn" onClick={closeModal} disabled={modalSaving}>
                关闭
              </button>
            </div>

            {modalLoading ? (
              <div style={{ marginTop: 16, opacity: 0.8 }}>订单详情加载中...</div>
            ) : (
              <>
                <div style={{ marginTop: 14 }}>
                  <label style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>所属闲鱼账号</label>
                  <AccountSelect
                    value={form.accountId}
                    onChange={(next) => updateForm({ accountId: next })}
                    disabled={modalSaving}
                  />
                </div>

                <div style={{ marginTop: 12 }}>
                  <label style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>订单号</label>
                  <input
                    value={form.orderId}
                    onChange={(e) => updateForm({ orderId: e.target.value })}
                    disabled={modalSaving || modalMode === 'edit'}
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
                  <label style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>订单类型</label>
                  <select
                    value={form.orderType}
                    onChange={(e) => updateForm({ orderType: e.target.value as BizOrderType })}
                    disabled={modalSaving}
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
                  <label style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>买家昵称</label>
                  <input
                    value={form.buyerName}
                    onChange={(e) => updateForm({ buyerName: e.target.value })}
                    disabled={modalSaving}
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
                  <label style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>收货地址</label>
                  <textarea
                    value={form.address}
                    onChange={(e) => updateForm({ address: e.target.value })}
                    disabled={modalSaving}
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
                    <h3 style={{ margin: 0, fontSize: 16 }}>商品明细</h3>
                    <button
                      className="ghostBtn"
                      type="button"
                      onClick={addItem}
                      disabled={modalSaving}
                      style={{ padding: '8px 10px' }}
                    >
                      + 添加
                    </button>
                  </div>

                  <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
                    {form.items.map((item, index) => (
                      <div
                        key={index}
                        style={{
                          padding: 12,
                          borderRadius: 12,
                          border: '1px solid var(--border)',
                          background: 'rgba(255,255,255,0.55)',
                        }}
                      >
                        <div style={{ display: 'grid', gap: 10 }}>
                          <SkuPicker
                            skuId={item.sku_id}
                            fallbackLabel={item.name}
                            disabled={modalSaving}
                            placeholder="可选 SKU，用于自动带出名称和单价"
                            onChange={(next) =>
                              updateItem(index, {
                                sku_id: next.sku_id,
                                inventory_id: next.inventory_id,
                                name: next.name,
                                unit_price: next.unit_price,
                              })
                            }
                          />

                          <input
                            value={item.name}
                            onChange={(e) => updateItem(index, { name: e.target.value })}
                            disabled={modalSaving}
                            placeholder="商品名称"
                            style={{
                              width: '100%',
                              padding: '12px 14px',
                              borderRadius: 12,
                              border: '1px solid var(--border)',
                              boxSizing: 'border-box',
                            }}
                          />

                          <div style={{ display: 'flex', gap: 10 }}>
                            <input
                              type="number"
                              value={item.qty}
                              onChange={(e) => updateItem(index, { qty: parseFiniteNumber(e.target.value, 1) })}
                              disabled={modalSaving}
                              min={1}
                              step={1}
                              placeholder="数量"
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
                              value={item.unit_price}
                              onChange={(e) =>
                                updateItem(index, { unit_price: parseFiniteNumber(e.target.value, 0) })
                              }
                              disabled={modalSaving}
                              min={0}
                              step={0.01}
                              placeholder="单价"
                              style={{
                                flex: 1,
                                padding: '12px 14px',
                                borderRadius: 12,
                                border: '1px solid var(--border)',
                                boxSizing: 'border-box',
                              }}
                            />
                          </div>

                          {form.items.length > 1 ? (
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                              <button
                                className="ghostBtn"
                                type="button"
                                onClick={() => removeItem(index)}
                                disabled={modalSaving}
                                style={{ padding: '8px 10px' }}
                              >
                                删除商品
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
                  <h3 style={{ margin: '8px 0 10px', fontSize: 16 }}>发货信息</h3>
                  <div style={{ display: 'grid', gap: 12 }}>
                    <select
                      value={form.shipStatus}
                      onChange={(e) => updateForm({ shipStatus: e.target.value as ShipStatus })}
                      disabled={modalSaving}
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
                      value={form.trackingNumber}
                      onChange={(e) => updateForm({ trackingNumber: e.target.value })}
                      disabled={modalSaving}
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
                      value={form.trackingMethod}
                      onChange={(e) => updateForm({ trackingMethod: e.target.value as TrackingMethod })}
                      disabled={modalSaving}
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
                      checked={form.isAbnormal}
                      onChange={(e) => updateForm({ isAbnormal: e.target.checked })}
                      disabled={modalSaving}
                    />
                    标记异常订单
                  </label>

                  {form.isAbnormal ? (
                    <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
                      <select
                        value={form.abnormalType}
                        onChange={(e) => updateForm({ abnormalType: e.target.value as AbnormalType })}
                        disabled={modalSaving}
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
                        value={form.remark}
                        onChange={(e) => updateForm({ remark: e.target.value })}
                        disabled={modalSaving}
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
              </>
            )}

            {modalError ? (
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
                {modalError}
              </div>
            ) : null}

            <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
              <button className="primaryBtn" onClick={handleSave} disabled={modalSaving || modalLoading}>
                {modalSaving ? '保存中...' : modalMode === 'create' ? '保存订单' : '保存更新'}
              </button>
              {modalMode === 'edit' && editingOrderId ? (
                <button
                  className="ghostBtn"
                  onClick={() => void handleDelete(editingOrderId)}
                  disabled={modalSaving || modalLoading}
                >
                  删除订单
                </button>
              ) : null}
              <button className="ghostBtn" onClick={closeModal} disabled={modalSaving}>
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
