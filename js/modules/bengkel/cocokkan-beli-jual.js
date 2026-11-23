/**
 * MENCOCOKKAN PEMBELIAN DENGAN PENJUALAN — inti "dimasak di Berjaya Hub".
 *
 * Murni: tidak menyentuh DOM, tidak menyentuh Supabase.
 *
 *   "dari 2 file tersebut bisa terlihat sparepart dengan supplier apa di
 *    tanggal itu dipakai di invoice dengan nopol berapa"
 *
 * ============ YANG DIHASILKAN: DUA ARAH SEKALIGUS ============
 *
 *   ke penjualan  -> tiap baris jual tahu SUPPLIER & HARGA BELI-nya
 *   ke pembelian  -> tiap baris beli tahu DIPAKAI DI NOPOL MANA, dan berapa
 *                    yang belum terpakai (= stok)
 *
 * Satu perhitungan, bukan dua: menghitungnya terpisah untuk tiap laporan
 * berarti dua jawaban yang pasti menyimpang, dan tidak ada cara tahu mana
 * yang benar.
 *
 * ============ FIFO, DAN KENAPA ============
 *
 * Satu SKU dibeli berkali-kali dengan harga berbeda. Saat satu unit terjual,
 * yang mana yang terpakai? Tidak ada data yang bisa menjawabnya — Turboly
 * tidak mencatat "unit dari PO mana yang dipasang". Jadi harus ada ATURAN,
 * dan aturannya FIFO: yang dibeli lebih dulu dianggap terpakai lebih dulu.
 *
 * Itu tebakan, dan ia disebut tebakan di layar. Yang TIDAK boleh adalah
 * menebak diam-diam lalu menampilkannya sebagai fakta.
 *
 * ============ YANG TIDAK KETEMU TIDAK DIKOSONGKAN ============
 *
 * Part yang dibeli sebelum periode impor tidak akan punya pasangan. Barisnya
 * ditandai `TIDAK_KETEMU` — bukan diberi harga 0, dan bukan dikosongkan.
 * Harga 0 akan terbaca sebagai "untung penuh", dan sel kosong tidak bisa
 * dibedakan dari "belum diimpor".
 */

const teks = (v) => (v === null || v === undefined ? '' : String(v));
const num = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export const ASAL = {
  COCOK: 'cocok',
  SEBAGIAN: 'sebagian',
  TIDAK_KETEMU: 'tidak-ketemu',
  TANPA_SKU: 'tanpa-sku'
};

export const PESAN_ASAL = {
  [ASAL.COCOK]: 'Ketemu pembeliannya.',
  [ASAL.SEBAGIAN]: 'Pembeliannya hanya ketemu sebagian — sisanya dibeli sebelum periode yang diimpor.',
  [ASAL.TIDAK_KETEMU]: 'Pembeliannya tidak ketemu — kemungkinan dibeli sebelum periode yang diimpor.',
  [ASAL.TANPA_SKU]: 'Baris ini tanpa SKU, jadi tidak bisa dicocokkan.'
};

/**
 * Kunci pencocokan.
 *
 * SKU, bukan nama. Nama ditulis bebas di kedua sistem — "BAN DUNLOP EC300
 * 215/60 17" dan "BAN DUNLOP 215/60R17" adalah barang yang sama bagi orang
 * dan dua barang bagi mesin. SKU-nya dirapikan huruf besar-kecil & spasi saja.
 */
export function kunciSku(v) {
  return teks(v).trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Nopol dirapikan sebelum dibandingkan atau ditampilkan.
 *
 * Turboly menulis `N1732AAR`, sheet menulis `N 1732 AAR`. Dibandingkan apa
 * adanya, tidak satu pun akan cocok — dan hasilnya laporan yang berkata
 * "tidak ada pembelian untuk mobil ini", bukan galat.
 */
export function kunciNopol(v) {
  return teks(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Tanggal apa adanya dari Turboly ("16-Nov-2026") jadi `YYYY-MM-DD` untuk diurutkan. */
export function tanggalUrut(v) {
  const s = teks(v).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const BULAN = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', mei: '05', jun: '06', jul: '07', aug: '08', agu: '08', sep: '09', oct: '10', okt: '10', nov: '11', dec: '12', des: '12' };
  const m = /^(\d{1,2})[ -]([A-Za-z]{3})[A-Za-z]*[ -](\d{4})$/.exec(s);
  if (!m) return s;
  const bln = BULAN[m[2].toLowerCase()];
  return bln ? `${m[3]}-${bln}-${m[1].padStart(2, '0')}` : s;
}

/**
 * Cocokkan.
 *
 * @param {{pembelian: Array, penjualan: Array}} o
 *   pembelian: {id, po_no, tanggal, supplier, sku, nama, qty, harga}
 *   penjualan: {id, invoice_no, tanggal, nopol, customer, sku, nama, qty, item_type}
 * @returns {{jual: Array, beli: Array, ringkas: object}}
 */
export function cocokkanBeliJual({ pembelian = [], penjualan = [] } = {}) {
  // ---- Stok berjalan per SKU, urut tanggal (FIFO) ----
  const perSku = new Map();
  const beli = (Array.isArray(pembelian) ? pembelian : []).map((b, i) => ({
    ...b,
    _i: i,
    _sku: kunciSku(b?.sku),
    _tgl: tanggalUrut(b?.tanggal),
    sisa: num(b?.qty),
    terpakai: [] // {nopol, invoice_no, tanggal, qty}
  }));
  for (const b of beli) {
    if (!b._sku) continue;
    if (!perSku.has(b._sku)) perSku.set(b._sku, []);
    perSku.get(b._sku).push(b);
  }
  // Yang dibeli lebih dulu dipakai lebih dulu. `_i` sebagai pemutus seri
  // supaya hasilnya SAMA tiap kali dijalankan untuk data yang sama —
  // urutan yang bergantung pembacaan membuat angka berubah tanpa sebab.
  for (const daftar of perSku.values()) daftar.sort((x, y) => (x._tgl < y._tgl ? -1 : x._tgl > y._tgl ? 1 : x._i - y._i));

  // ---- Penjualan diproses urut tanggal juga ----
  const jualUrut = (Array.isArray(penjualan) ? penjualan : [])
    .map((j, i) => ({ ...j, _i: i, _sku: kunciSku(j?.sku), _tgl: tanggalUrut(j?.tanggal) }))
    .sort((x, y) => (x._tgl < y._tgl ? -1 : x._tgl > y._tgl ? 1 : x._i - y._i));

  const hasilJual = [];
  for (const j of jualUrut) {
    // Jasa tidak pernah punya pembelian. Mencocokkannya akan menghasilkan
    // "tidak ketemu" untuk ratusan baris yang memang tidak perlu dicari.
    if (teks(j.item_type) === 'jasa') {
      hasilJual.push({ ...bersih(j), asal: null, sumber: [], supplier: '', hargaBeli: null, totalBeli: null });
      continue;
    }
    if (!j._sku) {
      hasilJual.push({ ...bersih(j), asal: ASAL.TANPA_SKU, sumber: [], supplier: '', hargaBeli: null, totalBeli: null });
      continue;
    }

    let butuh = num(j.qty);
    const sumber = [];
    const daftar = perSku.get(j._sku) ?? [];
    for (const b of daftar) {
      if (butuh <= 0) break;
      if (b.sisa <= 0) continue;
      // Pembelian yang tanggalnya SESUDAH penjualan tidak dipakai: barang
      // tidak bisa terjual sebelum dibeli. Tanpa penjagaan ini, pembelian
      // bulan depan akan "membiayai" penjualan bulan ini, dan labanya
      // terlihat masuk akal.
      if (b._tgl && j._tgl && b._tgl > j._tgl) continue;
      const ambil = Math.min(b.sisa, butuh);
      b.sisa -= ambil;
      butuh -= ambil;
      b.terpakai.push({ nopol: teks(j.nopol), invoice_no: teks(j.invoice_no), tanggal: teks(j.tanggal), qty: ambil });
      sumber.push({
        po_no: teks(b.po_no),
        tanggal: teks(b.tanggal),
        supplier: teks(b.supplier),
        qty: ambil,
        harga: b.harga === null || b.harga === undefined ? null : num(b.harga)
      });
    }

    const terambil = num(j.qty) - butuh;
    const asal = terambil <= 0 ? ASAL.TIDAK_KETEMU : butuh > 0 ? ASAL.SEBAGIAN : ASAL.COCOK;
    // Harga beli = rata-rata TERTIMBANG dari sumber yang harganya diketahui.
    // Kalau tidak satu pun sumbernya berharga, hasilnya `null` — bukan 0.
    const berharga = sumber.filter((s) => s.harga !== null);
    const qtyBerharga = berharga.reduce((t, s) => t + s.qty, 0);
    const nilai = berharga.reduce((t, s) => t + s.harga * s.qty, 0);
    hasilJual.push({
      ...bersih(j),
      asal,
      sumber,
      supplier: [...new Set(sumber.map((s) => s.supplier).filter(Boolean))].join(', '),
      hargaBeli: qtyBerharga > 0 ? bulat(nilai / qtyBerharga) : null,
      totalBeli: qtyBerharga > 0 ? bulat(nilai) : null
    });
  }

  // ---- Sisi pembelian: dipakai di nopol mana, sisanya berapa ----
  const hasilBeli = beli.map((b) => {
    const nopol = [...new Set(b.terpakai.map((t) => teks(t.nopol).trim()).filter(Boolean))];
    return {
      ...bersih(b),
      terpakai: b.terpakai,
      qtyTerpakai: bulat(num(b.qty) - b.sisa),
      sisa: bulat(b.sisa),
      nopol,
      // Teks siap-tampil untuk kolom Nopol di laporan pembelian, meniru sheet:
      // satu mobil -> plat, banyak mobil -> dirinci, belum terpakai -> STOK.
      nopolTeks: nopol.length === 0 ? 'STOK' : nopol.length === 1 ? nopol[0] : `${nopol.length} nopol`
    };
  });

  return { jual: hasilJual, beli: hasilBeli, ringkas: ringkasCocok(hasilJual, hasilBeli) };
}

function bersih(o) {
  const { _i, _sku, _tgl, sisa, terpakai, ...sisanya } = o;
  return sisanya;
}

function bulat(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function ringkasCocok(jual = [], beli = []) {
  const r = {
    jualSparepart: 0,
    cocok: 0,
    sebagian: 0,
    tidakKetemu: 0,
    tanpaSku: 0,
    beliBaris: 0,
    beliTerpakai: 0,
    beliSisa: 0,
    qtySisa: 0,
    tanpaHargaBeli: 0
  };
  for (const j of jual) {
    if (j.asal === null) continue; // jasa
    r.jualSparepart += 1;
    if (j.asal === ASAL.COCOK) r.cocok += 1;
    else if (j.asal === ASAL.SEBAGIAN) r.sebagian += 1;
    else if (j.asal === ASAL.TANPA_SKU) r.tanpaSku += 1;
    else r.tidakKetemu += 1;
    if (j.hargaBeli === null) r.tanpaHargaBeli += 1;
  }
  for (const b of beli) {
    r.beliBaris += 1;
    if (b.qtyTerpakai > 0) r.beliTerpakai += 1;
    if (b.sisa > 0) {
      r.beliSisa += 1;
      r.qtySisa += b.sisa;
    }
  }
  r.qtySisa = bulat(r.qtySisa);
  return r;
}

/**
 * Kalimat yang HARUS ikut ke mana pun hasil pencocokan dibawa.
 *
 * Pencocokan ini tebakan berdasar aturan FIFO. Angka yang lahir darinya boleh
 * dipakai, asal yang membacanya tahu itu tebakan — dan itu hanya terjadi
 * kalau kalimatnya ikut tercetak, bukan cuma ada di kepala yang membuatnya.
 */
export function catatanCocok(r) {
  const out = ['Pembelian dicocokkan ke penjualan dengan aturan FIFO (yang dibeli lebih dulu dianggap terpakai lebih dulu) — bukan dari catatan pemasangan sungguhan.'];
  if (!r) return out;
  if (r.tidakKetemu) out.push(`${r.tidakKetemu} baris jual tidak ketemu pembeliannya — kemungkinan dibeli sebelum periode yang diimpor.`);
  if (r.sebagian) out.push(`${r.sebagian} baris jual hanya ketemu sebagian pembeliannya.`);
  if (r.tanpaSku) out.push(`${r.tanpaSku} baris jual tanpa SKU, jadi tidak bisa dicocokkan.`);
  if (r.tanpaHargaBeli) out.push(`${r.tanpaHargaBeli} baris jual belum punya harga beli (pembeliannya tidak ketemu, atau harganya nol di ekspor Turboly).`);
  if (r.beliSisa) out.push(`${r.beliSisa} baris beli masih bersisa (${r.qtySisa} unit) — dianggap stok.`);
  return out;
}
