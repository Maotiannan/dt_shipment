export type FrontendAppMeta = {
  name: string
  version: string
  versionLabel: string
}

export function resolveApiBase(rawBase?: string) {
  const normalized = rawBase?.trim()
  if (!normalized) return ''
  return normalized.replace(/\/+$/, '')
}

export function buildAppMeta(name: string, version: string): FrontendAppMeta {
  const safeName = name.trim() || '发货管家'
  const safeVersion = version.trim() || '0.0.0'

  return {
    name: safeName,
    version: safeVersion,
    versionLabel: `v${safeVersion}`,
  }
}

const globalDisplayName =
  typeof __APP_DISPLAY_NAME__ === 'string' ? __APP_DISPLAY_NAME__ : '发货管家'
const globalVersion =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

export const APP_META = buildAppMeta(globalDisplayName, globalVersion)
