// supabase/functions/send-konten-reminders/index.ts
// Deploy: supabase functions deploy send-konten-reminders
//
// Pagi di hari tenggat: sebut outlet mana yang BELUM setor konten, dan mana
// yang sudah menyetor tapi belum lengkap.
//
// ============ KENAPA INI ADA, PADAHAL TIAP BERKAS SUDAH DIUMUMKAN ============
//
// Notifikasi per berkas (0164) hanya berbunyi kalau ADA yang menyetor. Outlet
// yang tidak melakukan apa-apa tidak menghasilkan satu peristiwa pun — dan
// diamnya tidak bisa dibedakan dari "notifikasinya yang rusak".
//
// Itu bukan kemungkinan teoretis di repo ini: rekap Telegram pernah melaporkan
// `succeeded` berbulan-bulan sambil ditolak 401 setiap malam, dan tidak ada
// yang menyadarinya karena tidak adanya pesan terlihat normal.
//
// Pekerjaan ini membalik bebannya: ia berbicara justru saat TIDAK ADA yang
// terjadi. Kalau ia diam, itu karena semua outlet sudah lengkap — dan kalimat
// penutupnya mengatakan begitu, bukan tidak mengirim apa-apa.

import { createClient } from 'npm:@supabase/supabase-js@2'; // npm:, bukan esm.sh — lihat catatan di create-staff-user

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
const CRON_SECRET = Deno.env.get('CRON_SECRET');

const TIMEZONE = 'Asia/Jakarta';
const EVENT_KEY = 'konten_belum_setor';
const NAMA_HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 'YYYY-MM-DD' hari ini di WIB. `en-CA` memang memulangkan bentuk ISO. */
function todayWIB() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date()
  );
}

/**
 * Hari dalam minggu (0=Minggu) untuk sebuah 'YYYY-MM-DD'.
 *
 * Dihitung dari tanggalnya lewat UTC, BUKAN dari `new Date().getDay()`.
 * Server Edge Function berjalan di UTC; pada pukul 07.00 WIB, UTC masih di
 * tanggal kemarin — jadi `getDay()` lokal server akan memulangkan hari yang
 * salah persis pada jam pekerjaan ini dijalankan.
 */
const hariDari = (tgl: string) => new Date(`${tgl}T00:00:00Z`).getUTCDay();

const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });

async function resolveChat(buId: string | null, routes: { chat_id: string; business_unit_id: string | null }[]) {
  const khususBu = buId ? routes.find((r) => r.business_unit_id === buId) : null;
  const global = routes.find((r) => !r.business_unit_id);
  return khususBu?.chat_id ?? global?.chat_id ?? CHAT_ID ?? null;
}

async function sendTelegram(text: string, chatId: string | null) {
  if (!BOT_TOKEN) return { ok: false, error: 'TELEGRAM_BOT_TOKEN belum diset.' };
  if (!chatId) return { ok: false, error: `Grup tujuan untuk '${EVENT_KEY}' belum diatur.` };
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.ok === false) {
    let error = body?.description ?? `HTTP ${res.status}`;
    const idBaru = body?.parameters?.migrate_to_chat_id;
    if (idBaru) error += ` — grup sudah jadi supergroup, ID barunya: ${idBaru}.`;
    return { ok: false, error };
  }
  return { ok: true };
}

type Baris = { outlet: string; keadaan: string; telat: boolean };

Deno.serve(async (req) => {
  if (CRON_SECRET && req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dry_run === true;
  // Memaksa tanggal tertentu — dipakai menguji tanpa menunggu hari Sabtu tiba.
  const hariIni = typeof body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : todayWIB();
  const dow = hariDari(hariIni);

  if (!dryRun) {
    const { data: sudah } = await admin
      .from('telegram_notifications_sent')
      .select('id')
      .eq('kind', EVENT_KEY)
      .eq('ref', hariIni)
      .maybeSingle();
    if (sudah) return json({ ok: true, skipped: true, reason: `Sudah dikirim untuk ${hariIni}.` });
  }

  // Hanya outlet yang hari setornya JATUH HARI INI. Outlet dengan hari setor
  // lain tidak sedang terlambat apa pun.
  const { data: setelan, error: galatSetelan } = await admin
    .from('konten_setelan_outlet')
    .select('outlet_id, business_unit_id, hari_setor, aktif')
    .eq('aktif', true)
    .eq('hari_setor', dow);
  if (galatSetelan) return json({ error: galatSetelan.message }, 500);

  if (!setelan?.length) {
    return json({ ok: true, skipped: true, reason: `Tidak ada outlet yang hari setornya ${NAMA_HARI[dow]}.`, tanggal: hariIni });
  }

  const outletIds = setelan.map((s) => s.outlet_id);
  const [{ data: outlets }, { data: tugasList }, { data: routes }] = await Promise.all([
    admin.from('outlets').select('id, name').in('id', outletIds),
    admin
      .from('konten_tugas')
      .select('outlet_id, status, konten_berkas(jenis)')
      .eq('tenggat', hariIni)
      .eq('jenis', 'mingguan')
      .in('outlet_id', outletIds),
    admin.from('telegram_routes').select('chat_id, business_unit_id').eq('event_key', EVENT_KEY).eq('is_active', true)
  ]);

  const namaOutlet = new Map((outlets ?? []).map((o) => [o.id, o.name]));
  const tugasPer = new Map((tugasList ?? []).map((t) => [t.outlet_id, t]));

  // Dikelompokkan per BU: tiap BU bisa punya grup Telegram sendiri, dan daftar
  // outlet Bengkel di grup Cafe adalah kebisingan yang menurunkan seluruh
  // pesannya jadi latar belakang.
  const perBu = new Map<string | null, Baris[]>();
  let lengkap = 0;

  for (const s of setelan) {
    const t = tugasPer.get(s.outlet_id) as { status?: string; konten_berkas?: { jenis: string }[] } | undefined;
    const berkas = t?.konten_berkas ?? [];
    const video = berkas.filter((b) => b.jenis === 'video').length;
    const foto = berkas.filter((b) => b.jenis === 'foto').length;

    // Sudah lengkap -> tidak disebut. Daftar yang memuat yang sudah beres
    // membuat orang harus MEMBACANYA untuk tahu siapa yang belum.
    if (video >= 1 && foto >= 1) {
      lengkap += 1;
      continue;
    }

    // ============ TUGAS YANG TIDAK ADA = BELUM DISENTUH SAMA SEKALI ============
    //
    // Barisnya lahir saat layar dibuka (0163), jadi ketiadaannya berarti
    // layarnya belum pernah dibuka minggu ini. Itu keadaan yang BERBEDA dari
    // "sudah dibuka, belum mengunggah" — dan bedanya menentukan apa yang
    // ditanyakan ke outletnya.
    const keadaan = !t
      ? 'belum membuka modulnya sama sekali'
      : berkas.length === 0
        ? 'sudah membuka, belum mengunggah apa pun'
        : `baru ${video} video, ${foto} foto — kurang ${[video < 1 ? '1 video' : '', foto < 1 ? '1 foto' : ''].filter(Boolean).join(' dan ')}`;

    const daftar = perBu.get(s.business_unit_id ?? null) ?? [];
    daftar.push({ outlet: namaOutlet.get(s.outlet_id) ?? s.outlet_id, keadaan, telat: !t || berkas.length === 0 });
    perBu.set(s.business_unit_id ?? null, daftar);
  }

  if (!perBu.size) {
    // Diam saat semuanya beres adalah pilihan yang sadar: pesan "semua sudah
    // lengkap" tiap minggu akan dilewati matanya, dan pada minggu ia TIDAK
    // muncul tidak ada yang menyadarinya. Hasilnya tetap dilaporkan ke
    // pemanggil (cron/`dry_run`), jadi masih bisa dibuktikan ia berjalan.
    return json({ ok: true, tanggal: hariIni, hari: NAMA_HARI[dow], semua_lengkap: true, outlet_lengkap: lengkap });
  }

  const hasil: unknown[] = [];
  for (const [buId, daftar] of perBu) {
    const teks = [
      '⏰ <b>Konten belum disetor</b>',
      '',
      `📅 Tenggatnya <b>hari ini</b> — ${esc(NAMA_HARI[dow])}, ${esc(fmtDate(hariIni))}`,
      '',
      ...daftar.map((b) => `• <b>${esc(b.outlet)}</b> — ${esc(b.keadaan)}`),
      '',
      lengkap ? `<i>${lengkap} outlet lain sudah lengkap.</i>` : '',
      '<i>Minimal 1 video + 1 foto. Setor lewat Berjaya Hub → Konten Sosmed.</i>'
    ]
      .filter(Boolean)
      .join('\n');

    if (dryRun) {
      hasil.push({ business_unit_id: buId, outlet: daftar.length, teks });
      continue;
    }
    const chat = await resolveChat(buId, routes ?? []);
    hasil.push({ business_unit_id: buId, chat_id: chat, outlet: daftar.length, ...(await sendTelegram(teks, chat)) });
  }

  // ============ PENANDA DITULIS SESUDAH KIRIM, BUKAN SEBELUM ============
  //
  // Kalau ditulis lebih dulu, pengiriman yang gagal tetap menandai hari ini
  // "sudah" — dan percobaan berikutnya melewatinya. Pengingat hilang tanpa
  // jejak, pada hari yang justru paling butuh.
  if (!dryRun && hasil.some((h) => (h as { ok?: boolean }).ok)) {
    await admin.from('telegram_notifications_sent').insert({ kind: EVENT_KEY, ref: hariIni });
  }

  return json({ ok: true, tanggal: hariIni, hari: NAMA_HARI[dow], outlet_lengkap: lengkap, dry_run: dryRun, hasil });
});
