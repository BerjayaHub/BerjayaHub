/**
 * ATURAN MODUL KONTEN SOSMED — tenggat, kelengkapan setoran, dan brief.
 *
 *   "saya yang mengatur jadwal setor nya di setiap outlet … jika tidak ada
 *    brief dari saya, maka default briefnya ambil minimal 1 video dan 1 foto,
 *    maksimal 3, bebas sebagus mungkin dengan kreatifitas mu"
 *
 * ============ TENGGAT DIHITUNG, BUKAN DIBUAT CRON ============
 *
 * Tugas mingguan tidak lahir dari pekerjaan terjadwal. Tenggatnya dihitung dari
 * `hari_setor` outlet setiap kali layarnya digambar.
 *
 * Alasannya satu kejadian nyata di repo ini: cron rekap Telegram melaporkan
 * `succeeded` berbulan-bulan sementara gerbangnya menolak dengan 401, dan tidak
 * ada yang tahu. Kalau tugas mingguan bergantung cron, cron yang mati diam-diam
 * berarti SELURUH outlet berhenti punya tugas — dan gejalanya cuma layar kosong,
 * yang tidak terlihat seperti kerusakan.
 *
 * Dihitung saat dibaca, tidak ada yang bisa mati diam-diam.
 *
 * ============ SEMUA TANGGAL 'YYYY-MM-DD', BUKAN OBJEK WAKTU ============
 *
 * Aturan yang sama dengan `jadwal-item.js` di modul Daily Activities, dan
 * alasannya sama: pekerjaan ini dihitung per HARI kerja. Memakai timestamp
 * berarti "minggu ini" bisa bergeser tergantung jam berapa orangnya membuka
 * aplikasi, dan di WIB pergeseran 7 jam dari UTC cukup untuk memindahkan
 * setoran malam ke hari sebelumnya.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa browser.
 */

const HARI_MS = 24 * 60 * 60 * 1000;

/** Nama hari untuk layar. Indeks mengikuti `getUTCDay()` dan `extract(dow)`. */
export const NAMA_HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

/**
 * Brief bawaan — SATU sumber, dan ia DITAMPILKAN, bukan disembunyikan.
 *
 * Kalimatnya milik pemiliknya, ditulis ulang apa adanya. Yang penting bukan
 * gayanya melainkan bahwa Admin Portal menampilkan teks INI juga saat brief
 * dikosongkan — supaya admin selalu tahu persis apa yang sedang dibaca staff.
 *
 * Nilai bawaan yang hanya hidup di dalam kode adalah nilai yang tidak bisa
 * diperiksa siapa pun: admin mengira brief-nya tersimpan, staff membaca sesuatu
 * yang lain, dan tidak ada layar yang menunjukkan keduanya berbeda.
 */
export const BRIEF_BAWAAN =
  'Ambil minimal 1 video dan 1 foto, maksimal 3 berkas. Bebas — sebagus mungkin dengan kreativitasmu.';

/** Batas jumlah berkas. Angka yang sama dijaga trigger di 0163. */
export const MIN_VIDEO = 1;
export const MIN_FOTO = 1;
export const MAKS_BERKAS = 3;

const teks = (v) => (v === null || v === undefined ? '' : String(v).trim());

/**
 * Tanggal 'YYYY-MM-DD' dari apa pun yang masuk akal.
 *
 * Cabang `Date` BELUM TERPAKAI di aplikasi — PostgREST selalu memulangkan kolom
 * `date` sebagai string. Ditulis terus terang alih-alih mengaku penjaga: ia
 * murah, dan kegagalannya mahal. `String(date)` menghasilkan
 * 'Fri Oct 23 2026 …', dan SATU PUN perbandingan tanggal tidak akan cocok —
 * gejalanya cuma "tugasnya tidak muncul", tanpa galat.
 */
export function keTanggal(v) {
  if (v == null) return '';
  if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '';
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  return '';
}

/** 'YYYY-MM-DD' -> Date tengah malam UTC. Dipakai aritmetika hari. */
function keUtc(tgl) {
  const t = keTanggal(tgl);
  if (!t) return null;
  const d = new Date(`${t}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const dariUtc = (d) => d.toISOString().slice(0, 10);

/**
 * Tenggat setor untuk MINGGU BERJALAN, dihitung dari hari setor outlet.
 *
 * ============ KENAPA HARI INI DIANGGAP MASIH SEMPAT ============
 *
 * Kalau hari setornya Jumat dan hari ini Jumat, tenggatnya HARI INI — bukan
 * Jumat depan.
 *
 * Tanpa itu, staff yang membuka aplikasi pada pagi hari tenggatnya akan melihat
 * tugas yang jatuh tempo seminggu lagi, menganggap belum waktunya, dan tenggat
 * hari itu lewat tanpa pernah terlihat. Kegagalan yang sepenuhnya diam.
 *
 * @param {string} hariIni 'YYYY-MM-DD'
 * @param {number} hariSetor 0=Minggu … 6=Sabtu
 * @returns {string} 'YYYY-MM-DD', atau '' kalau masukannya tidak masuk akal
 */
export function tenggatMingguIni(hariIni, hariSetor) {
  const d = keUtc(hariIni);
  // ============ `Number(null)` ADALAH 0, BUKAN NaN ============
  //
  // Dan 0 adalah hari Minggu yang sah. Jadi tanpa baris pertama ini, outlet
  // yang `hari_setor`-nya kosong — karena baris setelannya belum ada, atau
  // kolomnya gagal terbaca — diam-diam mendapat tenggat hari MINGGU alih-alih
  // ditolak. Tidak ada galat; tugasnya cuma jatuh di hari yang tidak pernah
  // dipilih siapa pun.
  //
  // Jebakan yang sudah berkali-kali ditulis di repo ini, dan saya tetap masuk
  // ke dalamnya di penjaga saya sendiri. Tesnya yang menemukan.
  if (hariSetor === null || hariSetor === undefined || hariSetor === '') return '';
  const h = Number(hariSetor);
  if (!d || !Number.isInteger(h) || h < 0 || h > 6) return '';
  const selisih = (h - d.getUTCDay() + 7) % 7;
  return dariUtc(new Date(d.getTime() + selisih * HARI_MS));
}

/** Tenggat periode SEBELUMNYA — dipakai admin melihat minggu lalu. */
export function tenggatSebelumnya(tenggat) {
  const d = keUtc(tenggat);
  return d ? dariUtc(new Date(d.getTime() - 7 * HARI_MS)) : '';
}

/** Selisih hari (tenggat - hariIni). Negatif berarti sudah lewat. */
export function sisaHari(hariIni, tenggat) {
  const a = keUtc(hariIni);
  const b = keUtc(tenggat);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / HARI_MS);
}

export const STATUS = {
  BELUM: 'belum',
  DISETOR: 'disetor',
  SELESAI: 'selesai'
};

export const LABEL_STATUS = {
  [STATUS.BELUM]: 'Belum setor',
  [STATUS.DISETOR]: 'Sudah setor',
  [STATUS.SELESAI]: 'Selesai'
};

/**
 * Keadaan satu tugas untuk ditampilkan.
 *
 * `telat` hanya berlaku untuk yang BELUM disetor. Tugas yang sudah disetor
 * sehari setelah tenggat tidak perlu diteriaki lagi — pekerjaannya sudah
 * dilakukan, dan menandainya merah terus-menerus membuat warna merah berhenti
 * berarti apa pun di layar ini.
 */
export function keadaanTugas(tugas, hariIni) {
  const status = teks(tugas?.status) || STATUS.BELUM;
  const sisa = sisaHari(hariIni, tugas?.tenggat);
  const belum = status === STATUS.BELUM;
  return {
    status,
    label: LABEL_STATUS[status] ?? status,
    sisaHari: sisa,
    telat: belum && sisa !== null && sisa < 0,
    jatuhTempoHariIni: belum && sisa === 0,
    // Berkasnya sudah dibersihkan — layar harus mengatakan itu, bukan
    // menampilkan pemutar video yang kosong.
    berkasDihapus: !!tugas?.berkas_dihapus_at
  };
}

/**
 * Brief yang BENAR-BENAR dibaca staff, beserta ASALNYA.
 *
 * Asalnya ikut dipulangkan supaya Admin Portal bisa menuliskannya: "memakai
 * brief bawaan" vs "memakai brief tetap outlet" vs "brief khusus tugas ini".
 *
 * Tanpa itu, admin yang mengisi brief lalu salah simpan tidak punya cara tahu
 * — layarnya menampilkan sesuatu yang masuk akal, dan yang dibaca staff adalah
 * teks yang lain.
 */
export function briefEfektif(sumber) {
  // `= {}` pada destrukturisasi HANYA menangkap `undefined`, bukan `null`.
  // Pemanggil yang mengirim hasil pencarian yang gagal (`null`) akan membuat
  // layarnya mati dengan "Cannot destructure property of null" — galat yang
  // tidak menyebut apa pun tentang brief. Ditemukan tesnya.
  const o = sumber ?? {};
  const khusus = teks(o.briefTugas);
  if (khusus) return { teks: khusus, asal: 'tugas' };
  const tetap = teks(o.briefTetapOutlet);
  if (tetap) return { teks: tetap, asal: 'outlet' };
  return { teks: BRIEF_BAWAAN, asal: 'bawaan' };
}

export const ASAL_BRIEF = {
  tugas: 'Brief khusus tugas ini',
  outlet: 'Brief tetap outlet ini',
  bawaan: 'Brief bawaan (kamu belum mengisi brief)'
};

/**
 * Apakah setorannya sudah lengkap menurut aturan?
 *
 * ============ "LENGKAP" BUKAN "BOLEH DISIMPAN" ============
 *
 * Batas bawah (1 video + 1 foto) TIDAK ditegakkan database — lihat alasannya
 * di 0163. Staff mengunggah videonya dulu dan fotonya menyusul semenit
 * kemudian; menjadikannya syarat menyimpan berarti unggahan pertama selalu
 * ditolak.
 *
 * Fungsi ini yang menjawab "sudah lengkap belum", dan layar memakainya untuk
 * memberi tahu apa yang KURANG — bukan untuk menolak.
 *
 * @param {Array<{jenis: string}>} berkas
 */
export function kelengkapan(berkas) {
  const daftar = Array.isArray(berkas) ? berkas : [];
  const video = daftar.filter((b) => b?.jenis === 'video').length;
  const foto = daftar.filter((b) => b?.jenis === 'foto').length;
  const total = video + foto;

  const kurang = [];
  if (video < MIN_VIDEO) kurang.push(`${MIN_VIDEO - video} video`);
  if (foto < MIN_FOTO) kurang.push(`${MIN_FOTO - foto} foto`);

  return {
    video,
    foto,
    total,
    lengkap: kurang.length === 0,
    kurang,
    sisaSlot: Math.max(0, MAKS_BERKAS - total),
    penuh: total >= MAKS_BERKAS
  };
}

/**
 * Kalimat keadaan setoran untuk staff.
 *
 * Menyebut apa yang KURANG, bukan sekadar "belum lengkap". Kalimat yang tidak
 * menyebut pekerjaannya meninggalkan orangnya di tempat yang sama.
 */
export function pesanKelengkapan(k) {
  if (!k || !k.total) return `Belum ada yang diunggah. Minimal ${MIN_VIDEO} video dan ${MIN_FOTO} foto.`;
  if (!k.lengkap) return `Kurang ${k.kurang.join(' dan ')} lagi.`;
  if (k.penuh) return `Sudah lengkap (${k.video} video, ${k.foto} foto). Batas ${MAKS_BERKAS} berkas tercapai.`;
  return `Sudah lengkap (${k.video} video, ${k.foto} foto). Masih bisa menambah ${k.sisaSlot} berkas lagi.`;
}

/**
 * Boleh tidaknya satu berkas ditambahkan, beserta SEBABNYA.
 *
 * @param {Array} berkas yang sudah ada
 * @param {{jenis?: string, ukuran?: number}} calon
 * @param {{maksByte?: number}} [opsi] batas ukuran; `0`/kosong = tanpa batas
 */
export function bolehTambah(berkas, calon, opsi) {
  // Alasan yang sama dengan `briefEfektif`: `null` tidak tertangkap `= {}`.
  const maksByte = Number((opsi ?? {}).maksByte) || 0;
  const k = kelengkapan(berkas);
  if (k.penuh) {
    return { boleh: false, alasan: `Sudah ${MAKS_BERKAS} berkas. Hapus salah satu dulu kalau mau menggantinya.` };
  }
  const jenis = teks(calon?.jenis);
  if (jenis !== 'video' && jenis !== 'foto') {
    return { boleh: false, alasan: 'Hanya video atau foto yang bisa diunggah di sini.' };
  }
  // `Number(undefined)` adalah NaN, tapi `Number(null)` dan `Number('')`
  // adalah 0 — dan 0 akan lolos pemeriksaan "lebih besar dari batas" seolah
  // berkasnya kosong. Jadi yang tidak terbaca diperlakukan sebagai tidak
  // diketahui, bukan sebagai nol.
  const ukuran = calon?.ukuran === null || calon?.ukuran === undefined || calon?.ukuran === '' ? null : Number(calon.ukuran);
  if (maksByte > 0 && Number.isFinite(ukuran) && ukuran > maksByte) {
    const mb = Math.round(maksByte / (1024 * 1024));
    return {
      boleh: false,
      alasan: `Berkasnya lebih besar dari ${mb} MB. Rekam ulang dengan durasi lebih pendek, atau turunkan resolusi di setelan kamera.`
    };
  }
  return { boleh: true, alasan: '' };
}

/**
 * Ringkasan antrean untuk Admin Portal.
 *
 * Menjawab satu pertanyaan yang sekarang tidak bisa dijawab di mana pun:
 * "minggu ini siapa yang sudah setor, siapa belum, dan mana yang menunggu
 * saya tandai selesai."
 */
export function ringkasAntrean(tugasList, hariIni) {
  const daftar = Array.isArray(tugasList) ? tugasList : [];
  const hasil = { belum: 0, telat: 0, disetor: 0, selesai: 0, total: 0 };
  for (const t of daftar) {
    const k = keadaanTugas(t, hariIni);
    if (hasil[k.status] === undefined) continue;
    hasil[k.status] += 1;
    if (k.telat) hasil.telat += 1;
    hasil.total += 1;
  }
  return hasil;
}

/** Kalimat ringkas antrean. Menyebut pekerjaan yang ADA lebih dulu. */
export function pesanAntrean(r) {
  if (!r || !r.total) return 'Belum ada outlet yang memakai modul ini.';
  const bagian = [];
  if (r.disetor) bagian.push(`${r.disetor} menunggu kamu tandai selesai`);
  if (r.telat) bagian.push(`${r.telat} lewat tenggat dan belum setor`);
  else if (r.belum) bagian.push(`${r.belum} belum setor`);
  if (!bagian.length) return `Semua beres — ${r.selesai} selesai.`;
  return bagian.join(' · ') + '.';
}
