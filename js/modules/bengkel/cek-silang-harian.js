/**
 * CEK SILANG: omzet harian (versi staff) vs penjualan rinci (versi Turboly).
 *
 * Murni: tidak menyentuh DOM, tidak menyentuh Supabase.
 *
 * ============ KENAPA DUA ANGKA INI LAYAK DIBANDINGKAN ============
 *
 * Keduanya mengaku mencatat penjualan hari yang sama, dari dua jalur yang
 * tidak saling melihat:
 *
 *   harian  -> diketik staff sore itu dari uang yang benar-benar masuk
 *   rinci   -> diimpor dari Turboly, tempat transaksinya dibukukan
 *
 * Selama keduanya tidak pernah disandingkan, dua jenis kebocoran bisa hidup
 * bertahun-tahun tanpa ketahuan: penjualan yang uangnya masuk tapi tidak
 * pernah dibukukan di Turboly, dan penjualan yang dibukukan tapi uangnya
 * tidak pernah dilaporkan. Keduanya normal-normal saja kalau dilihat dari
 * satu sisi.
 *
 * ============ YANG DIBANDINGKAN HANYA LAWAN TURBOLY ============
 *
 * Penjualan KORPORAT sengaja tidak ikut dijumlahkan ke sisi rinci saat
 * membandingkan: ia ditagih kantor, tidak lewat kasir, dan tidak pernah
 * muncul di laporan harian staff. Memasukkannya akan membuat tiap hari yang
 * ada invoice korporatnya tampak "selisih" — dan selisih yang selalu muncul
 * adalah selisih yang berhenti dibaca orang.
 *
 * Jadi korporat ditampilkan sebagai kolom TERSENDIRI: terlihat, tapi tidak
 * ikut menuduh.
 */

const teks = (v) => (v === null || v === undefined ? '' : String(v));
const num = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const bulat = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const STATUS = {
  COCOK: 'cocok',
  BEDA: 'beda',
  TANPA_RINCI: 'tanpa-rinci',
  TANPA_HARIAN: 'tanpa-harian'
};

export const PESAN_STATUS = {
  [STATUS.COCOK]: 'Angkanya sama.',
  [STATUS.BEDA]: 'Angka staff dan Turboly berbeda — periksa setoran hari itu.',
  [STATUS.TANPA_RINCI]: 'Staff melapor, tapi tidak ada penjualan Turboly di tanggal itu — belum diimpor, atau memang tidak dibukukan.',
  [STATUS.TANPA_HARIAN]: 'Ada penjualan di Turboly, tapi staff belum melapor harian.'
};

/** `YYYY-MM-DD` dari apa pun bentuk tanggalnya. */
export function kunciTanggal(v) {
  const s = teks(v).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
}

/**
 * Sandingkan.
 *
 * @param {{harian: Array, rinci: Array, toleransi: number}} o
 *   harian: {outlet_id, sale_date, omzet_sparepart, omzet_jasa, outlets:{name}}
 *   rinci : {outlet_id, outlet_nama, tanggal, item_type, total, sumber}
 *   toleransi: selisih rupiah yang masih dianggap sama (pembulatan kasir)
 */
export function cekSilangHarian({ harian = [], rinci = [], toleransi = 0 } = {}) {
  const peta = new Map();
  const ambil = (outletId, tanggal, nama) => {
    const k = `${teks(outletId)}|${kunciTanggal(tanggal)}`;
    if (!peta.has(k)) {
      peta.set(k, {
        outlet_id: teks(outletId),
        outlet: teks(nama),
        tanggal: kunciTanggal(tanggal),
        harianSparepart: 0,
        harianJasa: 0,
        turbolySparepart: 0,
        turbolyJasa: 0,
        korporat: 0,
        adaHarian: false,
        adaRinci: false
      });
    }
    const b = peta.get(k);
    if (!b.outlet && nama) b.outlet = teks(nama);
    return b;
  };

  for (const h of Array.isArray(harian) ? harian : []) {
    const b = ambil(h?.outlet_id, h?.sale_date, h?.outlets?.name ?? h?.outlet_nama);
    b.harianSparepart += num(h?.omzet_sparepart);
    b.harianJasa += num(h?.omzet_jasa);
    b.adaHarian = true;
  }

  for (const r of Array.isArray(rinci) ? rinci : []) {
    const b = ambil(r?.outlet_id, r?.tanggal, r?.outlet_nama);
    const total = num(r?.total);
    if (teks(r?.sumber) === 'korporat') {
      // Tidak ikut dibandingkan — lihat kepala berkas.
      b.korporat += total;
      continue;
    }
    if (teks(r?.item_type) === 'jasa') b.turbolyJasa += total;
    else b.turbolySparepart += total;
    b.adaRinci = true;
  }

  const baris = [...peta.values()].map((b) => {
    const harianTotal = bulat(b.harianSparepart + b.harianJasa);
    const turbolyTotal = bulat(b.turbolySparepart + b.turbolyJasa);
    const selisih = bulat(harianTotal - turbolyTotal);
    let status;
    if (b.adaHarian && !b.adaRinci) status = STATUS.TANPA_RINCI;
    else if (!b.adaHarian && b.adaRinci) status = STATUS.TANPA_HARIAN;
    else status = Math.abs(selisih) <= num(toleransi) ? STATUS.COCOK : STATUS.BEDA;
    return {
      ...b,
      harianSparepart: bulat(b.harianSparepart),
      harianJasa: bulat(b.harianJasa),
      turbolySparepart: bulat(b.turbolySparepart),
      turbolyJasa: bulat(b.turbolyJasa),
      korporat: bulat(b.korporat),
      harianTotal,
      turbolyTotal,
      selisih,
      // Selisih per jenis ikut dihitung: total yang kebetulan sama bisa
      // menyembunyikan sparepart kelebihan yang ditutup jasa kekurangan, dan
      // itu dua kesalahan yang saling menutupi — bukan nol kesalahan.
      selisihSparepart: bulat(b.harianSparepart - b.turbolySparepart),
      selisihJasa: bulat(b.harianJasa - b.turbolyJasa),
      status
    };
  });

  // Terbaru dulu, lalu per outlet — sama dengan cara laporan lain dibaca.
  baris.sort((a, b) => (a.tanggal < b.tanggal ? 1 : a.tanggal > b.tanggal ? -1 : a.outlet.localeCompare(b.outlet, 'id')));
  return { baris, ringkas: ringkasCekSilang(baris) };
}

export function ringkasCekSilang(baris) {
  const r = {
    hari: 0,
    cocok: 0,
    beda: 0,
    tanpaRinci: 0,
    tanpaHarian: 0,
    harian: 0,
    turboly: 0,
    korporat: 0,
    selisih: 0,
    selisihMutlak: 0
  };
  for (const b of baris ?? []) {
    r.hari += 1;
    if (b.status === STATUS.COCOK) r.cocok += 1;
    else if (b.status === STATUS.BEDA) r.beda += 1;
    else if (b.status === STATUS.TANPA_RINCI) r.tanpaRinci += 1;
    else r.tanpaHarian += 1;
    r.harian += b.harianTotal;
    r.turboly += b.turbolyTotal;
    r.korporat += b.korporat;
    r.selisih += b.selisih;
    // Dijumlahkan MUTLAK juga: kelebihan di satu hari dan kekurangan di hari
    // lain saling menghapus di total, dan hasilnya nol yang membuat seluruh
    // bulan terlihat beres.
    r.selisihMutlak += Math.abs(b.selisih);
  }
  for (const k of ['harian', 'turboly', 'korporat', 'selisih', 'selisihMutlak']) r[k] = bulat(r[k]);
  return r;
}

/** Kalimat yang ikut dibawa ke mana pun angkanya dipakai. */
export function catatanCekSilang(r) {
  const out = [];
  if (!r) return out;
  if (r.beda) out.push(`${r.beda} hari angkanya berbeda — total selisih mutlak ${rupiah(r.selisihMutlak)}.`);
  if (r.tanpaRinci) out.push(`${r.tanpaRinci} hari ada laporan staff tapi tidak ada data Turboly (belum diimpor, atau memang tidak dibukukan).`);
  if (r.tanpaHarian) out.push(`${r.tanpaHarian} hari ada penjualan Turboly tapi staff belum melapor.`);
  if (r.korporat) out.push(`Penjualan korporat ${rupiah(r.korporat)} TIDAK ikut dibandingkan — ia ditagih kantor, bukan lewat kasir.`);
  if (!out.length && r.hari) out.push('Semua hari cocok.');
  return out;
}

export function rupiah(n) {
  return 'Rp' + Math.round(Number(n) || 0).toLocaleString('id-ID');
}
