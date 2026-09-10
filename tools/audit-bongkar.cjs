/**
 * AUDIT: bongkar bahan setengah jadi (0134).
 *
 * ============ SATU HAL YANG MEMBUAT FITUR INI BERBAHAYA ============
 *
 * Bongkar MENAMBAH stok. Tanpa batas atas, ia adalah alat mencetak stok dari
 * udara: ketik 5 pack keluar, 500 kg udang masuk. Stok yang dicetak begitu
 * terlihat persis seperti stok yang sungguhan — tidak ada laporan yang bisa
 * membedakannya, dan yang menemukannya adalah orang yang menghitung fisik di
 * gudang berminggu-minggu kemudian.
 *
 * Yang dijaga:
 *
 *   1. BATAS ATAS per bahan = porsi resepnya, ditegakkan SERVER (bukan cuma
 *      layar), dan dihitung dengan rumus yang sama di kedua sisi.
 *   2. Bahan yang kembali TIDAK membawa `unit_cost` — kalau membawanya, ongkos
 *      olahan pack merembes ke rata-rata biaya bahan baku (0118/0123).
 *   3. Resep WAJIB ada. Tanpa itu bongkar jadi alat mengubah stok apa pun
 *      jadi stok apa pun.
 *   4. Ini kejadian BARU, bukan penghapusan produksi — dan pembatalannya lewat
 *      pergerakan penyeimbang, bukan penghapusan pergerakan lama.
 *   5. Layarnya ada, tersambung, dan menyebut batasnya di depan mata.
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
// Migration
// ---------------------------------------------------------------
const mig = baca('supabase/migrations/0134_bongkar_bahan.sql');
if (mig) {
  for (const fn of ['bongkar_bahan', 'batalkan_bongkar', 'porsi_bongkar']) {
    if (!new RegExp(`create or replace function ${fn}\\(`).test(mig)) salah(`0134: fungsi \`${fn}\` tidak ada.`);
  }
  for (const g of [
    'bongkar_bahan(uuid, uuid, numeric, jsonb, text)',
    'batalkan_bongkar(uuid, text)',
    'porsi_bongkar(uuid, numeric)'
  ]) {
    if (!mig.includes(`grant execute on function ${g} to authenticated`)) {
      salah(`0134: \`${g}\` tidak diberikan ke authenticated — layarnya akan dapat 42883.`);
    }
  }
  for (const t of ['bongkar_runs', 'bongkar_items']) {
    if (!new RegExp(`create table if not exists ${t} \\(`).test(mig)) salah(`0134: tabel \`${t}\` tidak dibuat.`);
    if (!new RegExp(`alter table ${t} enable row level security`).test(mig)) salah(`0134: RLS \`${t}\` tidak dinyalakan.`);
  }

  const blok = mig.slice(mig.indexOf('function bongkar_bahan('), mig.indexOf('revoke all on function bongkar_bahan'));

  // 1. BATAS ATAS — inti seluruh berkas ini.
  if (!/v_qty > v_maks \+ 1e-9/.test(blok)) {
    salah(
      '0134 `bongkar_bahan`: batas atas per bahan tidak ditegakkan. ' +
        'Tanpa itu bongkar adalah alat mencetak stok dari udara — dan stok yang dicetak terlihat persis seperti stok yang sungguhan.'
    );
  }
  if (!/porsi_bongkar\(p_product, p_qty\)/.test(blok)) {
    salah('0134 `bongkar_bahan`: porsinya tidak dihitung dari `porsi_bongkar` — dua rumus untuk satu angka cepat atau lambat menyimpang.');
  }
  // Bahan di luar resep ditolak.
  if (!/if v_maks is null then/.test(blok)) {
    salah('0134 `bongkar_bahan`: bahan di luar resep tidak ditolak — bongkar jadi alat mengubah stok apa pun jadi stok apa pun.');
  }

  // 2. TANPA unit_cost.
  const barisMasuk = /insert into stock_movements \(business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by\)\s*\n\s*values \(v_bu, p_outlet, v_pid, 'bongkar_in'/.test(blok);
  if (!barisMasuk) {
    salah(
      '0134 `bongkar_bahan`: pemasukan hasil bongkar membawa kolom selain yang seharusnya. ' +
        'Bahan yang kembali TIDAK boleh ber-`unit_cost` — ongkos olahan pack akan merembes ke rata-rata biaya bahan baku (0118).'
    );
  }
  if (/'bongkar_in'[^;]*unit_cost/.test(mig)) {
    salah('0134: pemasukan `bongkar_in` menyertakan `unit_cost`. Lihat 0118/0123 — hanya pembelian yang boleh mengisinya.');
  }

  // 3. Resep wajib.
  if (!/if not exists \(select 1 from recipes where product_id = p_product and yield_qty > 0\)/.test(blok)) {
    salah('0134 `bongkar_bahan`: tidak menuntut resep. Resep adalah satu-satunya yang menyatakan "di dalam pack ini ada apa".');
  }
  // Tanpa bahan kembali -> diarahkan ke Waste, bukan diterima diam-diam.
  if (!/Waste/.test(blok)) {
    salah('0134 `bongkar_bahan`: bongkar tanpa bahan kembali tidak diarahkan ke Waste — itu tindakan berbeda dengan laporan yang berbeda.');
  }
  if (!/has_outlet_scope\(v_uid, p_outlet\)/.test(blok)) {
    salah('0134 `bongkar_bahan`: wewenang outlet tidak diperiksa.');
  }

  // 4. Bukan penghapusan produksi; pembatalan lewat penyeimbang.
  if (/delete from stock_movements/.test(mig)) {
    salah('0134: menghapus baris `stock_movements`. Pergerakan stok adalah catatan sejarah — pembatalan lewat pergerakan penyeimbang (0084).');
  }
  if (/production_runs/.test(mig)) {
    salah(
      '0134: menyentuh `production_runs`. Bongkar adalah kejadian BARU — packnya bisa datang dari kiriman CK dan tidak punya catatan produksi sama sekali.'
    );
  }
  const blokBatal = mig.slice(mig.indexOf('function batalkan_bongkar('), mig.indexOf('revoke all on function batalkan_bongkar'));
  if (!/coalesce\(btrim\(p_alasan\), ''\) = ''/.test(blokBatal)) {
    salah('0134 `batalkan_bongkar`: alasan tidak diwajibkan.');
  }
  if (!/has_outlet_scope\(v_uid, v_b\.outlet_id\)/.test(blokBatal)) {
    salah('0134 `batalkan_bongkar`: wewenang outlet tidak diperiksa.');
  }
  if (!/dibatalkan_at is not null then/.test(blokBatal)) {
    salah('0134 `batalkan_bongkar`: bisa dibatalkan dua kali — stoknya akan dikembalikan dua kali juga.');
  }

  // Jenis pergerakan baru harus dikenal batasannya.
  if (!/'bongkar_out', 'bongkar_in'/.test(mig)) {
    salah('0134: jenis pergerakan `bongkar_out`/`bongkar_in` tidak ditambahkan ke batasan `movement_type`.');
  }
}

// ---------------------------------------------------------------
// Modul murni
// ---------------------------------------------------------------
const murni = baca('js/modules/inventory/bongkar.js');
if (murni) {
  const kode = tanpaKomentar(murni);
  for (const fn of ['porsiBongkar', 'periksaBongkar', 'periksaStok', 'pesanStok']) {
    if (!new RegExp(`export function ${fn}\\(`).test(kode)) salah(`bongkar.js: \`${fn}\` tidak diekspor.`);
  }
  // Rumusnya harus sama dengan server.
  if (!/const faktor = n \/ yieldQty;/.test(kode)) {
    salah('bongkar.js: faktor tidak dihitung `jumlah / yield` — rumusnya harus sama persis dengan `porsi_bongkar` di server.');
  }
  if (!/if \(!yieldQty \|\| yieldQty <= 0/.test(kode)) {
    salah('bongkar.js: yield nol tidak dijaga — pembagian dengan nol menghasilkan Infinity yang terlihat seperti angka di layar.');
  }
  if (!/q > maks \+ TOLERANSI/.test(kode)) {
    salah('bongkar.js: batas atas tidak diperiksa di layar — penolakannya baru datang dari server sesudah form diisi.');
  }
  // Baris nol adalah jawaban yang sah, bukan kesalahan.
  if (!/if \(q === null \|\| q <= 0\) continue;/.test(kode)) {
    salah('bongkar.js: baris ber-jumlah 0 dianggap kesalahan. Tepung yang sudah menempel memang tidak bisa kembali — itu jawaban, bukan salah isi.');
  }
}

// ---------------------------------------------------------------
// Layanan & layar
// ---------------------------------------------------------------
const svc = baca('js/modules/inventory/inventory.service.js');
if (svc) {
  const kode = tanpaKomentar(svc);
  for (const fn of ['bongkar_bahan', 'batalkan_bongkar']) {
    if (!new RegExp(`rpc\\(\\s*'${fn}'`).test(kode)) salah(`inventory.service.js: RPC \`${fn}\` tidak pernah dipanggil.`);
  }
  // Jenis pergerakan baru harus punya labelnya, kalau tidak laporan stok
  // menampilkan "bongkar_in" mentah kepada staff.
  for (const t of ['bongkar_out', 'bongkar_in']) {
    if (!new RegExp(`${t}: '`).test(kode)) salah(`inventory.service.js: \`MOVEMENT_LABEL.${t}\` tidak ada — laporan akan menampilkan namanya mentah.`);
  }
}

const layar = baca('js/modules/inventory/bongkar-staff.js');
if (layar) {
  const kode = tanpaKomentar(layar);
  if (!/periksaBongkar\(/.test(kode)) salah('bongkar-staff.js: pilihan staff tidak diperiksa sebelum dikirim.');
  if (!/pesanStok\(/.test(kode)) salah('bongkar-staff.js: peringatan stok tidak ditampilkan.');
  if (!/data-maks=/.test(kode)) salah('bongkar-staff.js: batas per bahan tidak disebut di sebelah kotaknya — orangnya harus menebak.');
  // Hanya produk yang PUNYA resep yang ditawarkan.
  if (!/Array\.isArray\(r\.items\) && r\.items\.length > 0/.test(kode)) {
    salah('bongkar-staff.js: produk tanpa resep ikut ditawarkan — hasilnya penolakan server yang tidak bisa ditindaklanjuti siapa pun.');
  }
}

const hal = baca('js/modules/inventory/inventory.page.js');
if (hal) {
  const kode = tanpaKomentar(hal);
  if (!/id="inv-bongkar"/.test(kode)) salah('inventory.page.js: tombol Bongkar Bahan tidak ada di modul Bahan.');
  if (!/renderBongkarStaff\(/.test(kode)) salah('inventory.page.js: panel bongkar tidak pernah digambar — tombolnya ada, jalannya tidak.');
  // Panel yang memegang outlet harus ikut ditutup saat outletnya berganti.
  //
  // Diperiksa DI DALAM daftar penutupnya, bukan di seluruh berkas: nama
  // panelnya juga muncul di `querySelector` saat panelnya dibuka, jadi
  // mencarinya begitu saja tetap hijau walau barisnya dicabut dari daftar.
  // Sebuah sabotase memang lolos lewat celah itu.
  const iDaftar = kode.indexOf("['#inv-nota-panel'");
  const daftarTutup = iDaftar < 0 ? '' : kode.slice(iDaftar, kode.indexOf(']', kode.indexOf('#inv-opname') > 0 ? iDaftar : iDaftar) + 400);
  if (!/'#inv-bongkar-panel'/.test(daftarTutup)) {
    salah(
      'inventory.page.js: panel bongkar tidak ikut ditutup saat outlet berganti. ' +
        'Ia memegang `outletId` saat dibuka — bongkarnya akan masuk ke outlet SEBELUMNYA, tanpa satu pun tanda.'
    );
  }
  // Stoknya harus segar: peringatannya membandingkan angka.
  if (!/stockMap = \(await refresh\(\)\) \?\? stockMap;\s*\n\s*renderBongkarStaff\(/.test(kode)) {
    salah('inventory.page.js: stok tidak disegarkan sebelum panel bongkar dibuka — peringatan "stok cuma 3" dihitung dari angka basi.');
  }
}

if (gagal === 0) {
  console.log('Bongkar bahan: batas porsi ditegakkan server, hasilnya tanpa biaya, dan panelnya ikut menutup saat outlet berganti. ✅');
}
process.exit(gagal === 0 ? 0 : 1);
