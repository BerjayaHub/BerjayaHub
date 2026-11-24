/**
 * SABOTASE: impor & laporan bengkel (0185–0188).
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Tiap kerusakan di modul ini berbentuk sama: angkanya tetap keluar, tetap
 * rapi, tetap masuk akal. Tidak ada galat, tidak ada baris merah, tidak ada
 * momen yang bisa ditunjuk sebagai saat ia mulai salah. Yang menemukannya
 * adalah orang yang membaca laporan sebulan kemudian — kalau ia menemukannya.
 *
 * Satu di antaranya SUNGGUH TERJADI dan baru ketangkap oleh audit yang
 * dipasang belakangan: `kirim_ke` tidak ikut dikirim ke server, jadi SELURUH
 * pembelian masuk sebagai pembelian pusat dan penyaringan per outlet tidak
 * pernah bekerja untuk satu baris pun. Impornya berhasil, jumlah barisnya
 * benar, nilainya benar, dan layar impor tetap menampilkan daftar alamat yang
 * perlu dipetakan — karena ia membacanya dari berkas, bukan dari jawaban
 * server. Itu sebabnya daftar di bawah ini ada.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const INV = 'js/modules/bengkel/baca-invoice-turboly.js';
const PO = 'js/modules/bengkel/baca-po-turboly.js';
const COCOK = 'js/modules/bengkel/cocokkan-beli-jual.js';
const SHEET = 'js/modules/bengkel/laporan-bentuk-sheet.js';
const KORPORAT = 'js/modules/bengkel/baris-korporat.js';
const SVC = 'js/modules/bengkel/penjualan-rinci.service.js';
const M185 = 'supabase/migrations/0185_penjualan_bengkel_rinci.sql';
const M186 = 'supabase/migrations/0186_pembelian_bengkel.sql';
const M188 = 'supabase/migrations/0188_tarik_impor_menyeluruh.sql';

const BERKAS = [INV, PO, COCOK, SHEET, KORPORAT, SVC, M185, M186, M188];
const asli = new Map();
for (const rel of BERKAS) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

const PENANDA = path.join(AKAR, 'tools/.sabotase-aktif');
const tandai = (rel) => fs.writeFileSync(PENANDA, `${path.basename(process.argv[1])} merusak ${rel}\n`);
const lepasTanda = () => {
  try {
    fs.unlinkSync(PENANDA);
  } catch {
    /* belum pernah ada — tidak apa-apa */
  }
};

const pulih = () => {
  if (process.env.SABOTASE_PERIKSA_POLA) return lepasTanda();
  for (const [rel, isi] of asli) fs.writeFileSync(P(rel), isi);
  lepasTanda();
};
process.on('exit', pulih);
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

const jalan = (cmd) => {
  try {
    execFileSync('node', [cmd], { cwd: AKAR, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};

// Pemeriksa yang sudah merah sejak awal melaporkan SELURUH sabotase sebagai
// tertangkap, dan harness ini berubah jadi stempel.
const pastikanHijau = (cmd) => {
  if (process.env.SABOTASE_PERIKSA_POLA) return;
  if (!jalan(cmd)) {
    console.error(`❌ PEMERIKSANYA SUDAH MERAH SEBELUM DISABOTASE: ${cmd} — "tertangkap" di bawah tidak berarti apa-apa.`);
    process.exit(1);
  }
};

let gagal = 0;
const sabotase = (nama, rel, dari, ke, pemeriksa) => {
  if (!fs.existsSync(P(pemeriksa))) {
    gagal++;
    console.error(`❌ PEMERIKSANYA TIDAK ADA: ${pemeriksa} — "tertangkap" di sini tidak berarti apa-apa.`);
    return;
  }
  const isi = asli.get(rel);
  const rusak = isi.replace(dari, ke);
  if (rusak === isi) {
    gagal++;
    console.error(`❌ SABOTASE TIDAK TERPASANG: ${nama} — polanya tidak ketemu di ${rel}.`);
    return;
  }
  if (typeof dari === 'string' && isi.split(dari).length > 2) {
    gagal++;
    console.error(`❌ POLANYA MUNCUL >1 KALI: ${nama} di ${rel} — sabotasenya cuma mengenai yang pertama.`);
    return;
  }
  if (process.env.SABOTASE_PERIKSA_POLA) {
    console.log(`   ✔ pola terpasang: ${nama}`);
    return;
  }
  tandai(rel);
  fs.writeFileSync(P(rel), rusak);
  const hijau = jalan(pemeriksa);
  pulih();
  if (hijau) {
    gagal++;
    console.error(`❌ LOLOS: ${nama}\n   ${pemeriksa} tetap hijau padahal ${rel} sudah dirusak.`);
  } else {
    console.log(`   ✔ tertangkap: ${nama}`);
  }
};

const AUDIT = 'tools/audit-bengkel-turboly.cjs';
const T_INV = 'tools/test-baca-invoice-turboly.mjs';
const T_PO = 'tools/test-baca-po-turboly.mjs';
const T_COCOK = 'tools/test-cocokkan-beli-jual.mjs';
const T_SHEET = 'tools/test-laporan-bentuk-sheet.mjs';
const T_KORP = 'tools/test-baris-korporat.mjs';

for (const p of [AUDIT, T_INV, T_PO, T_COCOK, T_SHEET, T_KORP]) pastikanHijau(p);

// =====================================================================
console.log('SABOTASE: MODAL YANG SALAH TAFSIR');
// =====================================================================

// `Cost` adalah TOTAL satu baris. Dikalikan qty, HPP oli 4 liter jadi 1,8 juta
// alih-alih 459 ribu — dan labanya tetap berupa angka yang bisa dibaca.
sabotase(
  'Cost diperlakukan sebagai harga per unit (dikalikan qty)',
  INV,
  '        else r.modal += Number(b.modal) || 0;',
  '        else r.modal += (Number(b.modal) || 0) * (Number(b.qty) || 0);',
  AUDIT
);

sabotase(
  'baris tanpa modal tidak dihitung (modal kosong jadi nol, laba 100%)',
  INV,
  '        if (b.modal === null || b.modal === undefined) r.tanpaModal += 1;',
  '        if (false) r.tanpaModal += 1;',
  AUDIT
);

// Jasa tidak punya modal barang. Dicampur, margin sparepart terlihat jauh
// lebih sehat daripada kenyataannya.
sabotase(
  'laba dihitung dari seluruh omzet, termasuk jasa',
  INV,
  '  r.laba = r.omzetSparepart - r.modal;',
  '  r.laba = r.omzet - r.modal;',
  AUDIT
);

sabotase(
  'modal korporat yang dikosongkan disimpan sebagai nol',
  KORPORAT,
  "      modal: m === '' ? '' : String(angkaIsian(m))",
  "      modal: m === '' ? '0' : String(angkaIsian(m))",
  T_KORP
);

// =====================================================================
console.log('\nSABOTASE: HEADER & BERKAS YANG SALAH');
// =====================================================================

sabotase(
  'baris header dipatok, bukan dicari dari isinya',
  INV,
  '  for (let i = 0; i < daftar.length; i++) {',
  '  for (let i = 8; i < Math.min(9, daftar.length); i++) {',
  T_INV
);

// =====================================================================
console.log('\nSABOTASE: OUTLET PEMBELIAN');
// =====================================================================

// Yang SUNGGUH pernah terjadi: seluruh pembelian jadi pembelian pusat, tanpa
// satu pun galat di mana pun.
sabotase(
  'tujuan pengiriman tidak ikut dikirim ke server',
  PO,
  "    kirim_ke: b.kirim_ke ?? '',",
  '',
  T_PO
);

sabotase(
  'Deliver To tidak lagi dipetakan (outlet diambil dari Warehouse)',
  PO,
  "  'Deliver To': 'kirim_ke'",
  "  'Deliver To': 'warehouse_tujuan'",
  AUDIT
);

sabotase(
  'outlet pembelian dicari di pemetaan Store, bukan pemetaan alamat kirim',
  M186,
  "       where business_unit_id = p_bu and jenis = 'kirim' and lower(btrim(store_name)) = lower(v_alamat);",
  '       where business_unit_id = p_bu and lower(btrim(store_name)) = lower(v_alamat);',
  AUDIT
);

sabotase(
  'baris tanpa outlet tidak dihitung sebagai pembelian pusat',
  M186,
  '    if v_outlet is null then v_pusat := v_pusat + 1; end if;',
  '',
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE: HARGA NOL VS HARGA KOSONG');
// =====================================================================

sabotase(
  '"semua harganya nol" tidak lagi menuntut SELURUH barisnya nol',
  PO,
  '  return ringkas.hargaNol + ringkas.tanpaHarga === ringkas.baris;',
  '  return ringkas.hargaNol + ringkas.tanpaHarga > 0;',
  T_PO
);

// =====================================================================
console.log('\nSABOTASE: PENCOCOKAN FIFO');
// =====================================================================

// Barang tidak bisa terjual sebelum dibeli. Tanpa penjagaan ini, pembelian
// bulan depan "membiayai" penjualan bulan ini — dan labanya terlihat wajar.
sabotase(
  'pembelian sesudah tanggal penjualan ikut dipakai',
  COCOK,
  '      if (b._tgl && j._tgl && b._tgl > j._tgl) continue;',
  '',
  T_COCOK
);

sabotase(
  '"ketemu sebagian" disamakan dengan "ketemu"',
  COCOK,
  '    const asal = terambil <= 0 ? ASAL.TIDAK_KETEMU : butuh > 0 ? ASAL.SEBAGIAN : ASAL.COCOK;',
  '    const asal = terambil <= 0 ? ASAL.TIDAK_KETEMU : ASAL.COCOK;',
  T_COCOK
);

// =====================================================================
console.log('\nSABOTASE: BENTUK SHEET');
// =====================================================================

// "qty jangan dibuat Rp ya, itu yang dicontoh spreadsheet salah"
sabotase(
  'QTY kembali diformat sebagai rupiah',
  SHEET,
  "  { header: 'QTY', numeric: true, uang: false, width: 7 },\n  { header: 'Harga Beli Satuan'",
  "  { header: 'QTY', numeric: true, uang: true, width: 7 },\n  { header: 'Harga Beli Satuan'",
  AUDIT
);

// Nilai bawaan yang tidak ditulis adalah cara QTY diam-diam jadi "Rp191"
// lagi — dan satu-satunya yang melihatnya adalah pembaca berkasnya.
sabotase(
  'satu kolom angka berhenti menyatakan `uang`',
  SHEET,
  "  { header: 'Rounding/Pembulatan', numeric: true, uang: true, width: 16 },",
  "  { header: 'Rounding/Pembulatan', numeric: true, width: 16 },",
  AUDIT
);

sabotase(
  'asal harga beli (nota vs tebakan FIFO) tidak lagi ditulis',
  SHEET,
  "'Asal Harga Beli'",
  "'Keterangan'",
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE: IMPOR YANG MENGGANDAKAN / MENIMPA');
// =====================================================================

sabotase(
  'invoice korporat bisa ditimpa berkas Turboly',
  M185,
  "    if v_id is not null and v_sumber = 'korporat' then",
  '    if false then',
  AUDIT
);

sabotase(
  'store yang belum dipetakan dilewati tanpa dilaporkan',
  M185,
  '      if not (v_store = any(v_lewat_store)) then v_lewat_store := v_lewat_store || v_store; end if;',
  '',
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE: TARIK KEMBALI SATU BERKAS');
// =====================================================================

// "tambahkan lagi bisa hapus satu dokumen excel import yang sudah terlanjur
//  diupload, jadi semua nomor SRI atau PO dalam satu excel yang diimport
//  hilang semua"
sabotase(
  'penarikan menyeluruh ikut menyapu invoice korporat',
  M188,
  "         and sumber = 'turboly'\n",
  '',
  AUDIT
);

sabotase(
  'penarikan tidak meninggalkan jejak di riwayat',
  M188,
  '     set ditarik_at = now(), ditarik_by = v_uid,',
  '     set ditarik_by = v_uid,',
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE: KLIEN');
// =====================================================================

// Batas bawaan PostgREST 1000 baris memotong diam-diam, dan laporan yang
// kurang 200 baris tetap tercetak rapi.
sabotase(
  'baris pembelian dibaca satu permintaan (terpotong di 1000)',
  SVC,
  '  return ambilSemua((awal, akhir) => {\n    let q = supabase\n      .from(\'bengkel_pembelian_rinci\')',
  "  return (async () => {\n    let q = supabase\n      .from('bengkel_pembelian_rinci')",
  AUDIT
);

// PostgREST memilih fungsi lewat himpunan nama argumen: kunci yang hilang
// mencari tanda tangan yang sudah sengaja dibuang di 0188.
sabotase(
  'kunci `p_semua` tidak selalu dikirim',
  SVC,
  '    argumenRpc({ p_run: runId, p_alasan: alasan, p_semua: Boolean(semua) })',
  '    argumenRpc({ p_run: runId, p_alasan: alasan })',
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS — pemeriksanya belum cukup.`);
process.exit(gagal === 0 ? 0 : 1);
