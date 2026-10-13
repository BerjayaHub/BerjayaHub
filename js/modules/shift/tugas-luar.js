/**
 * TUGAS LUAR DI JADWAL SHIFT (0160) — keadaan ketiga sel jadwal.
 *
 *   "selain shift dan libur saya ingin ada pengaturan tugas luar di shift,
 *    jadi bisa atur tugas luar di modul shift"
 *
 * ============ YANG BERKAS INI JAGA ============
 *
 * Sel jadwal disimpan lewat SATU `<select>` yang nilainya menyandikan keadaan:
 *
 *   ''              belum dijadwalkan
 *   'off'           libur
 *   'tl:<uuid>'     tugas luar, berjenis <uuid>
 *   '<uuid>'        shift, ber-shift_id <uuid>
 *
 * Penyandian dan pembacaannya ADA DI SATU TEMPAT, dan itu seluruh alasan
 * berkas ini berdiri sendiri. Kalau penulis nilai dan pembaca nilai ditulis di
 * dua tempat, mereka cepat atau lambat menyimpang — dan menyimpangnya tidak
 * berbunyi: selnya tersimpan sebagai keadaan yang BERBEDA dari yang dipilih
 * orangnya, lalu digambar ulang dari database dengan tampilan yang benar
 * sampai ada yang memuat ulang halamannya.
 *
 * Dua uuid dibedakan oleh prefiks `tl:`, bukan oleh panjang atau isinya. Jenis
 * tugas luar dan shift keduanya uuid, jadi tanpa prefiks tidak ada cara
 * memisahkannya sama sekali — dan `shift_id` yang menunjuk jenis tugas luar
 * akan ditolak FK dengan pesan yang tidak menyebut apa pun tentang sel jadwal.
 *
 * ============ APA YANG TUGAS LUAR *TIDAK* UBAH ============
 *
 * Tugas Luar sudah berfungsi utuh di sisi presensi sejak 0006/0064 — `is_storing`,
 * `exit_task_mode`, `redeem_exit_otp`, `storing_bonus_amount`. Jadwal tugas luar
 * TIDAK melewati satu pun gerbang di sana:
 *
 *   - geofence tetap berlaku; staff yang berada di dalam area outlet mana pun
 *     (BU mana pun — `list_attendance_outlet()` memang tidak menyaring scope)
 *     tetap clock in biasa tanpa OTP;
 *   - OTP tetap diminta sesuai `exit_task_mode` BU-nya, hanya kalau geofence
 *     tidak menemukan satu pun outlet.
 *
 * Yang diberikan jadwal cuma KETERANGANNYA — terisi sendiri, masih bisa
 * diubah. Membuat jadwal melewati gerbangnya akan menukar satu kenyamanan
 * dengan satu lubang: sel jadwal bisa ditetapkan berhari-hari di muka oleh
 * orang yang tidak sedang melihat di mana staffnya berada.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa browser.
 */

const teks = (v) => (v === null || v === undefined ? '' : String(v).trim());

/** Nilai `<select>` untuk libur. */
export const NILAI_OFF = 'off';

/**
 * Prefiks penanda tugas luar pada nilai `<select>`.
 *
 * Dipakai bersama `NILAI_OFF` oleh penyandi DAN pembacanya, jadi mengubahnya
 * di satu tempat tidak mungkin membuat keduanya menyimpang.
 */
export const PREFIKS_TL = 'tl:';

export const MODE = {
  KOSONG: 'kosong',
  OFF: 'off',
  SHIFT: 'shift',
  TUGAS_LUAR: 'tugas-luar',
  CUTI: 'cuti'
};

/** Label satu baris jenis, apa adanya. Dipakai dropdown & chip. */
export function labelJenis(j) {
  return teks(j?.nama) || 'Tugas Luar';
}

/**
 * Nilai `<select>` untuk satu baris jadwal yang SUDAH ADA.
 *
 * ============ YANG BENAR-BENAR LOAD-BEARING DI SINI ============
 *
 * Yang menentukan bukan URUTAN cabangnya, melainkan ADANYA cabang
 * `is_tugas_luar`. Baris tugas luar ber-`is_off` false dan ber-`shift_id` null
 * — itu dijamin constraint `shift_libur_atau_tugas_luar` (0160) — jadi
 * memeriksa `is_off` lebih dulu pun tetap jatuh ke cabang yang benar.
 *
 * Saya sempat menuliskan urutannya sebagai hal yang menentukan, dan
 * sabotasenya membuktikan itu TIDAK benar: membalik urutannya tidak mengubah
 * satu pun hasil. Dibetulkan daripada dibiarkan — komentar yang mengklaim
 * sebuah penjaga lebih kuat dari kenyataannya membuat orang berikutnya
 * mempercayai penjaga yang tidak ada.
 *
 * Yang NYATA berbahaya adalah perhitungan lama tanpa cabang ini sama sekali
 * (`is_off ? 'off' : shift_id`): ia memulangkan `''` untuk baris tugas luar,
 * yaitu "belum dijadwalkan". Selnya digambar kosong, adminnya mengira tugas
 * luarnya gagal tersimpan, dan ia memilihnya lagi — menimpa baris yang
 * sebenarnya sudah benar. Itu yang dijaga tes & sabotasenya.
 */
export function nilaiSel(jadwal) {
  if (!jadwal) return '';
  if (jadwal.is_tugas_luar) {
    const id = teks(jadwal.tugas_luar_type_id);
    // Tugas luar WAJIB berjenis (constraint 0160). Kalau jenisnya toh kosong,
    // datanya sudah tidak sesuai constraint — lebih baik selnya kosong
    // daripada menyandikan `'tl:'` yang pembacanya tidak bisa pakai.
    return id ? `${PREFIKS_TL}${id}` : '';
  }
  if (jadwal.is_off) return NILAI_OFF;
  return teks(jadwal.shift_id);
}

/**
 * Baca nilai `<select>` jadi niat yang bisa dikirim ke `setSchedule`.
 *
 * Bentuk keluarannya sengaja SAMA untuk keempat keadaan — selalu memuat
 * `mode`, `shiftId`, `isOff`, `isTugasLuar`, `tugasLuarTypeId`. Pemanggil yang
 * hanya membaca sebagian kunci tidak akan pernah membaca `undefined` dan
 * mengirimnya sebagai "jangan ubah".
 */
export function bacaNilaiSel(nilai) {
  const v = teks(nilai);
  const kosong = { mode: MODE.KOSONG, shiftId: null, isOff: false, isTugasLuar: false, tugasLuarTypeId: null };
  if (!v) return kosong;
  if (v === NILAI_OFF) return { ...kosong, mode: MODE.OFF, isOff: true };
  if (v.startsWith(PREFIKS_TL)) {
    const id = v.slice(PREFIKS_TL.length);
    // `'tl:'` tanpa uuid bukan tugas luar yang sah, dan mengirimkannya akan
    // ditolak constraint di database dengan pesan tentang constraint — bukan
    // tentang jenis yang belum dipilih.
    if (!id) return kosong;
    return { ...kosong, mode: MODE.TUGAS_LUAR, isTugasLuar: true, tugasLuarTypeId: id };
  }
  return { ...kosong, mode: MODE.SHIFT, shiftId: v };
}

/**
 * Pilihan `<select>` untuk satu sel.
 *
 * Jenis tugas luar yang NONAKTIF tetap ditawarkan kalau ia nilai yang sedang
 * terpasang — alasan yang sama dengan supplier di luar daftar
 * (`supplier-kas.js`): tanpa itu, membuka sel yang sudah berisi jenis yang
 * baru dinonaktifkan akan menampilkannya kosong, dan menyentuh sel itu
 * MENGHAPUS hari kerja yang sudah ditetapkan.
 *
 * @param {Array} shifts         `outlet_shifts` yang aktif
 * @param {Array} jenisTugasLuar baris `tugas_luar_types`
 * @param {string} [nilaiSekarang]
 */
export function opsiSel(shifts, jenisTugasLuar, nilaiSekarang = '') {
  const sekarang = teks(nilaiSekarang);
  const opsi = [{ value: '', label: '–' }];

  for (const s of Array.isArray(shifts) ? shifts : []) {
    const id = teks(s?.id);
    if (!id) continue;
    opsi.push({ value: id, label: teks(s?.name) || 'Shift' });
  }

  opsi.push({ value: NILAI_OFF, label: 'Libur' });

  const terpasang = sekarang.startsWith(PREFIKS_TL) ? sekarang.slice(PREFIKS_TL.length) : '';
  for (const j of Array.isArray(jenisTugasLuar) ? jenisTugasLuar : []) {
    const id = teks(j?.id);
    if (!id) continue;
    if (j?.aktif === false && id !== terpasang) continue;
    opsi.push({
      value: `${PREFIKS_TL}${id}`,
      label: `Tugas Luar · ${labelJenis(j)}${j?.aktif === false ? ' (nonaktif)' : ''}`
    });
  }
  return opsi;
}

/**
 * Keterangan sel tugas luar untuk dibaca manusia.
 *
 * @param {object} jadwal baris `shift_schedules`
 * @param {Map<string,object>} jenisPerId
 * @param {Map<string,object>} outletPerId
 */
export function labelTugasLuar(jadwal, jenisPerId, outletPerId) {
  const j = jenisPerId?.get?.(teks(jadwal?.tugas_luar_type_id));
  // Jenis yang tidak ketemu di peta BUKAN jenis yang hilang — paling sering ia
  // cuma belum termuat (mis. jenis milik BU lain, atau daftar yang gagal
  // dibaca). Menuliskan "Tugas Luar" apa adanya lebih jujur daripada
  // "undefined", dan lebih berguna daripada sel kosong.
  const nama = j ? labelJenis(j) : 'Tugas Luar';
  const tujuan = outletPerId?.get?.(teks(jadwal?.tugas_luar_outlet_id));
  return tujuan ? `${nama} → ${teks(tujuan.name)}` : nama;
}

/**
 * Keterangan yang mengisi sendiri kotak "Keterangan tugas luar" saat clock in.
 *
 * Mengembalikan `''` kalau hari itu BUKAN tugas luar — pemanggil memakai itu
 * sebagai "jangan isi apa pun", bukan sebagai "isi dengan kosong".
 */
export function keteranganClockIn(jadwal, jenisPerId, outletPerId) {
  if (!jadwal?.is_tugas_luar) return '';
  return `Tugas luar: ${labelTugasLuar(jadwal, jenisPerId, outletPerId)}`;
}

/**
 * Nama status presensi hari tugas luar (0160), untuk rekap admin.
 *
 * `'tugas_luar'` adalah status TERSENDIRI, bukan `off_day` dan bukan
 * `no_schedule`. Lihat alasannya di migration: `no_schedule` muncul di rekap
 * sebagai kelalaian menyusun jadwal, dan admin lalu mencari jadwal hilang yang
 * sebenarnya tidak hilang.
 */
export const STATUS_PRESENSI_TUGAS_LUAR = 'tugas_luar';

/** Apakah daftar jenisnya kosong? Dipakai layar untuk mengatakan sebabnya. */
export function jenisAktif(jenisTugasLuar) {
  return (Array.isArray(jenisTugasLuar) ? jenisTugasLuar : []).filter((j) => j?.aktif !== false && teks(j?.nama));
}

/**
 * Periksa isian sebelum dikirim ke database.
 *
 * Pemeriksaan di layar BUKAN penjaga sesungguhnya — constraint
 * `shift_libur_atau_tugas_luar` dan trigger `jaga_jenis_tugas_luar` di 0160
 * yang menahannya. Gunanya di sini adalah mengatakannya dengan kalimat yang
 * bisa dikerjakan, bukan sebagai pesan constraint.
 */
export function periksaSelTugasLuar(niat, jenisTugasLuar) {
  if (!niat?.isTugasLuar) return null;
  if (!teks(niat.tugasLuarTypeId)) return 'Pilih dulu jenis tugas luarnya.';
  const ada = (Array.isArray(jenisTugasLuar) ? jenisTugasLuar : []).some((j) => teks(j?.id) === teks(niat.tugasLuarTypeId));
  if (!ada) {
    return 'Jenis tugas luar itu tidak ada di daftar BU ini. Muat ulang halamannya, lalu pilih lagi.';
  }
  return null;
}
