/**
 * SABOTASE: urutan daftar aset — yang ada di outlet ini di baris atas.
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Perubahan ini SELURUHNYA tentang urutan, dan urutan yang salah tetap
 * terlihat seperti urutan. Tidak ada galat, tidak ada angka yang berubah,
 * tidak ada yang kosong. Satu-satunya akibatnya: yang membuka daftarnya
 * menggulir melewati 135 baris kosong untuk menemukan delapan barang yang
 * memang ada di raknya — persis keadaan sebelum perubahan ini, dan persis
 * keadaan yang tidak akan dilaporkan siapa pun sebagai "rusak".
 *
 * Karena itu yang disabotase di sini bukan "apakah kodenya ada", tapi apakah
 * kodenya masih DIPAKAI dan masih MEMBEDAKAN tiga kelompoknya.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const ATURAN = 'js/modules/asset/aturan-aset-bu.js';
const SVC = 'js/modules/asset/asset.service.js';
const PAGE = 'js/modules/asset/asset.page.js';

const BERKAS = [ATURAN, SVC, PAGE];
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

// ============ PEMERIKSANYA HARUS HIJAU DULU ============
//
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

const AUDIT = 'tools/audit-urutan-daftar-aset.cjs';
const TES = 'tools/test-aturan-aset-bu.mjs';

for (const p of [AUDIT, TES]) pastikanHijau(p);

// =====================================================================
console.log('SABOTASE: ATURANNYA ADA TAPI TIDAK DIPAKAI');
// =====================================================================
//
// Bentuk kerusakan yang paling mungkin terjadi sendiri: seseorang merapikan
// import, atau menyalin `listAssets` dari versi lama. Kodenya tetap lengkap
// di `aturan-aset-bu.js`, tesnya tetap hijau, dan daftarnya kembali urut kode.

sabotase(
  'listAssets kembali urut kode saja',
  SVC,
  '  return rows.sort(urutDaftarAset);',
  '  return rows.sort(urutKode);',
  AUDIT
);

sabotase('listAssets tidak mengurutkan sama sekali', SVC, '  return rows.sort(urutDaftarAset);', '  return rows;', AUDIT);

// Dua pengurutan di satu fungsi: yang terakhir menang, dan yang pertama
// tinggal jadi bukti palsu bahwa urutannya sudah diatur.
sabotase(
  'diurutkan dua kali — yang terakhir membatalkan yang pertama',
  SVC,
  '  return rows.sort(urutDaftarAset);',
  '  rows.sort(urutKode);\n  return rows.sort(urutDaftarAset);',
  AUDIT
);

// Layar & ekspornya memakai `rows` apa adanya. Satu sort di sini membatalkan
// seluruh perubahan ini tanpa menyentuh berkas yang diperiksa di atas.
sabotase(
  'layar mengurutkan ulang sesudahnya',
  PAGE,
  "    const rusak = rows.filter((a) => !a.belumDidata && a.condition === 'rusak').length;",
  "    rows.sort((a, b) => 0);\n    const rusak = rows.filter((a) => !a.belumDidata && a.condition === 'rusak').length;",
  AUDIT
);

sabotase(
  'kelompokStok diganti nama — aturannya tidak pernah dipanggil',
  ATURAN,
  'export function kelompokStok(a) {',
  'export function kelompokStokX(a) {',
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE: KELOMPOKNYA TIDAK LAGI MEMBEDAKAN');
// =====================================================================

// "Habis" adalah jawaban; "belum didata" adalah pertanyaan yang belum
// dijawab siapa pun. Digabung, keduanya jadi satu blok — dan pekerjaan opname
// yang belum pernah dikerjakan tidak lagi bisa dilihat dari urutannya.
sabotase('belum didata digabung dengan yang sudah dihitung habis', ATURAN, '  if (a?.belumDidata) return 2;', '  if (a?.belumDidata) return 1;', TES);

// Terbalik: yang permintaannya justru ini — "yang ada jumlah stocknya ada di
// atas". Terbalik, daftarnya tetap rapi dan tetap tiga kelompok.
sabotase(
  'kelompoknya terbalik — yang habis di atas',
  ATURAN,
  '  return (Number(a?.qty) || 0) > 0 ? 0 : 1;',
  '  return (Number(a?.qty) || 0) > 0 ? 1 : 0;',
  TES
);

// ============ ANGKA YANG DIBACA SEBAGAI TEKS ============
//
// Kolom numeric datang dari PostgREST sebagai string. Tanpa `Number()`,
// nilai cacat jadi NaN dan NaN > 0 selalu false — barisnya ikut ke bawah
// tanpa alasan, dan tidak ada galat di mana pun.
sabotase(
  'qty tidak lagi dibaca sebagai angka',
  ATURAN,
  '  return (Number(a?.qty) || 0) > 0 ? 0 : 1;',
  '  return (a?.qty || 0) > 0 ? 0 : 1;',
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE: URUTAN DI DALAM KELOMPOK');
// =====================================================================

// Tanpa pembanding kedua, urutan di dalam kelompok ditentukan urutan masuk
// dari database — dan barang berpindah baris tiap kali layarnya dibuka.
sabotase(
  'urutan di dalam kelompok jadi urutan masuk',
  ATURAN,
  "  return urutKode(a?.kode, b?.kode) || teks(a?.name).localeCompare(teks(b?.name), 'id');",
  '  return 0;',
  TES
);

// Diurutkan menurut JUMLAH: barisnya berpindah tiap ada yang dipakai sebiji.
sabotase(
  'di dalam kelompok diurutkan menurut jumlah',
  ATURAN,
  "  return urutKode(a?.kode, b?.kode) || teks(a?.name).localeCompare(teks(b?.name), 'id');",
  '  return (Number(b?.qty) || 0) - (Number(a?.qty) || 0);',
  TES
);

// Hanya satu sisi yang dikelompokkan: pembandingnya jadi tidak konsisten, dan
// hasilnya bergantung urutan masuk — tapi tetap "terurut" di layar.
sabotase(
  'kelompok hanya dihitung untuk satu sisi',
  ATURAN,
  '  const kb = kelompokStok(b);',
  '  const kb = ka;',
  TES
);

// ---------------------------------------------------------------
console.log('');
if (gagal === 0) console.log('Semua sabotase urutan daftar aset tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS / tidak terpasang.`);
process.exit(gagal === 0 ? 0 : 1);
