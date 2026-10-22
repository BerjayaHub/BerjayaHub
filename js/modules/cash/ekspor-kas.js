/**
 * EKSPOR MUTASI KAS — Excel (dua kolom foto) & PDF (tabel + lampiran foto).
 *
 * Berkas ini yang mengambil data dan menggambar; aturan barisnya ada di
 * `laporan-kas.js` dan diuji tanpa database. Keduanya dipisah supaya Excel dan
 * PDF TIDAK PERNAH bisa menampilkan isi yang berbeda untuk rentang yang sama —
 * dua ekspor yang menyimpang satu baris saja cukup membuat orang berhenti
 * mempercayai keduanya.
 */
import { exportTableXLSXFoto } from '../../core/xlsx-foto.js';
import { exportTablePDF, imageToDataUrl } from '../../core/pdf.js';
import { formatRupiah } from '../../core/format.js';
import { getCashProofUrls } from './cash.service.js';
import { notaTerkaitEntriKas, itemNotaBanyak, urlFotoNotaBanyak } from '../inventory/nota.service.js';
import { susunBarisKas, keSel, KOLOM, JUDUL_FOTO_KAS, JUDUL_FOTO_NOTA, daftarLampiranFoto, pesanRingkasKas } from './laporan-kas.js';

/**
 * Ukuran foto di Excel dan di PDF SENGAJA BERBEDA.
 *
 * Excel menyimpan gambarnya utuh sebagai berkas di dalam .xlsx, jadi 220 px
 * masih wajar. PDF menanam base64 di badan dokumen — 300 foto mentah
 * menghasilkan PDF ratusan MB yang menggantungkan HP, dan gejalanya bukan
 * error melainkan peramban yang diam.
 */
const PX_EXCEL = 220;
const PX_PDF = 300;

/**
 * Ambil semua yang dibutuhkan laporan: nota yang dibayar tiap entri, baris
 * barangnya, dan dua jenis fotonya.
 *
 * @param {Array} entries baris `cash_entries` yang SUDAH tampil di layar
 */
export async function siapkanLaporanKas(entries, { maxPx = PX_EXCEL } = {}) {
  const daftar = Array.isArray(entries) ? entries : [];

  // ============ HANYA NOTA YANG DIBAYAR ENTRI ITU ============
  //
  // `notaTerkaitEntriKas` juga memulangkan nota yang ditunjuk
  // `penyesuaian_nota` — itu entri KOREKSI atas sebuah nota, bukan pembayaran.
  // Kalau barangnya ikut dibentangkan di situ, daftar barang yang sama muncul
  // dua kali di laporan dan totalnya terbaca dobel.
  const notas = await notaTerkaitEntriKas(daftar.map((e) => e.id)).catch(() => []);
  const notaPer = new Map();
  for (const n of notas) {
    if (n?.payment_entry_id) notaPer.set(n.payment_entry_id, n);
  }

  const notaIds = [...new Set([...notaPer.values()].map((n) => n.id))];
  const items = notaIds.length ? await itemNotaBanyak(notaIds).catch(() => []) : [];
  const itemPer = new Map();
  for (const it of items) {
    if (!itemPer.has(it.receipt_id)) itemPer.set(it.receipt_id, []);
    itemPer.get(it.receipt_id).push(it);
  }

  const hasil = susunBarisKas({ entries: daftar, notaPer, itemPer });

  // --- Foto: path -> data URL
  const pathKas = [...new Set(hasil.baris.map((b) => b.fotoKas).filter(Boolean))];
  const pathNota = [...new Set(hasil.baris.map((b) => b.fotoNota).filter(Boolean))];

  const [urlKas, urlNota] = await Promise.all([
    pathKas.length ? getCashProofUrls(pathKas).catch(() => new Map()) : new Map(),
    pathNota.length ? urlFotoNotaBanyak(pathNota).catch(() => new Map()) : new Map()
  ]);

  const dataUrl = new Map();
  for (const [path, url] of [...urlKas.entries(), ...urlNota.entries()]) {
    // Satu per satu, bukan `Promise.all` atas seluruhnya: 300 gambar yang
    // diunduh serentak membuat peramban di HP kehabisan memori, dan yang
    // terjadi bukan galat melainkan tab yang mati.
    //
    // `?? 'GAGAL'` — bukan null. Yang gagal dimuat HARUS bisa dibedakan dari
    // yang memang tidak berfoto, kalau tidak laporannya terbaca seperti
    // separuh entri belum difoto.
    dataUrl.set(path, (await imageToDataUrl(url, maxPx, 0.72)) ?? 'GAGAL');
  }

  return { ...hasil, dataUrl };
}

/** Kolom Excel = kolom laporan + dua kolom foto di belakang. */
function kolomExcel() {
  return [...KOLOM, { header: JUDUL_FOTO_KAS, foto: true }, { header: JUDUL_FOTO_NOTA, foto: true }];
}

export async function unduhKasExcel({ entries, judul, subjudul, namaBerkas }) {
  const lap = await siapkanLaporanKas(entries, { maxPx: PX_EXCEL });
  if (!lap.baris.length) throw new Error('Tidak ada entri kas pada rentang ini.');

  const rows = lap.baris.map((b) => [
    ...keSel(b),
    b.fotoKas ? lap.dataUrl.get(b.fotoKas) ?? 'GAGAL' : null,
    b.fotoNota ? lap.dataUrl.get(b.fotoNota) ?? 'GAGAL' : null
  ]);

  const hasil = await exportTableXLSXFoto({
    filename: namaBerkas,
    sheetName: 'Mutasi Kas',
    columns: kolomExcel(),
    rows,
    title: judul,
    subtitle: subjudul
  });
  return { ...hasil, ringkas: lap.ringkas, pesan: pesanRingkasKas(lap.ringkas) };
}

export async function unduhKasPDF({ entries, judul, subjudul, namaBerkas }) {
  const lap = await siapkanLaporanKas(entries, { maxPx: PX_PDF });
  if (!lap.baris.length) throw new Error('Tidak ada entri kas pada rentang ini.');

  // ============ PDF TIDAK MEMUAT KOLOM FOTO ============
  //
  // Fotonya ada di lampiran belakang. Kolom foto di tabel akan memaksa tiap
  // baris setinggi 34pt dan laporan 300 baris jadi 60 halaman yang hampir
  // seluruhnya ruang kosong.
  const kolomPdf = [
    { header: 'Tgl', width: 1.1 },
    { header: 'Jenis', width: 0.8 },
    { header: 'Pemegang', width: 1.4 },
    { header: 'Outlet', width: 1.2 },
    { header: 'Dibayarkan ke', width: 1.5 },
    { header: 'Keterangan', width: 2.2 },
    { header: 'Nominal', width: 1.3 },
    { header: 'Nota', width: 1.1 },
    { header: 'Barang', width: 1.8 },
    { header: 'Qty', width: 0.7 },
    { header: 'Subtotal', width: 1.2 }
  ];

  const rows = lap.baris.map((b) => [
    b.tanggal,
    b.jenis,
    b.pemegang,
    b.outlet,
    b.penerima,
    b.keterangan,
    b.nominal === null ? '' : formatRupiah(b.nominal),
    b.noNota,
    b.barang,
    b.qty === null ? '' : String(b.qty),
    b.subtotal === null ? '' : formatRupiah(b.subtotal)
  ]);

  const lampiran = daftarLampiranFoto(lap)
    .map((f) => ({ penanda: f.penanda, dataUrl: lap.dataUrl.get(f.path) }))
    // 'GAGAL' bukan data URL — kalau diteruskan, `addImage` melempar untuk
    // tiap halaman lampiran dan yang tercetak cuma deretan "(foto gagal)".
    .filter((f) => f.dataUrl && f.dataUrl !== 'GAGAL');

  await exportTablePDF({
    title: judul,
    subtitle: `${subjudul} · ${pesanRingkasKas(lap.ringkas)}`,
    columns: kolomPdf,
    rows,
    filename: namaBerkas,
    orientation: 'landscape',
    lampiranFoto: lampiran
  });

  return { ringkas: lap.ringkas, lampiran: lampiran.length, pesan: pesanRingkasKas(lap.ringkas) };
}
