import { supabase } from '../../config/supabase-client.js';
import { compressImage } from '../../core/image-compress.js';
import { ambilSemua } from '../../core/ambil-semua.js';
// Umur tautan bertanda tangan tinggal di SATU tempat. Angka yang ditulis
// langsung di tiap pemanggil akan menyimpang, dan yang menyimpang berbentuk
// satu layar yang tautannya mati lebih cepat dari layar sebelahnya.
import { UMUR_TAUTAN_KETUK, UMUR_TAUTAN_THUMBNAIL } from '../../core/tautan-foto.js';
// Pustaka yang SAMA dengan yang menulis Excel bergambar. SheetJS versi
// komunitas tidak bisa membaca gambar sama sekali — dan memakai dua pustaka
// untuk satu berkas berarti dua anggapan tentang bentuknya.
import { loadExcelJS } from '../../core/xlsx-foto.js';
import { gabungItemDenganStok, urutKode } from './aturan-aset-bu.js';

export const ASSET_CONDITION = { normal: 'Normal', rusak: 'Rusak', lainnya: 'Lain-lain' };
export const ASSET_CONDITION_BADGE = { normal: 'badge-approved', rusak: 'badge-rejected', lainnya: 'badge-pending' };
export const ASSET_CONDITION_OPTIONS = Object.entries(ASSET_CONDITION).map(([value, label]) => ({ value, label }));

/** Label kondisi siap tampil: "Lain-lain" selalu disertai catatannya. */
export function conditionText(a) {
  const base = ASSET_CONDITION[a.condition] ?? a.condition;
  return a.condition === 'lainnya' && a.condition_note ? `${base} — ${a.condition_note}` : base;
}

/**
 * Daftar aset satu outlet — ATAU seluruh outlet BU.
 *
 * ============ DAFTARNYA SELALU SELURUH ITEM BU ============
 *
 * Sejak 0168, daftar item milik BU dan jumlahnya milik outlet. Saat satu
 * outlet dipilih, fungsi ini mengembalikan SETIAP item BU — termasuk yang
 * outlet itu belum pernah mendatanya, dengan `belumDidata: true` dan qty 0.
 *
 * Itulah yang diminta: nama & kode sama di semua outlet, yang berbeda cuma
 * jumlahnya. Dan `belumDidata` ada supaya "belum ada yang melihat" tidak
 * tertukar dengan "sudah dicek, memang tidak ada" — keduanya menampilkan 0.
 */
export async function listAssets({ businessUnitId, outletId, condition, category, q, catatan, limit = 5000 }) {
  // Master item: selalu seluruhnya, tidak disaring server-side selain kategori.
  let qItem = supabase
    .from('asset_items')
    .select('id, kode, name, category, size')
    .eq('business_unit_id', businessUnitId)
    .limit(limit);
  if (category) qItem = qItem.eq('category', category);
  if (q) qItem = qItem.ilike('name', `%${q}%`);
  const { data: items, error: eItem } = await qItem;
  if (eItem) throw eItem;

  const ids = (items ?? []).map((i) => i.id);
  if (!ids.length) return [];

  let qStok = supabase
    .from('asset_stock')
    .select(
      'id, asset_item_id, outlet_id, qty, condition, condition_note, size, notes, photo_path, updated_at, ' +
        // Nama pengubah ikut diambil supaya daftarnya bisa menjawab "siapa yang
        // mengubah ini" tanpa membuka riwayat satu per satu. Embed-nya di
        // dalam `!left` supaya baris yang pengubahnya sudah keluar tidak ikut
        // hilang — embed wajib yang gagal membatalkan SELURUH query (0086).
        'user_profiles!asset_stock_updated_by_fkey(full_name), outlets!outlet_id(name)'
    )
    .in('asset_item_id', ids);
  if (outletId) qStok = qStok.eq('outlet_id', outletId);
  const { data: stok, error: eStok } = await qStok;
  if (eStok) throw eStok;

  let rows;
  if (outletId) {
    const pengubah = new Map((stok ?? []).map((x) => [x.asset_item_id, x.user_profiles?.full_name ?? null]));
    rows = gabungItemDenganStok({ items, stok }).map((r) => ({
      ...r,
      id: r.stokId,
      outlet_id: outletId,
      diubah_oleh: pengubah.get(r.itemId) ?? null
    }));
  } else {
    // ============ TANPA OUTLET: HANYA BARIS YANG BENAR-BENAR ADA ============
    //
    // Menampilkan "seluruh item × seluruh outlet" di sini akan menghasilkan
    // ribuan baris yang hampir semuanya nol, dan ekspor PDF-nya jadi ratusan
    // halaman kosong. Keadaan "belum didata" cuma berarti saat ada satu outlet
    // yang sedang dilihat.
    const peta = new Map((items ?? []).map((i) => [i.id, i]));
    rows = (stok ?? []).map((s) => {
      const i = peta.get(s.asset_item_id) ?? {};
      return {
        itemId: s.asset_item_id,
        stokId: s.id,
        id: s.id,
        kode: i.kode ?? '',
        name: i.name ?? '',
        category: i.category ?? null,
        size: s.size ?? i.size ?? null,
        qty: Number(s.qty) || 0,
        condition: s.condition,
        condition_note: s.condition_note,
        notes: s.notes,
        photo_path: s.photo_path,
        outlet_id: s.outlet_id,
        outlets: s.outlets,
        diubah_oleh: s.user_profiles?.full_name ?? null,
        belumDidata: false,
        updated_at: s.updated_at
      };
    });
  }

  // Saringan sisanya dikerjakan di sini, BUKAN di server — karena baris
  // "belum didata" tidak punya baris di server untuk disaring.
  if (condition) rows = rows.filter((r) => !r.belumDidata && r.condition === condition);
  if (catatan) {
    const k = String(catatan).toLowerCase();
    rows = rows.filter((r) => String(r.notes ?? '').toLowerCase().includes(k));
  }

  return rows.sort((a, b) => urutKode(a.kode, b.kode) || String(a.name).localeCompare(String(b.name), 'id'));
}



/**
 * Daftar kategori yang SUDAH dipakai di BU ini.
 *
 * Sengaja dibangun dari nilai yang ada, bukan dari tabel referensi — sama
 * seperti kategori di Master Produk. Menambah kategori berarti mengetik nama
 * baru; tidak ada langkah "buat kategori dulu" yang harus dikerjakan admin
 * sebelum staff bisa mencatat barang.
 *
 * Diambil TANPA batas baris: daftar yang terpotong akan menyembunyikan
 * kategori lama dari kotak pencarian, dan orang akan membuat duplikatnya.
 */
/**
 * Baca berkas .xlsx impor: isi selnya DAN gambar yang tertanam di dalamnya.
 *
 * ============ SATU-SATUNYA TEMPAT YANG TAHU BENTUK ExcelJS ============
 *
 * Modul `impor-aset.js` sengaja tidak mengenal ExcelJS sama sekali — ia
 * menerima `aoa` biasa dan daftar `{ row, ... }`, jadi seluruh aturannya bisa
 * diuji tanpa Excel maupun browser. Penerjemahan bentuknya cuma di sini.
 *
 * ============ `nativeRow` 0-BASED, SAMA DENGAN INDEKS `aoa` ============
 *
 * Inilah anggapan yang menopang seluruh pencocokan foto, dan ia dibuktikan
 * terhadap berkas .xlsx sungguhan di `tools/test-impor-aset.mjs`: gambar yang
 * dijangkar di sel A5 menghasilkan baris 4, dan baris data pertama memang ada
 * di `aoa[4]`.
 *
 * `row.values` milik ExcelJS 1-BASED dan jarang rapat — indeks 0-nya selalu
 * kosong. `.slice(1)` yang hilang akan menggeser SELURUH kolom satu langkah ke
 * kanan: nama barang terbaca sebagai ID, dan setiap baris ditolak dengan
 * "ID tidak ada di inventaris ini" — pesan yang menuduh orangnya mengubah
 * kolom yang tidak pernah ia sentuh.
 */
export async function bacaBerkasImporAset(file) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Berkasnya tidak punya satu pun sheet yang bisa dibaca.');

  const aoa = [];
  ws.eachRow({ includeEmpty: true }, (row, nomor) => {
    // `row.values` 1-based; indeks 0-nya selalu kosong.
    aoa[nomor - 1] = (row.values ?? []).slice(1).map((v) => {
      if (v === null || v === undefined) return null;
      // Sel berformula & rich text datang sebagai objek. Yang dibaca hasilnya,
      // bukan `[object Object]` yang lolos sebagai nama barang.
      if (typeof v === 'object') return v.result ?? v.text ?? (Array.isArray(v.richText) ? v.richText.map((t) => t.text).join('') : '');
      return v;
    });
  });
  for (let i = 0; i < aoa.length; i++) if (!aoa[i]) aoa[i] = [];

  const gambar = [];
  for (const im of ws.getImages() ?? []) {
    const media = wb.getImage(Number(im.imageId));
    if (!media?.buffer) continue;
    gambar.push({
      row: Number(im.range?.tl?.nativeRow),
      col: Number(im.range?.tl?.nativeCol),
      nama: media.name || `gambar-${im.imageId}`,
      buffer: media.buffer,
      ext: media.extension || 'png'
    });
  }
  return { aoa, gambar };
}

export async function listKategoriAset(businessUnitId) {
  const rows = await ambilSemua((dari, sampai) =>
    supabase
      .from('asset_items')
      .select('category', { count: 'exact' })
      .eq('business_unit_id', businessUnitId)
      .not('category', 'is', null)
      .range(dari, sampai)
  );

  return [...new Set((rows ?? []).map((r) => r.category?.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'id')
  );
}

/**
 * Pindahkan aset ke outlet/BU lain — LEWAT RPC, bukan `update` biasa.
 *
 * PostgREST membalas SUKSES DENGAN NOL BARIS saat RLS menolak. Pemindahan
 * massal 40 aset yang seluruhnya ditolak akan terlihat berhasil, dan yang
 * mencarinya di outlet tujuan tidak akan menemukannya. RPC-nya mengembalikan
 * jumlah yang benar-benar berpindah supaya layar bisa mengatakan apa adanya.
 *
 * Alasan lengkapnya di kepala migration 0102.
 */
export async function pindahAset({ ids, businessUnitId, outletId }) {
  const { data, error } = await supabase.rpc('pindah_aset', {
    p_ids: ids,
    p_bu: businessUnitId,
    p_outlet: outletId
  });
  if (error) throw error;
  return data ?? { pindah: 0, ditolak: 0, ganti_outlet: 0 };
}

/**
 * Pindahkan BERKAS foto ke folder outlet baru.
 *
 * Harus dikerjakan dari klien: memindahkan objek storage tidak bisa dilakukan
 * dari dalam SQL. `pindah_aset()` sudah mengosongkan `photo_path` bagi yang
 * berganti outlet, jadi kegagalan di sini berakhir sebagai aset tanpa foto —
 * bukan aset dengan tautan yang selalu gagal dibuka.
 *
 * Dikerjakan SATU PER SATU, bukan serentak: puluhan penyalinan berbarengan
 * membuat sebagian permintaan tertunda lama atau ditolak, dan hasilnya
 * "sebagian fotonya hilang" tanpa sebab yang jelas.
 */
export async function pindahFotoAset(daftar) {
  let berhasil = 0;
  const gagal = [];

  for (const { assetId, dariPath, keOutletId } of daftar) {
    if (!dariPath || !keOutletId) continue;
    const ext = (dariPath.split('.').pop() || 'jpg').toLowerCase();
    const tujuan = `${keOutletId}/${assetId}.${ext}`;

    try {
      // `move` memindahkan tanpa mengunduh isinya — jauh lebih hemat daripada
      // unduh-lalu-unggah, dan tidak ada jendela waktu dengan dua salinan.
      const { error } = await supabase.storage.from('asset-photos').move(dariPath, tujuan);
      if (error) throw error;

      // Lewat RPC, bukan `update` biasa: penolakan RLS pada UPDATE membalas
      // sukses dengan 0 baris, jadi foto yang sudah telanjur dipindahkan akan
      // terlihat tercatat padahal barisnya masih menunjuk path lama yang
      // sekarang kosong. RPC-nya melempar kalau wewenangnya kurang.
      const { error: upErr } = await supabase.rpc('set_foto_stok_aset', { p_stok: assetId, p_path: tujuan });
      if (upErr) throw upErr;

      berhasil++;
    } catch (error) {
      gagal.push({ assetId, sebab: error?.message ?? String(error) });
    }
  }

  return { berhasil, gagal };
}

async function currentUserId() {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * Simpan aset (tambah / ubah) beserta fotonya.
 * Foto diunggah SETELAH baris ada, karena path-nya memakai id aset — dengan
 * begitu satu aset selalu punya paling banyak satu foto dan tidak ada file
 * yatim saat penyimpanan gagal.
 */
/**
 * Ubah nama / kategori / ukuran acuan sebuah ITEM — berlaku di SELURUH outlet.
 *
 * ============ KENAPA INI HARUS ADA ============
 *
 * Sejak 0168, nama milik item dan jumlah milik outlet. `catat_stok_aset()`
 * tidak menyentuh nama sama sekali.
 *
 * Jadi tanpa fungsi ini, orang yang membetulkan salah ketik di form Edit akan
 * melihat "Aset diperbarui", lalu menemukan namanya tidak berubah — dan tidak
 * ada galat di mana pun yang menjelaskan kenapa. Itu bentuk kegagalan yang
 * paling membingungkan: aplikasi mengaku berhasil mengerjakan hal yang tidak
 * pernah ia kerjakan.
 */
export async function ubahItemAset({ itemId, name, category, size }) {
  const uid = await currentUserId();
  const { data, error } = await supabase
    .from('asset_items')
    .update({
      name: String(name ?? '').trim(),
      category: String(category ?? '').trim() || null,
      size: String(size ?? '').trim() || null,
      updated_by: uid,
      updated_at: new Date().toISOString()
    })
    .eq('id', itemId)
    .select('id');
  if (error) throw error;
  // `.select()`: penolakan RLS pada UPDATE membalas sukses dengan 0 baris.
  if (!data?.length) throw new Error('Nama item tidak tersimpan — item ini di luar BU yang bisa kamu kelola.');
}

export async function saveAsset({ itemId, businessUnitId, outletId, name, category, qty, size, condition, conditionNote, notes, file }) {
  const uid = await currentUserId();
  if (!uid) throw new Error('Sesi tidak ditemukan, silakan login ulang.');

  // ============ ITEMNYA DULU, BARU JUMLAHNYA ============
  //
  // Sejak 0168, nama & kategori milik ITEM (se-BU) dan jumlah milik OUTLET.
  // Menyimpan nama ke baris stok akan membuat outlet A dan outlet B punya nama
  // berbeda untuk item yang sama — persis yang perubahan ini hapus.
  //
  // Kodenya dibuat database di dalam RPC, bukan di sini. Dan RPC itu
  // mengembalikan item yang SUDAH ADA kalau nama+kategorinya sama persis, jadi
  // dua staff yang mendata barang yang sama di hari yang sama tidak
  // menghasilkan dua kode untuk satu barang.
  let item = itemId;
  if (!item) {
    const { data, error } = await supabase.rpc('tambah_item_aset', {
      p_bu: businessUnitId,
      p_nama: name,
      p_kategori: category ?? null,
      p_size: size ?? null
    });
    if (error) throw error;
    item = data?.id;
    if (!item) throw new Error('Item asetnya tidak terbentuk — coba lagi.');
  }

  const { data: stokId, error: eStok } = await supabase.rpc('catat_stok_aset', {
    p_item: item,
    p_outlet: outletId,
    p_qty: Number(qty) || 0,
    p_condition: condition,
    p_condition_note: conditionNote ?? null,
    p_size: size ?? null,
    p_notes: notes ?? null
  });
  if (eStok) throw eStok;
  const assetId = stokId;

  if (file) {
    // Dikompres SEBELUM path dihitung, karena ekstensinya ikut berubah
    // (webp/jpg). Foto kamera 3 MB jadi ~200 KB — free tier Supabase cuma 1 GB.
    const kecil = await compressImage(file, { preset: 'asset' });
    const ext = (kecil.name?.split('.').pop() || 'jpg').toLowerCase();
    const path = `${outletId}/${assetId}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('asset-photos')
      .upload(path, kecil, { upsert: true, contentType: kecil.type || 'image/jpeg' });
    if (upErr) throw upErr;
    // Fotonya sudah terlanjur terunggah; kalau penyimpanan path-nya ditolak,
    // aset akan punya foto yang tidak pernah bisa ditemukan lagi. Lebih baik
    // gagal dengan lantang di sini.
    const { error: updErr } = await supabase.rpc('set_foto_stok_aset', { p_stok: assetId, p_path: path });
    if (updErr) throw updErr;
    await hapusFotoSisa(`${outletId}/${assetId}`, path);
  }
  return assetId;
}

/**
 * Hapus foto aset yang sama tapi berekstensi lain.
 *
 * KENAPA PERLU: `upsert` hanya menimpa path yang PERSIS sama. Begitu kompresi
 * mengubah ekstensinya (mis. foto lama `.jpg`, foto baru `.webp`), file lama
 * tidak tertimpa — ia menjadi yatim dan tetap memakan kuota selamanya. Ironis
 * kalau justru muncul dari perubahan yang tujuannya menghemat storage.
 *
 * Kegagalan diabaikan: fotonya sudah tersimpan dengan benar, dan menggagalkan
 * penyimpanan aset hanya karena sisa file lama tidak terhapus jelas berlebihan.
 */
async function hapusFotoSisa(basePath, pathTerpakai) {
  const kandidat = ['jpg', 'jpeg', 'png', 'webp']
    .map((e) => `${basePath}.${e}`)
    .filter((p) => p !== pathTerpakai);
  try {
    await supabase.storage.from('asset-photos').remove(kandidat);
  } catch (error) {
    console.warn('[aset] sisa foto lama tidak terhapus:', error?.message ?? error);
  }
}

/**
 * Hapus aset beserta fotonya.
 *
 * `.select()` di akhir BUKAN hiasan. RLS `assets_delete` hanya mengizinkan
 * admin outlet, dan PostgREST TIDAK menganggap "tidak ada baris yang boleh
 * dihapus" sebagai error — ia membalas sukses dengan 0 baris. Tanpa pemeriksaan
 * ini, staff biasa menekan Hapus, melihat notifikasi "Aset dihapus", lalu
 * bingung karena barangnya masih ada. Kebohongan yang meyakinkan jauh lebih
 * buruk daripada pesan penolakan yang jujur.
 */
export async function deleteAsset(id) {
  // Yang dihapus BARIS STOK, bukan itemnya.
  //
  // Menghapus item berarti menghapusnya dari SELURUH outlet — tindakan yang
  // jauh lebih besar daripada yang diminta tombol "Hapus" di daftar satu
  // outlet. Sesudah ini item itu kembali tampil sebagai "belum didata" di
  // outlet tersebut, dan jumlahnya di outlet lain tidak tersentuh.
  //
  // Path fotonya dibaca DULU: setelah barisnya hilang, tidak ada lagi cara
  // menemukan file itu dan ia jadi sampah permanen di storage.
  const { data: aset } = await supabase.from('asset_stock').select('photo_path').eq('id', id).maybeSingle();

  const { data, error } = await supabase.from('asset_stock').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) {
    throw new Error('Tidak bisa dihapus — hanya admin outlet yang boleh menghapus aset.');
  }

  if (aset?.photo_path) {
    try {
      await supabase.storage.from('asset-photos').remove([aset.photo_path]);
    } catch (err) {
      console.warn('[aset] foto tidak ikut terhapus:', err?.message ?? err);
    }
  }
}

/**
 * Satu tautan, untuk DIBUKA SEKARANG.
 *
 * Umurnya pendek dengan sengaja — ia dibuat tepat sebelum dipakai, jadi pendek
 * tidak pernah mengganggu siapa pun, sementara panjang membuat tautan yang
 * terlanjur tersalin bisa dibuka siapa saja tanpa login.
 *
 * MELEMPAR saat gagal, tidak mengembalikan null: pemanggilnya perlu tahu
 * BEDANYA kedaluwarsa dan tidak berizin, dan `null` menghapus bedanya.
 */
export async function getAssetPhotoUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from('asset-photos').createSignedUrl(path, UMUR_TAUTAN_KETUK);
  if (error) throw error;
  return data?.signedUrl ?? null;
}

/**
 * Signed URL untuk BANYAK foto sekaligus.
 *
 * Satu panggilan untuk semua, bukan satu per baris: tabel dengan 100 aset akan
 * menembakkan 100 permintaan jaringan berbarengan, dan sebagian akan ditolak
 * atau tertunda lama — tabelnya lalu tampak "sebagian fotonya rusak" padahal
 * hanya kena antrean.
 *
 * Gagal = Map kosong, bukan lempar error. Foto adalah pelengkap; daftar aset
 * harus tetap tampil meski fotonya tidak bisa diambil.
 */
export async function getAssetPhotoUrls(paths, expiresIn = UMUR_TAUTAN_THUMBNAIL) {
  const bersih = [...new Set((paths ?? []).filter(Boolean))];
  if (!bersih.length) return new Map();
  const { data, error } = await supabase.storage.from('asset-photos').createSignedUrls(bersih, expiresIn);
  if (error) {
    console.warn('[aset] gagal membuat signed URL foto:', error.message);
    return new Map();
  }
  return new Map((data ?? []).filter((d) => d.signedUrl && !d.error).map((d) => [d.path, d.signedUrl]));
}

// =========================================================
// KERUSAKAN & RIWAYAT (0170)
// =========================================================

export const JENIS_KERUSAKAN = { rusak: 'Rusak', pecah: 'Pecah', hilang: 'Hilang' };
export const JENIS_KERUSAKAN_OPTIONS = Object.entries(JENIS_KERUSAKAN).map(([value, label]) => ({ value, label }));

/**
 * Catat barang rusak/pecah/hilang. Jumlahnya BERKURANG sebagai akibatnya.
 *
 * ============ FOTO DIUNGGAH LEBIH DULU, BUKAN SESUDAH ============
 *
 * Fotonya wajib, dan `asset_damage.photo_path` NOT NULL. Kalau barisnya dibuat
 * dulu lalu fotonya menyusul — seperti yang dilakukan `saveAsset` — kegagalan
 * unggah di tengah meninggalkan catatan kerusakan TANPA bukti, yaitu persis
 * yang tidak boleh ada.
 *
 * Nama berkasnya karena itu dibuat di sini, bukan dari id baris yang belum
 * lahir. Kalau RPC-nya kemudian gagal, yang tertinggal cuma satu berkas yatim
 * di storage — jauh lebih murah daripada catatan tanpa bukti, dan tidak
 * mengubah satu angka pun.
 */
export async function catatKerusakan({ itemId, outletId, qty, jenis, sebab, tanggal, file }) {
  if (!file) throw new Error('Foto bukti wajib dilampirkan.');

  const kecil = await compressImage(file, { preset: 'asset' });
  const ext = (kecil.name?.split('.').pop() || 'jpg').toLowerCase();
  // Segmen pertama path WAJIB outlet — izin baca/tulis foto memakainya (0050).
  const path = `${outletId}/kerusakan/${crypto.randomUUID()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from('asset-photos')
    .upload(path, kecil, { upsert: false, contentType: kecil.type || 'image/jpeg' });
  if (upErr) throw upErr;

  const { data, error } = await supabase.rpc('catat_kerusakan_aset', {
    p_item: itemId,
    p_outlet: outletId,
    p_qty: Number(qty),
    p_jenis: jenis,
    p_photo_path: path,
    p_sebab: sebab?.trim() || null,
    p_tanggal: tanggal || null
  });
  if (error) {
    // Berkasnya sudah terlanjur naik tapi tidak dipakai siapa pun. Dibersihkan
    // supaya tidak jadi sampah permanen; kegagalan pembersihannya diabaikan —
    // yang penting pesan galat aslinya sampai ke orangnya.
    try {
      await supabase.storage.from('asset-photos').remove([path]);
    } catch {
      /* diabaikan dengan sengaja */
    }
    throw error;
  }
  return data;
}

export async function batalkanKerusakan(id, alasan) {
  const { data, error } = await supabase.rpc('batalkan_kerusakan_aset', { p_id: id, p_alasan: alasan });
  if (error) throw error;
  return data;
}

/** Catatan kerusakan satu BU, boleh disaring outlet & rentang tanggal. */
export async function listKerusakan({ businessUnitId, outletId, dari, sampai }) {
  return ambilSemua((a, b) => {
    let q = supabase
      .from('asset_damage')
      .select(
        'id, qty, jenis, sebab, photo_path, tanggal, dilapor_by_nama, created_at, dibatalkan_at, dibatalkan_by_nama, alasan_batal, outlet_id, asset_items!inner(id, kode, name, category, business_unit_id), outlets!outlet_id(name)'
      )
      .eq('asset_items.business_unit_id', businessUnitId);
    if (outletId) q = q.eq('outlet_id', outletId);
    if (dari) q = q.gte('tanggal', dari);
    if (sampai) q = q.lte('tanggal', sampai);
    return q.order('tanggal', { ascending: false }).range(a, b);
  });
}

/**
 * Riwayat perubahan satu item.
 *
 * `outletId` menyaring kejadian milik outlet itu, TAPI perubahan nama &
 * kategori ikut terbawa — ia tersimpan tanpa outlet karena berlaku di semua
 * outlet, dan menyembunyikannya membuat "kenapa namanya berubah" tidak
 * terjawab di layar tempat orang bertanya.
 */
export async function listRiwayatAset({ itemId, outletId, limit = 100 }) {
  let q = supabase
    .from('asset_log')
    .select('id, aksi, kolom, sebelum, sesudah, catatan, oleh_nama, at, outlet_id')
    .eq('asset_item_id', itemId)
    .order('at', { ascending: false })
    .limit(limit);
  if (outletId) q = q.or(`outlet_id.eq.${outletId},outlet_id.is.null`);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}
