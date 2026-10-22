/**
 * TES MURNI: baris laporan Mutasi Kas dengan rincian nota.
 *
 * Yang dijaga di sini semuanya berbentuk sama: angka yang benar di tempat yang
 * salah.
 *
 *   nominal ditulis di tiap baris barang -> total delapan kali lipat
 *   entri non-nota disaring keluar       -> total tidak cocok dengan saldo
 *   entri dicoret ikut menjumlah         -> koreksi tidak pernah berlaku
 *   entri dicoret dihapus dari laporan   -> bukti koreksinya hilang
 */
import assert from 'node:assert/strict';
import {
  susunBarisKas,
  keSel,
  KOLOM,
  SEBAB_NOL,
  pesanRingkasKas,
  daftarLampiranFoto
} from '../js/modules/cash/laporan-kas.js';

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

const ENTRIES = [
  {
    id: 'e1',
    entry_date: '2026-10-01',
    entry_type: 'out',
    amount: 500000,
    notes: 'Belanja sayur',
    supplier: 'UD Makmur',
    proof_path: 'cash/e1.jpg',
    holder: { full_name: 'Budi' },
    outlets: { name: 'Dago' },
    cash_categories: { name: 'Bahan' }
  },
  {
    id: 'e2',
    entry_date: '2026-10-02',
    entry_type: 'out',
    amount: 150000,
    notes: 'Token listrik',
    supplier: 'PLN',
    proof_path: 'cash/e2.jpg',
    holder: { full_name: 'Budi' },
    outlets: { name: 'Dago' },
    cash_categories: { name: 'Operasional' }
  },
  {
    id: 'e3',
    entry_date: '2026-10-03',
    entry_type: 'out',
    amount: 90000,
    notes: 'Salah input',
    proof_path: '',
    dicoret_at: '2026-10-04T02:00:00Z',
    alasan_coret: 'dobel',
    holder: { full_name: 'Ani' },
    outlets: { name: 'Gading' },
    cash_categories: { name: 'Bahan' }
  },
  {
    id: 'e4',
    entry_date: '2026-10-05',
    entry_type: 'in',
    amount: 2000000,
    notes: 'Setor modal',
    proof_path: 'cash/e4.jpg',
    holder: { full_name: 'Ani' },
    outlets: { name: 'Gading' },
    cash_categories: { name: 'Modal' }
  }
];

const NOTA_PER = new Map([['e1', { id: 'n1', code: 'NT-001', photo_path: 'nota/n1.jpg' }]]);
const ITEM_PER = new Map([
  [
    'n1',
    [
      { qty: 3, unit_cost: 100000, line_total: 300000, products: { name: 'Bayam', base_unit: 'kg' } },
      { qty: 2, unit_cost: 100000, line_total: 200000, products: { name: 'Tomat', base_unit: 'kg' } }
    ]
  ]
]);

const H = susunBarisKas({ entries: ENTRIES, notaPer: NOTA_PER, itemPer: ITEM_PER });

// ---------------------------------------------------------------
console.log('§1 Entri bernota jadi banyak baris, entri lain tetap satu');
// ---------------------------------------------------------------

ok('nota 2 barang -> 2 baris; tiga entri lain 1 baris masing-masing', () => {
  assert.equal(H.baris.length, 5);
});

ok('entri non-nota IKUT, kolom barangnya kosong', () => {
  const pln = H.baris.find((b) => b.entryId === 'e2');
  assert.ok(pln, 'entri non-nota tidak boleh hilang — totalnya harus cocok dengan Mutasi Kas');
  assert.equal(pln.barang, '');
  assert.equal(pln.sebabKosong, SEBAB_NOL.BUKAN_NOTA);
});

ok('baris barang membawa nama, qty, satuan, dan subtotal', () => {
  const bayam = H.baris.find((b) => b.barang === 'Bayam');
  assert.equal(bayam.qty, 3);
  assert.equal(bayam.satuan, 'kg');
  assert.equal(bayam.subtotal, 300000);
  assert.equal(bayam.noNota, 'NT-001');
});

// ============ INI PEMERIKSAAN YANG PALING PENTING DI BERKAS INI ============
//
// Delapan barang × nominal yang sama = total delapan kali lipat. Dan karena
// kolomnya bernama "Nominal", ia PASTI dijumlahkan orang.
ok('nominal hanya di baris PERTAMA tiap nota', () => {
  const barisNota = H.baris.filter((b) => b.entryId === 'e1');
  assert.equal(barisNota.length, 2);
  assert.equal(barisNota[0].nominal, 500000);
  assert.equal(barisNota[1].nominal, null, 'baris kedua harus kosong, bukan 500000');
});

ok('jumlah kolom Nominal = jumlah nominal entri, bukan kelipatannya', () => {
  const total = H.baris.reduce((a, b) => a + (b.nominal ?? 0), 0);
  // 500000 + 150000 + 0 (dicoret) + 2000000
  assert.equal(total, 2650000);
});

ok('foto juga hanya di baris pertama — tidak disisipkan dua kali', () => {
  const barisNota = H.baris.filter((b) => b.entryId === 'e1');
  assert.equal(barisNota[0].fotoNota, 'nota/n1.jpg');
  assert.equal(barisNota[1].fotoNota, null);
});

// ---------------------------------------------------------------
console.log('§2 Entri dicoret: nol, tapi tetap terlihat');
// ---------------------------------------------------------------

ok('yang dicoret tidak hilang dari laporan', () => {
  const c = H.baris.find((b) => b.entryId === 'e3');
  assert.ok(c, 'menghapusnya berarti bukti koreksinya ikut hilang');
});

ok('nominalnya nol, tapi nominal aslinya tetap tercatat', () => {
  const c = H.baris.find((b) => b.entryId === 'e3');
  assert.equal(c.nominal, 0);
  assert.equal(c.nominalAsli, 90000);
});

ok('statusnya menyebut DICORET beserta alasannya', () => {
  const c = H.baris.find((b) => b.entryId === 'e3');
  assert.match(c.status, /DICORET/);
  assert.match(c.status, /dobel/);
});

ok('total keluar TIDAK memuat yang dicoret', () => {
  assert.equal(H.ringkas.totalKeluar, 650000, '500000 + 150000, tanpa 90000 yang dicoret');
  assert.equal(H.ringkas.totalMasuk, 2000000);
});

// ---------------------------------------------------------------
console.log('§3 Nota tanpa rincian dibedakan dari entri non-nota');
// ---------------------------------------------------------------

ok('nota yang belum ada barisnya punya sebab sendiri', () => {
  const h = susunBarisKas({
    entries: [{ id: 'x', entry_date: '2026-10-09', entry_type: 'out', amount: 1000, holder: {}, outlets: {} }],
    notaPer: new Map([['x', { id: 'nx', code: 'NT-9', photo_path: null }]]),
    itemPer: new Map()
  });
  assert.equal(h.baris[0].sebabKosong, SEBAB_NOL.NOTA_TANPA_BARIS);
  assert.notEqual(h.baris[0].sebabKosong, SEBAB_NOL.BUKAN_NOTA, 'keduanya butuh tindakan yang berbeda');
  assert.equal(h.ringkas.notaTanpaBaris, 1);
});

// ---------------------------------------------------------------
console.log('§4 Bentuk sel & kolom tidak boleh menyimpang');
// ---------------------------------------------------------------

ok('jumlah sel sama dengan jumlah kolom', () => {
  for (const b of H.baris) assert.equal(keSel(b).length, KOLOM.length);
});

ok('kolom angka benar-benar berisi angka atau null, bukan string', () => {
  for (const b of H.baris) {
    const sel = keSel(b);
    KOLOM.forEach((k, i) => {
      if (!k.numeric) return;
      assert.ok(sel[i] === null || typeof sel[i] === 'number', `kolom ${k.header} berisi ${typeof sel[i]}`);
    });
  }
});

// ---------------------------------------------------------------
console.log('§5 Lampiran foto: tanpa duplikat, dengan penanda');
// ---------------------------------------------------------------

ok('dua jenis foto ikut, dan masing-masing bertanda asalnya', () => {
  const l = daftarLampiranFoto(H);
  const path = l.map((x) => x.path);
  assert.ok(path.includes('cash/e1.jpg'));
  assert.ok(path.includes('nota/n1.jpg'));
  assert.match(l.find((x) => x.path === 'nota/n1.jpg').penanda, /nota NT-001/);
});

ok('entri tanpa foto tidak menghasilkan lampiran kosong', () => {
  const l = daftarLampiranFoto(H);
  assert.ok(!l.some((x) => !x.path));
  // e1 bukti kas + e1 foto nota + e2 bukti + e4 bukti = 4.
  // e3 (`proof_path: ''`) TIDAK menyumbang apa pun — itu yang diuji di sini.
  assert.equal(l.length, 4);
  assert.ok(!l.some((x) => x.penanda.includes('Ani') && x.penanda.includes('10-03')), 'e3 tanpa foto tidak boleh muncul');
});

ok('path yang sama tidak dilampirkan dua kali', () => {
  const h = susunBarisKas({
    entries: [
      { id: 'a', entry_date: '2026-10-01', entry_type: 'out', amount: 1, proof_path: 'sama.jpg', holder: {}, outlets: {} },
      { id: 'b', entry_date: '2026-10-02', entry_type: 'out', amount: 1, proof_path: 'sama.jpg', holder: {}, outlets: {} }
    ],
    notaPer: new Map(),
    itemPer: new Map()
  });
  assert.equal(daftarLampiranFoto(h).length, 1);
});

ok('daftarLampiranFoto tidak melempar untuk masukan kosong', () => {
  assert.doesNotThrow(() => daftarLampiranFoto(null));
  assert.deepEqual(daftarLampiranFoto(null), []);
});

// ---------------------------------------------------------------
console.log('§6 Ringkasan menyebut yang kurang, bukan mendiamkannya');
// ---------------------------------------------------------------

ok('ringkasan menyebut entri dicoret & yang tanpa foto', () => {
  const p = pesanRingkasKas(H.ringkas);
  assert.match(p, /dicoret/);
  assert.match(p, /tanpa foto bukti/);
});

ok('rentang kosong punya kalimatnya sendiri', () => {
  assert.match(pesanRingkasKas({ jumlahEntri: 0 }), /Tidak ada entri/);
  assert.match(pesanRingkasKas(null), /Tidak ada entri/);
});

ok('masukan kosong tidak melempar', () => {
  assert.doesNotThrow(() => susunBarisKas());
  assert.deepEqual(susunBarisKas().baris, []);
  assert.doesNotThrow(() => susunBarisKas({ entries: ENTRIES }));
});

console.log('');
if (process.exitCode) console.error('Ada pemeriksaan yang GAGAL.');
else console.log(`${n} pemeriksaan laporan kas lolos. ✅`);
