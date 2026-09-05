/**
 * AUDIT: argumen RPC yang bisa `undefined` harus dijaga.
 *
 * ============ BUG YANG MELAHIRKAN AUDIT INI ============
 *
 *   "Could not find the function public.ubah_nota_terima(p_id, p_invoice_no,
 *    p_items, p_notes, p_receipt_date, p_supplier) in the schema cache"
 *
 * Tujuh argumen tertulis di kode; enam yang sampai. `JSON.stringify` membuang
 * kunci bernilai `undefined`, dan PostgREST memilih fungsi berdasarkan
 * himpunan NAMA argumen. Satu `undefined` tidak berarti "argumen ini NULL" —
 * ia berarti "panggil fungsi LAIN".
 *
 * Kalau fungsi berargumen-kurang itu KEBETULAN ADA (versi lama yang belum
 * di-drop, atau yang parameternya ber-DEFAULT), panggilannya BERHASIL,
 * mengerjakan hal yang berbeda, dan tidak ada satu pun error.
 *
 * ============ KENAPA CAKUPANNYA SEMPIT ============
 *
 * Menuntut `?? null` pada SETIAP argumen RPC menyentuh 141 tempat di repo ini,
 * hampir semuanya id wajib yang tidak pernah `undefined`. Aturan sebising itu
 * akan diabaikan, dan aturan yang diabaikan lebih buruk daripada tidak ada.
 *
 * Yang dijaga: RPC yang argumennya datang dari **kantong opsi** (`{ a, b, c }`
 * di tanda tangan fungsinya) TANPA nilai bawaan — di situlah pemanggil boleh
 * tidak menyebut sebuah field, dan di situ pula bug ini lahir.
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
// 1. Penjagaannya sendiri harus ada dan berbentuk benar.
// ---------------------------------------------------------------
const inti = baca('js/core/rpc-args.js');
if (inti) {
  const kode = tanpaKomentar(inti);
  if (!/export function argumenRpc\(/.test(kode)) {
    salah('js/core/rpc-args.js: `argumenRpc` tidak diekspor.');
  }
  if (!/v === undefined \? null : v/.test(kode)) {
    salah(
      'js/core/rpc-args.js: `argumenRpc` tidak lagi mengubah `undefined` jadi `null`. ' +
        'Itu satu-satunya pekerjaannya — tanpa itu kuncinya kembali dibuang `JSON.stringify`.'
    );
  }
  // NULL dan string kosong punya ARTI BERBEDA di `ubah_nota_terima`
  // (NULL = jangan sentuh, '' = hapus). Menyamakan keduanya di sini akan
  // menghidupkan kembali bug 0119 dari sisi klien.
  if (/\?\? ''/.test(kode) || /=== null \? ''/.test(kode)) {
    salah(
      "js/core/rpc-args.js: ada yang mengubah nilai jadi string kosong. " +
        'NULL berarti "jangan sentuh" dan string kosong berarti "hapus" — menyamakannya menghapus data ' +
        'yang tidak pernah disebut siapa pun (bug 0119).'
    );
  }
}

// ---------------------------------------------------------------
// 2. RPC nota memakainya.
//
// Kedua fungsi ini menerima kantong opsi dan punya pemanggil yang sengaja
// tidak menyebut sebagian field — "+ Foto" tidak menyebut barang, dialog Edit
// tidak menyebut foto. Persis bentuk yang melahirkan bugnya.
// ---------------------------------------------------------------
const svc = baca('js/modules/inventory/nota.service.js');
if (svc) {
  const kode = tanpaKomentar(svc);
  for (const nama of ['simpan_nota_terima', 'ubah_nota_terima']) {
    if (!new RegExp(`rpc\\('${nama}', argumenRpc\\(`).test(kode)) {
      salah(
        `js/modules/inventory/nota.service.js: \`${nama}\` dipanggil tanpa \`argumenRpc\`. ` +
          'Pemanggil yang tidak menyebut sebuah field mengirim `undefined`, kuncinya dibuang, dan PostgREST ' +
          'mencari fungsi berargumen lebih sedikit — yang kalau ada akan berhasil mengerjakan hal yang berbeda.'
      );
    }
  }
  // Field yang boleh tidak disebut wajib tetap ber-`?? null` juga: dua lapis,
  // karena `argumenRpc` menjaga BENTUKNYA sementara `?? null` menjaga ARTINYA
  // tetap "jangan sentuh".
  for (const f of ['p_supplier', 'p_invoice_no', 'p_photo_path', 'p_notes']) {
    if (!new RegExp(`${f}: \\w+ \\?\\? null`).test(kode)) {
      salah(
        `js/modules/inventory/nota.service.js: \`${f}\` tidak ber-\`?? null\`. ` +
          'Di `ubah_nota_terima`, NULL berarti "jangan sentuh" — dan field yang tidak disebut harus berarti itu, ' +
          'bukan string kosong yang berarti "hapus".'
      );
    }
  }
}

if (gagal === 0) {
  console.log('Argumen RPC: `undefined` tidak bisa membuang kunci dan menukar fungsi yang dipanggil. ✅');
}
process.exit(gagal === 0 ? 0 : 1);
