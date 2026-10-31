/**
 * SALDO BERJALAN DI RIWAYAT KAS — kapan ada angkanya, kapan tidak.
 *
 * Murni: tidak menyentuh DOM, tidak menyentuh Supabase.
 *
 * ============ TIGA KEADAAN, BUKAN DUA ============
 *
 * Yang mudah dilewatkan: "tidak ada angkanya" punya DUA sebab yang sama sekali
 * berbeda, dan menyamakannya membuat kolom ini berbohong.
 *
 *   ada angkanya       -> saldo kantong sesudah entri ini
 *   tidak kena saldo   -> entri dicoret, atau dibayar Pusat. Uangnya memang
 *                         tidak pernah keluar-masuk kantong ini.
 *   tidak diketahui    -> server tidak mengembalikan angkanya (di luar
 *                         wewenang, atau gagal diambil)
 *
 * Keduanya ditulis "—" di layar, TAPI dengan keterangan yang berbeda saat
 * disentuh. Menuliskan 0 untuk keadaan ketiga adalah kesalahan paling mahal
 * yang bisa dibuat kolom ini: "kantongnya kosong" dan "angkanya tidak
 * diketahui" menuntut tindakan yang bertolak belakang, dan orang yang membaca
 * 0 akan mulai mencari uang yang hilang.
 */

const SEBAB = {
  dicoret: 'Entri ini dicoret — tidak pernah memengaruhi saldo kantong.',
  pusat: 'Dibayar Pusat — uangnya tidak keluar dari kantong ini, jadi saldonya tidak bergerak.',
  takTahu: 'Saldo kantong untuk entri ini tidak bisa dihitung (di luar wewenangmu atau gagal dimuat).'
};

const angka = (v) => {
  // null / undefined / '' DITOLAK LEBIH DULU, dan ini bukan kerapian:
  // `Number(null)` adalah 0, dan 0 itu berhingga. Tanpa penjaga ini, saldo
  // yang TIDAK ADA dari server akan tersimpan sebagai nol — lalu tampil
  // "Rp 0" di kolom saldo, yang dibaca "kantongnya kosong". Itu persis
  // kekeliruan yang seluruh berkas ini dibuat untuk mencegahnya.
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

/** Peta id -> saldo, dari jawaban RPC `saldo_berjalan_kas`. */
export function petaSaldo(baris) {
  const peta = new Map();
  for (const b of Array.isArray(baris) ? baris : []) {
    const n = angka(b?.saldo);
    if (b?.id && n !== null) peta.set(String(b.id), n);
  }
  return peta;
}

/**
 * Keadaan sel saldo untuk satu entri.
 *
 * @param {object} entri baris kas (butuh `id`, `dicoret_at`, `dibayar_pusat`)
 * @param {Map<string, number>} peta hasil `petaSaldo`
 * @returns {{ada: boolean, nilai: number|null, sebab: string}}
 */
export function selSaldo(entri, peta) {
  // ============ DICORET DIPERIKSA DULUAN ============
  //
  // Entri yang dicoret memang tidak dikembalikan servernya. Kalau urutannya
  // dibalik, ia jatuh ke cabang "tidak diketahui" — dan keterangannya akan
  // menyuruh orang mencari masalah wewenang yang tidak ada.
  if (entri?.dicoret_at) return { ada: false, nilai: null, sebab: SEBAB.dicoret };
  if (entri?.dibayar_pusat) return { ada: false, nilai: null, sebab: SEBAB.pusat };

  const n = peta instanceof Map ? peta.get(String(entri?.id)) : undefined;
  if (n === undefined) return { ada: false, nilai: null, sebab: SEBAB.takTahu };
  return { ada: true, nilai: n, sebab: '' };
}

/**
 * Saldo kantong TERKINI menurut kolom ini — untuk dicocokkan dengan saldo di
 * kepala halaman.
 *
 * Dipakai pemeriksaan, bukan tampilan: dua angka yang berbeda untuk hal yang
 * sama di satu layar adalah bentuk kegagalan yang paling sering lolos, karena
 * keduanya sama-sama terlihat masuk akal.
 *
 * Yang dicari BUKAN baris teratas di layar. Daftar Staff App urut waktu ketik,
 * sementara saldonya berjalan menurut TANGGAL ENTRI — jadi entri mundur yang
 * baru saja diketik duduk di paling atas tanpa membawa saldo terakhir. Barisnya
 * dipilih dengan urutan yang sama dengan jendela di database.
 */
export function saldoTerkini(baris, peta) {
  const kunci = (e) => `${e?.entry_date ?? ''}|${e?.created_at ?? ''}|${e?.id ?? ''}`;
  let terpilih = null;
  for (const e of Array.isArray(baris) ? baris : []) {
    if (!selSaldo(e, peta).ada) continue;
    if (!terpilih || kunci(e) > kunci(terpilih)) terpilih = e;
  }
  return terpilih ? selSaldo(terpilih, peta).nilai : null;
}

export const SEBAB_SALDO = SEBAB;
