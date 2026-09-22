/**
 * KANTONG KAS pada entri kas — kapan ditanyakan, dan kapan wajib.
 *
 *   "jadi apakah ada kemungkinan staff tidak memakai kantong kas,
 *    sehingga tidak tercatat?"
 *
 * Jawabannya ya, dan itu bukan kelalaian staff: FORMNYA TIDAK PERNAH BERTANYA.
 *
 * ============ GERBANG YANG SALAH PERTANYAAN ============
 *
 * Sebelum berkas ini, pilihan kantong hanya digambar kalau
 *
 *     const pakaiKantong = limit > 1;
 *
 * `limit` adalah JATAH: berapa banyak kantong seseorang boleh punya, diatur
 * admin di Master User. Ia menjawab "berapa banyak", bukan "apakah perlu
 * ditanya". Orang berjatah 1 yang sudah punya satu kantong justru yang paling
 * jelas jawabannya — dan justru dia yang tidak pernah ditanya.
 *
 * Akibatnya `account_id` NULL, dan uangnya mendarat di "Kas Utama".
 *
 * ============ KENAPA ITU MAHAL, DAN KENAPA TIDAK TERLIHAT MAHAL ============
 *
 * Uangnya TETAP TERCATAT. Ia ada di Mutasi Kas, saldo totalnya benar, foto
 * notanya ada. Tidak ada sepeser pun yang hilang — jadi tidak ada satu pun
 * angka di layar yang terlihat salah.
 *
 * Yang rusak pembagiannya. Pembayaran nota lewat modul Bahan SELALU memilih
 * kantong secara eksplisit; kas keluar lewat modul Kas tidak. Dua jalur
 * menulis tabel yang sama, satu bertanya, satu tidak:
 *
 *     Kas Serpong   Rp -46.000     <- nota, membebani kantong
 *     Kas Utama     Rp +101.600    <- kas masuk & keluar tanpa kantong
 *
 * Saldo kantong yang NEGATIF adalah keadaan yang mustahil di dunia nyata, dan
 * ia muncul tanpa satu pun galat. Dan sejak 0151, kantong itulah yang jadi
 * kolom `Account` berkas ESB Disbursement — jadi entri Kas Utama tertahan.
 *
 * ============ KAS MASUK IKUT DITANYA, DAN ITU BUKAN TAMBAHAN ============
 *
 * Kalau hanya kas KELUAR yang diwajibkan, keadaannya justru memburuk: uang
 * masuk terus menumpuk di Kas Utama sementara belanjanya membebani kantong,
 * jadi kantongnya makin negatif setiap bulan. Persis bentuk angka di atas.
 * Yang harus berhenti adalah uang MASUK tanpa kantong.
 *
 * ============ WAJIB HANYA KALAU ADA PILIHANNYA ============
 *
 * Bentuk yang sama dengan Purpose (0147) dan Supplier kas (0151). Pemegang
 * yang belum punya satu kantong pun tidak boleh kehilangan kemampuan mencatat
 * kas: tidak ada yang bisa ia pilih, dan menolak formnya hanya membuat
 * pengeluaran jam 9 malam tidak tercatat sama sekali — jauh lebih buruk
 * daripada tercatat di Kas Utama.
 *
 * Untuk dia, entrinya tetap jatuh ke Kas Utama, dan ekspornya menahannya
 * dengan alasan yang menyebut layar perbaikannya (Kas → Kantong Kas).
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa browser.
 */

export const PESAN_WAJIB = 'Pilih dulu sumber dananya — uangnya keluar dari kantong mana, atau dibayar Pusat.';
export const PESAN_WAJIB_MASUK = 'Pilih dulu kantong kasnya — uangnya masuk ke kantong mana.';

/** Keterangan pada kantong yang belum ditempeli outlet. */
export const HINT_TANPA_OUTLET = 'belum punya outlet — akan tertahan saat diekspor ke ESB';

/**
 * DIBAYAR PUSAT — penanda, bukan id kantong.
 *
 * Nilai sentinel, bukan uuid nol: uuid nol terlihat seperti id sungguhan di
 * log, di URL, dan di kepala orang yang membacanya enam bulan lagi. Alasan
 * yang sama dipakai `p_tanpa_kantong` di 0140.
 */
export const BAYAR_PUSAT = '__pusat__';
// Kalimatnya LENGKAP di label, bukan setengah di `hint`: `select` membuang
// `hint`, dan "Dibayar Pusat" tanpa penjelasan terbaca seperti nama kantong.
export const LABEL_PUSAT = 'Dibayar Pusat — tidak mengurangi kas siapa pun';
export const HINT_PUSAT = 'kantor pusat yang membayar; tercatat sebagai biaya, saldo kas tidak berkurang';

/** Nama yang dipakai SEMUA layar untuk entri bertanda Pusat. */
export const NAMA_PUSAT = 'Pusat';

const teks = (v) => (v === null || v === undefined ? '' : String(v).trim());

/**
 * Apakah kantong ditanyakan (dan diwajibkan) untuk pemegang ini?
 *
 * BUKAN `limit > 1`. Yang menentukan adalah apakah ia PUNYA kantong, bukan
 * berapa banyak ia BOLEH punya.
 *
 * @param {Array} kantong kantong aktif milik pemegangnya
 */
export function kantongWajib(kantong) {
  return Array.isArray(kantong) && kantong.length > 0;
}

/**
 * Pilihan untuk `<select>`-nya.
 *
 * "Kas Utama" TIDAK ditawarkan. Ia bukan kantong — ia nama untuk uang yang
 * tidak berada di kantong mana pun, dan menawarkannya sebagai pilihan berarti
 * menawarkan keadaan yang sedang diperbaiki sebagai jawaban yang sah.
 *
 * Kantong tanpa outlet TETAP ditawarkan, dengan keterangan. Ia kantong
 * sungguhan dan uangnya memang di sana; yang kurang cuma outletnya, dan itu
 * pekerjaan admin di layar lain. Membuangnya dari daftar akan membuat orang
 * yang seluruh kantongnya belum ber-outlet menghadapi dropdown kosong yang
 * wajib diisi — form yang tidak bisa disimpan.
 *
 * @param {Array} kantong `[{ id, name, outlet_id, outlet_name }]`
 */
export function opsiKantong(kantong, { pusat = false } = {}) {
  const daftar = (Array.isArray(kantong) ? kantong : [])
    .filter((k) => k && k.id)
    .map((k) => ({
      value: k.id,
      // Nama PEMEGANGNYA ikut kalau ada — sejak kantong outlet lain boleh
      // dibebani (0126/0153), "Kas CK iis" dan "Kas CK" milik dua orang
      // berbeda tidak bisa dibedakan dari namanya saja.
      label: labelKantong(k),
      // DUA BENTUK, satu pertanyaan. `kantong_pemegang` (0152) mengembalikan
      // `outlet_name` datar; query `cash_accounts` mengembalikannya sebagai
      // embed `outlets.name`. Modul ini menerima keduanya — kalau tidak,
      // separuh layar menampilkan keterangan kosong tanpa satu pun galat.
      hint: k.outlet_id ? namaOutlet(k) : HINT_TANPA_OUTLET
    }));
  // Pusat di PALING BAWAH: ia jawaban yang benar untuk sebagian kecil
  // pengeluaran, dan menaruhnya di atas membuatnya terpilih karena kebetulan
  // paling dekat, bukan karena memang itu yang terjadi.
  return pusat ? [...daftar, { value: BAYAR_PUSAT, label: LABEL_PUSAT, hint: HINT_PUSAT }] : daftar;
}

/** Nama outlet kantong, dari bentuk datar maupun embed. */
export function namaOutlet(k) {
  return teks(k?.outlet_name) || teks(k?.outlets?.name);
}

/**
 * "Kas CK iis — Central Kitchen Tangerang (Iis)".
 *
 * ============ SELURUHNYA DI `label`, DAN ITU BUKAN PILIHAN GAYA ============
 *
 * `formDialog` menggambar `type: 'select'` begini (js/core/ui.js):
 *
 *     `<option value="${o.value}">${escapeHtml(o.label)}</option>`
 *
 * `o.hint` TIDAK DIPAKAI SAMA SEKALI — hanya `searchselect` yang membacanya.
 * Versi pertama menaruh nama outletnya di `hint`, dan hasilnya: dropdown yang
 * cuma menampilkan "Kas Serpong" dan "Kas CK", dua kantong milik dua orang di
 * dua outlet yang tidak bisa dibedakan sama sekali. Tidak ada galat; keterangan
 * yang ditulis dengan hati-hati itu dibuang di baris terakhir.
 *
 * `hint` TETAP diisi — `searchselect` di layar lain memakainya, dan
 * mengosongkannya di sini akan mengambil keterangan yang sudah bekerja di sana.
 */
export function labelKantong(k) {
  const nama = teks(k?.name) || '(tanpa nama)';
  const outlet = namaOutlet(k);
  const pemegang = teks(k?.user_profiles?.full_name);
  const ekor = [outlet && `— ${outlet}`, pemegang && `(${pemegang})`].filter(Boolean).join(' ');
  return ekor ? `${nama} ${ekor}` : nama;
}

/** Apakah pilihan ini "Dibayar Pusat"? */
export function pilihPusat(nilai) {
  return teks(nilai) === BAYAR_PUSAT;
}

/**
 * Terjemahkan pilihan layar jadi argumen `catat_kas_di`.
 *
 * SATU tempat, dipakai form-nya. Menulisnya di layar berarti dua penerjemahan
 * — form tambah dan (nanti) form lain — yang cepat atau lambat berbeda, dan
 * bedanya berbentuk entri Pusat yang diam-diam membebani sebuah kantong.
 */
export function sumberDana(nilai) {
  return pilihPusat(nilai) ? { accountId: null, dibayarPusat: true } : { accountId: teks(nilai) || null, dibayarPusat: false };
}

/**
 * Periksa isian sebelum dikirim.
 *
 * @param {string|null} nilai id kantong yang dipilih
 * @param {Array} kantong kantong aktif milik pemegangnya
 * @param {'in'|'out'} jenis untuk memilih kalimat yang benar
 * @returns {string|null} pesan kalau tidak sah, `null` kalau lolos
 */
export function periksaKantong(nilai, kantong, jenis = 'out') {
  if (!kantongWajib(kantong)) return null;
  const v = teks(nilai);
  if (!v) return jenis === 'in' ? PESAN_WAJIB_MASUK : PESAN_WAJIB;
  // PUSAT hanya sah untuk kas KELUAR. Uang masuk yang "dibayar pusat" tidak
  // berarti apa-apa, dan database menolaknya lewat constraint yang pesannya
  // berbicara tentang nama constraint, bukan tentang uang.
  if (pilihPusat(v)) return jenis === 'in' ? 'Kas masuk tidak bisa "dibayar Pusat". Pilih kantongnya.' : null;
  // Id yang tidak ada di daftarnya ditolak, bukan diteruskan: database memang
  // akan menolaknya juga, tapi pesannya di sana berbicara tentang foreign key.
  return kantong.some((k) => k?.id === v) ? null : 'Kantong itu bukan milikmu. Muat ulang halamannya.';
}

/**
 * Nama kantong untuk ditampilkan di tabel mutasi.
 *
 * Entri tanpa kantong disebut "Kas Utama" — nama yang SAMA dengan yang dipakai
 * layar Kantong Kas, laporan, dan alasan tertahan di Ekspor ESB. Empat layar
 * yang menyebut hal yang sama dengan empat nama berbeda adalah empat layar
 * yang tidak bisa dicocokkan satu sama lain.
 */
export const NAMA_TANPA_KANTONG = 'Kas Utama';

export function namaKantong(entri) {
  // Aturan yang SAMA PERSIS dengan `label_kantong_kas()` di database (0153).
  // Dua aturan untuk satu pertanyaan akan menyimpang, dan menyimpangnya
  // berbentuk: tabel admin berkata "Kas Utama", laporan berkata "Pusat", untuk
  // baris yang sama.
  if (entri?.dibayar_pusat) return NAMA_PUSAT;
  return teks(entri?.cash_accounts?.name) || NAMA_TANPA_KANTONG;
}

/**
 * Apakah baris ini yang bikin ekspornya tertahan? Dipakai menandai di tabel.
 *
 * Baris PUSAT tidak termasuk: ia memang sengaja tanpa kantong, dan ekspornya
 * tahu itu (COA-nya `pusat`). Menandainya merah akan menyuruh orang
 * membereskan sesuatu yang sudah benar.
 */
export function tanpaKantong(entri) {
  if (entri?.dibayar_pusat) return false;
  return !entri?.account_id;
}
