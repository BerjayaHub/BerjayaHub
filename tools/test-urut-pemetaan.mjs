/**
 * TES `js/modules/inventory/urut-pemetaan.js`.
 *
 * ============ DELAPAN BARIS DI ANTARA 647 ============
 *
 * Kelompok Item punya 647 baris, dan yang belum dipetakan delapan. Lencana
 * "8 belum dipetakan" sudah menyebut jumlahnya sejak dulu — yang belum ada
 * adalah cara SAMPAI ke barisnya. Kalau urutannya salah, delapan baris itu
 * tetap tersebar di antara 639 baris lain, dan dokumen yang memuatnya diam-diam
 * tidak ikut terunduh.
 */
import { susunBarisPemetaan, perluCari, AMBANG_CARI } from '../js/modules/inventory/urut-pemetaan.js';

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

const nama = (hasil) => hasil.baris.map((b) => b.kunci);

// =====================================================================
// §1 YANG BELUM DIPETAKAN NAIK KE ATAS
// =====================================================================
{
  const peta = { Gula: 'GULA PASIR', Beras: '', Santan: 'SANTAN KARA', Tepung: '' };
  const h = susunBarisPemetaan(Object.keys(peta), (k) => peta[k]);
  cek('§1 yang belum dipetakan di atas', nama(h), ['Beras', 'Tepung', 'Gula', 'Santan']);
  cek('§1 jumlah yang belum', h.belum, 2);
  cek('§1 totalnya', h.total, 4);
  cek('§1 penandanya ikut', h.baris.map((b) => b.dipetakan), [false, false, true, true]);
}
{
  // Di dalam tiap kelompok: alfabetis. Tanpa itu, urutan 639 baris yang sudah
  // dipetakan mengikuti urutan datangnya dari database — yang tidak dijamin
  // sama antar pemuatan, jadi mencari satu nama berarti menyisir ulang.
  const h = susunBarisPemetaan(['Zaitun', 'Apel', 'Mangga'], () => 'ada');
  cek('§1 yang sudah dipetakan diurut alfabetis', nama(h), ['Apel', 'Mangga', 'Zaitun']);
}
{
  const h = susunBarisPemetaan(['Zaitun', 'Apel', 'Mangga'], () => '');
  cek('§1 yang belum dipetakan juga alfabetis', nama(h), ['Apel', 'Mangga', 'Zaitun']);
}
{
  // Urutan masukan tidak boleh menentukan hasilnya.
  const peta = { Beras: '', Gula: 'X' };
  cek('§1 tidak bergantung urutan masukan', nama(susunBarisPemetaan(['Beras', 'Gula'], (k) => peta[k])), ['Beras', 'Gula']);
  cek('§1 dibalik pun sama', nama(susunBarisPemetaan(['Gula', 'Beras'], (k) => peta[k])), ['Beras', 'Gula']);
}

// =====================================================================
// §2 "SUDAH DIPETAKAN" ITU APA
// =====================================================================
{
  // Spasi saja BUKAN padanan. Nilai yang isinya spasi akan berangkat ke ESB
  // sebagai sel kosong dan ditolak di sana — jauh dari layar ini.
  const h = susunBarisPemetaan(['A', 'B'], (k) => (k === 'A' ? '   ' : 'NILAI'));
  cek('§2 spasi saja dihitung belum dipetakan', h.belum, 1);
  cek('§2 dan naik ke atas', nama(h), ['A', 'B']);
  // Nilainya ikut dirapikan, supaya yang tersimpan tidak membawa spasi tepi.
  cek('§2 nilai dirapikan', h.baris.map((b) => b.nilai), ['', 'NILAI']);
}
{
  const h = susunBarisPemetaan(['A'], () => null);
  cek('§2 null dihitung belum dipetakan', h.belum, 1);
  cek('§2 dan nilainya jadi string kosong', h.baris[0].nilai, '');
}
{
  // Angka 0 sebagai padanan tetap padanan — COANo bisa saja bernilai "0".
  const h = susunBarisPemetaan(['A'], () => 0);
  cek('§2 nilai "0" tetap terhitung dipetakan', h.belum, 0);
}

// =====================================================================
// §3 MASUKAN YANG TIDAK RAPI
// =====================================================================
cek('§3 daftar kosong', susunBarisPemetaan([], () => ''), { baris: [], belum: 0, total: 0 });
cek('§3 bukan array', susunBarisPemetaan('x', () => '').total, 0);
cek('§3 tanpa argumen', susunBarisPemetaan().total, 0);
cek('§3 tanpa fungsi nilai: semua dianggap belum', susunBarisPemetaan(['A', 'B']).belum, 2);
cek('§3 nilai bukan fungsi tidak melempar', susunBarisPemetaan(['A'], 'bukan fungsi').belum, 1);

// =====================================================================
// §4 KAPAN KOTAK CARI LAYAK MUNCUL
// =====================================================================
cek('§4 di bawah ambang: tidak perlu', perluCari(AMBANG_CARI), false);
cek('§4 di atas ambang: perlu', perluCari(AMBANG_CARI + 1), true);
cek('§4 nol tidak perlu', perluCari(0), false);
cek('§4 bukan angka tidak perlu', perluCari('x'), false);
// Kelompok Item yang 647 baris jelas perlu; Payment Method yang 3 jelas tidak.
benar('§4 647 baris perlu kotak cari', perluCari(647));
benar('§4 3 baris tidak perlu', !perluCari(3));

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('urut-pemetaan.js benar — yang belum dipetakan naik ke atas, sisanya alfabetis, dan spasi tidak dianggap padanan. ✅');
