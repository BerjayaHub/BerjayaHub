/**
 * AUDIT: keterangan per baris surat jalan (0132 + 0157).
 *
 * ============ CARA FITUR INI RUSAK TANPA TERLIHAT RUSAK ============
 *
 *   layar membuang keterangannya  -> RPC-nya menerima, layarnya tidak pernah
 *                                    mengirim; kotaknya terlihat bekerja dan
 *                                    isinya tidak pernah sampai ke mana pun
 *   nilai lama tidak dimuat       -> kotaknya terbuka kosong, staff mengira
 *                                    belum pernah diisi, lalu menyimpan — dan
 *                                    keterangan yang ada ikut terhapus
 *   "kosong" = "tidak dikirim"    -> keterangan yang dihapus MUNCUL KEMBALI
 *                                    sesudah disimpan, berkali-kali, tanpa galat
 *   kunci selalu dikirim          -> layar yang tidak punya kotaknya menghapus
 *                                    keterangan orang lain tanpa ada yang tahu
 *   `v_lama` dibuang              -> PWA lama di HP staff menghapus seluruh
 *                                    keterangan sekali simpan
 *   keterangan hilang saat gabung -> dua baris kembar digabung, dan kalimat
 *                                    satu-satunya yang menjelaskan barisnya lenyap
 *   snapshot tidak membawanya     -> ganti saringan kategori = isian hilang,
 *                                    tepat saat orang menyempitkan daftarnya
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
const bersih = (isi, rel, penanda) => {
  const kode = tanpaKomentar(isi);
  const pesan = periksaKewarasan(isi, kode, penanda);
  if (pesan) salah(`${rel}: ${pesan}`);
  return kode;
};

/** Buang komentar `--` SQL, kecuali yang berada di dalam string literal. */
const tanpaSqlKomentar = (sql) =>
  sql
    .split('\n')
    .map((baris) => {
      let petik = 0;
      for (let i = 0; i < baris.length; i++) {
        if (baris[i] === "'") petik++;
        else if (baris[i] === '-' && baris[i + 1] === '-' && petik % 2 === 0) return baris.slice(0, i);
      }
      return baris;
    })
    .join('\n');

// ---------------------------------------------------------------
// 1. MIGRATION 0157.
// ---------------------------------------------------------------
const mig = baca('supabase/migrations/0157_keterangan_draft_bisa_dikosongkan.sql');
if (mig) {
  const kode = tanpaSqlKomentar(mig);
  if (!/create or replace function ubah_draft_kiriman/.test(kode)) {
    salah('audit-keterangan-kiriman: penyaring komentar SQL ikut memakan kodenya — pemeriksaan di bawah tidak bisa dipercaya.');
  }
  if (/PEMBEDANYA: OPERATOR/.test(kode)) {
    salah('audit-keterangan-kiriman: komentar SQL tidak tersaring — pemeriksaan di bawah bisa hijau hanya karena kalimat penjelasnya.');
  }

  // ============ INTI: "ADA" vs "KOSONG" ============
  if (!/if it \? 'keterangan' then/.test(kode)) {
    salah(
      "0157: pembedanya bukan lagi operator `?`. Tanpa itu, \"kunci tidak ada\" dan \"kunci ada tapi kosong\" jatuh ke " +
        'cabang yang sama — dan staff yang menghapus keterangan salah ketik akan melihatnya MUNCUL KEMBALI sesudah ' +
        'menyimpan, berkali-kali, tanpa satu pun galat.'
    );
  }
  if (!/v_ket := nullif\(btrim\(coalesce\(it->>'keterangan', ''\)\), ''\);/.test(kode)) {
    salah('0157: nilai yang dikirim tidak lagi dirapikan jadi NULL saat kosong — keterangan berisi spasi tersimpan sebagai teks.');
  }
  // Cabang `else` HARUS jatuh ke salinan lama — itu perlindungan PWA lama.
  if (!/else\s*\n\s*v_ket := v_lama -> v_pid::text ->> 'k';/.test(kode)) {
    salah(
      '0157: cabang "kunci tidak ada" tidak lagi mempertahankan nilai lama. PWA lama di HP staff tidak mengenal kolom ' +
        'ini sama sekali, dan tanpa penyelamatan itu satu kali "Simpan perubahan" dari HP tersebut menghapus seluruh ' +
        'keterangan yang sudah diketik.'
    );
  }
  if (!/select coalesce\(jsonb_object_agg\(product_id::text/.test(kode)) {
    salah('0157: salinan isi lama (`v_lama`) hilang — tidak ada lagi yang bisa dipertahankan untuk kunci yang tidak dikirim.');
  }
  // Penjaga lama tidak boleh ikut longgar.
  for (const [pola, pesan] of [
    [/if v_jumlah = 0 then/, 'penjaga "draft tidak boleh kosong"'],
    [/if v_positif = 0 then/, 'penjaga "semua barang jumlah kirimnya 0"'],
    [/if not boleh_kelola_draft\(p_dispatch\) then/, 'penjaga wewenang']
  ]) {
    if (!pola.test(kode)) salah(`0157: ${pesan} hilang saat fungsinya ditulis ulang.`);
  }
}

// ---------------------------------------------------------------
// 2. PICKER — kotaknya, dan isian yang harus selamat.
// ---------------------------------------------------------------
const picker = baca('js/modules/dispatch/item-picker.js');
if (picker) {
  const kode = bersih(picker, 'item-picker.js', ['kolomKeterangan', 'function snapshot']);

  if (!/kolomKeterangan = false/.test(kode)) {
    salah('item-picker.js: opsi `kolomKeterangan` hilang — kotaknya tidak bisa dinyalakan di layar mana pun.');
  }
  if (!/class="pf-ket"/.test(kode)) {
    salah('item-picker.js: kotak keterangannya tidak digambar.');
  }
  // ============ SNAPSHOT HARUS MEMBAWANYA ============
  //
  // `snapshot()` → `renderRows()` adalah satu-satunya jalan isian baris
  // bertahan saat saringan kategori berubah. Apa pun yang tidak ikut di sana
  // lenyap tanpa tanda — tepat pada saat orang menyempitkan daftarnya untuk
  // mengetik lebih cepat.
  if (!/keterangan: row\.querySelector\('\.pf-ket'\)\?\.value/.test(kode)) {
    salah(
      'item-picker.js `snapshot()`: keterangan tidak ikut disalin. Ganti saringan kategori sekali, dan seluruh ' +
        'keterangan yang sudah diketik hilang — tanpa satu pun tanda bahwa itu terjadi.'
    );
  }
  if (!/keterangan: i\.keterangan/.test(kode)) {
    salah(
      'item-picker.js: nilai awal keterangan tidak dimuat dari `initial`. Kotaknya terbuka kosong, staff mengira ' +
        'belum pernah diisi, lalu menyimpan — dan keterangan yang ada ikut terhapus.'
    );
  }
  // Dikirim HANYA kalau kotaknya memang ada.
  if (!/\.\.\.\(kolomKeterangan \? \{ keterangan: String\(e\.keterangan \?\? ''\)\.trim\(\) \} : \{\}\)/.test(kode)) {
    salah(
      'item-picker.js `getItems()`: keterangan dikirim tanpa syarat `kolomKeterangan`. Layar yang tidak punya kotaknya ' +
        'akan mengirim string kosong — dan sejak 0157 itu artinya "hapus", bukan "tidak tahu".'
    );
  }
}

// ---------------------------------------------------------------
// 3. LAYANAN — kuncinya ikut, dan hanya kalau ada.
// ---------------------------------------------------------------
const svc = baca('js/modules/dispatch/dispatch.service.js');
if (svc) {
  const kode = bersih(svc, 'dispatch.service.js', ['export async function ubahDraftKiriman']);
  const blok = kode.slice(kode.indexOf('export async function ubahDraftKiriman'), kode.indexOf('export async function hapusDraftKiriman'));

  if (!/\.\.\.\(i\.keterangan === undefined \? \{\} : \{ keterangan: i\.keterangan \}\)/.test(blok)) {
    salah(
      'dispatch.service.js `ubahDraftKiriman`: keterangan tidak lagi diteruskan dengan benar. Dibuang = kotaknya di ' +
        'layar draft terlihat bekerja tapi isinya tidak pernah sampai ke server; dikirim tanpa syarat = layar lain ' +
        'menghapus keterangan orang lain tanpa ada yang tahu.'
    );
  }
}

// ---------------------------------------------------------------
// 4. LAYAR DRAFT.
// ---------------------------------------------------------------
const page = baca('js/modules/dispatch/dispatch.page.js');
if (page) {
  const kode = bersih(page, 'dispatch.page.js', ['kolomKeterangan: true']);

  if (!/kolomKeterangan: true/.test(kode)) {
    salah(
      'dispatch.page.js: layar draft tidak lagi menyalakan kolom Keterangan. Selama tahap draft — tahap yang gunanya ' +
        'memeriksa sebelum barang berangkat — kalimat yang akan tercetak di surat jalan jadi tidak terlihat sama sekali.'
    );
  }
  if (!/qty: i\.sent_qty, keterangan: i\.keterangan/.test(kode)) {
    salah('dispatch.page.js: nilai keterangan yang sudah ada tidak dimuat ke picker draft — kotaknya terbuka kosong.');
  }
}

// ---------------------------------------------------------------
// 5. PENGGABUNGAN BARIS KEMBAR.
// ---------------------------------------------------------------
const dup = baca('js/modules/dispatch/duplikat-item.js');
if (dup) {
  const kode = bersih(dup, 'duplikat-item.js', ['export function gabungDuplikat']);

  if (!/'keterangan' in \(it \?\? \{\}\)/.test(kode)) {
    salah(
      "duplikat-item.js: hasil gabungan tidak lagi dijaga `'keterangan' in it`. Order & nota memakai picker yang sama, " +
        'dan kolom baru yang muncul sendiri di sana akan terkirim ke RPC yang tidak mengenalnya.'
    );
  }
  if (!/if \(k !== undefined && String\(k\)\.trim\(\) !== ''\) ket = k;/.test(kode)) {
    salah(
      'duplikat-item.js: keterangan baris kedua tidak lagi diselamatkan saat baris pertamanya kosong. Kalimat ' +
        'satu-satunya yang menjelaskan baris itu hilang tanpa tanda — dan di surat jalan ia satu-satunya tempat ' +
        '"stok CK habis" bisa ditulis.'
    );
  }
}

// ---------------------------------------------------------------
// 6. KERTAS & WHATSAPP — SATU PENYUSUN CATATAN BARIS.
// ---------------------------------------------------------------
const pesan = baca('js/modules/dispatch/pesan-kiriman.js');
if (pesan) {
  const kode = bersih(pesan, 'pesan-kiriman.js', ['export function catatanBaris', 'export function suratJalanWaText']);

  // Modul ini harus bisa diuji tanpa browser. `format.js` boleh — ia tidak
  // menyentuh DOM sama sekali; apa pun yang lain membawa `window` ke dalam tes.
  const impor = (kode.match(/^import .*$/gm) ?? []).filter((b) => !/core\/format\.js/.test(b));
  if (impor.length) {
    salah(`pesan-kiriman.js: ada impor selain core/format.js (${impor.join(' | ')}) — modul ini harus bisa diuji tanpa browser.`);
  }

  // ============ KETERANGANNYA IKUT DI TEKS WHATSAPP ============
  if (!/const catatan = catatanBaris\(it\);/.test(kode)) {
    salah(
      'pesan-kiriman.js `barisPesan`: catatan barisnya tidak lagi ikut. Pesan WhatsApp adalah dokumen yang dibaca ' +
        'DULU — biasanya sebelum mobilnya sampai — jadi keterangan yang hilang dari sana hilang justru dari dokumen ' +
        'yang paling cepat menolong.'
    );
  }
  // `!= null`, bukan truthy: `Number(null)` adalah 0.
  if (!/it\?\.ordered != null && Number\(it\.ordered\) !== Number\(it\.sent\)/.test(kode)) {
    salah(
      'pesan-kiriman.js `catatanBaris`: penjaga `ordered` berubah bentuk. `Number(null)` adalah 0, jadi tanpa ' +
        '`!= null` setiap baris tanpa `ordered` akan berbunyi "diminta 0" — tuduhan yang tidak pernah dibuat siapa pun.'
    );
  }
  // Pemotongan milik PEMANGGIL, bukan aturan bersama.
  if (!/potong > 0 \? ket\.slice\(0, potong\) : ket/.test(kode)) {
    salah(
      'pesan-kiriman.js: pemotongan keterangan bukan lagi pilihan pemanggil. Lebar A5 adalah batas KERTAS; memotong ' +
        'pesan WhatsApp sepanjang itu berarti membuang kalimat yang muat hanya karena dokumen lain tidak muat.'
    );
  }
  if (!/kosong\.length/.test(kode) || !/TIDAK dikirim/.test(kode)) {
    salah('pesan-kiriman.js: ringkasan barang yang tidak dikirim hilang — di daftar tiga puluh baris, "0" di tengah tenggelam.');
  }
}

const pdf = baca('js/modules/dispatch/dispatch-pdf.js');
if (pdf) {
  const kode = bersih(pdf, 'dispatch-pdf.js', ['catatanBaris']);

  // ============ PDF TIDAK BOLEH MENYUSUNNYA SENDIRI LAGI ============
  //
  // Dulu kertas dan WhatsApp punya penyusun masing-masing, dan yang satu
  // memuat jawaban yang tidak ada di yang lain. Disalin ke dua tempat, ia akan
  // menyimpang lagi — satu sisi diperbaiki, yang lain tidak, dan tidak ada apa
  // pun yang melempar error saat itu terjadi.
  if (!/const catatan = catatanBaris\(it, \{ potong: 60 \}\);/.test(kode)) {
    salah('dispatch-pdf.js: PDF tidak lagi memakai `catatanBaris` bersama. Kertas & pesan WhatsApp akan menyimpang tanpa satu pun galat.');
  }
  if (/catatan\.push\(/.test(kode)) {
    salah('dispatch-pdf.js: PDF menyusun catatan barisnya sendiri lagi — itu salinan kedua dari aturan yang sama.');
  }
  if (!/export \{ suratJalanWaText \} from '\.\/pesan-kiriman\.js';/.test(kode)) {
    salah('dispatch-pdf.js: `suratJalanWaText` tidak lagi diekspor ulang — pemanggil lamanya (`dispatch.page.js`) akan gagal memuat.');
  }
}

console.log('');
if (gagal === 0) console.log('Audit keterangan kiriman bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
