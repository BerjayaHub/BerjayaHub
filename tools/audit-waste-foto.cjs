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
