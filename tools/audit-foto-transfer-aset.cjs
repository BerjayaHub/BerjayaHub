/**
 * AUDIT: foto aset yang ikut berpindah saat transfer antar BU (0179).
 *
 * ============ DUA SETENGAH PERBAIKAN YANG HARUS UTUH ============
 *
 * Fitur ini punya dua bagian yang saling bergantung, dan masing-masing
 * SENDIRIAN menghasilkan keadaan yang lebih buruk daripada tidak ada:
 *
 *   penunjuk tanpa izin baca  -> gambar yang SELALU gagal dimuat, yang di
 *                                layar terbaca persis seperti "barangnya
 *                                belum difoto"
 *   izin baca tanpa penunjuk  -> izin yang dibuka untuk sesuatu yang tidak
 *                                pernah ditunjuk siapa pun
 *
 * Dan satu bahaya ketiga yang khas migration ini: `kirim_transfer_aset` &
 * `ubah_transfer_aset` DITULIS ULANG UTUH hanya untuk menyisipkan satu baris.
 * Percobaan pertama kehilangan dua `insert into asset_log` di dalamnya —
 * riwayat aset berhenti menyebutkan transfer sama sekali, tanpa satu pun
 * galat.
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
  const pesan = periksaKewarasan(asli, kode, ['foto_asal_path', 'photo_acuan']);
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

const MIG = 'supabase/migrations/0179_foto_aset_ikut_transfer.sql';
const SVC = 'js/modules/asset/asset.service.js';
const ATURAN = 'js/modules/asset/aturan-aset-bu.js';
const PAGE = 'js/modules/asset/asset.page.js';
const TES = 'tools/test-migrasi-0179.mjs';

// =====================================================================
// 1. SQL
// =====================================================================
const mentah = baca(MIG);
const sql = mentah ? tanpaKomentarSql(mentah) : null;
if (sql) {
  // ============ KOLOM SENDIRI, BUKAN MENUMPANG `photo_path` ============
  //
  // `segarkan_foto_item_aset` (0171) MENGOSONGKAN `photo_path` kalau tidak ada
  // satu pun foto di stok BU-nya sendiri. Warisan yang menumpang kolom itu
  // terhapus sendiri pada perubahan foto berikutnya.
  if (!/add column if not exists foto_asal_path/.test(sql)) {
    salah(`${MIG}: \`foto_asal_path\` tidak dibuat — warisan tidak punya tempat sendiri.`);
  }
  if (/update asset_items[\s\S]{0,200}set photo_path = \(/.test(sql)) {
    salah(`${MIG}: warisan ditulis ke \`photo_path\` — trigger 0171 akan menghapusnya diam-diam.`);
  }

  if (!/create or replace function wariskan_foto_item_aset/.test(sql)) {
    salah(`${MIG}: \`wariskan_foto_item_aset\` tidak ada.`);
  }
  // Tidak menimpa: BU tujuan yang sudah punya fotonya sendiri tidak butuh
  // acuan, dan warisan yang menimpa warisan membuat barang yang sama berganti
  // rupa tiap ada transfer baru.
  if (!/btrim\(coalesce\(photo_path, ''\)\) <> '' or btrim\(coalesce\(foto_asal_path, ''\)\) <> ''/.test(sql)) {
    salah(`${MIG}: warisan menimpa foto yang sudah ada.`);
  }

  // KEDUA jalur transfer harus mewariskan. Kalau hanya `kirim`, transfer yang
  // DIREVISI kehilangan fotonya — justru saat orangnya sedang membetulkan.
  const berapa = sql.split('perform wariskan_foto_item_aset(v_item, v_item_tujuan);').length - 1;
  if (berapa < 2) {
    salah(`${MIG}: pewarisan cuma dipasang di ${berapa} jalur — harus di \`kirim_transfer_aset\` DAN \`ubah_transfer_aset\`.`);
  }

  // ============ IZIN BACANYA, SETENGAH SATUNYA ============
  if (!/create or replace function boleh_lihat_foto_warisan/.test(sql)) {
    salah(`${MIG}: tidak ada fungsi izin baca untuk foto warisan.`);
  }
  if (!/or boleh_lihat_foto_warisan\(name\)/.test(sql)) {
    salah(
      `${MIG}: policy \`asset_photo_select\` tidak membuka foto warisan. ` +
        'Penunjuknya benar tapi gambarnya selalu gagal dimuat — di layar itu terbaca "belum difoto".'
    );
  }
  // Jalur lama tidak boleh ikut hilang saat policy-nya ditulis ulang.
  if (!/has_bu_scope\(auth\.uid\(\), asset_photo_bu\(name\)\)/.test(sql)) {
    salah(`${MIG}: jalur izin lama (prefix path) hilang dari policy — BU pemilik berkasnya sendiri jadi ditolak.`);
  }
  // Izinnya harus terikat pada BERKAS yang memang ditunjuk; kalau tidak, satu
  // warisan membuka seluruh folder outlet asal.
  if (!/i\.foto_asal_path = p_name/.test(sql)) {
    salah(`${MIG}: izin baca tidak diikat ke berkas yang ditunjuk — satu warisan akan membuka berkas lain di folder yang sama.`);
  }

  if (!/wariskan_foto_item_aset\(r\.asal, r\.tujuan\)/.test(sql)) {
    salah(`${MIG}: tidak ada backfill — transfer yang sudah terlanjur tetap tanpa foto.`);
  }

  // ============ FUNGSI YANG DITULIS ULANG HARUS UTUH ============
  //
  // Dibandingkan dengan aslinya: yang boleh beda hanya baris pewarisannya.
  for (const [nama, asal] of [
    ['kirim_transfer_aset', 'supabase/migrations/0173_transfer_aset.sql'],
    ['ubah_transfer_aset', 'supabase/migrations/0174_revisi_transfer_aset.sql']
  ]) {
    const lama = baca(asal);
    if (!lama) continue;
    const potong = (teks) => {
      const i = teks.indexOf(`create or replace function ${nama}(`);
      return i < 0 ? null : teks.slice(i, teks.indexOf('\n$$;', i));
    };
    const a = potong(lama);
    const b = potong(mentah);
    if (!a || !b) {
      salah(`${MIG}: \`${nama}\` tidak ditemukan di salah satu berkas.`);
      continue;
    }
    const barisA = a.split('\n').filter((x) => x.trim() && !x.trim().startsWith('--'));
    const barisB = b.split('\n').filter((x) => x.trim() && !x.trim().startsWith('--'));
    const hilang = barisA.filter((x) => !barisB.includes(x));
    if (hilang.length) {
      salah(
        `${MIG}: penulisan ulang \`${nama}\` KEHILANGAN ${hilang.length} baris dari aslinya — ` +
          `mis. ${hilang[0].trim().slice(0, 70)}`
      );
    }
  }

  if (!fs.existsSync(path.join(AKAR, TES))) salah(`${TES} tidak ada — aturannya tidak pernah dijalankan.`);
}

// =====================================================================
// 2. Klien
// =====================================================================
const svc = bacaKode(SVC);
if (svc && !/foto_asal_path, foto_asal_outlet_id/.test(svc)) {
  salah(`${SVC}: kolom warisan tidak ikut diambil — item hasil transfer tampil tanpa foto.`);
}

const aturan = bacaKode(ATURAN);
if (aturan) {
  // Urutannya: foto sendiri > foto se-BU > warisan. Warisan yang didahulukan
  // membuat foto outlet sendiri tertutup oleh foto BU lain.
  if (!/i\?\.photo_path \?\? i\?\.foto_asal_path/.test(aturan)) {
    salah(`${ATURAN}: warisan tidak dipakai sebagai lapis TERAKHIR foto acuan.`);
  }
  if (!/photo_acuan_warisan/.test(aturan)) {
    salah(`${ATURAN}: asal foto tidak dibedakan — layar tidak bisa menyebutnya dengan jujur.`);
  }
}

const page = bacaKode(PAGE);
if (page) {
  // DIHITUNG: asalnya disebut di DUA tempat — keterangan saat disentuh
  // (`title`) dan penanda kecil di bawah gambarnya. Memeriksa satu saja
  // membuat yang lain bisa diratakan jadi "Foto acuan" sementara auditnya
  // tetap hijau; sabotasenya yang menunjukkan itu.
  const berapa = (page.match(/photo_acuan_warisan/g) ?? []).length;
  if (berapa < 2) {
    salah(
      `${PAGE}: asal foto warisan cuma dibedakan di ${berapa} tempat (butuh 2: keterangan & penanda). ` +
        'Keduanya bukan foto barang di sini, tapi yang dari BU lain dipotret di gudang yang bahkan beda BU.'
    );
  }
  if (!/foto dari BU asal/.test(page)) salah(`${PAGE}: penanda "foto dari BU asal" tidak ada.`);
  if (!/dari BU asal saat aset ini ditransfer/.test(page)) {
    salah(`${PAGE}: keterangan saat foto disentuh tidak menyebut bahwa fotonya bawaan dari BU asal.`);
  }
}

console.log('');
if (gagal === 0) console.log('Audit foto transfer aset bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
