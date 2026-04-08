export type SkuStatus = 'active' | 'inactive'

export type StructuredSku = {
  sku_id: string
  sku_code: string | null
  name: string
  category_name: string | null
  color_name: string | null
  variant_name: string | null
  unit_price: number
  inventory_quantity: number
  status: SkuStatus
  created_at: string
  primary_image_thumb_url?: string | null
}

export type SkuFormState = {
  skuCode: string
  name: string
  categoryName: string
  colorName: string
  variantName: string
  unitPrice: string
  inventoryQuantity: string
  status: SkuStatus
}

function normalizeOptionalText(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized ? normalized : null
}

function toFiniteNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function createEmptySkuForm(): SkuFormState {
  return {
    skuCode: '',
    name: '',
    categoryName: '',
    colorName: '',
    variantName: '',
    unitPrice: '0',
    inventoryQuantity: '0',
    status: 'active',
  }
}

export function createSkuFormFromSku(sku: StructuredSku): SkuFormState {
  return {
    skuCode: sku.sku_code ?? '',
    name: sku.name,
    categoryName: sku.category_name ?? '',
    colorName: sku.color_name ?? '',
    variantName: sku.variant_name ?? '',
    unitPrice: String(toFiniteNumber(sku.unit_price, 0)),
    inventoryQuantity: String(toFiniteNumber(sku.inventory_quantity, 0)),
    status: sku.status ?? 'active',
  }
}

export function buildSkuPayload(form: SkuFormState) {
  const unitPrice = toFiniteNumber(form.unitPrice, NaN)
  const inventoryQuantity = toFiniteNumber(form.inventoryQuantity, NaN)

  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new Error('单价必须是非负数字')
  }

  if (!Number.isInteger(inventoryQuantity) || inventoryQuantity < 0) {
    throw new Error('库存必须是非负整数')
  }

  return {
    sku_code: normalizeOptionalText(form.skuCode),
    name: String(form.name ?? '').trim(),
    category_name: normalizeOptionalText(form.categoryName),
    color_name: normalizeOptionalText(form.colorName),
    variant_name: normalizeOptionalText(form.variantName),
    unit_price: unitPrice,
    inventory_quantity: inventoryQuantity,
    status: form.status,
  }
}

export function matchesSkuQuery(sku: StructuredSku, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) {
    return true
  }

  return [sku.sku_code, sku.name, sku.category_name, sku.color_name, sku.variant_name]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .some((value) => value.toLowerCase().includes(q))
}
