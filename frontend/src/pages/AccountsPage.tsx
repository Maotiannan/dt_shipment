import { useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../lib/apiClient'
import { removeItemById, upsertItemById } from '../lib/collectionState'

type BizType = 'wholesale' | 'retail' | 'mixed'
type AccountStatus = 'active' | 'inactive'

type FishAccount = {
  account_id: string
  account_name: string
  remark: string | null
  biz_type: BizType
  status: AccountStatus
  created_at: string
}

export default function AccountsPage() {
  const [loading, setLoading] = useState(true)
  const [accounts, setAccounts] = useState<FishAccount[]>([])
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    if (!query.trim()) return accounts
    const q = query.trim()
    return accounts.filter((a) => {
      const remark = a.remark ?? ''
      return a.account_name.includes(q) || remark.includes(q) || a.biz_type.includes(q)
    })
  }, [accounts, query])

  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create')
  const [form, setForm] = useState<{
    account_name: string
    remark: string
    biz_type: BizType
    status: AccountStatus
  }>({
    account_name: '',
    remark: '',
    biz_type: 'mixed',
    status: 'active',
  })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function loadAccounts() {
    setLoading(true)
    setErrorMsg(null)
    try {
      const data = await apiRequest<FishAccount[]>('/api/accounts')
      setAccounts((data ?? []) as FishAccount[])
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '加载账号失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAccounts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openCreate() {
    setModalMode('create')
    setEditingId(null)
    setForm({ account_name: '', remark: '', biz_type: 'mixed', status: 'active' })
    setErrorMsg(null)
    setModalOpen(true)
  }

  function openEdit(a: FishAccount) {
    setModalMode('edit')
    setEditingId(a.account_id)
    setForm({
      account_name: a.account_name,
      remark: a.remark ?? '',
      biz_type: a.biz_type,
      status: a.status,
    })
    setErrorMsg(null)
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.account_name.trim()) {
      setErrorMsg('账号名称不能为空')
      return
    }
    if (modalMode === 'edit' && !editingId) {
      setErrorMsg('缺少编辑目标')
      return
    }

    setSaving(true)
    setErrorMsg(null)
    try {
      if (modalMode === 'create') {
        const saved = await apiRequest<FishAccount>('/api/accounts', {
          method: 'POST',
          body: JSON.stringify({
            account_name: form.account_name.trim(),
            remark: form.remark.trim() ? form.remark.trim() : null,
            biz_type: form.biz_type,
            status: form.status,
          }),
        })
        setAccounts((current) =>
          upsertItemById(
            current,
            saved,
            (row) => row.account_id,
            (left, right) => right.created_at.localeCompare(left.created_at)
          )
        )
      } else {
        const saved = await apiRequest<FishAccount>(`/api/accounts/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify({
            account_name: form.account_name.trim(),
            remark: form.remark.trim() ? form.remark.trim() : null,
            biz_type: form.biz_type,
            status: form.status,
          })
        })
        setAccounts((current) => upsertItemById(current, saved, (row) => row.account_id))
      }

      setModalOpen(false)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleDisable(a: FishAccount) {
    const ok = confirm(`确定停用账号「${a.account_name}」？停用后历史订单仍保留。`)
    if (!ok) return

    setSaving(true)
    setErrorMsg(null)
    try {
      const saved = await apiRequest<FishAccount>(`/api/accounts/${a.account_id}`, {
        method: 'PUT',
        body: JSON.stringify({
          account_name: a.account_name,
          remark: a.remark ?? null,
          biz_type: a.biz_type,
          status: 'inactive',
        }),
      })
      setAccounts((current) => upsertItemById(current, saved, (row) => row.account_id))
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '停用失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(a: FishAccount) {
    const ok = confirm(`确定删除账号「${a.account_name}」？如果该账号已有订单，将阻止删除。`)
    if (!ok) return

    setSaving(true)
    setErrorMsg(null)
    try {
      await apiRequest(`/api/accounts/${a.account_id}`, {
        method: 'DELETE',
      })
      setAccounts((current) => removeItemById(current, a.account_id, (row) => row.account_id))
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '删除账号失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <h2 className="pageTitle">账号管理</h2>
      <p className="pageSub">新增/编辑/停用/删除闲鱼账号；若账号已有订单引用，将禁止删除。</p>

      <div style={{ marginTop: 14 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="快速筛选：账号名/备注/业务类型"
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

      <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>
        <button className="primaryBtn" onClick={openCreate} disabled={loading}>
          新增账号
        </button>
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

      {loading ? (
        <div style={{ marginTop: 16, opacity: 0.8 }}>加载中...</div>
      ) : null}

      <div style={{ marginTop: 14 }}>
        <div className="tableWrap">
          <table className="dataTable">
            <thead>
              <tr>
                <th>账号名称</th>
                <th>业务类型</th>
                <th>状态</th>
                <th className="right">创建时间</th>
                <th className="right">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.account_id}>
                  <td className="wrap">
                    <div style={{ fontWeight: 700, color: 'var(--text-h)' }}>
                      {a.account_name}
                    </div>
                    {a.remark ? (
                      <div style={{ opacity: 0.7, fontSize: 12 }}>
                        备注：{a.remark}
                      </div>
                    ) : null}
                  </td>
                  <td>{a.biz_type}</td>
                  <td>{a.status}</td>
                  <td className="right">
                    {new Date(a.created_at).toLocaleString()}
                  </td>
                  <td className="right">
                    <button className="ghostBtn" onClick={() => openEdit(a)} disabled={saving}>
                      编辑
                    </button>{' '}
                    {a.status === 'active' ? (
                      <button className="ghostBtn" onClick={() => handleDisable(a)} disabled={saving}>
                        停用
                      </button>
                    ) : (
                      <span style={{ opacity: 0.7, fontSize: 12 }}>已停用</span>
                    )}{' '}
                    <button className="ghostBtn" onClick={() => handleDelete(a)} disabled={saving}>
                      删除
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: 14, opacity: 0.8 }}>
                    暂无账号
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
              <h3 style={{ margin: 0 }}>{modalMode === 'create' ? '新增账号' : '编辑账号'}</h3>
              <button className="ghostBtn" onClick={() => setModalOpen(false)} disabled={saving}>
                关闭
              </button>
            </div>

            <div style={{ marginTop: 14 }}>
              <label style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>
                账号名称
              </label>
              <input
                value={form.account_name}
                onChange={(e) => setForm((s) => ({ ...s, account_name: e.target.value }))}
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
                备注（可选）
              </label>
              <input
                value={form.remark}
                onChange={(e) => setForm((s) => ({ ...s, remark: e.target.value }))}
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
                业务类型
              </label>
              <select
                value={form.biz_type}
                onChange={(e) => setForm((s) => ({ ...s, biz_type: e.target.value as BizType }))}
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
                <option value="mixed">混合</option>
              </select>
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>
                状态
              </label>
              <select
                value={form.status}
                onChange={(e) => setForm((s) => ({ ...s, status: e.target.value as AccountStatus }))}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                  boxSizing: 'border-box',
                  background: 'rgba(255,255,255,0.6)',
                }}
              >
                <option value="active">active</option>
                <option value="inactive">inactive</option>
              </select>
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

            <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
              <button className="primaryBtn" onClick={handleSave} disabled={saving}>
                {saving ? '保存中...' : '保存'}
              </button>
              <button
                className="ghostBtn"
                onClick={() => setModalOpen(false)}
                disabled={saving}
                style={{ padding: '12px 14px' }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
