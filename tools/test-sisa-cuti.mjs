/**
 * TES MURNI: aritmetika sisa cuti (tanpa database, tanpa DOM).
 *
 * Yang diuji bukan "apakah angkanya keluar", melainkan apakah keadaan yang
 * BERBEDA tetap berbeda. Hampir semua cara layar ini menyesatkan berbentuk dua
 * keadaan yang dilebur jadi satu angka:
 *
 *   jatah belum diatur  vs  jatah nol hari      -> penolakan yang tak terjelaskan
 *   tidak memotong jatah vs sisa nol            -> staff disuruh berhenti cuti sakit
 *   disetujui            vs  masih tertunda     -> sisa yang berbeda dari layar staff
 */
import assert from 'node:assert/strict';
import {
  KEADAAN,
  hitungSisa,
  hitungTerpakai,
  hitungTertunda,
  susunSisaCuti,
  teksSel,
  ringkasSisaCuti,
  pesanRingkas,
  tahunBerjalanWIB
} from '../js/modules/leave/sisa-cuti.js';

let n = 0;
const ok = (nama, fn) => {
  n++;
  try {
    fn();
  } catch (e) {
    console.error(`❌ ${nama}\n   ${e.message}`);
    process.exitCode = 1;
  }
};

// ---------------------------------------------------------------
console.log('§1 Tiga keadaan jatah tetap berbeda');
// ---------------------------------------------------------------

ok('kuota terisi -> berkuota, sisa dihitung', () => {
  const h = hitungSisa({ quotaDays: 12, deductsQuota: true, terpakai: 5 });
  assert.equal(h.keadaan, KEADAAN.BERKUOTA);
  assert.equal(h.sisa, 7);
  assert.equal(h.habis, false);
});

// ============ null BUKAN NOL ============
//
// `Number(null)` adalah 0, dan 0 hari adalah jatah yang SAH. Jadi kalau null
// dikonversi lebih dulu, "belum diatur" menjadi "jatahmu nol" — dan staff
// ditolak mengajukan cuti yang sebenarnya belum dibatasi siapa pun.
ok('kuota null -> TANPA_BATAS, bukan sisa 0', () => {
  const h = hitungSisa({ quotaDays: null, deductsQuota: true, terpakai: 3 });
  assert.equal(h.keadaan, KEADAAN.TANPA_BATAS);
  assert.equal(h.sisa, null, 'sisa harus null, bukan angka');
  assert.equal(h.habis, false, 'tanpa batas tidak pernah "habis"');
});

ok('kuota 0 -> BERKUOTA dengan sisa 0, berbeda dari null', () => {
  const h = hitungSisa({ quotaDays: 0, deductsQuota: true, terpakai: 0 });
  assert.equal(h.keadaan, KEADAAN.BERKUOTA);
  assert.equal(h.sisa, 0);
  assert.equal(h.habis, true);
});

ok('jenis yang tidak memotong jatah -> sisa tidak punya arti', () => {
  const h = hitungSisa({ quotaDays: 12, deductsQuota: false, terpakai: 40 });
  assert.equal(h.keadaan, KEADAAN.TIDAK_DIPOTONG);
  assert.equal(h.sisa, null);
  assert.equal(h.habis, false, 'cuti sakit tidak boleh terbaca "habis"');
});

ok('sisa minus dilaporkan apa adanya, bukan dipotong ke 0', () => {
  const h = hitungSisa({ quotaDays: 5, deductsQuota: true, terpakai: 8 });
  assert.equal(h.sisa, -3, 'menyembunyikan minus menyembunyikan persetujuan yang melampaui jatah');
  assert.equal(h.habis, true);
});

ok('masukan kosong tidak melempar', () => {
  assert.doesNotThrow(() => hitungSisa());
  assert.doesNotThrow(() => hitungSisa({}));
  assert.equal(hitungSisa({ deductsQuota: true, quotaDays: 10 }).terpakai, 0);
});

ok("terpakai yang bukan angka dianggap 0, bukan NaN", () => {
  const h = hitungSisa({ quotaDays: 10, deductsQuota: true, terpakai: 'abc' });
  assert.equal(h.terpakai, 0);
  assert.equal(h.sisa, 10, 'NaN akan merambat ke seluruh kolom dan tidak menunjuk sebabnya');
});

// ---------------------------------------------------------------
console.log('§2 Yang dihitung hanya approved, dan hanya tahun itu');
// ---------------------------------------------------------------

const PENGAJUAN = [
  { user_id: 'u1', leave_type_id: 't1', day_count: 2, status: 'approved', start_date: '2026-03-01' },
  { user_id: 'u1', leave_type_id: 't1', day_count: 3, status: 'approved', start_date: '2026-07-10' },
  { user_id: 'u1', leave_type_id: 't1', day_count: 4, status: 'pending', start_date: '2026-09-01' },
  { user_id: 'u1', leave_type_id: 't1', day_count: 9, status: 'rejected', start_date: '2026-04-01' },
  { user_id: 'u1', leave_type_id: 't1', day_count: 7, status: 'cancelled', start_date: '2026-05-01' },
  // Tahun lain — jatah penuh lagi tiap 1 Januari, jadi ini TIDAK boleh ikut.
  { user_id: 'u1', leave_type_id: 't1', day_count: 6, status: 'approved', start_date: '2025-12-20' },
  { user_id: 'u2', leave_type_id: 't1', day_count: 1, status: 'approved', start_date: '2026-02-02' }
];

ok('hanya approved yang masuk hitungan terpakai', () => {
  const peta = hitungTerpakai(PENGAJUAN, 2026);
  assert.equal(peta.get('u1|t1'), 5, 'rejected & cancelled tidak boleh ikut');
});

ok('tahun lain tidak ikut — jatah penuh lagi tiap Januari', () => {
  assert.equal(hitungTerpakai(PENGAJUAN, 2025).get('u1|t1'), 6);
});

ok('tertunda dihitung TERPISAH, tidak dijumlahkan ke terpakai', () => {
  const pakai = hitungTerpakai(PENGAJUAN, 2026);
  const tunda = hitungTertunda(PENGAJUAN, 2026);
  assert.equal(pakai.get('u1|t1'), 5);
  assert.equal(tunda.get('u1|t1'), 4);
  assert.notEqual(pakai.get('u1|t1'), 9, 'kalau digabung, angkanya beda dari yang dilihat staff sendiri');
});

ok('daftar kosong / null tidak melempar', () => {
  assert.equal(hitungTerpakai(null, 2026).size, 0);
  assert.equal(hitungTertunda(undefined, 2026).size, 0);
});

// ---------------------------------------------------------------
console.log('§3 Tabel: staff tanpa hak tetap muncul');
// ---------------------------------------------------------------

const STAFF = [
  { user_id: 'u1', full_name: 'Budi' },
  { user_id: 'u2', full_name: 'Ani' },
  { user_id: 'u3', full_name: 'Citra' } // sama sekali belum diberi hak
];
const JENIS = [
  { id: 't1', name: 'Cuti Tahunan', deducts_quota: true },
  { id: 't2', name: 'Cuti Sakit', deducts_quota: false }
];
const HAK = [
  { user_id: 'u1', leave_type_id: 't1', quota_days: 12 },
  { user_id: 'u2', leave_type_id: 't1', quota_days: null }
];

const TABEL = susunSisaCuti({ staff: STAFF, jenis: JENIS, entitlements: HAK, pengajuan: PENGAJUAN, tahun: 2026 });

ok('semua staff muncul, termasuk yang belum diatur', () => {
  assert.equal(TABEL.baris.length, 3);
  assert.equal(TABEL.baris[2].nama, 'Citra');
  assert.equal(TABEL.baris[2].belumDiatur, true, 'justru ini yang perlu dikerjakan admin');
});

ok('Budi: 12 - 5 = 7', () => {
  const sel = TABEL.baris[0].sel.find((s) => s.jenisId === 't1');
  assert.equal(sel.sisa, 7);
  assert.equal(sel.tertunda, 4, 'tertunda ikut dilaporkan, terpisah');
});

ok('Ani: punya hak tapi kuota null -> TANPA_BATAS', () => {
  const sel = TABEL.baris[1].sel.find((s) => s.jenisId === 't1');
  assert.equal(sel.punyaHak, true);
  assert.equal(sel.keadaan, KEADAAN.TANPA_BATAS);
});

ok('Citra: belum punya hak sama sekali', () => {
  const sel = TABEL.baris[2].sel.find((s) => s.jenisId === 't1');
  assert.equal(sel.punyaHak, false);
});

// ============ "BELUM DIBERI" ≠ "TANPA BATAS" ============
//
// Keduanya ber-`sisa: null`, jadi kalau layar hanya membaca `sisa`, keduanya
// tampil sama. Bedanya nyata: yang satu admin lupa mengatur, yang satu sengaja
// tidak dibatasi.
ok('teksSel membedakan belum-diberi dari tanpa-batas', () => {
  const ani = TABEL.baris[1].sel.find((s) => s.jenisId === 't1');
  const citra = TABEL.baris[2].sel.find((s) => s.jenisId === 't1');
  assert.equal(ani.sisa, citra.sisa, 'prasyarat: keduanya memang sama-sama null');
  assert.notEqual(teksSel(ani), teksSel(citra), 'tapi kalimatnya WAJIB berbeda');
  assert.equal(teksSel(citra), 'belum diberi');
});

ok('jenis yang tidak memotong jatah tidak menampilkan angka sisa', () => {
  const sel = TABEL.baris[0].sel.find((s) => s.jenisId === 't2');
  assert.equal(teksSel(sel), '—');
});

ok('teksSel tidak melempar untuk masukan kosong', () => {
  assert.doesNotThrow(() => teksSel(null));
  assert.equal(teksSel(null), '-');
});

ok('susunSisaCuti tidak melempar untuk masukan kosong', () => {
  assert.doesNotThrow(() => susunSisaCuti());
  assert.deepEqual(susunSisaCuti().baris, []);
});

// ---------------------------------------------------------------
console.log('§4 Ringkasan menyebut yang bisa dikerjakan');
// ---------------------------------------------------------------

ok('ringkasan menghitung belum-diatur', () => {
  const r = ringkasSisaCuti(TABEL);
  assert.equal(r.total, 3);
  assert.equal(r.belumDiatur, 1);
});

ok('minus disebut lebih dulu daripada habis', () => {
  const tabel = susunSisaCuti({
    staff: [{ user_id: 'u9', full_name: 'Dedi' }],
    jenis: [{ id: 't1', name: 'Tahunan', deducts_quota: true }],
    entitlements: [{ user_id: 'u9', leave_type_id: 't1', quota_days: 2 }],
    pengajuan: [{ user_id: 'u9', leave_type_id: 't1', day_count: 5, status: 'approved', start_date: '2026-01-05' }],
    tahun: 2026
  });
  const r = ringkasSisaCuti(tabel);
  assert.equal(r.minus, 1);
  assert.match(pesanRingkas(r), /MELEBIHI/, 'melampaui jatah tidak boleh tenggelam di bawah kalimat lain');
});

ok('semua wajar -> kalimatnya mengatakan begitu, bukan kosong', () => {
  const tabel = susunSisaCuti({
    staff: [{ user_id: 'u1', full_name: 'Budi' }],
    jenis: [{ id: 't1', name: 'Tahunan', deducts_quota: true }],
    entitlements: [{ user_id: 'u1', leave_type_id: 't1', quota_days: 12 }],
    pengajuan: [],
    tahun: 2026
  });
  assert.match(pesanRingkas(ringkasSisaCuti(tabel)), /wajar/);
});

ok('tanpa staff -> kalimat yang menjelaskan, bukan "0 staff"', () => {
  assert.match(pesanRingkas(ringkasSisaCuti(susunSisaCuti())), /Belum ada staff/);
});

// ---------------------------------------------------------------
console.log('§5 Tahun berjalan memakai WIB');
// ---------------------------------------------------------------

// 1 Januari 2027, 00:30 WIB = 31 Desember 2026, 17:30 UTC.
// Perangkat yang zona waktunya di belakang WIB masih di tahun 2026 saat itu —
// dan jatah yang belum ikut berganti tahun menolak cuti yang sudah boleh.
ok('dini hari 1 Januari WIB sudah dihitung tahun baru', () => {
  const utc = Date.parse('2026-12-31T17:30:00Z');
  assert.equal(tahunBerjalanWIB(utc), 2027);
});

ok('siang 31 Desember WIB masih tahun lama', () => {
  assert.equal(tahunBerjalanWIB(Date.parse('2026-12-31T05:00:00Z')), 2026);
});

console.log('');
if (process.exitCode) console.error('Ada pemeriksaan yang GAGAL.');
else console.log(`${n} pemeriksaan sisa cuti lolos. ✅`);
