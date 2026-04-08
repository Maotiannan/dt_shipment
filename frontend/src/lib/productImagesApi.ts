import { getToken } from './apiClient'
import { resolveApiBase } from './runtimeConfig'
import { normalizeProductImageState, type ProductImageStateItem } from './productImageState'

const API_BASE = resolveApiBase(import.meta.env.VITE_API_BASE as string | undefined)

export type ProductImageSummary = ProductImageStateItem & {
  mime_type: string
  file_size: number
  width: number
  height: number
  thumb_url: string
  original_url: string
}

export type ProductSkuDetail = {
  sku_id: string
  sku_code: string | null
  name: string
  spec: string | null
  unit_price: number
  category: string | null
  category_name: string | null
  color_name: string | null
  variant_name: string | null
  status: string
  created_at: string
  inventory_id?: string | null
  inventory_quantity?: number | null
  primary_image_thumb_url?: string | null
  images: ProductImageSummary[]
}

type ProductSkuDetailResponse = Omit<ProductSkuDetail, 'images'> & {
  images?: Array<
    Omit<ProductImageSummary, 'status' | 'deleted_at'> & {
      status?: string
      deleted_at?: string | null
    }
  >
}

type ProductImagesResponse = {
  images?: ProductSkuDetailResponse['images']
}

function buildUrl(path: string) {
  return `${API_BASE}${path}`
}

function buildHeaders(initHeaders?: HeadersInit, includeContentType = true) {
  const headers = new Headers(initHeaders ?? {})
  if (includeContentType) {
    headers.set('Content-Type', 'application/json')
  }

  const token = getToken()
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  return headers
}

async function readErrorMessage(resp: Response) {
  let msg = `HTTP ${resp.status}`
  try {
    const payload = (await resp.json()) as { error?: string }
    if (payload?.error) {
      msg = payload.error
    }
  } catch {
    // ignore body parse failures
  }
  return msg
}

async function authenticatedFetch(path: string, init: RequestInit = {}) {
  const resp = await fetch(buildUrl(path), {
    ...init,
    headers: buildHeaders(init.headers, init.body instanceof FormData ? false : true),
  })

  if (!resp.ok) {
    throw new Error(await readErrorMessage(resp))
  }

  return resp
}

async function authenticatedJson<T>(path: string, init: RequestInit = {}) {
  const resp = await authenticatedFetch(path, init)
  return (await resp.json()) as T
}

function normalizeDetailImage(
  image: Omit<ProductImageSummary, 'status' | 'deleted_at'> & {
    status?: string
    deleted_at?: string | null
  }
): ProductImageSummary {
  return {
    ...image,
    status: image.status ?? 'active',
    deleted_at: image.deleted_at ?? null,
  }
}

function normalizeProductImages(
  images: ProductSkuDetailResponse['images'] | undefined
): ProductImageSummary[] {
  return normalizeProductImageState((images ?? []).map((image) => normalizeDetailImage(image)))
}

export async function loadProductSkuDetail(skuId: string): Promise<ProductSkuDetail> {
  const data = await authenticatedJson<ProductSkuDetailResponse>(`/api/skus/${skuId}`)
  const images = normalizeProductImages(data.images)

  return {
    ...data,
    images,
  }
}

export async function uploadProductSkuImages(skuId: string, files: File[] | FileList) {
  const formData = new FormData()
  Array.from(files).forEach((file) => {
    formData.append('files', file)
  })

  await authenticatedFetch(`/api/skus/${skuId}/images`, {
    method: 'POST',
    body: formData,
  })

  return loadProductSkuDetail(skuId)
}

export async function setProductSkuPrimaryImage(skuId: string, imageId: string) {
  const data = await authenticatedJson<ProductImagesResponse>(
    `/api/skus/${skuId}/images/${imageId}/primary`,
    {
      method: 'PATCH',
    }
  )

  return normalizeProductImages(data.images)
}

export async function reorderProductSkuImages(skuId: string, imageIds: string[]) {
  const data = await authenticatedJson<ProductImagesResponse>(`/api/skus/${skuId}/images/reorder`, {
    method: 'PATCH',
    body: JSON.stringify({ imageIds }),
  })

  return normalizeProductImages(data.images)
}

export async function deleteProductSkuImage(skuId: string, imageId: string) {
  await authenticatedFetch(`/api/skus/${skuId}/images/${imageId}`, {
    method: 'DELETE',
  })

  return loadProductSkuDetail(skuId)
}

export async function fetchProtectedImageObjectUrl(path: string) {
  const resp = await authenticatedFetch(path, {
    method: 'GET',
  })

  const blob = await resp.blob()
  return URL.createObjectURL(blob)
}
