/**
 * SABOTASE: Laporan Laba Rugi Outlet + perbaikan COGS.
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Laporan ini menjawab "outlet ini untung atau rugi" — dan jawabannya dipakai
 * memutuskan hal yang mahal. Seluruh cara ia salah menghasilkan angka yang
 * terlihat masuk akal, tercetak rapi, dan tidak memicu galat di mana pun.
 *
 * Yang paling berbahaya: kesalahan yang membuat laba terlihat LEBIH BESAR.
 * Laporan yang mengatakan untung tidak akan dipertanyakan siapa pun.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MOD = 'js/modules/report/laba-rugi-outlet.js';
const SVC = 'js/modules/report/report.service.js';
const PAGE = 'js/modules/report/report.admin.page.js';

const BERKAS = [MOD, SVC, PAGE];
const asli = new Map();
for (const rel of BERKAS) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

const PENANDA = path.join(AKAR, 'tools/.sabotase-aktif');
const tandai = (rel) => fs.writeFileSync(PENANDA, `${path.basename(process.argv[1])} merusak ${rel}\n`);
const lepasTanda = () => {
  try {
    fs.unlinkSync(PENANDA);
  } catch {
    /* belum pernah ada — tidak apa-apa */
  }
};

const pulih = () => {
  if (process.env.SABOTASE_PERIKSA_POLA) return lepasTanda();
  for (const [rel, isi] of asli) fs.writeFileSync(P(rel), isi);
  lepasTanda();
};
process.on('exit', pulih);
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

const jalan = (cmd) => {
  try {
    execFileSync('node', [cmd], { cwd: AKAR, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};

let gagal = 0;
const sabotase = (nama, rel, dari, ke, pemeriksa) => {
  if (!fs.existsSync(P(pemeriksa))) {
    gagal++;
    console.error(`❌ PEMERIKSANYA TIDAK ADA: ${pemeriksa} — "tertangkap" di sini tidak berarti apa-apa.`);
    return;
  }
  const isi = asli.get(rel);
  const rusak = isi.replace(dari, ke);
  if (rusak === isi) {
    gagal++;
    console.error(`❌ SABOTASE TIDAK TERPASANG: ${nama} — polanya tidak ketemu di ${rel}.`);
    return;
  }
  if (typeof dari === 'string' && isi.split(dari).length > 2) {
    gagal++;
    console.error(`❌ POLANYA MUNCUL >1 KALI: ${nama} di ${rel} — sabotasenya cuma mengenai yang pertama.`);
    return;
  }
  if (process.env.SABOTASE_PERIKSA_POLA) {
    console.log(`   ✔ pola terpasang: ${nama}`);
    return;
  }
  tandai(rel);
  fs.writeFileSync(P(rel), rusak);
  const hijau = jalan(pemeriksa);
  pulih();
  if (hijau) {
    gagal++;
    console.error(`❌ LOLOS: ${nama}\n   ${pemeriksa} tetap hijau padahal ${rel} sudah dirusak.`);
  } else {
    console.log(`   ✔ tertangkap: ${nama}`);
  }
};

const AUDIT = 'tools/audit-laba-rugi-outlet.cjs';
const MURNI = 'tools/test-laba-rugi-outlet.mjs';

// =====================================================================
console.log('SABOTASE RUMUS — yang membuat laba terlihat lebih besar:');
// =====================================================================

// ============ BUG YANG BARU DIPERBAIKI, DIPASANG KEMBALI ============
//
// Ini bukan kerusakan hipotetis: persis inilah yang terjadi di laporan COGS
// sebelum sesi ini. Dua pemeriksa harus menangkapnya.
sabotase(
  'kiriman CK dicabut dari barang masuk — HPP jauh lebih kecil, laba terlihat besar',
  MOD,
  '  const masuk = ck + sup;',
  '  const masuk = sup;',
  MURNI
);
sabotase(
  'kiriman CK dicabut dari barang masuk — DAN auditnya harus ikut merah',
  MOD,
  '  const masuk = ck + sup;',
  '  const masuk = sup;',
  AUDIT
);

sabotase(
  'rumus HPP dibalik — stok akhir ditambah, bukan dikurangi',
  MOD,
  '  const hpp = awal + masuk - keluar - akhir;',
  '  const hpp = awal + masuk - keluar + akhir;',
  MURNI
);

// ============ SABOTASE TERPENTING DI BERKAS INI ============
//
// Ini keadaan laporannya SEBELUM diperbaiki: barang yang DIKIRIM Central
// Kitchen terhitung sebagai barang yang DIPAKAI, dan kiriman internal
// terhitung dua kali di total BU. Gejalanya food cost CK 884,7% — terlihat di
// berkas Excel sungguhan sebelum ini dibetulkan.
sabotase(
  'barang keluar tidak dikurangkan — kiriman internal terhitung DUA KALI',
  MOD,
  '  const hpp = awal + masuk - keluar - akhir;',
  '  const hpp = awal + masuk - akhir;',
  MURNI
);
sabotase(
  'barang keluar tidak dikurangkan — DAN auditnya harus ikut merah',
  MOD,
  '  const hpp = awal + masuk - keluar - akhir;',
  '  const hpp = awal + masuk - akhir;',
  AUDIT
);

// ============ SUSUT PERJALANAN TIDAK BOLEH LENYAP ============
//
// `keluar` dinilai qty DITERIMA. Memakai nilai lain membuat barang yang hilang
// di jalan tidak muncul sebagai beban siapa pun.
sabotase(
  'barang keluar dinilai nol — susut perjalanan lenyap dari laporan',
  MOD,
  '  const keluar = num(keluarKiriman.nilai);',
  '  const keluar = 0;',
  MURNI
);

sabotase(
  'biaya non-bahan tidak dikurangkan — laba bersih sama dengan laba kotor',
  MOD,
  '  const labaBersih = labaKotor - biaya;',
  '  const labaBersih = labaKotor;',
  MURNI
);

sabotase(
  'HPP minus dipotong ke nol — tanda bahwa ada dokumen belum dicatat hilang',
  MOD,
  '  const hpp = awal + masuk - keluar - akhir;',
  '  const hpp = Math.max(0, awal + masuk - keluar - akhir);',
  MURNI
);

sabotase(
  'catatan HPP minus dicabut — angkanya terbaca sebagai untung luar biasa',
  MOD,
  "  if (hpp < 0) c.push('HPP minus — ada barang masuk yang belum tercatat');",
  '  /* dibuang */',
  MURNI
);

// ============ PEMBAGIAN NOL ============
sabotase(
  'food cost dibagi tanpa menjaga penyebut nol — Infinity% atau 0%, dua-duanya bohong',
  MOD,
  'const bagi = (a, b) => (num(b) === 0 ? null : num(a) / num(b));',
  'const bagi = (a, b) => num(a) / num(b);',
  MURNI
);

sabotase(
  "persen tidak lagi memulangkan '—' untuk nilai tak terdefinisi",
  MOD,
  "  if (n === null) return '—';",
  '  if (n === null) return `0.0%`;',
  MURNI
);

sabotase(
  'bahan tanpa HPP tidak lagi dihitung — nilainya diam-diam nol',
  MOD,
  '  const tanpaHpp = num(stokAwal.tanpaHpp) + num(stokAkhir.tanpaHpp) + num(masukCk.tanpaHpp) + num(keluarKiriman.tanpaHpp);',
  '  const tanpaHpp = 0;',
  MURNI
);

sabotase(
  'CK dan supplier dilebur — tidak tahu harus memeriksa nota atau order',
  MOD,
  '    nilaiCk: ck,\n    nilaiSupplier: sup,',
  '    nilaiCk: ck + sup,\n    nilaiSupplier: 0,',
  MURNI
);

sabotase(
  'total laba kotor dihitung dari jumlah baris, bukan dari total omzet & HPP',
  MOD,
  '  const labaKotor = omzet - hpp;\n  const biaya = jumlah(\'biayaNonBahan\');',
  "  const labaKotor = jumlah('labaKotor') + 1;\n  const biaya = jumlah('biayaNonBahan');",
  MURNI
);

sabotase(
  'rekap per bahan tidak lagi diurutkan dari nilai terbesar',
  MOD,
  '    .sort((a, b) => b.nilaiTotal - a.nilaiTotal || String(a.nama).localeCompare(String(b.nama)));',
  '    .sort((a, b) => String(a.nama).localeCompare(String(b.nama)));',
  MURNI
);

sabotase(
  'rekap per bahan tidak lagi memisah kolom CK & supplier',
  MOD,
  '    b.qtyCk += num(r?.qty);\n    b.nilaiCk += num(r?.nilai);',
  '    b.qtySupplier += num(r?.qty);\n    b.nilaiSupplier += num(r?.nilai);',
  MURNI
);

// =====================================================================
console.log('\nSABOTASE PERBAIKAN COGS:');
// =====================================================================

sabotase(
  'nilai kiriman masuk tidak lagi ditambahkan — bug lamanya kembali',
  SVC,
  '    pembelian.set(oid, (pembelian.get(oid) ?? 0) + k.nilai);',
  '    /* dibuang */',
  AUDIT
);

sabotase(
  'nilai kiriman KELUAR tidak dikurangkan di COGS — CK menghitung kirimannya sebagai pemakaian',
  SVC,
  '    pembelian.set(oid, (pembelian.get(oid) ?? 0) - k.nilai);',
  '    /* dibuang */',
  AUDIT
);

sabotase(
  'kiriman cuma dihitung satu sisi — sisi keluarnya hilang',
  SVC,
  "    tambah(keluar, b.dispatches?.from_outlet_id, nilai, adaHpp);",
  '    /* dibuang */',
  AUDIT
);

sabotase(
  'kiriman disaring per outlet DI SERVER — sisi keluar outlet terpilih terbuang',
  SVC,
  "      .lte('dispatches.received_at', isoTo(to));\n    return q.range(dari, sampai);",
  "      .lte('dispatches.received_at', isoTo(to));\n    if (outletId) q = q.eq('dispatches.to_outlet_id', outletId);\n    return q.range(dari, sampai);",
  AUDIT
);

sabotase(
  'laporan Laba Rugi tidak lagi mengirim nilai barang keluar',
  SVC,
  '      keluarKiriman: kirimanDua.keluar.get(o.id) ?? kosong,',
  '      /* dibuang */',
  AUDIT
);

sabotase(
  'kiriman yang masih di jalan ikut dihitung — barang masuk lebih besar dari stoknya',
  SVC,
  `to_outlet_id, status, received_at, business_unit_id)', {
        count: 'exact'
      })
      .eq('dispatches.business_unit_id', businessUnitId)
      .eq('dispatches.status', 'received')
      .gte('dispatches.received_at', isoFrom(from))
      .lte('dispatches.received_at', isoTo(to));`,
  `to_outlet_id, status, received_at, business_unit_id)', {
        count: 'exact'
      })
      .eq('dispatches.business_unit_id', businessUnitId)
      .gte('dispatches.received_at', isoFrom(from))
      .lte('dispatches.received_at', isoTo(to));`,
  AUDIT
);

sabotase(
  'kiriman dihitung per tanggal KIRIM — dua bulan salah sekaligus',
  SVC,
  `to_outlet_id, status, received_at, business_unit_id)', {
        count: 'exact'
      })
      .eq('dispatches.business_unit_id', businessUnitId)
      .eq('dispatches.status', 'received')
      .gte('dispatches.received_at', isoFrom(from))
      .lte('dispatches.received_at', isoTo(to));`,
  `to_outlet_id, status, received_at, business_unit_id)', {
        count: 'exact'
      })
      .eq('dispatches.business_unit_id', businessUnitId)
      .eq('dispatches.status', 'received')
      .gte('dispatches.created_at', isoFrom(from))
      .lte('dispatches.created_at', isoTo(to));`,
  AUDIT
);

sabotase(
  'catatan bahwa angka COGS BERUBAH dicabut — rekap lama jadi tak terjelaskan',
  SVC,
  "      'PENTING: sejak perbaikan ini, kolom Masuk − Keluar memuat kiriman antar-outlet di KEDUA arah, bukan hanya ' +",
  "      '' +",
  AUDIT
);

sabotase(
  'bahan tanpa HPP pada kiriman tidak lagi dihitung terpisah',
  SVC,
  '    else kini.tanpaHpp += 1;',
  '    /* dibuang */',
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE LAPORAN BARU:');
// =====================================================================

sabotase(
  'nota yang DIBATALKAN ikut dihitung — barang yang sudah ditarik menaikkan HPP',
  SVC,
  "    if (nRow.status === 'dibatalkan') continue;",
  '    /* dibuang */',
  AUDIT
);

sabotase(
  'baris bahan milik nota batal ikut rekap — dua bagian laporan jadi tidak sejalan',
  SVC,
  '    if (!notaDipakai.has(it.receipt_id)) continue;',
  '    /* dibuang */',
  AUDIT
);

sabotase(
  'entri kas yang DICORET ikut jadi biaya — laporan berbeda dari layar Kas',
  SVC,
  '    if (e.dicoret_at) continue;',
  '    /* dibuang */',
  AUDIT
);

sabotase(
  'pembayaran nota bahan ikut jadi biaya operasional — terhitung DUA KALI',
  SVC,
  '    if (!selainBahan(e)) continue;',
  '    /* dibuang */',
  AUDIT
);

sabotase(
  '`untuk_nota` tidak ikut diambil — SELURUH pembayaran nota terhitung "selain bahan"',
  SVC,
  ".select('id, entry_type, untuk_nota, penyesuaian_nota, amount, dicoret_at, notes, entry_date, outlet_id, cash_categories(name), outlets!outlet_id(business_unit_id)', {",
  ".select('id, entry_type, penyesuaian_nota, amount, dicoret_at, notes, entry_date, outlet_id, cash_categories(name), outlets!outlet_id(business_unit_id)', {",
  AUDIT
);

sabotase(
  'stok awal diambil dari hari pertama periode — barang masuk hari itu terhitung dua kali',
  SVC,
  '  const sebelum = new Date(`${from}T00:00:00`);\n  sebelum.setDate(sebelum.getDate() - 1);\n  const hariSebelum = dateKey(sebelum);\n\n  let salesQ',
  '  const sebelum = new Date(`${from}T00:00:00`);\n  const hariSebelum = dateKey(sebelum);\n\n  let salesQ',
  AUDIT
);

sabotase(
  'rincian digambar juga di tingkat BU — belasan halaman yang tidak dibaca siapa pun',
  SVC,
  '  if (outletId && baris.length === 1) {',
  '  if (true) {',
  AUDIT
);

sabotase(
  'laporan dicabut dari katalog — fungsinya ada dan tidak bisa dipilih siapa pun',
  SVC,
  "    key: 'laba_rugi_outlet',",
  "    key: 'laba_rugi_outlet_x',",
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE HALAMAN LAPORAN:');
// =====================================================================

sabotase(
  'bagian rincian tidak digambar — dihitung, lalu tidak ditampilkan',
  PAGE,
  '      (data.bagian ?? [])',
  '      []',
  AUDIT
);

sabotase(
  'rincian tidak lagi jadi sheet terpisah — kolom berbeda bertabrakan di satu sheet',
  PAGE,
  '        await exportSheetsXLSX({',
  '        await exportTableXLSX({',
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS / tidak terpasang.`);
process.exit(gagal === 0 ? 0 : 1);
