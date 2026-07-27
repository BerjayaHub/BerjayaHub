import { supabase } from '../../config/supabase-client.js';
import { toast } from '../../core/ui.js';

/**
 * Halaman uji & status Notifikasi Telegram (Super Admin).
 *
 * Halaman ini sengaja TIDAK menyimpan token bot maupun chat ID. Keduanya hidup
 * sebagai secret di Edge Function, karena repo ini publik di GitHub Pages —
 * apa pun yang masuk folder js/ bisa dibaca siapa saja.
 */
const EVENTS = [
  { icon: '📝', label: 'Pengajuan cuti baru', detail: 'Database Webhook · INSERT pada leave_requests' },
  { icon: '✅', label: 'Cuti disetujui / ditolak', detail: 'Database Webhook · UPDATE pada leave_requests saat status berubah' },
  { icon: '📦', label: 'Order stok baru ke Central Kitchen', detail: 'Database Webhook · INSERT pada stock_orders' },
  { icon: '🚗', label: 'Dokumen kendaraan jatuh tempo', detail: 'Cron harian · Edge Function send-fleet-reminders' }
];

export async function renderTelegramAdminPage(container) {
  container.innerHTML = `
    <h1>Notifikasi Telegram</h1>
    <p style="font-size:0.85rem;color:var(--color-text-muted);margin-top:0;max-width:640px">
      App mengirim pesan otomatis ke grup Telegram berisi para PIC. Token bot &amp; ID grup disimpan sebagai
      <strong>secret di Edge Function</strong>, bukan di aplikasi — jadi tidak bisa terbaca dari kode yang di-hosting publik.
    </p>

    <div class="inline-card" style="max-width:640px">
      <h3 style="margin-top:0">Uji Koneksi</h3>
      <p style="font-size:0.82rem;color:var(--color-text-muted);margin-top:0">
        Mengirim satu pesan tes ke grup. Ini cara tercepat memastikan token, ID grup, dan keanggotaan bot sudah benar
        sebelum menunggu event sungguhan.
      </p>
      <button class="primary" id="tg-test" style="max-width:220px">📤 Kirim Pesan Tes</button>
      <div id="tg-result" style="margin-top:10px"></div>
    </div>

    <div class="inline-card" style="max-width:640px;margin-top:16px">
      <h3 style="margin-top:0">Event yang Dikirim</h3>
      <div class="profile-list">
        ${EVENTS.map(
          (e) => `<div class="profile-row">
            <span class="profile-label">${e.icon} ${esc(e.label)}</span>
            <span class="profile-value" style="font-size:0.78rem;color:var(--color-text-muted)">${esc(e.detail)}</span>
          </div>`
        ).join('')}
      </div>
    </div>

    <div class="inline-card" style="max-width:640px;margin-top:16px">
      <h3 style="margin-top:0">Kalau Pesan Tidak Sampai</h3>
      <ul style="font-size:0.84rem;color:var(--color-text-muted);padding-left:18px;margin-bottom:0">
        <li><strong>"chat not found"</strong> — bot belum ditambahkan ke grup, atau ID grup salah. ID grup selalu diawali tanda minus.</li>
        <li><strong>"bot was kicked"</strong> — bot dikeluarkan dari grup, tambahkan kembali.</li>
        <li><strong>Tes berhasil tapi event tidak terkirim</strong> — Database Webhook-nya belum didaftarkan di dashboard Supabase. Lihat README.</li>
        <li><strong>Reminder armada tidak muncul</strong> — cron harian belum dipasang, atau semua dokumen memang masih aman.</li>
      </ul>
    </div>
  `;

  const result = container.querySelector('#tg-result');
  const btn = container.querySelector('#tg-test');

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    result.innerHTML = `<p style="color:var(--color-text-muted)">Mengirim…</p>`;
    try {
      const { data, error } = await supabase.functions.invoke('notify-telegram', { body: { test: true } });
      if (error) {
        // Badan respons non-2xx tidak dibaca otomatis oleh supabase-js — dibaca
        // manual supaya pesan Telegram yang sebenarnya (mis. "chat not found")
        // terlihat, bukan sekadar "non-2xx status code".
        let detail = error.message ?? String(error);
        try {
          const body = await error.context?.json?.();
          if (body?.error) detail = body.error;
        } catch {
          /* pakai pesan aslinya */
        }
        throw new Error(detail);
      }
      if (data?.ok) {
        result.innerHTML = `<p style="color:var(--color-primary);font-weight:600">✅ Terkirim. Cek grup Telegram kamu.</p>`;
        toast('Pesan tes terkirim.', 'success');
      } else {
        throw new Error(data?.error ?? 'Gagal mengirim.');
      }
    } catch (e) {
      result.innerHTML = `<p class="error-text" style="margin:0">❌ ${esc(e.message ?? e)}</p>`;
      toast('Pesan tes gagal.', 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
