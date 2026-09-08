/**
 * AUDIT: ekspor ESB Simple Transfer (0128).
 *
 * ============ KENAPA INI DIJAGA KETAT ============
 *
 * Transfer memindahkan stok antar dua outlet sekaligus. Salah sedikit di sini
 * membuat DUA neraca meleset, dan tidak satu pun barisnya terlihat aneh — yang
 * menemukannya adalah orang yang menghitung opname berminggu-minggu kemudian,
 * dan pada saat itu asal selisihnya sudah tidak bisa dilacak.
 *
 * Empat hal yang dijaga, semuanya keputusan pengguna, dan semuanya sunyi kalau
 * hilang:
 *
 * 1. **Qty = `received_qty`.** Yang dikirim belum tentu yang sampai. Memakai
 *    `sent_qty` membuat stok tujuan di ESB lebih besar dari isi raknya.
 * 2. **Hanya yang sudah DITERIMA.** Barang yang masih di jalan belum boleh
 *    menambah stok di ESB.
 * 3. **Tanggal = tanggal DITERIMA, dalam WIB.** `slice(0,10)` atas timestamptz
 *    UTC melaporkan penerimaan dini hari pada tanggal kemarin.
 * 4. **Penandaan SESUDAH berkasnya jadi.** Ditandai lebih dulu lalu unduhannya
 *    gagal = kiriman hilang dari daftar tanpa pernah sampai ke ESB.
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
// 1. Migration 0128
// ---------------------------------------------------------------
const mig = baca('supabase/migrations/0128_ekspor_esb_transfer.sql');
if (mig) {
  for (const fn of ['tandai_kiriman_esb', 'batalkan_tanda_kiriman_esb']) {
    if (!new RegExp(`create or replace function ${fn}\\(`).test(mig)) {
      salah(`0128: RPC \`${fn}\` tidak ada.`);
    }
    if (!new RegExp(`grant execute on function ${fn}\\(uuid\\[\\]\\) to authenticated`).test(mig)) {
      salah(`0128: \`${fn}\` tidak diberikan ke authenticated — layarnya akan dapat 42883.`);
    }
  }

  // Blok `tandai_kiriman_esb` saja, supaya syaratnya tidak "ketemu" di fungsi
  // sebelah. Kesalahan itu sudah pernah terjadi di audit lain di repo ini.
  const blok = mig.slice(mig.indexOf('function tandai_kiriman_esb'), mig.indexOf('batalkan_tanda_kiriman_esb'));
  if (!/status\s*=\s*'received'/.test(blok)) {
    salah(
      "0128 `tandai_kiriman_esb`: tidak menyaring status = 'received'. " +
        'Barang yang masih di jalan akan menambah stok di ESB sebelum sampai.'
    );
  }
  if (!/received_at is not null/.test(blok)) {
    salah('0128 `tandai_kiriman_esb`: kiriman tanpa received_at tidak ditolak — sel Date kosong diisi ESB dengan tanggal unggah.');
  }
  if (!/esb_exported_at is null/.test(blok)) {
    salah('0128 `tandai_kiriman_esb`: stempel lama bisa tertimpa, jejak kapan ia berangkat hilang.');
  }
  if (!/is_bu_admin\(/.test(blok)) {
    salah('0128 `tandai_kiriman_esb`: tidak ada penjaga wewenang — security definer tanpa is_bu_admin melewati RLS.');
  }
  if (!/alter table dispatches add column if not exists esb_exported_at/.test(mig)) {
    salah('0128: kolom penanda `dispatches.esb_exported_at` tidak dibuat.');
  }
}

// ---------------------------------------------------------------
// 2. Modul murni
// ---------------------------------------------------------------
const modul = baca('js/modules/inventory/esb-transfer.js');
if (modul) {
  const kode = tanpaKomentar(modul);

  if (!/received_qty/.test(kode)) {
    salah('esb-transfer.js: tidak menyebut `received_qty` sama sekali — Qty-nya datang dari mana?');
  }
  // `sent_qty` boleh DIBACA (untuk keterangan), tapi tidak boleh jadi sumber
  // qty. Yang dilarang: menjadikannya nilai jatuh-balik atau nilai utama.
  if (/received_qty\s*(\?\?|\|\|)\s*[\w.]*sent_qty/.test(kode) || /qty:\s*[\w.]*sent_qty/.test(kode)) {
    salah('esb-transfer.js: `sent_qty` dipakai sebagai qty (atau cadangannya). Yang dikirim belum tentu yang sampai.');
  }

  if (!/tanggalWIB\(/.test(kode)) {
    salah('esb-transfer.js: tanggalnya tidak lewat `tanggalWIB` — penerimaan dini hari akan dilaporkan sebagai kemarin.');
  }
  if (/received_at[^)\n]*\.slice\(\s*0\s*,\s*10\s*\)/.test(kode) || /slice\(\s*0\s*,\s*10\s*\)/.test(kode)) {
    salah('esb-transfer.js: `slice(0,10)` atas timestamptz UTC menggeser tanggal penerimaan dini hari.');
  }

  const kol = kode.match(/export const KOLOM_TRANSFER\s*=\s*\[([\s\S]*?)\]/);
  if (!kol) {
    salah('esb-transfer.js: KOLOM_TRANSFER tidak ditemukan.');
  } else {
    const nama = [...kol[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const harus = [
      'Sequence',
      'Date',
      'Origin Branch',
      'Origin Location',
      'Destination Branch',
      'Destination Location',
      'Cost Center',
      'Project',
      'Additional Info',
      'Product Name',
      'Product Code',
      'Unit',
      'Qty'
    ];
    if (nama.join('|') !== harus.join('|')) {
      salah(`esb-transfer.js: urutan/nama kolom tidak sama dengan template ESB.\n   dapat : ${nama.join(' · ')}`);
    }
  }

  // Origin dan Destination tidak boleh tertukar. Tertukar, stok berpindah ke
  // arah yang salah di ESB — dan angkanya tetap masuk akal di kedua sisi.
  const iAsalB = kode.indexOf('const asalB');
  const iTujuanB = kode.indexOf('const tujuanB');
  if (iAsalB < 0 || iTujuanB < 0) {
    salah('esb-transfer.js: asal & tujuan tidak dihitung terpisah.');
  } else {
    const asal = kode.slice(iAsalB, kode.indexOf('\n', iAsalB));
    const tujuan = kode.slice(iTujuanB, kode.indexOf('\n', iTujuanB));
    if (!/from_outlet_name/.test(asal)) salah('esb-transfer.js: Origin tidak diambil dari `from_outlet_name`.');
    if (!/to_outlet_name/.test(tujuan)) salah('esb-transfer.js: Destination tidak diambil dari `to_outlet_name`.');
  }

  // Satu pemetaan, bukan dua. Peta khusus transfer akan membuat nama outlet
  // yang sama dipetakan dua kali, lalu suatu hari cuma salah satunya diperbarui.
  if (/peta\.(origin|destination|transfer)/.test(kode)) {
    salah('esb-transfer.js: memakai jenis pemetaan sendiri. Origin/Destination harus memakai `branch` & `location` yang sama dengan Purchase.');
  }
}

// ---------------------------------------------------------------
// 3. Layanan
// ---------------------------------------------------------------
const svc = baca('js/modules/inventory/esb.service.js');
if (svc) {
  const kode = tanpaKomentar(svc);
  const i = kode.indexOf('kirimanUntukEsb');
  if (i < 0) {
    salah('esb.service.js: `kirimanUntukEsb` tidak ada — layarnya tidak punya sumber data.');
  } else {
    const blok = kode.slice(i, i + 2000);
    if (!/\.eq\('status',\s*'received'\)/.test(blok)) {
      salah("esb.service.js `kirimanUntukEsb`: tidak menyaring status 'received'.");
    }
    // `received_at` timestamptz — di sini batas WIB eksplisit memang perlu,
    // kebalikan dari `receipt_date` (DATE) di notaUntukEsb.
    if (!/isoFrom\(from\)/.test(blok) || !/isoTo\(to\)/.test(blok)) {
      salah('esb.service.js `kirimanUntukEsb`: batas tanggal `received_at` (timestamptz) tidak memakai isoFrom/isoTo — kiriman sore hari terakhir akan hilang.');
    }
    // Harus penyaringnya, bukan sekadar nama kolomnya: `esb_exported_at` juga
    // muncul di daftar `.select(...)`, jadi mencari namanya saja akan tetap
    // hijau sesudah penyaringnya dibuang.
    if (!/\.is\('esb_exported_at',\s*null\)/.test(blok)) {
      salah('esb.service.js `kirimanUntukEsb`: kiriman yang sudah diekspor tidak disembunyikan — mutasi ganda di ESB sulit ditelusuri.');
    }
    if (!/ambilSemua\(/.test(blok)) {
      salah('esb.service.js `kirimanUntukEsb`: tidak memakai ambilSemua — PostgREST memotong di ~1000 baris tanpa berkata apa-apa.');
    }
  }
  for (const fn of ['tandai_kiriman_esb', 'batalkan_tanda_kiriman_esb']) {
    if (!new RegExp(`rpc\\('${fn}'`).test(kode)) salah(`esb.service.js: RPC \`${fn}\` tidak pernah dipanggil.`);
  }

  // Sisi Purchase diperiksa di sini juga.
  //
  // Bukan karena audit ini tentang Purchase, tapi karena kedua fungsi itu
  // tinggal di berkas yang sama dan barisnya nyaris identik — dan `replace`
  // dengan pola yang cocok di keduanya akan mengenai yang salah. Sebuah
  // sabotase pernah "tertangkap" di sini padahal yang ia rusak adalah fungsi
  // sebelah, yang saat itu tidak dijaga siapa pun.
  const iNota = kode.indexOf('notaUntukEsb');
  if (iNota < 0) {
    salah('esb.service.js: `notaUntukEsb` hilang — ekspor Purchase kehilangan sumber datanya.');
  } else {
    const blokNota = kode.slice(iNota, iNota + 2000);
    if (!/\.is\('esb_exported_at',\s*null\)/.test(blokNota)) {
      salah('esb.service.js `notaUntukEsb`: nota yang sudah diekspor tidak disembunyikan — pembelian ganda di ESB, kedua barisnya terlihat wajar.');
    }
    if (!/ambilSemua\(/.test(blokNota)) {
      salah('esb.service.js `notaUntukEsb`: tidak memakai ambilSemua — PostgREST memotong di ~1000 baris tanpa berkata apa-apa.');
    }
    // Kebalikan dari kiriman: `receipt_date` bertipe DATE. Membubuhkan jam &
    // offset WIB padanya justru menggeser batasnya satu hari.
    if (/receipt_date',\s*iso(From|To)\(/.test(blokNota)) {
      salah('esb.service.js `notaUntukEsb`: `receipt_date` itu DATE — isoFrom/isoTo malah menggeser batasnya sehari.');
    }
  }
}

// ---------------------------------------------------------------
// 4. Layar
// ---------------------------------------------------------------
const hal = baca('js/modules/inventory/esb.admin.js');
if (hal) {
  const kode = tanpaKomentar(hal);
  if (!/barisEsbTransfer\(/.test(kode)) salah('esb.admin.js: tidak pernah memanggil `barisEsbTransfer` — kemampuannya ada, jalannya tidak ada di layar.');
  if (!/id="esb-dokumen"/.test(kode)) salah('esb.admin.js: tidak ada pemilih jenis dokumen — Simple Transfer tidak bisa dipilih siapa pun.');
  if (!/KOLOM_TRANSFER/.test(kode)) salah('esb.admin.js: header transfer tidak dipakai; berkasnya akan memakai header Purchase.');

  const iUnduh = kode.indexOf('await unduhEsb(');
  const iTandai = kode.indexOf('tandaiKirimanEsb(');
  if (iUnduh < 0 || iTandai < 0) {
    salah('esb.admin.js: unduh atau penandaan kiriman tidak ditemukan.');
  } else if (iTandai < iUnduh) {
    salah('esb.admin.js: kiriman ditandai SEBELUM berkasnya jadi. Kalau unduhannya gagal, kiriman itu hilang dari daftar tanpa pernah sampai ke ESB.');
  }

  // Header ditulis di baris 1, tanpa judul di atasnya: ESB membaca baris
  // pertama sebagai nama kolom.
  if (!/aoa_to_sheet\(\[kolom,\s*\.\.\.baris\]\)/.test(kode)) {
    salah('esb.admin.js: berkasnya tidak disusun sebagai [header, ...baris] — satu baris judul saja membuat ESB menolak seluruh berkas.');
  }
}

if (gagal === 0) {
  console.log('ESB Simple Transfer: qty yang diterima, hanya yang sudah sampai, tanggal WIB, ditandai sesudah berkasnya jadi. ✅');
}
process.exit(gagal === 0 ? 0 : 1);
