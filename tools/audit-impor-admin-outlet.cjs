/**
 * AUDIT: admin outlet mengimpor Turboly (0189).
 *
 * ============ APA YANG DIJAGA DI SINI ============
 *
 * 0189 melonggarkan wewenang di satu-satunya tempat di aplikasi ini yang
 * bekerja dengan cara MENGHAPUS LALU MENULIS ULANG, dan berkas yang diunggah
 * bisa memuat beberapa cabang sekaligus. Jadi yang dijaga bukan "siapa yang
 * boleh memanggil" (itu satu baris, dan tesnya sudah menutupinya), tapi tiga
 * hal yang kalau hilang tidak memunculkan galat apa pun:
 *
 *   1. URUTANNYA. Penjagaan outlet harus jalan SEBELUM `delete`/`update`.
 *      Ditaruh sesudahnya, data cabang lain terhapus lebih dulu lalu barisnya
 *      "dilewati" — laporan penghapusan yang rapi di atas data yang hilang.
 *
 *   2. PELAPORANNYA. Baris yang dilewati wajib dibalas RPC DAN ditampilkan
 *      layar. Dilewati tanpa dilaporkan = pengunggahnya menyangka seluruh
 *      berkasnya masuk, dan kekurangannya baru terasa di akhir bulan.
 *
 *   3. DAFTAR PILIHANNYA. Dropdown outlet yang menawarkan pilihan yang pasti
 *      ditolak server membuat orangnya membaca penolakan atas daftar yang
 *      salah — dan menyangka dirinya yang salah.
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

const MIG = 'supabase/migrations/0189_impor_bengkel_admin_outlet.sql';
const SVC = 'js/modules/bengkel/penjualan-rinci.service.js';
const PAGE = 'js/modules/bengkel/penjualan-rinci.admin.page.js';
const TES = 'tools/test-migrasi-0189.mjs';

const mentah = baca(MIG);
const sql = mentah ? tanpaKomentarSql(mentah) : null;
const fungsi = (nama) => {
  if (!sql) return '';
  const i = sql.indexOf(`function ${nama}(`);
  if (i < 0) return '';
  const j = sql.indexOf('\n$$;', i);
  return sql.slice(i, j < 0 ? undefined : j);
};

if (!fs.existsSync(path.join(AKAR, TES))) salah(`${TES} tidak ada — aturannya tidak pernah dijalankan.`);

if (sql) {
  // ---- Helper wewenang ----
  const helper = fungsi('outlet_admin_saya');
  if (!helper) {
    salah(`${MIG}: \`outlet_admin_saya\` tidak ada.`);
  } else {
    // Satu orang bisa jadi admin outlet di dua BU. Tanpa saringan BU, ia dapat
    // wewenang di BU yang tidak ditanyakan.
    if (!/o\.business_unit_id = p_bu/.test(helper)) {
      salah(`${MIG}: \`outlet_admin_saya\` tidak menyaring BU — admin outlet di BU lain akan ikut dianggap berwenang di sini.`);
    }
    // Admin BU TIDAK boleh ikut: "larik kosong" harus berarti satu hal saja.
    if (!/ms\.role = 'outlet_admin'/.test(helper)) {
      salah(`${MIG}: \`outlet_admin_saya\` tidak terbatas pada peran \`outlet_admin\` — admin BU yang ikut masuk membuat "larik kosong" berarti dua hal berbeda.`);
    }
  }

  // ---- Impor penjualan ----
  const jual = fungsi('impor_penjualan_bengkel');
  if (!jual) {
    salah(`${MIG}: \`impor_penjualan_bengkel\` tidak ditulis ulang di sini.`);
  } else {
    if (!/Hanya Admin BU atau admin outlet di BU ini yang bisa mengimpor penjualan/.test(jual)) {
      salah(`${MIG}: penjagaan wewenang impor penjualan hilang — staff ikut bisa mengimpor.`);
    }
    // ============ URUTANNYA, BUKAN CUMA ADANYA ============
    const iJaga = jual.indexOf('not (v_outlet = any(v_saya))');
    const iHapus = jual.indexOf('delete from bengkel_sale_lines');
    const iUbah = jual.indexOf('update bengkel_sale_invoices');
    if (iJaga < 0) {
      salah(`${MIG}: batas outlet di impor penjualan hilang — satu berkas berisi beberapa cabang akan menimpa cabang lain, tanpa galat.`);
    } else if (iHapus > 0 && iJaga > iHapus) {
      salah(`${MIG}: batas outlet diperiksa SESUDAH \`delete from bengkel_sale_lines\` — barisnya terhapus lebih dulu lalu "dilewati": laporan yang rapi di atas data yang sudah hilang.`);
    } else if (iUbah > 0 && iJaga > iUbah) {
      salah(`${MIG}: batas outlet diperiksa SESUDAH invoicenya di-\`update\` — outletnya sudah berpindah sebelum penjagaannya jalan.`);
    }
    // Arah kedua: pemetaan store baru tidak boleh jadi jalan merebut invoice
    // cabang lain beserta omzetnya.
    if (!/v_outlet_lama is not null and not \(v_outlet_lama = any\(v_saya\)\)/.test(jual)) {
      salah(`${MIG}: invoice yang SUDAH milik outlet lain tidak diperiksa — memetakan store baru ke outlet sendiri jadi cara memindahkan invoice cabang lain beserta omzetnya.`);
    }
    if (!/'dilewati_outlet_lain', to_jsonb\(v_lewat_outlet\)/.test(jual)) {
      salah(`${MIG}: baris yang dilewati karena outlet lain tidak dilaporkan kembali — pengunggahnya menyangka seluruh berkasnya masuk.`);
    }
    // Nomor dokumen dicatat SETELAH semua penjagaan: nomor yang dilewati yang
    // ikut tercatat akan tersapu "tarik menyeluruh" nanti, padahal invoicenya
    // milik cabang lain dan tidak pernah ia sentuh.
    const iNomor = jual.indexOf('v_nomor := v_nomor || upper(v_no)');
    if (iNomor > 0 && iJaga > 0 && iNomor < iJaga) {
      salah(`${MIG}: nomor dokumen dicatat SEBELUM batas outlet diperiksa — nomor cabang lain ikut masuk riwayat, dan "tarik menyeluruh" akan menyapu invoice yang tidak pernah disentuh impor ini.`);
    }
    // `jenis = 'store'` — sejak 0186 nama yang sama boleh hidup di dua jenis,
    // dan `select into` mengambil baris pertama tanpa galat.
    if (!/jenis = 'store' and lower\(btrim\(store_name\)\) = lower\(v_store\)/.test(jual)) {
      salah(`${MIG}: pencarian store tidak menyaring \`jenis\` — nama store yang kebetulan sama dengan alamat kirim bisa terjawab baris yang salah, dan penjualannya masuk ke outlet yang salah tanpa tanda apa pun.`);
    }
  }

  // ---- Impor pembelian ----
  const beli = fungsi('impor_pembelian_bengkel');
  if (!beli) {
    salah(`${MIG}: \`impor_pembelian_bengkel\` tidak ditulis ulang di sini.`);
  } else {
    const iAlamat = beli.indexOf("b->>'kirim_ke'");
    const iJaga = beli.indexOf('not (v_outlet = any(v_saya))');
    const iHapus = beli.indexOf('delete from bengkel_purchase_lines');
    if (iJaga < 0) {
      salah(`${MIG}: batas outlet di impor pembelian hilang.`);
    } else {
      // INI perubahan terbesar 0189: di 0188 blok "hapus isi PO lama" jalan
      // sebelum alamatnya dibaca.
      if (iAlamat > 0 && iAlamat > iJaga) {
        salah(`${MIG}: alamat kirim dibaca SESUDAH penjagaannya — penjagaan tidak punya bahan untuk memutuskan.`);
      }
      if (iHapus > 0 && iJaga > iHapus) {
        salah(`${MIG}: batas outlet diperiksa SESUDAH \`delete from bengkel_purchase_lines\` — PO cabang lain dihapus lebih dulu lalu barisnya "dilewati".`);
      }
    }
    // PO yang ISINYA milik outlet lain: seluruh PO dilewati. Alamat kosong
    // bukan surat kuasa untuk menimpanya.
    if (!/v_po_ditolak/.test(beli)) {
      salah(`${MIG}: PO yang isinya milik outlet lain tidak ditolak — mengimpornya dengan alamat kosong akan menghapus isi PO cabang lain dan menggantinya sebagai pembelian pusat.`);
    }
    // Pembelian PUSAT tetap boleh: ia menambah, tidak menimpa. Diperketat
    // diam-diam, separuh pengeluaran berhenti bisa diimpor tanpa penjelasan.
    if (!/v_outlet is not null and not \(v_outlet = any\(v_saya\)\)/.test(beli)) {
      salah(`${MIG}: pembelian pusat tidak lagi dibedakan dari pembelian outlet lain — admin outlet akan ikut ditolak untuk baris yang sebenarnya boleh ia masukkan.`);
    }
    if (!/'dilewati_outlet_lain', v_lewat_outlet/.test(beli) || !/'alamat_outlet_lain', to_jsonb\(v_alamat_lain\)/.test(beli)) {
      salah(`${MIG}: baris pembelian yang dilewati tidak dilaporkan lengkap (jumlah DAN alamatnya) — satu angka tanpa alamatnya tidak bisa ditindaklanjuti.`);
    }
  }

  // ---- Pemetaan ----
  for (const [nama, pesanRebut] of [
    ['petakan_store_bengkel', 'Store ini sekarang terpetakan ke outlet lain'],
    ['petakan_tujuan_kirim', 'Alamat ini sekarang terpetakan ke outlet lain']
  ]) {
    const f = fungsi(nama);
    if (!f) {
      salah(`${MIG}: \`${nama}\` tidak ditulis ulang di sini — admin outlet akan mentok: store baru muncul, impornya dilewati, dan satu-satunya jalan adalah menunggu Admin BU.`);
      continue;
    }
    if (!/p_outlet = any\(v_saya\)/.test(f)) {
      salah(`${MIG}: \`${nama}\` tidak membatasi pilihan outlet — admin outlet bisa memetakan ke cabang lain, dan seluruh angka berkas itu ikut pindah.`);
    }
    if (!f.includes(pesanRebut)) {
      salah(`${MIG}: \`${nama}\` tidak menolak PEMINDAHAN pemetaan yang menunjuk outlet lain — itu cara memindahkan omzet cabang lain ke cabang sendiri tanpa menyentuh satu pun baris penjualan.`);
    }
  }

  // ---- Tarik & hapus ----
  const tarik = fungsi('tarik_impor_bengkel');
  if (!tarik) {
    salah(`${MIG}: \`tarik_impor_bengkel\` tidak ditulis ulang di sini.`);
  } else {
    if (!/r\.dibuat_by is distinct from v_uid/.test(tarik)) {
      salah(`${MIG}: admin outlet bisa menarik unggahan orang lain — "angkanya kok hilang" yang jawabannya "ditarik rekan sesama admin" adalah percakapan yang tidak punya ujung.`);
    }
    // `p_semua` menyapu berdasar NOMOR DOKUMEN lintas impor: jangkauannya
    // seluruh BU, bukan satu outlet.
    if (!/if p_semua then\s*\n\s*raise exception/.test(tarik)) {
      salah(`${MIG}: penarikan menyeluruh tidak dibatasi Admin BU — jangkauannya lintas outlet, dan admin satu cabang bisa menyapu dokumen cabang lain.`);
    }
    if (!/sumber = 'turboly'/.test(tarik)) {
      salah(`${MIG}: penarikan menyeluruh tidak lagi membatasi diri pada \`sumber = 'turboly'\` — invoice korporat yang diketik orang bisa ikut terhapus (0188).`);
    }
  }

  const hapus = fungsi('hapus_dokumen_impor_bengkel');
  if (!hapus) {
    salah(`${MIG}: \`hapus_dokumen_impor_bengkel\` tidak ditulis ulang di sini.`);
  } else {
    if (!/Invoice ini bukan milik outlet yang kamu pegang/.test(hapus)) {
      salah(`${MIG}: invoice outlet lain bisa dihapus satu-satu — batas yang dijaga ketat saat impor jadi tidak berarti.`);
    }
    if (!/PO ini memuat baris di luar outlet yang kamu pegang/.test(hapus)) {
      salah(`${MIG}: PO di luar outletnya bisa dihapus — dan menghapus sebagiannya akan meninggalkan PO setengah yang tidak terlihat salah di laporan mana pun.`);
    }
    // Pintu korporat tetap tertutup di sini (0187): ia punya pemeriksaan per
    // outlet sendiri.
    if (!/bukan hasil impor/.test(hapus)) {
      salah(`${MIG}: invoice korporat bisa lewat pintu ini — pemeriksaan per outlet di \`hapus_invoice_korporat\` jadi terlewati.`);
    }
  }
}

// =====================================================================
// LAYAR & LAYANAN
// =====================================================================
const page = bacaKode(PAGE, ['renderPenjualanRinciAdminPage', 'dialogPetakan']);
if (page) {
  // Dibalas RPC saja tidak cukup: kalau layarnya tidak menampilkannya,
  // pelaporan itu tidak pernah sampai ke orangnya.
  if (!/h\.dilewati_outlet_lain\?\.length/.test(page)) {
    salah(`${PAGE}: hasil impor penjualan tidak menyebut store yang dilewati karena outlet lain — ia akan menyangka seluruh berkasnya masuk.`);
  }
  // Dicari sebagai CABANG TERSENDIRI, bukan sekadar nama kuncinya: angka itu
  // juga muncul di baris catatan toast, jadi memeriksa namanya saja membuat
  // audit ini tetap hijau walau dialognya sudah dibuang.
  if (!/if \(Number\(h\.dilewati_outlet_lain\)\) \{/.test(page) || !/alamat_outlet_lain/.test(page)) {
    salah(`${PAGE}: hasil impor pembelian tidak menyebut baris yang dilewati karena outlet lain beserta ALAMATNYA — satu angka tanpa alamatnya tidak bisa ditindaklanjuti.`);
  }
  // Toast hilang dalam beberapa detik. Yang perlu DITINDAKLANJUTI harus
  // berhenti di depan orangnya.
  const iInfo = page.indexOf('Sebagian berkas tidak ikut diimpor');
  if (iInfo < 0) {
    salah(`${PAGE}: pelewatan karena outlet lain cuma lewat toast — pesan yang hilang sendiri dalam tiga detik bukan cara menyampaikan bahwa separuh berkasnya tidak masuk.`);
  }
  if (!/outletKewenanganku/.test(page)) {
    salah(`${PAGE}: dropdown outlet tidak dibatasi wewenang — orangnya memilih outlet yang pasti ditolak server, lalu membaca penolakan atas daftar yang salah.`);
  }
  // PENYARINGANNYA, bukan cuma nama variabelnya: variabel yang ada tapi tidak
  // pernah disaring adalah daftar lengkap dengan nama baru.
  if (!/!adminBu && punyaku\.size\) outletKewenanganku = outlets\.filter\(\(o\) => punyaku\.has\(o\.id\)\)/.test(page)) {
    salah(`${PAGE}: daftar outlet tidak pernah benar-benar disaring ke wewenang orangnya — variabelnya ada, isinya tetap seluruh outlet.`);
  }
  // Perannya tidak terbaca -> daftar dibiarkan UTUH. Daftar kosong akan
  // memblokir orang yang sebenarnya berwenang, dan server tetap penjaga
  // terakhirnya.
  if (!/let outletKewenanganku = outlets;/.test(page)) {
    salah(`${PAGE}: daftar outlet tidak punya nilai bawaan yang utuh — kalau peran gagal terbaca, dropdownnya kosong dan admin BU pun ikut terblokir.`);
  }
  if (/options: outlets\.map/.test(page)) {
    salah(`${PAGE}: masih ada dropdown outlet yang memakai seluruh daftar outlet.`);
  }
}

const svc = bacaKode(SVC, ['daftarStoreMap', 'daftarKirimMap']);
if (svc) {
  const i = svc.indexOf('export async function daftarStoreMap(');
  const f = i < 0 ? '' : svc.slice(i, svc.indexOf('\n}', i));
  if (!/\.eq\('jenis', 'store'\)/.test(f)) {
    salah(`${SVC}: \`daftarStoreMap\` tidak menyaring \`jenis\` — daftar "Pemetaan Store" akan memuat alamat kirim juga, dan yang membacanya menyangka storenya sudah dipetakan padahal belum.`);
  }
}

console.log('');
if (gagal === 0) console.log('Audit impor admin outlet bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
