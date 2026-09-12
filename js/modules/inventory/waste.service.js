/**
 * Waste / Spoil — pencatatan berfoto dan rekapnya.
 *
 * Dipisah dari `inventory.service.js` karena sejak `0135` waste bukan lagi satu
 * baris `stock_movements`, melainkan dokumen tersendiri dengan fotonya, tabel
 * rinciannya, dan viewnya sendiri.
 */

import { supabase } from '../../config/supabase-client.js';
import { ambilSemua } from '../../core/ambil-semua.js';
import { argumenRpc } from '../../core/rpc-args.js';
import { compressImage } from '../../core/image-compress.js';
import { pesanGagalUnggah } from './pesan-unggah.js';

const BUCKET = 'waste-photos';

/**
 * Unggah foto waste, dikecilkan dulu di HP.
 *
 * Path-nya `{outlet_id}/…` — outlet di depan karena kebijakan Storage memeriksa
 * izinnya dari nama berkasnya sendiri (0135). Fotonya diunggah SEBELUM catatan
 * wastenya dibuat, jadi saat unggahannya diperiksa tidak ada baris apa pun yang
 * bisa ditanyai outletnya.
 */
export async function unggahFotoWaste(outletId, file) {
  if (!file) throw new Error('Belum ada foto yang dipilih.');
  if (!outletId) throw new Error('Outlet belum dipilih, jadi fotonya tidak tahu harus disimpan atas nama outlet mana.');

  // Preset `aktivitas`: 900px. Pertanyaan yang dijawab foto ini cuma satu —
  // benar rusak/terbuang atau tidak — dan 900px sudah lebih dari cukup untuk
  // itu. Foto waste bertambah tiap hari di tiap outlet, jadi ukurannya
  // berpengaruh pada kuota jauh lebih cepat daripada foto aset.
  const kecil = await compressImage(file, { preset: 'aktivitas' }).catch(() => file);
  const sumber = kecil ?? file;

  const ext = (sumber.name?.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${outletId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, sumber, { upsert: false });
  if (error) throw new Error(pesanGagalUnggah(error));
  return path;
}

/**
 * Catat waste/spoil. FOTONYA WAJIB — dan yang menolak adalah server.
 *
 * Diperiksa juga di sini supaya penolakannya datang SEBELUM permintaan
 * jaringan; tapi pemeriksaan ini bukan penjaganya. Penjaganya `catat_waste`
 * (0135), karena PWA di HP staff bisa tertinggal versi dan layar berikutnya
 * bisa ditulis orang yang tidak tahu aturannya.
 */
export async function catatWaste({ outletId, jenis, productId, qty, photoPath, notes }) {
  if (!photoPath) throw new Error('Foto wajib diisi sebelum menyimpan.');
  const { data, error } = await supabase.rpc(
    'catat_waste',
    argumenRpc({
      p_outlet: outletId,
      p_jenis: jenis,
      p_product: productId,
      p_qty: qty,
      p_photo: photoPath,
      p_notes: notes ?? null
    })
  );
  if (error) throw new Error(error.message ?? String(error));
  return data;
}

/**
 * Rekap satu rentang tanggal — SATU BARIS PER BAHAN (view `waste_rekap`).
 *
 * Rentangnya memakai kolom `tanggal` yang sudah dikonversi ke WIB di view,
 * bukan `created_at` yang UTC. Menyaring UTC akan memindahkan waste yang
 * dicatat lewat pukul 17.00 WIB ke tanggal berikutnya — tujuh jam yang membuat
 * rekap harian tidak pernah cocok dengan catatan tulis tangan di outlet.
 */
const KOLOM_DASAR =
  'waste_id, outlet_id, outlet_nama, code, jenis, tanggal, qty_kejadian, photo_path, notes, ' +
  'sumber_nama, product_id, bahan_nama, bahan_satuan, bahan_qty, dicatat_oleh';

export async function rekapWaste(businessUnitId, { outletId = null, dateFrom = null, dateTo = null } = {}) {
  if (!businessUnitId) return [];

  const ambil = (kolom) =>
    ambilSemua((dari, sampai) => {
      let q = supabase
        .from('waste_rekap')
        .select(kolom, { count: 'exact' })
        .eq('business_unit_id', businessUnitId)
        .order('tanggal', { ascending: false });
      if (outletId) q = q.eq('outlet_id', outletId);
      if (dateFrom) q = q.gte('tanggal', dateFrom);
      if (dateTo) q = q.lte('tanggal', dateTo);
      return q.range(dari, sampai);
    });

  try {
    // `lama` (0136) menandai catatan sebelum foto diwajibkan. Fotonya memang
    // tidak pernah ada — bukan hilang — dan layar harus bisa mengatakan itu
    // alih-alih menampilkan sel kosong yang terbaca sebagai "staffnya lupa".
    return await ambil(`${KOLOM_DASAR}, lama`);
  } catch (e) {
    // KOLOM BARU TIDAK BOLEH MENYANDERA SELURUH LAYAR.
    //
    // Ini pernah terjadi sungguhan pada 0122: kode yang meminta kolom baru
    // di-push lebih dulu daripada migrationnya dijalankan, PostgREST menolak
    // SELURUH permintaan karena satu kolom tidak dikenal, dan layarnya
    // kehilangan bukan satu kolom — melainkan seluruh daftarnya.
    //
    // Jeda antara push dan menjalankan migration itu wajar dan akan terjadi
    // lagi. Kalau `lama` belum ada, rekapnya tetap tampil; yang hilang cuma
    // penandanya.
    if (!/\blama\b/.test(String(e?.message ?? ''))) throw e;
    return await ambil(KOLOM_DASAR);
  }
}

/**
 * Biaya rata-rata SELURUH outlet di satu BU, sekaligus.
 *
 * `getBiayaRataOutlet` (inventory.service) hanya melayani satu outlet, dan
 * rekap waste bawaannya "Semua outlet". Memanggilnya per outlet berarti satu
 * permintaan per outlet, dan hasilnya tetap harus digabung dengan kunci yang
 * sama — jadi kuncinya dibuat sekali di sini.
 *
 * Kuncinya `outletId|productId` karena biayanya memang BERBEDA per outlet
 * (0118): harga beli beras di Sentul bukan harga beli beras di Serpong.
 */
export async function getBiayaRataBu(businessUnitId) {
  if (!businessUnitId) return new Map();
  const baris = await ambilSemua((dari, sampai) =>
    supabase
      .from('biaya_rata_bahan')
      .select('outlet_id, product_id, rata', { count: 'exact' })
      .eq('business_unit_id', businessUnitId)
      .range(dari, sampai)
  );
  const peta = new Map();
  for (const b of baris) peta.set(`${b.outlet_id}|${b.product_id}`, Number(b.rata));
  return peta;
}

/** Satu foto untuk dilihat di layar. */
export async function urlFotoWaste(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/**
 * Banyak foto sekaligus, untuk disisipkan ke Excel.
 *
 * Kegagalannya TIDAK melempar: satu foto yang tidak bisa dibuat URL-nya tidak
 * boleh membatalkan seluruh unduhan tiga ratus baris. Yang hilang ditandai di
 * selnya sendiri (lihat `asset.page.js` dan `core/xlsx-foto.js` — "-" berarti
 * memang tidak berfoto, "GAGAL" berarti berfoto tapi gambarnya tidak terambil).
 */
export async function urlFotoWasteBanyak(paths, expiresIn = 3600) {
  const bersih = [...new Set((paths ?? []).filter(Boolean))];
  if (!bersih.length) return new Map();

  const hasil = new Map();
  // Dipotong per 100: `createSignedUrls` mengirim seluruh daftar path dalam
  // satu permintaan, dan sebulan waste di empat outlet mudah melewati batas
  // wajar satu badan permintaan.
  for (let i = 0; i < bersih.length; i += 100) {
    const bagian = bersih.slice(i, i + 100);
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(bagian, expiresIn);
    if (error) {
      console.warn('[waste] gagal membuat signed URL foto:', error.message);
      continue;
    }
    for (const d of data ?? []) {
      if (d?.path && d?.signedUrl) hasil.set(d.path, d.signedUrl);
    }
  }
  return hasil;
}
