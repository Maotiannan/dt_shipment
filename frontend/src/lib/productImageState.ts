export type ProductImageStateItem = {
  image_id: string
  sort_order: number
  is_primary: boolean
  status: string
  deleted_at: string | null
}

function compareBySortOrder(left: ProductImageStateItem, right: ProductImageStateItem) {
  if (left.sort_order !== right.sort_order) {
    return left.sort_order - right.sort_order
  }

  return left.image_id.localeCompare(right.image_id)
}

function resequence<T extends ProductImageStateItem>(items: T[]) {
  return items.map((item, index) => ({
    ...item,
    sort_order: index + 1,
  })) as T[]
}

function normalizeWithPrimary<T extends ProductImageStateItem>(
  items: T[],
  primaryImageId: string | null
) {
  const sorted = [...items].sort(compareBySortOrder)
  const safePrimaryId =
    primaryImageId ?? sorted.find((item) => item.is_primary)?.image_id ?? sorted[0]?.image_id ?? null

  return resequence(
    sorted.map((item) => ({
      ...item,
      is_primary: safePrimaryId === item.image_id,
    }))
  )
}

export function normalizeProductImageState<T extends ProductImageStateItem>(items: T[]) {
  return normalizeWithPrimary(items, null)
}

export function moveProductImage<T extends ProductImageStateItem>(
  items: T[],
  imageId: string,
  delta: -1 | 1
) {
  const normalized = normalizeProductImageState(items)
  const primaryId = normalized.find((item) => item.is_primary)?.image_id ?? null
  const next = [...normalized]
  const index = next.findIndex((item) => item.image_id === imageId)
  const targetIndex = index + delta

  if (index < 0 || targetIndex < 0 || targetIndex >= next.length) {
    return next
  }

  const [moved] = next.splice(index, 1)
  next.splice(targetIndex, 0, moved)
  return normalizeWithPrimary(resequence(next), primaryId)
}

export function setPrimaryProductImage<T extends ProductImageStateItem>(items: T[], imageId: string) {
  return normalizeWithPrimary(items, imageId)
}

export function removeProductImage<T extends ProductImageStateItem>(items: T[], imageId: string) {
  const normalized = normalizeProductImageState(items)
  const remaining = normalized.filter((item) => item.image_id !== imageId)

  if (!remaining.length) {
    return remaining
  }

  const currentPrimaryId = normalized.find((item) => item.is_primary)?.image_id ?? null
  const nextPrimaryId =
    currentPrimaryId && currentPrimaryId !== imageId
      ? currentPrimaryId
      : remaining[0]?.image_id ?? null

  return normalizeWithPrimary(remaining, nextPrimaryId)
}
