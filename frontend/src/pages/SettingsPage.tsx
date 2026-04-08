import { useEffect, useState } from 'react'

import {
  createSkuSuggestionSetting,
  listSkuSuggestionSettings,
  updateSkuSuggestionSetting,
  type SkuSuggestionSettingAttribute,
  type SkuSuggestionSettingRecord,
} from '../lib/settingsApi'

type FilterState = {
  attribute: 'all' | SkuSuggestionSettingAttribute
  scopeKey: string
  query: string
  includeDisabled: boolean
}

type FormState = {
  editingId: string | null
  attributeType: SkuSuggestionSettingAttribute
  scopeKey: string
  value: string
}

const emptyFilters: FilterState = {
  attribute: 'all',
  scopeKey: '',
  query: '',
  includeDisabled: false,
}

const emptyForm: FormState = {
  editingId: null,
  attributeType: 'category',
  scopeKey: '',
  value: '',
}

function attributeLabel(attribute: SkuSuggestionSettingAttribute) {
  if (attribute === 'category') return '类目'
  if (attribute === 'color') return '颜色'
  return '规格'
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null)
  const [records, setRecords] = useState<SkuSuggestionSettingRecord[]>([])
  const [filters, setFilters] = useState<FilterState>(emptyFilters)
  const [form, setForm] = useState<FormState>(emptyForm)

  async function loadRecords(nextFilters = filters) {
    setLoading(true)
    setErrorMsg(null)

    try {
      const items = await listSkuSuggestionSettings({
        attribute: nextFilters.attribute === 'all' ? null : nextFilters.attribute,
        scopeKey: nextFilters.scopeKey,
        query: nextFilters.query,
        includeDisabled: nextFilters.includeDisabled,
      })
      setRecords(items)
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : '加载设置失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadRecords(emptyFilters)
  }, [])

  function resetForm() {
    setForm(emptyForm)
  }

  function startEdit(record: SkuSuggestionSettingRecord) {
    setForm({
      editingId: record.suggestion_id,
      attributeType: record.attribute_type,
      scopeKey: record.scope_key ?? '',
      value: record.value,
    })
    setNoticeMsg(null)
    setErrorMsg(null)
  }

  async function handleSave() {
    const value = form.value.trim()
    if (!value) {
      setErrorMsg('候选项内容不能为空')
      return
    }

    if (form.attributeType !== 'category' && !form.scopeKey.trim()) {
      setErrorMsg('颜色和规格候选项必须指定所属类目')
      return
    }

    setSaving(true)
    setErrorMsg(null)
    setNoticeMsg(null)

    try {
      if (form.editingId) {
        await updateSkuSuggestionSetting(form.editingId, {
          value,
          scopeKey: form.attributeType === 'category' ? null : form.scopeKey,
        })
        setNoticeMsg('候选项已更新')
      } else {
        await createSkuSuggestionSetting({
          attributeType: form.attributeType,
          scopeKey: form.attributeType === 'category' ? null : form.scopeKey,
          value,
        })
        setNoticeMsg('候选项已新增')
      }

      resetForm()
      await loadRecords()
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : '保存设置失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(record: SkuSuggestionSettingRecord) {
    setSaving(true)
    setErrorMsg(null)
    setNoticeMsg(null)

    try {
      await updateSkuSuggestionSetting(record.suggestion_id, {
        isEnabled: !record.is_enabled,
      })
      setNoticeMsg(record.is_enabled ? '候选项已停用' : '候选项已启用')
      await loadRecords()
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : '更新状态失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div className="pageHeaderLeft">
          <h2 className="pageTitle">设置中心</h2>
          <p className="pageSub">先治理 SKU 候选项。类目做全局候选，颜色和规格按类目作用域管理。</p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 700, color: 'var(--text-h)' }}>候选项维护</div>
        <p style={{ margin: '6px 0 0', fontSize: 13, opacity: 0.76 }}>
          手工新增或修正类目、颜色、规格候选项。颜色和规格必须绑定类目。
        </p>

        <div
          style={{
            marginTop: 12,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 10,
          }}
        >
          <label style={{ display: 'block' }}>
            <div className="fieldLabel">属性类型</div>
            <select
              className="control"
              value={form.attributeType}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  attributeType: event.target.value as SkuSuggestionSettingAttribute,
                  scopeKey:
                    event.target.value === 'category' ? '' : current.scopeKey,
                }))
              }
            >
              <option value="category">类目</option>
              <option value="color">颜色</option>
              <option value="variant">规格</option>
            </select>
          </label>
          <label style={{ display: 'block' }}>
            <div className="fieldLabel">所属类目</div>
            <input
              className="control"
              value={form.scopeKey}
              disabled={form.attributeType === 'category'}
              onChange={(event) => setForm((current) => ({ ...current, scopeKey: event.target.value }))}
              placeholder={form.attributeType === 'category' ? '类目候选项不需要作用域' : '例如：上衣'}
            />
          </label>
          <label style={{ display: 'block' }}>
            <div className="fieldLabel">候选项值</div>
            <input
              className="control"
              value={form.value}
              onChange={(event) => setForm((current) => ({ ...current, value: event.target.value }))}
              placeholder="例如：米白 / L / 裤装"
            />
          </label>
        </div>

        <div className="btnRow">
          <button className="primaryBtn" type="button" disabled={saving} onClick={handleSave}>
            {form.editingId ? '保存候选项' : '新增候选项'}
          </button>
          {form.editingId ? (
            <button className="ghostBtn" type="button" disabled={saving} onClick={resetForm}>
              取消编辑
            </button>
          ) : null}
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 700, color: 'var(--text-h)' }}>筛选与总览</div>
        <div
          style={{
            marginTop: 12,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 10,
          }}
        >
          <label style={{ display: 'block' }}>
            <div className="fieldLabel">属性类型</div>
            <select
              className="control"
              value={filters.attribute}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  attribute: event.target.value as FilterState['attribute'],
                  scopeKey: event.target.value === 'category' || event.target.value === 'all' ? '' : current.scopeKey,
                }))
              }
            >
              <option value="all">全部</option>
              <option value="category">类目</option>
              <option value="color">颜色</option>
              <option value="variant">规格</option>
            </select>
          </label>
          <label style={{ display: 'block' }}>
            <div className="fieldLabel">所属类目</div>
            <input
              className="control"
              value={filters.scopeKey}
              onChange={(event) => setFilters((current) => ({ ...current, scopeKey: event.target.value }))}
              placeholder="颜色/规格可按类目筛选"
            />
          </label>
          <label style={{ display: 'block' }}>
            <div className="fieldLabel">搜索</div>
            <input
              className="control"
              value={filters.query}
              onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
              placeholder="按候选项内容搜索"
            />
          </label>
          <label style={{ display: 'block' }}>
            <div className="fieldLabel">状态</div>
            <select
              className="control"
              value={filters.includeDisabled ? 'all' : 'enabled'}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  includeDisabled: event.target.value === 'all',
                }))
              }
            >
              <option value="enabled">仅启用</option>
              <option value="all">包含停用</option>
            </select>
          </label>
        </div>

        <div className="btnRow">
          <button className="ghostBtn" type="button" disabled={loading} onClick={() => void loadRecords()}>
            刷新列表
          </button>
          <button
            className="ghostBtn"
            type="button"
            disabled={loading}
            onClick={() => {
              setFilters(emptyFilters)
              void loadRecords(emptyFilters)
            }}
          >
            重置筛选
          </button>
        </div>
      </div>

      {errorMsg ? (
        <div
          style={{
            marginTop: 12,
            padding: '10px 12px',
            borderRadius: 12,
            border: '1px solid rgba(185, 28, 28, 0.25)',
            color: '#b91c1c',
            background: 'rgba(255, 0, 0, 0.05)',
            fontSize: 13,
          }}
        >
          {errorMsg}
        </div>
      ) : null}

      {noticeMsg ? (
        <div
          style={{
            marginTop: 12,
            padding: '10px 12px',
            borderRadius: 12,
            border: '1px solid rgba(21, 128, 61, 0.2)',
            color: '#15803d',
            background: 'rgba(21, 128, 61, 0.06)',
            fontSize: 13,
          }}
        >
          {noticeMsg}
        </div>
      ) : null}

      <div style={{ marginTop: 14 }} className="tableWrap">
        <table className="dataTable">
          <thead>
            <tr>
              <th>属性</th>
              <th>所属类目</th>
              <th>值</th>
              <th className="right">使用次数</th>
              <th>来源</th>
              <th>状态</th>
              <th className="right">更新时间</th>
              <th className="right">操作</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.suggestion_id}>
                <td>{attributeLabel(record.attribute_type)}</td>
                <td className="wrap">{record.scope_key ?? '-'}</td>
                <td className="wrap">{record.value}</td>
                <td className="right">{record.usage_count}</td>
                <td>{record.source}</td>
                <td>{record.is_enabled ? '启用' : '停用'}</td>
                <td className="right">{new Date(record.updated_at).toLocaleString()}</td>
                <td className="right">
                  <button className="ghostBtn" type="button" disabled={saving} onClick={() => startEdit(record)}>
                    编辑
                  </button>{' '}
                  <button
                    className="ghostBtn"
                    type="button"
                    disabled={saving}
                    onClick={() => void handleToggle(record)}
                  >
                    {record.is_enabled ? '停用' : '启用'}
                  </button>
                </td>
              </tr>
            ))}
            {!loading && records.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: 14, opacity: 0.8 }}>
                  暂无候选项
                </td>
              </tr>
            ) : null}
            {loading ? (
              <tr>
                <td colSpan={8} style={{ padding: 14, opacity: 0.8 }}>
                  加载中...
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
