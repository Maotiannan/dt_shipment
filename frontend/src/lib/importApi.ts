import { apiRequest } from './apiClient'
import type { ImportPreviewResult } from './importPreview'

export type SkuImportDraft = {
  sku_code: string
  name: string
  category_name: string
  color_name: string
  variant_name: string
  unit_price: number | string
  inventory_quantity: number | string
  status: string
}

export type OrderImportDraft = {
  order_id: string
  order_type: string
  account_name: string
  buyer_name: string
  shipping_address: string
  sku_code: string
  sku_name: string
  qty: number | string
  unit_price: number | string
  is_abnormal: string | boolean
  abnormal_type?: string
  abnormal_remark?: string
}

export type SkuImportPreviewData = {
  sku_code: string
  name: string
  category_name: string | null
  color_name: string | null
  variant_name: string | null
  unit_price: number
  inventory_quantity: number
  status: 'active' | 'inactive'
}

export type OrderImportPreviewData = {
  order_id: string
  account_id: string | null
  account_name: string
  order_type: 'wholesale' | 'retail'
  buyer_name: string
  shipping_address: string
  sku_code: string | null
  sku_name: string
  qty: number
  unit_price: number
  items: Array<{
    sku_id: string | null
    inventory_id: null
    name: string
    qty: number
    unit_price: number
  }>
  total_amount: number
  ship_status: 'pending'
  tracking_number: null
  delivery_channel: null
  tracking_method: null
  is_abnormal: boolean
  abnormal_type: 'resend' | 'address_error' | 'reject' | 'other' | null
  remark: string | null
  settlement_status: 'unpaid' | null
  paid_amount: number
  paid_at: null
  paid_remark: null
  shipped_at: null
}

export async function previewSkuImport(rows: SkuImportDraft[]) {
  return apiRequest<ImportPreviewResult<SkuImportPreviewData>>('/api/skus/import/preview', {
    method: 'POST',
    body: JSON.stringify({ rows }),
  })
}

export async function commitSkuImport(rows: Array<SkuImportPreviewData>) {
  return apiRequest<{ ok: boolean; created_count: number; overwritten_count: number }>(
    '/api/skus/import/commit',
    {
      method: 'POST',
      body: JSON.stringify({ rows }),
    }
  )
}

export async function previewOrderImport(rows: OrderImportDraft[]) {
  return apiRequest<ImportPreviewResult<OrderImportPreviewData>>('/api/orders/import/preview', {
    method: 'POST',
    body: JSON.stringify({ rows }),
  })
}

export async function commitOrderImport(rows: Array<OrderImportPreviewData>) {
  return apiRequest<{ ok: boolean; created_count: number; overwritten_count: number }>(
    '/api/orders/import/commit',
    {
      method: 'POST',
      body: JSON.stringify({ rows }),
    }
  )
}
