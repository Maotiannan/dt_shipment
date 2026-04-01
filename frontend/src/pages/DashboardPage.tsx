import { useEffect, useState } from 'react'
import { apiRequest } from '../lib/apiClient'
import { ensurePushSubscription, showPushNotification } from '../lib/webPush'

type AccountStat = {
  account_id: string
  account_name: string
  biz_type: 'wholesale' | 'retail' | 'mixed'
  wholesaleCount: number
  retailCount: number
  pendingCount: number
  shippedPrivateCount: number
  shippedUploadedCount: number
  abnormalCount: number
  unpaidCount: number
  partialPaidCount: number
  settledCount: number
  dueAmount: number
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true)
  const [pendingTimeoutCount, setPendingTimeoutCount] = useState(0)
  const [abnormalCount, setAbnormalCount] = useState(0)
  const [dueAmount, setDueAmount] = useState(0)
  const [accountStats, setAccountStats] = useState<AccountStat[]>([])

  const [pushEnabled, setPushEnabled] = useState(() => {
    return typeof Notification !== 'undefined' &&
      Notification.permission === 'granted'
      ? true
      : false
  })
  const [pushBusy, setPushBusy] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const timeoutAt = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
      const orders = await apiRequest<any[]>('/api/orders')
      const timeoutCount = orders.filter(
        (o) =>
          o.ship_status === 'pending' &&
          new Date(o.created_at).toISOString() <= timeoutAt
      ).length
      setPendingTimeoutCount(timeoutCount)
      const abnormal = orders.filter((o) => o.is_abnormal).length
      setAbnormalCount(abnormal)
      const wholesaleDue = orders.filter(
        (o) =>
          o.order_type === 'wholesale' &&
          ['unpaid', 'partial_paid'].includes(o.settlement_status ?? '')
      )
      const nextDue = wholesaleDue.reduce((sum, r: any) => {
        const total = Number(r.total_amount ?? 0)
        const paid = Number(r.paid_amount ?? 0)
        return sum + Math.max(0, total - paid)
      }, 0)
      setDueAmount(nextDue)

      const accountRows = await apiRequest<any[]>('/api/accounts')
      const orderRows = orders

      const map = new Map<string, AccountStat>()
      for (const a of (accountRows ?? []) as any[]) {
        map.set(a.account_id, {
          account_id: a.account_id,
          account_name: String(a.account_name ?? ''),
          biz_type: a.biz_type as AccountStat['biz_type'],
          wholesaleCount: 0,
          retailCount: 0,
          pendingCount: 0,
          shippedPrivateCount: 0,
          shippedUploadedCount: 0,
          abnormalCount: 0,
          unpaidCount: 0,
          partialPaidCount: 0,
          settledCount: 0,
          dueAmount: 0,
        })
      }

      for (const o of (orderRows ?? []) as any[]) {
        const stat = map.get(o.account_id)
        if (!stat) continue

        if (o.order_type === 'wholesale') stat.wholesaleCount += 1
        if (o.order_type === 'retail') stat.retailCount += 1

        if (o.ship_status === 'pending') stat.pendingCount += 1
        if (o.ship_status === 'shipped_private') stat.shippedPrivateCount += 1
        if (o.ship_status === 'shipped_uploaded') stat.shippedUploadedCount += 1

        if (o.is_abnormal) stat.abnormalCount += 1

        if (o.order_type === 'wholesale') {
          const settlement = o.settlement_status as
            | 'unpaid'
            | 'partial_paid'
            | 'settled'
            | null
          const total = Number(o.total_amount ?? 0)
          const paid = Number(o.paid_amount ?? 0)
          if (settlement === 'unpaid') stat.unpaidCount += 1
          if (settlement === 'partial_paid') stat.partialPaidCount += 1
          if (settlement === 'settled') stat.settledCount += 1

          if (settlement === 'unpaid' || settlement === 'partial_paid') {
            stat.dueAmount += Math.max(0, total - paid)
          }
        }
      }

      const next = Array.from(map.values()).sort((a, b) => b.dueAmount - a.dueAmount)
      setAccountStats(next)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!pushEnabled) return
    if (pendingTimeoutCount <= 0 && abnormalCount <= 0) return

    const today = new Date().toDateString()
    const key = `webpush_last_notify_${today}`
    if (localStorage.getItem(key)) return

    const lines: string[] = []
    if (pendingTimeoutCount > 0) lines.push(`超时未发货：${pendingTimeoutCount} 单`)
    if (abnormalCount > 0) lines.push(`异常订单：${abnormalCount} 单`)

    showPushNotification('发货管家提醒', lines.join('；')).finally(() => {
      localStorage.setItem(key, '1')
    })
  }, [pushEnabled, pendingTimeoutCount, abnormalCount])

  return (
    <div className="page">
      <h2 className="pageTitle">发货状态看板</h2>

      {loading ? (
        <div style={{ opacity: 0.8 }}>加载中...</div>
      ) : (
        <div className="cards">
          <div className="card">
            <div className="cardLabel">待处理</div>
            <div className="cardValue" style={pendingTimeoutCount > 0 ? { color: '#b91c1c' } : undefined}>
              {pendingTimeoutCount}
            </div>
            <div className="cardHint">未发货且超时（创建超过 24 小时）</div>
          </div>

          <div className="card">
            <div className="cardLabel">异常订单</div>
            <div className="cardValue">{abnormalCount}</div>
            <div className="cardHint">需跟进的异常情况</div>
          </div>

          <div className="card">
            <div className="cardLabel">待收尾款</div>
            <div className="cardValue">{dueAmount.toFixed(2)}</div>
            <div className="cardHint">批发客户欠款汇总（unpaid/partial_paid）</div>
          </div>
        </div>
      )}

      {!loading && accountStats.length ? (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ margin: '0 0 10px', fontSize: 16 }}>多账号统计（Phase3）</h3>
          <div className="cards">
            {accountStats.map((s) => (
              <div className="card" key={s.account_id}>
                <div className="cardLabel">账号：{s.account_name}</div>
                <div className="cardValue" style={{ fontSize: 22 }}>
                  {s.wholesaleCount + s.retailCount}
                </div>
                <div className="cardHint" style={{ marginTop: 8 }}>
                  发货：未发货 {s.pendingCount} / 私发 {s.shippedPrivateCount} / 上传 {s.shippedUploadedCount}
                </div>
                <div className="cardHint" style={{ marginTop: 8 }}>
                  结算：未付 {s.unpaidCount} / 部分 {s.partialPaidCount} / 已结清 {s.settledCount} / 欠款 {s.dueAmount.toFixed(2)}
                </div>
                <div className="cardHint" style={{ marginTop: 8 }}>
                  异常：{s.abnormalCount}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: 14 }}>
        <button
          className="ghostBtn"
          onClick={async () => {
            setPushBusy(true)
            try {
              const ok = await ensurePushSubscription()
              setPushEnabled(ok)
              if (ok) {
                // 主动试发一次（当前已知事件）
                const today = new Date().toDateString()
                const key = `webpush_last_notify_${today}`
                localStorage.removeItem(key)
              }
            } catch {
              // ignore
            } finally {
              setPushBusy(false)
            }
          }}
          disabled={pushBusy}
          style={{ width: '100%' }}
        >
          {pushEnabled ? '推送已开启（可重新订阅）' : pushBusy ? '正在开启...' : '开启推送提醒'}
        </button>
      </div>
    </div>
  )
}

