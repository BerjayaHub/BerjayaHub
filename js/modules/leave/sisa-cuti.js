/**
 * ATURAN MURNI: sisa cuti seluruh staff di satu BU.
 *
 * Tanpa jaringan, tanpa DOM. Semua masukan dikirim pemanggil, supaya aritmetika
 * yang menentukan "berapa sisa cuti orang ini" bisa diuji tanpa database.
 *
 * ============ SISA TIDAK PERNAH DISIMPAN ============
 *
 * Yang tersimpan hanya `quota_days` per (staff × jenis). Pemakaiannya dihitung
 * ULANG dari cuti berstatus `approved` di tahun berjalan — itulah sebabnya
 * jatah penuh lagi sendiri setiap 1 Januari tanpa proses reset apa pun.
 *
 * Konsekuensinya yang gampang terlewat: angka di layar ini adalah TURUNAN.
 * Kalau sebuah pengajuan disetujui lalu dibatalkan, sisanya kembali sendiri.
 * Tidak ada tempat yang perlu dikoreksi manual, dan tidak boleh ada.
 */

/** Tahun berjalan menurut WIB, bukan jam perangkat. */
export function tahunBerjalanWIB(sekarang = Date.now()) {
  return new Date(sekarang + 7 * 3600000).getUTCFullYear();
}

const teks = (v) => (v === null || v === undefined ? '' : String(v).trim());

/**
 * Tiga keadaan jatah, dan ketiganya BERBEDA.
 *
 *   BERKUOTA      jenis memotong jatah, dan angkanya sudah diisi admin.
 *   TANPA_BATAS   jenis memotong jatah, tapi `quota_days` masih null.
 *   TIDAK_DIPOTONG jenisnya memang tidak memotong jatah (mis. cuti menikah
 *                  yang dihitung terpisah) — "sisa" tidak punya arti di sini.
 *
 * Kalau ketiganya dilebur jadi satu angka, TANPA_BATAS akan terbaca sebagai
 * "sisa 0" dan staff ditolak mengajukan cuti yang sebenarnya belum dibatasi
 * siapa pun. Itu penolakan yang terlihat sah dan tidak ada yang bisa
 * menjelaskannya.
 */
export const KEADAAN = {
  BERKUOTA: 'berkuota',
  TANPA_BATAS: 'tanpa_batas',
  TIDAK_DIPOTONG: 'tidak_dipotong'
};

export const LABEL_KEADAAN = {
  [KEADAAN.BERKUOTA]: 'Berjatah',
  [KEADAAN.TANPA_BATAS]: 'Jatah belum diatur',
  [KEADAAN.TIDAK_DIPOTONG]: 'Tidak memotong jatah'
};

/**
 * Hitung satu baris (satu staff × satu jenis cuti).
 *
 * @param {object} o
 *   quotaDays     number | null
 *   deductsQuota  boolean
 *   terpakai      number
 */
export function hitungSisa({ quotaDays, deductsQuota, terpakai } = {}) {
  // `Number(null)` adalah 0, bukan NaN — jebakan yang sudah berkali-kali
  // menggigit di repo ini. Jadi null diperiksa SEBELUM dikonversi, bukan
  // sesudah, karena sesudahnya "belum diatur" sudah tidak bisa dibedakan dari
  // "jatahnya nol hari".
  const adaKuota = quotaDays !== null && quotaDays !== undefined && quotaDays !== '';
  const pakai = Number.isFinite(Number(terpakai)) ? Number(terpakai) : 0;

  if (!deductsQuota) {
    return { keadaan: KEADAAN.TIDAK_DIPOTONG, kuota: null, terpakai: pakai, sisa: null, habis: false };
  }
  if (!adaKuota) {
    return { keadaan: KEADAAN.TANPA_BATAS, kuota: null, terpakai: pakai, sisa: null, habis: false };
  }
  const kuota = Number(quotaDays);
  if (!Number.isFinite(kuota)) {
    return { keadaan: KEADAAN.TANPA_BATAS, kuota: null, terpakai: pakai, sisa: null, habis: false };
  }
  const sisa = kuota - pakai;
  return { keadaan: KEADAAN.BERKUOTA, kuota, terpakai: pakai, sisa, habis: sisa <= 0 };
}

/**
 * Hari terpakai per (user × jenis), dari daftar pengajuan.
 *
 * ============ HANYA `approved`, DAN HANYA TAHUN ITU ============
 *
 * `pending` TIDAK dihitung. Itu pilihan yang bisa diperdebatkan — admin yang
 * melihat "sisa 3" lalu menyetujui dua pengajuan tertunda masing-masing 2 hari
 * akan membuat sisanya minus. Jadi `ringkasTertunda()` di bawah melaporkannya
 * TERPISAH, bukan menambahkannya diam-diam ke `terpakai`.
 *
 * Alasan tidak digabung: "sisa cuti" yang berbeda dari yang dilihat staff di
 * aplikasinya sendiri akan memicu pertanyaan yang tidak bisa dijawab siapa pun.
 */
export function hitungTerpakai(pengajuan, tahun) {
  const peta = new Map();
  for (const p of Array.isArray(pengajuan) ? pengajuan : []) {
    if (p?.status !== 'approved') continue;
    const mulai = teks(p.start_date);
    if (tahun != null && mulai.slice(0, 4) !== String(tahun)) continue;
    const kunci = `${p.user_id}|${p.leave_type_id}`;
    peta.set(kunci, (peta.get(kunci) ?? 0) + (Number(p.day_count) || 0));
  }
  return peta;
}

/** Hari TERTUNDA per (user × jenis) — dilaporkan terpisah, tidak dijumlahkan. */
export function hitungTertunda(pengajuan, tahun) {
  const peta = new Map();
  for (const p of Array.isArray(pengajuan) ? pengajuan : []) {
    if (p?.status !== 'pending') continue;
    const mulai = teks(p.start_date);
    if (tahun != null && mulai.slice(0, 4) !== String(tahun)) continue;
    const kunci = `${p.user_id}|${p.leave_type_id}`;
    peta.set(kunci, (peta.get(kunci) ?? 0) + (Number(p.day_count) || 0));
  }
  return peta;
}

/**
 * Susun tabel sisa cuti: satu baris per staff, satu kolom per jenis cuti.
 *
 * @param {object} o
 *   staff        [{ user_id, full_name, outlet_name? }]
 *   jenis        [{ id, name, deducts_quota }]
 *   entitlements [{ user_id, leave_type_id, quota_days }]
 *   pengajuan    [{ user_id, leave_type_id, day_count, status, start_date }]
 *   tahun        number
 *
 * ============ STAFF TANPA HAK APA PUN TETAP MUNCUL ============
 *
 * Kalau ia disaring keluar, layar ini menjadi "daftar staff yang jatahnya sudah
 * diatur" — dan orang yang BELUM diatur, yaitu justru yang perlu ditindak,
 * tidak terlihat sama sekali. Daftar yang menyembunyikan kasus yang perlu
 * dikerjakan lebih buruk daripada daftar yang panjang.
 */
export function susunSisaCuti({ staff, jenis, entitlements, pengajuan, tahun } = {}) {
  const daftarJenis = (Array.isArray(jenis) ? jenis : []).filter((j) => j && j.id);
  const terpakai = hitungTerpakai(pengajuan, tahun);
  const tertunda = hitungTertunda(pengajuan, tahun);

  const hak = new Map();
  for (const e of Array.isArray(entitlements) ? entitlements : []) {
    hak.set(`${e.user_id}|${e.leave_type_id}`, e.quota_days);
  }

  const baris = (Array.isArray(staff) ? staff : []).map((s) => {
    const sel = daftarJenis.map((j) => {
      const kunci = `${s.user_id}|${j.id}`;
      const punyaHak = hak.has(kunci);
      const h = hitungSisa({
        quotaDays: punyaHak ? hak.get(kunci) : null,
        deductsQuota: !!j.deducts_quota,
        terpakai: terpakai.get(kunci) ?? 0
      });
      return {
        jenisId: j.id,
        jenis: j.name,
        punyaHak,
        tertunda: tertunda.get(kunci) ?? 0,
        ...h
      };
    });
    return {
      userId: s.user_id,
      nama: s.full_name ?? '-',
      outlet: s.outlet_name ?? s.outlet ?? '',
      // Staff yang sama sekali belum diberi hak apa pun ditandai, supaya bisa
      // dicari cepat — ini keadaan yang perlu dikerjakan, bukan sekadar nol.
      belumDiatur: sel.every((c) => !c.punyaHak),
      sel
    };
  });

  return { tahun, jenis: daftarJenis, baris };
}

/** Kalimat ringkas untuk satu sel — dipakai tabel dan ekspor sekaligus. */
export function teksSel(sel) {
  if (!sel) return '-';
  if (sel.keadaan === KEADAAN.TIDAK_DIPOTONG) return '—';
  if (!sel.punyaHak) return 'belum diberi';
  if (sel.keadaan === KEADAAN.TANPA_BATAS) return `${sel.terpakai} terpakai`;
  return `${sel.sisa} dari ${sel.kuota}`;
}

/**
 * Ringkasan untuk banner di atas tabel.
 *
 * Yang dihitung adalah hal yang bisa DIKERJAKAN admin: staff yang jatahnya
 * belum diatur, dan staff yang jatahnya sudah habis atau minus.
 */
export function ringkasSisaCuti(tabel) {
  const baris = tabel?.baris ?? [];
  const belumDiatur = baris.filter((b) => b.belumDiatur).length;
  const habis = baris.filter((b) => b.sel.some((c) => c.keadaan === KEADAAN.BERKUOTA && c.habis)).length;
  const minus = baris.filter((b) => b.sel.some((c) => c.keadaan === KEADAAN.BERKUOTA && c.sisa < 0)).length;
  const adaTertunda = baris.filter((b) => b.sel.some((c) => c.tertunda > 0)).length;
  return { total: baris.length, belumDiatur, habis, minus, adaTertunda };
}

export function pesanRingkas(r) {
  if (!r || !r.total) return 'Belum ada staff di BU ini.';
  const bagian = [];
  // Minus disebut lebih dulu: ia keadaan yang paling salah, dan satu-satunya
  // yang tidak bisa terjadi tanpa ada yang menyetujui melampaui jatah.
  if (r.minus) bagian.push(`${r.minus} staff MELEBIHI jatah`);
  if (r.belumDiatur) bagian.push(`${r.belumDiatur} staff jatahnya belum diatur`);
  if (r.habis && !r.minus) bagian.push(`${r.habis} staff jatahnya habis`);
  if (r.adaTertunda) bagian.push(`${r.adaTertunda} staff punya pengajuan tertunda`);
  if (!bagian.length) return `${r.total} staff, semua jatahnya wajar.`;
  return `${r.total} staff · ` + bagian.join(' · ') + '.';
}
