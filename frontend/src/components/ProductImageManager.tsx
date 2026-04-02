import { useEffect, useMemo, useRef, useState } from 'react'

import {
  deleteProductSkuImage,
  fetchProtectedImageObjectUrl,
  loadProductSkuDetail,
  reorderProductSkuImages,
  setProductSkuPrimaryImage,
  uploadProductSkuImages,
  type ProductImageSummary,
} from '../lib/productImagesApi'
import { getPrimaryProductImage, moveProductImage } from '../lib/productImageState'

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function ProtectedImage({
  srcPath,
  alt,
  className,
}: {
  srcPath: string
  alt: string
  className?: string
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    let urlToRevoke: string | null = null

    setObjectUrl(null)
    setError(null)

    ;(async () => {
      try {
        const nextUrl = await fetchProtectedImageObjectUrl(srcPath)
        if (!alive) {
          URL.revokeObjectURL(nextUrl)
          return
        }
        urlToRevoke = nextUrl
        setObjectUrl(nextUrl)
      } catch (err) {
        if (!alive) return
        setError(err instanceof Error ? err.message : '图片加载失败')
      }
    })()

    return () => {
      alive = false
      if (urlToRevoke) {
        URL.revokeObjectURL(urlToRevoke)
      }
    }
  }, [srcPath])

  if (error) {
    return <div className="productImagePlaceholder">图片加载失败</div>
  }

  if (!objectUrl) {
    return <div className="productImagePlaceholder">加载中...</div>
  }

  return <img src={objectUrl} alt={alt} className={className} />
}

export default function ProductImageManager({
  skuId,
  skuName,
  onImagesChange,
}: {
  skuId: string | null
  skuName?: string
  onImagesChange?: (images: ProductImageSummary[]) => void
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [images, setImages] = useState<ProductImageSummary[]>([])
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [previewImageId, setPreviewImageId] = useState<string | null>(null)

  const primaryImage = useMemo(
    () => getPrimaryProductImage(images),
    [images]
  )
  const previewImage = useMemo(
    () => images.find((image) => image.image_id === previewImageId) ?? null,
    [images, previewImageId]
  )

  function applyImages(nextImages: ProductImageSummary[]) {
    setImages(nextImages)
    onImagesChange?.(nextImages)
  }

  useEffect(() => {
    if (!skuId) {
      setImages([])
      setLoading(false)
      setErrorMsg(null)
      setPreviewImageId(null)
      return
    }

    let alive = true
    setLoading(true)
    setErrorMsg(null)
    setPreviewImageId(null)

    ;(async () => {
      try {
        const detail = await loadProductSkuDetail(skuId)
        if (!alive) return
        applyImages(detail.images)
      } catch (err) {
        if (!alive) return
        setErrorMsg(err instanceof Error ? err.message : '加载商品图片失败')
        setImages([])
      } finally {
        if (alive) {
          setLoading(false)
        }
      }
    })()

    return () => {
      alive = false
    }
  }, [skuId])

  async function refreshDetail() {
    if (!skuId) return
    const detail = await loadProductSkuDetail(skuId)
    applyImages(detail.images)
  }

  async function handleUpload(fileList: FileList | null) {
    if (!skuId || !fileList || fileList.length === 0) return

    setBusyAction('upload')
    setErrorMsg(null)
    try {
      const detail = await uploadProductSkuImages(skuId, fileList)
      applyImages(detail.images)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '上传图片失败')
    } finally {
      setBusyAction(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  async function handleMove(imageId: string, delta: -1 | 1) {
    if (!skuId) return

    const nextImages = moveProductImage(images, imageId, delta)
    if (nextImages.length === 0) return

    setBusyAction(`${delta > 0 ? 'down' : 'up'}:${imageId}`)
    setErrorMsg(null)
    try {
      const nextImagesFromServer = await reorderProductSkuImages(
        skuId,
        nextImages.map((item) => item.image_id)
      )
      applyImages(nextImagesFromServer)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '调整顺序失败')
      await refreshDetail().catch(() => undefined)
    } finally {
      setBusyAction(null)
    }
  }

  async function handleSetPrimary(imageId: string) {
    if (!skuId) return

    setBusyAction(`primary:${imageId}`)
    setErrorMsg(null)
    try {
      const nextImagesFromServer = await setProductSkuPrimaryImage(skuId, imageId)
      applyImages(nextImagesFromServer)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '设为主图失败')
      await refreshDetail().catch(() => undefined)
    } finally {
      setBusyAction(null)
    }
  }

  async function handleDelete(imageId: string) {
    if (!skuId) return

    const ok = window.confirm('确定删除这张图片吗？删除后会移入回收区。')
    if (!ok) return

    setBusyAction(`delete:${imageId}`)
    setErrorMsg(null)
    try {
      const detail = await deleteProductSkuImage(skuId, imageId)
      applyImages(detail.images)
      if (previewImageId === imageId) {
        setPreviewImageId(null)
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '删除图片失败')
      await refreshDetail().catch(() => undefined)
    } finally {
      setBusyAction(null)
    }
  }

  if (!skuId) return null

  return (
    <section className="productImageManager">
      <div className="productImageManagerHeader">
        <div className="productImageManagerHeaderText">
          <h4>商品多图</h4>
          <p>上传后第一张默认主图，支持设主图、上移/下移、删除和预览。</p>
        </div>
        <div className="productImageManagerHeaderActions">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => void handleUpload(e.target.files)}
          />
          <button
            type="button"
            className="ghostBtn"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading || busyAction !== null}
          >
            上传图片
          </button>
        </div>
      </div>

      <div className="productImageManagerMeta">
        <span>SKU：{skuName ?? skuId}</span>
        <span>图片数：{images.length}</span>
        <span>主图：{primaryImage ? `#${primaryImage.sort_order}` : '无'}</span>
      </div>

      {loading ? <div className="productImageManagerState">图片加载中...</div> : null}
      {errorMsg ? <div className="productImageManagerError">{errorMsg}</div> : null}

      {previewImage ? (
        <div className="productImagePreviewPanel">
          <div className="productImagePreviewHeader">
            <div>
              <div className="productImagePreviewTitle">图片预览</div>
              <div className="productImagePreviewSub">
                {previewImage.is_primary ? '主图' : `排序 ${previewImage.sort_order}`} ·
                {formatFileSize(previewImage.file_size)}
              </div>
            </div>
            <button
              type="button"
              className="ghostBtn ghostBtn-small"
              onClick={() => setPreviewImageId(null)}
            >
              关闭
            </button>
          </div>
          <ProtectedImage
            srcPath={previewImage.original_url}
            alt={previewImage.image_id}
            className="productImagePreviewMedia"
          />
        </div>
      ) : null}

      {images.length ? (
        <div className="productImageGrid">
          {images.map((image, index) => {
            const canMoveUp = index > 0 && busyAction === null
            const canMoveDown = index < images.length - 1 && busyAction === null
            const busy = busyAction !== null

            return (
              <article key={image.image_id} className="productImageCard">
                <button
                  type="button"
                  className="productImageThumbButton"
                  onClick={() => setPreviewImageId(image.image_id)}
                >
                  <ProtectedImage
                    srcPath={image.thumb_url}
                    alt={image.image_id}
                    className="productImageThumb"
                  />
                </button>

                <div className="productImageCardBody">
                  <div className="productImageCardTopRow">
                    <div>
                      <div className="productImageCardTitle">
                        {image.is_primary ? '主图' : `图片 ${index + 1}`}
                      </div>
                      <div className="productImageCardSub">
                        {formatFileSize(image.file_size)} · {image.width} × {image.height}
                      </div>
                    </div>
                    {image.is_primary ? <span className="productImageBadge">PRIMARY</span> : null}
                  </div>

                  <div className="productImageCardActions">
                    <button
                      type="button"
                      className="ghostBtn ghostBtn-small"
                      onClick={() => void handleSetPrimary(image.image_id)}
                      disabled={busy || image.is_primary}
                    >
                      设主图
                    </button>
                    <button
                      type="button"
                      className="ghostBtn ghostBtn-small"
                      onClick={() => void handleMove(image.image_id, -1)}
                      disabled={!canMoveUp}
                    >
                      上移
                    </button>
                    <button
                      type="button"
                      className="ghostBtn ghostBtn-small"
                      onClick={() => void handleMove(image.image_id, 1)}
                      disabled={!canMoveDown}
                    >
                      下移
                    </button>
                    <button
                      type="button"
                      className="ghostBtn ghostBtn-small"
                      onClick={() => void handleDelete(image.image_id)}
                      disabled={busy}
                    >
                      删除
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="productImageManagerEmpty">暂无图片，先上传第一张主图。</div>
      )}
    </section>
  )
}
