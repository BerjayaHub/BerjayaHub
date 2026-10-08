/**
 * SABOTASE: markup yang dikirim ke dialog yang tidak merendernya.
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Bug ini bertahan berbulan-bulan di 14 tempat sekaligus karena ia tidak
 * pernah melempar apa pun. `textContent` mengerjakan persis apa yang diminta;
 * yang salah cuma anggapan pemanggilnya. Tak satu pun pernah dilaporkan —
 * tag `<p>` yang terpampang di dialog terbaca sebagai "aplikasinya memang
 * begitu".
 *
 * Bentuk yang sama akan lahir lagi di dialog berikutnya yang perlu menebalkan
 * satu angka. Itu sebabnya auditnya menyapu seluruh `js/`, dan itu pula yang
 * disabotase di sini.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const UI = 'js/core/ui.js';
const TG = 'js/modules/notifications/telegram.admin.page.js';
const OPN = 'js/modules/inventory/opname.admin.js';

const asli = new Map();
for (const rel of [UI, TG, OPN]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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
  // `String.replace` dengan string hanya mengganti kemunculan PERTAMA.
  if (typeof dari === 'string' && isi.split(dari).length > 2) {
    gagal++;
    console.error(`❌ POLANYA MUNCUL >1 KALI: ${nama} di ${rel} — sabotasenya cuma mengenai yang pertama.`);
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

const AUDIT = 'tools/audit-dialog-html.cjs';

console.log('SABOTASE "DUA PINTUNYA":');

sabotase(
  '`messageHtml` diterima tapi tidak pernah dipasang — pesannya hilang sama sekali',
  UI,
  '    if (messageHtml) kotakTeks.innerHTML = messageHtml;',
  '    if (messageHtml) kotakTeks.textContent = messageHtml;',
  AUDIT
);
sabotase(
  '`messageHtml` dicabut dari tanda tangannya — setiap pemanggil kehilangan pesannya',
  UI,
  "  messageHtml = '',\n",
  '',
  AUDIT
);
sabotase(
  '`message` dilonggarkan jadi innerHTML — nama barang & catatan staff jadi jalan masuk',
  UI,
  '    else kotakTeks.textContent = message;',
  '    else kotakTeks.innerHTML = message;',
  AUDIT
);

console.log('\nSABOTASE "MARKUP NYASAR KE JALUR TEKS":');

sabotase(
  'dialog kirim-ulang-paksa kembali mengirim HTML ke `message` — tagnya terbaca pengguna',
  TG,
  "            title: 'Sudah tercatat terkirim hari ini',\n            messageHtml:",
  "            title: 'Sudah tercatat terkirim hari ini',\n            message:",
  AUDIT
);
sabotase(
  'dialog konfirmasi kirim rekap kembali ke `message`',
  TG,
  "        title: 'Kirim rekap sekarang?',\n        messageHtml:",
  "        title: 'Kirim rekap sekarang?',\n        message:",
  AUDIT
);
sabotase(
  'dialog revisi opname kembali ke `message`',
  OPN,
  '          title: `Revisi ${nama}?`,\n          messageHtml:',
  '          title: `Revisi ${nama}?`,\n          message:',
  AUDIT
);
sabotase(
  'dialog buang hitungan opname kembali ke `message`',
  OPN,
  '            title: `Buang hitungan ${nama}?`,\n            messageHtml:',
  '            title: `Buang hitungan ${nama}?`,\n            message:',
  AUDIT
);
sabotase(
  'dialog tutup opname kembali ke `message`',
  OPN,
  '          title: `Tutup ${btn.dataset.code}?`,\n          messageHtml:',
  '          title: `Tutup ${btn.dataset.code}?`,\n          message:',
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase dialog HTML tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS — pemeriksanya tidak menjaga apa yang dikiranya dijaga.`);
process.exit(gagal === 0 ? 0 : 1);
