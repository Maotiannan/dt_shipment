import { useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../lib/apiClient'

type Sku = {
  sku_id: string
  sku_code: string | null
  name: string
  spec: string | null
  unit_price: number
  inventory_id: string | null
  status?: string
}

export default function SkuPicker({
  skuId,
  onChange,
  disabled,
  placeholder = '搜索 SKU（编码/名称）',
  fallbackLabel,
}: {
  skuId: string | null
  onChange: (next: {
    sku_id: string
    name: string
    unit_price: number
    inventory_id: string | null
  }) => void
  disabled?: boolean
  placeholder?: string
  fallbackLabel?: string
}) {
  const [loading, setLoading] = useState(true)
  const [skus, setSkus] = useState<Sku[]>([])
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const data = await apiRequest<Sku[]>('/api/skus')
        if (!alive) return
        setSkus(
          (data ?? []).filter((s) => (s.status ?? 'active') === 'active' || s.sku_id === skuId)
        )
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [skuId])

  const selectedSku = useMemo(() => {
    if (!skuId) return null
    return skus.find((s) => s.sku_id === skuId) ?? null
  }, [skuId, skus])

  useEffect(() => {
    if (selectedSku) {
      const display = selectedSku.sku_code
        ? `${selectedSku.sku_code} ${selectedSku.name}`
        : selectedSku.name
      setQuery(display)
    } else if (fallbackLabel?.trim()) {
      setQuery(fallbackLabel)
    } else if (!skuId) {
      setQuery('')
    }
  }, [fallbackLabel, selectedSku, skuId])

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return skus
      .filter((s) => {
        const code = (s.sku_code ?? '').toLowerCase()
        const name = s.name.toLowerCase()
        return code.includes(q) || name.includes(q)
      })
      .slice(0, 10)
  }, [query, skus])

  const showDropdown = focused && query.trim().length > 0 && !disabled && !loading

  return (
    <div style={{ position: 'relative' }}>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={disabled || loading}
        placeholder={loading ? '加载 SKU...' : placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          // 允许点击下拉项（onMouseDown）后再关闭
          setTimeout(() => setFocused(false), 120)
        }}
        style={{
          width: '100%',
          padding: '12px 14px',
          borderRadius: 12,
          border: '1px solid var(--border)',
          boxSizing: 'border-box',
          background: 'rgba(255,255,255,0.6)',
        }}
      />

      {showDropdown ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 'calc(100% + 6px)',
            zIndex: 10,
            background: 'rgba(255,255,255,0.95)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            maxHeight: 240,
            overflow: 'auto',
          }}
        >
          {suggestions.length ? (
            suggestions.map((s) => {
              const label = s.sku_code ? `${s.sku_code} ${s.name}` : s.name
              const active = skuId === s.sku_id
              return (
                <button
                  key={s.sku_id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() =>
                    onChange({
                      sku_id: s.sku_id,
                      name: s.name,
                      unit_price: s.unit_price,
                      inventory_id: s.inventory_id ?? null,
                    })
                  }
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 12px',
                    background: active ? 'rgba(170,59,255,0.12)' : 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'inherit',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
                  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
                    单价：{Number(s.unit_price).toFixed(2)}
                  </div>
                </button>
              )
            })
          ) : (
            <div style={{ padding: 12, opacity: 0.8 }}>无匹配 SKU</div>
          )}
        </div>
      ) : null}
    </div>
  )
}
