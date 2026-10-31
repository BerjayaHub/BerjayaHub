/**
 * SUARA TANDA PRESENSI — clock in & clock out berbeda bunyinya.
 *
 * ============ KENAPA DIBANGKITKAN, BUKAN BERKAS MP3 ============
 *
 * Staff App dipakai di outlet dengan sinyal seadanya dan dipasang sebagai PWA.
 * Berkas audio berarti satu permintaan jaringan lagi tepat pada detik paling
 * genting — sesudah foto selfie terkirim, saat orangnya sedang menunggu
 * kepastian. Nada yang dibangkitkan WebAudio tidak pernah gagal dimuat, tidak
 * menambah ukuran aplikasi, dan berbunyi sama di semua perangkat.
 *
 * ============ NAIK vs TURUN, BUKAN SEKADAR "BERBEDA" ============
 *
 * Masuk = nada NAIK, pulang = nada TURUN. Arahnya bukan hiasan: ia yang
 * membuat dua bunyi itu bisa dibedakan tanpa dihafal, oleh orang yang sedang
 * tidak menatap layar. Dua bunyi berbeda yang sama-sama naik cuma terdengar
 * seperti "bunyi aplikasi".
 *
 * ============ SUARA TIDAK BOLEH MENGGAGALKAN APA PUN ============
 *
 * Presensi adalah pencatatan yang sah dengan atau tanpa bunyi. Jadi seluruh
 * berkas ini dibungkus `try/catch` yang menelan galatnya: AudioContext bisa
 * tidak ada (peramban lama), diblokir (belum ada ketukan), atau ditolak
 * (perangkat senyap). Tidak satu pun dari itu boleh berakhir sebagai clock in
 * yang gagal.
 */

/** Frekuensi nada dasar — nama not dipakai supaya polanya bisa dibaca. */
export const NADA = {
  C5: 523.25,
  E5: 659.25,
  G5: 783.99,
  A5: 880.0,
  C6: 1046.5
};

/**
 * Pola nada untuk satu kejadian presensi.
 *
 * Murni: mengembalikan daftar `{ hz, mulai, lama }` dalam detik, tanpa
 * menyentuh WebAudio sama sekali — supaya bisa diuji tanpa browser.
 *
 * @param {'masuk'|'pulang'|'istirahat'} jenis
 */
export function polaNada(jenis) {
  if (jenis === 'masuk') {
    // NAIK, tiga nada: terdengar seperti "diterima".
    return [
      { hz: NADA.C5, mulai: 0, lama: 0.12 },
      { hz: NADA.E5, mulai: 0.1, lama: 0.12 },
      { hz: NADA.G5, mulai: 0.2, lama: 0.22 }
    ];
  }
  if (jenis === 'pulang') {
    // TURUN, tiga nada: terdengar seperti "selesai".
    return [
      { hz: NADA.G5, mulai: 0, lama: 0.12 },
      { hz: NADA.E5, mulai: 0.1, lama: 0.12 },
      { hz: NADA.C5, mulai: 0.2, lama: 0.26 }
    ];
  }
  if (jenis === 'istirahat') {
    // Dua nada datar, lebih pendek: penanda, bukan pengumuman.
    return [
      { hz: NADA.A5, mulai: 0, lama: 0.1 },
      { hz: NADA.A5, mulai: 0.14, lama: 0.14 }
    ];
  }
  // Jenis yang tidak dikenal TIDAK berbunyi. Memilih salah satu nada yang ada
  // berarti "pulang" bisa terdengar seperti "masuk" pada hari seseorang
  // menambahkan jenis baru dan lupa polanya.
  return [];
}

/** Total panjang pola, untuk tes & untuk menutup context-nya. */
export function panjangPola(pola) {
  return (Array.isArray(pola) ? pola : []).reduce((maks, n) => Math.max(maks, (n?.mulai ?? 0) + (n?.lama ?? 0)), 0);
}

let ctx = null;

function ambilContext() {
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  if (!ctx || ctx.state === 'closed') ctx = new AC();
  // Peramban menangguhkan context yang dibuat sebelum ada ketukan. Dibangunkan
  // di sini, bukan saat modul dimuat — pada detik ini ketukannya sudah pasti
  // ada (orangnya baru saja menekan tombol presensi).
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/**
 * Bunyikan pola. Tidak pernah melempar, tidak pernah menunggu.
 *
 * @param {'masuk'|'pulang'|'istirahat'} jenis
 */
export function bunyiPresensi(jenis) {
  try {
    const pola = polaNada(jenis);
    if (!pola.length) return;
    const ac = ambilContext();
    if (!ac) return;

    const t0 = ac.currentTime + 0.01;
    for (const n of pola) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      // Gelombang segitiga: lebih lembut daripada kotak/gigi gergaji, dan
      // masih terdengar jelas lewat speaker HP di ruangan ramai.
      osc.type = 'triangle';
      osc.frequency.value = n.hz;

      // Amplop naik-turun. Tanpa ini tiap nada berbunyi "klik" di awal dan
      // akhirnya — cacat yang terdengar seperti speaker rusak.
      const mulai = t0 + n.mulai;
      const akhir = mulai + n.lama;
      gain.gain.setValueAtTime(0.0001, mulai);
      gain.gain.exponentialRampToValueAtTime(0.18, mulai + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, akhir);

      osc.connect(gain).connect(ac.destination);
      osc.start(mulai);
      osc.stop(akhir + 0.02);
    }
  } catch {
    /* Presensinya tetap sah tanpa bunyi — lihat kepala berkas. */
  }
}
