/**
 * TES `js/modules/dispatch/cek-kiriman.js`.
 *
 * ============ SATU PERBEDAAN YANG MENENTUKAN SEMUANYA ============
 *
 * KOSONG bukan NOL.
 *
 *   kotak kosong -> belum dihitung siapa pun
 *   kotak "0"    -> sudah dihitung, dan barangnya memang tidak datang
 *
 * `Number('')` adalah **0**. Kalau pembedanya hilang, kotak yang dibiarkan
 * kosong tercatat sebagai "barangnya tidak ada sama sekali" — stok outlet tidak
 * bertambah, dan susutnya dilaporkan sebesar seluruh kiriman. Kesalahan yang
 * berlawanan arah dari bug yang sedang diperbaiki, dan sama diamnya.
 */
import {
  bacaCek,
  sudahDicek,
  ringkasCek,
  teksKemajuan,
  pengecekTerakhir,
  muatanCek
} from '../js/modules/dispatch/cek-kiriman.js';

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

const it = (id, nama, kirim, dicek = null, extra = {}) => ({
  id,
  sent_qty: kirim,
  dicek_qty: dicek,
  products: { name: nama, base_unit: 'gr' },
  ...extra
});

// =====================================================================
// §1 KOSONG BUKAN NOL — inti seluruh berkas ini
// =====================================================================
cek('§1 kotak kosong = belum dicek', bacaCek(''), null);
cek('§1 spasi saja juga belum dicek', bacaCek('   '), null);
cek('§1 null belum dicek', bacaCek(null), null);
cek('§1 undefined belum dicek', bacaCek(undefined), null);
// INI yang membedakannya dari `Number('')`.
cek('§1 nol adalah JAWABAN', bacaCek('0'), 0);
cek('§1 nol sebagai angka juga', bacaCek(0), 0);
cek('§1 angka biasa', bacaCek('400'), 400);
cek('§1 desimal', bacaCek('12.5'), 12.5);
cek('§1 negatif ditolak', bacaCek('-5'), null);
cek('§1 bukan angka ditolak', bacaCek('abc'), null);
cek('§1 non-finite ditolak', bacaCek(Infinity), null);

cek('§1 sudahDicek: kosong', sudahDicek(''), false);
cek('§1 sudahDicek: nol', sudahDicek('0'), true);
cek('§1 sudahDicek: terisi', sudahDicek('400'), true);

// =====================================================================
// §2 RINGKASAN KEMAJUAN
// =====================================================================
const ITEMS = [it('a', 'Santan', 400), it('b', 'Beras', 0), it('c', 'Tepung', 2000)];

{
  const r = ringkasCek(ITEMS);
  cek('§2 belum ada yang dicek', [r.total, r.dicek, r.belum], [3, 0, 3]);
  cek('§2 nama yang belum dicek dibawa', r.namaBelum, ['Santan', 'Beras', 'Tepung']);
  cek('§2 belum selesai', r.selesai, false);
}
{
  // Hasil cek yang SUDAH TERSIMPAN ikut terhitung — inilah yang membuat
  // pengecekan bisa dicicil lintas orang & lintas HP.
  const r = ringkasCek([it('a', 'Santan', 400, 400), it('b', 'Beras', 0, 0), it('c', 'Tepung', 2000)]);
  cek('§2 dua tersimpan, satu belum', [r.dicek, r.belum], [2, 1]);
  cek('§2 yang belum disebut namanya', r.namaBelum, ['Tepung']);
}
{
  // Yang sedang DIKETIK menang atas yang tersimpan: layar harus menghitung apa
  // yang dilihat orangnya, bukan keadaan server beberapa detik lalu.
  const r = ringkasCek(ITEMS, new Map([['a', '400'], ['c', '1900']]));
  cek('§2 isian layar ikut dihitung', [r.dicek, r.belum], [2, 1]);
  cek('§2 dan susutnya', r.susut, 100);
}
{
  // Isian layar yang DIKOSONGKAN membatalkan hasil tersimpan — orangnya sengaja
  // menghapusnya, dan layar tidak boleh diam-diam memakai angka lama.
  const r = ringkasCek([it('a', 'Santan', 400, 400)], new Map([['a', '']]));
  cek('§2 dikosongkan di layar = belum dicek lagi', [r.dicek, r.belum], [0, 1]);
}
{
  const r = ringkasCek(ITEMS, new Map([['a', '400'], ['b', '0'], ['c', '2000']]));
  cek('§2 semuanya dicek', [r.dicek, r.belum, r.selesai], [3, 0, true]);
  cek('§2 tidak ada susut', r.susut, 0);
}
{
  // Barang yang datang LEBIH dari yang tertulis di SJ dihitung terpisah — ia
  // bukan susut negatif, dan mencampurnya membuat keduanya saling menutupi.
  const r = ringkasCek([it('a', 'Santan', 400, 450), it('b', 'Beras', 1000, 900)]);
  cek('§2 susut & lebih dipisah', [r.susut, r.lebih], [100, 50]);
}
cek('§2 daftar kosong aman', ringkasCek([]).selesai, false);
cek('§2 bukan array aman', ringkasCek('x').total, 0);
cek('§2 tanpa argumen aman', ringkasCek().total, 0);

// =====================================================================
// §3 KALIMAT KEMAJUAN
// =====================================================================
{
  const r = ringkasCek(ITEMS, new Map([['a', '400']]));
  const t = teksKemajuan(r);
  benar('§3 menyebut sekian dari sekian', t.includes('1 dari 3'), t);
  benar('§3 tidak mengaku siap', !/siap diterima/.test(t), t);
}
{
  const t = teksKemajuan(ringkasCek(ITEMS, new Map([['a', '1'], ['b', '0'], ['c', '1']])));
  benar('§3 selesai: mengaku siap', /siap diterima/.test(t), t);
}
{
  const t = teksKemajuan(ringkasCek(ITEMS), { nama: 'Risma', waktu: '09.14' });
  benar('§3 menyebut siapa terakhir', t.includes('Risma'), t);
  benar('§3 dan kapan', t.includes('09.14'), t);
}
cek('§3 tanpa item: tidak ada kalimat', teksKemajuan(ringkasCek([])), '');

// =====================================================================
// §4 SIAPA YANG TERAKHIR MENGECEK
// =====================================================================
{
  const daftar = [
    it('a', 'Santan', 400, 400, { dicek_at: '2026-09-17T02:00:00Z', pengecek: { full_name: 'Risma' } }),
    it('b', 'Beras', 0, 0, { dicek_at: '2026-09-17T04:30:00Z', pengecek: { full_name: 'Adhe' } }),
    it('c', 'Tepung', 2000)
  ];
  cek('§4 yang paling baru menang', pengecekTerakhir(daftar)?.nama, 'Adhe');
  // Urutan daftar tidak boleh menentukan jawabannya.
  cek('§4 tidak bergantung urutan', pengecekTerakhir([...daftar].reverse())?.nama, 'Adhe');
}
cek('§4 belum ada yang mengecek', pengecekTerakhir([it('a', 'Santan', 400)]), null);
cek('§4 waktu yang tidak terbaca dilewati', pengecekTerakhir([it('a', 'S', 1, 1, { dicek_at: 'bukan tanggal', pengecek: { full_name: 'X' } })]), null);
cek('§4 tanpa argumen aman', pengecekTerakhir(), null);

// =====================================================================
// §5 MUATAN YANG DIKIRIM KE SERVER
//
// Kunci `dicek_qty` HARUS selalu ada, termasuk saat nilainya null. Di server,
// kunci yang TIDAK ADA berarti "baris ini tidak sedang saya sentuh" sementara
// null berarti "batalkan ceknya" — dan layar memang sedang menyentuh semua
// baris yang ditampilkannya.
// =====================================================================
{
  const m = muatanCek(new Map([['a', '400'], ['b', ''], ['c', '0']]));
  cek('§5 satu baris per isian', m.length, 3);
  benar('§5 kunci dicek_qty selalu ada', m.every((x) => Object.prototype.hasOwnProperty.call(x, 'dicek_qty')));
  cek('§5 kosong jadi null, bukan 0', m.find((x) => x.item_id === 'b').dicek_qty, null);
  cek('§5 nol tetap 0', m.find((x) => x.item_id === 'c').dicek_qty, 0);
  cek('§5 angka apa adanya', m.find((x) => x.item_id === 'a').dicek_qty, 400);
}
cek('§5 bukan Map aman', muatanCek('x'), []);
cek('§5 tanpa argumen aman', muatanCek(), []);

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('cek-kiriman.js benar — kosong tidak tertukar dengan nol, cicilan lintas orang terhitung, dan muatannya tidak menghapus cek orang lain. ✅');
