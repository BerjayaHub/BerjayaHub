/**
 * REVISI TRANSFER KAS — siapa boleh, dan apa akibatnya.
 *
 * Murni: tidak menyentuh DOM, tidak menyentuh Supabase.
 *
 * ============ KENAPA TRANSFER PUNYA JALUR SENDIRI ============
 *
 * Entri kas biasa menyentuh satu orang. Transfer menyentuh DUA, dan kedua
 * kakinya harus bergerak bersama atau tidak sama sekali. Karena itu tombolnya
 * bukan tombol "Ubah" yang sama: `ubah_kas` hanya bisa menyentuh satu baris,
 * dan memakainya di transfer akan mengurangi uang di satu sisi tanpa
 * menambahkannya di sisi lain.
 *
 * ============ AKIBATNYA DIKATAKAN SEBELUM DITEKAN ============
 *
 * Dua akibat yang tidak terlihat dari form-nya, dan keduanya menyentuh orang
 * yang TIDAK sedang memegang HP ini:
 *
 *   tujuan diganti      -> barisnya HILANG dari riwayat penerima lama, dan
 *                          saldonya ikut turun
 *   uangnya sudah dipakai -> saldo penerima lama jadi MINUS
 *
 * Keduanya memang diterima (salah alamat yang uangnya sudah terpakai harus
 * tetap punya jalan keluar), tapi tidak boleh terjadi diam-diam.
 */

const teks = (v) => (v === null || v === undefined ? '' : String(v));
const angka = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export const JENIS_TRANSFER = ['transfer_out', 'transfer_in'];

/** Apakah baris ini transfer antar pengguna? */
export function adalahTransfer(e) {
  return JENIS_TRANSFER.includes(teks(e?.entry_type));
}

/**
 * Keadaan tombol revisi untuk satu baris riwayat.
 *
 * Mengembalikan `tampil:false` untuk baris yang memang bukan transfer —
 * tombolnya tidak digambar sama sekali, bukan digambar mati. Tombol mati
 * hanya berguna kalau orang MENGHARAPKAN tombol di situ.
 *
 * @param {object} e baris riwayat (butuh `entry_type`, `dicoret_at`, `alasan_tolak_transfer`)
 */
export function keadaanRevisiTransfer(e) {
  if (!adalahTransfer(e)) return { tampil: false, boleh: false, alasan: '' };
  if (e?.dicoret_at) return { tampil: false, boleh: false, alasan: '' };

  const alasan = teks(e?.alasan_tolak_transfer).trim();
  // Kalau servernya belum mengirim kolom itu sama sekali (aplikasi lama,
  // migration belum dijalankan), tombolnya DIMATIKAN — bukan dibuka.
  // Membukanya berarti dialog yang isinya diisi lalu ditolak server dengan
  // pesan yang tidak menyebut sebab sebenarnya.
  if (e?.alasan_tolak_transfer === undefined) {
    return {
      tampil: true,
      boleh: false,
      alasan: 'Fitur revisi transfer belum aktif di server ini. Muat ulang halamannya; kalau tetap sama, hubungi admin.'
    };
  }
  return { tampil: true, boleh: alasan === '', alasan };
}

/**
 * Apa saja yang berubah — untuk ringkasan sebelum tombol ditekan.
 *
 * `semula` & `menjadi` memakai bentuk yang sama supaya layar tinggal
 * menderetkannya; yang tidak berubah TIDAK disebut, karena daftar perubahan
 * yang memuat baris "tidak berubah" membuat yang benar-benar berubah
 * tenggelam.
 */
export function perubahanTransfer(semula, menjadi) {
  const out = [];
  const jml0 = Math.abs(angka(semula?.jumlah));
  const jml1 = Math.abs(angka(menjadi?.jumlah));
  if (jml0 !== jml1) out.push({ apa: 'Jumlah', semula: jml0, menjadi: jml1, angka: true });

  const kan0 = teks(semula?.kantong) || 'Kas Utama';
  const kan1 = teks(menjadi?.kantong) || 'Kas Utama';
  if (kan0 !== kan1) out.push({ apa: 'Kantong asal', semula: kan0, menjadi: kan1, angka: false });

  const ke0 = teks(semula?.penerima);
  const ke1 = teks(menjadi?.penerima);
  if (ke0 !== ke1) out.push({ apa: 'Penerima', semula: ke0 || '-', menjadi: ke1 || '-', angka: false });

  const ket0 = teks(semula?.catatan).trim();
  const ket1 = teks(menjadi?.catatan).trim();
  if (ket0 !== ket1) out.push({ apa: 'Keterangan', semula: ket0 || '(kosong)', menjadi: ket1 || '(kosong)', angka: false });

  return out;
}

/**
 * Peringatan yang WAJIB ikut terbaca SEBELUM revisi disimpan.
 *
 * ============ YANG TIDAK BISA DIKETAHUI DARI SINI ============
 *
 * Saldo penerima lama ADA DI KAS ORANG LAIN, dan RLS memang tidak
 * mengizinkan pengirim membacanya. Jadi peringatan sebelum simpan tidak boleh
 * menyebut angkanya — ia hanya menyebut yang pasti: barisnya hilang dari
 * riwayat penerima lama, dan saldonya turun sebesar transfer itu.
 *
 * Percobaan pertama berkas ini menghitung "sisa = saldo − jumlah" dengan
 * saldo yang tidak pernah diketahui layar, jadi cabang MINUS-nya tidak pernah
 * bisa menyala. Peringatan yang mustahil muncul lebih buruk daripada tidak
 * ada: ia membuat yang membaca kodenya yakin keadaan itu sudah dijaga.
 * Angkanya datang SESUDAH, dari jawaban server — lihat `pesanSesudahRevisi`.
 *
 * @param {object} o
 * @param {string} o.penerimaLama nama penerima sebelum revisi
 * @param {string} o.penerimaBaru nama penerima sesudah revisi
 * @param {number} o.jumlahLama jumlah transfer yang akan ditarik kembali
 */
export function peringatanRevisi({ penerimaLama, penerimaBaru, jumlahLama } = {}) {
  const lama = teks(penerimaLama);
  const baru = teks(penerimaBaru);
  if (!lama || lama === baru) return [];

  return [
    `Baris ini akan HILANG dari riwayat kas ${lama}, dan saldonya berkurang ${Math.abs(angka(jumlahLama))}.`,
    `Kalau uangnya sudah terpakai, saldo ${lama} akan jadi MINUS. Beri tahu dia.`
  ];
}

/**
 * Kalimat SESUDAH revisi tersimpan — di sinilah angkanya diketahui.
 *
 * Server mengembalikan saldo penerima lama apa adanya (ia yang berhak
 * membacanya, bukan layar ini). Minus disebutkan terang-terangan: itu berarti
 * catatan dan uang di laci orang lain sudah tidak mungkin cocok sampai ada
 * yang menambalnya, dan satu-satunya orang yang tahu adalah yang baru saja
 * menekan tombol ini.
 */
export function pesanSesudahRevisi(hasil, namaPenerimaLama) {
  if (!hasil?.penerima_berubah) return '';
  const saldo = angka(hasil?.saldo_penerima_lama);
  const nama = teks(namaPenerimaLama) || 'penerima lama';
  if (saldo < 0) {
    return `Saldo ${nama} sekarang MINUS ${Math.abs(saldo)} — uangnya sudah terpakai sebelum transfer ini ditarik. Beri tahu dia.`;
  }
  return `Transfer ditarik dari ${nama}; saldonya sekarang ${saldo}.`;
}
