/**
 * AUDIT: transfer kas dari kantong pilihan + revisinya (0176).
 *
 * ============ CARA FITUR INI RUSAK TANPA TERLIHAT RUSAK ============
 *
 * Transfer menyentuh saldo DUA orang, dan yang kedua tidak sedang menatap
 * layar. Semua cara ia rusak berakhir sebagai angka yang terlihat wajar:
 *
 *   tanda tangan lama dibiarkan   -> pemanggilan yang lupa mengirim kantong
 *                                    memilih jalur lama dan memotong Kas
 *                                    Utama, persis bug yang diperbaiki
 *   kantong tidak diperiksa       -> siapa pun bisa mengirim dari kantong
 *                                    orang lain dengan menebak id-nya
 *   `alasan_tolak_koreksi_kas`
 *     dilonggarkan                -> `ubah_kas` bisa menyentuh satu kaki
 *                                    transfer; uang hilang di satu sisi
 *                                    tanpa muncul di sisi lain
 *   saldo pengirim dihitung
 *     dengan kaki lamanya         -> revisi yang menaikkan sedikit pun
 *                                    ditolak dengan alasan yang salah
 *   akibat ke penerima lama
 *     tidak dikatakan             -> saldo orang lain jadi minus tanpa ada
 *                                    yang memberitahunya
 */
const fs = require('fs');
const path = require('path');

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

/** Komentar SQL dibuang: kepala berkas mengutip aturan & nama fungsi. */
const tanpaKomentarSql = (sql) =>
  sql
    .split('\n')
    .map((b) => (b.trim().startsWith('--') ? '' : b))
    .join('\n');

const MIG = 'supabase/migrations/0176_transfer_kantong_dan_revisi.sql';
const MURNI = 'js/modules/cash/revisi-transfer-kas.js';
const SVC = 'js/modules/cash/cash.service.js';
const PAGE = 'js/modules/cash/cash.page.js';
const TES = 'tools/test-revisi-transfer-kas.mjs';
const TES_PG = 'tools/test-migrasi-0176.mjs';

// =====================================================================
// 1. SQL
// =====================================================================
const mentah = baca(MIG);
const sql = mentah ? tanpaKomentarSql(mentah) : null;
if (sql) {
  // ============ OVERLOAD LAMA HARUS MATI ============
  //
  // PostgREST memilih fungsi lewat HIMPUNAN NAMA ARGUMEN. Dua tanda tangan
  // yang cuma beda satu argumen berarti pemanggilan yang lupa mengirimnya
  // tetap berhasil — lewat jalur lama, yang memotong Kas Utama.
  if (!/drop function if exists transfer_cash\(uuid, numeric, text\)/.test(sql)) {
    salah(`${MIG}: tanda tangan lama \`transfer_cash\` tidak dibuang — pemanggilan tanpa kantong akan diam-diam memotong Kas Utama.`);
  }
  if (!/p_from_account uuid default null/.test(sql)) {
    salah(`${MIG}: \`transfer_cash\` tidak menerima kantong asal.`);
  }
  // Kantongnya harus milik pengirim, bukan sekadar ada.
  if (!/where id = p_from_account and holder_id = v_uid and is_active/.test(sql)) {
    salah(`${MIG}: kantong asal tidak diperiksa kepemilikannya — siapa pun bisa mengirim dari kantong orang lain.`);
  }
  // Kaki penerima SELALU Kas Utama: kantong adalah urusan pemiliknya.
  if (!/values \(p_to_user, null, 'transfer_in'/.test(sql)) {
    salah(`${MIG}: kaki penerima tidak dipaksa ke Kas Utama — pengirim jadi menentukan isi kantong orang lain.`);
  }

  // Revisi
  if (!/create or replace function ubah_transfer_kas/.test(sql)) {
    salah(`${MIG}: \`ubah_transfer_kas\` tidak ada.`);
  }
  if (!/alasan_tolak_revisi_transfer\(p_entry\)/.test(sql)) {
    salah(`${MIG}: revisi tidak melewati penjaganya sendiri.`);
  }
  if (!/boleh_koreksi_kas\(v_out\.holder_id\)/.test(sql)) {
    salah(
      `${MIG}: wewenang revisi tidak diukur terhadap PENGIRIM. Diukur ke baris yang diklik, penerima ikut bisa merevisi — padahal uang itu bukan miliknya untuk dikembalikan.`
    );
  }
  // Kantong asal saat revisi harus milik pengirim, BUKAN milik yang merevisi:
  // admin BU yang membetulkan transfer orang lain tidak boleh memindahkannya
  // ke kantongnya sendiri.
  if (!/where id = p_from_account and holder_id = v_out\.holder_id and is_active/.test(sql)) {
    salah(`${MIG}: kantong asal saat revisi tidak diikat ke pengirim — admin bisa memindahkannya ke kantongnya sendiri.`);
  }
  // Kaki lama harus dikeluarkan dari hitungan saldo, kalau tidak revisi yang
  // menaikkan sedikit pun ditolak dengan alasan yang salah.
  if (!/and id <> v_out\.id/.test(sql)) {
    salah(`${MIG}: saldo pengirim dihitung termasuk kaki transfer yang sedang direvisi — uangnya terhitung keluar dua kali.`);
  }
  // ============ DUA KALI, BUKAN SEKALI ============
  //
  // Jejaknya ditulis pada KEDUA kaki. Memeriksa "ada di berkas ini" membuat
  // satu kaki bisa kehilangan jejaknya sementara auditnya tetap hijau — dan
  // kaki yang kehilangan jejak justru yang ada di riwayat orang LAIN, yang
  // paling butuh keterangan kenapa saldonya bergeser.
  for (const kolom of ['diubah_at = now()', 'diubah_by = v_uid', 'alasan_ubah = btrim(p_alasan)']) {
    const berapa = sql.split(kolom).length - 1;
    if (berapa < 2) {
      salah(`${MIG}: jejak revisi cuma di ${berapa} kaki — \`${kolom}\` harus diisi di kaki pengirim DAN penerima.`);
    }
  }
  if (!/saldo_penerima_lama/.test(sql)) {
    salah(`${MIG}: saldo penerima LAMA tidak dikembalikan — layar pengirim tidak punya cara tahu saldonya jadi minus.`);
  }
  if (!/alasan_tolak_revisi_transfer\(ce\.id\)/.test(sql)) {
    salah(`${MIG}: \`riwayat_kas_saya\` tidak membawa alasan tolaknya — layar tidak bisa memutuskan tombolnya.`);
  }
  if (!/ce\.dibayar_pusat\b/.test(sql)) {
    salah(`${MIG}: \`riwayat_kas_saya\` tidak membawa \`dibayar_pusat\` — kolom Saldo salah menyebut sebab "—" untuk entri Pusat.`);
  }
}

// ============ YANG TIDAK BOLEH IKUT DILONGGARKAN ============
//
// `alasan_tolak_koreksi_kas` adalah penjaga `ubah_kas`, dan `ubah_kas` hanya
// menyentuh SATU baris. Kalau ia berhenti menolak transfer, satu kaki bisa
// berubah sendirian — uang hilang di satu sisi tanpa muncul di sisi lain.
const semuaMigrasi = fs
  .readdirSync(path.join(AKAR, 'supabase/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort();
const terakhirPunyaPenjaga = semuaMigrasi
  .filter((f) => fs.readFileSync(path.join(AKAR, 'supabase/migrations', f), 'utf8').includes('function alasan_tolak_koreksi_kas'))
  .pop();
if (!terakhirPunyaPenjaga) {
  salah('`alasan_tolak_koreksi_kas` tidak ada di migration mana pun.');
} else {
  const isi = fs.readFileSync(path.join(AKAR, 'supabase/migrations', terakhirPunyaPenjaga), 'utf8');
  if (!/entry_type not in \('in', 'out'\)/.test(isi)) {
    salah(
      `${terakhirPunyaPenjaga}: \`alasan_tolak_koreksi_kas\` tidak lagi menolak transfer. ` +
        '`ubah_kas` cuma bisa menyentuh satu baris — satu kaki transfer bisa berubah sendirian.'
    );
  }
}

// =====================================================================
// 2. Modul murni
// =====================================================================
const murni = baca(MURNI);
if (murni) {
  // Server lama = tombol MATI, bukan hidup.
  if (!/alasan_tolak_transfer === undefined/.test(murni)) {
    salah(
      `${MURNI}: kolom yang belum ada dianggap "boleh". Kalau migrationnya belum dijalankan, dialognya terbuka lalu ditolak server dengan sebab yang tidak nyambung.`
    );
  }
  if (!/export function peringatanRevisi/.test(murni) || !/HILANG dari riwayat kas/.test(murni)) {
    salah(`${MURNI}: akibat ke penerima lama tidak dikatakan sebelum tombolnya ditekan.`);
  }
  if (!/export function pesanSesudahRevisi/.test(murni) || !/MINUS/.test(murni)) {
    salah(`${MURNI}: saldo minus penerima lama tidak dikabarkan sesudah revisi.`);
  }
  for (const t of [TES, TES_PG]) {
    if (!fs.existsSync(path.join(AKAR, t))) salah(`${t} tidak ada — aturan ini tidak dibuktikan di mana pun.`);
  }
}

// =====================================================================
// 3. Layanan & layar
// =====================================================================
const svc = baca(SVC);
if (svc) {
  const i = svc.indexOf('export async function transferCash');
  const blok = i >= 0 ? svc.slice(i, svc.indexOf('\n}', i)) : '';
  if (!/p_from_account/.test(blok)) salah(`${SVC}: \`transferCash\` tidak mengirim kantong asal.`);
  // `argumenRpc` memastikan kuncinya ikut walau nilainya null — tanpa itu
  // PostgREST mencari fungsi berargumen tiga yang sudah dibuang.
  if (!/argumenRpc\(/.test(blok)) {
    salah(`${SVC}: \`transferCash\` tidak memakai argumenRpc — kunci bernilai null akan hilang dan RPC-nya gagal 42883.`);
  }
  if (!/rpc\(\s*'ubah_transfer_kas'/.test(svc)) salah(`${SVC}: \`ubahTransferKas\` tidak memanggil RPC-nya.`);
}

const page = baca(PAGE);
if (page) {
  if (!/function opsiKantongAsal/.test(page)) salah(`${PAGE}: pilihan kantong asal tidak ada.`);
  // Saldonya harus ada DI LABEL pilihannya: keputusan "dari laci mana" diambil
  // sambil membaca daftarnya, bukan sesudah memilih.
  if (!/label\(NAMA_TANPA_KANTONG, null\)/.test(page) || !/formatRupiah\(saldoDari\(id\)\)/.test(page)) {
    salah(`${PAGE}: saldo kantong tidak ditulis di label pilihannya.`);
  }
  if (!/fromAccountId: values\.from_account/.test(page)) salah(`${PAGE}: kantong asal tidak ikut terkirim saat transfer.`);
  // Markupnya DAN pemasangan penangannya diperiksa terpisah: mencari nama
  // kelasnya saja membuat tombolnya bisa dicabut dari baris sementara baris
  // `querySelectorAll` yang menganggur tetap menghijaukan audit ini.
  if (!/class="btn-kas-revisi"/.test(page)) salah(`${PAGE}: tombol revisi transfer tidak digambar.`);
  if (!/querySelectorAll\('\.btn-kas-revisi'\)/.test(page)) {
    salah(`${PAGE}: tombol revisi transfer digambar tapi tidak pernah dipasangi penangan klik.`);
  }
  if (!/bukaRevisiTransfer/.test(page)) salah(`${PAGE}: dialog revisi transfer tidak ada.`);
  if (!/peringatanRevisi\(/.test(page)) salah(`${PAGE}: akibat ke penerima lama tidak ditampilkan sebelum simpan.`);
  if (!/pesanSesudahRevisi\(/.test(page)) salah(`${PAGE}: saldo minus penerima lama tidak dikabarkan sesudah simpan.`);
  // Alasan wajib di layar, bukan cuma di database: galat server untuk hal yang
  // bisa dicegat di form adalah dialog yang diisi dua kali.
  const iDlg = page.indexOf('async function bukaRevisiTransfer');
  const dlg = iDlg >= 0 ? page.slice(iDlg, page.indexOf('async function bukaUbahKas')) : '';
  if (!/name: 'alasan'[\s\S]{0,200}required: true/.test(dlg)) {
    salah(`${PAGE}: alasan revisi tidak diwajibkan di form.`);
  }
}

console.log('');
if (gagal === 0) console.log('Audit transfer kantong & revisinya bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
