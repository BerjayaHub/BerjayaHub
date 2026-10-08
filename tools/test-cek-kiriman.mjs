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
// §5 MUATAN YANG DIKIRIM KE SERVER — HANYA BARIS YANG DISENTUH
//
// ============ DUA DEVICE, SATU SURAT JALAN ============
//
//   "staff bar pakai device a … begitu pula dengan staff kitchen dia memakai
//    device b, lalu tap simpan sementara keduanya … masih ada isu salah satu
//    dari mereka input nya tidak masuk"
//
// Di server (`simpan_cek_kiriman`, 0142) dua keadaan ini SENGAJA dibedakan:
//
//     kunci TIDAK ADA          -> "baris ini tidak sedang saya sentuh"
//     kunci ADA, nilainya null -> "batalkan ceknya"
//
// Versi lama `muatanCek` selalu menyertakan kuncinya untuk SETIAP kotak di
// layar — jadi device yang cuma mengisi separuh tabel mengirim `null` untuk
// separuh lainnya, dan menghapus hitungan device sebelah. Penjaga di server
// ada; layarnya yang mematahkannya.
// =====================================================================
{
  // `awal` = nilai saat barisnya digambar (hasil cek yang sudah ada di server).
  const awal = new Map([['a', ''], ['b', ''], ['c', '']]);
  const m = muatanCek(new Map([['a', '400'], ['b', ''], ['c', '0']]), awal);

  cek('§5 INTI: kotak kosong yang tidak disentuh TIDAK ikut dikirim', m.length, 2);
  benar('§5 baris b tidak ada di muatannya', !m.some((x) => x.item_id === 'b'));
  cek('§5 nol tetap 0 — itu jawaban, bukan ketiadaan', m.find((x) => x.item_id === 'c').dicek_qty, 0);
  cek('§5 angka apa adanya', m.find((x) => x.item_id === 'a').dicek_qty, 400);
}

{
  // Baris yang SUDAH terisi dari server dan tidak disentuh juga tidak dikirim.
  const m = muatanCek(new Map([['a', '400'], ['b', '12']]), new Map([['a', '400'], ['b', '12']]));
  cek('§5 INTI: tidak ada yang berubah -> muatannya kosong', m.length, 0);
}

{
  // Dikosongkan DENGAN SENGAJA tetap terkirim sebagai null — itulah satu-satunya
  // cara membatalkan cek, dan ia harus tetap bisa dilakukan.
  const m = muatanCek(new Map([['a', '']]), new Map([['a', '400']]));
  cek('§5 INTI: baris yang sengaja dikosongkan tetap dikirim', m.length, 1);
  benar('§5 kuncinya ada', Object.prototype.hasOwnProperty.call(m[0], 'dicek_qty'));
  cek('§5 nilainya null = "batalkan ceknya"', m[0].dicek_qty, null);
}

{
  // Angka yang DIUBAH (bukan diisi dari kosong) tetap terkirim.
  const m = muatanCek(new Map([['a', '380']]), new Map([['a', '400']]));
  cek('§5 angka yang dikoreksi tetap dikirim', m.length, 1);
  cek('§5 nilainya yang baru', m[0].dicek_qty, 380);
}

{
  // Tanpa `awal`: kotak kosong dianggap TIDAK disentuh, yang terisi dianggap
  // disentuh. Itu bawaan yang aman untuk pemanggil yang belum menyediakannya.
  const m = muatanCek(new Map([['a', '400'], ['b', '']]));
  cek('§5 tanpa awal: hanya yang terisi yang dikirim', m.length, 1);
  cek('§5 tanpa awal: yang terisi benar', m[0].item_id, 'a');
}

// ============ PERAGAAN DUA DEVICE ============
//
// Inilah kasus yang dilaporkan, dijalankan apa adanya.
{
  // Server: empat baris, belum ada yang dicek.
  const server = new Map([['bar1', null], ['bar2', null], ['kit1', null], ['kit2', null]]);
  const simpan = (muatan) => {
    for (const row of muatan) {
      if (!Object.prototype.hasOwnProperty.call(row, 'dicek_qty')) continue; // kunci tidak ada -> tidak disentuh
      server.set(row.item_id, row.dicek_qty);
    }
  };
  const render = () => new Map([...server.entries()].map(([k, v]) => [k, v == null ? '' : String(v)]));

  // Device A (bar) & device B (kitchen) sama-sama membuka layar saat server
  // masih kosong — itu yang membuat keduanya "tidak tahu" pekerjaan yang lain.
  const awalA = render();
  const awalB = render();

  // A mengisi baris bar, B mengisi baris kitchen.
  const layarA = new Map([...awalA.entries()]);
  layarA.set('bar1', '10');
  layarA.set('bar2', '0');
  const layarB = new Map([...awalB.entries()]);
  layarB.set('kit1', '5');
  layarB.set('kit2', '7');

  // B menekan Simpan Sementara duluan, lalu A.
  simpan(muatanCek(layarB, awalB));
  simpan(muatanCek(layarA, awalA));

  cek('§5 INTI: hitungan kitchen (device B) selamat', server.get('kit1'), 5);
  cek('§5 INTI: hitungan kitchen kedua selamat', server.get('kit2'), 7);
  cek('§5 INTI: hitungan bar (device A) ikut tersimpan', server.get('bar1'), 10);
  cek('§5 INTI: nol dari device A tetap nol, bukan hilang', server.get('bar2'), 0);

  // Dan urutan sebaliknya harus memberi hasil yang sama. Bug lamanya justru
  // bergantung pada urutan — itu sebabnya ia tidak selalu kelihatan.
  const server2 = new Map([['bar1', null], ['kit1', null]]);
  const simpan2 = (muatan) => {
    for (const row of muatan) {
      if (!Object.prototype.hasOwnProperty.call(row, 'dicek_qty')) continue;
      server2.set(row.item_id, row.dicek_qty);
    }
  };
  const awal2 = new Map([['bar1', ''], ['kit1', '']]);
  simpan2(muatanCek(new Map([['bar1', '10'], ['kit1', '']]), awal2));
  simpan2(muatanCek(new Map([['bar1', ''], ['kit1', '5']]), awal2));
  cek('§5 INTI: urutan terbalik, hasilnya sama — bar', server2.get('bar1'), 10);
  cek('§5 INTI: urutan terbalik, hasilnya sama — kitchen', server2.get('kit1'), 5);
}

cek('§5 bukan Map aman', muatanCek('x'), []);
cek('§5 tanpa argumen aman', muatanCek(), []);

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('cek-kiriman.js benar — kosong tidak tertukar dengan nol, cicilan lintas orang terhitung, dan muatannya tidak menghapus cek orang lain. ✅');
