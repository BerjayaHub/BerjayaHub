/**
 * AUDIT: apakah pola sabotasenya masih cocok dengan kodenya?
 *
 * ============ KEJADIAN YANG MELAHIRKANNYA ============
 *
 * `sabotase-0132.mjs` basi sejak `0142`. Tiga dari polanya tidak lagi cocok
 * dengan kode yang dijaganya — daftar kolom `getDispatchItems` bertambah,
 * blok jalur cadangannya berubah bentuk — jadi tiga sabotase itu TIDAK
 * memasang apa pun, dan tiga pemeriksaan yang dikira ada sebenarnya nol.
 *
 * Itu bertahan berbulan-bulan karena satu alasan yang membosankan: harness
 * sabotase MAHAL. Tiap satu sabotase menjalankan pemeriksanya sendiri sebagai
 * proses baru, dan yang memakai PGlite butuh puluhan detik per sabotase.
 * Akibatnya ia tidak pernah ikut sweep rutin, dan laporan "SABOTASE TIDAK
 * TERPASANG" yang sudah ditulis dengan rapi itu tidak pernah dibaca siapa pun.
 *
 * ============ YANG DIKERJAKAN DI SINI ============
 *
 * Tiap harness dijalankan dengan `SABOTASE_PERIKSA_POLA=1`, yang membuatnya
 * berhenti tepat sesudah polanya dipastikan cocok — SEBELUM satu berkas pun
 * disentuh dan tanpa menjalankan satu pemeriksa pun. Seluruhnya selesai dalam
 * hitungan detik.
 *
 * Yang TIDAK dijawab audit ini: apakah pemeriksanya sungguh menggigit. Untuk
 * itu harness-nya harus dijalankan penuh. Ini menjawab pertanyaan yang lebih
 * kecil tapi lebih sering salah: apakah sabotasenya masih mengenai sesuatu.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const AKAR = path.dirname(__dirname);
let gagal = 0;
const salah = (pesan) => {
  gagal++;
  console.error(`❌ ${pesan}`);
};

const daftar = fs
  .readdirSync(path.join(AKAR, 'tools'))
  .filter((f) => /^sabotase-.*\.mjs$/.test(f))
  .sort();

if (daftar.length < 10) {
  salah(`hanya ${daftar.length} harness sabotase ketemu — audit ini kehilangan sasarannya.`);
}

// Kalimat-kalimat yang ditulis harness-nya sendiri saat polanya tidak mengenai
// apa pun. Dikumpulkan di sini supaya daftarnya terbaca sebagai satu aturan.
const MASALAH = [
  { pola: /SABOTASE TIDAK TERPASANG/, arti: 'polanya tidak ketemu lagi di berkas yang dijaganya' },
  { pola: /POLANYA MUNCUL >1 KALI/, arti: 'polanya ambigu — sabotasenya cuma mengenai kemunculan pertama' },
  { pola: /PEMERIKSANYA TIDAK ADA/, arti: 'berkas pemeriksanya hilang' }
];

let totalPola = 0;
for (const f of daftar) {
  let keluaran = '';
  try {
    keluaran = execFileSync('node', [path.join('tools', f)], {
      cwd: AKAR,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, SABOTASE_PERIKSA_POLA: '1' }
    });
  } catch (e) {
    // Harness yang punya pola basi keluar dengan kode != 0 — itu memang yang
    // dicari, dan keluarannya tetap harus dibaca.
    keluaran = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    if (!keluaran.trim()) {
      salah(`${f}: gagal dijalankan sama sekali (${String(e.message).split('\n')[0]}).`);
      continue;
    }
  }

  totalPola += (keluaran.match(/pola terpasang:/g) ?? []).length;

  for (const { pola, arti } of MASALAH) {
    const kena = keluaran.split('\n').filter((b) => pola.test(b));
    for (const baris of kena) {
      salah(`${f}: ${arti}\n   ${baris.trim()}`);
    }
  }

  // Harness yang tidak melaporkan SATU pun pola terpasang berarti mode
  // periksa-polanya tidak terpasang di sana — dan "bersih" untuknya tidak
  // berarti apa-apa.
  if (!/pola terpasang:/.test(keluaran)) {
    salah(`${f}: tidak melaporkan satu pun pola terpasang — mode SABOTASE_PERIKSA_POLA belum ada di harness ini.`);
  }
}

// Berkas repo TIDAK boleh tersentuh oleh audit ini.
const penanda = path.join(AKAR, 'tools/.sabotase-aktif');
if (fs.existsSync(penanda)) {
  salah('audit ini meninggalkan penanda sabotase — mode periksa-pola seharusnya berhenti SEBELUM berkas disentuh.');
}

console.log('');
if (gagal === 0) console.log(`${totalPola} pola sabotase di ${daftar.length} harness masih mengenai kodenya. ✅`);
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
