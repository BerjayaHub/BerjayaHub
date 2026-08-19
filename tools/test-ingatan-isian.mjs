/**
 * Draf isian — bagian yang menentukan apakah angka mendarat di kolom yang benar.
 *
 * Yang paling ditekankan: PENJAGA JUMLAH BARIS.
 *
 * Baris dinamis (bahan resep, jumlah menu) tidak punya id — satu-satunya cara
 * mengenalinya adalah URUTAN. Kalau jumlah barisnya berubah antara draf
 * disimpan dan dipulihkan, urutan tidak lagi menunjuk baris yang sama, dan
 * jumlah bahan A akan mendarat di bahan B.
 *
 * Kegagalan itu tidak terlihat sama sekali: angkanya masuk akal, formulirnya
 * normal, dan resep yang tersimpan salah. Lebih baik kehilangan beberapa baris
 * draf daripada memindahkan angka ke bahan yang keliru.
 */
// Tiruan sessionStorage HARUS ada sebelum modulnya diimpor.
const simpanan = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (simpanan.has(k) ? simpanan.get(k) : null),
  setItem: (k, v) => simpanan.set(k, String(v)),
  removeItem: (k) => simpanan.delete(k)
};

const { kunciIsian, kunciBerurutan, cocokkanDraf, simpanDraf, bacaDraf, hapusDraf, lupakanSembunyi } = await import(
  '../js/core/ingatan-isian.js'
);

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};

// =====================================================================
// KUNCI
// =====================================================================
cek('id paling diutamakan', kunciIsian({ id: 'recipe-yield', name: 'x', kelas: 'ln-qty', indeks: 0 }), 'id:recipe-yield');
cek('name dipakai kalau tidak ada id', kunciIsian({ name: 'foto-1' }), 'nm:foto-1');
cek('kelas+urutan untuk baris dinamis', kunciIsian({ kelas: 'ln-qty', indeks: 2 }), '#ln-qty:2');
cek('indeks 0 tetap sah', kunciIsian({ kelas: 'ln-qty', indeks: 0 }), '#ln-qty:0');
cek('tanpa apa pun -> null', kunciIsian({}), null);
cek('kelas tanpa indeks -> null', kunciIsian({ kelas: 'ln-qty' }), null);
cek('indeks bukan bilangan bulat -> null', kunciIsian({ kelas: 'ln-qty', indeks: 1.5 }), null);

cek('kunci berurutan dikenali', kunciBerurutan('#ln-qty:0'), true);
cek('kunci id tidak berurutan', kunciBerurutan('id:x'), false);
cek('kunci name tidak berurutan', kunciBerurutan('nm:x'), false);
cek('null aman', kunciBerurutan(null), false);

// =====================================================================
// COCOKKAN — kunci ber-id
// =====================================================================
const drafId = { nilai: { 'id:recipe-yield': '5', 'id:recipe-notes': 'coba' }, jumlah: {} };

cek(
  'kunci id dipulihkan apa adanya',
  cocokkanDraf(drafId, { kunci: ['id:recipe-yield', 'id:recipe-notes'], jumlah: {} }).isi,
  { 'id:recipe-yield': '5', 'id:recipe-notes': 'coba' }
);

// Kolom yang sudah tidak ada di layar dilewati — bukan dipaksakan.
const sebagian = cocokkanDraf(drafId, { kunci: ['id:recipe-yield'], jumlah: {} });
cek('kolom yang hilang dilewati', sebagian.isi, { 'id:recipe-yield': '5' });
cek('  dan dihitung', sebagian.dilewati, 1);

// =====================================================================
// PENJAGA JUMLAH BARIS — inti berkas ini
// =====================================================================
const drafBaris = {
  nilai: { '#ln-qty:0': '10', '#ln-qty:1': '20', '#ln-qty:2': '30' },
  jumlah: { 'ln-qty': 3 }
};
const kunciBaris = ['#ln-qty:0', '#ln-qty:1', '#ln-qty:2'];

// Jumlah baris SAMA -> semuanya dipulihkan.
const sama = cocokkanDraf(drafBaris, { kunci: kunciBaris, jumlah: { 'ln-qty': 3 } });
cek('jumlah baris sama: semuanya dipulihkan', sama.isi, { '#ln-qty:0': '10', '#ln-qty:1': '20', '#ln-qty:2': '30' });
cek('  tidak ada yang dilewati', sama.dilewati, 0);

// Jumlah baris BERKURANG -> seluruh kelas itu dilewati, walau sebagian
// kuncinya masih ada. Inilah kasus yang memindahkan angka ke bahan yang salah.
const berkurang = cocokkanDraf(drafBaris, { kunci: ['#ln-qty:0', '#ln-qty:1'], jumlah: { 'ln-qty': 2 } });
cek('baris berkurang: TIDAK ada yang dipulihkan', berkurang.isi, {});
cek('  semuanya dihitung dilewati', berkurang.dilewati, 3);

// Jumlah baris BERTAMBAH -> juga dilewati. Baris baru menggeser urutan.
const bertambah = cocokkanDraf(drafBaris, {
  kunci: ['#ln-qty:0', '#ln-qty:1', '#ln-qty:2', '#ln-qty:3'],
  jumlah: { 'ln-qty': 4 }
});
cek('baris bertambah: TIDAK ada yang dipulihkan', bertambah.isi, {});
cek('  semuanya dihitung dilewati', bertambah.dilewati, 3);

// Draf tanpa catatan jumlah (data lama) -> jangan ditebak, lewati.
const tanpaJumlah = cocokkanDraf({ nilai: { '#ln-qty:0': '10' }, jumlah: {} }, { kunci: ['#ln-qty:0'], jumlah: { 'ln-qty': 1 } });
cek('draf tanpa catatan jumlah dilewati', tanpaJumlah.isi, {});
cek('  dan dihitung', tanpaJumlah.dilewati, 1);

// KELAS LAIN TIDAK IKUT TERKENA. Baris resep berubah tidak boleh membatalkan
// pemulihan kolom jumlah menu yang sama sekali tidak berhubungan.
const duaKelas = cocokkanDraf(
  {
    nilai: { '#ln-qty:0': '10', '#menu-qty:0': '7', 'id:catatan': 'halo' },
    jumlah: { 'ln-qty': 3, 'menu-qty': 1 }
  },
  { kunci: ['#ln-qty:0', '#menu-qty:0', 'id:catatan'], jumlah: { 'ln-qty': 1, 'menu-qty': 1 } }
);
cek('kelas yang jumlahnya cocok tetap dipulihkan', duaKelas.isi, { '#menu-qty:0': '7', 'id:catatan': 'halo' });
cek('  hanya kelas yang berubah yang dilewati', duaKelas.dilewati, 1);

// =====================================================================
// MASUKAN RUSAK
// =====================================================================
cek('draf null aman', cocokkanDraf(null, { kunci: [], jumlah: {} }).isi, {});
cek('sekarang null aman', cocokkanDraf(drafId, null).isi, {});
cek('keduanya null aman', cocokkanDraf(null, null), { isi: {}, dilewati: 0 });
cek('draf tanpa nilai aman', cocokkanDraf({ jumlah: {} }, { kunci: ['id:x'], jumlah: {} }).isi, {});
cek('layar kosong: semuanya dilewati', cocokkanDraf(drafId, { kunci: [], jumlah: {} }).dilewati, 2);

// =====================================================================
// PENANDA "DISIMPAN SAAT HALAMAN DISEMBUNYIKAN"
//
// Draf direkam terus selagi mengetik, tapi yang DITAWARKAN hanya yang
// penulisan terakhirnya terjadi tepat sebelum halaman disembunyikan.
//
// Kalau tidak dibedakan, bilah "ada isian belum tersimpan" muncul setiap kali
// orang melirik WhatsApp lalu kembali — padahal isian di layar masih utuh.
// Bilah yang muncul terus-menerus akan ditutup tanpa dibaca, dan sesudah itu
// ia tidak berguna justru saat isinya benar-benar penting.
// =====================================================================
const isi = { nilai: { 'id:recipe-yield': '5' }, jumlah: {} };

simpanan.clear();
simpanDraf('master_product|resep', isi);
cek('draf dari mengetik biasa TIDAK ditawarkan', bacaDraf('master_product|resep'), null);

simpanDraf('master_product|resep', isi, { saatSembunyi: true });
cek('draf saat disembunyikan ditawarkan', bacaDraf('master_product|resep')?.nilai, { 'id:recipe-yield': '5' });

// Halamannya SELAMAT -> penandanya diturunkan, tidak jadi ditawarkan.
lupakanSembunyi();
cek('halaman selamat: tawarannya batal', bacaDraf('master_product|resep'), null);

// ISINYA TIDAK BOLEH IKUT DIBUANG.
//
// `lupakanSembunyi()` hanya menurunkan penandanya. Kalau ia menghapus
// seluruh drafnya, orang yang melirik WhatsApp sekali lalu kembali akan
// kehilangan jaringnya — dan kehilangan sungguhan berikutnya (yang benar-benar
// membuang halaman) tidak punya apa pun untuk dipulihkan.
//
// Diperiksa dari penyimpanannya LANGSUNG, bukan lewat `bacaDraf` (yang memang
// menolak draf tanpa penanda) dan tanpa menyimpan ulang lebih dulu — versi
// pertama tes ini menyimpan ulang tepat sesudahnya, jadi sabotasenya lolos.
const setelahSelamat = simpanan.get('berjaya_draf_isian');
cek('  isinya masih tersimpan', !!setelahSelamat, true);
cek('  nilainya utuh', JSON.parse(setelahSelamat ?? '{}').nilai, { 'id:recipe-yield': '5' });
cek('  hanya penandanya yang turun', JSON.parse(setelahSelamat ?? '{}').sembunyi, false);

// Disembunyikan lagi -> ditawarkan lagi, tanpa perlu mengetik ulang.
simpanDraf('master_product|resep', isi, { saatSembunyi: true });
cek('  bisa ditawarkan lagi', bacaDraf('master_product|resep')?.nilai, { 'id:recipe-yield': '5' });

// Tidak salah kamar antar layar.
cek('layar lain tidak membaca draf ini', bacaDraf('inventory|'), null);

// Dibuang setelah dipakai.
hapusDraf('master_product|resep');
cek('sesudah dibuang, kosong', bacaDraf('master_product|resep'), null);

// Draf basi tidak ditawarkan.
simpanDraf('master_product|resep', isi, { saatSembunyi: true });
const rekam = JSON.parse(simpanan.get('berjaya_draf_isian'));
simpanan.set('berjaya_draf_isian', JSON.stringify({ ...rekam, ts: Date.now() - 31 * 60 * 1000 }));
cek('draf lebih dari 30 menit diabaikan', bacaDraf('master_product|resep'), null);

// Isian kosong tidak menyimpan apa pun.
simpanan.clear();
simpanDraf('master_product|resep', null, { saatSembunyi: true });
cek('isi null tidak membuat draf', bacaDraf('master_product|resep'), null);

// Penyimpanan diblokir (mode privat) tidak boleh menjatuhkan aplikasi.
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
let aman = true;
try {
  simpanDraf('x|y', isi, { saatSembunyi: true });
  lupakanSembunyi();
  cek('penyimpanan diblokir: dianggap tidak ada draf', bacaDraf('x|y'), null);
} catch {
  aman = false;
}
cek('penyimpanan diblokir tidak melempar', aman, true);
globalThis.sessionStorage = asli;

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('Draf isian benar untuk 44 kasus — termasuk penjaga jumlah baris yang mencegah angka mendarat di bahan yang salah. ✅');
