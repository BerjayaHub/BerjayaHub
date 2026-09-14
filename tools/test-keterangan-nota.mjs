/**
 * TES `js/modules/cash/keterangan-nota.js`.
 *
 * ============ YANG PALING PERLU DIJAGA ============
 *
 * Tautan yang menunjuk NOTA YANG SALAH. `TRM-1` adalah awalan `TRM-12`; kalau
 * yang pendek dicocokkan lebih dulu, ia memotong yang panjang di tengah dan
 * sisanya (`2`) jadi teks biasa. Yang terlihat di layar cuma nomor yang
 * sedikit terpotong — dan yang terbuka saat diketuk adalah nota orang lain.
 *
 * Yang kedua: nota yang kodenya TIDAK tertulis di keterangan. Keterangan boleh
 * diganti orangnya saat membayar ("Belanja mingguan"), dan satu entri bisa
 * melunasi lima nota sementara kalimatnya menyebut dua. Tanpa potongan
 * `tambahan`, notanya jadi mustahil dibuka dan tidak ada tanda apa pun.
 */
import { pecahKeterangan, petaNotaPerEntri, BATAS_POTONGAN } from '../js/modules/cash/keterangan-nota.js';

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

const N = (id, code) => ({ id, code });
/** Bentuk ringkas untuk dibandingkan: "teks" atau "teks@notaId". */
const ringkas = (bagian) => bagian.map((b) => (b.notaId ? `${b.teks}@${b.notaId}` : b.teks));

// =====================================================================
// §1 KASUS SEHARI-HARI
// =====================================================================
{
  const { bagian, tambahan } = pecahKeterangan('Pembayaran nota TRM-260912-56F0', [N('n1', 'TRM-260912-56F0')]);
  cek('§1 kode dipisah dari kalimatnya', ringkas(bagian), ['Pembayaran nota ', 'TRM-260912-56F0@n1']);
  cek('§1 tidak ada sisa', tambahan, []);
}
{
  const { bagian } = pecahKeterangan('Penyesuaian nota TRM-3 — koreksi isi nota', [N('n3', 'TRM-3')]);
  cek('§1 ekor kalimatnya dipertahankan', ringkas(bagian), ['Penyesuaian nota ', 'TRM-3@n3', ' — koreksi isi nota']);
}
{
  const { bagian } = pecahKeterangan('Pembayaran nota TRM-1, TRM-2', [N('a', 'TRM-1'), N('b', 'TRM-2')]);
  cek('§1 dua nota di satu kalimat', ringkas(bagian), ['Pembayaran nota ', 'TRM-1@a', ', ', 'TRM-2@b']);
}
{
  const { bagian } = pecahKeterangan('TRM-9 dibayar, lalu TRM-9 dikoreksi', [N('x', 'TRM-9')]);
  cek('§1 kode yang sama muncul dua kali, dua-duanya bisa diketuk', ringkas(bagian), [
    'TRM-9@x',
    ' dibayar, lalu ',
    'TRM-9@x',
    ' dikoreksi'
  ]);
}

// =====================================================================
// §2 KODE YANG SATU ADALAH AWALAN KODE LAINNYA
//
// Inti berkas ini. Kalau `TRM-1` menang, tautannya menunjuk nota yang SALAH
// dan yang terlihat cuma nomor yang sedikit terpotong.
// =====================================================================
{
  const { bagian } = pecahKeterangan('nota TRM-12', [N('pendek', 'TRM-1'), N('panjang', 'TRM-12')]);
  cek('§2 kode terpanjang menang', ringkas(bagian), ['nota ', 'TRM-12@panjang']);
  benar('§2 dan yang pendek tidak ikut menautkan', !ringkas(bagian).includes('TRM-1@pendek'));
}
{
  // Urutan daftar dibalik: hasilnya harus sama. Kalau tidak, jawabannya
  // bergantung pada urutan baris yang kebetulan dikirim database.
  const { bagian } = pecahKeterangan('nota TRM-12', [N('panjang', 'TRM-12'), N('pendek', 'TRM-1')]);
  cek('§2 tidak bergantung urutan daftar nota', ringkas(bagian), ['nota ', 'TRM-12@panjang']);
}
{
  // Yang paling KIRI menang lebih dulu daripada yang paling panjang.
  const { bagian } = pecahKeterangan('TRM-1 lalu TRM-12', [N('a', 'TRM-1'), N('b', 'TRM-12')]);
  cek('§2 yang paling kiri didahulukan', ringkas(bagian), ['TRM-1@a', ' lalu ', 'TRM-12@b']);
}

// =====================================================================
// §3 KODE YANG TIDAK TERTULIS DI KETERANGAN
// =====================================================================
{
  const { bagian, tambahan } = pecahKeterangan('Belanja mingguan', [N('n1', 'TRM-7')]);
  cek('§3 kalimatnya utuh', ringkas(bagian), ['Belanja mingguan']);
  cek('§3 notanya tetap ditawarkan', ringkas(tambahan), ['TRM-7@n1']);
}
{
  const { bagian, tambahan } = pecahKeterangan('Pembayaran nota TRM-1', [N('a', 'TRM-1'), N('b', 'TRM-2'), N('c', 'TRM-3')]);
  cek('§3 yang ketemu tidak diulang di tambahan', ringkas(tambahan), ['TRM-2@b', 'TRM-3@c']);
  cek('§3 yang ketemu tetap di kalimatnya', ringkas(bagian), ['Pembayaran nota ', 'TRM-1@a']);
}

// =====================================================================
// §4 MASUKAN YANG TIDAK RAPI
// =====================================================================
cek('§4 tanpa nota: satu potongan teks', ringkas(pecahKeterangan('Bensin motor', []).bagian), ['Bensin motor']);
cek('§4 keterangan null tidak melempar', pecahKeterangan(null, []).bagian, []);
cek('§4 keterangan kosong tidak melempar', pecahKeterangan('', [N('a', 'TRM-1')]).bagian, []);
cek('§4 nota kosong tetap ditawarkan walau keterangannya kosong', ringkas(pecahKeterangan('', [N('a', 'TRM-1')]).tambahan), [
  'TRM-1@a'
]);
cek('§4 nota tanpa id/kode diabaikan', ringkas(pecahKeterangan('apa pun', [{ id: 'a' }, { code: 'X' }, null]).tambahan), []);
cek('§4 notas bukan array diabaikan', ringkas(pecahKeterangan('apa pun', 'bukan array').bagian), ['apa pun']);

// KODE KOSONG. `''.indexOf('')` selalu 0 — kalau tidak disaring, putarannya
// tidak pernah maju dan layarnya menggantung tanpa satu pun error.
{
  const mulai = Date.now();
  const { bagian } = pecahKeterangan('abc', [{ id: 'a', code: '' }]);
  benar('§4 kode kosong tidak menggantungkan putaran', Date.now() - mulai < 1000);
  cek('§4 dan teksnya tetap utuh', ringkas(bagian), ['abc']);
}

// Penjaga putaran harus BENAR-BENAR membatasi, bukan sekadar ada.
{
  const panjang = 'TRM-1 '.repeat(BATAS_POTONGAN + 50);
  const { bagian } = pecahKeterangan(panjang, [N('a', 'TRM-1')]);
  benar('§4 penjaga putaran menahan keterangan yang sangat panjang', bagian.length <= BATAS_POTONGAN * 2 + 2);
  benar('§4 dan tetap menautkan bagian awalnya', bagian.some((b) => b.notaId === 'a'));
}

// =====================================================================
// §5 PASANGAN ENTRI ↔ NOTA
// =====================================================================
{
  const entries = [{ id: 'e1' }, { id: 'e2' }, { id: 'e3', penyesuaian_nota: 'n9' }];
  const notas = [
    { id: 'n1', code: 'TRM-1', payment_entry_id: 'e1' },
    { id: 'n2', code: 'TRM-2', payment_entry_id: 'e1' },
    { id: 'n5', code: 'TRM-5', payment_entry_id: 'e2' },
    { id: 'n9', code: 'TRM-9', payment_entry_id: null }
  ];
  const peta = petaNotaPerEntri(entries, notas);
  cek('§5 satu entri melunasi beberapa nota', peta.get('e1').map((n) => n.code), ['TRM-1', 'TRM-2']);
  cek('§5 entri lain hanya notanya sendiri', peta.get('e2').map((n) => n.code), ['TRM-5']);
  // INI yang membedakan dari `untuk_nota`: entri koreksi menyebut notanya
  // sendiri dan tidak ditunjuk `payment_entry_id` siapa pun.
  cek('§5 entri penyesuaian menemukan notanya', peta.get('e3').map((n) => n.code), ['TRM-9']);
}
{
  // Entri yang MELUNASI sekaligus MENYESUAIKAN nota yang sama tidak boleh
  // menampilkan nomor kembar.
  const peta = petaNotaPerEntri([{ id: 'e1', penyesuaian_nota: 'n1' }], [{ id: 'n1', code: 'TRM-1', payment_entry_id: 'e1' }]);
  cek('§5 nota tidak masuk dua kali ke entri yang sama', peta.get('e1').map((n) => n.code), ['TRM-1']);
}
{
  const peta = petaNotaPerEntri([{ id: 'e1' }], []);
  cek('§5 entri tanpa nota tidak punya kunci', peta.has('e1'), false);
  cek('§5 masukan kosong aman', petaNotaPerEntri().size, 0);
  cek('§5 masukan bukan array aman', petaNotaPerEntri('x', 'y').size, 0);
}
{
  // Nota yang menunjuk entri di luar daftar (mis. entri lama di luar 50 baris
  // terakhir) tidak boleh membuat apa pun kacau.
  const peta = petaNotaPerEntri([{ id: 'e1' }], [{ id: 'n1', code: 'TRM-1', payment_entry_id: 'e-lain' }]);
  cek('§5 nota milik entri di luar daftar tidak menempel ke entri lain', peta.has('e1'), false);
}

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('keterangan-nota.js benar — kode terpanjang menang, entri koreksi menemukan notanya, dan tidak ada nota yang mustahil dibuka. ✅');
