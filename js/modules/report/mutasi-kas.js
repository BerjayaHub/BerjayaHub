/**
 * RINCIAN MUTASI KAS — satu baris per ITEM, bukan per nota.
 *
 * ============ YANG DIMINTA ============
 *
 *   "rincian mutasi kas, yaitu keluar masuk saldo, dengan rincian ... saya
 *    filter pemegang kas iis, kantong kas kas iis ck, lalu disana akan muncul
 *    rincian per bahan dan per keluar, seperti lombok 1 kg 10.000, karcis
 *    parkir 1 5000, jadi bukan per nota, tetapi per item ... saya ingin semua
 *    muncul dengan mapping, bahan bila dikeluarkan dari modul bahan, lalu bila
 *    keluar dari cash ledger sesuai dengan mapping nya"
 *
 * Laporan "Kas per Pemegang" yang sudah ada menjawab pertanyaan lain: satu
 * baris per ENTRI. Pembayaran nota tampil sebagai "Pembayaran nota NT-0012 —
 * Rp1.240.000", dan isi belanjaannya tidak ada di sana sama sekali.
 *
 * ============ DUA SUMBER, SATU TABEL ============
 *
 *   bahan — baris nota penerimaan dari supplier yang dilunasi lewat kas.
 *           Kategorinya "Pembelian bahan" (atau kategori kas entrinya, kalau
 *           pencatatnya memilih satu).
 *   kas   — entri buku kas yang tidak melunasi nota apa pun: parkir, bensin,
 *           setoran, transfer, pindah antar kantong, penyesuaian nota.
 *           Kategorinya = kategori kas yang dipilih saat mencatat.
 *
 * ============ BARIS REKONSILIASI: KENAPA ADA ============
 *
 * Nota yang DIKOREKSI SESUDAH DIBAYAR (migration 0131) membuat tiga angka
 * berbeda hidup bersamaan:
 *
 *   - entri pembayarannya bernilai total LAMA (uang yang benar-benar keluar
 *     hari itu);
 *   - isi notanya sekarang bernilai total BARU;
 *   - selisihnya berjalan lewat entri PENYESUAIAN tersendiri.
 *
 * Menjumlahkan baris bahan begitu saja menghitung selisih itu DUA KALI, dan
 * hasilnya tetap terlihat masuk akal — jenis kegagalan yang paling mahal.
 *
 * Karena itu tiap kelompok baris bahan dicocokkan dengan nominal entri
 * induknya, dan bedanya DITULIS sebagai baris tersendiri yang menyebut
 * sebabnya. Pada nota yang tidak pernah dikoreksi, baris itu tidak pernah
 * muncul.
 *
 * ============ BARIS BELUM BERHARGA ============
 *
 * Nilainya `null`, ditulis "-", TIDAK direkonsiliasi (selisihnya sudah punya
 * penjelasan: harganya memang belum diisi), dan jumlahnya disebut di ringkasan.
 * Menuliskannya 0 membuat total terlihat rapi dan lebih kecil dari kenyataan.
 *
 * Tidak ada impor selain pemformat angka, supaya bisa diuji tanpa browser.
 */

import { formatNum, formatRupiah } from '../../core/format.js';

export const SUMBER_BAHAN = 'bahan';
export const SUMBER_KAS = 'kas';

/** Selisih di bawah ini dianggap pembulatan, bukan koreksi. */
export const TOLERANSI_REKONSILIASI = 1;

export const KATEGORI_REKONSILIASI = 'Koreksi nota setelah dibayar';

export const KOLOM_MUTASI_KAS = [
  { header: 'Tanggal', width: 1 },
  { header: 'Pemegang', width: 1.4 },
  { header: 'Kantong', width: 1.1 },
  { header: 'Outlet', width: 1.2 },
  { header: 'Sumber', width: 0.8 },
  { header: 'Kategori', width: 1.4 },
  { header: 'Rincian', width: 2.2 },
  { header: 'Jumlah', width: 0.8, align: 'right', numeric: true },
  { header: 'Satuan', width: 0.7 },
  { header: 'Masuk', width: 1.2, align: 'right', numeric: true },
  { header: 'Keluar', width: 1.2, align: 'right', numeric: true },
  { header: 'No. Nota', width: 1.1 },
  { header: 'Supplier / Lawan', width: 1.6 }
];

const LABEL_SUMBER = { bahan: 'Bahan', kas: 'Kas' };

const teks = (v) => (v === null || v === undefined ? '' : String(v));

/** `null`/`undefined`/`''` berarti kosong; `0` TIDAK. Non-finite juga kosong. */
function angkaAtauNull(v) {
  // `Number('')` dan `Number(null)` adalah 0, bukan NaN — disaring lebih dulu.
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Baris rekonsiliasi untuk SATU entri pembayaran nota, atau `null` kalau tidak
 * perlu.
 *
 * Dipisah dan diekspor supaya bisa diuji sendiri: inilah satu-satunya bagian
 * laporan ini yang bisa salah tanpa terlihat salah.
 *
 * @param {{nominal: number|null}[]} barisBahan baris bahan milik satu entri
 * @param {number|null} entryAmount nominal entri kas induknya (bertanda)
 * @returns {number|null} selisih yang perlu ditulis, atau null
 */
export function selisihRekonsiliasi(barisBahan, entryAmount) {
  const induk = angkaAtauNull(entryAmount);
  if (induk === null) return null;

  let jumlah = 0;
  for (const b of barisBahan ?? []) {
    const n = angkaAtauNull(b?.nominal);
    // Ada baris yang belum berharga -> selisihnya SUDAH punya penjelasan.
    // Menuliskannya sebagai "koreksi nota" akan menuduh hal yang tidak terjadi.
    if (n === null) return null;
    jumlah += n;
  }

  const beda = induk - jumlah;
  if (Math.abs(beda) < TOLERANSI_REKONSILIASI) return null;
  return beda;
}

/**
 * @param {object} o
 * @param {object[]} o.baris hasil RPC `rincian_mutasi_kas`
 * @param {{dari?: string, sampai?: string}} [o.periode]
 * @returns {{columns: object[], rows: string[][], summary: object[], bold: number[], note: string}}
 */
export function susunMutasiKas({ baris, periode = {} } = {}) {
  const masuk0 = Array.isArray(baris) ? baris : [];

  // ---- 1. Normalisasi ----
  const norm = masuk0.map((r) => ({
    entryId: teks(r?.entry_id),
    tanggal: teks(r?.entry_date),
    pemegang: teks(r?.holder_name) || '(tanpa nama)',
    kantong: teks(r?.account_name) || 'Kas Utama',
    outlet: teks(r?.outlet_name),
    sumber: r?.sumber === SUMBER_BAHAN ? SUMBER_BAHAN : SUMBER_KAS,
    kategori: teks(r?.kategori) || 'Tanpa kategori',
    item: teks(r?.item) || 'Tanpa keterangan',
    qty: angkaAtauNull(r?.qty),
    satuan: teks(r?.satuan),
    nominal: angkaAtauNull(r?.nominal),
    entryAmount: angkaAtauNull(r?.entry_amount),
    nota: teks(r?.nota_code),
    pihak: teks(r?.pihak),
    notaBatal: r?.nota_batal === true,
    rekonsiliasi: false
  }));

  // ---- 2. Rekonsiliasi per entri pembayaran nota ----
  //
  // Dikerjakan dengan MEMPERTAHANKAN urutan masukan, lalu menyisipkan baris
  // selisihnya tepat sesudah baris terakhir kelompoknya. Mengurutkan ulang di
  // sini akan membuang urutan yang sudah ditentukan server.
  const kelompok = new Map();
  for (const r of norm) {
    if (r.sumber !== SUMBER_BAHAN) continue;
    if (!kelompok.has(r.entryId)) kelompok.set(r.entryId, []);
    kelompok.get(r.entryId).push(r);
  }

  const selisihPer = new Map();
  for (const [entryId, anggota] of kelompok) {
    const beda = selisihRekonsiliasi(anggota, anggota[0]?.entryAmount);
    if (beda !== null) selisihPer.set(entryId, beda);
  }

  const akhirKelompok = new Map();
  norm.forEach((r, i) => {
    if (r.sumber === SUMBER_BAHAN) akhirKelompok.set(r.entryId, i);
  });

  const urut = [];
  norm.forEach((r, i) => {
    urut.push(r);
    if (akhirKelompok.get(r.entryId) !== i) return;
    const beda = selisihPer.get(r.entryId);
    if (beda === undefined) return;
    // Satu entri kas bisa melunasi BEBERAPA nota sekaligus. Menyebut nomor
    // nota terakhir saja akan menuduh satu nota atas selisih yang bisa berasal
    // dari nota lain di entri yang sama.
    const kode = [...new Set((kelompok.get(r.entryId) ?? []).map((b) => b.nota).filter(Boolean))];
    urut.push({
      ...r,
      nota: kode.length === 1 ? kode[0] : '',
      notaBatal: false,
      kategori: KATEGORI_REKONSILIASI,
      item:
        'Selisih terhadap entri kasnya — ' +
        (kode.length === 1 ? `nota ${kode[0]}` : `${kode.length || 'salah satu'} nota di entri ini`) +
        ' diubah sesudah dibayar, jadi isinya tidak lagi sama dengan uang yang keluar hari itu',
      qty: null,
      satuan: '',
      nominal: beda,
      pihak: '',
      rekonsiliasi: true
    });
  });

  // ---- 3. Total ----
  let masuk = 0;
  let keluar = 0;
  let tanpaHarga = 0;
  for (const r of urut) {
    if (r.nominal === null) {
      tanpaHarga++;
      continue;
    }
    if (r.nominal >= 0) masuk += r.nominal;
    else keluar += Math.abs(r.nominal);
  }

  const rows = urut.map((r) => [
    r.tanggal,
    r.pemegang,
    r.kantong,
    r.outlet || '-',
    LABEL_SUMBER[r.sumber],
    r.kategori,
    r.item,
    r.qty === null ? '-' : formatNum(r.qty),
    r.satuan || '-',
    r.nominal === null ? '-' : r.nominal >= 0 ? formatRupiah(r.nominal) : '',
    r.nominal === null ? '-' : r.nominal < 0 ? formatRupiah(Math.abs(r.nominal)) : '',
    r.nota ? (r.notaBatal ? `${r.nota} (batal)` : r.nota) : '-',
    r.pihak || '-'
  ]);

  if (rows.length) {
    rows.push([
      'TOTAL',
      '',
      '',
      '',
      '',
      '',
      `${urut.length} baris rincian`,
      '',
      '',
      formatRupiah(masuk),
      formatRupiah(keluar),
      '',
      ''
    ]);
  }

  const rekonsiliasi = urut.filter((r) => r.rekonsiliasi).length;
  const entriBahan = kelompok.size;
  const entriKas = new Set(norm.filter((r) => r.sumber === SUMBER_KAS).map((r) => r.entryId)).size;

  const summary = [
    { label: 'Kas masuk', value: formatRupiah(masuk) },
    { label: 'Kas keluar', value: formatRupiah(keluar) },
    { label: 'Selisih periode', value: formatRupiah(masuk - keluar) },
    { label: 'Baris rincian', value: formatNum(urut.length) },
    { label: 'Entri kas', value: `${formatNum(entriBahan)} nota + ${formatNum(entriKas)} non-nota` }
  ];

  const dari = teks(periode.dari);
  const sampai = teks(periode.sampai);

  return {
    columns: KOLOM_MUTASI_KAS,
    rows,
    bold: rows.length ? [rows.length - 1] : [],
    summary,
    note:
      'Satu baris = satu **item**, bukan satu nota. Pembayaran nota supplier dipecah menjadi baris-baris bahannya ' +
      '(Sumber **Bahan**, kategori "Pembelian bahan"); pengeluaran buku kas yang tidak berhubungan dengan bahan — ' +
      'parkir, bensin, setoran, transfer — tampil apa adanya dengan **kategori kas** yang dipilih saat mencatat ' +
      '(Sumber **Kas**). ' +
      'Nilai tiap baris bahan memakai **harga beli baris itu** — rumus yang sama dengan total nota dan dengan ' +
      'nominal yang dibayarkan, bukan harga per satuan terkecil dikali jumlah. ' +
      'Kolom Outlet adalah **peruntukan** kas keluar; kas masuk tidak punya peruntukan sehingga kolomnya "-", dan ' +
      'menyaring per outlet otomatis menyisihkan baris kas masuk. ' +
      'Nota yang dilunasi **Pusat** tidak muncul di sini sama sekali: ia memang tidak pernah menyentuh kas mana pun — ' +
      'untuk seluruh pembelian bahan, pakai laporan Bahan Masuk di modul Bahan. ' +
      (rekonsiliasi
        ? `${formatNum(rekonsiliasi)} baris **Koreksi nota setelah dibayar** ditambahkan supaya jumlah baris rincian ` +
          'tetap sama dengan uang yang benar-benar keluar: notanya diubah sesudah dilunasi, dan selisihnya berjalan ' +
          'lewat entri penyesuaian tersendiri. '
        : '') +
      (tanpaHarga
        ? `${formatNum(tanpaHarga)} baris belum berharga sehingga ditulis "-" dan **tidak** ikut total — totalnya ` +
          'lebih kecil dari yang sebenarnya sampai harganya dilengkapi di nota. '
        : '') +
      'Angka ringkasan adalah **pergerakan** selama periode' +
      (dari && sampai ? ` ${dari} s/d ${sampai}` : '') +
      ', bukan saldo kantongnya — saldo berjalan ada di modul Kas.'
  };
}
