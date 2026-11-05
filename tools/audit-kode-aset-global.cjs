/**
 * AUDIT: satu kode untuk satu barang, di seluruh BU (0180).
 *
 * ============ CARA PERBAIKAN INI RUSAK TANPA TERLIHAT RUSAK ============
 *
 *   triggernya hilang / jalur       -> kode kembali dibuat per BU. Tidak ada
 *   pembuatan item baru yang           galat, tidak ada yang kosong: dua
 *   melewatinya                        barang berbeda kembali berbagi satu
 *                                      kode, dan ketahuannya berbulan-bulan
 *                                      kemudian lewat surat jalan
 *
 *   nomor baru dihitung per BU       -> bentroknya kembali, kali ini pada
 *   lagi                                barang yang tidak pernah ditransfer
 *                                       siapa pun — tidak ada peristiwa yang
 *                                       bisa disalahkan
 *
 *   penyelarasan menimpa kode        -> kode di catatan owner berubah tanpa
 *   yang lebih dulu ada                 dicatat di mana pun. Ini kerusakan
 *                                       yang TIDAK BISA dibatalkan: yang
 *                                       menimpanya tidak menyimpan apa pun
 *                                       tentang keadaan sebelumnya
 *
 *   `kode_lama` tidak dibawa ke      -> kode berubah dan tidak ada satu pun
 *   layar / tidak ikut dicari           tempat di aplikasi yang menyebutkan
 *                                       kode lamanya. Yang memegang catatan
 *                                       lama membaca "barangnya sudah tidak
 *                                       ada"
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

const bacaKode = (rel) => {
  const asli = baca(rel);
  if (!asli) return null;
  const kode = tanpaKomentar(asli);
  const pesan = periksaKewarasan(asli, kode, ['kode_lama', 'kode']);
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

const MIG = 'supabase/migrations/0180_kode_aset_global.sql';
const SVC = 'js/modules/asset/asset.service.js';
const ATURAN = 'js/modules/asset/aturan-aset-bu.js';
const PAGE = 'js/modules/asset/asset.page.js';
const TES = 'tools/test-migrasi-0180.mjs';

// =====================================================================
// 1. SQL
// =====================================================================
const mentah = baca(MIG);
const sql = mentah ? tanpaKomentarSql(mentah) : null;
if (sql) {
  // ============ SATU PINTU UNTUK SEMUA JALUR ============
  //
  // Ada EMPAT fungsi yang membuat `asset_items`, dan jalur kelima akan
  // ditambahkan suatu hari. Trigger di tabelnya menutup semuanya sekaligus;
  // menambal fungsinya satu per satu tidak.
  if (!/create trigger trg_kode_global_item_aset\s+before insert on asset_items/.test(sql)) {
    salah(
      `${MIG}: tidak ada trigger \`before insert\` di \`asset_items\`. ` +
        'Jalur pembuatan item yang tidak ditambal akan kembali membuat kode per BU — tanpa galat.'
    );
  }
  if (!/create trigger trg_kode_global_ganti_nama_aset/.test(sql)) {
    salah(`${MIG}: ganti nama item tidak membawa kodenya — BU lain akan membuatkan kode baru untuk barang yang sama.`);
  }

  // ============ NOMOR BARU HARUS BEBAS DI SELURUH BU ============
  //
  // `kode_aset_berikutnya` (0168) menghitung per BU. Kalau pembuat kode yang
  // baru ikut per BU, bentroknya kembali — kali ini pada barang yang tidak
  // pernah ditransfer siapa pun.
  const fn = sql.indexOf('create or replace function kode_global_berikutnya');
  const badanFn = fn < 0 ? '' : sql.slice(fn, sql.indexOf('\n$$;', fn));
  if (!badanFn) {
    salah(`${MIG}: \`kode_global_berikutnya\` tidak ada.`);
  } else {
    if (/business_unit_id\s*=/.test(badanFn)) {
      salah(`${MIG}: nomor berikutnya masih disaring per BU — itu persis cara bentroknya lahir.`);
    }
    // Dihitung dari DUA tempat. Daftar pusat sendirian melewatkan item lama
    // yang belum terdaftar; item sendirian memakai ulang kode yang sudah
    // terlanjur ada di catatan untuk barang yang itemnya kebetulan dihapus.
    if (!/from asset_items/.test(badanFn) || !/from asset_kode_global/.test(badanFn)) {
      salah(`${MIG}: nomor berikutnya tidak dihitung dari \`asset_items\` DAN \`asset_kode_global\` sekaligus.`);
    }
    if (!/for update/.test(badanFn)) {
      salah(`${MIG}: baris prefixnya tidak dikunci — dua orang yang menambah item bersamaan bisa mendapat nomor yang sama.`);
    }
  }

  // ============ SATU KODE = SATU BARANG ============
  if (!/create unique index[\s\S]{0,120}asset_kode_global\(upper\(btrim\(kode\)\)\) where utama/.test(sql)) {
    salah(
      `${MIG}: daftar pusatnya tidak menjamin satu kode = satu barang. ` +
        'Tanpa itu, keadaan yang migration ini hapus cuma berpindah ke tabel yang terdengar berwibawa.'
    );
  }

  // ============ YANG DULUAN ADA YANG MENANG ============
  //
  // "kode kode sudah masuk catatan owner" — jadi pemilik kode adalah item yang
  // paling dulu dibuat, bukan yang paling banyak, bukan pula yang kebetulan
  // terbaca duluan.
  if (!/order by kunci_item_aset\(i\.name, i\.category\), i\.created_at, i\.id/.test(sql)) {
    salah(`${MIG}: pemilik kode tidak ditentukan oleh "siapa yang duluan mendata" (\`created_at\`, lalu \`id\`).`);
  }

  // Penyelarasan lewat kode sementara. Tanpa itu, separuh barisnya ditolak
  // indeks unik dan BU-nya berhenti setengah jalan — sebagian berkode baru,
  // sebagian lama, tanpa satu pun catatan tentang yang mana.
  if (!/set kode_lama = coalesce\(i\.kode_lama, i\.kode\)/.test(sql)) {
    salah(`${MIG}: kode lama tidak disimpan sebelum ditimpa — perubahannya tidak bisa ditelusuri lagi.`);
  }
  if (!/kode = '~'/.test(sql) || !/kode like '~%'/.test(sql)) {
    salah(`${MIG}: penyelarasan tidak lewat kode sementara — sebagian baris akan ditolak indeks unik di tengah jalan.`);
  }
  if (!/insert into asset_kode_perubahan/.test(sql)) {
    salah(`${MIG}: perubahan kode tidak dilaporkan ke mana pun.`);
  }

  // ============ DIJALANKAN DUA KALI HARUS AMAN ============
  //
  // iko memasang migration dengan menempelkannya ke SQL editor, dan
  // pertanyaan "perlu di-run ulang?" muncul tiap kali ada perubahan.
  if (!/if exists \(select 1 from asset_kode_global\) then/.test(sql)) {
    salah(`${MIG}: penyelarasannya tidak punya penjaga "sudah pernah jalan" — dijalankan dua kali bisa menomori ulang lagi.`);
  }

  // `tambah_item_aset` harus mengembalikan kode yang BENAR-BENAR tersimpan.
  // Sejak ada trigger, kode yang dihitung sebelum insert bukan lagi kode yang
  // tersimpan — dan kode yang salah di layar adalah kode yang terlanjur
  // ditulis orang di bukunya.
  if (!/returning id, kode into v_id, v_kode/.test(sql)) {
    salah(`${MIG}: \`tambah_item_aset\` tidak membaca balik kode hasil trigger — layar bisa menyebut kode yang tidak tersimpan.`);
  }

  if (!fs.existsSync(path.join(AKAR, TES))) salah(`${TES} tidak ada — aturannya tidak pernah dijalankan.`);
}

// =====================================================================
// 2. Klien: kode lama harus terbaca, bukan cuma tersimpan
// =====================================================================
const svc = bacaKode(SVC);
if (svc) {
  if (!/kode, kode_lama, name/.test(svc)) {
    salah(`${SVC}: \`kode_lama\` tidak ikut diambil — layar tidak punya apa pun untuk ditampilkan.`);
  }
  // Pencarian kode harus ikut menengok kode lama: yang memegang catatan lama
  // mencari kode LAMA, dan pencarian yang tidak menemukannya terbaca sebagai
  // "barangnya sudah tidak ada".
  if (!/kode\.ilike\.%\$\{aman\}%,kode_lama\.ilike\.%\$\{aman\}%/.test(svc)) {
    salah(`${SVC}: kotak "Cari kode" tidak mencari kode lama.`);
  }
}

const aturan = bacaKode(ATURAN);
if (aturan) {
  if (!/kode_lama:/.test(aturan)) {
    salah(`${ATURAN}: \`kode_lama\` tidak diteruskan ke baris daftar.`);
  }
  // Disaring kalau sama: "dulu K004" di sebelah "K004" membuat orang mengira
  // ada yang berubah padahal tidak.
  if (!/teks\(i\?\.kode_lama\)\.trim\(\) !== teks\(i\?\.kode\)\.trim\(\)/.test(aturan)) {
    salah(`${ATURAN}: kode lama yang SAMA dengan kode sekarang tidak disaring.`);
  }
}

const page = bacaKode(PAGE);
if (page && !/dulu \$\{esc\(a\.kode_lama\)\}/.test(page)) {
  salah(`${PAGE}: kode lama tidak ditulis di kolom Kode — perubahannya tersimpan tapi tidak pernah terbaca siapa pun.`);
}

console.log('');
if (gagal === 0) console.log('Audit kode aset global bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
