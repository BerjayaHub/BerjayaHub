/**
 * AUDIT: waste/spoil wajib berfoto, dan rekapnya bisa dipertanggungjawabkan.
 *
 * ============ APA YANG SEBENARNYA DIJAGA ============
 *
 *   "sediakan input foto bahan yang di spoil atau menu yang di waste, dan ini
 *    wajib, jika tidak diinput foto maka tidak bisa simpan"
 *
 * Kewajiban yang hanya hidup di layar bertahan persis sampai PWA di HP staff
 * tertinggal versi. Dan waste tanpa foto TIDAK menghasilkan error apa pun:
 * stoknya tetap berkurang, laporannya tetap rapi, yang hilang cuma satu-satunya
 * bukti yang tersisa sesudah barangnya dibuang.
 *
 * Maka yang diperiksa di sini bukan "ada field fotonya", melainkan bahwa
 * KETIGA lapisnya utuh:
 *
 *   1. kolom `photo_path` NOT NULL + tidak boleh string kosong
 *   2. `catat_waste` menolak lebih dulu, dengan pesan yang bisa ditindaklanjuti
 *   3. trigger menutup JALUR LAMA — insert langsung `stock_movements` dan
 *      `record_menu_waste` (0032)
 *
 * Lapis ketiga yang paling mudah hilang dan paling mahal: tanpanya, seluruh
 * fitur ini adalah aturan yang berlaku hanya bagi orang yang memakai layar
 * barunya.
 */
const fs = require('fs');
const path = require('path');
const { tanpaKomentar } = require('./lib/tanpa-komentar.cjs');

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

// ---------------------------------------------------------------
// 1. Migration: tiga lapis kewajiban fotonya.
// ---------------------------------------------------------------
const mig = baca('supabase/migrations/0135_waste_foto_wajib.sql');
if (mig) {
  // Lapis 1 — kolomnya sendiri.
  if (!/photo_path text not null check \(btrim\(photo_path\) <> ''\)/.test(mig)) {
    salah(
      '0135: `waste_runs.photo_path` tidak lagi `not null` + tolak string kosong. ' +
        'String kosong LOLOS dari `not null`, dan string kosong persis yang dikirim form yang bidangnya tidak diisi — ' +
        'yang tersimpan akan tampak berfoto sampai ada yang mengkliknya.'
    );
  }

  // Lapis 2 — RPC menolak duluan, dengan kalimat yang bisa ditindaklanjuti.
  if (!/v_foto text := nullif\(btrim\(coalesce\(p_photo, ''\)\), ''\);/.test(mig)) {
    salah('0135 `catat_waste`: fotonya tidak dirapikan lebih dulu — spasi akan lolos sebagai foto yang sah.');
  }
  if (!/if v_foto is null then\s*\n\s*raise exception 'Foto wajib diisi/.test(mig)) {
    salah(
      "0135 `catat_waste`: tidak menolak foto kosong dengan pesannya sendiri. " +
        'Pesan constraint ("null value violates not-null") tidak memberi tahu staff apa yang harus ia lakukan, ' +
        'dan yang membacanya sedang berdiri di dapur.'
    );
  }

  // Lapis 3 — JALUR LAMA. Ini yang membuat "wajib" berarti sesuatu.
  if (!/create trigger trg_waste_wajib_dokumen/.test(mig)) {
    salah(
      '0135: trigger `trg_waste_wajib_dokumen` hilang. ' +
        'Tanpa itu, insert langsung ke `stock_movements` (jalur yang dipakai versi sebelumnya) tetap bisa ' +
        'menyimpan waste tanpa foto — tanpa satu pun error.'
    );
  }
  if (!/if new\.movement_type = 'waste' and new\.waste_run_id is null then/.test(mig)) {
    salah('0135 `jaga_waste_berdokumen`: syaratnya berubah — baris waste tanpa dokumen tidak lagi ditolak.');
  }
  if (!/create or replace function record_menu_waste\(/.test(mig) || !/raise exception 'Pencatatan waste sekarang wajib menyertakan foto/.test(mig)) {
    salah(
      '0135: `record_menu_waste` (0032) tidak diganti jadi penolakan yang MENJELASKAN. ' +
        'Dibiarkan apa adanya ia gagal lewat trigger dengan pesan yang membingungkan; dihapus, PWA lama mendapat ' +
        '42883 "function does not exist" yang tidak berarti apa-apa bagi staff.'
    );
  }

  // Waste tidak boleh menulis `unit_cost` — ia sumber tunggal biaya rata-rata.
  const blokCatat = mig.slice(mig.indexOf('create or replace function catat_waste'));
  if (/insert into stock_movements[^;]*unit_cost/.test(blokCatat)) {
    salah(
      '0135 `catat_waste`: menulis `unit_cost` pada pergerakan waste. ' +
        'Itu sumber tunggal biaya rata-rata (0118) dan sejak 0123 hanya diisi PEMBELIAN — waste adalah pengeluaran barang.'
    );
  }

  // Bucketnya privat. Isinya bahan busuk milik outlet.
  if (!/values \('waste-photos', 'waste-photos', false\)/.test(mig)) {
    salah('0135: bucket `waste-photos` tidak dibuat, atau dibuat PUBLIK.');
  }
  // Tanggal rekapnya WIB. Tujuh jam menggeser waste tengah malam ke hari lain.
  if (!/\(w\.created_at at time zone 'Asia\/Jakarta'\)::date as tanggal/.test(mig)) {
    salah("0135 view `waste_rekap`: tanggalnya bukan WIB. Rekap harian akan bergeser tujuh jam dari catatan di outlet.");
  }
  // Tanpa policy tulis: satu-satunya jalan masuk adalah RPC-nya.
  if (/create policy waste_runs_(insert|modify|all)/.test(mig)) {
    salah('0135: ada policy tulis pada `waste_runs` — itu membuka jalan menyimpan waste tanpa lewat `catat_waste`.');
  }
}

// ---------------------------------------------------------------
// 1b. Rekapnya HARUS memuat catatan sebelum foto diwajibkan.
//
// `0135` membangun `waste_rekap` yang hanya membaca `waste_runs`, lalu tab
// rekapnya kosong sementara tab Riwayat penuh — dan komentar di 0135 sendiri
// sudah memperingatkan bahwa "menyembunyikan sejarah akan terbaca sebagai data
// yang hilang". `0136` menggabungkannya lewat view, TANPA memindahkan datanya.
// ---------------------------------------------------------------
const mig36 = baca('supabase/migrations/0136_rekap_waste_ikut_yang_lama.sql');
if (mig36) {
  if (!/union all/i.test(mig36)) {
    salah(
      '0136: `waste_rekap` tidak lagi menggabungkan catatan lama. ' +
        'Waste sebelum 0135 hidup di `stock_movements` tanpa dokumen — tanpa gabungan ini, tab rekapnya kosong ' +
        'sementara tab Riwayat penuh, dan admin kehilangan data yang masih ia perlukan.'
    );
  }
  if (!/where sm\.movement_type = 'waste'\s*\n\s*and sm\.waste_run_id is null/.test(mig36)) {
    salah(
      '0136: penyaring baris lamanya berubah. Ia harus TEPAT `movement_type = waste` DAN `waste_run_id is null` — ' +
        'tanpa syarat kedua, tiap kejadian baru akan muncul dua kali.'
    );
  }
  if (!/case when sm\.notes like 'Waste menu: %' then 'menu' else 'spoil' end as jenis/.test(mig36)) {
    salah('0136: jenis baris lama tidak dipulihkan dari `notes` — keterangannya akan menyebut semuanya bahan mentah.');
  }
  if (!/md5\(sm\.outlet_id::text \|\| sm\.created_at::text \|\| coalesce\(sm\.notes, ''\)\)::uuid/.test(mig36)) {
    salah(
      '0136: baris-baris satu waste menu lama tidak dikelompokkan kembali. ' +
        'Tiap bahan akan terhitung sebagai kejadian tersendiri, dan "berapa kali waste bulan ini" jadi salah berlipat.'
    );
  }
  if (!/true\s+as lama/.test(mig36) || !/false\s+as lama/.test(mig36)) {
    salah(
      '0136: kolom `lama` hilang. Tanpa penanda itu layar menampilkan sel foto kosong, yang terbaca sebagai ' +
        '"staffnya lupa memfoto" — padahal fotonya memang belum diwajibkan saat itu.'
    );
  }
  // Datanya TIDAK boleh dipindahkan. Backfill menuntut `photo_path` boleh
  // kosong, dan itu membuka kembali pintu untuk data BARU tanpa foto.
  if (/insert into waste_runs/i.test(mig36)) {
    salah(
      '0136: ada `insert into waste_runs` — datanya dipindahkan, bukan digabung di view. ' +
        'Backfill menuntut `photo_path` boleh kosong, dan melonggarkannya demi data lama membuka pintu untuk data baru selamanya.'
    );
  }
  if (/alter table waste_runs[^;]*photo_path[^;]*drop not null/i.test(mig36)) {
    salah('0136: `photo_path not null` dilepas — lapis pertama kewajiban fotonya hilang.');
  }
}

const svcLama = baca('js/modules/inventory/waste.service.js');
if (svcLama) {
  const kode = tanpaKomentar(svcLama);
  // Kolom baru tidak boleh menyandera seluruh layar (pelajaran 0122).
  if (!/return await ambil\(KOLOM_DASAR\)/.test(kode)) {
    salah(
      'waste.service.js: tidak ada jalan cadangan saat kolom `lama` belum ada. ' +
        'PostgREST menolak SELURUH permintaan karena satu kolom tidak dikenal — dan yang hilang bukan satu kolom, ' +
        'melainkan seluruh rekapnya. Persis yang terjadi pada 0122.'
    );
  }
}

// ---------------------------------------------------------------
// 2. Layar staff: fotonya wajib DI SINI juga, dan jalur lamanya ditinggalkan.
// ---------------------------------------------------------------
const hal = baca('js/modules/inventory/inventory.page.js');
if (hal) {
  const kode = tanpaKomentar(hal);
  if (!/name: 'foto'[\s\S]{0,200}required: true/.test(kode)) {
    salah("inventory.page.js: field foto pada dialog Waste/Spoil tidak `required: true`.");
  }
  if (!/catatWaste\(/.test(kode)) {
    salah('inventory.page.js: tidak memakai `catatWaste` — waste tidak akan punya dokumen maupun foto.');
  }
  if (!/unggahFotoWaste\(/.test(kode)) {
    salah('inventory.page.js: fotonya tidak pernah diunggah.');
  }
  // Jalur lama harus benar-benar ditinggalkan, bukan sekadar tidak dipakai.
  if (/recordMenuWaste/.test(kode)) {
    salah(
      "inventory.page.js: masih memanggil `recordMenuWaste`. Sejak 0135 fungsi itu hanya berisi penolakan — " +
        'memanggilnya berarti layar barunya gagal dengan pesan tentang memperbarui aplikasi.'
    );
  }
  if (/doMovement\('waste'/.test(kode)) {
    salah(
      "inventory.page.js: spoil masih ditulis lewat `doMovement('waste', …)`. " +
        'Sejak 0135 insert itu ditolak trigger — dan sebelum 0135 ia persis jalan yang menyimpan waste tanpa foto.'
    );
  }
  // Unggahan gagal = TIDAK ADA yang tersimpan. Itu justru yang diminta.
  const iUnggah = kode.indexOf('unggahFotoWaste(');
  const iCatat = kode.indexOf('catatWaste(');
  if (iUnggah >= 0 && iCatat >= 0 && iUnggah > iCatat) {
    salah('inventory.page.js: wastenya dicatat sebelum fotonya diunggah — kalau unggahannya gagal, catatannya tertinggal tanpa foto.');
  }
}

// ---------------------------------------------------------------
// 3. Aturan rekapnya, dan kolom keterangan yang jadi intinya.
// ---------------------------------------------------------------
const murni = baca('js/modules/inventory/laporan-waste.js');
if (murni) {
  const kode = tanpaKomentar(murni);
  for (const n of ['susunRekapWaste', 'keteranganWaste', 'kunciBiaya']) {
    if (!new RegExp(`export function ${n}\\(`).test(kode)) salah(`laporan-waste.js: \`${n}\` tidak diekspor.`);
  }
  if (!/baris\?\.jenis === JENIS_MENU/.test(kode)) {
    salah(
      'laporan-waste.js: keterangannya tidak lagi membedakan waste menu dari spoil. ' +
        'Itu seluruh isi permintaannya — tanpa kolom itu, "Beras 1,2 kg" tidak bisa dibedakan antara beras kena air ' +
        'dan nasi goreng gosong, dan keduanya menuntut tindakan yang berbeda.'
    );
  }
  // Biaya rata-rata BERBEDA PER OUTLET (0118).
  if (!/return `\$\{teks\(outletId\)\}\|\$\{teks\(productId\)\}`/.test(kode)) {
    salah(
      'laporan-waste.js: kunci biaya tidak lagi memuat outlet. ' +
        'Harga beli beras di Sentul bukan harga beli beras di Serpong — angkanya akan tetap masuk akal, jadi tidak ada yang memeriksanya.'
    );
  }
  // DUA SUMBER NILAI. Barang setengah jadi tidak pernah dibeli lewat nota, jadi
  // ia TIDAK AKAN PERNAH punya baris `biaya_rata_bahan` — yang ada cuma HPP
  // resepnya. Versi pertama layar ini hanya melihat sumber pertama, dan seluruh
  // barang produksi berbunyi "-" sementara Master Produk menampilkan angkanya.
  if (!/export function hargaSatuanBahan\(/.test(kode)) {
    salah('laporan-waste.js: `hargaSatuanBahan` tidak diekspor — nilai barang produksi tidak punya cadangan.');
  }
  if (!/if \(dariNota !== null\) return \{ nilai: dariNota, sumber: SUMBER_NOTA \};/.test(kode)) {
    salah(
      'laporan-waste.js: biaya nota tidak lagi menang lebih dulu. ' +
        'Yang benar-benar dibayar ke supplier harus mengalahkan ongkos hitungan — kalau terbalik, laporan kerugian ' +
        'memakai angka teoretis padahal angka sebenarnya ada.'
    );
  }
  if (!/if \(dariHpp !== null\) return \{ nilai: dariHpp, sumber: SUMBER_HPP \};/.test(kode)) {
    salah(
      'laporan-waste.js: HPP resep tidak dipakai sebagai cadangan. ' +
        'Barang setengah jadi tidak pernah dibeli — tanpa cadangan ini, seluruh waste barang produksi berbunyi "-".'
    );
  }
  // Sumbernya harus DISEBUT. Dua-duanya rupiah, artinya berbeda: uang yang
  // keluar ke supplier vs ongkos membuat sendiri.
  if (!/\{ header: 'Sumber nilai'/.test(kode)) {
    salah(
      "laporan-waste.js: kolom 'Sumber nilai' hilang. " +
        'Totalnya menjumlahkan dua hal yang berbeda artinya, dan tanpa kolom itu hasilnya terlihat pasti tapi tidak ' +
        'bisa dipertanggungjawabkan.'
    );
  }
  if (!/r\.nilai === null \? '-'/.test(kode)) {
    salah("laporan-waste.js: nilai yang belum ada tidak ditulis \"-\". Rp0 membuat total kerugian terlihat lebih kecil dari yang sebenarnya.");
  }
  if (!/tanpaNilai\+\+/.test(kode)) {
    salah('laporan-waste.js: baris tanpa biaya tidak dihitung — kekurangannya tidak bisa disebut di mana pun.');
  }
  if (!/\{ header: 'Foto', width: [\d.]+, foto: true \}/.test(kode)) {
    salah('laporan-waste.js: kolom Foto tidak ditandai `foto: true` — gambarnya tidak akan disisipkan ke sel Excel.');
  }
}

// ---------------------------------------------------------------
// 4. Layar admin: tabel + ekspor berfoto.
// ---------------------------------------------------------------
const adm = baca('js/modules/inventory/waste.admin.js');
if (adm) {
  const kode = tanpaKomentar(adm);
  if (!/exportTableXLSXFoto\(/.test(kode)) {
    salah(
      'waste.admin.js: tidak memakai `exportTableXLSXFoto`. ' +
        'Tautan bertanda tangan tidak cukup — berkasnya dikirim lewat WhatsApp dan dibuka orang yang tidak login, ' +
        'dan tautan yang kedaluwarsa dalam sejam membuat seluruh kolom buktinya kosong tepat saat dibaca.'
    );
  }
  if (!/imageToDataUrl\(/.test(kode)) {
    salah('waste.admin.js: fotonya tidak diubah jadi data URL — yang tertanam di berkas hanya bisa data URL.');
  }
  // "GAGAL" dibedakan dari kosong. Sel kosong terbaca sebagai "tidak difoto",
  // lalu staffnya ditegur untuk sesuatu yang sudah ia lakukan.
  if (!/dataUrl \?\? 'GAGAL'/.test(kode)) {
    salah('waste.admin.js: foto yang gagal dimuat dikosongkan, bukan ditandai `GAGAL` — itu terbaca sebagai waste yang tidak difoto.');
  }
  if (!/lapTampil/.test(kode)) {
    salah('waste.admin.js: yang diekspor bukan laporan yang sedang terlihat.');
  }
  // HPP-nya harus benar-benar DIHITUNG dan DITERUSKAN. `hargaSatuanBahan` boleh
  // punya cadangan, tapi kalau petanya tidak pernah diisi ia selalu kosong —
  // dan hasilnya sama persis dengan bug yang baru saja diperbaiki.
  if (!/computeCosts\(products, recipes\)/.test(kode)) {
    salah('waste.admin.js: HPP resep tidak pernah dihitung — barang produksi akan kembali berbunyi "-".');
  }
  if (!/susunRekapWaste\(\{[\s\S]{0,160}hpp,/.test(kode)) {
    salah('waste.admin.js: `hpp` tidak diteruskan ke `susunRekapWaste` — cadangannya ada tapi tidak pernah terpakai.');
  }
  // Gagal memuat sumber nilai harus DIKATAKAN.
  //
  // Bentuk pertamanya `catch {}` kosong: kalau pengambilannya gagal, SELURUH
  // kolom Nilai berbunyi "-" dan tidak ada yang membedakannya dari "memang
  // belum ada harganya" — admin lalu mencari sebabnya di tempat yang salah.
  //
  // Yang diperiksa BLOK PELAPORNYA, bukan sekadar ada-tidaknya nama variabel.
  // Sabotase pertama pada aturan ini lolos persis begitu: ia mengganti nama
  // deklarasinya saja, dan nama lamanya masih tersisa di baris lain — jadi
  // pemeriksaan "ada kata `sumberGagal`" tetap hijau untuk kode yang sudah
  // berhenti melapor.
  if (!/if \(sumberGagal\.length\) \{[\s\S]{0,220}toast\(/.test(kode)) {
    salah(
      'waste.admin.js: kegagalan memuat sumber nilai tidak dilaporkan ke layar. ' +
        'Kalau pengambilannya gagal, SELURUH kolom Nilai berbunyi "-" dan tidak ada yang membedakannya dari ' +
        '"memang belum ada harganya" — admin lalu mencari sebabnya di tempat yang salah.'
    );
  }
  // KEDUA sumbernya harus melapor. Satu yang diam berarti separuh kolom Nilai
  // bisa kosong tanpa sebab yang bisa ditunjuk.
  if ((kode.match(/sumberGagal\.push\(/g) ?? []).length < 2) {
    salah(
      'waste.admin.js: hanya sebagian sumber nilai yang melaporkan kegagalannya. ' +
        'Biaya nota dan HPP resep dimuat terpisah; yang diam akan mengosongkan barisnya sendiri tanpa jejak.'
    );
  }
  if (!/waste_rekap/.test(kode)) {
    salah(
      'waste.admin.js: tidak ada pesan khusus saat `waste_rekap` belum ada. ' +
        '"relation does not exist" tidak memberi tahu admin bahwa yang kurang adalah migration 0135 — bug yang sama pernah terjadi pada 0122.'
    );
  }
}

const tab = baca('js/modules/inventory/inventory.admin.page.js');
if (tab) {
  const kode = tanpaKomentar(tab);
  if (!/\{ key: 'waste', label: 'Waste \/ Spoil' \}/.test(kode)) {
    salah('inventory.admin.page.js: tab Waste / Spoil tidak terdaftar — rekapnya ada tapi tidak ada jalan membukanya.');
  }
  if (!/if \(key === 'waste'\) await renderWasteAdmin\(/.test(kode)) {
    salah('inventory.admin.page.js: tab Waste / Spoil terdaftar tapi tidak menggambar apa pun.');
  }
}

// ---------------------------------------------------------------
// 5. Servicenya: fotonya dikecilkan, dan rekapnya tidak terpotong.
// ---------------------------------------------------------------
const svc = baca('js/modules/inventory/waste.service.js');
if (svc) {
  const kode = tanpaKomentar(svc);
  if (!/compressImage\(/.test(kode)) {
    salah(
      'waste.service.js: foto waste tidak dikecilkan sebelum diunggah. ' +
        'Foto kamera HP 2-4 MB, bertambah tiap hari di tiap outlet — free tier Supabase 1 GB habis dalam hitungan bulan.'
    );
  }
  // Diperiksa DI DALAM `rekapWaste`, bukan di seluruh berkas.
  //
  // `getBiayaRataBu` juga memakai `ambilSemua`, jadi pemeriksaan sefile akan
  // tetap hijau walau rekapnya sendiri sudah dilepas paginasinya — dan yang
  // hilang justru baris waste paling lama, tanpa satu pun tanda.
  const iRekap = kode.indexOf('export async function rekapWaste');
  const blokRekap = iRekap >= 0 ? kode.slice(iRekap, iRekap + 1200) : '';
  if (!blokRekap) {
    salah('waste.service.js: `rekapWaste` tidak ada.');
  } else if (!/ambilSemua\(/.test(blokRekap)) {
    salah('waste.service.js `rekapWaste`: tidak memakai `ambilSemua` — PostgREST memotong diam-diam di sekitar 1000 baris.');
  }
  if (!/catat_waste/.test(kode)) {
    salah('waste.service.js: tidak memanggil RPC `catat_waste`.');
  }
  if (!/if \(!photoPath\) throw new Error/.test(kode)) {
    salah('waste.service.js: tidak menolak lebih dulu saat fotonya kosong — penolakannya jadi menunggu satu perjalanan jaringan.');
  }
}

if (gagal === 0) {
  console.log(
    'Waste/Spoil: foto wajib di tiga lapis (kolom, RPC, trigger), jalur lama tertutup, ' +
      'rekapnya berketerangan dan fotonya tertanam di Excel. ✅'
  );
}
process.exit(gagal === 0 ? 0 : 1);
