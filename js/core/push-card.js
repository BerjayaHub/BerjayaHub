import { invokeFunction } from './invoke.js';
import { supabase } from '../config/supabase-client.js';
import { toast } from './ui.js';
import {
  isPushSupported,
  isPushConfigured,
  isSubscribedOnThisDevice,
  getPermissionStatus,
  enableReminderNotifications,
  disableReminderNotifications
} from '../modules/attendance/push-notifications.js';

/**
 * Kartu Notifikasi bersama — dipakai halaman Profil (utama) & Presensi.
 *
 * Sebelumnya tombol aktivasi HANYA ada di halaman Presensi, sehingga staff yang
 * tidak pernah membukanya tidak punya langganan sama sekali — dan push apa pun
 * (reservasi, reminder) tidak akan pernah sampai. Karena itu kartunya dipindah
 * ke tempat yang pasti dilihat semua orang, dan diberi tombol uji supaya bisa
 * dibuktikan sekarang juga, tanpa menunggu jadwal.
 */

/** Kirim push percobaan ke perangkat sendiri lewat Edge Function. */
export async function sendTestPush() {
  // invokeFunction memastikan token belum kedaluwarsa dan membaca badan respons
  // non-2xx, supaya pesan aslinya ("belum ada perangkat berlangganan") sampai
  // ke user alih-alih "non-2xx status code" yang tidak memberi tahu apa pun.
  return invokeFunction('send-test-push', {});
}

export function pushCardHtml({ title = 'Notifikasi', compact = false } = {}) {
  if (!isPushSupported()) {
    return `
      <div class="inline-card" id="push-card" style="max-width:560px${compact ? '' : ';margin-top:16px'}">
        <h3 style="margin-top:0;font-size:0.95rem">🔔 ${title}</h3>
        <p style="font-size:0.85rem;color:var(--color-text-muted);margin-bottom:0">
          Perangkat/browser ini tidak mendukung notifikasi. Di <strong>iPhone</strong>, notifikasi hanya bekerja setelah app
          ditambahkan ke <strong>Home Screen</strong> lewat Safari, lalu dibuka dari ikon tersebut.
        </p>
      </div>`;
  }
  return `
    <div class="inline-card" id="push-card" style="max-width:560px${compact ? '' : ';margin-top:16px'}">
      <h3 style="margin-top:0;font-size:0.95rem">🔔 ${title}</h3>
      <p style="font-size:0.85rem;color:var(--color-text-muted)" id="push-status">Memeriksa status…</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="primary" id="push-enable" style="max-width:230px;display:none">Aktifkan Notifikasi</button>
        <button id="push-test" style="max-width:200px;display:none">📨 Kirim Tes</button>
        <button id="push-disable" style="max-width:170px;display:none">Matikan</button>
      </div>
      <div id="push-detail" style="margin-top:8px"></div>
    </div>`;
}

export async function wirePushCard(container, userId) {
  const card = container.querySelector('#push-card');
  if (!card) return;
  const statusEl = card.querySelector('#push-status');
  const btnOn = card.querySelector('#push-enable');
  const btnTest = card.querySelector('#push-test');
  const btnOff = card.querySelector('#push-disable');
  const detail = card.querySelector('#push-detail');
  if (!statusEl) return; // varian "tidak didukung"

  async function refresh() {
    const subscribed = await isSubscribedOnThisDevice();
    const show = (el, on) => el && (el.style.display = on ? 'inline-block' : 'none');

    if (!isPushConfigured()) {
      statusEl.textContent = 'Fitur notifikasi belum dikonfigurasi admin sistem.';
      show(btnOn, false);
      show(btnTest, false);
      show(btnOff, false);
      return;
    }
    if (getPermissionStatus() === 'denied') {
      statusEl.innerHTML =
        'Izin notifikasi <strong>diblokir</strong> di perangkat ini. Buka pengaturan browser/HP → izinkan notifikasi untuk situs ini, lalu muat ulang halaman.';
      show(btnOn, false);
      show(btnTest, false);
      show(btnOff, false);
      return;
    }
    if (subscribed) {
      statusEl.innerHTML = '<strong style="color:var(--color-primary)">Aktif ✓</strong> — perangkat ini akan menerima notifikasi.';
      show(btnOn, false);
      show(btnTest, true);
      show(btnOff, true);
    } else {
      statusEl.textContent = 'Belum aktif di perangkat ini. Nyalakan supaya kamu menerima pengingat & info penting.';
      show(btnOn, true);
      show(btnTest, false);
      show(btnOff, false);
    }
  }

  btnOn?.addEventListener('click', async () => {
    btnOn.disabled = true;
    try {
      await enableReminderNotifications(userId);
      toast('Notifikasi diaktifkan di perangkat ini.', 'success');
      detail.innerHTML = '<p style="font-size:0.8rem;color:var(--color-text-muted);margin:0">Coba tombol <strong>Kirim Tes</strong> untuk memastikan.</p>';
    } catch (error) {
      detail.innerHTML = `<p class="error-text" style="margin:0">${esc(error.message ?? error)}</p>`;
    } finally {
      btnOn.disabled = false;
      await refresh();
    }
  });

  btnTest?.addEventListener('click', async () => {
    btnTest.disabled = true;
    const label = btnTest.textContent;
    btnTest.textContent = 'Mengirim…';
    detail.innerHTML = '';
    try {
      const res = await sendTestPush();
      detail.innerHTML = `<p style="font-size:0.82rem;color:var(--color-primary);margin:0">
        ✅ Terkirim ke ${res.sent} dari ${res.total} perangkat. Kalau tidak muncul dalam beberapa detik, cek pengaturan notifikasi HP.
        ${res.hint ? `<br><span style="color:var(--color-text-muted)">${esc(res.hint)}</span>` : ''}
      </p>`;
    } catch (error) {
      detail.innerHTML = `<p class="error-text" style="margin:0">${esc(error.message ?? error)}</p>`;
    } finally {
      btnTest.disabled = false;
      btnTest.textContent = label;
      await refresh();
    }
  });

  btnOff?.addEventListener('click', async () => {
    btnOff.disabled = true;
    try {
      await disableReminderNotifications();
      toast('Notifikasi dimatikan di perangkat ini.', 'info');
      detail.innerHTML = '';
    } catch (error) {
      detail.innerHTML = `<p class="error-text" style="margin:0">${esc(error.message ?? error)}</p>`;
    } finally {
      btnOff.disabled = false;
      await refresh();
    }
  });

  await refresh();
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
