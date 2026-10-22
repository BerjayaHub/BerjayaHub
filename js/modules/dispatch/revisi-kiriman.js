/**
 * ATURAN MURNI: revisi Surat Jalan yang SUDAH diterima (0165).
 *
 * Tanpa jaringan, tanpa DOM. Database tetap penjaga sebenarnya — berkas ini
 * ada supaya layar bisa menolak lebih dulu dengan kalimat yang sama, dan supaya
 * aritmetika "apa akibatnya ke stok" bisa diuji tanpa Postgres.
 *
 * ============ KAPAN STOK BERGERAK — DAN KENAPA ITU MENENTUKAN ============
 *
 * `kirim_draft_kiriman` TIDAK menulis satu pun gerakan stok. Seluruhnya
 * ditulis `receive_dispatch` saat outlet menekan Terima:
 *
 *   transfer_out  -sent_qty      di outlet ASAL
 *   transfer_in   +dicek_qty     di outlet TUJUAN
 *
 * Jadi selama SJ berstatus "dikirim", stok CK belum berkurang sama sekali.
 * Akibatnya untuk revisi:
 *
 *   ubah JUMLAH DITERIMA  -> hanya stok outlet TUJUAN bergeser. `transfer_out`
 *                            memakai `sent_qty` yang tidak ikut berubah.
 *   TAMBAH BARANG         -> dua-duanya bergerak.
 *
 * Kalau bedanya dilebur jadi "pokoknya koreksi stok", penambahan barang akan
 * memotong stok CK dua kali atau tidak sama sekali — tanpa galat di mana pun.
 */

const teks = (v) => (v === null || v === undefined ? '' : String(v).trim());

const angka = (v) => {
  if (v === null || v === undefined || teks(v) === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const JENIS = {
  UBAH: 'ubah_diterima',
  TAMBAH: 'tambah_barang'
};

export const LABEL_JENIS = {
  [JENIS.UBAH]: 'Jumlah diterima dibetulkan',
  [JENIS.TAMBAH]: 'Barang ditambahkan'
};

/**
 * Apakah SJ ini boleh direvisi orang yang sedang membuka layar?
 *
 * Memulangkan ALASAN kalau tidak boleh, bukan sekadar `false` — tombol yang
 * disembunyikan tanpa penjelasan membuat orang mengira fiturnya rusak, lalu
 * bertanya ke orang yang juga tidak tahu.
 *
 * @param {object} sj          baris `dispatches`
 * @param {Set|Array} outletSaya outlet yang cakupannya dipegang pemakai
 */
export function alasanTakBisaRevisi(sj, outletSaya) {
  if (!sj) return 'Kiriman tidak ditemukan.';
  const status = teks(sj.status);
  if (status === 'draft') return 'Masih draft — ubah langsung di tab Draft Surat Jalan.';
  if (status === 'sent') return 'Belum diterima outlet. Angkanya masih bisa dibetulkan di layar Terima.';
  if (status !== 'received') return 'Kiriman ini sudah dibatalkan.';

  const punya = outletSaya instanceof Set ? outletSaya : new Set(outletSaya ?? []);
  // CK (asal) DAN outlet tujuan, dua-duanya. Yang salah ketik biasanya yang
  // mengetik; memaksanya menunggu admin membuat orang memilih jalan lain —
  // SJ tandingan, atau angka yang dibiarkan salah.
  if (!punya.has(sj.from_outlet_id) && !punya.has(sj.to_outlet_id)) {
    return 'Kamu bukan pengirim maupun outlet tujuannya.';
  }
  return null;
}

export const bisaRevisi = (sj, outletSaya) => alasanTakBisaRevisi(sj, outletSaya) === null;

/**
 * Susun muatan RPC dari isian layar.
 *
 * @param {Array} barisAsli  `dispatch_items` yang sudah ada
 * @param {Array} isian      [{ product_id, received_qty, sent_qty? }] dari layar
 *
 * ============ HANYA YANG BERUBAH YANG DIKIRIM ============
 *
 * Baris yang angkanya sama dengan yang tersimpan TIDAK diikutkan. Bukan demi
 * hemat: RPC menulis satu gerakan stok per baris yang dikirim, dan baris yang
 * tidak berubah akan menghasilkan gerakan bernilai nol — sampah yang membuat
 * riwayat stok sulit dibaca justru saat sedang ditelusuri.
 */
export function susunMuatanRevisi(barisAsli, isian) {
  const lama = new Map((Array.isArray(barisAsli) ? barisAsli : []).map((b) => [b.product_id, b]));
  const muatan = [];
  const masalah = [];

  for (const i of Array.isArray(isian) ? isian : []) {
    const pid = teks(i?.product_id);
    if (!pid) continue;
    const terima = angka(i?.received_qty);
    if (terima === null) {
      masalah.push({ product_id: pid, pesan: 'Jumlah diterima belum diisi.' });
      continue;
    }
    if (terima < 0) {
      masalah.push({ product_id: pid, pesan: 'Jumlah diterima tidak boleh minus.' });
      continue;
    }

    const asli = lama.get(pid);
    if (!asli) {
      // Barang BARU — `sent_qty` wajib, karena itulah yang memotong stok CK.
      // Menebaknya dari jumlah diterima akan menyamarkan susut jadi nol pada
      // barang yang justru ditambahkan karena ada selisih.
      const kirim = angka(i?.sent_qty);
      if (kirim === null) {
        masalah.push({ product_id: pid, pesan: 'Barang baru harus disertai jumlah KIRIM-nya.' });
        continue;
      }
      if (kirim < 0) {
        masalah.push({ product_id: pid, pesan: 'Jumlah kirim tidak boleh minus.' });
        continue;
      }
      muatan.push({ product_id: pid, received_qty: terima, sent_qty: kirim });
      continue;
    }

    if (Number(asli.received_qty ?? 0) === terima) continue;
    muatan.push({ product_id: pid, received_qty: terima });
  }

  return { muatan, masalah };
}

/**
 * Akibat revisi ke stok, dihitung per outlet.
 *
 * Dipakai layar untuk mengatakan apa yang AKAN terjadi sebelum tombolnya
 * ditekan — bukan sesudah. Angka stok yang berubah tanpa diumumkan lebih dulu
 * adalah angka yang orang curigai sebagai kesalahan.
 */
export function akibatStok(barisAsli, muatan) {
  const lama = new Map((Array.isArray(barisAsli) ? barisAsli : []).map((b) => [b.product_id, b]));
  const keOutlet = [];
  const keAsal = [];

  for (const m of Array.isArray(muatan) ? muatan : []) {
    const asli = lama.get(m.product_id);
    if (!asli) {
      if (Number(m.sent_qty) > 0) keAsal.push({ product_id: m.product_id, delta: -Number(m.sent_qty), jenis: JENIS.TAMBAH });
      if (Number(m.received_qty) > 0) keOutlet.push({ product_id: m.product_id, delta: Number(m.received_qty), jenis: JENIS.TAMBAH });
      continue;
    }
    const delta = Number(m.received_qty) - Number(asli.received_qty ?? 0);
    if (delta !== 0) keOutlet.push({ product_id: m.product_id, delta, jenis: JENIS.UBAH });
  }

  return {
    keOutlet,
    keAsal,
    // `keAsal` kosong berarti stok CK tidak tersentuh sama sekali — keadaan
    // yang paling sering, dan layak dikatakan supaya orang CK tidak khawatir.
    menyentuhAsal: keAsal.length > 0
  };
}

export function pesanAkibat(akibat, { namaAsal = 'outlet asal', namaTujuan = 'outlet tujuan' } = {}) {
  const a = akibat ?? { keOutlet: [], keAsal: [] };
  if (!a.keOutlet.length && !a.keAsal.length) return 'Tidak ada angka yang berubah.';
  const bagian = [];
  if (a.keOutlet.length) bagian.push(`${a.keOutlet.length} baris stok ${namaTujuan} dikoreksi`);
  if (a.keAsal.length) bagian.push(`${a.keAsal.length} barang baru memotong stok ${namaAsal}`);
  else bagian.push(`stok ${namaAsal} tidak tersentuh`);
  return bagian.join(' · ') + '.';
}

/**
 * Riwayat revisi satu baris -> daftar siap-tampil, terbaru di atas.
 *
 * @param {Array} revisi isi kolom `dispatch_items.revisi`
 * @param {Map} namaUser  id -> nama, dikirim pemanggil
 */
export function bacaJejak(revisi, namaUser) {
  const peta = namaUser instanceof Map ? namaUser : new Map();
  return (Array.isArray(revisi) ? revisi : [])
    .map((r) => ({
      jenis: teks(r?.jenis) || JENIS.UBAH,
      label: LABEL_JENIS[teks(r?.jenis)] ?? LABEL_JENIS[JENIS.UBAH],
      qtyLama: r?.qty_lama === null || r?.qty_lama === undefined ? null : Number(r.qty_lama),
      qtyBaru: angka(r?.qty_baru),
      sentQty: angka(r?.sent_qty),
      // ============ NAMA YANG DISIMPAN DIUTAMAKAN ============
      //
      // `by_nama` ditulis database saat perubahan terjadi (0165). Ia dipakai
      // LEBIH DULU daripada peta nama hari ini, karena staff yang keluar lalu
      // barisnya hilang akan membuat seluruh jejaknya berbunyi "pengguna tak
      // dikenal" — tepat pada catatan yang gunanya mempertanggungjawabkan
      // perubahan stok. Peta tetap dipakai untuk jejak lama yang belum
      // ber-`by_nama`.
      oleh: teks(r?.by_nama) || peta.get(teks(r?.by)) || (teks(r?.by) ? 'pengguna tak dikenal' : '—'),
      olehId: teks(r?.by),
      pada: teks(r?.at),
      alasan: teks(r?.alasan)
    }))
    .reverse();
}

/** Satu kalimat untuk satu entri jejak. */
export function kalimatJejak(j) {
  if (!j) return '';
  const angkaNya =
    j.qtyLama === null
      ? `ditambahkan ${j.qtyBaru}${j.sentQty !== null ? ` (kirim ${j.sentQty})` : ''}`
      : `${j.qtyLama} → ${j.qtyBaru}`;
  return `${angkaNya} · oleh ${j.oleh}${j.alasan ? ` — ${j.alasan}` : ''}`;
}

/** Berapa baris SJ ini yang pernah direvisi? Dipakai lencana di daftar. */
export function hitungBarisDirevisi(barisAsli) {
  return (Array.isArray(barisAsli) ? barisAsli : []).filter((b) => Array.isArray(b?.revisi) && b.revisi.length > 0).length;
}
