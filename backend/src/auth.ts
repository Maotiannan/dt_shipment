import jwt from 'jsonwebtoken'
import type { Request, Response, NextFunction } from 'express'
import dotenv from 'dotenv'

dotenv.config()

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret'

export type AuthPayload = {
  userId: number
  username: string
}

export function signToken(payload: AuthPayload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' })
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const token = header.replace('Bearer ', '').trim()
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthPayload
    ;(req as Request & { user: AuthPayload }).user = decoded
    return next()
  } catch {
    return res.status(401).json({ error: 'Invalid token' })
  }
}

