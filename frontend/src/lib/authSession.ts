import { useEffect, useState } from 'react'
import { apiRequest, getToken } from './apiClient'

export function useAuthSession() {
  const [session, setSession] = useState<{ user: { userId: number; username: string } } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      try {
        const token = getToken()
        if (!token) {
          setSession(null)
          return
        }
        const data = await apiRequest<{ user: { userId: number; username: string } }>(
          '/api/auth/me'
        )
        setSession(data ?? null)
      } catch {
        setSession(null)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  return { session, loading }
}

