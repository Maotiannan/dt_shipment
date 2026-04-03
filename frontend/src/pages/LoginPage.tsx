import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiRequest, setToken } from '../lib/apiClient'
import { useAuthSession } from '../lib/authSession'

export default function LoginPage() {
  const navigate = useNavigate()
  const { setAuthenticatedUser } = useAuthSession()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function handleLogin() {
    setLoading(true)
    setErrorMsg(null)
    try {
      const data = await apiRequest<{ token: string; user: { userId: number; username: string } }>(
        '/api/auth/login',
        {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })
      setToken(data.token)
      setAuthenticatedUser(data.user)
      navigate('/dashboard')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : '登录失败，请检查账号密码'
      setErrorMsg(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page">
      <h2 className="pageTitle">登录（占位）</h2>
      <p className="pageSub">使用本地服务账号密码登录进入系统。</p>

      <div style={{ marginTop: 16 }}>
        <label style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>
          账号
        </label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          type="text"
          placeholder="请输入账号"
          style={{
            width: '100%',
            padding: '12px 14px',
            borderRadius: 12,
            border: '1px solid var(--border)',
            boxSizing: 'border-box',
          }}
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <label style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>
          密码
        </label>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          placeholder="请输入密码"
          style={{
            width: '100%',
            padding: '12px 14px',
            borderRadius: 12,
            border: '1px solid var(--border)',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {errorMsg ? (
        <div
          style={{
            marginTop: 12,
            padding: '10px 12px',
            borderRadius: 12,
            border: '1px solid rgba(255,0,0,0.25)',
            color: '#b91c1c',
            background: 'rgba(255,0,0,0.05)',
            fontSize: 13,
          }}
        >
          {errorMsg}
        </div>
      ) : null}

      <button className="primaryBtn" onClick={handleLogin} disabled={loading}>
        {loading ? '登录中...' : '进入系统'}
      </button>
    </div>
  )
}
