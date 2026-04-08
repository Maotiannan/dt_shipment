import type { ReactNode } from 'react'

import { summarizeImportPreview, type ImportPreviewRow } from '../lib/importPreview'

type Props<T> = {
  rows: Array<ImportPreviewRow<T>>
  onRemove: (key: string) => void
  renderEditor: (row: ImportPreviewRow<T>) => ReactNode
}

function statusText(status: ImportPreviewRow<unknown>['status']) {
  if (status === 'error') return '错误'
  if (status === 'warning') return '警告'
  return '通过'
}

export default function ImportPreviewTable<T>({ rows, onRemove, renderEditor }: Props<T>) {
  const summary = summarizeImportPreview(rows)

  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <div className="statCard">
          <div className="statLabel">总行数</div>
          <div className="statValue">{summary.totalCount}</div>
        </div>
        <div className="statCard">
          <div className="statLabel">覆盖项</div>
          <div className="statValue">{summary.overwriteCount}</div>
        </div>
        <div className="statCard">
          <div className="statLabel">错误</div>
          <div className="statValue">{summary.errorCount}</div>
        </div>
        <div className="statCard">
          <div className="statLabel">警告</div>
          <div className="statValue">{summary.warningCount}</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.map((row) => (
          <div
            key={row.key}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 16,
              padding: 12,
              background:
                row.status === 'error'
                  ? 'rgba(239,68,68,0.04)'
                  : row.status === 'warning'
                    ? 'rgba(245,158,11,0.05)'
                    : 'rgba(255,255,255,0.65)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 700, color: 'var(--text-h)' }}>
                  第 {row.row_index} 行 · {row.key || '未命名'}
                </div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  {statusText(row.status)} / {row.action === 'overwrite' ? '覆盖' : '新增'}
                </div>
              </div>
              <button className="ghostBtn" onClick={() => onRemove(row.key)}>
                移除
              </button>
            </div>

            {row.errors.length ? (
              <div style={{ marginTop: 8, color: '#b91c1c', fontSize: 13, whiteSpace: 'pre-wrap' }}>
                {row.errors.join('\n')}
              </div>
            ) : null}

            {row.warnings.length ? (
              <div style={{ marginTop: 8, color: '#b45309', fontSize: 13, whiteSpace: 'pre-wrap' }}>
                {row.warnings.join('\n')}
              </div>
            ) : null}

            <div style={{ marginTop: 10 }}>{renderEditor(row)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
