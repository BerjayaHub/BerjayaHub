/**
 * Menggabungkan CUTI YANG DISETUJUI ke dalam tampilan jadwal shift.
 *
 * ============ CUTI TIDAK DISALIN, HANYA DIBACA ============
 *
 * `shift_schedules` tidak pernah menyimpan status cuti. Pengajuan cuti tetap
 * satu-satunya sumber kebenaran, dan layar jadwal membacanya saat menggambar.
 *
 * Akibatnya yang paling berharga: cuti yang DIBATALKAN langsung hilang dari
 * jadwal dengan sendirinya, dan shift yang tadinya sudah dijadwalkan muncul
 * kembali apa adanya. Tidak ada yang perlu disinkronkan, dan tidak mungkin ada
 * "cuti hantu" yang tertinggal karena satu trigger gagal.
 *
 * ============ KENAPA JADI MODUL TERSENDIRI ============
 *
 * Kuncinya `userId|tanggal`, dan salah format kunci adalah kegagalan yang
 * paling mudah terjadi sekaligus paling sulit dilihat: tidak ada error, sel
 * jadwalnya sekadar tidak pernah bertanda cuti. Ditulis terpisah supaya bisa
 * diuji tanpa browser.
 */

/**
 * Susun peta pencarian cepat dari hasil `cuti_disetujui_rentang()`.
 *
 * @param {Array<{user_id?:string, tanggal:string, jenis:string}>} baris
 * @returns {Map<string, {jenis:string}>} kunci `userId|YYYY-MM-DD`
 */
export function petaCuti(baris) {
  const peta = new Map();
  if (!Array.isArray(baris)) return peta;
  for (const b of baris) {
    if (!b?.user_id || !b?.tanggal) continue;
    peta.set(kunciCuti(b.user_id, b.tanggal), { jenis: b.jenis ?? 'Cuti', id: b.leave_request_id ?? null });
  }
  return peta;
}

/**
 * Kunci peta. SATU-SATUNYA tempat bentuknya ditentukan.
 *
 * Tanggal dari PostgREST bisa datang sebagai `2026-09-05` atau
 * `2026-09-05T00:00:00+00:00` tergantung tipe kolomnya. Kalau penyusun peta
 * dan pembacanya memakai bentuk yang berbeda, TIDAK ADA yang cocok — dan
 * gejalanya cuma "cuti tidak muncul", tanpa satu pun error.
 *
 * Karena itu pemotongannya dikerjakan di sini, dan pemanggil tidak pernah
 * merangkai kuncinya sendiri.
 */
export function kunciCuti(userId, tanggal) {
  return `${userId}|${keTanggal(tanggal)}`;
}

/**
 * Tanggal jadi 'YYYY-MM-DD'.
 *
 * Cabang `Date` di sini BELUM PERNAH TERPAKAI di aplikasi — PostgREST selalu
 * mengembalikan kolom `date` sebagai string. Saya menuliskannya terus terang
 * daripada mengaku ia penjaga.
 *
 * Dipertahankan karena ia murah dan kegagalannya mahal: kalau suatu saat
 * sumbernya berganti (mis. data disiapkan di sisi klien, atau dibaca lewat
 * jalur lain yang menghasilkan Date), `String(date)` menghasilkan
 * 'Sat Sep 05 2026 ...' dan SATU PUN kunci tidak akan cocok. Gejalanya cuma
 * "cuti tidak muncul di jadwal" — tanpa error, tanpa petunjuk.
 *
 * Ini persis yang terjadi pada tes PGlite-nya, yang memang mengembalikan Date.
 */
function keTanggal(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.slice(0, 10);
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** Cuti orang ini pada tanggal ini — atau `null`. */
export function cutiPada(peta, userId, tanggal) {
  if (!(peta instanceof Map)) return null;
  return peta.get(kunciCuti(userId, tanggal)) ?? null;
}

/**
 * Apa yang harus ditampilkan pada satu sel jadwal.
 *
 * CUTI MENANG ATAS SHIFT, dan itu keputusan yang disengaja: kalau seseorang
 * punya jadwal shift pagi DAN cutinya disetujui pada tanggal yang sama,
 * yang benar adalah ia tidak masuk. Menampilkan shiftnya akan membuat rekan
 * satu tim mengira ada yang menjaga pagi itu.
 *
 * Jadwal shiftnya TIDAK hilang — ia hanya tidak ditampilkan selama cutinya
 * masih berlaku, dan muncul kembali kalau cutinya dibatalkan.
 *
 * @returns {{mode:'cuti'|'off'|'shift'|'kosong', jenis?:string, shift?:object, terkunci:boolean}}
 */
export function selJadwal({ cuti, jadwal }) {
  if (cuti) {
    return {
      mode: 'cuti',
      jenis: cuti.jenis ?? 'Cuti',
      // Jadwal aslinya ikut dibawa supaya layar bisa mengatakan "cuti, padahal
      // dijadwalkan shift pagi" — keterangan yang dibutuhkan admin saat
      // mencari pengganti.
      shift: jadwal ?? null,
      terkunci: true
    };
  }
  if (!jadwal) return { mode: 'kosong', terkunci: false };
  if (jadwal.is_off) return { mode: 'off', terkunci: false };
  return { mode: 'shift', shift: jadwal, terkunci: false };
}

/**
 * Ringkasan untuk baris seorang staff pada satu minggu.
 *
 * Dipakai admin untuk melihat sekilas siapa yang minggu ini banyak kosongnya —
 * pertanyaan yang muncul justru saat sedang menyusun jadwal, bukan sesudahnya.
 */
export function ringkasBaris(sel) {
  const daftar = Array.isArray(sel) ? sel : [];
  return {
    cuti: daftar.filter((s) => s.mode === 'cuti').length,
    off: daftar.filter((s) => s.mode === 'off').length,
    shift: daftar.filter((s) => s.mode === 'shift').length,
    kosong: daftar.filter((s) => s.mode === 'kosong').length
  };
}
