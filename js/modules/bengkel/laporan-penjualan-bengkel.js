/**
 * LAPORAN PENJUALAN BENGKEL — gabungan Turboly & korporat.
 *
 * Murni: tidak menyentuh DOM, tidak menyentuh Supabase.
 *
 * ============ SATU ANGKA YANG TIDAK BOLEH DIBUAT ============
 *
 * "Laba kotor" tunggal yang menjumlahkan semua baris. Sebagian baris korporat
 * tidak diketahui modalnya, dan baris jasa memang tidak punya modal barang.
 * Menjumlahkan ketiganya menghasilkan satu angka yang terlihat pasti dan
 * tidak bisa dipertanggungjawabkan — dan ia akan dibawa ke rapat.
 *
 * Maka laporan ini selalu memisahkan:
 *
 *   omzet sparepart  vs  omzet jasa
 *   modal YANG DIKETAHUI (baris bermodal saja)
 *   laba = omzet baris bermodal − modalnya  (bukan seluruh omzet − modal)
 *   dan BERAPA BARIS yang belum bermodal, beserta nilainya
 *
 * Tanpa angka terakhir itu, laba yang tampil terlihat seperti laba seluruh
 * periode, padahal ia cuma laba dari sebagian baris.
 */

const teks = (v) => (v === null || v === undefined ? '' : String(v));
const angka = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const bulat = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const SUMBER = { TURBOLY: 'turboly', KORPORAT: 'korporat' };

/** Ringkasan satu kumpulan baris. Dipakai laporan, pratinjau impor, dan ekspor. */
export function ringkasPenjualan(baris) {
  const r = {
    baris: 0,
    invoice: 0,
    omzet: 0,
    omzetSparepart: 0,
    omzetJasa: 0,
    // Modal & laba HANYA dari baris yang modalnya diketahui.
    modal: 0,
    laba: 0,
    omzetBermodal: 0,
    tanpaModal: 0,
    omzetTanpaModal: 0,
    tanpaNopol: 0,
    dariTurboly: 0,
    dariKorporat: 0,
    qtySparepart: 0
  };
  const invoice = new Set();
  for (const b of Array.isArray(baris) ? baris : []) {
    r.baris += 1;
    if (b?.invoice_no) invoice.add(b.invoice_no);
    const total = Number(b?.total) || 0;
    const sparepart = teks(b?.item_type) === 'sparepart';
    r.omzet += total;
    if (teks(b?.sumber) === SUMBER.KORPORAT) r.dariKorporat += 1;
    else r.dariTurboly += 1;
    if (!teks(b?.nopol).trim()) r.tanpaNopol += 1;

    if (sparepart) {
      r.omzetSparepart += total;
      r.qtySparepart += Number(b?.qty) || 0;
      const modal = angka(b?.modal);
      if (modal === null) {
        r.tanpaModal += 1;
        r.omzetTanpaModal += total;
      } else {
        r.modal += modal;
        r.omzetBermodal += total;
      }
    } else {
      r.omzetJasa += total;
    }
  }
  r.invoice = invoice.size;
  r.laba = bulat(r.omzetBermodal - r.modal);
  for (const k of ['omzet', 'omzetSparepart', 'omzetJasa', 'modal', 'omzetBermodal', 'omzetTanpaModal']) r[k] = bulat(r[k]);
  // Margin dihitung dari omzet YANG BERMODAL, bukan dari seluruh omzet —
  // kalau tidak, makin banyak baris tanpa modal, makin kecil marginnya
  // terlihat tanpa ada yang benar-benar berubah.
  r.margin = r.omzetBermodal > 0 ? bulat((r.laba / r.omzetBermodal) * 100) : null;
  return r;
}

/**
 * Kalimat peringatan yang HARUS ikut ke mana pun angkanya dibawa.
 *
 * Dikembalikan sebagai larik, bukan satu string: layar menampilkannya
 * berwarna, ekspor Excel menaruhnya di subjudul, dan keduanya tidak boleh
 * menyusun kalimatnya sendiri-sendiri — dua tempat yang mengarang kalimat
 * untuk angka yang sama pasti menyimpang.
 */
export function catatanLaporan(r) {
  const out = [];
  if (!r) return out;
  if (r.tanpaModal > 0) {
    out.push(
      `${r.tanpaModal} baris sparepart belum diketahui modalnya (omzet ${rupiah(r.omzetTanpaModal)}) — ` +
        'laba di atas BELUM memperhitungkannya.'
    );
  }
  if (r.omzetJasa > 0) {
    out.push(`Jasa ${rupiah(r.omzetJasa)} tidak punya modal barang, jadi tidak ikut dihitung sebagai laba.`);
  }
  if (r.tanpaNopol > 0) out.push(`${r.tanpaNopol} baris tanpa nopol (penjualan langsung atau belum diisi).`);
  return out;
}

/** Kelompokkan per kunci, dengan ringkasan tiap kelompok. */
export function kelompok(baris, ambilKunci, label = (k) => k) {
  const peta = new Map();
  for (const b of Array.isArray(baris) ? baris : []) {
    const k = teks(ambilKunci(b)).trim() || '(kosong)';
    if (!peta.has(k)) peta.set(k, []);
    peta.get(k).push(b);
  }
  return [...peta.entries()]
    .map(([k, isi]) => ({ kunci: k, label: label(k, isi), ...ringkasPenjualan(isi) }))
    // Diurutkan omzet TERBESAR dulu: yang dibaca lebih dulu harus yang
    // paling berpengaruh, bukan yang kebetulan paling awal abjadnya.
    .sort((a, b) => b.omzet - a.omzet || a.kunci.localeCompare(b.kunci, 'id'));
}

/**
 * Laporan lengkap satu periode.
 *
 * @param {{baris: Array, periode: {dari, sampai, outlet}}} o
 */
export function susunLaporanBengkel({ baris = [], periode = {} } = {}) {
  const ringkas = ringkasPenjualan(baris);
  const sparepart = baris.filter((b) => teks(b?.item_type) === 'sparepart');

  const rentang = [teks(periode.dari), teks(periode.sampai)].filter(Boolean).join(' s/d ');
  const subjudul = [
    teks(periode.outlet) || 'Semua outlet',
    rentang,
    `${ringkas.invoice} invoice · ${ringkas.baris} baris`,
    `Omzet ${rupiah(ringkas.omzet)}`,
    `Laba sparepart ${rupiah(ringkas.laba)}${ringkas.margin === null ? '' : ` (${ringkas.margin}%)`}`,
    ...catatanLaporan(ringkas)
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    judul: 'Penjualan Bengkel (Rinci)',
    subjudul,
    ringkas,
    catatan: catatanLaporan(ringkas),
    perOutlet: kelompok(baris, (b) => b.outlet_nama),
    perSumber: kelompok(baris, (b) => (teks(b.sumber) === SUMBER.KORPORAT ? 'Korporat' : 'Turboly')),
    // Nopol & SKU HANYA dari baris sparepart: "nopol mana memakai part apa"
    // adalah pertanyaan tentang barang, dan mencampur jasa ke dalamnya
    // membuat peringkatnya didominasi biaya jasa.
    perNopol: kelompok(sparepart, (b) => b.nopol),
    perSku: kelompok(sparepart, (b) => b.sku || b.nama, (k, isi) => `${k} — ${teks(isi[0]?.nama)}`),
    namaBerkas: `penjualan-bengkel-${(rentang || 'semua').replace(/[^\w.-]+/g, '-')}`
  };
}

/** Rp tanpa desimal — dipakai di kalimat, bukan di kolom angka Excel. */
export function rupiah(n) {
  const x = Number(n) || 0;
  return 'Rp' + Math.round(x).toLocaleString('id-ID');
}
