/**
 * Ingatan layar — diuji terhadap KODE ASLINYA (js/core/ingatan-layar.js).
 *
 * KENAPA ADA. Aplikasi ini halaman web: saat orangnya membuka Excel atau
 * kamera, Android/iOS boleh membuang halaman ini dari memori, dan begitu
 * kembali halamannya dimuat ULANG. Yang dipulihkan dulu hanya kode modulnya —
 * orangnya mendarat di layar depan modul, kehilangan posisi gulir dan sesi yang
 * sedang dia isi. Untuk sesuatu yang terjadi tiap kali orang menyalin angka
 * dari Excel, itu terasa seperti aplikasi yang membatalkan pekerjaannya sendiri.
 *
 * Yang paling penting diuji di sini adalah BATAS USIA-nya. Ingatan yang tidak
 * pernah kedaluwarsa lebih buruk daripada tidak ada ingatan: membuka aplikasi
 * besok pagi lalu mendarat di layar sesi kemarin bukan "melanjutkan" — itu
 * membingungkan, dan orangnya harus mencari jalan keluar dulu sebelum bisa
 * bekerja.
 */

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};

// ---------- Tiruan sessionStorage ----------
const simpanan = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (simpanan.has(k) ? simpanan.get(k) : null),
  setItem: (k, v) => simpanan.set(k, String(v)),
  removeItem: (k) => simpanan.delete(k)
};

const M = await import('../js/core/ingatan-layar.js');

// ---------- Alur biasa ----------
M.ingatModul('cleaning');
cek('modul terakhir tercatat', M.modulTerakhir(), 'cleaning');
cek('layar dalamnya kosong dulu', M.layarTerakhir('cleaning'), null);
cek('gulir mulai dari 0', M.gulirTerakhir('cleaning'), 0);

M.ingatLayar('sesi:abc');
M.ingatGulir(640);
cek('layar sesi tercatat', M.layarTerakhir('cleaning'), 'sesi:abc');
cek('gulir tercatat', M.gulirTerakhir('cleaning'), 640);

// ---------- Tidak boleh salah kamar ----------
cek('layar modul lain tidak ikut terbaca', M.layarTerakhir('kas'), null);
cek('gulir modul lain juga tidak', M.gulirTerakhir('kas'), 0);

// ---------- Berpindah modul menyetel ulang isi dalamnya ----------
M.ingatModul('kas');
cek('modul berganti', M.modulTerakhir(), 'kas');
cek('layar sesi lama tidak terbawa', M.layarTerakhir('kas'), null);
cek('gulir lama tidak terbawa', M.gulirTerakhir('kas'), 0);

// ---------- Kembali ke layar utama modul ----------
M.ingatModul('cleaning');
M.ingatLayar('sesi:abc');
M.ingatLayar(null);
cek('kembali ke daftar -> layar dalamnya kosong', M.layarTerakhir('cleaning'), null);
cek('tapi modulnya tetap diingat', M.modulTerakhir(), 'cleaning');

// ---------- Beranda: ingatannya dibuang ----------
M.ingatModul(null);
cek('di Beranda tidak ada modul yang diingat', M.modulTerakhir(), null);
cek('dan tidak ada layar yang diingat', M.layarTerakhir('cleaning'), null);

// ---------- BATAS USIA ----------
M.ingatModul('cleaning');
M.ingatLayar('sesi:abc');
M.ingatGulir(500);

const majukanJam = (menit) => {
  const data = JSON.parse(simpanan.get('berjaya_ingatan_layar'));
  data.ts -= menit * 60 * 1000;
  simpanan.set('berjaya_ingatan_layar', JSON.stringify(data));
};

majukanJam(29);
cek('29 menit: masih dianggap melanjutkan', M.modulTerakhir(), 'cleaning');
cek('29 menit: layarnya ikut pulih', M.layarTerakhir('cleaning'), 'sesi:abc');

majukanJam(2); // total 31 menit
cek('31 menit: ingatannya sudah basi', M.modulTerakhir(), null);
cek('31 menit: layarnya tidak dipulihkan', M.layarTerakhir('cleaning'), null);
cek('31 menit: gulirnya juga tidak', M.gulirTerakhir('cleaning'), 0);

// Menulis di atas ingatan basi tidak boleh "menghidupkannya" separuh.
M.ingatLayar('sesi:zzz');
cek('menulis layar di atas ingatan basi tidak menghidupkannya', M.layarTerakhir('cleaning'), null);
M.ingatGulir(900);
cek('menulis gulir di atas ingatan basi juga tidak', M.gulirTerakhir('cleaning'), 0);

// ---------- Penyimpanan diblokir (mode privat) ----------
const asli = globalThis.sessionStorage;
globalThis.sessionStorage = {
  getItem() {
    throw new Error('diblokir');
  },
  setItem() {
    throw new Error('diblokir');
  },
  removeItem() {
    throw new Error('diblokir');
  }
};
// Yang penting: TIDAK melempar. Fitur kenyamanan tidak boleh menjatuhkan
// aplikasi hanya karena penyimpanannya diblokir.
M.ingatModul('cleaning');
M.ingatLayar('sesi:abc');
M.ingatGulir(100);
cek('penyimpanan diblokir: dianggap tidak ada ingatan', M.modulTerakhir(), null);
cek('penyimpanan diblokir: layar juga kosong', M.layarTerakhir('cleaning'), null);
globalThis.sessionStorage = asli;

// ---------- Isi yang rusak ----------
simpanan.set('berjaya_ingatan_layar', '{bukan json');
cek('isi rusak dianggap tidak ada ingatan', M.modulTerakhir(), null);
simpanan.set('berjaya_ingatan_layar', 'null');
cek('isi null aman', M.modulTerakhir(), null);
simpanan.set('berjaya_ingatan_layar', '{"modul":"kas"}'); // tanpa ts
cek('tanpa cap waktu dianggap basi, bukan abadi', M.modulTerakhir(), null);

// =====================================================================
// KONTEKS: outlet & tanggal yang sedang dipilih
//
// Ini bagian yang PALING BERBAHAYA kalau salah, dan bahayanya bukan
// "kehilangan pekerjaan" melainkan MENGERJAKAN TEMPAT YANG SALAH.
//
// Rekaman layar dari lapangan: staff membuka Daily Activities di Central
// Kitchen, memotret satu item, Android membuang halamannya. Sub-layarnya
// dipulihkan dengan benar — `sesi:<id>` — tapi outletnya kembali ke pilihan
// pertama. Yang muncul: sesi Opening milik outlet LAIN, sudah diisi orang
// lain, tanpa satu pun tanda bahwa outletnya berpindah.
// =====================================================================
simpanan.clear();
M.ingatModul('cleaning_checklist');
cek('konteks kosong di modul baru', M.konteksTerakhir('cleaning_checklist'), null);

M.ingatKonteks({ outletId: 'ck-tangerang', tanggal: '2026-08-18' });
cek('konteks tersimpan', M.konteksTerakhir('cleaning_checklist'), { outletId: 'ck-tangerang', tanggal: '2026-08-18' });

// TIDAK BOLEH BOCOR ANTAR MODUL. Outlet yang diingat modul Inventory tidak
// boleh menentukan outlet modul Daily Activities.
cek('konteks tidak terbaca dari modul lain', M.konteksTerakhir('inventory'), null);

// Konteks & layar hidup berdampingan — memulihkan salah satunya saja
// justru yang menghasilkan bug di atas.
M.ingatLayar('sesi:opening');
cek('layar tetap tercatat', M.layarTerakhir('cleaning_checklist'), 'sesi:opening');
cek('konteks tidak hilang saat layar dicatat', M.konteksTerakhir('cleaning_checklist'), { outletId: 'ck-tangerang', tanggal: '2026-08-18' });

M.ingatKonteks({ outletId: 'gading', tanggal: '2026-08-18' });
cek('layar tidak hilang saat konteks diubah', M.layarTerakhir('cleaning_checklist'), 'sesi:opening');
cek('konteks terbarui', M.konteksTerakhir('cleaning_checklist').outletId, 'gading');

// Berpindah modul mengosongkan konteksnya — kalau tidak, outlet modul lama
// akan diam-diam dipakai modul baru.
//
// PERLU DICATAT JUJUR: menyabotase `konteks: null` di dalam `ingatModul()`
// TIDAK membuat baris ini merah. Bukan karena tesnya lemah, melainkan karena
// baris itu memang bukan penjaganya — `tulis()` mengganti SELURUH objek, jadi
// konteks lama sudah hilang dengan sendirinya. `konteks: null` di sana adalah
// pertahanan berlapis, bukan penyelamatnya.
//
// Yang benar-benar dijaga baris tes ini adalah PERILAKUNYA: kalau suatu saat
// `ingatModul` diubah jadi menyalin ingatan lama (`{...baca(), modul: kode}`),
// baris ini akan langsung merah.
M.ingatModul('inventory');
cek('ganti modul mengosongkan konteks', M.konteksTerakhir('inventory'), null);

// Ingatan basi tidak mengembalikan konteks apa pun.
M.ingatModul('cleaning_checklist');
M.ingatKonteks({ outletId: 'ck-tangerang', tanggal: '2026-08-18' });
const isiKini = JSON.parse(simpanan.get('berjaya_ingatan_layar'));
simpanan.set('berjaya_ingatan_layar', JSON.stringify({ ...isiKini, ts: Date.now() - 31 * 60 * 1000 }));
cek('konteks basi diabaikan', M.konteksTerakhir('cleaning_checklist'), null);

// Menyimpan konteks saat tidak ada ingatan sama sekali tidak boleh melempar.
simpanan.clear();
let aman = true;
try {
  M.ingatKonteks({ outletId: 'x' });
} catch {
  aman = false;
}
cek('ingatKonteks tanpa ingatan tidak melempar', aman, true);
cek('  dan tidak membuat ingatan palsu', M.konteksTerakhir('cleaning_checklist'), null);

// =====================================================================
// mulaiModul() — URUTAN BACA-LALU-KOSONGKAN
//
// Bagian ini ada karena seluruh tes di atas HIJAU sementara fiturnya mati
// total. `ingatKonteks`/`konteksTerakhir` bekerja sempurna kalau diuji
// sendiri-sendiri; yang rusak adalah URUTAN pemakaiannya di `openModule()` —
// `ingatModul()` sudah mengosongkan ingatannya sebelum halaman modulnya
// sempat membaca.
//
// Pelajarannya: menguji potongan tidak pernah menguji asumsinya. Jadi yang
// diuji di sini adalah kontraknya — baca dulu, kosongkan belakangan, dalam
// satu langkah.
// =====================================================================
simpanan.clear();

// Sesi kemarin sore: orangnya sedang di Central Kitchen, sesi Opening.
M.ingatModul('cleaning_checklist');
M.ingatKonteks({ outletId: 'ck-tangerang', tanggal: '2026-08-18' });
M.ingatLayar('sesi:opening');
M.ingatGulir(420);

// Android membuang halamannya; aplikasi dimuat ulang dan membuka modul yang
// sama dengan pulihkan = true.
const pulih = M.mulaiModul('cleaning_checklist', { pulihkan: true });
cek('mulaiModul mengembalikan gulir', pulih.gulir, 420);
cek('mulaiModul mengembalikan layar', pulih.layar, 'sesi:opening');
cek('mulaiModul mengembalikan KONTEKS', pulih.konteks, { outletId: 'ck-tangerang', tanggal: '2026-08-18' });

// ...dan sesudahnya ingatannya memang sudah bersih. Ini yang membuat pola
// lama ("baca sendiri setelah ingatModul") selalu menghasilkan null.
cek('sesudah mulaiModul, konteksnya kosong', M.konteksTerakhir('cleaning_checklist'), null);
cek('sesudah mulaiModul, layarnya kosong', M.layarTerakhir('cleaning_checklist'), null);
cek('modulnya tetap tercatat', M.modulTerakhir(), 'cleaning_checklist');

// Membuka modul TANPA memulihkan: tidak boleh membawa apa pun dari sebelumnya.
simpanan.clear();
M.ingatModul('cleaning_checklist');
M.ingatKonteks({ outletId: 'ck-tangerang' });
M.ingatLayar('sesi:opening');
const segar = M.mulaiModul('cleaning_checklist', {});
cek('tanpa pulihkan: gulir 0', segar.gulir, 0);
cek('tanpa pulihkan: layar null', segar.layar, null);
cek('tanpa pulihkan: konteks null', segar.konteks, null);

// Modul BERBEDA: ingatan modul sebelumnya tidak boleh ikut terbawa.
simpanan.clear();
M.ingatModul('inventory');
M.ingatKonteks({ outletId: 'ck-tangerang' });
const lain = M.mulaiModul('cleaning_checklist', { pulihkan: true });
cek('pindah modul: konteks modul lain tidak terbawa', lain.konteks, null);
cek('pindah modul: layar modul lain tidak terbawa', lain.layar, null);

// Ingatan basi tidak dipulihkan.
simpanan.clear();
M.ingatModul('cleaning_checklist');
M.ingatKonteks({ outletId: 'ck-tangerang' });
const basi = JSON.parse(simpanan.get('berjaya_ingatan_layar'));
simpanan.set('berjaya_ingatan_layar', JSON.stringify({ ...basi, ts: Date.now() - 31 * 60 * 1000 }));
cek('ingatan basi tidak dipulihkan', M.mulaiModul('cleaning_checklist', { pulihkan: true }).konteks, null);

// Tanpa ingatan sama sekali tidak boleh melempar.
simpanan.clear();
let amanKosong = true;
try {
  const k = M.mulaiModul('cleaning_checklist', { pulihkan: true });
  cek('tanpa ingatan: semuanya kosong', k, { gulir: 0, layar: null, konteks: null });
} catch {
  amanKosong = false;
}
cek('mulaiModul tanpa ingatan tidak melempar', amanKosong, true);

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('Ingatan layar benar untuk 53 kasus, termasuk batas usia & penyimpanan yang diblokir. ✅');
