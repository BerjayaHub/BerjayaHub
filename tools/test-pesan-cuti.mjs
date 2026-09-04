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

if (!process.exitCode) console.log(`Pesan keputusan cuti: ${lulus} pemeriksaan lulus. ✅`);
