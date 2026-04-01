import { useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../lib/apiClient'

type SettlementStatus = 'unpaid' | 'partial_paid' | 'settled'

type WholesaleOrder = {
  order_id: string
  buyer_name: string
  total_amount: number
  paid_amount: number
  settlement_status: SettlementStatus | null
  paid_at: string | null
  paid_remark: string | null
  created_at: string
}

type CustomerSummary = {
  buyer_name: string
  orderCount: number
  totalDue: number
  totalAmount: number
  totalPaid: number
}

function calcDue(total: number, paid: number) {
  return Math.max(0, Number(total ?? 0) - Number(paid ?? 0))
}

function calcNextStatus(total: number, paid: number): SettlementStatus {
  const t = Number(total ?? 0)
  const p = Number(paid ?? 0)
  if (p <= 0) return 'unpaid'
  if (p + 1e-9 >= t) return 'settled'
  return 'partial_paid'
}

export default function SettlementsPage() {
  const [loading, setLoading] = useState(true)
  const [orders, setOrders] = useState<WholesaleOrder[]>([])
  const [query, setQuery] = useState('')

  // modal
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [selected, setSelected] = useState<WholesaleOrder | null>(null)
  const [paidAmountInput, setPaidAmountInput] = useState<string>('0')
  const [paidRemark, setPaidRemark] = useState('')
  const [paidAtLocal, setPaidAtLocal] = useState('')

  async function load() {
    setLoading(true)
    try {
      const data = await apiRequest<any[]>('/api/orders?order_type=wholesale')

      const next = (data ?? []).map((r: any) => ({
        order_id: String(r.order_id),
        buyer_name: String(r.buyer_name ?? ''),
        total_amount: Number(r.total_amount ?? 0),
        paid_amount: Number(r.paid_amount ?? 0),
        settlement_status:
          (r.settlement_status as SettlementStatus | null) ?? null,
        paid_at: r.paid_at ? String(r.paid_at) : null,
        paid_remark: r.paid_remark ? String(r.paid_remark) : null,
        created_at: String(r.created_at),
      }))

      setOrders(next)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filteredOrders = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return orders
    return orders.filter((o) => {
      return o.order_id.toLowerCase().includes(q) || o.buyer_name.toLowerCase().includes(q)
    })
  }, [orders, query])

  const customerSummaries = useMemo(() => {
    const map = new Map<string, CustomerSummary>()
    for (const o of filteredOrders) {
      const buyer = o.buyer_name || '未命名客户'
      const due = calcDue(o.total_amount, o.paid_amount)
      const cur = map.get(buyer)
      if (!cur) {
        map.set(buyer, {
          buyer_name: buyer,
          orderCount: 1,
          totalDue: due,
          totalAmount: o.total_amount,
          totalPaid: o.paid_amount,
        })
      } else {
        cur.orderCount += 1
        cur.totalDue += due
        cur.totalAmount += o.total_amount
        cur.totalPaid += o.paid_amount
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalDue - a.totalDue)
  }, [filteredOrders])

  function openUpdate(o: WholesaleOrder) {
    setSelected(o)
    setPaidAmountInput(String(o.paid_amount ?? 0))
    setPaidRemark(o.paid_remark ?? '')
    setErrorMsg(null)
    setPaidAtLocal(() => {
      const d = o.paid_at ? new Date(o.paid_at) : new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
        d.getMinutes()
      )}`
    })
    setOpen(true)
  }

  async function handleSave() {
    if (!selected) return
    setSaving(true)
    setErrorMsg(null)
    try {
      const paid = Number(paidAmountInput)
      if (!Number.isFinite(paid) || paid < 0) {
        setErrorMsg('收款金额必须是非负数字')
        return
      }

      const nextStatus = calcNextStatus(selected.total_amount, paid)
      const paidAtISO = paidAtLocal ? new Date(paidAtLocal).toISOString() : new Date().toISOString()

      const payload = {
        paid_amount: paid,
        settlement_status: nextStatus,
        paid_at: paidAtISO,
        paid_remark: paidRemark.trim() ? paidRemark.trim() : null,
      }

      await apiRequest(`/api/orders/${selected.order_id}/paid`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })

      setOpen(false)
      await load()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '更新失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <h2 className="pageTitle">结算管理</h2>
      <p className="pageSub">批发订单收款更新 + 客户欠款汇总。</p>

      <div style={{ marginTop: 12 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索：订单号/客户名"
          style={{
            width: '100%',
            padding: '12px 14px',
            borderRadius: 12,
            border: '1px solid var(--border)',
            boxSizing: 'border-box',
            background: 'rgba(255,255,255,0.6)',
          }}
        />
      </div>

      {loading ? (
        <div style={{ marginTop: 16, opacity: 0.8 }}>加载中...</div>
      ) : (
        <>
          <div style={{ marginTop: 14, marginBottom: 10 }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 16 }}>客户欠款汇总</h3>
            <div className="cards">
              {customerSummaries.map((c) => (
                <div className="card" key={c.buyer_name}>
                  <div className="cardLabel">客户</div>
                  <div className="cardValue" style={{ fontSize: 18 }}>
                    {c.buyer_name}
                  </div>
                  <div className="cardHint" style={{ marginTop: 8 }}>
                    欠款：{c.totalDue.toFixed(2)} / 订单数：{c.orderCount}
                  </div>
                </div>
              ))}
              {customerSummaries.length === 0 ? (
                <div style={{ opacity: 0.8 }}>暂无匹配客户</div>
              ) : null}
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 16 }}>订单级收款更新</h3>
            <div className="tableWrap">
              <table className="dataTable">
                <thead>
                  <tr>
                    <th>订单号</th>
                    <th>客户</th>
                    <th className="right">金额</th>
                    <th className="right">已收</th>
                    <th className="right">欠款</th>
                    <th>状态</th>
                    <th className="right">最近收款</th>
                    <th className="right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((o) => {
                    const due = calcDue(o.total_amount, o.paid_amount)
                    const status = o.settlement_status ?? 'unpaid'
                    return (
                      <tr key={o.order_id}>
                        <td style={{ fontWeight: 700, color: 'var(--text-h)' }}>{o.order_id}</td>
                        <td className="wrap">{o.buyer_name}</td>
                        <td className="right">{o.total_amount.toFixed(2)}</td>
                        <td className="right">{o.paid_amount.toFixed(2)}</td>
                        <td className="right">{due.toFixed(2)}</td>
                        <td>{status}</td>
                        <td className="right">
                          {o.paid_at ? new Date(o.paid_at).toLocaleString() : '-'}
                        </td>
                        <td className="right">
                          <button className="ghostBtn" onClick={() => openUpdate(o)} disabled={saving}>
                            收款/更新
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                  {filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ padding: 14, opacity: 0.8 }}>
                        暂无订单
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {open && selected ? (
        <div className="modalOverlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}>更新收款（{selected.order_id}）</h3>
              <button
                className="ghostBtn"
                onClick={() => setOpen(false)}
                disabled={saving}
              >
                关闭
              </button>
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>
                总金额
              </label>
              <div style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 12 }}>
                {selected.total_amount.toFixed(2)}
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>
                已收金额（覆盖写入）
              </label>
              <input
                value={paidAmountInput}
                onChange={(e) => setPaidAmountInput(e.target.value)}
                type="number"
                min={0}
                step={0.01}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                  boxSizing: 'border-box',
                  background: 'rgba(255,255,255,0.6)',
                }}
              />
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>
                收款时间
              </label>
              <input
                value={paidAtLocal}
                onChange={(e) => setPaidAtLocal(e.target.value)}
                type="datetime-local"
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                  boxSizing: 'border-box',
                  background: 'rgba(255,255,255,0.6)',
                }}
              />
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>
                收款备注（可选）
              </label>
              <textarea
                value={paidRemark}
                onChange={(e) => setPaidRemark(e.target.value)}
                rows={3}
                placeholder="例如：收到定金/尾款已付"
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

            <div className="modalFooter">
              <button className="primaryBtn" onClick={handleSave} disabled={saving}>
                {saving ? '保存中...' : '保存更新'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

