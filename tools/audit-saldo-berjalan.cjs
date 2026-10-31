/**
 * AUDIT: kolom Saldo di riwayat kas.
 *
 * ============ CARA KOLOM INI RUSAK TANPA TERLIHAT RUSAK ============
 *
 * Isinya angka rupiah yang dipakai mencocokkan catatan dengan uang fisik di
 * laci. Seluruh cara ia rusak menghasilkan angka yang terlihat masuk akal:
 *
 *   dijumlahkan di layar        -> berubah mengikuti saringan; "jumlah baris
 *                                  yang kebetulan tampil" tidak bisa
 *                                  dibedakan dari saldo
 *   aturannya menyimpang dari
 *     `cash_account_balances`   -> baris terbaru menampilkan angka LAIN
 *                                  daripada saldo di kepala halaman yang sama
 *   partisi memakai `=`         -> seluruh entri Kas Utama (account_id NULL)
 *                                  kehilangan saldonya, tanpa galat
 *   "tidak diketahui" jadi 0    -> dibaca "kantongnya kosong", lalu orang
 *                                  mencari uang yang tidak hilang
 *   dua salinan sel             -> saldo yang sama ditulis berbeda di Staff
 *                                  App dan Admin Portal
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

const MIG = 'supabase/migrations/0175_saldo_berjalan_kas.sql';
const MURNI = 'js/modules/cash/saldo-berjalan.js';
const SVC = 'js/modules/cash/cash.service.js';
const STAFF = 'js/modules/cash/cash.page.js';
const ADMIN = 'js/modules/cash/cash.admin.page.js';
const TES = 'tools/test-saldo-berjalan.mjs';
const TES_PG = 'tools/test-migrasi-0175.mjs';

// =====================================================================
// 1. SQL — aturannya harus sama persis dengan view saldo kantong
// =====================================================================
const sqlMentah = baca(MIG);
// ============ KOMENTARNYA DIBUANG DULU ============
//
// Kepala berkas 0175 MENGUTIP aturan view saldo kantong apa adanya
// ("sum(amount) where dicoret_at is null and not dibayar_pusat"). Memeriksa
// berkas mentah berarti kutipan di komentar itu ikut menghijaukan audit —
// aturannya bisa dicabut dari SQL-nya dan auditnya tetap diam. Sabotasenya
// yang menunjukkan itu.
const sql = sqlMentah
  ? sqlMentah
      .split('\n')
      .map((b) => (b.trim().startsWith('--') ? '' : b))
      .join('\n')
  : null;
if (sql) {
  // ============ KETIGANYA, BUKAN DUA DARI TIGA ============
  //
  // `cash_account_balances` (0153): sum(amount) where dicoret_at is null and
  // not dibayar_pusat, group by holder_id, account_id. Satu saja yang
  // menyimpang membuat baris terbaru berselisih dengan saldo di kepala
  // halaman — dua angka untuk hal yang sama, di satu layar.
  if (!/where ce\.dicoret_at is null/.test(sql)) {
    salah(`${MIG}: entri yang dicoret ikut dijumlahkan — saldonya akan berbeda dari saldo kantong di kepala halaman.`);
  }
  if (!/not ce\.dibayar_pusat/.test(sql)) {
    salah(`${MIG}: entri "Dibayar Pusat" ikut dijumlahkan, padahal uangnya tidak keluar dari kantong mana pun.`);
  }
  if (!/partition by ce\.holder_id, ce\.account_id/.test(sql)) {
    salah(`${MIG}: jendelanya tidak dipartisi per kantong — saldo beberapa kantong akan tercampur jadi satu deret.`);
  }

  // `=` tidak pernah cocok untuk NULL, dan Kas Utama BERKANTONG NULL.
  if (!/k\.account_id is not distinct from ce\.account_id/.test(sql)) {
    salah(
      `${MIG}: kantong dicocokkan dengan \`=\`, bukan \`is not distinct from\`. ` +
        'Seluruh entri Kas Utama (account_id NULL) akan kehilangan saldonya tanpa satu pun galat.'
    );
  }

  if (!/order by ce\.entry_date, ce\.created_at, ce\.id/.test(sql)) {
    salah(`${MIG}: urutan jendelanya bukan tanggal entri — entri yang diketik mundur akan menumpuk di akhir deret.`);
  }
  if (!/boleh_lihat_saldo_kas\(ce\.holder_id\)/.test(sql)) {
    salah(
      `${MIG}: wewenangnya tidak diperiksa. Saldo yang dihitung dari riwayat yang hanya terbaca separuh adalah angka yang salah, bukan angka yang terbatas.`
    );
  }
  if (!/create index if not exists idx_cash_entries_saldo_berjalan/.test(sql)) {
    salah(`${MIG}: tidak ada indeks untuk jendelanya — tiap pembukaan riwayat kas memindai seluruh tabel.`);
  }
}

// =====================================================================
// 2. Modul murni — "tidak diketahui" tidak boleh jadi nol
// =====================================================================
const murni = baca(MURNI);
if (murni) {
  if (!/v === null \|\| v === undefined \|\| v === ''/.test(murni)) {
    salah(
      `${MURNI}: nilai kosong tidak ditolak sebelum \`Number()\`. ` +
        '`Number(null)` adalah 0 dan 0 itu berhingga, jadi saldo yang TIDAK ADA akan tampil "Rp 0" — dibaca "kantongnya kosong".'
    );
  }
  if (!/dicoret_at/.test(murni) || !/dibayar_pusat/.test(murni)) {
    salah(`${MURNI}: entri dicoret / Dibayar Pusat tidak dibedakan dari "angkanya tidak diketahui".`);
  }
  // Urutan pemeriksaannya menentukan kalimat yang dibaca orang.
  const iCoret = murni.indexOf('entri?.dicoret_at');
  const iPeta = murni.indexOf('peta instanceof Map');
  if (iCoret < 0 || iPeta < 0 || iCoret > iPeta) {
    salah(`${MURNI}: dicoret tidak diperiksa sebelum "tidak diketahui" — entri yang dicoret akan diberi keterangan yang salah.`);
  }
  if (!fs.existsSync(path.join(AKAR, TES))) salah(`${TES} tidak ada — aturan tiga keadaan itu tidak dibuktikan di mana pun.`);
  if (!fs.existsSync(path.join(AKAR, TES_PG))) {
    salah(`${TES_PG} tidak ada — kecocokan dengan \`cash_account_balances\` tidak pernah dijalankan.`);
  }
}

// =====================================================================
// 3. Layanan — kegagalan tidak boleh mematikan riwayat
// =====================================================================
const svc = baca(SVC);
if (svc) {
  const i = svc.indexOf('export async function saldoBerjalanKas');
  const blok = i >= 0 ? svc.slice(i, svc.indexOf('\n}', i)) : '';
  if (!blok) salah(`${SVC}: \`saldoBerjalanKas\` tidak ada.`);
  else {
    if (!/rpc\('saldo_berjalan_kas'/.test(blok)) salah(`${SVC}: RPC-nya tidak dipanggil.`);
    // Riwayat kas yang hilang seluruhnya karena satu query pelengkap gagal
    // jauh lebih buruk daripada satu kolom berisi "—".
    if (!/console\.warn/.test(blok) || /throw error/.test(blok)) {
      salah(`${SVC}: kegagalan saldo dilempar — satu query pelengkap yang gagal akan mengosongkan SELURUH riwayat kas.`);
    }
  }
}

// =====================================================================
// 4. Kedua layar memakai SEL YANG SAMA
// =====================================================================
const staff = baca(STAFF);
const admin = baca(ADMIN);
if (staff) {
  if (!/export function selSaldoHtml/.test(staff)) salah(`${STAFF}: \`selSaldoHtml\` tidak ada.`);
  // Dicari BERPASANGAN dengan kolom Jumlah, bukan sendirian: kata
  // "<th>Saldo</th>" juga muncul di tabel LAIN di layar yang sama (ringkasan
  // saldo pemegang, daftar kantong). Mencarinya sendirian membuat audit ini
  // tetap hijau walau kolomnya dicabut dari tabel riwayat — sabotasenya yang
  // menunjukkan itu.
  if (!/<th>Jumlah<\/th><th>Saldo<\/th>/.test(staff)) {
    salah(`${STAFF}: kolom Saldo tidak ada di kepala tabel riwayat.`);
  }
  if (!/selSaldoHtml\(e, saldo\)/.test(staff)) salah(`${STAFF}: kolom Saldo tidak digambar di barisnya.`);
  if (!/saldoBerjalanKas\(/.test(staff)) salah(`${STAFF}: saldonya tidak pernah diambil.`);
}
if (admin) {
  if (!/<th>Jumlah<\/th><th>Saldo<\/th>/.test(admin)) {
    salah(`${ADMIN}: kolom Saldo tidak ada di kepala tabel mutasi.`);
  }
  if (!/selSaldoHtml\(r, saldo\)/.test(admin)) salah(`${ADMIN}: kolom Saldo tidak digambar di barisnya.`);
  // Dua salinan sel berarti "kenapa saldonya beda di admin" — pertanyaan yang
  // tidak bisa dijawab tanpa membandingkan dua berkas.
  if (!/import \{ selSaldoHtml \} from '\.\/cash\.page\.js'/.test(admin)) {
    salah(`${ADMIN}: sel saldonya tidak diambil dari Staff App — dua salinan akan menyimpang.`);
  }
  // Kolom bertambah satu; colspan "tidak ada data" ikut, atau barisnya pendek
  // sendiri dan tabelnya terlihat rusak.
  if (/colspan="11"/.test(admin)) {
    salah(`${ADMIN}: colspan baris kosong belum ikut bertambah sesudah kolom Saldo ditambahkan.`);
  }
}

console.log('');
if (gagal === 0) console.log('Audit saldo berjalan bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
