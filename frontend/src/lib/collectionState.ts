export function upsertItemById<T>(
  items: T[],
  nextItem: T,
  getId: (item: T) => string,
  compare?: (left: T, right: T) => number
) {
  const nextId = getId(nextItem)
  const filtered = items.filter((item) => getId(item) !== nextId)
  const nextItems = [nextItem, ...filtered]

  if (!compare) {
    return nextItems
  }

  return nextItems.sort(compare)
}

export function removeItemById<T>(
  items: T[],
  itemId: string,
  getId: (item: T) => string
) {
  return items.filter((item) => getId(item) !== itemId)
}
