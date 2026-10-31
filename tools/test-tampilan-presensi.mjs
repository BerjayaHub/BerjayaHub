/**
 * TAMPILAN & SUARA PRESENSI — tes murni.
 *
 * ============ YANG SEBENARNYA DIUJI DI SINI ============
 *
 * Warna dan bunyi di modul ini BUKAN hiasan: keduanya dibaca/didengar lebih
 * dulu daripada tulisannya, oleh orang yang sedang tidak menatap layar. Jadi
 * yang diuji dua hal yang gagal tanpa galat:
 *
 *   keadaan salah warna   -> "sedang bekerja" yang keliru membuat orang
 *                            pulang tanpa merasa perlu menekan apa pun
 *   dua bunyi yang mirip  -> masuk dan pulang tidak bisa dibedakan tanpa
 *                            melihat layar, yang justru gunanya bunyi itu
 */
import {
  KEADAAN,
  TAMPILAN,
  bunyiUntuk,
  keadaanPresensi,
  tampilanPresensi
} from '../js/modules/attendance/tampilan-presensi.js';
import { panjangPola, polaNada } from '../js/core/suara-presensi.js';

let gagal = 0;
let n = 0;
const cek = (nama, dapat, harap) => {
  n++;
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};
const benar = (nama, syarat, ket = '') => {
  n++;
  if (!syarat) {
    gagal++;
    console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`);
  }
};

// ===============================================================
console.log('§1 Keadaan presensi');
// ===============================================================
cek('§1 tanpa sesi', keadaanPresensi(null), 'belum');
cek('§1 sesi tanpa clock in', keadaanPresensi({}), 'belum');
cek('§1 sudah clock in', keadaanPresensi({ clock_in_at: 'x' }), 'bekerja');
cek('§1 sudah clock out', keadaanPresensi({ clock_in_at: 'x', clock_out_at: 'y' }), 'selesai');
cek('§1 sedang istirahat', keadaanPresensi({ clock_in_at: 'x' }, { mulai_at: 'z' }), 'istirahat');

// ============ CLOCK OUT DIPERIKSA SEBELUM ISTIRAHAT ============
//
// Istirahat yang menggantung ditutup otomatis saat pulang (0138), tapi
// barisnya bisa masih terbaca sesaat. Kalau istirahat didahulukan, orang yang
// sudah pulang terlihat "sedang istirahat" — dan karena warna keduanya SAMA
// (kuning), kekeliruan itu tidak akan terlihat sebagai kekeliruan.
cek(
  '§1 sudah pulang menang atas istirahat yang menggantung',
  keadaanPresensi({ clock_in_at: 'x', clock_out_at: 'y' }, { mulai_at: 'z' }),
  'selesai'
);

// ===============================================================
console.log('§2 Rupa tiap keadaan');
// ===============================================================
for (const k of KEADAAN) {
  const r = tampilanPresensi(k);
  benar(`§2 ${k}: punya kelas`, /^att-state-/.test(r.kelas), r.kelas);
  benar(`§2 ${k}: punya lencana`, Boolean(r.lencana));
  benar(`§2 ${k}: punya judul`, Boolean(r.judul));
}
benar('§2 tiap keadaan punya kelas yang BERBEDA', new Set(KEADAAN.map((k) => TAMPILAN[k].kelas)).size === KEADAAN.length);
benar('§2 lencananya juga berbeda', new Set(KEADAAN.map((k) => TAMPILAN[k].lencana)).size === KEADAAN.length);

// ============ CADANGAN MENGARAH KE "BELUM", BUKAN "BEKERJA" ============
//
// Keadaan tak dikenal yang jatuh ke "bekerja" membuat orang pulang tanpa
// merasa perlu melakukan apa pun. Yang jatuh ke "belum" akan segera
// diperbaiki orangnya sendiri dengan menekan tombol.
cek('§2 keadaan tak dikenal jatuh ke "belum"', tampilanPresensi('entah').kelas, TAMPILAN.belum.kelas);
cek('§2 tanpa argumen', tampilanPresensi().kelas, TAMPILAN.belum.kelas);

// ===============================================================
console.log('§3 Bunyi masuk vs pulang');
// ===============================================================
const masuk = polaNada('masuk');
const pulang = polaNada('pulang');
benar('§3 masuk berbunyi', masuk.length > 0);
benar('§3 pulang berbunyi', pulang.length > 0);

// ============ ARAHNYA YANG MEMBEDAKAN, BUKAN SEKADAR NADANYA ============
//
// Dua bunyi berbeda yang sama-sama naik cuma terdengar seperti "bunyi
// aplikasi". Yang membuatnya bisa dibedakan tanpa dihafal adalah arahnya:
// masuk NAIK, pulang TURUN.
const naik = (p) => p.every((x, i) => i === 0 || x.hz > p[i - 1].hz);
const turun = (p) => p.every((x, i) => i === 0 || x.hz < p[i - 1].hz);
benar('§3 masuk nadanya NAIK', naik(masuk), JSON.stringify(masuk.map((x) => x.hz)));
benar('§3 pulang nadanya TURUN', turun(pulang), JSON.stringify(pulang.map((x) => x.hz)));
benar('§3 keduanya tidak sama', JSON.stringify(masuk) !== JSON.stringify(pulang));

// Istirahat sengaja datar & pendek: penanda, bukan pengumuman.
const istirahat = polaNada('istirahat');
benar('§3 istirahat tidak naik dan tidak turun', !naik(istirahat) && !turun(istirahat));
benar('§3 istirahat lebih pendek daripada masuk', panjangPola(istirahat) < panjangPola(masuk));

// Jenis tak dikenal DIAM. Memilih salah satu nada yang ada berarti "pulang"
// bisa terdengar seperti "masuk" pada hari seseorang menambahkan jenis baru.
cek('§3 jenis tak dikenal tidak berbunyi', polaNada('entah'), []);
cek('§3 tanpa argumen', polaNada(), []);

// Nadanya tidak boleh tumpang tindih sampai berdengung.
for (const [nama, pola] of [['masuk', masuk], ['pulang', pulang]]) {
  benar(`§3 ${nama}: tiap nada punya panjang`, pola.every((x) => x.lama > 0));
  benar(`§3 ${nama}: urut waktunya`, pola.every((x, i) => i === 0 || x.mulai >= pola[i - 1].mulai));
  // Bunyi tanda yang lebih dari setengah detik terasa seperti aplikasi yang
  // menahan orangnya.
  benar(`§3 ${nama}: tidak lebih dari 0,6 detik`, panjangPola(pola) <= 0.6, String(panjangPola(pola)));
}

// ===============================================================
console.log('§4 Aksi -> jenis bunyi');
// ===============================================================
cek('§4 clock in', bunyiUntuk('clock_in'), 'masuk');
cek('§4 clock out', bunyiUntuk('clock_out'), 'pulang');
cek('§4 mulai istirahat', bunyiUntuk('istirahat_mulai'), 'istirahat');
cek('§4 selesai istirahat', bunyiUntuk('istirahat_selesai'), 'istirahat');
cek('§4 aksi tak dikenal tidak berbunyi', bunyiUntuk('entah'), '');

// Rangkaiannya utuh: tiap jenis yang dipetakan harus punya polanya.
for (const aksi of ['clock_in', 'clock_out', 'istirahat_mulai']) {
  benar(`§4 "${aksi}" sampai ke pola yang berisi`, polaNada(bunyiUntuk(aksi)).length > 0);
}

// ---------------------------------------------------------------
console.log(`\n${gagal === 0 ? '✅' : '❌'} test-tampilan-presensi: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
