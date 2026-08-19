/**
 * Kapan perubahan sesi BENAR-BENAR menuntut aplikasi digambar ulang.
 *
 * Tidak ada impor di berkas ini, dan sebaiknya tetap begitu: aturannya
 * menentukan apakah pekerjaan orang di layar dibuang atau tidak, dan itu harus
 * bisa diuji tanpa browser.
 *
 * =====================================================================
 * BUG YANG DIPERBAIKI — DAN INI AKAR MASALAHNYA
 * =====================================================================
 *
 * Keluhannya: "halaman selalu refresh, isian form hilang" — di HP MAUPUN di
 * browser desktop, di modul apa pun.
 *
 * Di HP, kecurigaan pertama masuk akal: Android membuang halaman yang di latar
 * belakang. Tapi desktop TIDAK melakukan itu pada tab yang aktif. Berarti ada
 * kode sendiri yang menggambar ulang — dan memang ada:
 *
 *     onAuthStateChange((_event, newSession) => {
 *       if (newSession?.user) renderShell();   // <- membangun ulang SEMUANYA
 *       else renderLogin();
 *     });
 *
 * `onAuthStateChange` TIDAK hanya menyala saat masuk & keluar. Supabase juga
 * memanggilnya untuk:
 *
 *   - `INITIAL_SESSION`  — sekali, tepat setelah pendengarnya dipasang
 *   - `TOKEN_REFRESHED`  — tiap kali token diperbarui, dan itu terjadi persis
 *                          saat tab kembali aktif setelah ditinggal
 *   - `USER_UPDATED`     — mis. sesudah ganti kata sandi sendiri
 *
 * Ketiganya membawa `newSession.user` yang terisi, jadi ketiganya memicu
 * `renderShell()`. Orangnya berpindah tab, kembali, dan seluruh isian lenyap —
 * bukan karena sistem operasi, melainkan karena aplikasinya sendiri.
 *
 * Kegagalannya tidak pernah terlihat sebagai error: layarnya digambar ulang
 * dengan benar, cepat, dan rapi. Yang hilang cuma yang belum sempat disimpan.
 *
 * =====================================================================
 * ATURANNYA
 * =====================================================================
 *
 * Yang menentukan bukan JENIS peristiwanya, melainkan apakah SIAPA yang login
 * benar-benar berubah. Token boleh diperbarui seratus kali; selama orangnya
 * sama, tidak ada alasan membuang apa pun dari layar.
 *
 * Sengaja TIDAK memakai daftar nama peristiwa. Daftar seperti itu akan
 * ketinggalan begitu pustakanya menambah jenis baru — dan yang ketinggalan
 * akan diam-diam kembali menggambar ulang.
 */

/**
 * @param {string|null} uidAwal id user yang sedang aktif saat pendengar dipasang
 * @returns {(sesiBaru: {user?: {id?: string}} | null) => 'shell'|'login'|'abaikan'}
 */
export function buatPenjagaSesi(uidAwal = null) {
  let uidSekarang = uidAwal ?? null;

  return function putuskan(sesiBaru) {
    const uidBaru = sesiBaru?.user?.id ?? null;
    // Orang yang sama -> tidak ada yang perlu digambar ulang, apa pun
    // peristiwanya. Ini satu-satunya baris yang menyelamatkan isian.
    if (uidBaru === uidSekarang) return 'abaikan';
    uidSekarang = uidBaru;
    return uidBaru ? 'shell' : 'login';
  };
}
