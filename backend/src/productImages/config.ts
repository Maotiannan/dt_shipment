export type ProductImageConfig = {
  rootDir: string
  tmpDir: string
  maxFiles: number
  maxFileBytes: number
  allowedMimeTypes: string[]
  thumbWidth: number
  trashRetentionDays: number
}

export function loadProductImageConfig(
  env: NodeJS.ProcessEnv = process.env
): ProductImageConfig {
  const maxFileMb = Number(env.PRODUCT_IMAGE_MAX_FILE_MB ?? 10)

  return {
    rootDir: env.PRODUCT_IMAGE_ROOT ?? '/data/assets/products',
    tmpDir: env.PRODUCT_IMAGE_TMP_DIR ?? '/data/assets/uploads/tmp',
    maxFiles: Number(env.PRODUCT_IMAGE_MAX_FILES ?? 12),
    maxFileBytes: maxFileMb * 1024 * 1024,
    allowedMimeTypes: (env.PRODUCT_IMAGE_ALLOWED_MIME ?? 'image/jpeg,image/png,image/webp')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    thumbWidth: Number(env.PRODUCT_IMAGE_THUMB_WIDTH ?? 480),
    trashRetentionDays: Number(env.PRODUCT_IMAGE_TRASH_RETENTION_DAYS ?? 30),
  }
}
