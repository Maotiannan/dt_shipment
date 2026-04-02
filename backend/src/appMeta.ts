import fs from 'node:fs'
import path from 'node:path'

export type AppMeta = {
  name: string
  version: string
  displayName: string
}

export const DEFAULT_APP_META: AppMeta = {
  name: 'dt-shipment',
  version: '0.0.0',
  displayName: '发货管家',
}

export function loadAppMeta(repoRoot = path.resolve(__dirname, '../..')): AppMeta {
  try {
    const packageJsonPath = path.join(repoRoot, 'package.json')
    const packageJson = JSON.parse(
      fs.readFileSync(packageJsonPath, 'utf8')
    ) as Partial<AppMeta>

    return {
      name:
        typeof packageJson.name === 'string' && packageJson.name.trim()
          ? packageJson.name.trim()
          : DEFAULT_APP_META.name,
      version:
        typeof packageJson.version === 'string' && packageJson.version.trim()
          ? packageJson.version.trim()
          : DEFAULT_APP_META.version,
      displayName:
        typeof packageJson.displayName === 'string' &&
        packageJson.displayName.trim()
          ? packageJson.displayName.trim()
          : DEFAULT_APP_META.displayName,
    }
  } catch {
    return DEFAULT_APP_META
  }
}

export const appMeta = loadAppMeta()
