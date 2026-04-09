import type { Pool, PoolClient } from 'pg'

type SettingsQueryClient = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>

export type AppSettingRow<TValue> = {
  setting_key: string
  setting_value: TValue
  updated_at: string
}

export async function readAppSetting<TValue>(
  client: SettingsQueryClient,
  settingKey: string
) {
  const { rows } = await client.query<AppSettingRow<TValue>>(
    `select setting_key, setting_value, updated_at
     from app_settings
     where setting_key = $1`,
    [settingKey]
  )

  return rows[0] ?? null
}

export async function upsertAppSetting<TValue>(
  client: SettingsQueryClient,
  settingKey: string,
  settingValue: TValue
) {
  const { rows } = await client.query<AppSettingRow<TValue>>(
    `insert into app_settings(setting_key, setting_value)
     values ($1, $2::jsonb)
     on conflict (setting_key)
     do update set
       setting_value = excluded.setting_value,
       updated_at = now()
     returning setting_key, setting_value, updated_at`,
    [settingKey, JSON.stringify(settingValue)]
  )

  return rows[0] ?? null
}
