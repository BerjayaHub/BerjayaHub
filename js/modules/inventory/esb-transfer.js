/**
 * Ekspor kiriman antar-outlet (modul Pengiriman) ke template
 * **ESB Simple Transfer**.
 *
 * ============ BENTUK TEMPLATENYA ============
 *
 * 13 kolom, header di BARIS 1, satu sheet datar. Tidak ada harga sama sekali —
 * transfer memindahkan barang, bukan uang.
 *
 * `Sequence` mengelompokkan beberapa baris jadi SATU dokumen transfer, sama
 * seperti di Simple Purchase.
 *
 * ============ QTY = YANG DITERIMA, BUKAN YANG DIKIRIM ============
 *
 * `dispatch_items` menyimpan dua angka: `sent_qty` dan `received_qty`. Yang
 * dikirim ke ESB adalah **yang diterima**.
 *
 * Kalau CK mengirim 10 kg dan yang sampai 9 kg, ESB harus mencatat 9 kg —
 * kalau tidak, stok di outlet tujuan lebih besar daripada barang yang benar-
 * benar ada di raknya. Selisih seperti itu tidak muncul sebagai error; ia baru
 * ketahuan saat opname, berminggu-minggu kemudian, dan pada saat itu tidak ada
 * lagi yang bisa menjelaskan asalnya.
 *
 * Karena itu pula HANYA kiriman berstatus `received` yang diekspor, dan
 * tanggalnya `received_at`: stok ESB bertambah pada hari barangnya benar-benar
 * sampai.
 *
 * ============ TIDAK ADA PEMETAAN BARU ============
 *
 * Origin/Destination Branch & Location memakai peta `branch` dan `location`
 * yang SAMA dengan Simple Purchase — sumbernya sama-sama nama outlet. Unit dan
 * Product Name juga memakai peta `unit` dan `item` yang sudah ada. Satu-satunya
 * kolom yang belum pernah dipakai adalah `Product Code`, dan itu sudah tersimpan
 * di `esb_master.kode` sejak impor Master Product Data.
 *
 * Satu-satunya impornya `tanggalWIB` (modul murni juga), supaya bisa diuji
 * tanpa Excel maupun browser.
 */

import { tanggalWIB } from '../../core/dates.js';

/** Header template ESB Simple Transfer, berurutan. Nama & urutannya harus persis. */
export const KOLOM_TRANSFER = [
  'Sequence',
  'Date',
  'Origin Branch',
  'Origin Location',
  'Destination Branch',
  'Destination Location',
  'Cost Center',
  'Project',
  'Additional Info',
  'Product Name',
  'Product Code',
  'Unit',
  'Qty'
];

const teks = (v) => (v === null || v === undefined ? '' : String(v).trim());
const angka = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function padanan(peta, nilai) {
  const k = teks(nilai).toLowerCase();
  if (!k) return null;
  return peta?.get(k) ?? null;
}

/**
 * Bangun baris template ESB Simple Transfer dari kiriman Berjaya Hub.
 *
 * @param {object} o
 * @param {Array} o.kiriman  { id, code, received_at, notes,
 *                             from_outlet_name, to_outlet_name }
 * @param {Map<string, Array>} o.itemsPerKiriman  id kiriman -> baris item
 *   { product_name, base_unit, received_qty, sent_qty }
 * @param {Record<string, Map<string,string>>} o.peta hasil `buatPeta` — DIPAKAI
 *   BERSAMA dengan Simple Purchase; tidak ada pemetaan baru untuk transfer.
 * @param {Map<string,string>} [o.kodeItem] nama item ESB -> Product Code
 * @param {{mulaiSequence?: number}} [o.opsi]
 * @returns {{baris: Array[], kirimanIds: string[], kurang: Array<{jenis: string, nilai: string, dok: string[]}>}}
 */
export function barisEsbTransfer({ kiriman, itemsPerKiriman, peta, kodeItem = new Map(), opsi = {} }) {
  let seq = opsi.mulaiSequence ?? 1;

  const baris = [];
  const kirimanIds = [];
  const kurang = new Map();
  const catat = (jenis, nilai, kode) => {
    const nilaiTeks = teks(nilai) || '(kosong)';
    const k = `${jenis}::${nilaiTeks.toLowerCase()}`;
    if (!kurang.has(k)) kurang.set(k, { jenis, nilai: nilaiTeks, dok: new Set() });
    kurang.get(k).dok.add(kode);
  };

  for (const d of Array.isArray(kiriman) ? kiriman : []) {
    const kode = teks(d.code) || teks(d.id);

    // Baris ber-qty terima nol ATAU belum terisi dilewati.
    //
    // Nol berarti barangnya memang tidak sampai — bukan transfer, dan baris
    // bernilai nol di ESB cuma jadi dokumen yang harus dihapus manual.
    //
    // Belum terisi berbeda artinya: barangnya sampai tapi jumlahnya tidak
    // pernah dicatat. Itu DITAHAN, bukan dilewati — mengirimnya sebagai nol
    // akan membuat stok tujuan kurang tanpa ada yang menyadarinya.
    const semua = itemsPerKiriman?.get?.(d.id) ?? [];
    let adaBelumDicatat = false;
    const items = [];
    for (const it of semua) {
      const q = angka(it?.received_qty);
      if (q === null) {
        catat('qty-terima', it?.product_name, kode);
        adaBelumDicatat = true;
        continue;
      }
      if (q <= 0) continue;
      items.push({ ...it, qty: q });
    }
    if (!items.length && !adaBelumDicatat) continue;

    // Tanggal terima kosong menahan kirimannya. Sel Date yang kosong bukan
    // ditolak ESB melainkan diisi tanggal unggah, jadi seluruh kiriman lama
    // akan masuk sebagai mutasi hari ini.
    const tanggal = tanggalWIB(d.received_at);
    if (!tanggal) catat('tanggal-terima', kode, kode);

    const asalB = padanan(peta.branch, d.from_outlet_name);
    const asalL = padanan(peta.location, d.from_outlet_name);
    const tujuanB = padanan(peta.branch, d.to_outlet_name);
    const tujuanL = padanan(peta.location, d.to_outlet_name);

    if (!asalB) catat('branch', d.from_outlet_name, kode);
    if (!asalL) catat('location', d.from_outlet_name, kode);
    if (!tujuanB) catat('branch', d.to_outlet_name, kode);
    if (!tujuanL) catat('location', d.to_outlet_name, kode);

    const barisDok = [];
    let masalahItem = false;
    for (const it of items) {
      const item = padanan(peta.item, it.product_name);
      const unit = padanan(peta.unit, it.base_unit);
      if (!item) {
        catat('item', it.product_name, kode);
        masalahItem = true;
      }
      if (!unit) {
        catat('unit', it.base_unit, kode);
        masalahItem = true;
      }

      barisDok.push([
        seq,
        tanggal,
        asalB ?? '',
        asalL ?? '',
        tujuanB ?? '',
        tujuanL ?? '',
        '', // Cost Center
        '', // Project
        teks(d.notes), // Additional Info
        item ?? '',
        // Product Code diambil dari daftar induk ESB, lewat NAMA hasil
        // pemetaan — bukan dari kode lokal Berjaya Hub, yang tidak pernah
        // sama dengan kode ESB.
        item ? kodeItem.get(item) ?? '' : '',
        unit ?? '',
        it.qty
      ]);
    }

    const kepalaBermasalah = !tanggal || !asalB || !asalL || !tujuanB || !tujuanL;
    // Satu baris bermasalah menahan SELURUH dokumennya — sama seperti di
    // Simple Purchase. Transfer separuh jadi di ESB memindahkan sebagian
    // stok, dan sisanya harus dikoreksi manual di dua outlet sekaligus.
    if (masalahItem || adaBelumDicatat || kepalaBermasalah || !barisDok.length) continue;

    baris.push(...barisDok);
    kirimanIds.push(d.id);
    seq += 1;
  }

  return {
    baris,
    kirimanIds,
    kurang: [...kurang.values()].map((k) => ({ jenis: k.jenis, nilai: k.nilai, dok: [...k.dok] }))
  };
}

/** Ringkasan siap-tampil. */
export function ringkasTransfer(hasil, totalKiriman) {
  const siap = hasil?.kirimanIds?.length ?? 0;
  return {
    siap,
    tertahan: Math.max(0, (totalKiriman ?? 0) - siap),
    baris: hasil?.baris?.length ?? 0,
    kurang: hasil?.kurang?.length ?? 0
  };
}
