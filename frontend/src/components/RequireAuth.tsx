import { type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthSession } from '../lib/authSession'

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuthSession()

  if (loading) {
    return (
      <div className="page">
        <h2 className="pageTitle">加载中...</h2>
      </div>
    )
  }

  if (!session?.user?.userId) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

