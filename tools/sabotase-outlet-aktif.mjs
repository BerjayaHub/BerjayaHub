/**
 * SABOTASE: outlet aktif Staff App.
 *
 * Yang dijaga bukan "aplikasinya jalan", melainkan bahwa sesi sebuah BU TIDAK
 * PERNAH memakai outlet BU lain. Kegagalannya diam: modul hilang, daftar
 * kosong, dan data tersimpan di tempat yang salah — tanpa satu pun error.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const INTI = 'js/core/outlet-aktif.js';
const SHELL = 'js/main-staff.js';

const asli = new Map();
for (const rel of [INTI, SHELL]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

const pulih = () => {
  for (const [rel, isi] of asli) fs.writeFileSync(P(rel), isi);
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

const TES = 'tools/test-outlet-aktif.mjs';
const AUDIT = 'tools/audit-outlet-aktif.cjs';

console.log('SABOTASE ATURAN MURNI:');

sabotase(
  'INTI: cakupan tidak lagi disaring per BU (bug aslinya kembali)',
  INTI,
  's?.business_unit_id === buId',
  'true',
  TES
);
sabotase(
  'pilihan tersimpan dipakai tanpa diperiksa masih boleh',
  INTI,
  'const dariIngatan = tersimpan ? ambil(tersimpan) : null;',
  'const dariIngatan = tersimpan ? { id: tersimpan } : null;',
  TES
);
sabotase(
  'peran dibaca dari embed cakupan, bukan dari daftar outlet',
  INTI,
  'outletRole: dariCakupan.outlet_role ?? null,',
  'outletRole: cakupan.outlets?.outlet_role ?? null,',
  TES
);
sabotase(
  'dua outlet tanpa cakupan ditebak, bukan diminta memilih',
  INTI,
  'return { outletId: null, outletRole: null, sebab: \'tidak-ada\' };',
  "return { outletId: daftar[0]?.id ?? null, outletRole: daftar[0]?.outlet_role ?? null, sebab: 'tidak-ada' };",
  TES
);
sabotase(
  'outlet belum dipilih menyembunyikan modul',
  INTI,
  'if (!outletRole) return true;',
  'if (!outletRole) return kode !== \'production\';',
  TES
);
sabotase('Produksi muncul di outlet non-CK', INTI, "if (kode === 'production') return outletRole === 'central_kitchen';", "if (kode === 'production') return true;", TES);
sabotase(
  'Menu/Reservasi muncul di central kitchen',
  INTI,
  "if (kode === 'menu' || kode === 'reservation') return outletRole !== 'central_kitchen';",
  "if (kode === 'menu' || kode === 'reservation') return true;",
  TES
);
sabotase(
  'Penjualan dikunci lagi ke peran outlet — CK tidak bisa mencatat tumpengnya',
  INTI,
  "  if (kode === 'sales') return bolehJual !== false;",
  "  if (kode === 'sales') return outletRole !== 'central_kitchen';",
  TES
);
sabotase(
  'setelan "tidak boleh jual" diabaikan — centang di Admin Portal jadi hiasan',
  INTI,
  "  if (kode === 'sales') return bolehJual !== false;",
  "  if (kode === 'sales') return true;",
  TES
);
sabotase('satu-satunya outlet tidak dipakai', INTI, 'if (daftar.length === 1) {', 'if (false) {', TES);

console.log('\nSABOTASE YANG HANYA AUDIT YANG BISA MENANGKAP (jalur layar):');

sabotase(
  'setelan jual tidak diteruskan ke aturannya — kartunya tampil di semua outlet',
  SHELL,
  'modulUntukPeran(mod.code, role, { bolehJual: moduleCtx.bolehJual })',
  'modulUntukPeran(mod.code, role)',
  AUDIT
);
sabotase(
  'allow_sales outlet aktif tidak dibaca — bolehJual tidak punya sumber',
  SHELL,
  '?.allow_sales !== false',
  '!== null',
  AUDIT
);

sabotase(
  'fallback `?? context.scopes[0]` dikembalikan',
  SHELL,
  'const pilihanOutlet = outletAktif({',
  'const _lama = context.scopes.filter((s) => s.business_unit_id === activeBuId)[0] ?? context.scopes[0];\n  const pilihanOutlet = outletAktif({',
  AUDIT
);
sabotase('pemilih outlet dihapus', SHELL, /id="outlet-switcher-staff"/g, 'id="outlet-x"', AUDIT);
sabotase(
  'pilihan outlet diingat dengan satu kunci bersama',
  SHELL,
  /staff_outlet_\$\{activeBuId\}/g,
  'staff_outlet',
  AUDIT
);
sabotase('keadaan "belum dipilih" tidak dikatakan', SHELL, 'Outlet belum dipilih', 'Siap', AUDIT);
sabotase('layar menulis ulang aturannya sendiri', SHELL, /modulUntukPeran\(/g, 'cocokPeran(', AUDIT);

console.log('');
if (gagal === 0) console.log('Semua sabotase outlet-aktif tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
