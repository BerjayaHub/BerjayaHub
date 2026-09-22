import { supabase } from '../../config/supabase-client.js';
import { argumenRpc } from '../../core/rpc-args.js';
import { compressImage } from '../../core/image-compress.js';
import { ambilSemua } from '../../core/ambil-semua.js';

export const ENTRY_LABEL = {
  move_out: 'Pindah keluar',
  move_in: 'Pindah masuk',
  in: 'Kas Masuk',
  out: 'Kas Keluar',
  transfer_out: 'Transfer Keluar',
  transfer_in: 'Transfer Masuk'
};

export function todayWIB() {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 3600000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${wib.getUTCFullYear()}-${pad(wib.getUTCMonth() + 1)}-${pad(wib.getUTCDate())}`;
}

async function currentUserId() {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// ---- Kategori (global sejak 0040 — kas ikut user, bukan BU) ----

export async function listCashCategories(onlyActive = true) {
  let q = supabase.from('cash_categories').select('id, name, direction, is_active').order('name');
  if (onlyActive) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function createCashCategory({ name, direction }) {
  const { error } = await supabase.from('cash_categories').insert({ business_unit_id: null, name, direction: direction || 'both' });
  if (error) throw error;
}
export async function updateCashCategory(id, { name, direction, is_active }) {
  const { error } = await supabase.from('cash_categories').update({ name, direction, is_active }).eq('id', id);
  if (error) throw error;
}
export async function deleteCashCategory(id) {
  const { error } = await supabase.from('cash_categories').delete().eq('id', id);
  if (error) throw error;
}

// ---- Entri kas ----

/**
 * Catat kas masuk/keluar. TIDAK menyimpan BU/outlet — sejak 0040 kas melekat
 * pada USER, jadi saldonya sama di BU/outlet mana pun dia login.
 */
export async function recordCashEntry({ type, amount, categoryId, outletId, accountId, notes, date, qty, unit, file, supplier }) {
  const uid = await currentUserId();
  if (!uid) throw new Error('Sesi tidak ditemukan, silakan login ulang.');

  // Aturan berbeda per arah, sesuai keputusan:
  //   KELUAR — nota WAJIB (ada bukti fisiknya) dan outlet peruntukan WAJIB
  //            ("uang ini dibelanjakan untuk outlet mana").
  //   MASUK  — nota opsional; uang masuk sering berupa setoran/owner yang tidak
  //            selalu ada notanya, dan belum tentu diperuntukkan satu outlet.
  if (type === 'out') {
    if (!file) throw new Error('Foto nota wajib dilampirkan untuk kas keluar.');
    if (!outletId) throw new Error('Pilih outlet peruntukan untuk kas keluar.');
  }

  const signed = type === 'out' ? -Math.abs(amount) : Math.abs(amount);
  const id = crypto.randomUUID();
  let path = null;

  // Kalau ada foto, diunggah LEBIH DULU lalu barisnya menyusul dengan
  // `proof_path` sudah terisi. Urutan ini yang membuat constraint "nota wajib"
  // bisa ditegakkan database — kalau barisnya dibuat dulu lalu path diisi lewat
  // UPDATE, baris tanpa nota sempat masuk dan UPDATE yang gagal tidak
  // menghasilkan error apa pun.
  if (file) {
    const kecil = await compressImage(file, { preset: 'bukti' });
    const ext = (kecil.name?.split('.').pop() || 'jpg').toLowerCase();
    path = `${uid}/${id}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('cash-proofs')
      .upload(path, kecil, { upsert: true, contentType: kecil.type || 'image/jpeg' });
    if (upErr) throw upErr;
  }

  const { data, error } = await supabase
    .from('cash_entries')
    .insert({
      id,
      holder_id: uid,
      account_id: accountId || null,
      entry_type: type,
      amount: signed,
      category_id: categoryId || null,
      outlet_id: type === 'out' ? outletId : null,
      notes: notes || null,
      qty: qty === '' || qty == null ? null : Number(qty),
      unit: unit?.trim() || null,
      proof_path: path,
      // Payment To di berkas ESB Disbursement (0149). Hanya kas KELUAR yang
      // pernah jadi Disbursement, jadi kas masuk tidak pernah mengisinya.
      supplier: type === 'out' ? supplier?.trim() || null : null,
      entry_date: date || todayWIB(),
      created_by: uid
    })
    .select()
    .single();

  if (error) {
    if (path) await supabase.storage.from('cash-proofs').remove([path]).catch(() => {});
    throw error;
  }
  return data;
}

/**
 * CATAT KAS KELUAR — satu jalur untuk ketiga sumber dana.
 *
 * ============ KENAPA BUKAN `recordCashEntry` ============
 *
 * Sejak 0153 kas keluar punya tiga kemungkinan sumber: kantong sendiri,
 * kantong outlet lain, dan Pusat. Yang kedua HARUS lewat `catat_kas_di` —
 * `.insert()` langsung akan menyimpan `holder_id = aku`, padahal uangnya
 * keluar dari kas orang lain.
 *
 * Menulisnya sebagai dua jalur (insert untuk kantong sendiri, RPC untuk yang
 * lain) berarti dua kumpulan penjaga yang cepat atau lambat berbeda — dan
 * bedanya baru terlihat sebagai entri yang lolos lewat jalur yang lebih
 * longgar. Satu jalur, dan penjaganya seluruhnya di server.
 *
 * Fotonya diunggah LEBIH DULU, sama dengan `recordCashEntry`: `catat_kas_di`
 * menolak kas keluar tanpa bukti, jadi path-nya harus sudah ada saat RPC-nya
 * dipanggil. Kalau RPC-nya gagal, fotonya dibuang lagi — berkas yatim di
 * Storage tidak pernah ditemukan siapa pun dan tidak pernah dihapus.
 */
export async function catatKasKeluar({
  accountId,
  dibayarPusat = false,
  amount,
  categoryId,
  outletId,
  notes,
  date,
  qty,
  unit,
  file,
  supplier
}) {
  const uid = await currentUserId();
  if (!uid) throw new Error('Sesi tidak ditemukan, silakan login ulang.');
  if (!file) throw new Error('Foto nota wajib dilampirkan untuk kas keluar.');
  if (!outletId) throw new Error('Pilih outlet peruntukan untuk kas keluar.');

  const kecil = await compressImage(file, { preset: 'bukti' });
  const ext = (kecil.name?.split('.').pop() || 'jpg').toLowerCase();
  // Nama berkasnya uuid acak, BUKAN id entrinya: `catat_kas_di` yang membuat
  // barisnya, jadi id-nya belum ada saat fotonya diunggah. Prefix `uid` tetap
  // dipakai supaya kebijakan Storage-nya sama dengan jalur lama.
  const path = `${uid}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from('cash-proofs')
    .upload(path, kecil, { upsert: true, contentType: kecil.type || 'image/jpeg' });
  if (upErr) throw upErr;

  try {
    return await catatKasDi({
      accountId: accountId || null,
      dibayarPusat,
      type: 'out',
      amount,
      categoryId,
      outletId,
      notes,
      proofPath: path,
      date,
      qty,
      unit,
      supplier
    });
  } catch (e) {
    await supabase.storage.from('cash-proofs').remove([path]).catch(() => {});
    throw e;
  }
}

// ---- Kantong kas (sub-kas) ----

/** Kantong kas milik user yang login. Kosong = dia memakai kas tunggal. */
export async function listMyCashAccounts(onlyActive = true) {
  const uid = await currentUserId();
  if (!uid) return [];
  let q = supabase
    .from('cash_accounts')
    .select('id, name, sort_order, is_active, outlet_id, outlets!outlet_id(name)')
    .eq('holder_id', uid)
    .order('sort_order')
    .order('name');
  if (onlyActive) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/**
 * Kantong kas yang boleh KUBEBANI — punya sendiri, plus kantong outlet tempat
 * aku bertugas (0120).
 *
 * Dipakai layar yang mencatat pengeluaran atas nama orang lain, mis. nota
 * penerimaan. Daftarnya dibaca dari `cash_accounts` langsung; RLS-nya
 * mengizinkan membaca kantong milik siapa pun di outlet yang sama, dan
 * `boleh_membebani_kas()` di server yang memutuskan boleh-tidaknya menulis.
 */
export async function listKantongBisaKubebani(outletId = null) {
  // `outletId` TIDAK menyaring apa pun — lihat catatan di bawah. Ia dulu jadi
  // penjaga "belum pilih outlet, jangan tanya server dulu", dan sejak form Kas
  // Keluar memakai daftar ini SEBELUM outletnya dipilih, penjaga itu justru
  // membuat dropdown-nya kosong selamanya. Dibiarkan opsional.
  void outletId;
  const uid = await currentUserId();
  // SELURUH kantong yang RLS izinkan kubaca, bukan cuma kantong outlet ini.
  //
  // Versi pertama menyaring `outlet_id.eq.${outletId}` di klien — jadi staff
  // Sentul yang membeli es batu memakai kas Central Kitchen melihat "tidak ada
  // kas yang bisa kamu bebani", padahal sejak 0126 ia berhak.
  //
  // Yang memutuskan boleh-tidaknya sekarang cuma DUA hal, dan keduanya di
  // server: kebijakan baca `cash_accounts` (kantong ber-outlet terlihat oleh
  // se-BU) dan `boleh_membebani_kas()` saat menulis. Menyalin aturannya lagi ke
  // sini berarti dua sumber jawaban yang cepat atau lambat menyimpang — dan
  // penyimpangannya muncul sebagai pilihan yang hilang tanpa sebab.
  //
  // `holder_id.eq` tetap disebut supaya kantong PRIBADI milik sendiri (tanpa
  // outlet) ikut terbawa; kebijakan baca yang berbasis outlet tidak memuatnya.
  const { data, error } = await supabase
    .from('cash_accounts')
    .select('id, name, holder_id, outlet_id, user_profiles!holder_id(full_name), outlets!outlet_id(name)')
    .eq('is_active', true)
    .or(`holder_id.eq.${uid},outlet_id.not.is.null`)
    .order('name');
  if (error) throw error;
  return data ?? [];
}

/**
 * Catat entri kas pada kantong TERTENTU — boleh milik orang lain (0120).
 *
 * Lewat RPC, bukan `.insert()`: aturan siapa-boleh-membebani-apa, tanda
 * nominal, dan kewajiban outlet/bukti untuk kas keluar semuanya ada di server.
 * Menulis langsung ke tabel berarti menirukan keempatnya di klien.
 */
export async function catatKasDi({
  accountId,
  type,
  amount,
  categoryId,
  outletId,
  notes,
  proofPath,
  date,
  qty,
  unit,
  supplier,
  dibayarPusat = false
}) {
  // `argumenRpc` mengubah `undefined` jadi `null`, dan itu WAJIB di sini:
  // PostgREST memilih overload lewat HIMPUNAN NAMA ARGUMEN, dan `JSON.stringify`
  // membuang kunci ber-nilai `undefined`. Permintaan yang kehilangan
  // `p_supplier` akan memilih tanda tangan lama — yang sudah dibuang 0153,
  // jadi jawabannya 42883 dan bukan data yang diam-diam salah.
  const { data, error } = await supabase.rpc(
    'catat_kas_di',
    argumenRpc({
      p_account: accountId,
      p_type: type,
      p_amount: amount,
      p_category: categoryId ?? null,
      p_outlet: outletId ?? null,
      p_notes: notes ?? null,
      p_proof: proofPath ?? null,
      p_date: date ?? null,
      p_qty: qty ?? null,
      p_unit: unit ?? null,
      p_supplier: supplier ?? null,
      p_dibayar_pusat: !!dibayarPusat
    })
  );
  if (error) throw error;
  return data;
}

/** Berapa kantong yang boleh dia punya (diatur admin). 1 = kas tunggal. */
export async function getMyCashAccountLimit() {
  const uid = await currentUserId();
  if (!uid) return 1;
  const { data, error } = await supabase.from('user_profiles').select('cash_account_limit').eq('id', uid).maybeSingle();
  if (error) return 1;
  return Number(data?.cash_account_limit ?? 1);
}

export async function saveCashAccount({ id, name, sort_order, is_active, outletId }) {
  const uid = await currentUserId();
  if (!uid) throw new Error('Sesi tidak ditemukan.');
  const baris = {
    holder_id: uid,
    name: String(name ?? '').trim(),
    sort_order: Number(sort_order) || 0,
    is_active: is_active !== false,
    // `undefined` berarti "jangan sentuh"; string kosong berarti "lepaskan
    // outletnya". Dibedakan karena mengganti NAMA kantong tidak boleh
    // diam-diam mencabut izin staff outlet untuk membebaninya — bug yang
    // bentuknya persis sama dengan "+ Foto menghapus supplier" (0119).
    ...(outletId === undefined ? {} : { outlet_id: outletId || null })
  };
  if (id) {
    const { data, error } = await supabase.from('cash_accounts').update(baris).eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('Kantong kas ini bukan milikmu.');
    return;
  }
  const { error } = await supabase.from('cash_accounts').insert(baris);
  if (error) throw error;
}

/**
 * Semua kantong kas di organisasi, untuk layar admin (0121).
 *
 * Termasuk baris semu **Kas Utama** (`id` null, `kantong_nyata` false) untuk
 * uang yang tidak berada di kantong mana pun — itulah tempat kas pemegang
 * berjatah 1 sebenarnya berada. Tanpa baris itu, daftarnya terlihat lengkap
 * sementara sebagian besar uangnya justru tidak ada di dalamnya.
 *
 * Super admin saja; RPC-nya mengembalikan kosong untuk yang lain.
 */
export async function daftarKantongKas() {
  const { data, error } = await supabase.rpc('daftar_kantong_kas');
  if (error) throw error;
  return data ?? [];
}

/**
 * Buat/ubah kantong kas milik pemegang mana pun (0121, super admin).
 *
 * **TULIS PENUH.** RPC-nya sengaja tidak punya satu pun parameter dengan
 * default, jadi tidak ada nilai yang berarti "jangan sentuh". Pemanggil wajib
 * membawa keadaan LENGKAP kantongnya — kalau tidak, field yang tak disebut
 * akan terhapus, dan itu bug 0119 ("+ Foto menghapus supplier") lagi.
 */
export async function aturKantongKas({ id, holderId, name, outletId, isActive }) {
  const { data, error } = await supabase.rpc('atur_kantong_kas', {
    p_id: id ?? null,
    p_holder: holderId ?? null,
    p_name: name,
    p_outlet: outletId || null,
    p_aktif: isActive !== false
  });
  if (error) throw error;
  return data;
}

/**
 * Hapus kantong kas — isinya dipindahkan lebih dulu (migration 0066).
 *
 * `targetAccountId` null berarti **Kas Utama** (`account_id` NULL), yaitu tempat
 * uang berada sebelum kantong mana pun dibuat. Saldo total tidak berubah.
 *
 * @returns {Promise<number>} jumlah transaksi yang ikut berpindah
 */
export async function hapusKantongKas(id, targetAccountId = null) {
  const { data, error } = await supabase.rpc('hapus_kantong_kas', {
    p_account: id,
    p_target: targetAccountId || null
  });
  if (error) throw error;
  return Number(data) || 0;
}

/** Saldo per kantong milik user yang login. */
export async function listMyCashAccountBalances() {
  const uid = await currentUserId();
  if (!uid) return [];
  const { data, error } = await supabase
    .from('cash_account_balances')
    .select('account_id, account_name, sort_order, balance')
    .eq('holder_id', uid)
    .order('sort_order');
  if (error) throw error;
  return data ?? [];
}

/** Pindahkan saldo antar kantong SENDIRI. Total saldo tidak berubah. */
export async function pindahKas({ fromAccountId, toAccountId, amount, notes }) {
  const { error } = await supabase.rpc('pindah_kas', {
    p_from: fromAccountId || null,
    p_to: toAccountId || null,
    p_amount: amount,
    p_notes: notes || null
  });
  if (error) throw error;
}

/** Transfer kas ke user lain — boleh lintas BU (kas ikut user). */
export async function transferCash({ toUserId, amount, notes }) {
  const { error } = await supabase.rpc('transfer_cash', {
    p_to_user: toUserId,
    p_amount: amount,
    p_notes: notes || null
  });
  if (error) throw error;
}

/** Saldo kas milikku — satu angka, tidak tergantung BU/outlet yang aktif. */
export async function getMyCashBalance() {
  const uid = await currentUserId();
  if (!uid) return 0;
  const { data, error } = await supabase.from('cash_balances').select('balance').eq('holder_id', uid).maybeSingle();
  if (error) throw error;
  return Number(data?.balance ?? 0);
}

/**
 * Riwayat kas milikku (0141).
 *
 * Lewat RPC, bukan `.from('cash_entries')` dengan embed — dan sebabnya bukan
 * kerapian:
 *
 * Kolom **Outlet** kosong untuk entri yang dicatat orang lain ke kantongku.
 * Risma (Serpong) membayar notanya dari "Kas Iis CK", jadi `outlet_id` entri itu
 * = Serpong. Embed `outlets!outlet_id(name)` tunduk pada `outlets_select`
 * (`has_outlet_scope`), dan Iis hanya bercakupan di Central Kitchen — PostgREST
 * tidak menolak permintaannya, ia mengembalikan `null` untuk embed-nya.
 * Hasilnya kolom kosong, tanpa error, untuk data yang lengkap.
 *
 * RPC-nya juga membawa jejak koreksi dan `alasan_tolak` per baris, supaya layar
 * tidak perlu menebak sendiri tombol mana yang boleh digambar.
 */
export async function riwayatKasSaya(limit = 50) {
  const { data, error } = await supabase.rpc('riwayat_kas_saya', { p_limit: limit });
  if (error) throw error;
  return data ?? [];
}

/**
 * Ubah entri kas. TULIS PENUH — semua field dikirim, tidak ada yang berarti
 * "jangan sentuh". Alasannya sama dengan `aturKantongKas`: field yang tidak
 * disebut akan terhapus, dan itu bug 0119 lagi.
 */
export async function ubahKas({ id, amount, categoryId, outletId, notes, qty, unit, date, supplier }) {
  // `argumenRpc` mengubah `undefined` jadi `null`, dan itu WAJIB di sini:
  // PostgREST memilih overload lewat HIMPUNAN NAMA ARGUMEN, dan
  // `JSON.stringify` membuang kunci bernilai `undefined`. Tanpa itu,
  // pemanggilan tanpa supplier akan mencari `ubah_kas` berargumen delapan —
  // yang sengaja sudah dibuang di 0149 — dan gagal dengan 42883.
  const { error } = await supabase.rpc(
    'ubah_kas',
    argumenRpc({
      p_entry: id,
      p_amount: amount,
      p_category: categoryId || null,
      p_outlet: outletId || null,
      p_notes: notes ?? '',
      p_qty: qty === '' || qty == null ? null : Number(qty),
      p_unit: unit?.trim() || null,
      p_date: date || null,
      p_supplier: supplier?.trim() || null
    })
  );
  if (error) throw error;
}

/**
 * Isi Payment To beberapa kas keluar sekaligus (0149).
 *
 * Tinggal DI SINI, bukan di `esb.service.js`, karena yang diubahnya data kas —
 * bukan data ESB. Wewenangnya pun dipinjam dari penjaga koreksi kas yang sudah
 * ada (`boleh_koreksi_kas`, 0141), bukan dari wewenang ekspor.
 *
 * @returns {Promise<number>} berapa entri yang benar-benar berubah
 */
export async function ubahSupplierKas(ids, supplier) {
  const { data, error } = await supabase.rpc(
    'ubah_supplier_kas',
    argumenRpc({ p_entries: ids, p_supplier: String(supplier ?? '') })
  );
  if (error) throw new Error(error.message ?? String(error));
  return Number(data) || 0;
}

/**
 * Coret entri kas — barisnya TETAP ADA, ditandai, dan berhenti menghitung saldo.
 *
 * Bukan `delete`. Yang diminta adalah jejak "dihapus oleh siapa", dan baris yang
 * benar-benar dibuang tidak bisa menyimpan keterangan apa pun tentang dirinya.
 */
export async function coretKas(id, alasan) {
  const { error } = await supabase.rpc('coret_kas', { p_entry: id, p_alasan: alasan ?? '' });
  if (error) throw error;
}

/**
 * Sebab penolakan koreksi untuk BANYAK entri sekaligus (layar admin).
 *
 * Gagal = Map kosong, bukan lempar: daftar mutasi tetap harus tampil. Yang
 * hilang cuma keterangan di tombolnya, dan servernya tetap menolak dengan
 * pesan yang benar kalau tombolnya ditekan.
 *
 * @returns {Promise<Map<string, string>>} entry_id -> alasan (yang boleh tidak masuk peta)
 */
export async function alasanTolakKoreksiKas(entryIds) {
  const ids = [...new Set((entryIds ?? []).filter(Boolean))];
  if (!ids.length) return new Map();
  const { data, error } = await supabase.rpc('alasan_tolak_koreksi_kas_banyak', { p_entries: ids });
  if (error) {
    console.warn('[kas] gagal membaca izin koreksi:', error.message);
    return new Map();
  }
  return new Map((data ?? []).filter((r) => r.alasan).map((r) => [r.entry_id, r.alasan]));
}

export async function listMyCashEntries(limit = 50) {
  const uid = await currentUserId();
  if (!uid) return [];
  const { data, error } = await supabase
    .from('cash_entries')
    // `penyesuaian_nota` IKUT DIAMBIL (0131). Entri koreksi menyebut notanya
    // di kolom itu dan TIDAK ditunjuk `payment_entry_id` mana pun — tanpa
    // kolom ini, baris "Penyesuaian nota TRM-…" di riwayat tidak punya nota
    // untuk dibuka, padahal nomornya tertulis persis di layar.
    .select(
      'id, entry_type, amount, notes, qty, unit, entry_date, proof_path, penyesuaian_nota, created_at, ' +
        'cash_categories(name), cash_accounts(name), outlets!outlet_id(name), counterpart:user_profiles!counterpart_id(full_name)'
    )
    .eq('holder_id', uid)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** Daftar semua anggota (untuk pilihan tujuan transfer & tabel admin). */
export async function listCashMembers() {
  const { data, error } = await supabase.rpc('list_cash_members');
  if (error) throw error;
  return data ?? [];
}

export async function getCashProofUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from('cash-proofs').createSignedUrl(path, 600);
  if (error) throw error;
  return data?.signedUrl ?? null;
}

/**
 * Signed URL untuk BANYAK nota sekaligus (export PDF).
 *
 * Satu permintaan per baris akan menembakkan puluhan koneksi berbarengan dan
 * sebagian tertunda lama — hasilnya PDF dengan sebagian foto hilang, tanpa
 * error apa pun yang menjelaskan kenapa.
 *
 * Gagal = Map kosong, bukan lempar error: export tetap harus jadi, cukup
 * kolom notanya yang berisi "-".
 *
 * @returns {Promise<Map<string,string>>} path -> signed URL
 */
export async function getCashProofUrls(paths, expiresIn = 3600) {
  const bersih = [...new Set((paths ?? []).filter(Boolean))];
  if (!bersih.length) return new Map();
  const { data, error } = await supabase.storage.from('cash-proofs').createSignedUrls(bersih, expiresIn);
  if (error) {
    console.warn('[kas] gagal membuat signed URL nota:', error.message);
    return new Map();
  }
  return new Map((data ?? []).filter((d) => d.signedUrl && !d.error).map((d) => [d.path, d.signedUrl]));
}

// ---- Admin ----

/**
 * Kantong kas AKTIF milik seorang pemegang (0152).
 *
 * `daftarKantongKas()` di atas super-admin-only; ini dipakai layar yang
 * memindahkan entri, dan wewenangnya mengikuti `boleh_koreksi_kas` supaya
 * admin BU tidak melihat daftar kosong yang terbaca sebagai "orang ini tidak
 * punya kantong".
 */
export async function kantongPemegang(holderId) {
  if (!holderId) return [];
  const { data, error } = await supabase.rpc('kantong_pemegang', { p_holder: holderId });
  if (error) throw error;
  return data ?? [];
}

/**
 * Pindahkan beberapa entri kas ke sebuah kantong (0152).
 *
 * Mengembalikan jumlah baris yang SUNGGUH berubah — layarnya membandingkannya
 * dengan yang dicentang, karena melaporkan "berhasil" untuk 0 baris membuat
 * orang mengira pekerjaannya selesai.
 */
export async function ubahKantongKas(entryIds, accountId) {
  const ids = [...new Set((entryIds ?? []).filter(Boolean))];
  if (!ids.length) return 0;
  const { data, error } = await supabase.rpc('ubah_kantong_kas', argumenRpc({ p_entries: ids, p_account: accountId }));
  if (error) throw error;
  return Number(data) || 0;
}

/** Saldo semua pemegang kas (RLS: hanya super admin yang dapat baris orang lain). */
export async function listCashBalances() {
  const { data, error } = await supabase.from('cash_balances').select('holder_id, balance');
  if (error) throw error;
  return data ?? [];
}

export async function listCashEntriesAdmin({ holderId, entryType, dateFrom, dateTo }) {
  // `ambilSemua`, BUKAN `.limit(N)` tunggal.
  //
  // Rentang tanggalnya berarti orangnya meminta SELURUH periode itu; batas
  // keras tanpa paginasi memotongnya diam-diam — dan karena urutannya menurun,
  // yang hilang selalu bagian TERTUA dari rentang. Persis gejala Rekap NBM:
  // filter 31 Agustus-5 September tampil, 31 Agustusnya tidak ada.
  const baris = await ambilSemua((dari, sampai) => {
    let query = supabase
      .from('cash_entries')
      .select(
        // `category_id`, `outlet_id`, `qty`, `unit` IKUT DIAMBIL walau tidak
        // ditampilkan. `ubah_kas` menulis PENUH — field yang tidak dikirim akan
        // TERHAPUS. Dialog admin hanya menyunting nominal/keterangan/outlet dan
        // mengirim sisanya apa adanya; tanpa kolom-kolom ini ia akan mengirim
        // `undefined` dan diam-diam menghapus kategori & jumlah barangnya.
        // Itu bug 0119 ("+ Foto menghapus supplier") dalam bentuk lain.
        'id, business_unit_id, holder_id, entry_type, amount, notes, entry_date, proof_path, penyesuaian_nota, created_at, ' +
          // `supplier` ikut dengan alasan yang SAMA PERSIS (0149): ia kolom
          // yang tidak ditampilkan dialog admin, dan `ubah_kas` menulis penuh.
          // `untuk_nota` IKUT, dan itu bukan kerapian: tanpanya
          // `untukBahan()` membaca `undefined` dan SELURUH pembayaran nota
          // terhitung sebagai "selain bahan". Daftar kolom yang dituntut
          // modul itu ada di `KOLOM_DIBUTUHKAN`, dan auditnya memaksa
          // baris ini memuat seluruhnya.
          'category_id, outlet_id, qty, unit, supplier, untuk_nota, esb_exported_at, dicoret_at, alasan_coret, diubah_at, ' +
          'holder:user_profiles!holder_id(full_name), counterpart:user_profiles!counterpart_id(full_name), ' +
          // OUTLET IKUT DEMI `business_unit_id`-NYA.
          //
          // `cash_entries.business_unit_id` di baris atas DEPRECATED sejak
          // 0040 dan selalu NULL. Dialog admin memakainya untuk memuat daftar
          // supplier ESB — jadi daftarnya selalu kosong, jadi kotak Supplier
          // TIDAK PERNAH DIGAMBAR. Tidak ada galat: dialognya terbuka lengkap,
          // hanya tanpa satu-satunya kolom yang bisa membuka ekspornya.
          //
          // Sumbu yang benar sama dengan 0150: BU diturunkan dari OUTLET
          // peruntukan, yang wajib ada pada tiap kas keluar sejak 0063.
          'outlets!outlet_id(name, business_unit_id), ' +
          // KANTONGNYA IKUT. Sejak 0151 kantong entri adalah sumber kolom
          // `Account` berkas Disbursement, jadi entri tanpa kantong tertahan —
          // dan tanpa kolom ini tidak ada satu pun cara di layar untuk tahu
          // baris mana yang bermasalah. Yang membacanya cuma melihat "2
          // tertahan" di layar lain, tanpa nomor kas untuk dicari.
          'cash_accounts(name), dibayar_pusat, ' +
          'pencoret:user_profiles!dicoret_by(full_name), pengubah:user_profiles!diubah_by(full_name), cash_categories(name)',
        { count: 'exact' }
      )
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (holderId) query = query.eq('holder_id', holderId);
    if (entryType) query = query.eq('entry_type', entryType);
    if (dateFrom) query = query.gte('entry_date', dateFrom);
    if (dateTo) query = query.lte('entry_date', dateTo);
    return query.range(dari, sampai);
  });

  // Diratakan ke nama yang sama dengan RPC `riwayat_kas_saya`, supaya modul
  // murni `koreksi-kas.js` bisa dipakai APA ADANYA oleh kedua layar. Tanpa ini,
  // jejak "dihapus oleh siapa" muncul di Staff App dan hilang di Admin Portal —
  // tanpa error, dan justru di layar yang dipakai memeriksanya.
  return baris.map((r) => ({
    ...r,
    dicoret_oleh: r.pencoret?.full_name ?? '',
    diubah_oleh: r.pengubah?.full_name ?? ''
  }));
}

export async function listRecentCashActivity({ limit = 25, before = null } = {}) {
  let query = supabase
    .from('cash_entries')
    .select('created_at, entry_type, amount, holder:user_profiles!holder_id(full_name), cash_categories(name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) query = query.lt('created_at', before);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/**
 * Laporan kas per pemegang, untuk modul Laporan.
 *
 * Lewat RPC karena dua alasan yang tidak bisa diatasi dari sisi klien:
 *   1. Sejak 0040 baris kas TIDAK menyimpan outlet — outlet di laporan
 *      diturunkan dari tempat kerja utama (★) pemegangnya.
 *   2. RLS cash_entries hanya membuka baris milik sendiri; laporan perlu
 *      lintas orang, dan itu dibuka terkendali di dalam RPC.
 */
export async function laporanKasUser({ from, to, userId = null, outletId = null, categoryId = null }) {
  const { data, error } = await supabase.rpc('laporan_kas_user', {
    p_from: from,
    p_to: to,
    p_user: userId || null,
    p_outlet: outletId || null,
    p_category: categoryId || null
  });
  if (error) throw error;
  return data ?? [];
}

/**
 * Kantong kas yang barisnya boleh dilihat orang ini (0140) — untuk dropdown
 * filter laporan Rincian Mutasi Kas.
 *
 * BUKAN `daftarKantongKas()`: yang itu super admin saja, sementara laporan ini
 * juga dipakai admin BU/outlet. Baris ber-`account_id` null adalah **Kas
 * Utama**, tempat uang pemegang berjatah satu kantong sebenarnya berada.
 */
export async function listKantongKasTerlihat() {
  const { data, error } = await supabase.rpc('kantong_kas_terlihat');
  if (error) throw error;
  return data ?? [];
}

/**
 * Rincian mutasi kas PER ITEM (0140).
 *
 * `ambilSemua`, BUKAN satu panggilan polos: RPC yang mengembalikan himpunan
 * baris ikut dipotong PostgREST di sekitar 1.000 baris. Satu bulan belanja
 * bahan satu BU sudah melewati angka itu — dan yang hilang bukan error, cuma
 * baris-baris terakhir menurut urutan, sehingga totalnya jadi lebih kecil
 * tanpa ada yang menyadarinya.
 *
 * `tanpaKantong` DIBEDAKAN dari `accountId` kosong: yang satu berarti "hanya
 * uang yang tidak berada di kantong mana pun (Kas Utama)", yang lain berarti
 * "semua kantong".
 */
export async function rincianMutasiKas({
  from,
  to,
  userId = null,
  accountId = null,
  tanpaKantong = false,
  outletId = null,
  categoryId = null
}) {
  return ambilSemua((dari, sampai) =>
    supabase
      .rpc(
        'rincian_mutasi_kas',
        {
          p_from: from,
          p_to: to,
          p_user: userId || null,
          p_account: accountId || null,
          p_tanpa_kantong: !!tanpaKantong,
          p_outlet: outletId || null,
          p_category: categoryId || null
        },
        { count: 'exact' }
      )
      // Urutan WAJIB deterministik, dan `baris_id` yang membuatnya begitu:
      // satu nota boleh memuat bahan yang sama dua kali, jadi tanggal + nama
      // saja masih bisa seri — dan penomoran halaman yang urutannya seri
      // melewatkan baris sekaligus menggandakan baris lain.
      .order('entry_date')
      .order('holder_name')
      .order('entry_id')
      .order('baris_id')
      .range(dari, sampai)
  );
}
