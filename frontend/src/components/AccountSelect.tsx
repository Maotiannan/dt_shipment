import { useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../lib/apiClient'

type BizAccount = {
  account_id: string
  account_name: string
  status?: string
}

export default function AccountSelect({
  value,
  onChange,
  disabled,
  placeholder = '请选择闲鱼账号',
}: {
  value: string | null
  onChange: (next: string) => void
  disabled?: boolean
  placeholder?: string
}) {
  const [loading, setLoading] = useState(true)
  const [accounts, setAccounts] = useState<BizAccount[]>([])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const data = await apiRequest<BizAccount[]>('/api/accounts')
        if (!alive) return
        setAccounts((data ?? []).filter((a) => (a.status ?? 'active') === 'active'))
      } finally {
        if (alive) setLoading(false)
      }
    })()

    return () => {
      alive = false
    }
  }, [])

  const options = useMemo(() => accounts, [accounts])

  return (
    <select
      value={value ?? ''}
      disabled={disabled || loading}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: '100%',
        padding: '12px 14px',
        borderRadius: 12,
        border: '1px solid var(--border)',
        boxSizing: 'border-box',
        background: 'rgba(255,255,255,0.6)',
      }}
    >
      <option value="" disabled>
        {placeholder}
      </option>
      {options.map((a) => (
        <option key={a.account_id} value={a.account_id}>
          {a.account_name}
        </option>
      ))}
    </select>
  )
}

