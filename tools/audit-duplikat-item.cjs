/**
 * AUDIT: satu bahan, satu baris (0129).
 *
 * ============ KENAPA INI PUNYA DUA LAPIS, DAN KEDUANYA DIJAGA ============
 *
 * Aplikasi ini PWA yang terpasang di HP staff, dan versinya bisa tertinggal
 * berhari-hari. Penjagaan yang hanya ada di layar tidak berlaku untuk HP yang
 * belum memuat ulang kodenya — dan justru HP itulah yang paling sering dipakai
 * di lapangan.
 *
 * Sebaliknya, penjagaan yang hanya ada di database menghasilkan
 * "duplicate key value violates unique constraint …" di layar staff outlet:
 * kalimat yang tidak menyebut bahan mana, dan tidak seorang pun bisa
 * menindaklanjutinya.
 *
 * Jadi yang dijaga:
 *
 *   1. Unique index ada untuk KETIGA dokumen.
 *   2. Trigger pesannya menyebut NAMA bahan, bukan uuid, bukan galat mentah.
 *   3. Penggabungan data lama mematikan trigger 0122/0128 lalu MENYALAKANNYA
 *      LAGI — dimatikan permanen berarti nota lunas bisa diubah selamanya.
 *   4. Harga nota tidak dijumlahkan kalau salah satu barisnya kosong.
 *   5. Layar menyalakan `tanpaDuplikat` DAN menolak simpan — penandaan merah
 *      yang tetap bisa ditekan Simpan bukan penjagaan, cuma hiasan.
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
// 1–4. Migration
// ---------------------------------------------------------------
const mig = baca('supabase/migrations/0129_satu_bahan_satu_baris.sql');
if (mig) {
  const uk = {
    'stock_order_items(order_id, product_id)': 'order ke CK',
    'dispatch_items(dispatch_id, product_id)': 'surat jalan',
    'goods_receipt_items(receipt_id, product_id)': 'nota supplier'
  };
  for (const [idx, nama] of Object.entries(uk)) {
    if (!mig.includes(`on ${idx}`)) {
      salah(`0129: unique index untuk ${nama} (\`${idx}\`) tidak ada — penjagaannya cuma di layar.`);
    }
  }

  // Trigger + pesan yang menyebut nama.
  for (const fn of ['tolak_bahan_kembar_order', 'tolak_bahan_kembar_kiriman', 'tolak_bahan_kembar_nota']) {
    if (!new RegExp(`create or replace function ${fn}\\(`).test(mig)) {
      salah(`0129: trigger \`${fn}\` tidak ada — yang muncul di layar akan jadi galat unique constraint mentah.`);
      continue;
    }
    const i = mig.indexOf(`function ${fn}(`);
    const blok = mig.slice(i, mig.indexOf('$$;', i));
    if (!/select name into v_nama from products/.test(blok)) {
      salah(`0129 \`${fn}\`: tidak mengambil NAMA produknya. Pesan ber-uuid sama tidak bergunanya dengan galat mentah.`);
    }
    if (!/raise exception '%/.test(blok)) {
      salah(`0129 \`${fn}\`: pesannya tidak menyisipkan nama bahan.`);
    }
  }
  for (const trg of ['trg_bahan_kembar_order', 'trg_bahan_kembar_kiriman', 'trg_bahan_kembar_nota']) {
    if (!new RegExp(`create trigger ${trg}`).test(mig)) {
      salah(`0129: trigger \`${trg}\` tidak dipasang — fungsinya ada, jalannya tidak.`);
    }
  }

  // 3. Trigger penjaga dimatikan SEMENTARA, bukan selamanya.
  //
  // Ini yang paling berbahaya kalau salah: `disable` tanpa `enable` membuat
  // nota lunas bisa diubah siapa pun, selamanya, tanpa satu pun tanda.
  for (const t of ['trg_tolak_ubah_nota_lunas', 'trg_tolak_ubah_kiriman_terekspor']) {
    const mati = (mig.match(new RegExp(`disable trigger ${t}`, 'g')) ?? []).length;
    const hidup = (mig.match(new RegExp(`enable trigger ${t}`, 'g')) ?? []).length;
    if (mati && !hidup) {
      salah(`0129: \`${t}\` dimatikan tapi TIDAK dinyalakan lagi. Penjagaan yang mati selamanya adalah lubang yang tidak terlihat siapa pun.`);
    }
    if (hidup > mati) {
      salah(`0129: \`${t}\` dinyalakan lebih banyak daripada dimatikan — salah satunya salah tempat.`);
    }
  }
  // Urutannya harus: matikan -> gabungkan -> nyalakan.
  const iMati = mig.indexOf('disable trigger trg_tolak_ubah_nota_lunas');
  const iHidup = mig.indexOf('enable trigger trg_tolak_ubah_nota_lunas');
  const iGabung = mig.indexOf('update goods_receipt_items i');
  if (iMati >= 0 && iHidup >= 0 && !(iMati < iGabung && iGabung < iHidup)) {
    salah('0129: penggabungan nota tidak berada di antara disable dan enable trigger — ia akan ditolak trigger 0122.');
  }

  // 4. Harga tidak dijumlahkan kalau salah satu barisnya kosong.
  if (!/line_total = case when d\.n_berharga = d\.n then d\.total_harga else null end/.test(mig)) {
    salah(
      '0129: harga nota dijumlahkan tanpa memeriksa apakah SELURUH barisnya berharga. ' +
        '100gr@Rp5.000 + 150gr@(kosong) yang jadi 250gr@Rp5.000 menjatuhkan biaya per gram dari 50 ke 20, dan angka itu masuk ke rata-rata biaya bahan.'
    );
  }
  if (!/update stock_movements sm/.test(mig)) {
    salah('0129: `stock_movements` tidak ikut disamakan — layar nota akan benar sementara laporan biayanya memakai angka lama.');
  }
}

// ---------------------------------------------------------------
// Modul murni
// ---------------------------------------------------------------
const modul = baca('js/modules/dispatch/duplikat-item.js');
if (modul) {
  const kode = tanpaKomentar(modul);
  for (const fn of ['cariDuplikat', 'gabungDuplikat']) {
    if (!new RegExp(`export function ${fn}\\(`).test(kode)) salah(`duplikat-item.js: \`${fn}\` tidak diekspor.`);
  }
  // Baris kosong tidak boleh dihitung kembar: form selalu menyisakan satu.
  if (!/if \(!id\) return;/.test(kode)) {
    salah('duplikat-item.js: baris tanpa produk ikut dihitung kembar — seluruh form akan ditandai merah sejak dibuka.');
  }
  if (!/adaHargaKosong \? null :/.test(kode)) {
    salah('duplikat-item.js: harga dijumlahkan tanpa memeriksa apakah ada baris yang belum berharga.');
  }
}

// ---------------------------------------------------------------
// 5. Layar: dinyalakan DAN menolak simpan.
// ---------------------------------------------------------------
const layar = {
  'js/modules/dispatch/dispatch.page.js': 3, // order edit, kirim, draft SJ
  'js/modules/inventory/nota-staff.js': 2 // nota baru, nota edit
};
for (const [rel, jumlah] of Object.entries(layar)) {
  const isi = baca(rel);
  if (!isi) continue;
  const kode = tanpaKomentar(isi);

  const nyala = (kode.match(/tanpaDuplikat: true/g) ?? []).length;
  if (nyala < jumlah) {
    salah(`${rel}: \`tanpaDuplikat: true\` cuma ${nyala} dari ${jumlah} pemilih produk. Yang tertinggal tetap bisa memasukkan bahan kembar.`);
  }

  // Ditandai merah saja tidak cukup — tombol Simpan harus benar-benar menolak.
  const tolak = (kode.match(/adaDuplikat\(\)/g) ?? []).length;
  if (tolak < jumlah) {
    salah(
      `${rel}: hanya ${tolak} dari ${jumlah} tempat yang memeriksa \`adaDuplikat()\` sebelum menyimpan. ` +
        'Kotak merah yang tetap bisa dilewati Simpan bukan penjagaan, cuma hiasan.'
    );
  }
}

const picker = baca('js/modules/dispatch/item-picker.js');
if (picker) {
  const kode = tanpaKomentar(picker);
  if (!/adaDuplikat:/.test(kode)) salah('item-picker.js: tidak mengekspor `adaDuplikat` — layar tidak punya cara menolak simpan.');

  // Tombolnya diperiksa DUA-DUANYA: markupnya dan pemasangan handler-nya.
  //
  // Mencari `pf-gabung` sekali saja tidak cukup — namanya muncul dua kali di
  // berkas ini, jadi salah satunya bisa dirusak dan pemeriksaannya tetap hijau
  // karena menemukan yang satunya. Sebuah sabotase memang lolos lewat celah itu.
  if (!/class="pf-gabung"/.test(kode)) {
    salah('item-picker.js: tombol Gabungkan tidak digambar — staff harus membetulkannya sendiri baris demi baris.');
  }
  if (!/querySelector\('\.pf-gabung'\)\.addEventListener/.test(kode)) {
    salah('item-picker.js: tombol Gabungkan ada tapi tidak terhubung — ditekan, tidak terjadi apa-apa.');
  }

  // Harganya harus dibaca lewat `bacaRupiah` DI `isiTerbaca`, fungsi yang
  // memberi makan penggabungan. Memeriksanya di seluruh berkas akan tetap
  // hijau karena `getItems()` juga memanggilnya — dan `getItems()` bukan yang
  // dipakai menjumlahkan.
  const iIsi = kode.indexOf('function isiTerbaca');
  if (iIsi < 0) {
    salah('item-picker.js: `isiTerbaca` tidak ada — penggabungan membaca harga langsung dari kotaknya.');
  } else if (!/bacaRupiah\(e\.line_total\)/.test(kode.slice(iIsi, kode.indexOf('}', kode.indexOf('return', iIsi)) + 200))) {
    salah(
      'item-picker.js `isiTerbaca`: harga dibaca dari kotaknya tanpa `bacaRupiah`. ' +
        "`Number('12.500')` adalah 12,5 — penggabungannya akan mengubah dua belas ribu lima ratus jadi dua belas setengah."
    );
  }
}

if (gagal === 0) {
  console.log('Satu bahan satu baris: unique index + trigger bernama, data lama digabung, dan layar benar-benar menolak. ✅');
}
process.exit(gagal === 0 ? 0 : 1);
