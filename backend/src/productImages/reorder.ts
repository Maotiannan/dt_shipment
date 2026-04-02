type ImageOrder = { image_id: string; sort_order: number; is_primary: boolean }

export function resequenceSortOrder(items: ImageOrder[]) {
  return [...items]
    .sort(
      (left, right) =>
        left.sort_order - right.sort_order || left.image_id.localeCompare(right.image_id)
    )
    .map((item, index) => ({ ...item, sort_order: index + 1 }))
}

export function moveImageByDelta(items: ImageOrder[], imageId: string, delta: -1 | 1) {
  const next = resequenceSortOrder(items)
  const index = next.findIndex((item) => item.image_id === imageId)
  const targetIndex = index + delta

  if (index < 0 || targetIndex < 0 || targetIndex >= next.length) {
    return next
  }

  const currentSortOrder = next[index].sort_order
  next[index] = { ...next[index], sort_order: next[targetIndex].sort_order }
  next[targetIndex] = { ...next[targetIndex], sort_order: currentSortOrder }
  return resequenceSortOrder(next)
}

export function nextPrimaryAfterDelete(items: ImageOrder[]) {
  return resequenceSortOrder(items)[0] ?? null
}
