/**
 * SABOTASE 0122 — memeriksa bahwa tes & auditnya benar-benar MENGGIGIT.
 *
 * Dua sabotase pertama yang saya coba pada 0122 LOLOS, dan keduanya lolos
 * karena tesnya lulus dengan alasan yang berbeda dari namanya: penolakan yang
 * datang dari pemeriksaan WEWENANG dibaca sebagai penolakan lintas-outlet.
 * Berkas ini ada supaya kesalahan sejenis tidak diam-diam menetap.
 *
 * Filenya dipulihkan lewat `process.on('exit')` juga: sesi yang mati karena
 * timeout pernah meninggalkan migration dalam keadaan tersabotase.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0122_nota_status_bayar.sql';
const SVC = 'js/modules/inventory/nota.service.js';
const HAL = 'js/modules/inventory/nota-staff.js';
const ATURAN = 'js/modules/inventory/hutang-nota.js';

const asli = new Map();
for (const rel of [MIG, SVC, HAL, ATURAN]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

const pulih = () => {
  for (const [rel, isi] of asli) fs.writeFileSync(P(rel), isi);
};
process.on('exit', pulih);
process.on('SIGINT', () => process.exit(130));

const jalan = (cmd) => {
  try {
    execFileSync('node', [cmd], { cwd: AKAR, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};

let gagal = 0;
const sabotase = (nama, rel, dari, ke, pemeriksa) => {
  const isi = asli.get(rel);
  const rusak = isi.replace(dari, ke);
  if (rusak === isi) {
    gagal++;
    console.error(`❌ SABOTASE TIDAK TERPASANG: ${nama} — polanya tidak ketemu di ${rel}.`);
    return;
  }
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

const TES = 'tools/test-migrasi-0122.mjs';
const TES_ATURAN = 'tools/test-hutang-nota.mjs';
const AUDIT = 'tools/audit-hutang-nota.cjs';

console.log('SABOTASE MIGRATION (ditangkap tes di Postgres sungguhan):');

sabotase('nota berbaris tanpa harga boleh dibayar', MIG, 'if v_tanpa_harga > 0 then', 'if false then', TES);
sabotase('pembayaran lintas outlet dibiarkan', MIG, 'if v_outlet_lain > 1 then', 'if false then', TES);
sabotase('nota lunas boleh diubah isinya', MIG, "if v_status = 'lunas' then\n    raise exception 'Nota %", "if false then\n    raise exception 'Nota %", TES);
// PERLU DICATAT JUJUR: `deferrable initially deferred` BUKAN penjaga di sini,
// dan sabotase yang menggantinya dengan `immediate` memang lolos.
//
// Alasannya: trigger AFTER di Postgres diantrikan sampai akhir pernyataan
// TERLUAR, bukan pernyataan di dalam fungsi. Untuk `select bayar_nota(...)`
// pernyataan terluarnya adalah panggilan fungsinya sendiri, jadi saat
// triggernya menyala notanya sudah menunjuk entri itu — dengan atau tanpa
// penundaan. `immediate` bahkan sedikit lebih ketat.
//
// Yang benar-benar load-bearing adalah ADANYA pemeriksa itu. Jadi itu yang
// disabotase, bukan cara penundaannya.
sabotase('pemeriksa untuk_nota dimatikan', MIG, 'when (new.untuk_nota)', 'when (false)', TES);
sabotase(
  'kewajiban foto dicabut seluruhnya, bukan dilonggarkan sempit',
  MIG,
  "check (entry_type <> 'out' or proof_path is not null or untuk_nota)",
  'check (true)',
  TES
);
sabotase('entri kas tidak ditandai untuk_nota', MIG, 'v_uid, true\n    )', 'v_uid, false\n    )', TES);
sabotase(
  'pembatalan hanya melepas satu nota, bukan seluruh pembayarannya',
  MIG,
  '   where payment_entry_id = v_entry;\n\n  return v_jml;',
  '   where id = p_nota;\n\n  return v_jml;',
  TES
);
sabotase('entri balik bernilai nol', MIG, "'in', abs(v_asli.amount),", "'in', 0,", TES);
sabotase('pembatalan menghapus entri aslinya', MIG, 'update goods_receipts\n     set payment_status = \'belum\', paid_at = null, paid_by = null, payment_entry_id = null\n   where payment_entry_id = v_entry;', 'delete from cash_entries where id = v_entry;\n  update goods_receipts\n     set payment_status = \'belum\', paid_at = null, paid_by = null, payment_entry_id = null\n   where payment_entry_id = v_entry;', TES);
sabotase('nota bertotal 0 dipaksa membuat entri kas', MIG, 'if v_total > 0 then', 'if v_total >= 0 then', TES);
sabotase('view salah menghitung baris tanpa harga', MIG, 'filter (where i.unit_cost is null)', 'filter (where false)', TES);
sabotase('jatuh tempo boleh diubah pada nota lunas', MIG, "if v_status = 'lunas' then\n    raise exception 'Nota ini sudah lunas", "if false then\n    raise exception 'Nota ini sudah lunas", TES);

console.log('\nSABOTASE ATURAN MURNI:');

sabotase('nota lunas ikut terhitung sebagai hutang', ATURAN, "if (n?.payment_status === 'lunas') continue;\n    const nama", 'if (false) continue;\n    const nama', TES_ATURAN);
sabotase('baris tanpa harga tidak lagi menghalangi pembayaran', ATURAN, 'if (kurang.length) {', 'if (false) {', TES_ATURAN);
sabotase('jatuh tempo hari ini dianggap sudah terlambat', ATURAN, 'if (due < hariIni)', 'if (due <= hariIni)', TES_ATURAN);
sabotase('dua outlet dibiarkan dibayar bersama', ATURAN, 'if (outlet.size > 1) {', 'if (false) {', TES_ATURAN);
sabotase('supplier tanpa nama hilang dari daftar', ATURAN, '|| TANPA_SUPPLIER', "|| ''", TES_ATURAN);

console.log('\nSABOTASE YANG HANYA AUDIT YANG BISA MENANGKAP (jalur layar):');

sabotase('tab Hutang Supplier dihapus dari layar', HAL, 'data-nota-tab="hutang"', 'data-nota-tab="x"', AUDIT);
sabotase('tab Hutang Supplier ada tapi tidak terhubung', HAL, "if (b.dataset.notaTab === 'hutang') gambarHutang();", '', AUDIT);
// Regex GLOBAL, bukan string.
//
// `String.replace` dengan string hanya mengganti kemunculan PERTAMA — jadi
// sabotasenya menyisakan kemunculan lain di file yang sama, dan auditnya tetap
// menemukan namanya di situ. Dua sabotase di berkas ini pernah lolos persis
// karena itu, dan keduanya terlihat seperti audit yang lemah padahal yang
// lemah adalah sabotasenya.
sabotase('pilihan Tunai/Tempo dihapus', HAL, /nota-bayar-cara/g, 'nota-bayar-x', AUDIT);
sabotase(
  'kegagalan setelah nota tersimpan dilaporkan sebagai gagal simpan',
  HAL,
  'Nota TERSIMPAN dan stoknya sudah bertambah, tapi ',
  'Gagal menyimpan nota: ',
  AUDIT
);
sabotase('penjelasan biaya-vs-kas lintas bulan dihapus', HAL, 'tanggal pembayaran', 'nanti', AUDIT);
sabotase('pembatalan tidak menyebut nota lain yang ikut terbawa', HAL, /nota lain/g, 'catatan', AUDIT);
sabotase(
  'status bayar tidak diambil di riwayat',
  SVC,
  "const bayar = ', payment_status, due_date, payment_entry_id';",
  "const bayar = '';",
  AUDIT
);
sabotase('daftar nota dipotong tanpa kotak pencarian', HAL, /id="nota-cari"/g, 'id="nota-x"', AUDIT);
sabotase('daftar nota dipotong tanpa tombol muat lebih banyak', HAL, /id="nota-lagi"/g, 'id="nota-y"', AUDIT);
sabotase('jatuh tempo tidak bisa diubah setelah nota tersimpan', HAL, 'setJatuhTempoNota(nota.id', 'noop(nota.id', AUDIT);
sabotase('tombol Tunai/Tempo hilang dari tab hutang', HAL, /class="hutang-tempo"/g, 'class="x"', AUDIT);
sabotase('nota di tab hutang tidak bisa diisi harganya', HAL, /class="hutang-edit"/g, 'class="y"', AUDIT);
sabotase('aturan hutang membaca jam sistem sendiri', ATURAN, 'export function statusTempo(nota, hariIni) {', 'export function statusTempo(nota, hariIni = new Date()) {', AUDIT);

console.log('');
if (gagal === 0) console.log('Semua sabotase 0122 tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
