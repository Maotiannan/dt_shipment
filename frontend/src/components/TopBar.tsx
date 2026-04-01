import { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthSession } from '../lib/authSession'
import { clearToken } from '../lib/apiClient'

export default function TopBar({ rightExtra }: { rightExtra?: ReactNode }) {
  const navigate = useNavigate()
  const { session, loading } = useAuthSession()

  async function handleLogout() {
    try {
      clearToken()
    } catch {
      // 忽略退出失败，仍跳回登录页
    } finally {
      navigate('/login')
    }
  }

  return (
    <header className="topBar">
      <div className="topBarTitle">发货管家</div>
      <div className="topBarRight">
        {rightExtra}
        {!loading && session?.user?.userId ? (
          <button className="ghostBtn" onClick={handleLogout}>
            退出
          </button>
        ) : null}
      </div>
    </header>
  )
}

