/**
 * REKAP BARANG TERKIRIM — dua bentuk, satu sumber.
 *
 *   "buatkan keduanya, agar admin bisa bebas memilih sesuai kebutuhan
 *    per baris barang atau rekap per barang"
 *
 * ============ DISUSUN BERSAMA, BUKAN DI DUA TEMPAT ============
 *
 * Rincian menjawab "kiriman mana yang selisih"; rekap menjawab "berapa total
 * gula bulan ini". Dua pertanyaan, dan orang akan membaca keduanya dalam satu
 * duduk.
 *
 * Kalau keduanya disusun terpisah, mereka akan menyimpang — dan menyimpangnya
 * tidak terlihat seperti kesalahan. Yang terlihat: sheet Rincian menjumlahkan
 * 412 kg, sheet Rekap menulis 408 kg, dan tidak ada satu pun layar yang bisa
 * menjelaskan empat kilo itu ke mana. Pertanyaan itu cuma bisa dijawab dengan
 * membaca dua potong kode dan membandingkannya.
 *
 * Jadi `susunRekapKiriman` mengembalikan KEDUANYA sekaligus, dari satu
 * penelusuran yang sama, dan tesnya menegaskan totalnya identik.
 *
 * ============ `received_qty` NULL BUKAN NOL ============
 *
 * Ini aturan terpenting di berkas ini.
 *
 * Kiriman yang masih di jalan punya `received_qty` NULL. Menjumlahkannya
 * sebagai 0 menghasilkan laporan yang mengatakan "Dikirim 100, Diterima 40" —
 * dan yang membacanya akan mencari 60 kilo yang tidak pernah hilang.
 *
 * Maka: yang belum diterima TIDAK ikut dijumlahkan di kolom Diterima, TIDAK
 * punya Selisih, dan DIHITUNG SENDIRI di kolom "Belum diterima". Angka
 * terakhir itulah yang membuat dua kolom lainnya bisa dipercaya.
 *
 * Aturan yang sama sudah dipakai `dokumen.js` untuk satu surat jalan — di sana
 * kolom Diterima & Selisih dikosongkan, bukan diisi nol. Berkas ini
 * mengikutinya supaya satu kiriman tidak terbaca berbeda di dua unduhan.
 *
 * ============ "NILAI" ARTINYA SAMA DENGAN DI SURAT JALAN ============
 *
 * `dokumen.js` menghitung Nilai = HPP × **dikirim**. Berkas ini memakai arti
 * yang sama persis, dan nilai barang yang sudah dihitung ulang penerimanya
 * diberi nama SENDIRI — `Nilai Diterima`. Dua kolom bernama sama yang
 * menghitung hal berbeda adalah cara paling halus membuat dua laporan saling
 * membantah.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa jaringan.
 */

/** Kolom sheet RINCIAN — satu baris per barang per surat jalan. */
export const KOLOM_RINCIAN = [
  { header: 'Tanggal', width: 1 },
  { header: 'No. Surat Jalan', width: 1.4 },
  { header: 'Status', width: 0.9 },
  { header: 'Dari', width: 1.3 },
  { header: 'Ke', width: 1.3 },
  { header: 'Barang', width: 2.2 },
  { header: 'Satuan', width: 0.7 },
  { header: 'Diminta', width: 0.8, align: 'right', numeric: true },
  { header: 'Dikirim', width: 0.8, align: 'right', numeric: true },
  { header: 'Diterima', width: 0.8, align: 'right', numeric: true },
  { header: 'Selisih', width: 0.8, align: 'right', numeric: true },
  { header: 'HPP/satuan', width: 1, align: 'right', numeric: true },
  { header: 'Nilai', width: 1.1, align: 'right', numeric: true },
  { header: 'Nilai Diterima', width: 1.1, align: 'right', numeric: true },
  { header: 'Keterangan', width: 1.6 }
];

/** Kolom sheet REKAP — satu baris per barang, dijumlahkan sepanjang periode. */
export const KOLOM_REKAP = [
  { header: 'Barang', width: 2.2 },
  { header: 'Satuan', width: 0.7 },
  { header: 'Surat Jalan', width: 0.9, align: 'right', numeric: true },
  { header: 'Dikirim', width: 1, align: 'right', numeric: true },
  { header: 'Diterima', width: 1, align: 'right', numeric: true },
  { header: 'Selisih', width: 1, align: 'right', numeric: true },
  // Tanpa kolom ini, "Diterima 40 dari Dikirim 100" terbaca sebagai 60 hilang.
  { header: 'Belum diterima (baris)', width: 1.1, align: 'right', numeric: true },
  { header: 'HPP/satuan', width: 1, align: 'right', numeric: true },
  { header: 'Nilai', width: 1.2, align: 'right', numeric: true },
  { header: 'Nilai Diterima', width: 1.2, align: 'right', numeric: true }
];

const teks = (v) => (v === null || v === undefined ? '' : String(v).trim());

/**
 * Angka dari kolom qty.
 *
 * `Number(null)` adalah **0**, bukan NaN — jadi NULL yang lolos ke sini akan
 * ikut dijumlahkan sebagai nol tanpa satu pun tanda. Yang kosong menjawab
 * `null`, dan pemanggilnya yang memutuskan artinya.
 */
export function qty(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Sudah ada yang menghitung barangnya di tujuan? */
export function sudahDiterima(it) {
  return qty(it?.received_qty) !== null;
}

/** Tanggal WIB dd/mm/yyyy untuk kolom Tanggal. */
export function tanggalWIB(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return teks(iso);
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Jakarta' });
}

/**
 * Susun KEDUA bentuknya sekaligus.
 *
 * @param {object} o
 * @param {Array} o.items hasil `listItemKirimanAdmin`
 * @param {Map<string, number>} [o.biaya] productId -> HPP per satuan pakai
 * @param {Record<string,string>} [o.labelStatus] kode status -> label
 * @returns {{rincian: Array[], rekap: Array[], total: object}}
 */
export function susunRekapKiriman({ items, biaya = new Map(), labelStatus = {} }) {
  const daftar = Array.isArray(items) ? items : [];

  const rincian = [];
  // Dikelompokkan per PRODUK, bukan per nama: dua produk boleh bernama sama
  // (beda satuan, beda outlet asal), dan menggabungkannya lewat nama akan
  // menjumlahkan kilogram dengan pack.
  const perProduk = new Map();

  const total = { baris: 0, dikirim: 0, diterima: 0, belum: 0, selisih: 0, nilai: 0, nilaiDiterima: 0, dokumen: new Set() };

  for (const it of daftar) {
    const dikirim = qty(it.sent_qty) ?? 0;
    const diterima = qty(it.received_qty);
    // Selisih HANYA kalau sudah diterima. "-12" untuk kiriman yang masih di
    // jalan terbaca sebagai barang hilang, padahal belum ada yang menghitungnya.
    const selisih = diterima === null ? null : diterima - dikirim;
    const hpp = biaya.get(it.product_id);
    const adaHpp = hpp !== null && hpp !== undefined && Number.isFinite(Number(hpp));
    const nilai = adaHpp ? Number(hpp) * dikirim : null;
    const nilaiDiterima = adaHpp && diterima !== null ? Number(hpp) * diterima : null;

    rincian.push([
      tanggalWIB(it.created_at),
      teks(it.code) || '(tanpa nomor)',
      labelStatus[it.status] ?? teks(it.status),
      teks(it.from_outlet) || '-',
      teks(it.to_outlet) || '-',
      teks(it.product_name) || '(produk terhapus)',
      teks(it.base_unit),
      qty(it.ordered_qty) ?? '',
      dikirim,
      // KOSONG, bukan 0 — kolom yang kosong itu sendiri adalah informasinya.
      diterima === null ? '' : diterima,
      selisih === null ? '' : selisih,
      adaHpp ? Number(hpp) : '',
      nilai === null ? '' : nilai,
      nilaiDiterima === null ? '' : nilaiDiterima,
      teks(it.keterangan)
    ]);

    const kunci = it.product_id ?? `nama:${teks(it.product_name)}`;
    if (!perProduk.has(kunci)) {
      perProduk.set(kunci, {
        nama: teks(it.product_name) || '(produk terhapus)',
        satuan: teks(it.base_unit),
        dokumen: new Set(),
        dikirim: 0,
        diterima: 0,
        belum: 0,
        selisih: 0,
        adaSelisih: false,
        hpp: adaHpp ? Number(hpp) : null,
        nilai: 0,
        nilaiDiterima: 0,
        adaNilai: false,
        adaNilaiDiterima: false
      });
    }
    const p = perProduk.get(kunci);
    if (it.dispatch_id) p.dokumen.add(it.dispatch_id);
    p.dikirim += dikirim;
    if (diterima === null) {
      p.belum += 1;
    } else {
      p.diterima += diterima;
      // Selisih dijumlahkan PER BARIS, bukan dihitung dari selisih kolom.
      //
      // Kolom Dikirim memuat SELURUH baris termasuk yang masih di jalan; kolom
      // Diterima cuma yang sudah dihitung penerimanya. `Diterima - Dikirim`
      // atas dua kolom itu menghasilkan angka minus besar yang terbaca sebagai
      // kehilangan — padahal barangnya belum sampai.
      p.selisih += selisih;
      p.adaSelisih = true;
    }
    if (nilai !== null) {
      p.nilai += nilai;
      p.adaNilai = true;
    }
    if (nilaiDiterima !== null) {
      p.nilaiDiterima += nilaiDiterima;
      p.adaNilaiDiterima = true;
    }

    total.baris += 1;
    total.dikirim += dikirim;
    if (diterima === null) {
      total.belum += 1;
    } else {
      total.diterima += diterima;
      total.selisih += selisih;
    }
    if (nilai !== null) total.nilai += nilai;
    if (nilaiDiterima !== null) total.nilaiDiterima += nilaiDiterima;
    if (it.dispatch_id) total.dokumen.add(it.dispatch_id);
  }

  const rekap = [...perProduk.values()]
    .sort((a, b) => a.nama.localeCompare(b.nama, 'id'))
    .map((p) => [
      p.nama,
      p.satuan,
      p.dokumen.size,
      p.dikirim,
      p.diterima,
      // Kosong kalau BELUM ADA SATU PUN yang diterima: "0" di sini terbaca
      // sebagai "cocok, tidak ada selisih", padahal belum ada yang menghitung.
      p.adaSelisih ? p.selisih : '',
      p.belum,
      p.hpp === null ? '' : p.hpp,
      p.adaNilai ? p.nilai : '',
      p.adaNilaiDiterima ? p.nilaiDiterima : ''
    ]);

  return { rincian, rekap, total: { ...total, dokumen: total.dokumen.size } };
}

/** Ringkasan siap-tampil di bawah tombol unduh. */
export function ringkasKiriman(hasil) {
  const t = hasil?.total ?? {};
  return {
    dokumen: t.dokumen ?? 0,
    baris: t.baris ?? 0,
    barang: hasil?.rekap?.length ?? 0,
    belum: t.belum ?? 0
  };
}
