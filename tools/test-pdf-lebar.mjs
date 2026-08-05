// Uji perhitungan lebar kolom exportTablePDF: sel gambar tidak boleh melebihi
// kolomnya, karena kolom terakhir yang jebol akan menembus tepi kertas — dan
// itu baru terlihat setelah PDF-nya dibuka orang lain.
const KERTAS = { portrait: 595.28, landscape: 841.89 };
const M = 32;

function lebarKolom(columns, orientation) {
  const total = KERTAS[orientation] - M * 2;
  const w = columns.map((c) => c.width ?? 1);
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => (x / sum) * total);
}

const kasus = [
  {
    nama: 'Riwayat Kas (tanpa kantong)',
    orientation: 'portrait',
    columns: [
      { header: 'Tanggal', width: 0.9 }, { header: 'Keterangan', width: 2 },
      { header: 'Jenis', width: 0.9 }, { header: 'Outlet', width: 1.1 },
      { header: 'Jumlah', width: 0.8 }, { header: 'Nominal', width: 1.2 },
      { header: 'Nota', width: 1 }
    ],
    gambar: { kolom: 6, w: 46 }
  },
  {
    nama: 'Riwayat Kas (dengan kantong)',
    orientation: 'portrait',
    columns: [
      { header: 'Tanggal', width: 0.9 }, { header: 'Keterangan', width: 2 },
      { header: 'Jenis', width: 0.9 }, { header: 'Kantong', width: 1 },
      { header: 'Outlet', width: 1.1 }, { header: 'Jumlah', width: 0.8 },
      { header: 'Nominal', width: 1.2 }, { header: 'Nota', width: 1 }
    ],
    gambar: { kolom: 7, w: 46 }
  }
];

let gagal = 0;
for (const k of kasus) {
  const colW = lebarKolom(k.columns, k.orientation);
  const muat = k.gambar.w <= colW[k.gambar.kolom] - 4;
  console.log(`${muat ? '✓' : '✗'} ${k.nama}: kolom ${k.columns[k.gambar.kolom].header} = ${colW[k.gambar.kolom].toFixed(1)}pt, gambar ${k.gambar.w}pt`);
  if (!muat) gagal++;
  // Kolom tersempit harus tetap cukup untuk beberapa karakter.
  const sempit = Math.min(...colW);
  if (sempit < 24) { console.log(`  ✗ ada kolom terlalu sempit: ${sempit.toFixed(1)}pt`); gagal++; }
}
if (gagal) { console.error(`\n${gagal} masalah tata letak PDF.`); process.exit(1); }
console.log('\nTata letak kolom PDF riwayat kas aman. ✅');
