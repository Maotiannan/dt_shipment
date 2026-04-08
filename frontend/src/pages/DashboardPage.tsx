import { useEffect, useState } from 'react'
import { apiRequest } from '../lib/apiClient'
import {
  buildDashboardSummary,
  type DashboardAccount,
  type DashboardAccountStat,
  type DashboardOrder,
} from '../lib/dashboardSummary'
import { ensurePushSubscription, showPushNotification } from '../lib/webPush'

export default function DashboardPage() {
  const [loading, setLoading] = useState(true)
  const [pendingTimeoutCount, setPendingTimeoutCount] = useState(0)
  const [abnormalCount, setAbnormalCount] = useState(0)
  const [dueAmount, setDueAmount] = useState(0)
  const [accountStats, setAccountStats] = useState<DashboardAccountStat[]>([])

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
      const orders = await apiRequest<DashboardOrder[]>('/api/orders')
      const timeoutCount = orders.filter(
        (o) =>
          o.ship_status === 'pending' &&
          new Date(o.created_at).toISOString() <= timeoutAt
      ).length
      setPendingTimeoutCount(timeoutCount)
      const accountRows = await apiRequest<DashboardAccount[]>('/api/accounts')
      const summary = buildDashboardSummary(accountRows ?? [], orders ?? [])
      setAbnormalCount(summary.abnormalCount)
      setDueAmount(summary.dueAmount)
      setAccountStats(summary.accountStats)
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
            <div className="cardHint">全部订单应收金额汇总</div>
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
                  发货：未发货 {s.pendingCount} / 已发货 {s.shippedCount}（私发 {s.shippedPrivateCount} / 上传 {s.shippedUploadedCount}）
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
