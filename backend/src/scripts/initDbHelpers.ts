export const LEGACY_PRODUCT_IMAGE_INDEX_NAMES = new Set([
  'product_images_sku_sort_idx',
  'product_images_primary_idx',
])

export function needsLegacyProductImageRepair(indexNames: string[]) {
  return indexNames.some((name) => LEGACY_PRODUCT_IMAGE_INDEX_NAMES.has(name))
}

