/**
 * SABOTASE 0124 — memeriksa bahwa tes & auditnya benar-benar MENGGIGIT.
 *
 * `geser_harga_nota` adalah satu-satunya fungsi di repo ini yang MENULIS ULANG
 * angka uang yang sudah tersimpan, jadi tiap penjagaannya dirusak satu per
 * satu di sini.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0124_geser_harga_ke_harga_beli.sql';
const HAL = 'js/modules/inventory/nota-staff.js';
const SVC = 'js/modules/inventory/nota.service.js';

const asli = new Map();
for (const rel of [MIG, HAL, SVC]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

// ============ JEJAK "SABOTASE SEDANG TERPASANG" ============
//
// `process.on('exit')` TIDAK berjalan kalau prosesnya di-SIGKILL — mis. saat
// harness ini kena batas waktu di luar. Yang tertinggal adalah berkas repo
// yang masih tersabotase, dan ia TIDAK terlihat sebagai apa pun: migration-nya
// tetap sah, aplikasinya tetap jalan, dan satu-satunya tanda adalah satu tes
// yang merah entah kenapa berjam-jam kemudian.
//
// Itu benar-benar terjadi: `0153` tertinggal dengan `if false then` di tempat
// penjaga "kas keluar harus menyebut outlet peruntukannya".
//
// Jadi penanda ini ditulis SEBELUM berkas pertama dirusak dan dibuang sesudah
// semuanya pulih. `tools/audit-sisa-sabotase.cjs` berteriak kalau ia tertinggal.
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
  // ============ MODE PERIKSA POLA TIDAK MEMULIHKAN APA PUN ============
  //
  // Karena ia tidak pernah merusak apa pun. `fs.writeFileSync` dengan isi yang
  // SAMA tetap sebuah penulisan: berkasnya dipotong lebih dulu, lalu diisi
  // ulang. Proses lain yang kebetulan membacanya pada milidetik itu melihat
  // berkas kosong atau separuh.
  //
  // Itu benar-benar terjadi: `audit-sabotase-terpasang.cjs` menjalankan 53
  // harness sekaligus, ketiganya-puluh-tiga menulis ulang berkasnya saat
  // keluar, dan `audit-import-ekspor.cjs` yang berjalan berbarengan melaporkan
  // "mengimpor REPORTS tapi berkasnya tidak mengekspornya" — untuk berkas yang
  // isinya tidak pernah berubah sedetik pun.
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

let gagal = 0;
const sabotase = (nama, rel, dari, ke, pemeriksa) => {
  const isi = asli.get(rel);
  const rusak = isi.replace(dari, ke);
  if (rusak === isi) {
    gagal++;
    console.error(`❌ SABOTASE TIDAK TERPASANG: ${nama} — polanya tidak ketemu di ${rel}.`);
    return;
  }
  // ============ MODE PERIKSA POLA ============
  //
  // Dipakai `tools/audit-sabotase-terpasang.cjs`: berhenti TEPAT sesudah pola
  // `dari` dipastikan cocok, sebelum satu berkas pun disentuh.
  //
  // Alasannya satu kejadian nyata: `sabotase-0132.mjs` basi sejak `0142` —
  // tiga polanya tidak cocok lagi dengan kodenya — dan tidak ada yang tahu
  // berbulan-bulan, karena harness sabotase berat (tiap sabotase menjalankan
  // pemeriksanya sendiri) sehingga tidak pernah ikut sweep rutin. Harness yang
  // polanya tidak terpasang TIDAK menguji apa pun, dan ia melaporkannya hanya
  // kalau ada yang menjalankannya.
  //
  // Mode ini tidak menjalankan pemeriksa sama sekali, jadi seluruh 50+ harness
  // bisa disapu dalam hitungan detik.
  if (process.env.SABOTASE_PERIKSA_POLA) {
    console.log(`   \u2714 pola terpasang: ${nama}`);
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

const TES = 'tools/test-migrasi-0124.mjs';
const AUDIT = 'tools/audit-geser-harga.cjs';

console.log('SABOTASE MIGRATION:');

sabotase(
  'INTI: penggeserannya dibalik (per satuan jadi harga beli)',
  MIG,
  'set line_total = unit_cost,\n         unit_cost = unit_cost / qty',
  'set line_total = qty * unit_cost,\n         unit_cost = unit_cost',
  TES
);
sabotase(
  'harganya dibagi dua kali (dipecah jadi dua pernyataan)',
  MIG,
  'set line_total = unit_cost,\n         unit_cost = unit_cost / qty',
  'set unit_cost = unit_cost / qty,\n         line_total = unit_cost / qty',
  TES
);
sabotase('nota bisa digeser dua kali', MIG, 'if v_nota.harga_digeser_at is not null then', 'if false then', TES);
sabotase('nota lunas ikut bisa digeser', MIG, "if v_nota.payment_status = 'lunas' then", 'if false then', TES);
sabotase('wewenang outlet tidak diperiksa', MIG, 'if not has_outlet_scope(v_uid, v_nota.outlet_id) then', 'if false then', TES);
sabotase(
  'stock_movements tertinggal — biaya rata-rata tetap salah',
  MIG,
  /  update stock_movements sm\n     set unit_cost = i\.unit_cost\n    from goods_receipt_items i\n   where sm\.receipt_id = any\(p_notas\)\n     and i\.receipt_id = sm\.receipt_id\n     and i\.product_id = sm\.product_id\n     and sm\.qty_delta > 0;/,
  '',
  TES
);
sabotase('penandanya tidak dipasang', MIG, 'set harga_digeser_at = now(), harga_digeser_by = v_uid', 'set harga_digeser_by = v_uid', TES);
sabotase(
  'baris tanpa harga ikut disentuh',
  MIG,
  'and unit_cost is not null\n     and qty > 0;',
  'and qty > 0;',
  TES
);
sabotase(
  'pratinjaunya salah hitung',
  MIG,
  'coalesce(sum(i.unit_cost) filter (where i.unit_cost is not null), 0) as total_jika_digeser',
  'coalesce(sum(i.qty * i.unit_cost), 0) as total_jika_digeser',
  TES
);

console.log('\nSABOTASE YANG HANYA AUDIT YANG BISA MENANGKAP (jalur layar):');

sabotase('tombolnya dihapus', HAL, 'id="nota-geser-harga"', 'id="nota-geser-x"', AUDIT);
sabotase(
  'tombolnya ada tapi tidak terhubung',
  HAL,
  "wadah.querySelector('#nota-geser-harga').addEventListener('click', sekaliJalan(bukaGeserHarga));",
  '',
  AUDIT
);
sabotase('pratinjau sesudah-digeser dihapus dari dialognya', HAL, /total_jika_digeser/g, 'total', AUDIT);
sabotase('nota lunas ikut ditawarkan', HAL, "payment_status !== 'lunas'", 'true', AUDIT);
sabotase('nota yang sudah digeser ikut ditawarkan lagi', HAL, '!n.harga_digeser_at', 'true', AUDIT);
sabotase('service berhenti memanggil RPC-nya', SVC, "rpc('geser_harga_nota'", "rpc('x'", AUDIT);

console.log('');
if (gagal === 0) console.log('Semua sabotase 0124 tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
