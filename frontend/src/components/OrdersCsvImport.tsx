import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { apiRequest } from '../lib/apiClient'

type OrderType = 'wholesale' | 'retail'
type AbnormalType = 'resend' | 'address_error' | 'reject' | 'other'

const headerMap: Record<string, string> = {
  订单号: 'order_id',
  订单类型: 'order_type',
  账号名称: 'account_name',
  买家昵称: 'buyer_name',
  收货地址: 'shipping_address',
  SKU名称: 'sku_name',
  数量: 'qty',
  单价: 'unit_price',
  是否异常: 'is_abnormal',
  异常类型: 'abnormal_type',
  异常备注: 'abnormal_remark',
}

const templateHeadersZh = Object.keys(headerMap)

function parseBool(v: unknown) {
  const s = String(v ?? '').trim().toLowerCase()
  return ['true', '1', 'yes', 'y', '是'].includes(s)
}

function parseNumber(v: unknown, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export default function OrdersCsvImport({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const templateCsv = useMemo(() => {
    const example = [
      '10001',
      'wholesale',
      '女装专号',
      '张三',
      '广东省广州市天河区xx路xx号',
      '连衣裙',
      '2',
      '59.90',
      'false',
      '',
      '',
    ]
    const lines = [templateHeadersZh.join(','), example.join(',')]
    return lines.join('\n')
  }, [])

  function downloadTemplate() {
    // Excel 兼容：加 UTF-8 BOM，避免中文乱码
    const blob = new Blob(['\ufeff', templateCsv], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '发货管家_订单CSV模板.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleFile(file: File) {
    setBusy(true)
    setErrorMsg(null)
    setSuccessMsg(null)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      if (!sheet) throw new Error('未找到可解析的表格')

      const json = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
        defval: '',
        raw: false,
      })

      if (!json.length) {
        setErrorMsg('CSV 中没有数据行')
        return
      }

      const required = [
        'order_id',
        'order_type',
        'account_name',
        'buyer_name',
        'shipping_address',
        'sku_name',
        'qty',
        'unit_price',
      ]
      const errors: string[] = []

      // Preload accounts mapping (idempotent: use owner_id + order_id upsert)
      const accountRows = await apiRequest<Array<{ account_id: string; account_name: string }>>(
        '/api/accounts'
      )
      const accountMap = new Map(
        (accountRows ?? []).map((a: any) => [String(a.account_name), String(a.account_id)])
      )

      const rowsToUpsert: any[] = []

      for (let idx = 0; idx < json.length; idx++) {
        const rawRow = json[idx]
        const r: Record<string, any> = {}
        for (const [k, v] of Object.entries(rawRow)) {
          const key = headerMap[k] ?? k
          r[key] = v
        }
        const rowNum = idx + 2 // header + row offset

        for (const k of required) {
          const v = r[k]
          if (String(v ?? '').trim() === '') {
            errors.push(`第 ${rowNum} 行：缺少字段 ${k}`)
            break
          }
        }
        if (errors.length) continue

        const orderId = String(r.order_id).trim()
        const orderType = String(r.order_type).trim() as OrderType
        if (!['wholesale', 'retail'].includes(orderType)) {
          errors.push(`第 ${rowNum} 行：order_type 必须是 wholesale/retail`)
          continue
        }

        const accountName = String(r.account_name).trim()
        const accountId = accountMap.get(accountName)
        if (!accountId) {
          errors.push(`第 ${rowNum} 行：account_name「${accountName}」未找到对应闲鱼账号`)
          continue
        }

        const qty = parseNumber(r.qty, NaN)
        const unitPrice = parseNumber(r.unit_price, NaN)
        if (!Number.isFinite(qty) || qty <= 0) {
          errors.push(`第 ${rowNum} 行：qty 必须是 > 0 的数字`)
          continue
        }
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
          errors.push(`第 ${rowNum} 行：unit_price 必须是 >= 0 的数字`)
          continue
        }

        const isAbnormal = parseBool(r.is_abnormal)
        const abnormalTypeStr = String(r.abnormal_type ?? '').trim()
        const abnormalRemark = String(r.abnormal_remark ?? '').trim()

        if (isAbnormal) {
          const allowed: AbnormalType[] = ['resend', 'address_error', 'reject', 'other']
          if (!allowed.includes(abnormalTypeStr as AbnormalType)) {
            errors.push(`第 ${rowNum} 行：abnormal_type 必须是 ${allowed.join('/')}`)
            continue
          }
          if (!abnormalRemark) {
            errors.push(`第 ${rowNum} 行：异常备注 abnormal_remark 为必填项`)
            continue
          }
        }

        const itemsPayload = [
          {
            sku_id: null,
            name: String(r.sku_name).trim(),
            qty,
            unit_price: unitPrice,
          },
        ]

        rowsToUpsert.push({
          order_id: orderId,
          account_id: accountId,
          order_type: orderType,
          buyer_name: String(r.buyer_name).trim(),
          shipping_address: String(r.shipping_address).trim(),
          items: itemsPayload,
          total_amount: qty * unitPrice,
          ship_status: 'pending',
          tracking_number: null,
          tracking_method: null,
          is_abnormal: isAbnormal,
          abnormal_type: isAbnormal ? (abnormalTypeStr as AbnormalType) : null,
          remark: isAbnormal ? abnormalRemark : null,
          settlement_status: orderType === 'wholesale' ? 'unpaid' : null,
          paid_amount: orderType === 'wholesale' ? 0 : 0,
        })
      }

      if (errors.length) {
        setErrorMsg(`导入校验失败：\n${errors.slice(0, 10).join('\n')}`)
        return
      }

      await apiRequest('/api/orders/bulkUpsert', {
        method: 'POST',
        body: JSON.stringify({ rows: rowsToUpsert }),
      })

      setSuccessMsg(`导入完成：成功 ${rowsToUpsert.length} 条（失败将体现在校验错误中）`)
      setOpen(false)
      onImported()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '导入失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        className="ghostBtn"
        onClick={() => {
          setOpen(true)
          setErrorMsg(null)
          setSuccessMsg(null)
        }}
        style={{ width: '100%' }}
      >
        CSV 导入（Phase2/3）
      </button>

      {open ? (
        <div className="modalOverlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}>CSV 导入订单</h3>
              <button className="ghostBtn" onClick={() => setOpen(false)} disabled={busy}>
                关闭
              </button>
            </div>

            <div style={{ marginTop: 12 }}>
              <button
                className="ghostBtn"
                onClick={downloadTemplate}
                disabled={busy}
                style={{ width: '100%' }}
              >
                下载导入模板（CSV）
              </button>
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>
                选择 CSV 文件
              </label>
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void handleFile(f)
                }}
              />
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
                  whiteSpace: 'pre-wrap',
                }}
              >
                {errorMsg}
              </div>
            ) : null}

            {successMsg ? (
              <div
                style={{
                  marginTop: 12,
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: '1px solid rgba(34,197,94,0.25)',
                  color: '#15803d',
                  background: 'rgba(34,197,94,0.05)',
                  fontSize: 13,
                }}
              >
                {successMsg}
              </div>
            ) : null}

            {busy ? (
              <div style={{ marginTop: 12, opacity: 0.8 }}>导入中...</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  )
}

