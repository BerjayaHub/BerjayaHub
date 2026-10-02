// supabase/functions/send-reservation-digest/index.ts
// Deploy: supabase functions deploy send-reservation-digest
//
// Rekap harian reservasi, dikirim ke DUA kanal sekaligus:
//   1. Web Push (PWA) ke staff/admin yang berhak
//   2. Telegram, dikelompokkan PER OUTLET, ke grup sesuai rute 'reservation_digest'
//      (kalau rutenya belum diatur, jatuh ke rute 'reservation')
//
// Siapa yang menerima push: staff/admin di BU yang MENGAKTIFKAN modul Reservasi,
// dan isinya dibatasi ke outlet yang memang jadi scope orang itu. Prinsipnya:
// cakupan notifikasi = cakupan yang orang itu lihat di dalam app.
//
// Secrets: VAPID_*, TELEGRAM_BOT_TOKEN, CRON_SECRET
//
// ============ DIPANGGIL DUA PIHAK, BUKAN SATU ============
//
// 1. Cron harian (pg_net), membawa header `x-cron-secret`.
// 2. Admin Portal -> Notifikasi Telegram, membawa JWT admin.
//
// Yang kedua ditambahkan karena rekap ini SEBELUMNYA tidak bisa dibuktikan
// jalan dari dalam aplikasi sama sekali. Tombol "Tes" yang ada memanggil
// `notify-telegram` langsung — ia membuktikan bot, chat_id, dan rutenya benar,
// dan TIDAK membuktikan apa pun tentang apakah ada yang memanggil rekap ini
// tiap pagi. Jadi cron yang tidak pernah terpasang terlihat persis seperti
// cron yang terpasang dan sehat: dua-duanya diam.

import { createClient } from 'npm:@supabase/supabase-js@2'; // npm:, bukan esm.sh — lihat catatan di create-staff-user
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY');
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY');
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
const CRON_SECRET = Deno.env.get('CRON_SECRET');

const TIMEZONE = 'Asia/Jakarta';
const MAX_BARIS_PUSH = 6; // body notifikasi pendek; sisanya diringkas

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// CORS wajib sejak function ini dipanggil dari browser. Tanpa `OPTIONS` yang
// dijawab, permintaannya mati di preflight — dan yang terlihat di layar bukan
// pesan dari sini melainkan "Failed to fetch", yang menuduh jaringan.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });

/**
 * Pemanggilnya sah?
 *
 * Mengembalikan `null` kalau boleh, atau kalimat penolakannya.
 *
 * Dua identitas yang diterima, dan keduanya diperiksa SUNGGUHAN:
 *
 *   - cron, lewat `x-cron-secret`;
 *   - admin, lewat JWT-nya sendiri — bukan sekadar "ada Authorization".
 *     Gerbang Supabase hanya memastikan tokennya sah sebagai token; ia tidak
 *     tahu apa-apa tentang peran orangnya. Menganggap "lolos gerbang" sama
 *     dengan "dia admin" berarti setiap staff yang login bisa menyuruh bot
 *     membanjiri grup Telegram kapan saja.
 */
async function tolakPemanggil(req: Request): Promise<string | null> {
  if (CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET) return null;

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) {
    return CRON_SECRET ? 'Unauthorized' : null;
  }

  // Klien ber-ANON key + token orangnya: `getUser()` memverifikasi tanda
  // tangannya ke Auth, jadi token karangan tidak lolos di sini.
  const sebagaiDia = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data: userRes } = await sebagaiDia.auth.getUser();
  const uid = userRes?.user?.id;
  // Bukan JWT orang (mis. anon key yang dikirim cron sebagai Bearer). Kalau
  // CRON_SECRET diset, ia sudah gagal di atas; kalau tidak, biarkan lewat
  // supaya pemasangan yang belum pakai secret tidak mendadak mati.
  if (!uid) return CRON_SECRET ? 'Unauthorized' : null;

  const { data: peran } = await admin
    .from('membership_scopes')
    .select('role')
    .eq('user_id', uid)
    .in('role', ['super_admin', 'bu_admin']);
  if (!peran?.length) return 'Hanya Admin BU & Super Admin yang bisa menjalankan rekap ini manual.';
  return null;
}
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function dateWIB(offsetDays = 0) {
  const base = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(base);
}
const fmtTanggal = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

async function sendTelegram(text: string, chatId: string | null) {
  if (!BOT_TOKEN || !chatId) return { ok: false, error: 'Bot/chat belum diatur.' };
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true })
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok || b?.ok === false) return { ok: false, error: b?.description ?? `HTTP ${res.status}` };
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const tolak = await tolakPemanggil(req);
  if (tolak) return json({ error: tolak }, 401);

  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dry_run === true;
  const offset = Number.isInteger(body?.offset_days) ? body.offset_days : 0;
  const tanggal = body?.date ?? dateWIB(offset);
  const untukBesok = offset === 1;
  const refDedupe = `${tanggal}:${offset}`;

  // Dicek saja di sini. Penandanya ditulis SETELAH pengiriman berhasil — kalau
  // ditulis di awal, satu kali jalan yang gagal / belum ada data akan mengunci
  // sisa hari itu dan semua percobaan berikutnya jadi "skipped". Itu persis
  // gejala "tes masuk, tapi saat di-run tidak ada notifikasi".
  const { data: sudah } = await admin
    .from('telegram_notifications_sent')
    .select('id')
    .eq('kind', 'reservation_digest')
    .eq('ref', refDedupe)
    .maybeSingle();
  const sudahTerkirim = !!sudah;

  // `force` hanya untuk pengiriman manual dari Admin Portal. Cron TIDAK
  // mengirimkannya — kalau ia bisa memaksa, dedupe-nya tidak berarti apa-apa
  // dan satu cron yang salah jadwal akan membanjiri grup.
  const paksa = body?.force === true;
  if (!dryRun && sudahTerkirim && !paksa) {
    return json({ ok: true, skipped: true, reason: `Sudah dikirim untuk ${tanggal}.` });
  }

  // ---- BU yang mengaktifkan modul Reservasi ----
  const { data: modRow } = await admin.from('modules').select('id').eq('code', 'reservation').maybeSingle();
  if (!modRow) return json({ error: "Modul 'reservation' belum ada di tabel modules." }, 500);

  const { data: buMods } = await admin.from('bu_modules').select('business_unit_id').eq('module_id', modRow.id).eq('is_active', true);
  const buIds = (buMods ?? []).map((b) => b.business_unit_id);
  if (!buIds.length) return json({ ok: true, sent: 0, reason: 'Tidak ada BU yang mengaktifkan modul Reservasi.' });

  const [{ data: reservasi }, { data: outlets }, { data: scopes }] = await Promise.all([
    admin
      .from('reservations')
      // Kolom hotel ikut dibawa. Untuk booking hotel `reserve_date` = check_in
      // (trigger 0055), jadi filter tanggal yang sama otomatis berarti
      // "tamu yang DATANG hari itu" — persis yang perlu direkap tiap pagi.
      .select('outlet_id, business_unit_id, customer_name, phone, reserve_time, pax, status, notes, mode, check_in, check_out, adults, children, room_types(name)')
      .in('business_unit_id', buIds)
      .eq('reserve_date', tanggal)
      // `checked_in` ikut supaya rekap yang dijalankan ulang siang hari tidak
      // mendadak kehilangan tamu yang sudah keburu datang.
      .in('status', ['pending', 'confirmed', 'checked_in'])
      .order('reserve_time', { nullsFirst: true }),
    admin.from('outlets').select('id, name, business_unit_id, outlet_role, is_active, reservation_mode').in('business_unit_id', buIds),
    admin.from('membership_scopes').select('user_id, business_unit_id, outlet_id').in('business_unit_id', buIds)
  ]);

  const daftarReservasi = reservasi ?? [];
  const namaOutlet = new Map((outlets ?? []).map((o) => [o.id, o.name]));
  const modeOutlet = new Map((outlets ?? []).map((o) => [o.id, o.reservation_mode ?? 'cafe']));

  // Satu tamu cafe dihitung dari `pax`; satu booking hotel dari dewasa + anak.
  // Tanpa pembedaan ini, rekap hotel selalu melaporkan "0 tamu" karena kolom
  // `pax` memang tidak diisi untuk booking kamar.
  // deno-lint-ignore no-explicit-any
  const jumlahTamu = (r: any) => (r.mode === 'hotel' ? (Number(r.adults) || 1) + (Number(r.children) || 0) : Number(r.pax) || 0);
  const malam = (a: string, b: string) =>
    Math.max(0, Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000));
  // deno-lint-ignore no-explicit-any
  const barisTelegram = (r: any) =>
    r.mode === 'hotel'
      ? `• <b>${esc(r.room_types?.name ?? 'Kamar')}</b> — ${esc(r.customer_name)} (${jumlahTamu(r)} tamu, ${malam(r.check_in, r.check_out)} malam)` +
        (r.status === 'checked_in' ? ' ✅' : '') +
        (r.notes ? `\n   <i>${esc(r.notes)}</i>` : '')
      : `• <b>${String(r.reserve_time).slice(0, 5)}</b> — ${esc(r.customer_name)} (${r.pax} tamu)` +
        (r.status === 'pending' ? ' ⏳' : '') +
        (r.notes ? `\n   <i>${esc(r.notes)}</i>` : '');
  // Central Kitchen tidak menerima tamu, jadi tidak perlu ikut direkap.
  const outletTamu = (outlets ?? []).filter((o) => o.is_active !== false && o.outlet_role !== 'central_kitchen');

  // ================= TELEGRAM: per outlet =================
  const { data: routeDigest } = await admin
    .from('telegram_routes')
    .select('chat_id, business_unit_id, event_key')
    .in('event_key', ['reservation_digest', 'reservation'])
    .eq('is_active', true);

  // ============ URUTANNYA HARUS DITENTUKAN, BUKAN DIWARISI ============
  //
  // Versi sebelumnya mengambil kedua event sekaligus lalu memakai baris PERTAMA
  // yang BU-nya cocok — tanpa melihat `event_key`. Jadi kalau sebuah BU punya
  // rute `reservation_digest` DAN `reservation`, grup tujuan rekapnya ditentukan
  // urutan baris yang dikembalikan PostgREST: bisa benar hari ini dan berubah
  // sendiri besok, tanpa ada yang mengubah apa pun.
  //
  // Itu tidak pernah menggigit selama kedua rutenya ke grup yang sama — dan
  // justru itu yang membuatnya berbahaya: ia menunggu sampai orangnya
  // memisahkan grup rekap dari grup reservasi baru, yaitu saat terakhir ia
  // akan dicurigai.
  const cariRute = (buId: string) => {
    const r = routeDigest ?? [];
    const urutan = [
      { k: 'reservation_digest', bu: true },
      { k: 'reservation_digest', bu: false },
      { k: 'reservation', bu: true },
      { k: 'reservation', bu: false }
    ];
    for (const u of urutan) {
      const ketemu = r.find((x) => x.event_key === u.k && (u.bu ? x.business_unit_id === buId : !x.business_unit_id));
      if (ketemu) {
        return {
          chat: ketemu.chat_id as string,
          // Dibawa ke pratinjau: "jatuh ke rute Reservasi baru" adalah hal yang
          // harus TERLIHAT, bukan disimpulkan sendiri oleh yang membacanya.
          sumber: `${u.k}${u.bu ? ' (khusus BU ini)' : ' (umum)'}`
        };
      }
    }
    if (CHAT_ID) return { chat: CHAT_ID, sumber: 'TELEGRAM_CHAT_ID (cadangan secret)' };
    return { chat: null, sumber: 'tidak ada rute' };
  };

  const teksOutlet = (outletId: string) => {
    const punya = daftarReservasi.filter((r) => r.outlet_id === outletId);
    const nama = namaOutlet.get(outletId) ?? '-';
    const hotel = modeOutlet.get(outletId) === 'hotel';
    const judul = hotel
      ? `🏨 <b>Check-in ${untukBesok ? 'Besok' : 'Hari Ini'} — ${esc(nama)}</b>`
      : `📅 <b>Reservasi ${untukBesok ? 'Besok' : 'Hari Ini'} — ${esc(nama)}</b>`;

    if (!punya.length) {
      // Diminta eksplisit: hari kosong tetap dikabari, supaya tim tahu
      // rekapnya memang jalan dan hari itu benar-benar kosong.
      return `${judul}\n<i>${fmtTanggal(tanggal)}</i>\n\n${hotel ? 'Tidak ada tamu yang check-in.' : 'Tidak ada reservasi.'}`;
    }
    const tamu = punya.reduce((t, r) => t + jumlahTamu(r), 0);
    const belumOk = punya.filter((r) => r.status === 'pending').length;
    const baris = punya.map(barisTelegram).join('\n');
    return [
      judul,
      `<i>${fmtTanggal(tanggal)}</i>`,
      '',
      `${punya.length} ${hotel ? 'booking' : 'reservasi'} · <b>${tamu} tamu</b>${belumOk ? ` · ⏳ ${belumOk} belum dikonfirmasi` : ''}`,
      '',
      baris
    ].join('\n');
  };

  const tgTugas = outletTamu.map((o) => {
    const rute = cariRute(o.business_unit_id);
    return {
      outlet: o.name,
      chat: rute.chat,
      sumber_rute: rute.sumber,
      jumlah: daftarReservasi.filter((r) => r.outlet_id === o.id).length,
      text: teksOutlet(o.id)
    };
  });

  // ================= WEB PUSH: per user =================
  const userIds = [...new Set((scopes ?? []).map((s) => s.user_id))];
  const { data: akses } = userIds.length
    ? await admin.from('user_module_access').select('user_id, business_unit_id, module_id').in('user_id', userIds).in('business_unit_id', buIds)
    : { data: [] };
  const punyaWhitelist = new Set((akses ?? []).map((a) => `${a.user_id}|${a.business_unit_id}`));
  const bolehReservasi = new Set((akses ?? []).filter((a) => a.module_id === modRow.id).map((a) => `${a.user_id}|${a.business_unit_id}`));

  const { data: subs } = userIds.length
    ? await admin.from('push_subscriptions').select('user_id, endpoint, p256dh, auth_key').in('user_id', userIds)
    : { data: [] };
  const subsByUser = new Map<string, NonNullable<typeof subs>>();
  for (const s of subs ?? []) {
    if (!subsByUser.has(s.user_id)) subsByUser.set(s.user_id, []);
    subsByUser.get(s.user_id)!.push(s);
  }

  type Msg = { userId: string; title: string; body: string };
  const pesan: Msg[] = [];

  for (const uid of userIds) {
    if (!subsByUser.has(uid)) continue;
    const outletBoleh = new Set<string>();
    let semuaOutletBu = false;
    const buUser = new Set<string>();
    for (const sc of (scopes ?? []).filter((s) => s.user_id === uid)) {
      const key = `${uid}|${sc.business_unit_id}`;
      if (punyaWhitelist.has(key) && !bolehReservasi.has(key)) continue; // modul dicabut untuk user ini
      buUser.add(sc.business_unit_id);
      if (sc.outlet_id) outletBoleh.add(sc.outlet_id);
      else semuaOutletBu = true;
    }
    if (!buUser.size) continue;

    const outletDia = outletTamu.filter((o) => buUser.has(o.business_unit_id) && (semuaOutletBu || outletBoleh.has(o.id)));
    if (!outletDia.length) continue;

    const idDia = new Set(outletDia.map((o) => o.id));
    const milikDia = daftarReservasi.filter((r) => idDia.has(r.outlet_id));
    const judulTempat = outletDia.length === 1 ? ` — ${outletDia[0].name}` : '';

    // Judul & istilahnya mengikuti mode outlet orang itu. Kalau dia membawahi
    // hotel DAN cafe sekaligus, dipakai istilah netral supaya tidak salah satu
    // pun terasa keliru.
    const semuaHotel = outletDia.every((o) => (o.reservation_mode ?? 'cafe') === 'hotel');
    const kata = semuaHotel ? 'Check-in' : 'Reservasi';
    const kataKecil = semuaHotel ? 'tamu check-in' : 'reservasi';
    const ikon = semuaHotel ? '🏨' : '📅';
    const kapan = untukBesok ? 'besok' : 'hari ini';

    if (!milikDia.length) {
      pesan.push({
        userId: uid,
        title: `${ikon} ${kata} ${kapan}${judulTempat}`,
        body:
          outletDia.length === 1
            ? `Tidak ada ${kataKecil} di ${outletDia[0].name} ${kapan}.`
            : `Tidak ada ${kataKecil} ${kapan} di outlet kamu.`
      });
      continue;
    }

    const totalTamu = milikDia.reduce((t, r) => t + jumlahTamu(r), 0);
    const belumOk = milikDia.filter((r) => r.status === 'pending').length;
    const banyakOutlet = new Set(milikDia.map((r) => r.outlet_id)).size > 1;
    const baris = milikDia
      .slice(0, MAX_BARIS_PUSH)
      .map((r) => {
        const inti =
          r.mode === 'hotel'
            ? `${r.room_types?.name ?? 'Kamar'} ${r.customer_name} (${malam(r.check_in, r.check_out)} mlm)`
            : `${String(r.reserve_time).slice(0, 5)} ${r.customer_name} (${r.pax})`;
        return inti + (banyakOutlet ? ` @${namaOutlet.get(r.outlet_id) ?? '-'}` : '');
      })
      .join('\n');
    const sisa = milikDia.length - MAX_BARIS_PUSH;

    pesan.push({
      userId: uid,
      title: `${ikon} ${kata} ${kapan}${judulTempat}`,
      body:
        `${milikDia.length} ${semuaHotel ? 'booking' : 'reservasi'} · ${totalTamu} tamu` +
        (belumOk ? ` · ${belumOk} belum dikonfirmasi` : '') +
        `\n${baris}` +
        (sisa > 0 ? `\n…dan ${sisa} lainnya` : '')
    });
  }

  if (dryRun) {
    return json({
      ok: true,
      dry_run: true,
      tanggal,
      total_reservasi: daftarReservasi.length,
      // `sudah_dikirim` dibawa walau dry run MELEWATI pemeriksaan dedupe —
      // justru supaya orangnya tahu bahwa kiriman sungguhan akan dilewati,
      // dan tidak menyimpulkan dari pratinjau yang mulus bahwa semuanya beres.
      sudah_dikirim_hari_ini: sudahTerkirim,
      telegram: tgTugas.map((t) => ({
        outlet: t.outlet,
        chat_id: t.chat,
        sumber_rute: t.sumber_rute,
        jumlah: t.jumlah,
        preview: t.text
      })),
      push_penerima: pesan.length,
      push_contoh: pesan.slice(0, 3)
    });
  }

  // ---- Kirim Telegram ----
  const tgHasil = [];
  for (const t of tgTugas) {
    tgHasil.push({ outlet: t.outlet, chat_id: t.chat, sumber_rute: t.sumber_rute, ...(await sendTelegram(t.text, t.chat)) });
  }

  // ---- Kirim Push ----
  let terkirim = 0;
  const gagal: Array<Record<string, unknown>> = [];
  for (const m of pesan) {
    const payload = JSON.stringify({ title: m.title, body: m.body, url: './index.html', tag: `reservation-digest-${tanggal}` });
    for (const sub of subsByUser.get(m.userId) ?? []) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } }, payload);
        terkirim++;
      } catch (err) {
        const e = err as { statusCode?: number; body?: string; message?: string };
        if (e?.statusCode === 404 || e?.statusCode === 410) {
          await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        }
        gagal.push({ user_id: m.userId, statusCode: e?.statusCode, detail: e?.body ?? e?.message });
      }
    }
  }

  // Penanda dedupe hanya kalau memang ada yang berhasil terkirim.
  const adaBerhasil = terkirim > 0 || tgHasil.some((t) => t.ok);
  // `upsert` dengan `ignoreDuplicates`, bukan `insert`: saat dikirim paksa dari
  // Admin Portal, barisnya sudah ada — dan `insert` akan melanggar unique
  // (kind, ref) lalu melempar SESUDAH pesannya terkirim. Yang dilihat orangnya:
  // pesan masuk ke grup, layar bilang gagal.
  if (adaBerhasil) {
    await admin
      .from('telegram_notifications_sent')
      .upsert({ kind: 'reservation_digest', ref: refDedupe }, { onConflict: 'kind,ref', ignoreDuplicates: true });
  }

  return json({
    ok: adaBerhasil,
    tanggal,
    dikirim_paksa: paksa && sudahTerkirim,
    total_reservasi: daftarReservasi.length,
    telegram: tgHasil,
    push: { penerima: pesan.length, terkirim, gagal: gagal.length, detail_gagal: gagal.slice(0, 10) }
  });
});
