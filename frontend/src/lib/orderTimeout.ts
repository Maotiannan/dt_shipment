export const DEFAULT_TIMEOUT_HOURS = 24

export function isTimeoutPendingOrder({
  ship_status,
  created_at,
  timeoutHours = DEFAULT_TIMEOUT_HOURS,
}: {
  ship_status: string | null
  created_at: string | null
  timeoutHours?: number
}) {
  if (ship_status !== 'pending') return false
  if (!created_at) return false

  const createdAt = new Date(created_at).getTime()
  if (!Number.isFinite(createdAt)) return false

  const threshold = Date.now() - timeoutHours * 3600 * 1000
  return createdAt <= threshold
}

