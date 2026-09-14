/**
 * TES MODUL MURNI `js/modules/report/mutasi-kas.js`.
 *
 * ============ YANG PALING PERLU DIJAGA DI SINI ============
 *
 * Rekonsiliasi. Nota yang dikoreksi SESUDAH dibayar membuat isi notanya tidak
 * lagi sama dengan uang yang keluar hari itu; menjumlahkan baris bahan begitu
 * saja menghitung selisihnya dua kali, dan hasilnya tetap terlihat masuk akal.
 * Itu jenis kegagalan yang tidak akan dilaporkan siapa pun — ia cuma membuat
 * laporan kas dan buku kas berselisih tanpa sebab yang bisa ditunjuk.
 *
 * Yang kedua: baris tanpa harga TIDAK boleh direkonsiliasi. Selisihnya sudah
 * punya penjelasan (harganya memang belum diisi), dan menuliskannya sebagai
 * "koreksi nota" berarti menuduh hal yang tidak terjadi.
 */
import { formatRupiah } from '../js/core/format.js';
import {
  susunMutasiKas,
  selisihRekonsiliasi,
  KOLOM_MUTASI_KAS,
  KATEGORI_REKONSILIASI,
  TOLERANSI_REKONSILIASI
} from '../js/modules/report/mutasi-kas.js';

let gagal = 0;

/**
 * Pembanding yang TIDAK buta terhadap angka non-finite.
 *
 * `JSON.stringify(Infinity)` menghasilkan `"null"` — sama persis dengan
 * `JSON.stringify(null)`. Tanpa penanda ini, sabotase yang menyelipkan
 * Infinity ke laporan lolos karena perbandingannya kebetulan cocok.
 */
const tandai = (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? `NON-FINITE:${String(v)}` : v);
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat, tandai) !== JSON.stringify(harap, tandai)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat, tandai)}\n   harap : ${JSON.stringify(harap, tandai)}`);
  }
};
const benar = (nama, syarat, ket = '') => {
  if (!syarat) {
    gagal++;
    console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`);
  }
};

const K = Object.fromEntries(KOLOM_MUTASI_KAS.map((c, i) => [c.header, i]));
const kolom = (rows, header) => rows.map((r) => r[K[header]]);

const dasar = {
  holder_name: 'Iis Nurlailah',
  account_name: 'Kas Iis CK',
  outlet_name: 'Central Kitchen',
  entry_date: '2026-09-10'
};

const bahan = (o) => ({ ...dasar, sumber: 'bahan', kategori: 'Pembelian bahan', nota_code: 'NT-0001', ...o });
const kas = (o) => ({ ...dasar, sumber: 'kas', ...o });

// =====================================================================
// §1 BENTUK DASAR
// =====================================================================
{
  const { columns, rows, summary, bold } = susunMutasiKas({
    baris: [
      bahan({ entry_id: 'E1', item: 'Lombok', qty: 1, satuan: 'kg', nominal: -10000, entry_amount: -185000, pihak: 'Toko Sayur' }),
      bahan({ entry_id: 'E1', item: 'Beras', qty: 12.5, satuan: 'kg', nominal: -175000, entry_amount: -185000, pihak: 'Toko Sayur' }),
      kas({ entry_id: 'E2', kategori: 'Transportasi & Parkir', item: 'Karcis parkir', qty: 1, satuan: 'lembar', nominal: -5000, entry_amount: -5000 }),
      kas({ entry_id: 'E3', kategori: 'Setoran', item: 'Setoran modal', nominal: 500000, entry_amount: 500000, account_name: 'Kas Utama' })
    ],
    periode: { dari: '2026-09-01', sampai: '2026-09-30' }
  });

  cek('§1 empat baris rincian + TOTAL', rows.length, 5);
  cek('§1 tiap baris selebar kolomnya', [...new Set(rows.map((r) => r.length))], [columns.length]);
  cek('§1 rincian per item, bukan per nota', kolom(rows.slice(0, 3), 'Rincian'), ['Lombok', 'Beras', 'Karcis parkir']);
  cek('§1 label sumber', kolom(rows.slice(0, 4), 'Sumber'), ['Bahan', 'Bahan', 'Kas', 'Kas']);
  cek('§1 mapping kategori ikut apa adanya', kolom(rows.slice(0, 4), 'Kategori'), [
    'Pembelian bahan',
    'Pembelian bahan',
    'Transportasi & Parkir',
    'Setoran'
  ]);

  // Keluar dan masuk di KOLOM BERBEDA — inilah bentuk buku kas, dan ia
  // membuat "keluar masuk saldo" bisa dibaca tanpa memeriksa tanda minus.
  cek('§1 pengeluaran masuk kolom Keluar', rows[0][K['Keluar']], formatRupiah(10000));
  cek('§1 dan kolom Masuk-nya kosong', rows[0][K['Masuk']], '');
  cek('§1 pemasukan masuk kolom Masuk', rows[3][K['Masuk']], formatRupiah(500000));
  cek('§1 dan kolom Keluar-nya kosong', rows[3][K['Keluar']], '');

  const total = rows[rows.length - 1];
  cek('§1 TOTAL masuk', total[K['Masuk']], formatRupiah(500000));
  cek('§1 TOTAL keluar', total[K['Keluar']], formatRupiah(190000));
  cek('§1 baris TOTAL ditebalkan', bold, [rows.length - 1]);
  cek('§1 ringkasan kas masuk', summary.find((s) => s.label === 'Kas masuk')?.value, formatRupiah(500000));
  cek('§1 ringkasan kas keluar', summary.find((s) => s.label === 'Kas keluar')?.value, formatRupiah(190000));
  cek('§1 ringkasan selisih', summary.find((s) => s.label === 'Selisih periode')?.value, formatRupiah(310000));
}

// =====================================================================
// §2 REKONSILIASI — nota dikoreksi sesudah dibayar
//
// Entri kas keluar Rp185.000 (total LAMA). Isi notanya kini Rp200.000.
// Selisih Rp15.000 berjalan lewat entri penyesuaian tersendiri, jadi tanpa
// baris rekonsiliasi laporan ini menghitungnya DUA KALI.
// =====================================================================
{
  const { rows, note, summary } = susunMutasiKas({
    baris: [
      bahan({ entry_id: 'E1', item: 'Lombok', qty: 1, satuan: 'kg', nominal: -25000, entry_amount: -185000 }),
      bahan({ entry_id: 'E1', item: 'Beras', qty: 12.5, satuan: 'kg', nominal: -175000, entry_amount: -185000 }),
      kas({ entry_id: 'E9', kategori: 'Penyesuaian nota', item: 'Penyesuaian nota NT-0001 — koreksi isi nota', nominal: -15000, entry_amount: -15000 })
    ]
  });

  const rincian = rows.slice(0, -1);
  cek('§2 satu baris rekonsiliasi ditambahkan', rincian.filter((r) => r[K['Kategori']] === KATEGORI_REKONSILIASI).length, 1);

  // Posisinya TEPAT sesudah kelompoknya, bukan di ujung tabel: yang membacanya
  // harus bisa melihat selisih itu bersebelahan dengan baris yang ia koreksi.
  cek('§2 posisinya tepat sesudah kelompoknya', rincian[2][K['Kategori']], KATEGORI_REKONSILIASI);
  cek('§2 nilainya = nominal entri − jumlah barisnya', rincian[2][K['Masuk']], formatRupiah(15000));

  // INI intinya. Uang yang benar-benar keluar = 185.000 (pembayaran) + 15.000
  // (penyesuaian) = 200.000, dan itulah yang harus keluar dari SELISIHNYA.
  //
  // Tanpa baris rekonsiliasi, isi nota (200.000) dan entri penyesuaian
  // (15.000) dijumlahkan mentah-mentah jadi 215.000 — lima belas ribu yang
  // tidak pernah terjadi, di laporan yang seluruhnya terlihat wajar.
  const total = rows[rows.length - 1];
  cek('§2 selisih periode = uang yang benar-benar keluar', summary.find((s) => s.label === 'Selisih periode')?.value, formatRupiah(-200000));
  cek('§2 keluar kotor termasuk isi nota barunya', total[K['Keluar']], formatRupiah(215000));
  cek('§2 dan masuknya adalah baris rekonsiliasi itu sendiri', total[K['Masuk']], formatRupiah(15000));
  benar('§2 catatannya menjelaskan baris tambahan itu', note.includes('Koreksi nota setelah dibayar'));
}

// Tanpa koreksi: tidak ada baris tambahan sama sekali.
{
  const { rows, note } = susunMutasiKas({
    baris: [
      bahan({ entry_id: 'E1', item: 'Lombok', nominal: -10000, entry_amount: -185000 }),
      bahan({ entry_id: 'E1', item: 'Beras', nominal: -175000, entry_amount: -185000 })
    ]
  });
  cek('§2 nota utuh: tidak ada baris rekonsiliasi', rows.length, 3); // 2 + TOTAL
  benar('§2 dan catatannya tidak menyebutnya', !note.includes('Koreksi nota setelah dibayar'));
}

// Selisih sekecil pembulatan tidak dijadikan baris sendiri.
{
  const { rows } = susunMutasiKas({
    baris: [bahan({ entry_id: 'E1', item: 'Lombok', nominal: -10000, entry_amount: -10000 - (TOLERANSI_REKONSILIASI - 0.01) })]
  });
  cek('§2 selisih di bawah toleransi diabaikan', rows.length, 2); // 1 + TOTAL
}

// =====================================================================
// §3 BARIS TANPA HARGA
//
// Tidak direkonsiliasi (selisihnya sudah punya penjelasan), ditulis "-", dan
// TIDAK ikut total. Menuliskannya 0 membuat total terlihat rapi dan lebih
// kecil dari kenyataan.
// =====================================================================
{
  // `entry_amount` SENGAJA tidak sama dengan jumlah baris berharga: notanya
  // Rp50.000, tapi Rp30.000 di antaranya ada di baris yang belum diisi
  // harganya. Kalau baris tanpa harga diperlakukan sebagai nol, selisih itu
  // muncul sebagai "koreksi nota" — tuduhan atas sesuatu yang tidak terjadi.
  const { rows, note } = susunMutasiKas({
    baris: [
      bahan({ entry_id: 'E1', item: 'Gula', nominal: -20000, entry_amount: -50000 }),
      bahan({ entry_id: 'E1', item: 'Lombok', nominal: null, entry_amount: -50000 })
    ]
  });
  cek('§3 tidak ada baris rekonsiliasi', rows.filter((r) => r[K['Kategori']] === KATEGORI_REKONSILIASI).length, 0);
  cek('§3 baris tanpa harga ditulis "-" di kedua kolom nominal', [rows[1][K['Masuk']], rows[1][K['Keluar']]], ['-', '-']);
  cek('§3 dan tidak ikut total', rows[rows.length - 1][K['Keluar']], formatRupiah(20000));
  benar('§3 jumlahnya disebut di catatan', note.includes('belum berharga'));
}

// `selisihRekonsiliasi` sendiri, supaya aturannya tidak cuma teruji lewat tabel.
cek('§3 selisihRekonsiliasi: ada yang tanpa harga -> null', selisihRekonsiliasi([{ nominal: -10 }, { nominal: null }], -100), null);
cek('§3 selisihRekonsiliasi: entry_amount kosong -> null', selisihRekonsiliasi([{ nominal: -10 }], null), null);
cek('§3 selisihRekonsiliasi: cocok -> null', selisihRekonsiliasi([{ nominal: -10 }, { nominal: -90 }], -100), null);
cek('§3 selisihRekonsiliasi: beda -> selisihnya', selisihRekonsiliasi([{ nominal: -10 }, { nominal: -90 }], -80), 20);

// =====================================================================
// §4 ANGKA YANG TIDAK MASUK AKAL TIDAK BOLEH LOLOS KE LAPORAN
//
// `Number('')` dan `Number(null)` adalah 0 — bukan NaN. Dan `Infinity` yang
// lolos ke `formatRupiah` muncul sebagai "Rp∞" di laporan keuangan.
// =====================================================================
{
  const { rows, summary } = susunMutasiKas({
    baris: [
      bahan({ entry_id: 'E1', item: 'Rusak', nominal: Infinity, entry_amount: -100 }),
      bahan({ entry_id: 'E2', item: 'Rusak juga', nominal: NaN, entry_amount: -100 }),
      bahan({ entry_id: 'E3', item: 'Kosong', nominal: '', entry_amount: -100 })
    ]
  });
  for (const r of rows) {
    for (const sel of r) {
      benar('§4 tidak ada ∞ / NaN di sel mana pun', !/∞|NaN|Infinity/.test(String(sel)), String(sel));
    }
  }
  for (const s of summary) {
    benar('§4 tidak ada ∞ / NaN di ringkasan', !/∞|NaN|Infinity/.test(String(s.value)), String(s.value));
  }
  cek('§4 ketiganya dianggap belum berharga', rows[rows.length - 1][K['Keluar']], formatRupiah(0));
}

// =====================================================================
// §5 SATU ENTRI MELUNASI BEBERAPA NOTA
//
// `bayar_nota` menerima `uuid[]`. Baris rekonsiliasinya tidak boleh menunjuk
// satu nomor nota saja — itu menuduh satu nota atas selisih yang bisa berasal
// dari nota lain di entri yang sama.
// =====================================================================
{
  const { rows } = susunMutasiKas({
    baris: [
      bahan({ entry_id: 'E1', nota_code: 'NT-0001', item: 'Lombok', nominal: -10000, entry_amount: -50000 }),
      bahan({ entry_id: 'E1', nota_code: 'NT-0002', item: 'Beras', nominal: -30000, entry_amount: -50000 })
    ]
  });
  const rekon = rows.find((r) => r[K['Kategori']] === KATEGORI_REKONSILIASI);
  benar('§5 baris rekonsiliasi ada', !!rekon);
  benar('§5 tidak menuduh satu nota tertentu', !/NT-000\d/.test(rekon[K['Rincian']]), rekon?.[K['Rincian']]);
  cek('§5 kolom notanya dikosongkan', rekon[K['No. Nota']], '-');
}

// =====================================================================
// §6 KOSONG & TANDA NOTA BATAL
// =====================================================================
{
  const { rows, summary, bold } = susunMutasiKas({ baris: [] });
  cek('§6 kosong: tidak ada baris TOTAL palsu', rows, []);
  cek('§6 kosong: tidak ada yang ditebalkan', bold, []);
  cek('§6 kosong: ringkasan tetap ada', summary.length > 0, true);
}
{
  const { rows } = susunMutasiKas({
    baris: [bahan({ entry_id: 'E1', item: 'Gula', nominal: -20000, entry_amount: -20000, nota_batal: true })]
  });
  benar('§6 nota batal ditandai di kolom notanya', String(rows[0][K['No. Nota']]).includes('batal'));
}

// =====================================================================
// §7 URUTAN MASUKAN DIPERTAHANKAN
//
// Server sudah menentukan urutannya. Mengurutkan ulang di layar berarti dua
// sumber urutan yang bisa menyimpang — dan penomoran halaman `ambilSemua`
// bergantung pada urutan server.
// =====================================================================
{
  const { rows } = susunMutasiKas({
    baris: [
      kas({ entry_id: 'E3', item: 'Ketiga', nominal: -3, entry_amount: -3, entry_date: '2026-09-03' }),
      kas({ entry_id: 'E1', item: 'Pertama', nominal: -1, entry_amount: -1, entry_date: '2026-09-01' }),
      kas({ entry_id: 'E2', item: 'Kedua', nominal: -2, entry_amount: -2, entry_date: '2026-09-02' })
    ]
  });
  cek('§7 urutan tidak diubah', kolom(rows.slice(0, 3), 'Rincian'), ['Ketiga', 'Pertama', 'Kedua']);
}

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('mutasi-kas.js benar — rincian per item, rekonsiliasi nota terkoreksi, dan baris tanpa harga tidak dipalsukan jadi nol. ✅');
