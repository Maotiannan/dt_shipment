import { resolveApiBase } from './runtimeConfig'

const API_BASE = resolveApiBase(import.meta.env?.VITE_API_BASE as string | undefined)

const TOKEN_KEY = 'dt_auth_token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const token = getToken()
  const headers = new Headers(init.headers ?? {})
  headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const resp = await fetch(`${API_BASE}${path}`, { ...init, headers })
  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`
    try {
      const j = (await resp.json()) as { error?: string }
      if (j?.error) msg = j.error
    } catch {
      // ignore
    }
    throw new Error(msg)
  }
  return (await resp.json()) as T
}
