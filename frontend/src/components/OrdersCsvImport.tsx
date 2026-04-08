import { useMemo, useState } from 'react'

import {
  commitOrderImport,
  previewOrderImport,
  type OrderImportDraft,
  type OrderImportPreviewData,
} from '../lib/importApi'
import {
  canCommitImportPreview,
  removeImportPreviewRow,
  updateImportPreviewRow,
  type ImportPreviewRow,
} from '../lib/importPreview'
import { ORDER_IMPORT_TEMPLATE, downloadImportTemplate } from '../lib/importTemplates'
import { mapSpreadsheetRows, parseSpreadsheetFile } from '../lib/importWorkbook'
import ImportPreviewTable from './ImportPreviewTable'

const headerMap: Record<string, string> = {
  订单号: 'order_id',
  订单类型: 'order_type',
  账号名称: 'account_name',
  买家昵称: 'buyer_name',
  收货地址: 'shipping_address',
  SKU编码: 'sku_code',
  SKU名称: 'sku_name',
  数量: 'qty',
  单价: 'unit_price',
  是否异常: 'is_abnormal',
  异常类型: 'abnormal_type',
  异常备注: 'abnormal_remark',
}

export default function OrdersCsvImport({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [rows, setRows] = useState<Array<ImportPreviewRow<OrderImportPreviewData>>>([])

  const canCommit = useMemo(() => canCommitImportPreview(rows), [rows])

  function resetMessages() {
    setErrorMsg(null)
    setSuccessMsg(null)
  }

  function downloadTemplate() {
    downloadImportTemplate(ORDER_IMPORT_TEMPLATE)
  }

  async function revalidate(nextRows: OrderImportDraft[]) {
    const preview = await previewOrderImport(nextRows)
    setRows(preview.rows)
  }

  async function handleFile(file: File) {
    setBusy(true)
    resetMessages()

    try {
      const parsed = await parseSpreadsheetFile(file)
      const mapped = mapSpreadsheetRows(parsed, headerMap) as OrderImportDraft[]
      const preview = await previewOrderImport(mapped)
      setRows(preview.rows)
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : '订单导入预检失败')
    } finally {
      setBusy(false)
    }
  }

  async function handleCommit() {
    setBusy(true)
    resetMessages()

    try {
      const result = await commitOrderImport(rows.map((row) => row.data))
      setSuccessMsg(`导入完成：新增 ${result.created_count}，覆盖 ${result.overwritten_count}`)
      setRows([])
      onImported()
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : '订单导入失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="ghostBtn" type="button" onClick={downloadTemplate}>
          下载订单模板
        </button>
        <button
          className="ghostBtn"
          type="button"
          onClick={() => {
            setOpen(true)
            resetMessages()
          }}
        >
          导入订单（CSV / Excel）
        </button>
      </div>

      {open ? (
        <div className="modalOverlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <h3 style={{ margin: 0 }}>批量导入订单</h3>
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
                        value={row.data.order_id}
                        onChange={(event) =>
                          setRows((current) =>
                            updateImportPreviewRow(current, row.key, (target) => ({
                              ...target,
                              key: event.target.value || target.key,
                              data: { ...target.data, order_id: event.target.value },
                            }))
                          )
                        }
                        placeholder="订单号"
                      />
                      <select
                        className="control"
                        value={row.data.order_type}
                        onChange={(event) =>
                          setRows((current) =>
                            updateImportPreviewRow(current, row.key, (target) => ({
                              ...target,
                              data: {
                                ...target.data,
                                order_type:
                                  event.target.value === 'retail' ? 'retail' : 'wholesale',
                                settlement_status:
                                  event.target.value === 'retail' ? null : 'unpaid',
                              },
                            }))
                          )
                        }
                      >
                        <option value="wholesale">wholesale</option>
                        <option value="retail">retail</option>
                      </select>
                      <input
                        className="control"
                        value={row.data.account_name}
                        onChange={(event) =>
                          setRows((current) =>
                            updateImportPreviewRow(current, row.key, (target) => ({
                              ...target,
                              data: { ...target.data, account_name: event.target.value, account_id: null },
                            }))
                          )
                        }
                        placeholder="账号名称"
                      />
                      <input
                        className="control"
                        value={row.data.buyer_name}
                        onChange={(event) =>
                          setRows((current) =>
                            updateImportPreviewRow(current, row.key, (target) => ({
                              ...target,
                              data: { ...target.data, buyer_name: event.target.value },
                            }))
                          )
                        }
                        placeholder="买家昵称"
                      />
                      <input
                        className="control"
                        value={row.data.sku_code ?? ''}
                        onChange={(event) =>
                          setRows((current) =>
                            updateImportPreviewRow(current, row.key, (target) => ({
                              ...target,
                              data: { ...target.data, sku_code: event.target.value || null },
                            }))
                          )
                        }
                        placeholder="SKU编码"
                      />
                      <input
                        className="control"
                        value={row.data.sku_name}
                        onChange={(event) =>
                          setRows((current) =>
                            updateImportPreviewRow(current, row.key, (target) => ({
                              ...target,
                              data: {
                                ...target.data,
                                sku_name: event.target.value,
                                items: target.data.items.map((item) => ({
                                  ...item,
                                  name: event.target.value,
                                })),
                              },
                            }))
                          )
                        }
                        placeholder="SKU名称"
                      />
                      <input
                        className="control"
                        inputMode="numeric"
                        value={String(row.data.qty)}
                        onChange={(event) =>
                          setRows((current) =>
                            updateImportPreviewRow(current, row.key, (target) => ({
                              ...target,
                              data: {
                                ...target.data,
                                qty: Number(event.target.value || 0),
                                items: target.data.items.map((item) => ({
                                  ...item,
                                  qty: Number(event.target.value || 0),
                                })),
                              },
                            }))
                          )
                        }
                        placeholder="数量"
                      />
                      <input
                        className="control"
                        inputMode="decimal"
                        value={String(row.data.unit_price)}
                        onChange={(event) =>
                          setRows((current) =>
                            updateImportPreviewRow(current, row.key, (target) => ({
                              ...target,
                              data: {
                                ...target.data,
                                unit_price: Number(event.target.value || 0),
                                total_amount:
                                  Number(event.target.value || 0) * Number(target.data.qty || 0),
                                items: target.data.items.map((item) => ({
                                  ...item,
                                  unit_price: Number(event.target.value || 0),
                                })),
                              },
                            }))
                          )
                        }
                        placeholder="单价"
                      />
                      <textarea
                        className="control"
                        value={row.data.shipping_address}
                        onChange={(event) =>
                          setRows((current) =>
                            updateImportPreviewRow(current, row.key, (target) => ({
                              ...target,
                              data: { ...target.data, shipping_address: event.target.value },
                            }))
                          )
                        }
                        placeholder="收货地址"
                        rows={2}
                        style={{ gridColumn: '1 / -1' }}
                      />
                    </div>
                  )}
                />

                <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                  <button
                    className="ghostBtn"
                    disabled={busy}
                    onClick={() =>
                      void revalidate(
                        rows.map((row) => ({
                          order_id: row.data.order_id,
                          order_type: row.data.order_type,
                          account_name: row.data.account_name,
                          buyer_name: row.data.buyer_name,
                          shipping_address: row.data.shipping_address,
                          sku_code: row.data.sku_code ?? '',
                          sku_name: row.data.sku_name,
                          qty: row.data.qty,
                          unit_price: row.data.unit_price,
                          is_abnormal: row.data.is_abnormal,
                          abnormal_type: row.data.abnormal_type ?? '',
                          abnormal_remark: row.data.remark ?? '',
                        }))
                      )
                    }
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
