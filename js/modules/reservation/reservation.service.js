import { supabase } from '../../config/supabase-client.js';
import { compressImage } from '../../core/image-compress.js';

export const RES_STATUS = {
  pending: 'Menunggu',
  confirmed: 'Dikonfirmasi',
  checked_in: 'Check-in',
  checked_out: 'Check-out',
  done: 'Selesai',
  no_show: 'Tidak datang',
  cancelled: 'Dibatalkan',
  rejected: 'Ditolak'
};
export const RES_BADGE = {
  pending: 'badge-pending',
  confirmed: 'badge-approved',
  checked_in: 'badge-approved',
  checked_out: 'badge-cancelled',
  done: 'badge-approved',
  no_show: 'badge-rejected',
  cancelled: 'badge-cancelled',
  rejected: 'badge-rejected'
};
export const RES_STATUS_OPTIONS = Object.entries(RES_STATUS).map(([value, label]) => ({ value, label }));

/**
 * Status yang masuk akal per mode. Hotel tidak mengenal "Selesai" (diganti
 * Check-out) dan tidak mengenal "Menunggu"/"Ditolak" — booking hotel diisi
 * langsung oleh admin, tanpa antrean persetujuan.
 */
export const RES_STATUS_OPTIONS_HOTEL = ['confirmed', 'checked_in', 'checked_out', 'no_show', 'cancelled'].map((v) => ({
  value: v,
  label: RES_STATUS[v]
}));

/** Status yang masih MEMAKAN kuota kamar (harus sama dengan trigger cek_kuota_kamar di 0055). */
export const STATUS_MENAHAN_KAMAR = ['pending', 'confirmed', 'checked_in'];

export const SOURCE_LABEL = { staff: 'Staff App', web: 'Website' };

// ---- Pengaturan per outlet ----

export async function getReservationSettings(outletId) {
  const { data, error } = await supabase.from('reservation_settings').select('*').eq('outlet_id', outletId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertReservationSettings(outletId, businessUnitId, patch) {
  // `.select()` di sini bukan basa-basi: kalau barisnya SUDAH ADA, upsert
  // berubah jadi UPDATE — dan UPDATE yang ditolak RLS membalas sukses dengan 0
  // baris, bukan error. Admin akan melihat "tersimpan" untuk pengaturan yang
  // tidak berubah sedikit pun, lalu bertanya-tanya kenapa jam bukanya tidak
  // pernah ikut.
  const { data, error } = await supabase
    .from('reservation_settings')
    .upsert({ outlet_id: outletId, business_unit_id: businessUnitId, ...patch, updated_at: new Date().toISOString() })
    .select('outlet_id');
  if (error) throw error;
  if (!data?.length) throw new Error('Tidak tersimpan — kamu bukan admin outlet ini.');
}

// ---- Master area ----

export async function listReservationAreas(outletId, onlyActive = true) {
  let q = supabase.from('reservation_areas').select('id, name, is_active').eq('outlet_id', outletId).order('name');
  if (onlyActive) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function createReservationArea({ outletId, businessUnitId, name }) {
  const { error } = await supabase.from('reservation_areas').insert({ outlet_id: outletId, business_unit_id: businessUnitId, name: name.trim() });
  if (error) throw error;
}

export async function updateReservationArea(id, { name, is_active }) {
  const { data, error } = await supabase
    .from('reservation_areas')
    .update({ name: name?.trim(), is_active })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Tidak tersimpan — kamu bukan admin outlet area ini.');
}

export async function deleteReservationArea(id) {
  const { data, error } = await supabase.from('reservation_areas').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Tidak terhapus — kamu bukan admin outlet area ini.');
}

// ---- Ketersediaan slot ----

/**
 * Slot beserta sisa kuotanya untuk satu tanggal.
 * Aturannya (jam buka, panjang slot, kuota, lead time) dihitung di database
 * lewat RPC, supaya Staff App dan halaman publik memakai SATU sumber aturan.
 */
export async function getAvailability(outletId, date) {
  const { data, error } = await supabase.rpc('reservation_availability', { p_outlet: outletId, p_date: date });
  if (error) throw error;
  return data ?? [];
}

/**
 * Apakah tanggal ini masih boleh dipesan lewat website, beserta alasannya (0080).
 *
 * Alasannya ikut dibawa, bukan cuma boolean. Halaman yang hanya tahu "tidak
 * boleh" akan menampilkan daftar jam kosong — dan tamu menyimpulkan tempatnya
 * penuh lalu pergi, padahal yang perlu dia ubah cuma tanggalnya.
 *
 * Gagal = dianggap BOLEH. Fungsi ini keterangan, bukan penjaga: yang menolak
 * tetap `reservation_availability` dan Edge Function `submit-reservation`.
 * Menutup form hanya karena keterangannya tidak terbaca akan menolak tamu yang
 * sebenarnya boleh memesan.
 */
export async function getInfoTanggal(outletId, date) {
  if (!outletId || !date) return { boleh: true, alasan: null };
  const { data, error } = await supabase.rpc('reservation_info_tanggal', { p_outlet: outletId, p_date: date });
  if (error) {
    console.warn('[reservasi] info tanggal tidak terbaca:', error.message);
    return { boleh: true, alasan: null };
  }
  const baris = Array.isArray(data) ? data[0] : data;
  return { boleh: baris?.boleh !== false, alasan: baris?.alasan ?? null, batas: baris?.batas ?? null };
}

/**
 * Syarat & Ketentuan outlet. Dikembalikan apa adanya (teks bebas).
 *
 * Gagal = string kosong, bukan lempar error: S&K itu pelengkap, dan reservasi
 * tidak boleh batal hanya karena teksnya tidak terbaca.
 */
export async function getReservationTerms(outletId) {
  if (!outletId) return '';
  const { data, error } = await supabase
    .from('reservation_settings')
    .select('terms')
    .eq('outlet_id', outletId)
    .maybeSingle();
  if (error) {
    console.warn('[reservasi] S&K tidak terbaca:', error.message);
    return '';
  }
  return data?.terms ?? '';
}

export async function saveReservationTerms(outletId, terms) {
  const { data, error } = await supabase
    .from('reservation_settings')
    .update({ terms: terms?.trim() || null })
    .eq('outlet_id', outletId)
    .select('outlet_id');
  if (error) throw error;
  if (!data?.length) throw new Error('Tidak tersimpan — pengaturan reservasi outlet ini belum dibuat, atau kamu tidak punya izin.');
}

// ---- Reservasi ----

export async function createReservation({ outletId, name, phone, date, time, pax, areaId, email, notes, referral, termsAccepted = false }) {
  const { data, error } = await supabase.rpc('create_reservation', {
    p_outlet: outletId,
    p_name: name,
    p_phone: phone,
    p_date: date,
    p_time: time,
    p_pax: pax,
    p_area: areaId || null,
    p_email: email || null,
    p_notes: notes || null,
    p_referral: referral || null,
    p_terms_accepted: !!termsAccepted
  });
  if (error) throw error;
  return data;
}

// =========================================================
// MODE HOTEL
// =========================================================

/** Mode reservasi sebuah outlet: 'cafe' | 'hotel'. */
export function modeOutlet(outlet) {
  return outlet?.reservation_mode === 'hotel' ? 'hotel' : 'cafe';
}

// ---- Master tipe kamar ----

export async function listRoomTypes(outletId, onlyActive = true) {
  let q = supabase
    .from('room_types')
    .select('id, name, qty, capacity, notes, sort_order, is_active')
    .eq('outlet_id', outletId)
    .order('sort_order')
    .order('name');
  if (onlyActive) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function saveRoomType({ id, outletId, name, qty, capacity, notes, sort_order, is_active }) {
  const baris = {
    outlet_id: outletId,
    name: String(name ?? '').trim(),
    qty: Number(qty) || 1,
    capacity: capacity ? Number(capacity) : null,
    notes: notes?.trim() || null,
    sort_order: Number(sort_order) || 0,
    is_active: is_active !== false
  };
  if (id) {
    const { data, error } = await supabase.from('room_types').update(baris).eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('Tidak bisa mengubah tipe kamar ini — kamu bukan admin outletnya.');
    return;
  }
  const { error } = await supabase.from('room_types').insert(baris);
  if (error) throw error;
}

export async function deleteRoomType(id) {
  const { data, error } = await supabase.from('room_types').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Tidak bisa menghapus tipe kamar ini — kamu bukan admin outletnya.');
}

/**
 * Sisa unit tiap tipe kamar untuk sebuah rentang tanggal.
 *
 * Dipakai untuk menampilkan ketersediaan SEBELUM admin menekan Simpan. Trigger
 * `cek_kuota_kamar` di database tetap jadi penentu akhir — fungsi ini hanya
 * supaya penolakannya tidak jadi kejutan. Aturan yang dijaga di dua tempat
 * seperti ini harus dijaga tetap sama; kalau berbeda, yang menang selalu
 * database, dan gejalanya adalah "kelihatan tersedia tapi ditolak".
 */
export async function getRoomAvailability(outletId, checkIn, checkOut) {
  const { data, error } = await supabase.rpc('room_availability', {
    p_outlet: outletId,
    p_check_in: checkIn,
    p_check_out: checkOut
  });
  if (error) throw error;
  return data ?? [];
}

/** Jumlah malam antara dua tanggal (check-out tidak dihitung sebagai malam). */
export function jumlahMalam(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 0;
  const a = new Date(checkIn + 'T00:00:00');
  const b = new Date(checkOut + 'T00:00:00');
  return Math.max(0, Math.round((b - a) / 86400000));
}

/**
 * Buat booking hotel. Langsung berstatus `confirmed` — mode hotel tidak punya
 * antrean persetujuan; yang mengisi adalah admin sendiri lewat Admin Portal.
 *
 * Insert biasa, bukan RPC: seluruh aturan kritisnya (kuota, minimal semalam,
 * tanggal acuan) sudah dijaga trigger di database, jadi tidak ada perhitungan
 * yang perlu diamankan di lapisan aplikasi.
 */
export async function createHotelBooking({
  outletId,
  businessUnitId,
  name,
  phone,
  email,
  roomTypeId,
  checkIn,
  checkOut,
  adults,
  children,
  roomNo,
  notes,
  referral
}) {
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('reservations')
    .insert({
      mode: 'hotel',
      business_unit_id: businessUnitId,
      outlet_id: outletId,
      customer_name: String(name ?? '').trim(),
      phone: String(phone ?? '').trim(),
      email: email?.trim() || null,
      room_type_id: roomTypeId,
      check_in: checkIn,
      check_out: checkOut,
      reserve_date: checkIn, // trigger juga mengisinya; ditulis di sini agar NOT NULL terpenuhi
      adults: Number(adults) || 1,
      children: Number(children) || 0,
      room_no: roomNo?.trim() || null,
      notes: notes?.trim() || null,
      referral_source: referral?.trim() || null,
      source: 'staff',
      status: 'confirmed',
      created_by: user?.id ?? null
    })
    .select('id, code')
    .single();

  if (error) throw error;
  return data;
}

export async function updateHotelBooking(id, patch) {
  const { data, error } = await supabase.from('reservations').update(patch).eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Tidak bisa mengubah booking ini — kamu bukan admin outletnya.');
}

/** Check-in dari Admin Portal: catat waktunya + nomor kamar yang diberikan. */
export async function checkInBooking(id, roomNo) {
  return updateHotelBooking(id, {
    status: 'checked_in',
    room_no: roomNo?.trim() || null,
    checked_in_at: new Date().toISOString()
  });
}

/**
 * Check-in dari Staff App — lewat RPC, bukan update langsung.
 *
 * RLS bekerja per BARIS, bukan per KOLOM: sekali staff diizinkan meng-update
 * baris booking, dia juga bisa mengubah tanggal menginap, tipe kamar, nama
 * tamu, bahkan membatalkannya. RPC `staff_check_in_booking` hanya bisa
 * melakukan satu hal — memindahkan confirmed -> checked_in dan mengisi nomor
 * kamar — karena memang tidak ada kolom lain yang ditulis di dalamnya.
 *
 * Menekan dua kali TIDAK menghasilkan error: RPC-nya mengembalikan keadaan apa
 * adanya kalau tamunya memang sudah check-in.
 */
export async function staffCheckIn(id, roomNo) {
  const { data, error } = await supabase.rpc('staff_check_in_booking', {
    p_reservation: id,
    p_room_no: roomNo?.trim() || null
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function checkOutBooking(id) {
  return updateHotelBooking(id, { status: 'checked_out', checked_out_at: new Date().toISOString() });
}

/**
 * Batalkan booking — kamarnya langsung bebas untuk tanggal itu.
 *
 * DIBEDAKAN dari Hapus dengan sengaja. Membatalkan menyimpan jejaknya: siapa
 * batal, kapan, dan alasannya masih bisa dibaca di riwayat dan ikut di laporan.
 * Menghapus membuang barisnya sama sekali — dan pertanyaan "kenapa kamar itu
 * kosong tanggal segitu" jadi tidak punya jawaban.
 */
export async function cancelHotelBooking(id, alasan) {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  return updateHotelBooking(id, {
    status: 'cancelled',
    review_note: alasan?.trim() || null,
    reviewed_by: user?.id ?? null,
    reviewed_at: new Date().toISOString()
  });
}

/**
 * Hapus booking permanen.
 *
 * `.select()` wajib: RLS `reservations_delete_admin` membatasi ke admin outlet,
 * dan PostgREST membalas SUKSES dengan 0 baris kalau ditolak — tanpa
 * pemeriksaan ini admin outlet lain menekan Hapus, melihat "terhapus", lalu
 * bookingnya masih ada.
 */
export async function deleteReservation(id) {
  const { data, error } = await supabase.from('reservations').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Tidak bisa menghapus booking ini — kamu bukan admin outletnya.');
}

/**
 * Koreksi / reschedule reservasi (0078).
 *
 * Lewat RPC, bukan UPDATE langsung, karena mengubah tanggal/jam/pax berarti
 * kuota harus dihitung ulang. UPDATE biasa akan memindahkan rombongan 30 orang
 * ke slot yang sudah penuh tanpa satu pun penolakan.
 *
 * `undefined` berarti "jangan diubah" — dikirim sebagai null ke RPC, yang
 * memaknainya sama.
 */
export async function updateReservation({ id, name, phone, email, date, time, pax, areaId, notes, deposit, depositProof }) {
  const { data, error } = await supabase.rpc('update_reservation', {
    p_id: id,
    p_name: name ?? null,
    p_phone: phone ?? null,
    p_email: email ?? null,
    p_date: date ?? null,
    p_time: time ?? null,
    p_pax: pax ?? null,
    p_area: areaId ?? null,
    p_notes: notes ?? null,
    p_deposit: deposit ?? null,
    p_deposit_proof: depositProof ?? null
  });
  if (error) throw error;
  return data;
}

/**
 * Catat DP dari Staff App (0079).
 *
 * Dipisah dari `createReservation` karena path fotonya memuat ID reservasi —
 * fotonya baru bisa diunggah setelah barisnya ada. Nominal dan path dikirim
 * dalam SATU panggilan supaya "DP tercatat" berarti satu hal saja, bukan
 * setengah nominal setengah bukti.
 *
 * Staff hanya boleh mengisi DP yang masih kosong di reservasi buatannya
 * sendiri; database yang menegakkannya, bukan tampilan ini.
 */
export async function catatDpReservasi({ id, deposit, depositProof }) {
  const { data, error } = await supabase.rpc('catat_dp_reservasi', {
    p_id: id,
    p_deposit: deposit ?? null,
    p_proof: depositProof ?? null
  });
  if (error) throw error;
  return data;
}

/**
 * Unggah bukti transfer DP. Path: {outlet_id}/{reservation_id}.{ext}
 *
 * Path diawali outlet_id karena policy Storage-nya berbasis PREFIX — pelajaran
 * dari 0050: izin yang bergantung pada kolom tabel yang baru diisi setelah
 * unggahan membuat file baru tidak bisa dibaca pengunggahnya sendiri.
 */
export async function uploadDepositProof({ outletId, reservationId, file }) {
  const kecil = await compressImage(file, { preset: 'bukti' });
  const ext = kecil.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${outletId}/${reservationId}.${ext}`;
  const { error } = await supabase.storage
    .from('reservation-proofs')
    .upload(path, kecil, { upsert: true, contentType: kecil.type || 'image/jpeg' });
  if (error) throw error;
  return path;
}

export async function getDepositProofUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from('reservation-proofs').createSignedUrl(path, 600);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/** Riwayat reservasi — dipakai Staff App maupun Admin Portal, kedua mode. */
export async function listReservations({ businessUnitId, outletId, status, dateFrom, dateTo, mode, limit = 300 }) {
  let q = supabase
    .from('reservations')
    .select(
      'id, code, outlet_id, mode, customer_name, phone, email, reserve_date, reserve_time, pax, check_in, check_out, adults, children, room_no, room_type_id, checked_in_at, checked_out_at, notes, referral_source, source, status, review_note, reviewed_at, created_at, created_by, deposit_amount, deposit_proof_path, deposit_at, terms_accepted_at, room_types(name), reservation_areas(name), outlets!outlet_id(name)'
    )
    .eq('business_unit_id', businessUnitId)
    .order('reserve_date', { ascending: false })
    .order('reserve_time', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (outletId) q = q.eq('outlet_id', outletId);
  if (status) q = q.eq('status', status);
  if (mode) q = q.eq('mode', mode);
  if (dateFrom) q = q.gte('reserve_date', dateFrom);
  if (dateTo) q = q.lte('reserve_date', dateTo);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/**
 * Tiga daftar harian resepsionis untuk satu tanggal.
 *
 * Dipisah begini, bukan satu daftar yang difilter di UI, karena pertanyaan
 * hariannya memang tiga hal berbeda: siapa datang, siapa keluar, siapa masih
 * di dalam. Rentangnya sengaja lebar (semua booking yang menyentuh tanggal itu)
 * lalu dipilah — satu query, bukan tiga.
 */
export async function getHotelHarian({ businessUnitId, outletId, date }) {
  let q = supabase
    // baris-terbatas: reservasi yang menyentuh SATU tanggal, dan hanya yang
    // belum check-out — batas atasnya jumlah kamar, bukan riwayat.
    .from('reservations')
    .select(
      'id, code, outlet_id, customer_name, phone, check_in, check_out, adults, children, room_no, status, notes, checked_in_at, room_types(name), outlets!outlet_id(name), penanda:user_profiles!checked_in_by(full_name)'
    )
    .eq('business_unit_id', businessUnitId)
    .eq('mode', 'hotel')
    .lte('check_in', date)
    .gte('check_out', date)
    // `checked_out` IKUT dikecualikan: begitu tamu benar-benar keluar, kamarnya
    // sudah bebas dan namanya tidak lagi menjawab pertanyaan operasional apa pun.
    // Sebelumnya tamu yang sudah check-out tetap nongkrong di daftar sampai
    // ganti hari — terlihat seperti masih ada padahal sudah pulang.
    // Booking yang tanggal check-out-nya sudah LEWAT hilang sendiri lewat
    // filter `check_out >= date` di atas.
    .not('status', 'in', '("cancelled","rejected","no_show","checked_out")')
    .order('check_in');
  if (outletId) q = q.eq('outlet_id', outletId);
  const { data, error } = await q;
  if (error) throw error;

  const rows = data ?? [];
  return {
    datang: rows.filter((r) => r.check_in === date),
    keluar: rows.filter((r) => r.check_out === date),
    // "Menginap" = sedang di dalam pada tanggal itu; tanggal check-out tidak
    // dihitung sebagai malam menginap, sesuai rentang [check_in, check_out).
    menginap: rows.filter((r) => r.check_in < date && r.check_out > date)
  };
}

/**
 * Ubah status reservasi (setujui / tolak / selesai / tidak datang).
 *
 * `.select()` WAJIB. Daftar "Perlu Diproses" berisi seluruh reservasi di BU,
 * sementara yang boleh mengubahnya hanya admin outlet yang bersangkutan —
 * dan PostgREST TIDAK menganggap penolakan RLS sebagai error: ia membalas
 * SUKSES dengan 0 baris.
 *
 * Tanpa pemeriksaan ini, admin outlet Serpong menekan "Setujui" pada reservasi
 * Sentul, melihat notifikasi hijau, lalu barisnya hilang dari daftarnya sendiri
 * saat dimuat ulang — padahal di database statusnya masih *Menunggu*. Tamunya
 * menunggu konfirmasi yang tidak akan pernah datang, dan tidak ada satu pun
 * jejak yang menunjukkan ada yang salah.
 */
export async function setReservationStatus(id, status, reviewNote) {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('reservations')
    .update({
      status,
      review_note: reviewNote?.trim() || null,
      reviewed_by: user?.id ?? null,
      reviewed_at: new Date().toISOString()
    })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data?.length) {
    throw new Error('Tidak tersimpan — kamu bukan admin outlet reservasi ini. Minta admin outlet tersebut yang memprosesnya.');
  }
}

// ---- Teks WhatsApp ----

const fmtTanggal = (d) =>
  new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

/** Pesan konfirmasi booking hotel. */
export function buildHotelConfirmMessage(r) {
  const malam = jumlahMalam(r.check_in, r.check_out);
  return [
    `Halo ${r.customer_name}, booking Anda *DIKONFIRMASI* ✅`,
    '',
    `No. Booking   : ${r.code ?? '-'}`,
    `Hotel         : ${r.outlets?.name ?? '-'}`,
    `Tipe kamar    : ${r.room_types?.name ?? '-'}`,
    `Check-in      : ${fmtTanggal(r.check_in)}`,
    `Check-out     : ${fmtTanggal(r.check_out)}`,
    `Lama menginap : ${malam} malam`,
    `Tamu          : ${r.adults ?? 1} dewasa${r.children ? ` + ${r.children} anak` : ''}`,
    r.room_no ? `No. kamar     : ${r.room_no}` : '',
    r.notes ? `Catatan       : ${r.notes}` : '',
    '',
    'Sampai jumpa di hari kedatangan Anda. Terima kasih 🙏'
  ]
    .filter(Boolean)
    .join('\n');
}

/** Pesan konfirmasi untuk customer — dikirim manual lewat wa.me (tanpa API). */
export function buildConfirmMessage(r) {
  if (r.mode === 'hotel') return buildHotelConfirmMessage(r);
  return [
    `Halo ${r.customer_name}, reservasi Anda *DIKONFIRMASI* ✅`,
    '',
    `No. Reservasi : ${r.code ?? '-'}`,
    `Outlet        : ${r.outlets?.name ?? '-'}`,
    `Tanggal       : ${fmtTanggal(r.reserve_date)}`,
    `Jam           : ${String(r.reserve_time).slice(0, 5)}`,
    `Jumlah tamu   : ${r.pax} orang`,
    r.reservation_areas?.name ? `Area          : ${r.reservation_areas.name}` : '',
    r.notes ? `Catatan       : ${r.notes}` : '',
    '',
    'Mohon datang tepat waktu. Kursi kami tahan 15 menit dari jam reservasi.',
    // S&K ditaruh SETELAH detail reservasi, bukan sebelumnya.
    //
    // Yang pertama dicari orang saat membuka pesan konfirmasi adalah tanggal
    // dan jamnya. Menaruh dua puluh baris ketentuan di atasnya membuat
    // informasi terpenting terdorong ke bawah lipatan WhatsApp — dan yang
    // terjadi berikutnya adalah tamu bertanya "jadi jam berapa ya?" lewat
    // pesan susulan.
    r.terms ? `\n———\n${String(r.terms).trim()}` : '',
    '',
    'Terima kasih 🙏'
  ]
    .filter(Boolean)
    .join('\n');
}

/** Pesan penolakan / permintaan reschedule. */
export function buildRejectMessage(r, alasan) {
  return [
    `Halo ${r.customer_name}, mohon maaf reservasi Anda pada ${fmtTanggal(r.reserve_date)} pukul ${String(r.reserve_time).slice(0, 5)} belum dapat kami terima.`,
    alasan ? `\nAlasan: ${alasan}` : '',
    '\nBoleh kami bantu carikan jam atau tanggal lain? Silakan balas pesan ini. Terima kasih 🙏'
  ]
    .filter(Boolean)
    .join('\n');
}

/** 08xx / +62xx / 62xx -> 62xxxxxxxxx untuk tautan wa.me. */
export function waNumber(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.startsWith('62')) return digits;
  if (digits.startsWith('0')) return '62' + digits.slice(1);
  return digits;
}
