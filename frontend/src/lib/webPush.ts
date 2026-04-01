import { apiRequest } from './apiClient'

function urlBase64ToUint8Array(base64String: string) {
  // Convert base64 public key to Uint8Array for Push API.
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)

  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as
  | string
  | undefined

export async function ensurePushSubscription(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false
  if (!('PushManager' in window)) return false
  if (typeof Notification === 'undefined') return false

  let permission = Notification.permission
  if (permission === 'default') {
    permission = await Notification.requestPermission()
  }
  if (permission !== 'granted') return false

  if (!VAPID_PUBLIC_KEY) {
    console.warn('[webpush] Missing VITE_VAPID_PUBLIC_KEY')
    return false
  }

  const reg = await navigator.serviceWorker.ready
  const existing = await reg.pushManager.getSubscription()
  if (existing) {
    await savePushSubscription(existing)
    return true
  }

  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  })

  await savePushSubscription(subscription)
  return true
}

async function savePushSubscription(subscription: PushSubscription) {
  const { endpoint, keys } = subscription.toJSON()
  const p256dh = keys?.p256dh ?? ''
  const auth = keys?.auth ?? ''

  if (!endpoint || !p256dh || !auth) {
    console.warn('[webpush] Invalid subscription keys')
    return
  }

  await apiRequest('/api/push-subscriptions', {
    method: 'POST',
    body: JSON.stringify({ endpoint, p256dh, auth }),
  })
}

export async function showPushNotification(
  title: string,
  body: string
): Promise<void> {
  if (typeof Notification === 'undefined') return

  if ('serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.ready
    await reg.showNotification(title, { body })
    return
  }

  // Fallback for browsers without serviceWorker notifications.
  // eslint-disable-next-line no-new
  new Notification(title, { body })
}

