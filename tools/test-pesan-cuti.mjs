/**
 * Tes: teks keputusan cuti — WhatsApp harus SEISI Telegram.
 *
 * Yang diuji bukan "apakah stringnya terbentuk", tapi hal-hal yang salahnya
 * tidak kelihatan salah:
 *
 *   - jumlah hari yang masih memakai angka PENGAJUAN padahal tanggalnya sudah
 *     dipersempit admin;
 *   - rentang yang tidak menyebut bahwa ia dipersempit, sehingga staff mengira
 *     ia sendiri yang salah mengetik;
 *   - penanda tebal WhatsApp yang memakai dua bintang (bintangnya lalu terlihat
 *     apa adanya di layar penerima).
 */
import assert from 'node:assert/strict';
import {
  barisKeputusanCuti,
  pesanCutiWa,
  pesanCutiTelegram,
  fmtRentang,
  fmtTanggal,
  diubahAdmin
} from '../js/modules/leave/pesan-cuti.js';

let lulus = 0;
const uji = (nama, fn) => {
  try {
    fn();
    lulus++;
  } catch (e) {
    console.error(`❌ ${nama}\n   ${e.message}`);
    process.exitCode = 1;
  }
};

const disetujui = {
  status: 'approved',
  user_profiles: { full_name: 'Rifki' },
  leave_types: { name: 'Cuti Tahunan' },
  start_date: '2026-09-04',
  end_date: '2026-09-08',
  day_count: 5,
  reviewer: { full_name: 'Iko' },
  review_note: 'silakan'
};

/** Diajukan 4–8, yang disetujui 6–8. */
const dipersempit = {
  ...disetujui,
  start_date: '2026-09-06',
  end_date: '2026-09-08',
  day_count: 3,
  start_date_awal: '2026-09-04',
  end_date_awal: '2026-09-08',
  day_count_awal: 5
};

uji('isi WhatsApp memuat semua yang ada di Telegram', () => {
  const wa = pesanCutiWa(disetujui);
  for (const potongan of ['Cuti Disetujui', 'Rifki', 'Cuti Tahunan', '4 Sep 2026', '8 Sep 2026', '5 hari', 'Iko', 'silakan']) {
    assert.ok(wa.includes(potongan), `WhatsApp tidak memuat "${potongan}"`);
  }
});

uji('INTI: WhatsApp bukan lagi satu kalimat', () => {
  // Bentuk lama: "Pengajuan cuti Anda (…) tanggal … telah DISETUJUI."
  const wa = pesanCutiWa(disetujui);
  assert.ok(wa.split('\n').length >= 6, `hanya ${wa.split('\n').length} baris — terlalu miskin`);
  assert.ok(!/telah DISETUJUI\./.test(wa), 'masih memakai kalimat tunggal versi lama');
});

uji('baris Telegram & WhatsApp identik isinya', () => {
  const bersih = (t) =>
    t
      .replace(/<\/?b>/g, '')
      .replace(/\*/g, '')
      .replace(/&amp;/g, '&');
  assert.equal(bersih(pesanCutiTelegram(disetujui)), bersih(pesanCutiWa(disetujui)));
});

uji('WhatsApp memakai SATU bintang, bukan dua', () => {
  const wa = pesanCutiWa(disetujui);
  assert.ok(!wa.includes('**'), 'dua bintang akan terlihat apa adanya di layar penerima');
  assert.ok(wa.includes('*Rifki*'));
});

uji('Telegram memakai <b>, dan teksnya di-escape', () => {
  const tg = pesanCutiTelegram({ ...disetujui, review_note: 'a < b & c' });
  assert.ok(tg.includes('<b>Rifki</b>'));
  assert.ok(tg.includes('a &lt; b &amp; c'));
  // Escape harus terjadi SEBELUM penanda tebal diubah, kalau tidak <b> yang
  // baru dibuat ikut jadi &lt;b&gt; dan pesannya penuh sampah.
  assert.ok(!tg.includes('&lt;b&gt;'), '<b> ikut ter-escape — urutannya terbalik');
});

uji('cuti ditolak memakai judul & ikon yang benar', () => {
  const wa = pesanCutiWa({ ...disetujui, status: 'rejected', review_note: 'jadwal padat' });
  assert.ok(wa.includes('Cuti Ditolak'));
  assert.ok(!wa.includes('Cuti Disetujui'));
  assert.ok(wa.includes('jadwal padat'));
});

uji('INTI: tanggal yang ditampilkan adalah yang DISETUJUI', () => {
  const wa = pesanCutiWa(dipersempit);
  assert.ok(wa.includes('6 Sep 2026'), 'harus menyebut tanggal yang berlaku');
  assert.ok(wa.includes('3 hari'), 'jumlah hari harus ikut yang disetujui, bukan yang diajukan');
});

uji('INTI: pengajuan aslinya tetap disebut, dengan alasannya', () => {
  // Tanpa baris ini, staff yang mengajukan 4–8 lalu menerima 6–8 akan mengira
  // ia salah mengetik pengajuannya sendiri.
  const wa = pesanCutiWa(dipersempit);
  assert.ok(wa.includes('Diajukan 4 Sep 2026 – 8 Sep 2026'));
  assert.ok(/dipersempit oleh admin/.test(wa));
});

uji('tanpa perubahan tanggal, baris "diajukan" TIDAK muncul', () => {
  // Baris yang selalu muncul berhenti diperhatikan justru saat ia berarti.
  assert.ok(!pesanCutiWa(disetujui).includes('Diajukan'));
  // Kolom jejaknya terisi tapi nilainya sama -> tetap tidak dianggap berubah.
  const sama = { ...disetujui, start_date_awal: '2026-09-04', end_date_awal: '2026-09-08' };
  assert.equal(diubahAdmin(sama), false);
  assert.ok(!pesanCutiWa(sama).includes('Diajukan'));
});

uji('penolakan tidak pernah menyebut "dipersempit"', () => {
  // Menolak sambil mengubah tanggal tidak punya arti apa pun — dan kalau
  // datanya toh terisi, pesannya tidak boleh membingungkan penerimanya.
  const wa = pesanCutiWa({ ...dipersempit, status: 'rejected' });
  assert.ok(!wa.includes('dipersempit'));
});

uji('cuti sehari tidak menulis rentang yang mengulang dirinya', () => {
  assert.equal(fmtRentang('2026-09-04', '2026-09-04'), '4 Sep 2026');
  assert.ok(fmtRentang('2026-09-04', '2026-09-05').includes('–'));
});

uji('tanggal dari PostgREST maupun Date sama hasilnya', () => {
  assert.equal(fmtTanggal('2026-09-04'), '4 Sep 2026');
  assert.equal(fmtTanggal('2026-09-04T00:00:00+07:00'), '4 Sep 2026');
});

uji('data yang bolong tidak melempar & tidak menulis "undefined"', () => {
  const wa = pesanCutiWa({ status: 'approved' });
  assert.ok(!/undefined|null|NaN/.test(wa), wa);
  assert.equal(fmtTanggal(null), '-');
  assert.equal(fmtTanggal('bukan tanggal'), '-');
  assert.ok(Array.isArray(barisKeputusanCuti({})));
});

// ===============================================================
// SELURUH ISI FORM — yang diminta: "termasuk alasan cuti"
// ===============================================================

const LENGKAP = {
  status: 'approved',
  user_profiles: { full_name: 'Rifki' },
  leave_types: { name: 'Cuti Tahunan' },
  business_units: { name: 'Awal Bermula Cafe' },
  outlets: { name: 'AB Gading Serpong' },
  start_date: '2026-09-04',
  end_date: '2026-09-08',
  day_count: 5,
  reason: 'acara keluarga di Bandung',
  attachment_path: 'cuti/abc.jpg',
  reviewer: { full_name: 'Iko' },
  review_note: 'disetujui, titip handover ke Amel'
};

uji('pesan keputusan membawa SELURUH isi formnya', () => {
  const wa = pesanCutiWa(LENGKAP);
  for (const potongan of [
    'Rifki',
    'Awal Bermula Cafe',
    'AB Gading Serpong',
    'Cuti Tahunan',
    '4 Sep 2026',
    'acara keluarga di Bandung',
    'Ada lampiran',
    'Iko',
    'titip handover ke Amel'
  ]) {
    assert.ok(wa.includes(potongan), `"${potongan}" hilang dari pesan:\n${wa}`);
  }
});

uji('alasan staff & catatan admin tidak tertukar', () => {
  const wa = pesanCutiWa(LENGKAP);
  // Keduanya dulu memakai 💬 — di pesan "Pengajuan Baru" untuk alasan staff,
  // di pesan keputusan untuk catatan admin. Begitu muncul bersamaan, ikon yang
  // sama membuat kalimat staff terbaca sebagai keputusan atasannya.
  assert.ok(wa.includes('Alasan: acara keluarga di Bandung'), wa);
  assert.ok(wa.includes('Catatan admin: disetujui, titip handover ke Amel'), wa);
  assert.ok(!wa.includes('💬 Catatan admin'), 'ikon alasan staff dipakai untuk catatan admin');
});

uji('baris yang datanya kosong tidak digambar sama sekali', () => {
  const wa = pesanCutiWa({ ...LENGKAP, reason: '   ', attachment_path: null, review_note: null, outlets: null, business_units: null });
  assert.ok(!wa.includes('Alasan:'), wa);
  assert.ok(!wa.includes('lampiran'), wa);
  assert.ok(!wa.includes('Catatan admin'), wa);
  assert.ok(!wa.includes('🏢'), wa);
  // Yang pasti ada tetap ada.
  assert.ok(wa.includes('Rifki') && wa.includes('Cuti Tahunan'));
});

uji('lokasi digabung rapi walau salah satunya kosong', () => {
  const cumaBu = pesanCutiWa({ ...LENGKAP, outlets: null });
  assert.ok(cumaBu.includes('🏢 Awal Bermula Cafe'), cumaBu);
  assert.ok(!cumaBu.includes('·'), 'pemisah tertinggal padahal outletnya kosong');
});

// ===============================================================
// REVISI (0178)
// ===============================================================

uji('revisi ditandai di baris paling atas', () => {
  const wa = pesanCutiWa({ ...LENGKAP, revisi_ke: 2, alasan_revisi: 'acara digeser', direvisi_by_nama: 'Iko' });
  // Pesan versi sebelumnya sudah beredar di chat dan tidak bisa ditarik.
  // Penandanya harus terbaca sebelum tanggalnya — yang membaca sambil lewat
  // berhenti di baris pertama.
  assert.ok(wa.split('\n')[0].includes('REVISI ke-2'), wa.split('\n')[0]);
  assert.ok(wa.includes('Direvisi oleh Iko: acara digeser'), wa);
});

uji('yang belum pernah direvisi bersih dari penandanya', () => {
  const wa = pesanCutiWa(LENGKAP);
  assert.ok(!/REVISI/.test(wa), wa);
  assert.ok(!/Direvisi/.test(wa), wa);
  // "REVISI ke-0" membuat orang mencari versi sebelumnya yang tidak pernah ada.
  assert.ok(!/REVISI/.test(pesanCutiWa({ ...LENGKAP, revisi_ke: 0 })));
});

uji('cuti yang dibatalkan punya judulnya sendiri', () => {
  const wa = pesanCutiWa({ ...LENGKAP, status: 'cancelled' });
  assert.ok(wa.includes('Dibatalkan'), wa);
  // Bukan "Ditolak": ditolak berarti admin tidak mengizinkan, dibatalkan
  // berarti cutinya tidak jadi dipakai. Dua hal yang berbeda bagi staff.
  assert.ok(!wa.includes('Ditolak'), wa);
});

uji('Telegram membawa isi yang sama dengan WhatsApp', () => {
  const r = { ...LENGKAP, revisi_ke: 1, alasan_revisi: 'digeser' };
  const polos = (t) => t.replace(/<\/?b>/g, '').replace(/\*/g, '').replace(/&amp;/g, '&');
  assert.equal(polos(pesanCutiTelegram(r)), polos(pesanCutiWa(r)));
});

if (!process.exitCode) console.log(`Pesan keputusan cuti: ${lulus} pemeriksaan lulus. ✅`);
