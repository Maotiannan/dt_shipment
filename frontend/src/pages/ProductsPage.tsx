import { useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../lib/apiClient'

type SkuStatus = 'active' | 'inactive'

type FishSku = {
  sku_id: string
  sku_code: string | null
  name: string
  spec: string | null
  unit_price: number
  category: string | null
  status: SkuStatus
  created_at: string
}

type Mode = 'create' | 'edit'

export default function ProductsPage() {
  const [loading, setLoading] = useState(true)
  const [skus, setSkus] = useState<FishSku[]>([])

  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | SkuStatus>('all')

  const [modalOpen, setModalOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('create')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const [form, setForm] = useState<{
    sku_code: string
    name: string
    spec: string
    unit_price: string
    category: string
    status: SkuStatus
  }>({
    sku_code: '',
    name: '',
    spec: '',
    unit_price: '0',
    category: '',
    status: 'active',
  })

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return skus.filter((s) => {
      const matchQ =
        !q ||
        s.name.toLowerCase().includes(q) ||
        (s.sku_code ?? '').toLowerCase().includes(q) ||
        (s.spec ?? '').toLowerCase().includes(q) ||
        (s.category ?? '').toLowerCase().includes(q)
      const matchStatus = statusFilter === 'all' ? true : s.status === statusFilter
      return matchQ && matchStatus
    })
  }, [skus, query, statusFilter])

  async function loadSkus() {
    setLoading(true)
    setErrorMsg(null)
    try {
      const data = await apiRequest<FishSku[]>('/api/skus')
      setSkus((data ?? []) as FishSku[])
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '加载 SKU 失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSkus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openCreate() {
    setMode('create')
    setEditingId(null)
    setForm({
      sku_code: '',
      name: '',
      spec: '',
      unit_price: '0',
      category: '',
      status: 'active',
    })
    setErrorMsg(null)
    setModalOpen(true)
  }

  function openEdit(s: FishSku) {
    setMode('edit')
    setEditingId(s.sku_id)
    setForm({
      sku_code: s.sku_code ?? '',
      name: s.name,
      spec: s.spec ?? '',
      unit_price: String(s.unit_price ?? 0),
      category: s.category ?? '',
      status: s.status,
    })
    setErrorMsg(null)
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setErrorMsg('产品名称不能为空')
      return
    }
    const price = Number(form.unit_price)
    if (!Number.isFinite(price) || price < 0) {
      setErrorMsg('单价必须是非负数字')
      return
    }

    if (mode === 'edit' && !editingId) {
      setErrorMsg('缺少编辑目标')
      return
    }

    setSaving(true)
    setErrorMsg(null)
    try {
      const payload = {
        sku_code: form.sku_code.trim() ? form.sku_code.trim() : null,
        name: form.name.trim(),
        spec: form.spec.trim() ? form.spec.trim() : null,
        unit_price: price,
        category: form.category.trim() ? form.category.trim() : null,
        status: form.status,
      }

      if (mode === 'create') {
        await apiRequest('/api/skus', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
      } else {
        await apiRequest(`/api/skus/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })
      }

      setModalOpen(false)
      await loadSkus()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleDisable(s: FishSku) {
    const ok = confirm(`确定停用 SKU「${s.name}」？停用后订单历史不受影响。`)
    if (!ok) return

    setSaving(true)
    setErrorMsg(null)
    try {
      await apiRequest(`/api/skus/${s.sku_id}`, {
        method: 'PUT',
        body: JSON.stringify({
          sku_code: s.sku_code,
          name: s.name,
          spec: s.spec,
          unit_price: s.unit_price,
          category: s.category,
          status: 'inactive',
          inventory_id: null,
        }),
      })
      await loadSkus()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '停用失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <h2 className="pageTitle">产品库（SKU CRUD）</h2>
      <p className="pageSub">新增/编辑/停用 SKU，为订单录入提供自动带出单价。</p>

      <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索：名称/编码/规格/类目"
          style={{
            flex: 1,
            padding: '12px 14px',
            borderRadius: 12,
            border: '1px solid var(--border)',
            boxSizing: 'border-box',
            background: 'rgba(255,255,255,0.6)',
          }}
        />
        <button className="primaryBtn" onClick={openCreate} disabled={loading}>
          新增 SKU
        </button>
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          style={{
            flex: 1,
            padding: '12px 14px',
            borderRadius: 12,
            border: '1px solid var(--border)',
            boxSizing: 'border-box',
            background: 'rgba(255,255,255,0.6)',
          }}
        >
          <option value="all">全部状态</option>
          <option value="active">active</option>
          <option value="inactive">inactive</option>
        </select>
      </div>

      {loading ? (
        <div style={{ marginTop: 16, opacity: 0.8 }}>加载中...</div>
      ) : null}

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

      <div style={{ marginTop: 14 }}>
        <div className="tableWrap">
          <table className="dataTable">
            <thead>
              <tr>
                <th>名称/编码</th>
                <th className="right">单价</th>
                <th>状态</th>
                <th>规格</th>
                <th>类目</th>
                <th className="right">创建时间</th>
                <th className="right">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.sku_id}>
                  <td className="wrap">
                    <div style={{ fontWeight: 700, color: 'var(--text-h)' }}>
                      {s.name}
                    </div>
                    {s.sku_code ? (
                      <div style={{ opacity: 0.7, fontSize: 12 }}>
                        编码：{s.sku_code}
                      </div>
                    ) : null}
                  </td>
                  <td className="right">{Number(s.unit_price).toFixed(2)}</td>
                  <td>{s.status}</td>
                  <td className="wrap">{s.spec ?? '-'}</td>
                  <td className="wrap">{s.category ?? '-'}</td>
                  <td className="right">{new Date(s.created_at).toLocaleString()}</td>
                  <td className="right">
                    <button className="ghostBtn" onClick={() => openEdit(s)} disabled={saving}>
                      编辑
                    </button>{' '}
                    {s.status === 'active' ? (
                      <button className="ghostBtn" onClick={() => handleDisable(s)} disabled={saving}>
                        停用
                      </button>
                    ) : (
                      <span style={{ opacity: 0.7, fontSize: 12 }}>已停用</span>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 14, opacity: 0.8 }}>
                    暂无 SKU
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
              <h3 style={{ margin: 0 }}>{mode === 'create' ? '新增 SKU' : '编辑 SKU'}</h3>
              <button className="ghostBtn" onClick={() => setModalOpen(false)} disabled={saving}>
                关闭
              </button>
            </div>

            <div style={{ marginTop: 14 }}>
              <label style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>
                SKU 编码（可选）
              </label>
              <input
                value={form.sku_code}
                onChange={(e) => setForm((f) => ({ ...f, sku_code: e.target.value }))}
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
                产品名称
              </label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
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
                规格/颜色/尺码（可选）
              </label>
              <input
                value={form.spec}
                onChange={(e) => setForm((f) => ({ ...f, spec: e.target.value }))}
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
                单价（元）
              </label>
              <input
                type="number"
                value={form.unit_price}
                onChange={(e) => setForm((f) => ({ ...f, unit_price: e.target.value }))}
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
                所属类目（可选）
              </label>
              <input
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
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
                状态
              </label>
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as SkuStatus }))}
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

