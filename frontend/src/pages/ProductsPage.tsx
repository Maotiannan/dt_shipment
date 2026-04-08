import { useEffect, useMemo, useState } from 'react'

import ProductImageManager from '../components/ProductImageManager'
import { removeItemById, upsertItemById } from '../lib/collectionState'
import { apiRequest } from '../lib/apiClient'
import {
  fetchProtectedImageObjectUrl,
  type ProductImageSummary,
} from '../lib/productImagesApi'
import { getPrimaryProductImage } from '../lib/productImageState'
import {
  buildSkuPayload,
  createEmptySkuForm,
  createSkuFormFromSku,
  matchesSkuQuery,
  type SkuFormState,
  type SkuStatus,
  type StructuredSku,
} from '../lib/skuForm'
import { loadSkuAttributeSuggestions } from '../lib/skuSuggestionsApi'

type FishSku = StructuredSku & {
  primary_image_thumb_url: string | null
}

type Mode = 'create' | 'edit'

function syncSkuPrimaryThumb(items: FishSku[], skuId: string, images: ProductImageSummary[]) {
  const nextPrimaryThumbUrl = getPrimaryProductImage(images)?.thumb_url ?? null
  return items.map((item) =>
    item.sku_id === skuId
      ? {
          ...item,
          primary_image_thumb_url: nextPrimaryThumbUrl,
        }
      : item
  )
}

function sortSkusByCreatedAtDesc(left: FishSku, right: FishSku) {
  return right.created_at.localeCompare(left.created_at)
}

function SkuThumbCell({ srcPath, label }: { srcPath: string | null; label: string }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!srcPath) {
      setObjectUrl(null)
      setError(false)
      return
    }

    let alive = true
    let nextObjectUrl: string | null = null
    setObjectUrl(null)
    setError(false)

    ;(async () => {
      try {
        nextObjectUrl = await fetchProtectedImageObjectUrl(srcPath)
        if (!alive) {
          URL.revokeObjectURL(nextObjectUrl)
          return
        }
        setObjectUrl(nextObjectUrl)
      } catch {
        if (alive) {
          setError(true)
        }
      }
    })()

    return () => {
      alive = false
      if (nextObjectUrl) {
        URL.revokeObjectURL(nextObjectUrl)
      }
    }
  }, [srcPath])

  if (!srcPath || error) {
    return <div className="productListThumbPlaceholder">无图</div>
  }

  if (!objectUrl) {
    return <div className="productListThumbPlaceholder">加载中...</div>
  }

  return <img src={objectUrl} alt={label} className="productListThumbImage" />
}

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
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null)

  const [form, setForm] = useState<SkuFormState>(createEmptySkuForm())
  const [categorySuggestions, setCategorySuggestions] = useState<string[]>([])
  const [colorSuggestions, setColorSuggestions] = useState<string[]>([])
  const [variantSuggestions, setVariantSuggestions] = useState<string[]>([])

  const filtered = useMemo(() => {
    return skus.filter((sku) => {
      const matchStatus = statusFilter === 'all' ? true : sku.status === statusFilter
      return matchStatus && matchesSkuQuery(sku, query)
    })
  }, [query, skus, statusFilter])

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
    void loadSkus()
  }, [])

  useEffect(() => {
    if (!modalOpen) {
      return
    }

    let alive = true
    ;(async () => {
      try {
        const suggestions = await loadSkuAttributeSuggestions({ attribute: 'category' })
        if (alive) {
          setCategorySuggestions(suggestions)
        }
      } catch {
        if (alive) {
          setCategorySuggestions([])
        }
      }
    })()

    return () => {
      alive = false
    }
  }, [modalOpen])

  useEffect(() => {
    if (!modalOpen) {
      return
    }

    const categoryName = form.categoryName.trim()
    if (!categoryName) {
      setColorSuggestions([])
      setVariantSuggestions([])
      return
    }

    let alive = true
    ;(async () => {
      try {
        const [colors, variants] = await Promise.all([
          loadSkuAttributeSuggestions({ attribute: 'color', categoryName }),
          loadSkuAttributeSuggestions({ attribute: 'variant', categoryName }),
        ])

        if (!alive) {
          return
        }

        setColorSuggestions(colors)
        setVariantSuggestions(variants)
      } catch {
        if (!alive) {
          return
        }
        setColorSuggestions([])
        setVariantSuggestions([])
      }
    })()

    return () => {
      alive = false
    }
  }, [form.categoryName, modalOpen])

  function openCreate() {
    setMode('create')
    setEditingId(null)
    setForm(createEmptySkuForm())
    setErrorMsg(null)
    setNoticeMsg(null)
    setModalOpen(true)
  }

  function openEdit(sku: FishSku) {
    setMode('edit')
    setEditingId(sku.sku_id)
    setForm(createSkuFormFromSku(sku))
    setErrorMsg(null)
    setNoticeMsg(null)
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setErrorMsg('产品名称不能为空')
      return
    }

    if (mode === 'edit' && !editingId) {
      setErrorMsg('缺少编辑目标')
      return
    }

    setSaving(true)
    setErrorMsg(null)
    setNoticeMsg(null)

    try {
      const payload = buildSkuPayload(form)
      if (mode === 'create') {
        const saved = await apiRequest<FishSku>('/api/skus', {
          method: 'POST',
          body: JSON.stringify(payload),
        })

        const nextSku = { ...saved, primary_image_thumb_url: null }
        setSkus((current) => upsertItemById(current, nextSku, (row) => row.sku_id, sortSkusByCreatedAtDesc))
        setMode('edit')
        setEditingId(saved.sku_id)
        setForm(createSkuFormFromSku(nextSku))
        setNoticeMsg('SKU 已创建，可以继续上传商品图片。')
      } else {
        const saved = await apiRequest<FishSku>(`/api/skus/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })

        setSkus((current) => {
          const existing = current.find((row) => row.sku_id === editingId)
          return upsertItemById(
            current,
            {
              ...saved,
              primary_image_thumb_url: existing?.primary_image_thumb_url ?? null,
            },
            (row) => row.sku_id,
            sortSkusByCreatedAtDesc
          )
        })
        setForm(createSkuFormFromSku(saved))
        setNoticeMsg('SKU 已保存。')
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleDisable(sku: FishSku) {
    const ok = confirm(`确定停用 SKU「${sku.name}」？停用后订单历史不受影响。`)
    if (!ok) return

    setSaving(true)
    setErrorMsg(null)
    try {
      const saved = await apiRequest<FishSku>(`/api/skus/${sku.sku_id}`, {
        method: 'PUT',
        body: JSON.stringify({
          sku_code: sku.sku_code,
          name: sku.name,
          category_name: sku.category_name,
          color_name: sku.color_name,
          variant_name: sku.variant_name,
          unit_price: sku.unit_price,
          inventory_quantity: sku.inventory_quantity,
          status: 'inactive',
          inventory_id: null,
        }),
      })

      setSkus((current) => {
        const existing = current.find((row) => row.sku_id === sku.sku_id)
        return upsertItemById(
          current,
          {
            ...saved,
            primary_image_thumb_url: existing?.primary_image_thumb_url ?? null,
          },
          (row) => row.sku_id,
          sortSkusByCreatedAtDesc
        )
      })
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '停用失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(sku: FishSku) {
    const ok = confirm(`确定删除 SKU「${sku.name}」？关联图片会一起删除，历史订单里的快照文本仍保留。`)
    if (!ok) return

    setSaving(true)
    setErrorMsg(null)
    try {
      await apiRequest(`/api/skus/${sku.sku_id}`, { method: 'DELETE' })
      setSkus((current) => removeItemById(current, sku.sku_id, (row) => row.sku_id))
      if (editingId === sku.sku_id) {
        setModalOpen(false)
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '删除 SKU 失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <h2 className="pageTitle">产品库（SKU CRUD）</h2>
      <p className="pageSub">结构化管理类目、颜色、规格、库存，并支持同流程上传商品图片。</p>

      <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索：名称/编码/类目/颜色/规格"
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
          onChange={(event) => setStatusFilter(event.target.value as 'all' | SkuStatus)}
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

      {loading ? <div style={{ marginTop: 16, opacity: 0.8 }}>加载中...</div> : null}

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
                <th style={{ width: 96 }}>主图</th>
                <th>类目</th>
                <th>颜色</th>
                <th>规格</th>
                <th className="right">单价</th>
                <th className="right">库存</th>
                <th>状态</th>
                <th className="right">创建时间</th>
                <th className="right">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((sku) => (
                <tr key={sku.sku_id}>
                  <td className="wrap">
                    <div style={{ fontWeight: 700, color: 'var(--text-h)' }}>{sku.name}</div>
                    {sku.sku_code ? (
                      <div style={{ opacity: 0.7, fontSize: 12 }}>编码：{sku.sku_code}</div>
                    ) : null}
                  </td>
                  <td>
                    <SkuThumbCell srcPath={sku.primary_image_thumb_url} label={sku.name} />
                  </td>
                  <td className="wrap">{sku.category_name ?? '-'}</td>
                  <td className="wrap">{sku.color_name ?? '-'}</td>
                  <td className="wrap">{sku.variant_name ?? '-'}</td>
                  <td className="right">{Number(sku.unit_price).toFixed(2)}</td>
                  <td className="right">{Number(sku.inventory_quantity ?? 0)}</td>
                  <td>{sku.status}</td>
                  <td className="right">{new Date(sku.created_at).toLocaleString()}</td>
                  <td className="right">
                    <button className="ghostBtn" onClick={() => openEdit(sku)} disabled={saving}>
                      编辑
                    </button>{' '}
                    {sku.status === 'active' ? (
                      <button className="ghostBtn" onClick={() => handleDisable(sku)} disabled={saving}>
                        停用
                      </button>
                    ) : (
                      <span style={{ opacity: 0.7, fontSize: 12 }}>已停用</span>
                    )}{' '}
                    <button className="ghostBtn" onClick={() => handleDelete(sku)} disabled={saving}>
                      删除
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ padding: 14, opacity: 0.8 }}>
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
          <div className="modal" style={{ maxWidth: 960 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <h3 style={{ margin: 0 }}>{mode === 'create' ? '新增 SKU' : '编辑 SKU'}</h3>
                <p style={{ margin: '6px 0 0', opacity: 0.75, fontSize: 13 }}>
                  保存后会自动沉淀候选项；新建成功后可直接继续上传商品图片。
                </p>
              </div>
              <button className="ghostBtn" onClick={() => setModalOpen(false)} disabled={saving}>
                关闭
              </button>
            </div>

            <div
              style={{
                marginTop: 16,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 12,
              }}
            >
              <label style={{ display: 'block' }}>
                <div style={{ marginBottom: 8, fontSize: 14 }}>SKU 编码（可选）</div>
                <input
                  value={form.skuCode}
                  onChange={(event) => setForm((current) => ({ ...current, skuCode: event.target.value }))}
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: 12,
                    border: '1px solid var(--border)',
                    boxSizing: 'border-box',
                  }}
                />
              </label>

              <label style={{ display: 'block' }}>
                <div style={{ marginBottom: 8, fontSize: 14 }}>产品名称</div>
                <input
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: 12,
                    border: '1px solid var(--border)',
                    boxSizing: 'border-box',
                  }}
                />
              </label>

              <label style={{ display: 'block' }}>
                <div style={{ marginBottom: 8, fontSize: 14 }}>类目</div>
                <input
                  list="sku-category-suggestions"
                  value={form.categoryName}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, categoryName: event.target.value }))
                  }
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: 12,
                    border: '1px solid var(--border)',
                    boxSizing: 'border-box',
                  }}
                />
                <datalist id="sku-category-suggestions">
                  {categorySuggestions.map((value) => (
                    <option key={value} value={value} />
                  ))}
                </datalist>
              </label>

              <label style={{ display: 'block' }}>
                <div style={{ marginBottom: 8, fontSize: 14 }}>颜色</div>
                <input
                  list="sku-color-suggestions"
                  value={form.colorName}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, colorName: event.target.value }))
                  }
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: 12,
                    border: '1px solid var(--border)',
                    boxSizing: 'border-box',
                  }}
                />
                <datalist id="sku-color-suggestions">
                  {colorSuggestions.map((value) => (
                    <option key={value} value={value} />
                  ))}
                </datalist>
              </label>

              <label style={{ display: 'block' }}>
                <div style={{ marginBottom: 8, fontSize: 14 }}>规格</div>
                <input
                  list="sku-variant-suggestions"
                  value={form.variantName}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, variantName: event.target.value }))
                  }
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: 12,
                    border: '1px solid var(--border)',
                    boxSizing: 'border-box',
                  }}
                />
                <datalist id="sku-variant-suggestions">
                  {variantSuggestions.map((value) => (
                    <option key={value} value={value} />
                  ))}
                </datalist>
              </label>

              <label style={{ display: 'block' }}>
                <div style={{ marginBottom: 8, fontSize: 14 }}>单价（元）</div>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={form.unitPrice}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, unitPrice: event.target.value }))
                  }
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: 12,
                    border: '1px solid var(--border)',
                    boxSizing: 'border-box',
                    background: 'rgba(255,255,255,0.6)',
                  }}
                />
              </label>

              <label style={{ display: 'block' }}>
                <div style={{ marginBottom: 8, fontSize: 14 }}>库存</div>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={form.inventoryQuantity}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, inventoryQuantity: event.target.value }))
                  }
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: 12,
                    border: '1px solid var(--border)',
                    boxSizing: 'border-box',
                    background: 'rgba(255,255,255,0.6)',
                  }}
                />
              </label>

              <label style={{ display: 'block' }}>
                <div style={{ marginBottom: 8, fontSize: 14 }}>状态</div>
                <select
                  value={form.status}
                  onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as SkuStatus }))}
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
              </label>
            </div>

            {editingId ? (
              <div style={{ marginTop: 18 }}>
                <ProductImageManager
                  skuId={editingId}
                  skuName={form.name || undefined}
                  onImagesChange={(nextImages) => {
                    setSkus((current) => syncSkuPrimaryThumb(current, editingId, nextImages))
                  }}
                />
              </div>
            ) : null}

            {noticeMsg ? (
              <div
                style={{
                  marginTop: 12,
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: '1px solid rgba(0,128,0,0.18)',
                  color: '#166534',
                  background: 'rgba(22,101,52,0.08)',
                  fontSize: 13,
                }}
              >
                {noticeMsg}
              </div>
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

            <div style={{ marginTop: 16, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="ghostBtn" onClick={() => setModalOpen(false)} disabled={saving}>
                关闭
              </button>
              <button className="primaryBtn" onClick={handleSave} disabled={saving} style={{ width: 'auto' }}>
                {saving ? '保存中...' : mode === 'create' ? '创建并继续' : '保存'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
