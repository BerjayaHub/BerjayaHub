/**
 * ATURAN MURNI: baris laporan Mutasi Kas, lengkap dengan rincian nota.
 *
 * Tanpa jaringan, tanpa DOM. Dipakai bersama oleh ekspor Excel DAN PDF, supaya
 * keduanya tidak pernah menampilkan isi yang berbeda untuk rentang yang sama.
 *
 * ============ BENTUK DATANYA, DAN KENAPA BEGITU ============
 *
 * `cash_entries` TIDAK punya daftar barang. Satu-satunya kaitan ke nota adalah
 * arah sebaliknya: `goods_receipts.payment_entry_id` menunjuk entri kas yang
 * MEMBAYAR nota itu (0122).
 *
 * Jadi entri kas terbagi dua, dan keduanya harus tetap terlihat:
 *
 *   entri yang membayar nota  -> satu baris PER BARANG di nota itu
 *   entri lain (biaya, gaji,
 *     NBM, setor modal)       -> tetap SATU baris, kolom barangnya kosong
 *
 * Yang kedua ikut dengan sengaja. Kalau disaring keluar, total laporan ini
 * tidak akan pernah sama dengan saldo di layar Mutasi Kas — dan laporan yang
 * totalnya berbeda tanpa penjelasan selalu disangka salah hitung, bukan
 * disangka saringan.
 *
 * ============ NOMINAL TIDAK DIBAGI KE BARIS BARANG ============
 *
 * Satu nota berisi 8 barang menghasilkan 8 baris, tapi nominal kasnya DITULIS
 * SEKALI di baris pertama. Menuliskannya di tiap baris membuat siapa pun yang
 * menjumlahkan kolom itu mendapat delapan kali lipat — dan angka yang
 * kelihatan seperti total adalah angka yang pasti dijumlahkan orang.
 */

const teks = (v) => (v === null || v === undefined ? '' : String(v).trim());
const angka = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Entri kas yang dicoret tetap ditampilkan, tapi ditandai. */
export const SEBAB_NOL = {
  DICORET: 'dicoret',
  BUKAN_NOTA: 'bukan_nota',
  NOTA_TANPA_BARIS: 'nota_tanpa_baris'
};

export const KOLOM = [
  { header: 'Tanggal', width: 12 },
  { header: 'Jenis', width: 10 },
  { header: 'Pemegang', width: 18 },
  { header: 'Outlet', width: 16 },
  { header: 'Kategori', width: 16 },
  { header: 'Dibayarkan ke', width: 20 },
  { header: 'Keterangan', width: 28 },
  { header: 'Nominal', numeric: true, width: 14 },
  { header: 'No. Nota', width: 14 },
  { header: 'Barang', width: 24 },
  { header: 'Qty', numeric: true, width: 9 },
  { header: 'Satuan', width: 9 },
  { header: 'Harga Satuan', numeric: true, width: 14 },
  { header: 'Subtotal', numeric: true, width: 14 },
  { header: 'Status', width: 14 }
];

/** Indeks kolom foto — dipakai pemanggil untuk menyisipkan dua kolom gambar. */
export const JUDUL_FOTO_KAS = 'Foto Bukti Kas';
export const JUDUL_FOTO_NOTA = 'Foto Nota';

const jenisLabel = (t) => (t === 'in' ? 'Masuk' : t === 'out' ? 'Keluar' : teks(t) || '-');

/**
 * Susun seluruh baris laporan.
 *
 * @param {object} o
 *   entries   baris `cash_entries` (sudah lengkap dengan embed-nya)
 *   notaPer   Map<entryId, nota>      nota yang DIBAYAR entri itu
 *   itemPer   Map<notaId, item[]>     baris barang tiap nota
 *
 * Kedua peta dikirim pemanggil, tidak dicari sendiri di sini — itulah yang
 * membuat berkas ini bisa diuji tanpa database sama sekali.
 */
export function susunBarisKas({ entries, notaPer, itemPer } = {}) {
  const daftar = Array.isArray(entries) ? entries : [];
  const nota = notaPer instanceof Map ? notaPer : new Map();
  const item = itemPer instanceof Map ? itemPer : new Map();

  const baris = [];
  let jumlahNota = 0;
  let jumlahBarisBarang = 0;
  let dicoret = 0;
  let tanpaFotoKas = 0;
  let notaTanpaBaris = 0;

  for (const e of daftar) {
    const n = nota.get(e.id) ?? null;
    const barang = n ? item.get(n.id) ?? [] : [];
    const isDicoret = !!e.dicoret_at;
    if (isDicoret) dicoret += 1;
    if (!teks(e.proof_path)) tanpaFotoKas += 1;
    if (n) jumlahNota += 1;
    if (n && !barang.length) notaTanpaBaris += 1;

    const status = [
      isDicoret ? `DICORET${e.alasan_coret ? ': ' + teks(e.alasan_coret) : ''}` : '',
      e.esb_exported_at ? 'sudah ekspor ESB' : '',
      e.diubah_at ? 'pernah diubah' : ''
    ]
      .filter(Boolean)
      .join(' · ');

    const dasar = {
      entryId: e.id,
      tanggal: teks(e.entry_date),
      jenis: jenisLabel(e.entry_type),
      pemegang: e.holder?.full_name ?? '-',
      outlet: e.outlets?.name ?? '-',
      kategori: e.cash_categories?.name ?? '-',
      penerima: teks(e.supplier) || '-',
      keterangan: teks(e.notes),
      // ============ DICORET = NOL, TAPI TETAP TERLIHAT ============
      //
      // Entri yang dicoret tidak boleh ikut menjumlah (0141: seluruh pembaca
      // kas menyaringnya), tapi menghapusnya dari laporan berarti bukti
      // koreksinya hilang. Jadi nominalnya nol dan sebabnya ditulis.
      nominal: isDicoret ? 0 : angka(e.amount) ?? 0,
      nominalAsli: angka(e.amount) ?? 0,
      dicoret: isDicoret,
      status: status || '-',
      fotoKas: teks(e.proof_path) || null,
      fotoNota: n ? teks(n.photo_path) || null : null,
      noNota: n ? teks(n.code) || teks(n.invoice_no) || '-' : '-'
    };

    if (!barang.length) {
      baris.push({
        ...dasar,
        barang: '',
        qty: null,
        satuan: '',
        hargaSatuan: null,
        subtotal: null,
        barisPertama: true,
        sebabKosong: isDicoret ? SEBAB_NOL.DICORET : n ? SEBAB_NOL.NOTA_TANPA_BARIS : SEBAB_NOL.BUKAN_NOTA
      });
      continue;
    }

    barang.forEach((b, i) => {
      jumlahBarisBarang += 1;
      baris.push({
        ...dasar,
        // Nominal & foto HANYA di baris pertama tiap nota. Lihat catatan di
        // kepala berkas: kolom yang berisi angka di tiap baris pasti
        // dijumlahkan, dan hasilnya salah berlipat.
        nominal: i === 0 ? dasar.nominal : null,
        fotoKas: i === 0 ? dasar.fotoKas : null,
        fotoNota: i === 0 ? dasar.fotoNota : null,
        // `??` dan `||` tidak boleh bercampur tanpa kurung — JS menolaknya,
        // dan di sini yang diinginkan memang: nama produk, lalu catatan baris,
        // lalu penanda eksplisit. Baris tanpa nama apa pun tetap harus terlihat
        // sebagai baris, bukan sebagai sel kosong yang disangka salah salin.
        barang: b?.products?.name || teks(b?.notes) || '(tanpa nama)',
        qty: angka(b?.qty),
        satuan: teks(b?.products?.base_unit),
        hargaSatuan: angka(b?.unit_cost),
        subtotal: angka(b?.line_total),
        barisPertama: i === 0,
        sebabKosong: null
      });
    });
  }

  return {
    baris,
    ringkas: {
      jumlahEntri: daftar.length,
      jumlahNota,
      jumlahBarisBarang,
      dicoret,
      tanpaFotoKas,
      notaTanpaBaris,
      totalMasuk: daftar.filter((e) => e.entry_type === 'in' && !e.dicoret_at).reduce((a, e) => a + (angka(e.amount) ?? 0), 0),
      totalKeluar: daftar.filter((e) => e.entry_type === 'out' && !e.dicoret_at).reduce((a, e) => a + (angka(e.amount) ?? 0), 0)
    }
  };
}

/** Baris -> array sel, urutannya mengikuti `KOLOM`. */
export function keSel(b) {
  return [
    b.tanggal,
    b.jenis,
    b.pemegang,
    b.outlet,
    b.kategori,
    b.penerima,
    b.keterangan,
    b.nominal,
    b.noNota,
    b.barang,
    b.qty,
    b.satuan,
    b.hargaSatuan,
    b.subtotal,
    b.status
  ];
}

/**
 * Kalimat ringkas di bawah tombol unduh.
 *
 * Yang DIBUANG dan yang BELUM LENGKAP dikatakan, bukan didiamkan. Laporan yang
 * rapi tapi isinya kurang adalah kegagalan yang paling mungkin lolos.
 */
export function pesanRingkasKas(r) {
  if (!r || !r.jumlahEntri) return 'Tidak ada entri kas pada rentang ini.';
  const bagian = [`${r.jumlahEntri} entri kas`];
  if (r.jumlahNota) bagian.push(`${r.jumlahNota} di antaranya membayar nota (${r.jumlahBarisBarang} baris barang)`);
  const catatan = [
    r.dicoret ? `${r.dicoret} entri dicoret — nominalnya dihitung nol` : '',
    r.notaTanpaBaris ? `${r.notaTanpaBaris} nota belum ada rincian barangnya` : '',
    r.tanpaFotoKas ? `${r.tanpaFotoKas} entri tanpa foto bukti` : ''
  ].filter(Boolean);
  return bagian.join(', ') + '.' + (catatan.length ? ` Catatan: ${catatan.join('; ')}.` : '');
}

/**
 * Daftar foto untuk LAMPIRAN PDF — hanya yang benar-benar ada, tanpa duplikat.
 *
 * Satu entri bisa menyumbang dua foto (bukti kas + foto nota), dan keduanya
 * diberi penanda yang menyebutkan asalnya. Lampiran foto tanpa penanda adalah
 * tumpukan gambar yang tidak bisa dicocokkan dengan barisnya — persis masalah
 * yang membuat orang berhenti membuka lampiran.
 */
export function daftarLampiranFoto(hasil) {
  const out = [];
  const sudah = new Set();
  for (const b of hasil?.baris ?? []) {
    if (!b.barisPertama) continue;
    for (const [path, jenis] of [
      [b.fotoKas, 'Bukti kas'],
      [b.fotoNota, 'Foto nota']
    ]) {
      if (!path || sudah.has(path)) continue;
      sudah.add(path);
      out.push({
        path,
        penanda: `${jenis} — ${b.tanggal} · ${b.pemegang}${b.noNota && b.noNota !== '-' ? ' · nota ' + b.noNota : ''}`
      });
    }
  }
  return out;
}
