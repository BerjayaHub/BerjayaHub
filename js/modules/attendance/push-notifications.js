import { savePushSubscription, deletePushSubscription, getMyPushSubscriptionEndpoints } from './attendance.service.js';

// GANTI dengan VAPID public key kamu sendiri (lihat README bagian "Push
// Notification Reminder" untuk cara generate-nya, gratis pakai `npx web-push`).
// Ini bukan rahasia -- boleh terlihat di kode frontend (beda dengan private key).
export const VAPID_PUBLIC_KEY = 'BDStwWHv74XC1IM12fy-gafoYDfpilSeQ8cU2qoSEtOEeR3IdSSqTMyGs3Ox27Poc--K8tCjLG7NtGqJYUtYkdc';

function isConfigured() {
  return VAPID_PUBLIC_KEY && !VAPID_PUBLIC_KEY.startsWith('GANTI_');
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

/** true kalau browser ini mendukung Web Push (Android Chrome; iOS 16.4+ HANYA kalau sudah "Add to Home Screen"). */
export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window;
}

/** Status izin notifikasi saat ini: 'granted' | 'denied' | 'default'. */
export function getPermissionStatus() {
  return typeof Notification !== 'undefined' ? Notification.permission : 'denied';
}

/** Apakah staff yang login sudah aktifkan reminder di browser/device ini. */
export async function isSubscribedOnThisDevice() {
  if (!isPushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return !!sub;
}

/**
 * Minta izin notifikasi & subscribe device ini untuk terima reminder clock in.
 * Dipanggil dari tombol "Aktifkan Notifikasi Pengingat" di halaman Presensi.
 */
export async function enableReminderNotifications(userId) {
  if (!isPushSupported()) throw new Error('Browser ini tidak mendukung push notification.');
  if (!isConfigured()) {
    throw new Error('Fitur notifikasi belum dikonfigurasi admin (VAPID key belum diisi). Hubungi admin sistem.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Izin notifikasi ditolak. Aktifkan lewat pengaturan browser/HP kalau ingin dapat pengingat.');
  }

  const reg = await navigator.serviceWorker.register('./sw.js');
  await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
  }

  await savePushSubscription(userId, sub);
  return sub;
}

/** Matikan reminder di device ini. */
export async function disableReminderNotifications() {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await deletePushSubscription(sub.endpoint);
    await sub.unsubscribe();
  }
}

export { isConfigured as isPushConfigured, getMyPushSubscriptionEndpoints };
