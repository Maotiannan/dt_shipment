import type { ReactNode } from 'react'
import { createContext, createElement, useContext, useEffect, useState } from 'react'
import { apiRequest, getToken } from './apiClient'

export type AuthSession = {
  user: {
    userId: number
    username: string
  }
}

type AuthSessionContextValue = {
  session: AuthSession | null
  loading: boolean
  refreshSession: () => Promise<void>
  setAuthenticatedUser: (user: AuthSession['user']) => void
  clearSession: () => void
}

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null)

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [loading, setLoading] = useState(true)

  async function refreshSession() {
    setLoading(true)
    try {
      const token = getToken()
      if (!token) {
        setSession(null)
        return
      }

      const data = await apiRequest<AuthSession>('/api/auth/me')
      setSession(data ?? null)
    } catch {
      setSession(null)
    } finally {
      setLoading(false)
    }
  }

  function setAuthenticatedUser(user: AuthSession['user']) {
    setSession({ user })
    setLoading(false)
  }

  function clearSession() {
    setSession(null)
    setLoading(false)
  }

  useEffect(() => {
    void refreshSession()
  }, [])

  return createElement(
    AuthSessionContext.Provider,
    {
      value: {
        session,
        loading,
        refreshSession,
        setAuthenticatedUser,
        clearSession,
      },
    },
    children
  )
}

export function useAuthSession() {
  const value = useContext(AuthSessionContext)
  if (!value) {
    throw new Error('useAuthSession must be used within AuthSessionProvider')
  }
  return value
}
