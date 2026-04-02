import fs from 'node:fs/promises'
import multer from 'multer'
import { Router } from 'express'

import { requireAuth } from '../auth.js'
import { loadProductImageConfig } from './config.js'
import {
  cleanupDeletedProductImages,
  ProductImageServiceError,
  markProductImagePrimary,
  readProductImageBinary,
  reorderProductImages,
  softDeleteProductImage,
  uploadProductImages,
} from './service.js'

function sendProductImageError(
  res: {
    status(code: number): { json(payload: unknown): unknown }
  },
  error: unknown
) {
  if (error instanceof ProductImageServiceError) {
    return res.status(error.statusCode).json({ error: error.message })
  }

  return res.status(500).json({ error: (error as Error).message })
}

export function createProductImageRouter(env: NodeJS.ProcessEnv = process.env) {
  const config = loadProductImageConfig(env)
  const upload = multer({
    storage: multer.diskStorage({
      destination: async (_req, _file, callback) => {
        try {
          await fs.mkdir(config.tmpDir, { recursive: true })
          callback(null, config.tmpDir)
        } catch (error) {
          callback(error as Error, config.tmpDir)
        }
      },
    }),
    limits: {
      files: config.maxFiles,
      fileSize: config.maxFileBytes,
    },
  })
  const router = Router()

  router.post(
    '/api/skus/:id/images',
    requireAuth,
    (req, res, next) => {
      upload.array('files', config.maxFiles)(req, res, (error) => {
        if (error) {
          if (error instanceof multer.MulterError) {
            return res.status(400).json({ error: error.message })
          }

          return sendProductImageError(res, error)
        }
        return next()
      })
    },
    async (req, res) => {
      try {
        const images = await uploadProductImages(
          {
            skuId: String(req.params.id),
            files: ((req.files ?? []) as Express.Multer.File[]),
          },
          env
        )

        return res.status(201).json({ images })
      } catch (error) {
        return sendProductImageError(res, error)
      }
    }
  )

  router.get('/api/product-images/:imageId/thumb', requireAuth, async (req, res) => {
    try {
      const file = await readProductImageBinary(String(req.params.imageId), 'thumb', env)
      return res.type(file.contentType).send(file.buffer)
    } catch (error) {
      return sendProductImageError(res, error)
    }
  })

  router.get('/api/product-images/:imageId/original', requireAuth, async (req, res) => {
    try {
      const file = await readProductImageBinary(String(req.params.imageId), 'original', env)
      return res.type(file.contentType).send(file.buffer)
    } catch (error) {
      return sendProductImageError(res, error)
    }
  })

  router.patch('/api/skus/:id/images/:imageId/primary', requireAuth, async (req, res) => {
    try {
      const result = await markProductImagePrimary(
        {
          skuId: String(req.params.id),
          imageId: String(req.params.imageId),
        },
        env
      )
      return res.json({ ok: true, ...result })
    } catch (error) {
      return sendProductImageError(res, error)
    }
  })

  router.patch('/api/skus/:id/images/reorder', requireAuth, async (req, res) => {
    try {
      const result = await reorderProductImages(
        {
          skuId: String(req.params.id),
          imageIds: Array.isArray(req.body?.imageIds) ? req.body.imageIds : [],
        },
        env
      )
      return res.json(result)
    } catch (error) {
      return sendProductImageError(res, error)
    }
  })

  router.delete('/api/skus/:id/images/:imageId', requireAuth, async (req, res) => {
    try {
      const result = await softDeleteProductImage(
        {
          skuId: String(req.params.id),
          imageId: String(req.params.imageId),
        },
        env
      )
      return res.json(result)
    } catch (error) {
      return sendProductImageError(res, error)
    }
  })

  router.post('/api/internal/jobs/cleanup-product-images', requireAuth, async (_req, res) => {
    try {
      const result = await cleanupDeletedProductImages({ env })
      return res.json({ ok: true, ...result })
    } catch (error) {
      return sendProductImageError(res, error)
    }
  })

  return router
}
