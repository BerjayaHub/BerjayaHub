/**
 * TES MURNI: aturan revisi SJ yang sudah diterima.
 *
 * Yang dijaga semuanya berbentuk sama: stok yang bergerak di tempat yang
 * salah, atau tidak bergerak padahal seharusnya.
 *
 *   ubah jumlah diterima ikut memotong stok CK  -> CK berkurang dua kali
 *   tambah barang TIDAK memotong stok CK        -> barang keluar tanpa tercatat
 *   baris yang tidak berubah ikut dikirim       -> gerakan stok bernilai nol
 *   jejak revisi tanpa pelaku                   -> sama saja tidak ada jejaknya
 */
import assert from 'node:assert/strict';
import {
  JENIS,
  alasanTakBisaRevisi,
  bisaRevisi,
  susunMuatanRevisi,
  akibatStok,
  pesanAkibat,
  bacaJejak,
  kalimatJejak,
  hitungBarisDirevisi
} from '../js/modules/dispatch/revisi-kiriman.js';

let n = 0;
const ok = (nama, fn) => {
  n++;
  try {
    fn();
  } catch (e) {
    console.error(`❌ ${nama}\n   ${e.message}`);
    process.exitCode = 1;
  }
};

const CK = 'outlet-ck';
const SENTUL = 'outlet-sentul';
const LAIN = 'outlet-lain';
const SJ = { status: 'received', from_outlet_id: CK, to_outlet_id: SENTUL };

// ---------------------------------------------------------------
console.log('§1 Siapa boleh, dan kenapa yang lain tidak');
// ---------------------------------------------------------------

ok('outlet tujuan boleh', () => assert.equal(alasanTakBisaRevisi(SJ, [SENTUL]), null));
ok('CK juga boleh', () => assert.equal(alasanTakBisaRevisi(SJ, [CK]), null));

// Penolakan menyebut SEBABNYA — tombol yang hilang tanpa penjelasan membuat
// orang mengira fiturnya rusak.
ok('outlet lain ditolak dengan sebab', () => {
  const a = alasanTakBisaRevisi(SJ, [LAIN]);
  assert.ok(a);
  assert.match(a, /pengirim maupun/);
});

ok('draft diarahkan ke tab Draft, bukan sekadar ditolak', () => {
  assert.match(alasanTakBisaRevisi({ ...SJ, status: 'draft' }, [CK]), /Draft Surat Jalan/);
});

ok('yang belum diterima diarahkan ke layar Terima', () => {
  assert.match(alasanTakBisaRevisi({ ...SJ, status: 'sent' }, [SENTUL]), /layar Terima/);
});

ok('yang dibatalkan punya kalimatnya sendiri', () => {
  assert.match(alasanTakBisaRevisi({ ...SJ, status: 'cancelled' }, [SENTUL]), /dibatalkan/);
});

ok('masukan kosong tidak melempar', () => {
  assert.doesNotThrow(() => alasanTakBisaRevisi(null, []));
  assert.doesNotThrow(() => alasanTakBisaRevisi(SJ, null));
  assert.equal(bisaRevisi(SJ, [SENTUL]), true);
  assert.equal(bisaRevisi(SJ, []), false);
});

ok('Set maupun Array sama-sama diterima', () => {
  assert.equal(alasanTakBisaRevisi(SJ, new Set([CK])), null);
});

// ---------------------------------------------------------------
console.log('§2 Hanya yang berubah yang dikirim');
// ---------------------------------------------------------------

const ASLI = [
  { product_id: 'santan', sent_qty: 500, received_qty: 450 },
  { product_id: 'beras', sent_qty: 1000, received_qty: 1000 }
];

ok('baris yang angkanya sama tidak ikut', () => {
  const { muatan } = susunMuatanRevisi(ASLI, [
    { product_id: 'santan', received_qty: 500 },
    { product_id: 'beras', received_qty: 1000 }
  ]);
  assert.equal(muatan.length, 1, 'beras tidak berubah, tidak boleh ikut');
  assert.equal(muatan[0].product_id, 'santan');
});

ok('baris yang berubah membawa received_qty saja, tanpa sent_qty', () => {
  const { muatan } = susunMuatanRevisi(ASLI, [{ product_id: 'santan', received_qty: 400 }]);
  assert.equal(muatan[0].received_qty, 400);
  assert.ok(!('sent_qty' in muatan[0]), 'sent_qty tidak boleh ikut — ia yang memotong stok CK');
});

ok('revisi jadi 0 tetap dikirim, bukan dianggap kosong', () => {
  const { muatan } = susunMuatanRevisi(ASLI, [{ product_id: 'santan', received_qty: 0 }]);
  assert.equal(muatan.length, 1);
  assert.equal(muatan[0].received_qty, 0);
});

ok('jumlah diterima kosong ditolak dengan sebab', () => {
  const { muatan, masalah } = susunMuatanRevisi(ASLI, [{ product_id: 'santan', received_qty: '' }]);
  assert.equal(muatan.length, 0);
  assert.match(masalah[0].pesan, /belum diisi/);
});

ok('jumlah minus ditolak', () => {
  const { masalah } = susunMuatanRevisi(ASLI, [{ product_id: 'santan', received_qty: -5 }]);
  assert.match(masalah[0].pesan, /minus/);
});

// ============ BARANG BARU WAJIB BER-sent_qty ============
//
// Menebaknya dari jumlah diterima akan menyamarkan susut jadi nol pada barang
// yang justru ditambahkan karena ada selisih.
ok('barang baru tanpa jumlah kirim ditolak', () => {
  const { muatan, masalah } = susunMuatanRevisi(ASLI, [{ product_id: 'gula', received_qty: 300 }]);
  assert.equal(muatan.length, 0);
  assert.match(masalah[0].pesan, /jumlah KIRIM/);
});

ok('barang baru lengkap diterima', () => {
  const { muatan } = susunMuatanRevisi(ASLI, [{ product_id: 'gula', received_qty: 300, sent_qty: 320 }]);
  assert.deepEqual(muatan, [{ product_id: 'gula', received_qty: 300, sent_qty: 320 }]);
});

ok('masukan kosong tidak melempar', () => {
  assert.doesNotThrow(() => susunMuatanRevisi());
  assert.deepEqual(susunMuatanRevisi().muatan, []);
});

// ---------------------------------------------------------------
console.log('§3 Akibat ke stok: dua outlet, aturan berbeda');
// ---------------------------------------------------------------

// ============ PEMERIKSAAN TERPENTING DI BERKAS INI ============
//
// `transfer_out` memakai `sent_qty`, yang TIDAK ikut berubah saat jumlah
// diterima dibetulkan. Kalau revisi ikut menyentuh stok CK, stok CK berkurang
// dua kali untuk satu pengiriman — tanpa galat di mana pun.
ok('ubah jumlah diterima TIDAK menyentuh stok asal', () => {
  const { muatan } = susunMuatanRevisi(ASLI, [{ product_id: 'santan', received_qty: 500 }]);
  const a = akibatStok(ASLI, muatan);
  assert.equal(a.keAsal.length, 0, 'stok CK tidak boleh bergerak');
  assert.equal(a.menyentuhAsal, false);
  assert.equal(a.keOutlet.length, 1);
  assert.equal(a.keOutlet[0].delta, 50, '450 -> 500');
});

ok('revisi turun menghasilkan delta negatif', () => {
  const { muatan } = susunMuatanRevisi(ASLI, [{ product_id: 'santan', received_qty: 400 }]);
  assert.equal(akibatStok(ASLI, muatan).keOutlet[0].delta, -50);
});

ok('tambah barang menggerakkan KEDUA outlet', () => {
  const { muatan } = susunMuatanRevisi(ASLI, [{ product_id: 'gula', received_qty: 300, sent_qty: 320 }]);
  const a = akibatStok(ASLI, muatan);
  assert.equal(a.keAsal.length, 1);
  assert.equal(a.keAsal[0].delta, -320, 'CK berkurang sebesar jumlah KIRIM');
  assert.equal(a.keOutlet[0].delta, 300, 'outlet bertambah sebesar jumlah DITERIMA');
  assert.equal(a.menyentuhAsal, true);
});

ok('barang baru yang kirimnya 0 tidak menggerakkan stok asal', () => {
  const { muatan } = susunMuatanRevisi(ASLI, [{ product_id: 'gula', received_qty: 0, sent_qty: 0 }]);
  const a = akibatStok(ASLI, muatan);
  assert.equal(a.keAsal.length, 0);
  assert.equal(a.keOutlet.length, 0);
});

ok('pesan akibat mengatakan stok asal tidak tersentuh', () => {
  const { muatan } = susunMuatanRevisi(ASLI, [{ product_id: 'santan', received_qty: 500 }]);
  const p = pesanAkibat(akibatStok(ASLI, muatan), { namaAsal: 'CK', namaTujuan: 'Sentul' });
  assert.match(p, /stok CK tidak tersentuh/);
  assert.match(p, /Sentul/);
});

ok('pesan akibat menyebut pemotongan stok asal saat ada barang baru', () => {
  const { muatan } = susunMuatanRevisi(ASLI, [{ product_id: 'gula', received_qty: 5, sent_qty: 5 }]);
  assert.match(pesanAkibat(akibatStok(ASLI, muatan), { namaAsal: 'CK' }), /memotong stok CK/);
});

ok('tanpa perubahan -> kalimatnya mengatakan begitu', () => {
  assert.match(pesanAkibat(akibatStok(ASLI, [])), /Tidak ada angka yang berubah/);
  assert.doesNotThrow(() => pesanAkibat(null));
});

// ---------------------------------------------------------------
console.log('§4 Jejak revisi: pelakunya tidak boleh hilang');
// ---------------------------------------------------------------

const NAMA = new Map([
  ['u-adhe', 'Adhe'],
  ['u-ck', 'Orang CK']
]);

const JEJAK = [
  { qty_lama: 450, qty_baru: 500, jenis: 'ubah_diterima', by: 'u-adhe', at: '2026-10-21T02:00:00Z', alasan: 'salah ketik' },
  { qty_lama: 500, qty_baru: 400, jenis: 'ubah_diterima', by: 'u-ck', at: '2026-10-21T03:00:00Z', alasan: 'dihitung ulang' }
];

ok('terbaru di atas', () => {
  const j = bacaJejak(JEJAK, NAMA);
  assert.equal(j[0].qtyBaru, 400, 'yang terakhir harus pertama');
  assert.equal(j[1].qtyBaru, 500);
});

ok('nama pelaku diterjemahkan', () => {
  assert.equal(bacaJejak(JEJAK, NAMA)[0].oleh, 'Orang CK');
});

// Jejak tanpa pelaku sama saja dengan tidak ada jejaknya.
ok('id yang tidak ketemu tidak jadi kosong', () => {
  const j = bacaJejak([{ qty_lama: 1, qty_baru: 2, by: 'u-hilang' }], NAMA);
  assert.equal(j[0].oleh, 'pengguna tak dikenal');
  assert.notEqual(j[0].oleh, '');
});

// ============ JEJAK HARUS SELAMAT DARI STAFF YANG KELUAR ============
//
// `by_nama` ditulis saat perubahan terjadi. Kalau jejak bergantung pada peta
// nama hari ini, staff yang barisnya dihapus membuat seluruh riwayatnya
// berbunyi "pengguna tak dikenal" — tepat pada catatan yang gunanya
// mempertanggungjawabkan perubahan stok.
ok('by_nama dipakai walau id-nya tidak ada di peta', () => {
  const j = bacaJejak([{ qty_lama: 1, qty_baru: 2, by: 'u-sudah-keluar', by_nama: 'Rian' }], NAMA);
  assert.equal(j[0].oleh, 'Rian');
});

ok('by_nama menang atas peta nama hari ini', () => {
  const j = bacaJejak([{ qty_lama: 1, qty_baru: 2, by: 'u-adhe', by_nama: 'Adhe (nama saat itu)' }], NAMA);
  assert.equal(j[0].oleh, 'Adhe (nama saat itu)', 'nama SAAT perubahan yang benar untuk jejak, bukan nama sekarang');
});

ok('jejak lama tanpa by_nama tetap terbaca lewat peta', () => {
  assert.equal(bacaJejak([{ qty_lama: 1, qty_baru: 2, by: 'u-adhe' }], NAMA)[0].oleh, 'Adhe');
});

ok('tanpa by sama sekali ditandai berbeda', () => {
  assert.equal(bacaJejak([{ qty_lama: 1, qty_baru: 2 }], NAMA)[0].oleh, '—');
});

ok('penambahan barang: qty_lama null tetap null, bukan 0', () => {
  const j = bacaJejak([{ qty_lama: null, qty_baru: 300, sent_qty: 320, jenis: 'tambah_barang', by: 'u-ck' }], NAMA);
  assert.equal(j[0].qtyLama, null, '0 akan terbaca sebagai "dulu nol", padahal barangnya belum ada');
  assert.equal(j[0].jenis, JENIS.TAMBAH);
  assert.equal(j[0].sentQty, 320);
});

ok('kalimat jejak membedakan tambah dari ubah', () => {
  const tambah = bacaJejak([{ qty_lama: null, qty_baru: 300, sent_qty: 320, jenis: 'tambah_barang', by: 'u-ck' }], NAMA)[0];
  const ubah = bacaJejak(JEJAK, NAMA)[0];
  assert.match(kalimatJejak(tambah), /ditambahkan 300/);
  assert.match(kalimatJejak(tambah), /kirim 320/);
  assert.match(kalimatJejak(ubah), /500 → 400/);
  assert.match(kalimatJejak(ubah), /Orang CK/);
});

ok('kalimat jejak memuat alasannya', () => {
  assert.match(kalimatJejak(bacaJejak(JEJAK, NAMA)[0]), /dihitung ulang/);
});

ok('bacaJejak tidak melempar untuk masukan kosong', () => {
  assert.doesNotThrow(() => bacaJejak(null, null));
  assert.deepEqual(bacaJejak(null, null), []);
  assert.equal(kalimatJejak(null), '');
});

ok('hitung baris yang pernah direvisi', () => {
  assert.equal(
    hitungBarisDirevisi([{ revisi: JEJAK }, { revisi: [] }, { revisi: null }, { revisi: [JEJAK[0]] }]),
    2
  );
  assert.equal(hitungBarisDirevisi(null), 0);
});

console.log('');
if (process.exitCode) console.error('Ada pemeriksaan yang GAGAL.');
else console.log(`${n} pemeriksaan revisi kiriman lolos. ✅`);
