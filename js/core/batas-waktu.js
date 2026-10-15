/**
 * BATAS WAKTU UNTUK PEMUATAN LAYAR.
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 *   "modul ekspor esb hanya memuat, saya tunggu sekitar 5 menit tidak ada
 *    perubahan, apa ada yang salah"
 *
 * Layar Ekspor ESB menampilkan kerangka "Memuat…" selamanya. Bukan pesan
 * galat, bukan layar kosong — kerangka yang terlihat seperti sedang bekerja.
 * Orang yang melihatnya tidak punya cara tahu bedanya antara "lambat" dan
 * "tidak akan pernah selesai", jadi ia menunggu lima menit, lalu memuat ulang,
 * lalu menunggu lagi.
 *
 * Sebab teknisnya bisa macam-macam — permintaan yang menggantung, koneksi yang
 * mati tanpa menutup, tabel yang sedang terkunci di database. Yang SAMA pada
 * semuanya: `await` yang tidak pernah selesai, dan `try/catch` tidak menangkap
 * apa-apa karena tidak ada yang dilempar.
 *
 * Ini bentuk kegagalan yang sudah berulang kali ditulis di repo ini dari arah
 * sebaliknya — "gagal yang terlihat seperti berhasil". Yang ini kebalikannya
 * dan sama mahalnya: GAGAL YANG TERLIHAT SEPERTI SEDANG BEKERJA.
 *
 * ============ BATAS WAKTU BUKAN PERBAIKAN SEBABNYA ============
 *
 * Harus terus terang: berkas ini TIDAK membuat permintaan yang menggantung jadi
 * berhasil. Ia cuma mengubah kerangka abadi menjadi kalimat yang bisa dibaca
 * dan ditindaklanjuti, beserta nama bagian yang macet.
 *
 * Itu tetap layak ada. Tanpa batas waktu, satu-satunya orang yang bisa
 * mendiagnosanya adalah orang yang tahu cara membuka DevTools — dan di aplikasi
 * yang dipakai kasir dan admin outlet, orang itu tidak ada di tempat.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa browser.
 */

/** Bawaan: 25 detik. Cukup longgar untuk 3G lambat, jauh di bawah ambang menyerah manusia. */
export const BATAS_DETIK = 25;

/** Penanda galat batas waktu, supaya pemanggil bisa membedakannya. */
export const NAMA_GALAT_BATAS = 'BatasWaktuError';

/**
 * Galat batas waktu — FUNGSI PABRIK, bukan `class extends Error`.
 *
 * Dua alasan, dan keduanya nyata:
 *
 *   1. Tidak ada satu pun `class` lain di seluruh `js/`. Memperkenalkan yang
 *      pertama di berkas utilitas kecil membuat `audit-nama-tak-dikenal`
 *      melaporkan `constructor()` sebagai nama tak dikenal — auditnya memang
 *      tidak mengerti anggota kelas. Pilihannya: mengajari auditnya hal yang
 *      cuma dipakai sekali, atau menulisnya seperti sisa repo ini. Yang kedua
 *      lebih murah dan lebih konsisten.
 *
 *   2. `e instanceof X` lintas-modul bisa gagal kalau modulnya termuat dua
 *      kali. Memeriksa `e.name` tidak bisa rusak karena itu.
 */
export function galatBatasWaktu(pesan) {
  const e = new Error(pesan);
  e.name = NAMA_GALAT_BATAS;
  return e;
}

/**
 * Bungkus sebuah promise dengan batas waktu.
 *
 * @param {Promise} janji
 * @param {{detik?: number, apa?: string, timer?: Function}} [opsi]
 *   `timer` disuntikkan HANYA oleh tes — supaya tesnya tidak perlu menunggu
 *   25 detik sungguhan. Menulis tes yang benar-benar tidur selama itu berarti
 *   tes yang tidak pernah dijalankan siapa pun.
 */
export function denganBatas(janji, { detik = BATAS_DETIK, apa = 'Data', timer = setTimeout } = {}) {
  return new Promise((resolve, reject) => {
    let selesai = false;
    const id = timer(() => {
      if (selesai) return;
      selesai = true;
      reject(
        galatBatasWaktu(
          `${apa} tidak selesai dimuat dalam ${detik} detik. Biasanya ini koneksi yang terputus di tengah jalan — ` +
            'coba muat ulang halamannya. Kalau tetap begitu sesudah dimuat ulang, sebutkan bagian ini ke admin ' +
            'sistem: kemungkinan ada permintaan yang menggantung di server.'
        )
      );
    }, detik * 1000);

    janji.then(
      (nilai) => {
        if (selesai) return;
        selesai = true;
        clearTimeout(id);
        resolve(nilai);
      },
      (galat) => {
        if (selesai) return;
        selesai = true;
        clearTimeout(id);
        reject(galat);
      }
    );
  });
}

/**
 * `Promise.all` yang memberi tahu BAGIAN MANA yang macet.
 *
 * ============ KENAPA PER-BAGIAN, BUKAN SATU BATAS UNTUK SEMUANYA ============
 *
 * Membungkus seluruh `Promise.all` dengan satu batas waktu lebih sederhana —
 * dan menghasilkan kalimat "Data tidak selesai dimuat", yang tidak memberitahu
 * siapa pun apa yang harus diperiksa berikutnya.
 *
 * Enam permintaan dimuat bersamaan di layar Ekspor ESB. Mengetahui bahwa yang
 * macet adalah "Daftar supplier terpakai" dan bukan "Daftar induk ESB" adalah
 * bedanya antara satu menit dan satu sore.
 *
 * @param {Array<{apa: string, janji: Promise}>} bagian
 */
export function semuaDenganBatas(bagian, { detik = BATAS_DETIK, timer = setTimeout } = {}) {
  return Promise.all(
    (Array.isArray(bagian) ? bagian : []).map((b) => denganBatas(b?.janji, { detik, apa: b?.apa ?? 'Data', timer }))
  );
}
