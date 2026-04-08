import { useMemo, useState } from 'react'

import {
  commitSkuImport,
  previewSkuImport,
  type SkuImportDraft,
  type SkuImportPreviewData,
} from '../lib/importApi'
import {
  canCommitImportPreview,
  removeImportPreviewRow,
  updateImportPreviewRow,
  type ImportPreviewRow,
} from '../lib/importPreview'
import { SKU_IMPORT_TEMPLATE, downloadImportTemplate } from '../lib/importTemplates'
import { mapSpreadsheetRows, parseSpreadsheetFile } from '../lib/importWorkbook'
import ImportPreviewTable from './ImportPreviewTable'

const skuHeaderMap: Record<string, string> = {
  SKU编码: 'sku_code',
  产品名称: 'name',
  类目: 'category_name',
  颜色: 'color_name',
  规格: 'variant_name',
  单价: 'unit_price',
  库存: 'inventory_quantity',
  状态: 'status',
}

type Props = {
  onImported: () => void
}

export default function SkusImportDialog({ onImported }: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [rows, setRows] = useState<Array<ImportPreviewRow<SkuImportPreviewData>>>([])

  const canCommit = useMemo(() => canCommitImportPreview(rows), [rows])

  function resetMessages() {
    setErrorMsg(null)
    setSuccessMsg(null)
  }

  function downloadTemplate() {
    downloadImportTemplate(SKU_IMPORT_TEMPLATE)
  }

  async function revalidate(nextRows: Array<SkuImportDraft | SkuImportPreviewData>) {
    const preview = await previewSkuImport(
      nextRows.map((row) => ({
        sku_code: row.sku_code,
        name: row.name,
        category_name: row.category_name ?? '',
        color_name: row.color_name ?? '',
        variant_name: row.variant_name ?? '',
        unit_price: row.unit_price,
        inventory_quantity: row.inventory_quantity,
        status: row.status,
      }))
    )
    setRows(preview.rows)
  }

  async function handleFile(file: File) {
    setBusy(true)
    resetMessages()

    try {
      const parsed = await parseSpreadsheetFile(file)
      const mapped = mapSpreadsheetRows(parsed, skuHeaderMap) as SkuImportDraft[]
      const preview = await previewSkuImport(mapped)
      setRows(preview.rows)
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'SKU 导入预检失败')
    } finally {
      setBusy(false)
    }
  }

  async function handleCommit() {
    setBusy(true)
    resetMessages()

    try {
      const payload = rows.map((row) => row.data)
      const result = await commitSkuImport(payload)
      setSuccessMsg(`导入完成：新增 ${result.created_count}，覆盖 ${result.overwritten_count}`)
      setRows([])
      onImported()
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'SKU 导入失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="ghostBtn" type="button" onClick={downloadTemplate}>
          下载 SKU 模板
        </button>
        <button
          className="ghostBtn"
          type="button"
          onClick={() => {
            setOpen(true)
            resetMessages()
          }}
        >
          批量导入 SKU
        </button>
      </div>

      {open ? (
        <div className="modalOverlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <h3 style={{ margin: 0 }}>批量导入 SKU</h3>
              <button className="ghostBtn" onClick={() => setOpen(false)} disabled={busy}>
                关闭
              </button>
            </div>

            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <label className="ghostBtn" style={{ textAlign: 'center' }}>
                选择文件
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  disabled={busy}
                  style={{ display: 'none' }}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) {
                      void handleFile(file)
                    }
                    event.currentTarget.value = ''
                  }}
                />
              </label>
            </div>

            {errorMsg ? (
              <div style={{ marginTop: 12, color: '#b91c1c', whiteSpace: 'pre-wrap' }}>{errorMsg}</div>
            ) : null}
            {successMsg ? (
              <div style={{ marginTop: 12, color: '#15803d', whiteSpace: 'pre-wrap' }}>{successMsg}</div>
            ) : null}

            {rows.length ? (
              <>
                <ImportPreviewTable
                  rows={rows}
                  onRemove={(key) => setRows((current) => removeImportPreviewRow(current, key))}
                  renderEditor={(row) => (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <input
                        className="control"
                        value={row.data.sku_code}
                        onChange={(event) =>
                          setRows((current) =>
                            updateImportPreviewRow(current, row.key, (target) => ({
                              ...target,
                              key: event.target.value || target.key,
                              data: { ...target.data, sku_code: event.target.value },
                            }))
                          )
                        }
                        placeholder="SKU编码"
                      />
                      <input
                        className="control"
                        value={row.data.name}
                        onChange={(event) =>
                          setRows((current) =>
                            updateImportPreviewRow(current, row.key, (target) => ({
                              ...target,
                              data: { ...target.data, name: event.target.value },
                            }))
                          )
                        }
                        placeholder="产品名称"
                      />
                      <input
                        className="control"
                        value={row.data.category_name ?? ''}
                        onChange={(event) =>
                          setRows((current) =>
                            updateImportPreviewRow(current, row.key, (target) => ({
                              ...target,
                              data: { ...target.data, category_name: event.target.value || null },
                            }))
                          )
                        }
                        placeholder="类目"
                      />
                      <input
                        className="control"
                        value={row.data.color_name ?? ''}
                        onChange={(event) =>
                          setRows((current) =>
                            updateImportPreviewRow(current, row.key, (target) => ({
                              ...target,
                              data: { ...target.data, color_name: event.target.value || null },
                            }))
                          )
                        }
                        placeholder="颜色"
                      />
                      <input
                        className="control"
                        value={row.data.variant_name ?? ''}
                        onChange={(event) =>
                          setRows((current) =>
                            updateImportPreviewRow(current, row.key, (target) => ({
                              ...target,
                              data: { ...target.data, variant_name: event.target.value || null },
                            }))
                          )
                        }
                        placeholder="规格"
                      />
                      <input
                        className="control"
                        inputMode="decimal"
                        value={String(row.data.unit_price)}
                        onChange={(event) =>
                          setRows((current) =>
                            updateImportPreviewRow(current, row.key, (target) => ({
                              ...target,
                              data: { ...target.data, unit_price: Number(event.target.value || 0) },
                            }))
                          )
                        }
                        placeholder="单价"
                      />
                      <input
                        className="control"
                        inputMode="numeric"
                        value={String(row.data.inventory_quantity)}
                        onChange={(event) =>
                          setRows((current) =>
                            updateImportPreviewRow(current, row.key, (target) => ({
                              ...target,
                              data: {
                                ...target.data,
                                inventory_quantity: Number(event.target.value || 0),
                              },
                            }))
                          )
                        }
                        placeholder="库存"
                      />
                      <select
                        className="control"
                        value={row.data.status}
                        onChange={(event) =>
                          setRows((current) =>
                            updateImportPreviewRow(current, row.key, (target) => ({
                              ...target,
                              data: {
                                ...target.data,
                                status: event.target.value === 'inactive' ? 'inactive' : 'active',
                              },
                            }))
                          )
                        }
                      >
                        <option value="active">active</option>
                        <option value="inactive">inactive</option>
                      </select>
                    </div>
                  )}
                />

                <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                  <button
                    className="ghostBtn"
                    disabled={busy}
                    onClick={() => void revalidate(rows.map((row) => row.data))}
                  >
                    重新校验
                  </button>
                  <button className="primaryBtn" disabled={busy || !canCommit || rows.length === 0} onClick={() => void handleCommit()}>
                    确认导入
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  )
}
