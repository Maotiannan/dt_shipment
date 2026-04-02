export type ProductImageConfig = {
  rootDir: string
  tmpDir: string
  maxFiles: number
  maxFileBytes: number
  allowedMimeTypes: string[]
  thumbWidth: number
  trashRetentionDays: number
}

function parseNonEmptyString(value: string | undefined, name: string, fallback: string) {
  const raw = value ?? fallback
  if (!raw.trim()) {
    throw new Error(`${name} must not be blank`)
  }
  return raw.trim()
}

function parsePositiveInteger(value: string | undefined, name: string, fallback: number) {
  const raw = value ?? String(fallback)
  const parsed = Number(raw)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got ${raw}`)
  }

  return parsed
}

export function loadProductImageConfig(
  env: NodeJS.ProcessEnv = process.env
): ProductImageConfig {
  const rootDir = parseNonEmptyString(
    env.PRODUCT_IMAGE_ROOT,
    'PRODUCT_IMAGE_ROOT',
    '/data/assets/products'
  )
  const tmpDir = parseNonEmptyString(
    env.PRODUCT_IMAGE_TMP_DIR,
    'PRODUCT_IMAGE_TMP_DIR',
    '/data/assets/uploads/tmp'
  )
  const maxFileMb = parsePositiveInteger(
    env.PRODUCT_IMAGE_MAX_FILE_MB,
    'PRODUCT_IMAGE_MAX_FILE_MB',
    10
  )
  const allowedMimeTypes = (env.PRODUCT_IMAGE_ALLOWED_MIME ?? 'image/jpeg,image/png,image/webp')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  if (allowedMimeTypes.length === 0) {
    throw new Error('PRODUCT_IMAGE_ALLOWED_MIME must include at least one mime type')
  }

  return {
    rootDir,
    tmpDir,
    maxFiles: parsePositiveInteger(
      env.PRODUCT_IMAGE_MAX_FILES,
      'PRODUCT_IMAGE_MAX_FILES',
      12
    ),
    maxFileBytes: maxFileMb * 1024 * 1024,
    allowedMimeTypes,
    thumbWidth: parsePositiveInteger(
      env.PRODUCT_IMAGE_THUMB_WIDTH,
      'PRODUCT_IMAGE_THUMB_WIDTH',
      480
    ),
    trashRetentionDays: parsePositiveInteger(
      env.PRODUCT_IMAGE_TRASH_RETENTION_DAYS,
      'PRODUCT_IMAGE_TRASH_RETENTION_DAYS',
      30
    ),
  }
}
