/**
 * AUDIT: impor & laporan bengkel (Turboly + korporat) — 0185 s/d 0188.
 *
 * ============ SELURUH MODUL INI PUNYA SATU BENTUK KEGAGALAN ============
 *
 * Angkanya tetap keluar, tetap rapi, tetap masuk akal — dan salah. Daftar
 * nyata yang sudah pernah terjadi di data sungguhan si pemakai:
 *
 *   - `Cost` dari Turboly adalah TOTAL satu baris, bukan harga per unit. Oli 4
 *     liter: dikalikan qty, HPP-nya jadi 1,8 juta alih-alih 459 ribu. Labanya
 *     tetap berupa angka yang bisa dibaca.
 *   - Modal yang tidak diketahui disimpan sebagai 0 -> labanya terbaca 100%,
 *     dan laporan tidak punya cara membedakannya dari laba sungguhan.
 *   - Satu berkas ekspor memuat BEBERAPA store. Store yang belum dipetakan
 *     dilewati; "berhasil impor" saja menyembunyikannya sampai angkanya kurang
 *     di akhir bulan.
 *   - Outlet pembelian datang dari `Deliver To`, BUKAN `Warehouse`. Tertukar,
 *     seluruh pembelian cabang masuk ke cabang yang salah — dan dua-duanya
 *     tetap punya laporan yang terlihat wajar.
 *   - Ekspor PO tingkat store SELURUH harganya 0. Dianggap "barangnya gratis",
 *     pengeluarannya nol; yang benar adalah "harganya tidak ikut terekspor".
 *   - Impor yang tidak mengganti per dokumen menggandakan baris: omzet dua
 *     kali lipat tanpa satu pun galat.
 *   - QTY diformat sebagai rupiah ("Rp191") — contoh dari sheet lamanya
 *     sendiri keliru, dan kekeliruan yang disalin tidak terlihat seperti bug.
 *
 * Berkas ini menjaga pembedaan-pembedaan itu tetap ada di KODE, bukan cuma di
 * ingatan orang yang menulisnya.
 */
const fs = require('fs');
const path = require('path');
const { tanpaKomentar, periksaKewarasan } = require('./lib/tanpa-komentar.cjs');

const AKAR = path.dirname(__dirname);
let gagal = 0;
const salah = (pesan) => {
  gagal++;
  console.error(`❌ ${pesan}`);
};

const baca = (rel) => {
  const p = path.join(AKAR, rel);
  if (!fs.existsSync(p)) {
    salah(`${rel} tidak ada — audit ini kehilangan sasarannya.`);
    return null;
  }
  return fs.readFileSync(p, 'utf8');
};

const bacaKode = (rel, penanda) => {
  const asli = baca(rel);
  if (!asli) return null;
  const kode = tanpaKomentar(asli);
  const pesan = periksaKewarasan(asli, kode, penanda);
  if (pesan) {
    salah(`${rel}: ${pesan} — audit ini tidak bisa dipercaya untuk berkas itu.`);
    return null;
  }
  return kode;
};

const tanpaKomentarSql = (sql) =>
  sql
    .split('\n')
    .map((b) => (b.trim().startsWith('--') ? '' : b))
    .join('\n');

const sqlBersih = (rel) => {
  const m = baca(rel);
  return m ? tanpaKomentarSql(m) : null;
};

/** Potong satu fungsi SQL (sampai penutup `$$;`). */
const fungsiSql = (sql, nama) => {
  if (!sql) return '';
  const i = sql.indexOf(`function ${nama}(`);
  if (i < 0) return '';
  const j = sql.indexOf('\n$$;', i);
  return sql.slice(i, j < 0 ? undefined : j);
};

/** Potong satu fungsi JS yang di-export. */
const fungsiJs = (kode, nama, sampai) => {
  const i = kode.indexOf(`export function ${nama}(`);
  if (i < 0) return '';
  const j = sampai ? kode.indexOf(sampai, i) : -1;
  return kode.slice(i, j < 0 ? undefined : j);
};

const INV = 'js/modules/bengkel/baca-invoice-turboly.js';
const PO = 'js/modules/bengkel/baca-po-turboly.js';
const COCOK = 'js/modules/bengkel/cocokkan-beli-jual.js';
const SHEET = 'js/modules/bengkel/laporan-bentuk-sheet.js';
const KORPORAT = 'js/modules/bengkel/baris-korporat.js';
const SVC = 'js/modules/bengkel/penjualan-rinci.service.js';
const M185 = 'supabase/migrations/0185_penjualan_bengkel_rinci.sql';
const M186 = 'supabase/migrations/0186_pembelian_bengkel.sql';
const M187 = 'supabase/migrations/0187_tarik_impor_bengkel.sql';
const M188 = 'supabase/migrations/0188_tarik_impor_menyeluruh.sql';

const TES = [
  'tools/test-baca-invoice-turboly.mjs',
  'tools/test-baca-po-turboly.mjs',
  'tools/test-cocokkan-beli-jual.mjs',
  'tools/test-laporan-bentuk-sheet.mjs',
  'tools/test-baris-korporat.mjs',
  'tools/test-migrasi-0185.mjs',
  'tools/test-migrasi-0186.mjs',
  'tools/test-migrasi-0187.mjs',
  'tools/test-migrasi-0188.mjs'
];
for (const t of TES) {
  if (!fs.existsSync(path.join(AKAR, t))) salah(`${t} tidak ada — aturannya tidak pernah dijalankan.`);
}

// =====================================================================
// A. PEMBACA DETAILED SERVICE INVOICE
// =====================================================================
const inv = bacaKode(INV, ['cariHeader', 'bacaEksporTurboly', 'ringkasImpor']);
if (inv) {
  // ---- Header dicari dari ISI, bukan dari nomor baris ----
  //
  // Turboly menyisipkan pengantar (nama toko, periode, penyaring) di atas
  // tabel, dan panjangnya berubah mengikuti apa yang disaring. Nomor baris
  // yang dipatok akan membaca baris pengantar sebagai header: kolomnya kosong
  // semua, dan hasilnya "0 invoice terbaca" tanpa penjelasan apa pun.
  const ch = fungsiJs(inv, 'cariHeader', '\nexport');
  if (!ch) salah(`${INV}: \`cariHeader\` tidak ada.`);
  else if (!/for \(let i = 0; i < daftar\.length/.test(ch) || !/includes\('Item Type'\)/.test(ch)) {
    salah(`${INV}: header tidak dicari dari isinya — panjang pengantar Turboly berubah mengikuti penyaring, dan baris header yang dipatok akan membaca pengantar sebagai kolom.`);
  }

  // ---- `Cost` TIDAK dikalikan qty ----
  if (!/Cost: 'modal'/.test(inv)) {
    salah(`${INV}: kolom \`Cost\` tidak lagi dipetakan ke \`modal\`.`);
  }
  const ri = fungsiJs(inv, 'ringkasImpor', '\nexport');
  if (/modal[^\n]*\*[^\n]*qty|qty[^\n]*\*[^\n]*modal/.test(ri)) {
    salah(`${INV}: modal dikalikan qty — \`Cost\` sudah TOTAL per baris, dan HPP oli 4 liter akan jadi 1,8 juta alih-alih 459 ribu, tanpa satu pun galat.`);
  }
  // Modal yang TIDAK ADA dihitung terpisah, tidak dijadikan nol: nol membuat
  // labanya terbaca 100%.
  // SYARATNYA ikut diperiksa, bukan cuma nama penghitungnya: `if (false)` di
  // depan baris yang sama membuat penghitungnya tetap ada di kode dan tetap
  // selalu nol — dan audit yang cuma mencari namanya akan tetap hijau.
  if (!/\(b\.modal === null \|\| b\.modal === undefined\) r\.tanpaModal \+= 1/.test(ri)) {
    salah(`${INV}: baris tanpa modal tidak dihitung terpisah — modal kosong akan terbaca sebagai nol, dan labanya 100%.`);
  }
  // Jasa tidak punya modal barang. Dicampur, margin sparepart terlihat jauh
  // lebih sehat daripada kenyataannya.
  if (!/r\.laba = r\.omzetSparepart - r\.modal/.test(ri)) {
    salah(`${INV}: laba tidak dihitung dari omzet SPAREPART saja — omzet jasa yang tanpa modal akan membuat margin sparepart terlihat jauh lebih sehat.`);
  }
  if (!/KOLOM_WAJIB/.test(inv)) {
    salah(`${INV}: daftar kolom wajib hilang — berkas salah (mis. ekspor lain dari Turboly) akan terbaca sebagai 0 baris, bukan ditolak dengan penjelasan.`);
  }
}

// =====================================================================
// B. PEMBACA DETAILED PURCHASE ORDER
// =====================================================================
const po = bacaKode(PO, ['cariHeaderPo', 'bacaEksporPo', 'semuaHarganyaNol']);
if (po) {
  // ---- Outlet dari `Deliver To`, BUKAN `Warehouse` ----
  //
  // `Warehouse` adalah gudang yang mengeluarkan barang (sering satu untuk
  // semua cabang); `Deliver To` adalah alamat yang menerimanya. Tertukar,
  // SELURUH pembelian cabang masuk ke cabang yang salah — dan dua-duanya tetap
  // punya laporan yang terlihat wajar.
  if (!/'Deliver To': 'kirim_ke'/.test(po)) {
    salah(`${PO}: \`Deliver To\` tidak dipetakan ke \`kirim_ke\` — kalau outletnya diambil dari \`Warehouse\`, seluruh pembelian cabang masuk ke cabang yang salah.`);
  }
  const untuk = fungsiJs(po, 'poUntukRpc', '\nexport') || po;
  if (!/kirim_ke/.test(untuk)) {
    salah(`${PO}: \`kirim_ke\` tidak dikirim ke server — pemetaan outlet kehilangan satu-satunya petunjuk tujuan pengiriman.`);
  }

  // ---- "harganya tidak terekspor" ≠ "barangnya gratis" ----
  const snol = fungsiJs(po, 'semuaHarganyaNol', '\nexport');
  if (!snol) {
    salah(`${PO}: \`semuaHarganyaNol\` tidak ada — ekspor PO tingkat store yang seluruh harganya 0 akan terbaca sebagai pengeluaran nol.`);
  } else if (!/ringkas\.hargaNol \+ ringkas\.tanpaHarga === ringkas\.baris/.test(snol)) {
    salah(`${PO}: peringatan "semua harga nol" tidak lagi menuntut SELURUH barisnya nol — satu PO diskon 100% akan memunculkan peringatan palsu, dan peringatan palsu melatih orang mengabaikannya.`);
  }
  // Sel KOSONG dan angka 0 dihitung terpisah: yang pertama berarti harganya
  // tidak ikut terekspor, yang kedua bisa saja memang gratis.
  const rp = fungsiJs(po, 'ringkasPo', '\nexport');
  if (!/b\.harga === null/.test(rp) || !/Number\(b\.harga\) === 0/.test(rp)) {
    salah(`${PO}: sel harga yang kosong tidak dibedakan dari angka 0 — "tidak diketahui" akan terhitung sebagai "memang nol".`);
  }
}

// =====================================================================
// C. PENCOCOKAN BELI <-> JUAL (FIFO)
// =====================================================================
const cocok = bacaKode(COCOK, ['cocokkanBeliJual', 'ASAL']);
if (cocok) {
  // Barang tidak bisa terjual sebelum dibeli. Tanpa penjagaan ini, pembelian
  // bulan depan akan "membiayai" penjualan bulan ini — dan labanya terlihat
  // masuk akal, karena angkanya memang ada.
  if (!/if \(b\._tgl && j\._tgl && b\._tgl > j\._tgl\) continue;/.test(cocok)) {
    salah(`${COCOK}: penjagaan tanggal hilang — pembelian yang terjadi SESUDAH penjualan akan ikut dipakai, dan laba yang lahir dari situ tetap terlihat masuk akal.`);
  }
  if (!/ASAL\.SEBAGIAN/.test(cocok) || !/ASAL\.TIDAK_KETEMU/.test(cocok)) {
    salah(`${COCOK}: "ketemu sebagian" tidak dibedakan dari "ketemu" / "tidak ketemu" — modal separuh akan dibaca sebagai modal utuh.`);
  }
  // Hasil pencocokan adalah TEBAKAN berdasar FIFO, bukan catatan pemasangan
  // sungguhan. Kalimat itu harus ikut ke mana pun angkanya dibawa.
  if (!/catatanCocok/.test(cocok) || !/FIFO/.test(cocok)) {
    salah(`${COCOK}: catatan bahwa hasilnya tebakan FIFO hilang — angka tebakan akan dibaca sebagai catatan pemasangan sungguhan.`);
  }
}

// =====================================================================
// D. BENTUK SHEET: QTY BUKAN RUPIAH
// =====================================================================
const sheet = bacaKode(SHEET, ['KOLOM_JUAL', 'KOLOM_BELI', 'susunLaporanJual']);
if (sheet) {
  // Setiap kolom angka WAJIB menyatakan `uang` secara tegas — true atau false.
  // Bawaan yang tidak ditulis adalah cara QTY diam-diam jadi "Rp191" lagi,
  // dan satu-satunya yang melihatnya adalah orang yang membaca berkasnya
  // sebulan kemudian.
  const kolom = [...sheet.matchAll(/\{\s*header: '([^']+)',([^}]*)\}/g)];
  let angka = 0;
  for (const [, nama, sisa] of kolom) {
    if (!/numeric: true/.test(sisa)) continue;
    angka++;
    if (!/uang: (true|false)/.test(sisa)) {
      salah(`${SHEET}: kolom "${nama}" angka tapi tidak menyatakan \`uang\` — formatnya jadi bergantung pada nilai bawaan, dan QTY pernah tercetak sebagai "Rp191" justru karena itu.`);
    }
  }
  if (angka < 10) salah(`${SHEET}: hanya ${angka} kolom angka terbaca — polanya kemungkinan berubah, dan audit ini jadi longgar.`);
  const qty = kolom.filter(([, n]) => n === 'QTY');
  if (!qty.length) salah(`${SHEET}: kolom QTY tidak ada.`);
  for (const [, , sisa] of qty) {
    if (!/uang: false/.test(sisa)) {
      salah(`${SHEET}: QTY diformat sebagai mata uang — contoh di sheet lama memang begitu, dan itu kekeliruannya ("qty jangan dibuat Rp ya, itu yang dicontoh spreadsheet salah").`);
    }
  }
  // Harga beli ikut di baris penjualan, tapi harus terlihat DARI MANA ia
  // datang: nota sungguhan atau tebakan FIFO.
  // Dicari sebagai DEKLARASI KOLOM, bukan sekadar teksnya: kalimat catatan di
  // bawah laporan juga menyebut "Asal Harga Beli", jadi audit yang cuma
  // mencari teksnya tetap hijau walau kolomnya sudah dibuang — dan catatannya
  // berubah jadi penunjuk ke kolom yang tidak ada.
  if (!/\{ header: 'Asal Harga Beli'/.test(sheet)) {
    salah(`${SHEET}: kolom "Asal Harga Beli" hilang — modal dari nota tidak bisa dibedakan dari modal hasil tebakan FIFO.`);
  }
}

// =====================================================================
// E. BARIS KORPORAT: MODAL KOSONG TETAP KOSONG
// =====================================================================
const korp = bacaKode(KORPORAT, ['susunBarisKorporat', 'sahkanBaris', 'angkaIsian']);
if (korp) {
  const susun = fungsiJs(korp, 'susunBarisKorporat', '\nexport');
  if (!/m === '' \? '' : String\(angkaIsian\(m\)\)/.test(susun)) {
    salah(`${KORPORAT}: modal yang dikosongkan tidak lagi dibiarkan kosong — kalau ia jadi 0, labanya terbaca 100% dan laporan tidak punya cara membedakannya dari laba sungguhan.`);
  }
  // Total DIHITUNG, tidak diketik: total yang diketik tangan bisa tidak sama
  // dengan harga × qty, dan yang menang di laporan adalah yang diketik.
  if (!/total: totalBaris\(b\)/.test(susun)) {
    salah(`${KORPORAT}: total baris tidak dihitung dari harga × qty — total yang diketik tangan akan menang di laporan tanpa pernah diperiksa.`);
  }
  const sah = fungsiJs(korp, 'sahkanBaris', '\nexport');
  if (!/qty harus lebih dari 0/.test(sah)) {
    salah(`${KORPORAT}: qty 0 atau minus tidak ditolak.`);
  }
  // Baris yang SELURUHNYA kosong bukan kesalahan — selalu ada satu di bawah
  // daftar. Tanpa pembedaan ini, formnya menolak disimpan selamanya.
  if (!/barisKosongSemua/.test(sah)) {
    salah(`${KORPORAT}: baris yang masih kosong tidak dibedakan dari baris yang salah isi — formnya akan menolak disimpan selamanya.`);
  }
}

// =====================================================================
// F. 0185 — PENJUALAN
// =====================================================================
const s185 = sqlBersih(M185);
if (s185) {
  if (!/NULL = tidak diketahui/.test(baca(M185) ?? '')) {
    salah(`${M185}: keterangan bahwa modal NULL berarti "tidak diketahui" hilang — yang membacanya nanti akan menganggap boleh menulis 0.`);
  }
  const impor = fungsiSql(s185, 'impor_penjualan_bengkel');
  if (!impor) salah(`${M185}: \`impor_penjualan_bengkel\` tidak ada.`);
  else {
    // Invoice KORPORAT tidak pernah disentuh impor: ia diketik orang, dan
    // impor yang menimpanya menghapus pekerjaan yang tidak ada di berkas mana
    // pun untuk dipulihkan.
    if (!/v_sumber = 'korporat'/.test(impor)) {
      salah(`${M185}: invoice korporat tidak dikecualikan dari impor — berkas Turboly bisa menimpa invoice yang diketik orang, dan tidak ada berkas untuk memulihkannya.`);
    }
    // Store yang belum dipetakan DILEWATI dan DILAPORKAN. Dilewati tanpa
    // dilaporkan = angka yang kurang di akhir bulan tanpa sebab yang bisa
    // ditunjuk.
    // PENGUMPULANNYA yang diperiksa, bukan cuma nama lariknya: deklarasi dan
    // baris `return` tetap menyebut `v_lewat_store` walau pengisiannya sudah
    // dibuang — hasilnya larik yang selalu kosong, dan layar yang selalu
    // berkata tidak ada store yang perlu dipetakan.
    if (!/v_lewat_store := v_lewat_store \|\| v_store/.test(impor)) {
      salah(`${M185}: store yang belum dipetakan tidak dilaporkan kembali — invoice yang dilewati baru terasa saat omzetnya kurang di akhir bulan.`);
    }
    // Penggantian PER INVOICE: tanpa ini, impor ulang berkas yang sama
    // menggandakan barisnya, dan omzetnya dua kali lipat tanpa satu galat.
    if (!/delete from bengkel_sale_lines where invoice_id = v_id;/.test(impor)) {
      salah(`${M185}: baris lama satu invoice tidak dihapus sebelum ditulis ulang — impor ulang berkas yang sama akan menggandakan omzetnya.`);
    }
  }
  // Jalan tulis langsung harus tertutup: `insert` dari klien melewati seluruh
  // penggantian per invoice di atas.
  if (/create policy[^\n]*bengkel_sale_(invoices|lines)[^\n]*\n?[^;]*for insert/i.test(s185)) {
    salah(`${M185}: ada policy insert langsung ke tabel penjualan — RPC-nya jadi bisa dilewati, beserta penggantian per invoicenya.`);
  }
}

// =====================================================================
// G. 0186 — PEMBELIAN
// =====================================================================
const s186 = sqlBersih(M186);
if (s186) {
  const impor = fungsiSql(s186, 'impor_pembelian_bengkel');
  if (!impor) salah(`${M186}: \`impor_pembelian_bengkel\` tidak ada.`);
  else {
    if (!/jenis = 'kirim'/.test(impor)) {
      salah(`${M186}: outlet pembelian tidak dicari di pemetaan \`kirim\` — kalau ia memakai pemetaan Store, nama store dan alamat kirim akan saling tertukar.`);
    }
    // Alamat yang belum dikenali -> PEMBELIAN PUSAT, dihitung dan dilaporkan.
    // Dibuang diam-diam, nilai pembeliannya terlihat lebih kecil daripada
    // kenyataannya tanpa ada yang memintanya.
    if (!/v_pusat := v_pusat \+ 1/.test(impor)) {
      salah(`${M186}: baris yang alamat kirimnya belum dipetakan tidak dihitung sebagai pembelian pusat — nilai pembelian akan terlihat lebih kecil daripada kenyataannya.`);
    }
    if (!/v_alamat_belum/.test(impor)) {
      salah(`${M186}: alamat kirim yang belum dikenali tidak dilaporkan kembali — tidak ada cara tahu apa yang perlu dipetakan.`);
    }
    if (!/delete from bengkel_purchase_lines/.test(impor)) {
      salah(`${M186}: baris lama satu PO tidak dihapus sebelum ditulis ulang — impor ulang akan menggandakan pengeluarannya.`);
    }
  }
  // ============ FUNGSI LAMA YANG IKUT RUSAK ============
  //
  // 0186 mengganti indeks unik `bengkel_store_map`, dan `on conflict` di
  // `petakan_store_bengkel` (0185) menunjuk indeks yang sudah tidak ada. Itu
  // bukan galat saat migrasi dijalankan — ia baru muncul saat seseorang
  // memetakan store, bulan-bulan kemudian.
  const petakan = fungsiSql(s186, 'petakan_store_bengkel');
  if (!petakan) {
    salah(`${M186}: \`petakan_store_bengkel\` tidak ditulis ulang di sini — indeks unik yang digantinya membuat \`on conflict\` versi 0185 menunjuk indeks yang sudah tidak ada, dan galatnya baru muncul saat ada yang memetakan store.`);
  } else if (!/on conflict \(business_unit_id, jenis, lower\(btrim\(store_name\)\)\)/.test(petakan)) {
    salah(`${M186}: \`petakan_store_bengkel\` tidak memakai indeks unik yang baru (dengan \`jenis\`).`);
  }
}

// =====================================================================
// H. 0187 & 0188 — TARIK KEMBALI SATU BERKAS
// =====================================================================
const s187 = sqlBersih(M187);
const s188 = sqlBersih(M188);
if (s187) {
  for (const nama of ['impor_penjualan_bengkel', 'impor_pembelian_bengkel']) {
    const f = fungsiSql(s187, nama);
    if (f && !/import_run_id/.test(f)) {
      salah(`${M187}: \`${nama}\` tidak mencantumkan \`import_run_id\` — tanpa itu tidak ada cara tahu baris mana datang dari berkas mana, dan "tarik kembali satu berkas" tidak mungkin dilakukan.`);
    }
  }
  const prat = fungsiSql(s187, 'pratinjau_tarik_impor');
  if (!prat) salah(`${M187}: \`pratinjau_tarik_impor\` tidak ada — orang akan menarik impor tanpa pernah tahu berapa yang akan hilang.`);
}
if (s188) {
  if (!/nomor_dokumen text\[\]/.test(s188)) {
    salah(`${M188}: \`nomor_dokumen\` tidak ditambahkan — nomor dokumen yang sudah digantikan impor lain tidak bisa ditelusuri lagi.`);
  }
  // Nomornya dicatat SAAT IMPOR. Dihitung belakangan dari baris yang masih
  // ada, dokumen yang sudah digantikan impor lain tidak akan pernah terdaftar
  // — yaitu justru yang perlu dihapus.
  for (const nama of ['impor_penjualan_bengkel', 'impor_pembelian_bengkel']) {
    const f = fungsiSql(s188, nama);
    if (!f) salah(`${M188}: \`${nama}\` tidak ditulis ulang untuk mencatat nomor dokumen.`);
    else if (!/nomor_dokumen = /.test(f)) {
      salah(`${M188}: \`${nama}\` tidak menyimpan nomor dokumen saat impor — dokumen yang kemudian digantikan impor lain jadi tidak bisa ditarik.`);
    }
  }
  const tarik = fungsiSql(s188, 'tarik_impor_bengkel');
  if (!tarik) {
    salah(`${M188}: \`tarik_impor_bengkel\` versi baru tidak ada.`);
  } else {
    if (!/p_semua/.test(tarik)) {
      salah(`${M188}: penarikan menyeluruh (\`p_semua\`) hilang — nomor yang sudah digantikan impor lain akan tertinggal, dan pemakainya tetap disuruh memilih satu nomor dokumen alih-alih satu berkas.`);
    }
    // Invoice KORPORAT tidak pernah ikut tersapu: ia tidak berasal dari berkas
    // mana pun, dan menghapusnya menghapus pekerjaan yang diketik orang.
    if (!/sumber = 'turboly'/.test(tarik)) {
      salah(`${M188}: penarikan menyeluruh tidak membatasi diri pada \`sumber = 'turboly'\` — invoice korporat yang diketik orang bisa ikut terhapus.`);
    }
    if (!/ditarik_at = now\(\)/.test(tarik)) {
      salah(`${M188}: penarikan tidak meninggalkan jejak di riwayat — "angkanya kok hilang" tidak akan punya jawaban di mana pun.`);
    }
  }
  // Pratinjau TIDAK BOLEH mengubah apa pun: yang memanggilnya sedang
  // memastikan, belum memutuskan.
  const prat = fungsiSql(s188, 'pratinjau_tarik_impor');
  if (prat && /\n\s*(delete from|update) (bengkel_sale|bengkel_purchase|bengkel_import)/.test(prat)) {
    salah(`${M188}: \`pratinjau_tarik_impor\` ikut mengubah data — yang memanggilnya sedang memastikan, belum memutuskan.`);
  }
}

// =====================================================================
// I. KLIEN: TULIS LEWAT RPC, BACA TANPA TERPOTONG
// =====================================================================
const svc = bacaKode(SVC, ['imporPenjualanTurboly', 'barisPenjualan', 'tarikImpor']);
if (svc) {
  // Penolakan RLS pada DELETE tidak melempar galat: ia membalas sukses dengan
  // NOL baris. Layarnya lalu berkata "terhapus" kepada orang yang ditolak.
  if (/\.from\('bengkel_[a-z_]+'\)[\s\S]{0,80}\.(insert|update|delete|upsert)\(/.test(svc)) {
    salah(`${SVC}: ada tulis langsung ke tabel bengkel — penolakan RLS pada \`delete\` membalas sukses dengan NOL baris, dan layarnya akan mengaku berhasil.`);
  }
  // Satu bulan bengkel = ratusan invoice × beberapa baris. Batas bawaan
  // PostgREST 1000 baris memotong diam-diam, dan laporan yang kurang 200 baris
  // tetap tercetak rapi.
  for (const nama of ['barisPenjualan', 'barisPembelian']) {
    const i = svc.indexOf(`export async function ${nama}(`);
    const f = i < 0 ? '' : svc.slice(i, svc.indexOf('\n}', i));
    if (!f) salah(`${SVC}: \`${nama}\` tidak ada.`);
    else if (!/ambilSemua\(/.test(f)) {
      salah(`${SVC}: \`${nama}\` tidak memakai \`ambilSemua\` — batas 1000 baris PostgREST akan memotong laporan diam-diam, dan hasilnya tetap tercetak rapi.`);
    }
  }
  // Kunci `p_semua` SELALU dikirim: PostgREST memilih fungsi lewat himpunan
  // nama argumen, dan kunci yang hilang mencari tanda tangan yang sudah
  // sengaja dibuang di 0188.
  if (!/p_semua: Boolean\(semua\)/.test(svc)) {
    salah(`${SVC}: \`p_semua\` tidak selalu dikirim — PostgREST akan mencari tanda tangan \`tarik_impor_bengkel\` yang sudah dibuang di 0188.`);
  }
}

console.log('');
if (gagal === 0) console.log('Audit impor & laporan bengkel bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
