/**
 * TES: cuti disetujui yang muncul di jadwal shift.
 *
 * Yang dijaga di sini semuanya bertipe "salah tapi tidak error":
 *
 *   - bentuk kunci peta berbeda antara penyusun dan pembacanya
 *     -> tidak ada yang cocok, sel jadwal sekadar tidak pernah bertanda cuti
 *   - shift menang atas cuti
 *     -> rekan satu tim mengira ada yang menjaga pagi itu
 *   - jadwal aslinya dibuang saat cuti muncul
 *     -> admin kehilangan keterangan yang justru ia butuhkan untuk cari pengganti
 */
import { petaCuti, kunciCuti, cutiPada, selJadwal, ringkasBaris } from '../js/modules/shift/cuti-jadwal.js';

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};
const benar = (nama, syarat, ket = '') => {
  if (!syarat) {
    gagal++;
    console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`);
  }
};

const ADHE = 'u-adhe';
const SHENDA = 'u-shenda';

// =====================================================================
// 1. PETA — bentuk kunci harus tahan terhadap format tanggal
//
// PostgREST bisa mengembalikan `2026-09-05` ATAU
// `2026-09-05T00:00:00+00:00` tergantung tipe kolomnya. Kalau penyusun peta
// dan pembacanya memakai bentuk berbeda, tidak ada satu pun yang cocok — dan
// gejalanya cuma "cuti tidak muncul", tanpa error.
// =====================================================================
const peta = petaCuti([
  { user_id: ADHE, tanggal: '2026-09-05', jenis: 'Cuti Tahunan', leave_request_id: 'lr1' },
  { user_id: ADHE, tanggal: '2026-09-06', jenis: 'Cuti Tahunan', leave_request_id: 'lr1' },
  { user_id: SHENDA, tanggal: '2026-09-05T00:00:00+00:00', jenis: 'Sakit', leave_request_id: 'lr2' }
]);

cek('1. cuti Adhe 5 Sep ketemu', cutiPada(peta, ADHE, '2026-09-05')?.jenis, 'Cuti Tahunan');
cek('1. tanggal berstempel waktu tetap ketemu', cutiPada(peta, SHENDA, '2026-09-05')?.jenis, 'Sakit');
cek('1.   dicari dengan bentuk panjang pun ketemu', cutiPada(peta, SHENDA, '2026-09-05T00:00:00+00:00')?.jenis, 'Sakit');
cek('1. tanggal di luar cuti: null', cutiPada(peta, ADHE, '2026-09-07'), null);
cek('1. orang lain pada tanggal yang sama: null', cutiPada(peta, 'u-lain', '2026-09-05'), null);

cek('1. kunci dipotong ke 10 karakter', kunciCuti(ADHE, '2026-09-05T23:59:59Z'), 'u-adhe|2026-09-05');
cek('1. tanggal null tidak meledak', kunciCuti(ADHE, null), 'u-adhe|');

// Bentuk yang tidak lengkap dilewati, bukan menghasilkan kunci sampah.
const petaRusak = petaCuti([
  { tanggal: '2026-09-05', jenis: 'Cuti' },
  { user_id: ADHE, jenis: 'Cuti' },
  null,
  { user_id: SHENDA, tanggal: '2026-09-08', jenis: 'Izin' }
]);
cek('1. baris tanpa user/tanggal dilewati', petaRusak.size, 1);
cek('1.   yang sah tetap masuk', cutiPada(petaRusak, SHENDA, '2026-09-08')?.jenis, 'Izin');
cek('1. masukan bukan array: peta kosong', petaCuti(null).size, 0);
cek('1. peta bukan Map: null, tidak meledak', cutiPada(null, ADHE, '2026-09-05'), null);

// Jenisnya diambil apa adanya dari `leave_types` — BUKAN dari daftar tetap.
// BU boleh menambah jenisnya sendiri (PH, Izin Khusus, apa pun), dan modul ini
// tidak boleh perlu diubah setiap kali itu terjadi.
const petaPH = petaCuti([{ user_id: ADHE, tanggal: '2026-09-09', jenis: 'PH' }]);
cek('1. jenis buatan BU (PH) terbawa apa adanya', cutiPada(petaPH, ADHE, '2026-09-09')?.jenis, 'PH');

// =====================================================================
// 2. CUTI MENANG ATAS SHIFT
//
// Kalau shift yang menang, rekan satu tim akan mengira ada yang menjaga pagi
// itu — dan baru tahu saat outletnya kosong.
// =====================================================================
const shiftPagi = { is_off: false, shift_id: 's1', outlet_shifts: { name: 'Pagi' } };

const selCuti = selJadwal({ cuti: { jenis: 'Cuti Tahunan' }, jadwal: shiftPagi });
cek('2. mode cuti', selCuti.mode, 'cuti');
cek('2. jenisnya terbawa', selCuti.jenis, 'Cuti Tahunan');
cek('2. sel terkunci', selCuti.terkunci, true);

// JADWAL ASLINYA TETAP DIBAWA. Admin yang mencari pengganti perlu tahu shift
// apa yang kosong — "Adhe cuti" saja tidak cukup untuk menutup lubangnya.
cek('2. jadwal asli tetap terbawa', selCuti.shift?.outlet_shifts?.name, 'Pagi');

// =====================================================================
// 3. TANPA CUTI — perilaku lama tidak berubah
// =====================================================================
cek('3. shift biasa', selJadwal({ cuti: null, jadwal: shiftPagi }).mode, 'shift');
cek('3.   tidak terkunci', selJadwal({ cuti: null, jadwal: shiftPagi }).terkunci, false);
cek('3. libur', selJadwal({ cuti: null, jadwal: { is_off: true } }).mode, 'off');
cek('3.   libur tidak terkunci', selJadwal({ cuti: null, jadwal: { is_off: true } }).terkunci, false);
cek('3. belum dijadwalkan', selJadwal({ cuti: null, jadwal: null }).mode, 'kosong');
cek('3.   yang kosong justru harus bisa diisi', selJadwal({ cuti: null, jadwal: null }).terkunci, false);

// Cuti TANPA jadwal apa pun tetap tampil sebagai cuti.
const selCutiSaja = selJadwal({ cuti: { jenis: 'Sakit' }, jadwal: null });
cek('3. cuti tanpa jadwal: tetap cuti', selCutiSaja.mode, 'cuti');
cek('3.   dan tetap terkunci', selCutiSaja.terkunci, true);

// Jenis yang hilang tidak boleh menampilkan "undefined" di sel jadwal.
cek('3. jenis kosong: berlabel Cuti', selJadwal({ cuti: {}, jadwal: null }).jenis, 'Cuti');

// =====================================================================
// 4. RINGKASAN BARIS
// =====================================================================
const seminggu = [
  selJadwal({ cuti: { jenis: 'Cuti Tahunan' }, jadwal: shiftPagi }),
  selJadwal({ cuti: { jenis: 'Cuti Tahunan' }, jadwal: null }),
  selJadwal({ cuti: null, jadwal: shiftPagi }),
  selJadwal({ cuti: null, jadwal: { is_off: true } }),
  selJadwal({ cuti: null, jadwal: null })
];
cek('4. ringkasan seminggu', ringkasBaris(seminggu), { cuti: 2, off: 1, shift: 1, kosong: 1 });
cek('4. masukan bukan array tidak meledak', ringkasBaris(null), { cuti: 0, off: 0, shift: 0, kosong: 0 });

console.log(gagal === 0 ? '✅ cuti di jadwal shift: semua lulus' : `❌ cuti di jadwal shift: ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
