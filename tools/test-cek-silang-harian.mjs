/**
 * CEK SILANG HARIAN vs TURBOLY — tes murni.
 *
 *   §1 Cocok, beda, dan toleransi pembulatan.
 *   §2 Hari yang hanya ada di satu sisi dibedakan, bukan dianggap selisih.
 *   §3 Korporat TIDAK ikut dibandingkan, tapi tetap terlihat.
 *   §4 Selisih per jenis: dua kesalahan yang saling menutupi tetap terlihat.
 *   §5 Ringkasan memakai selisih MUTLAK juga.
 *   §6 Tanggal & pengelompokan.
 */
import { cekSilangHarian, ringkasCekSilang, catatanCekSilang, kunciTanggal, STATUS, PESAN_STATUS } from '../js/modules/bengkel/cek-silang-harian.js';

let gagal = 0, n = 0;
const cek = (nama, dapat, harap) => {
  n++;
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};
const benar = (nama, syarat, ket = '') => { n++; if (!syarat) { gagal++; console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`); } };

const H = (o) => ({ outlet_id: 'o1', sale_date: '2026-10-01', omzet_sparepart: 0, omzet_jasa: 0, outlets: { name: 'Malang' }, ...o });
const R = (o) => ({ outlet_id: 'o1', outlet_nama: 'Malang', tanggal: '2026-10-01', item_type: 'sparepart', total: 0, sumber: 'turboly', ...o });

// ===============================================================
console.log('§1 Cocok, beda, toleransi');
// ===============================================================
{
  const h = cekSilangHarian({
    harian: [H({ omzet_sparepart: 300000, omzet_jasa: 100000 })],
    rinci: [R({ total: 300000 }), R({ item_type: 'jasa', total: 100000 })]
  });
  cek('§1 cocok', h.baris[0].status, STATUS.COCOK);
  cek('§1 selisih nol', h.baris[0].selisih, 0);
  cek('§1 totalnya', [h.baris[0].harianTotal, h.baris[0].turbolyTotal], [400000, 400000]);
}
{
  const h = cekSilangHarian({ harian: [H({ omzet_sparepart: 305000 })], rinci: [R({ total: 300000 })] });
  cek('§1 beda', h.baris[0].status, STATUS.BEDA);
  cek('§1 selisihnya bertanda (staff lebih besar = positif)', h.baris[0].selisih, 5000);
}
{
  // Pembulatan kasir: Rp500 bukan kebocoran. Toleransi membuat yang benar
  // tidak ikut merah — daftar yang selalu merah berhenti dibaca orang.
  const h = cekSilangHarian({ harian: [H({ omzet_sparepart: 300500 })], rinci: [R({ total: 300000 })], toleransi: 1000 });
  cek('§1 dalam toleransi dianggap cocok', h.baris[0].status, STATUS.COCOK);
  cek('§1 tapi selisihnya tetap dicatat apa adanya', h.baris[0].selisih, 500);
}

// ===============================================================
console.log('§2 Hanya satu sisi');
// ===============================================================
{
  const h = cekSilangHarian({ harian: [H({ omzet_sparepart: 100000 })], rinci: [] });
  // BUKAN "beda Rp100.000": belum diimpor dan benar-benar tidak dibukukan
  // adalah dua hal yang berbeda, dan keduanya bukan selisih kas.
  cek('§2 staff melapor, Turboly kosong', h.baris[0].status, STATUS.TANPA_RINCI);
}
{
  const h = cekSilangHarian({ harian: [], rinci: [R({ total: 100000 })] });
  cek('§2 Turboly ada, staff belum lapor', h.baris[0].status, STATUS.TANPA_HARIAN);
}
benar('§2 tiap status punya kalimatnya', Object.values(STATUS).every((s) => PESAN_STATUS[s]));

// ===============================================================
console.log('§3 Korporat tidak ikut dibandingkan');
// ===============================================================
{
  const h = cekSilangHarian({
    harian: [H({ omzet_sparepart: 300000 })],
    rinci: [R({ total: 300000 }), R({ total: 5000000, sumber: 'korporat' })]
  });
  // Korporat ditagih kantor, tidak lewat kasir — memasukkannya membuat tiap
  // hari ber-invoice korporat tampak selisih, dan selisih yang selalu muncul
  // berhenti dibaca.
  cek('§3 tetap cocok', h.baris[0].status, STATUS.COCOK);
  cek('§3 korporat tampil sebagai kolom sendiri', h.baris[0].korporat, 5000000);
  cek('§3 tidak masuk sisi Turboly', h.baris[0].turbolyTotal, 300000);
  // Hari yang HANYA berisi korporat bukan "staff belum lapor".
  const h2 = cekSilangHarian({ harian: [], rinci: [R({ total: 1000000, sumber: 'korporat' })] });
  cek('§3 hari korporat saja tidak dituduh', h2.baris[0].status, STATUS.COCOK);
}

// ===============================================================
console.log('§4 Selisih per jenis');
// ===============================================================
{
  // Total sama persis, tapi sparepart kelebihan 50rb dan jasa kekurangan
  // 50rb. Itu DUA kesalahan yang saling menutupi, bukan nol kesalahan.
  const h = cekSilangHarian({
    harian: [H({ omzet_sparepart: 350000, omzet_jasa: 50000 })],
    rinci: [R({ total: 300000 }), R({ item_type: 'jasa', total: 100000 })]
  });
  cek('§4 totalnya cocok', h.baris[0].selisih, 0);
  cek('§4 tapi per jenis terlihat', [h.baris[0].selisihSparepart, h.baris[0].selisihJasa], [50000, -50000]);
}

// ===============================================================
console.log('§5–§6 Ringkasan, tanggal, urutan');
// ===============================================================
{
  const h = cekSilangHarian({
    harian: [
      H({ sale_date: '2026-10-01', omzet_sparepart: 110000 }),
      H({ sale_date: '2026-10-02', omzet_sparepart: 90000 }),
      H({ sale_date: '2026-10-03', omzet_sparepart: 50000 })
    ],
    rinci: [R({ tanggal: '2026-10-01', total: 100000 }), R({ tanggal: '2026-10-02', total: 100000 })]
  });
  const r = h.ringkas;
  cek('§5 tiga hari', r.hari, 3);
  cek('§5 dua beda, satu tanpa rinci', [r.beda, r.tanpaRinci], [2, 1]);
  // +10.000 dan −10.000 saling menghapus jadi nol; yang mutlak tetap 20.000.
  cek('§5 selisih bersih menyesatkan', r.selisih, 50000);
  cek('§5 selisih mutlak jujur', r.selisihMutlak, 70000);
  // Terbaru dulu.
  cek('§6 urutan tanggal turun', h.baris.map((b) => b.tanggal), ['2026-10-03', '2026-10-02', '2026-10-01']);
  const c = catatanCekSilang(r);
  benar('§6 catatan menyebut hari yang beda', c.some((x) => /2 hari angkanya berbeda/.test(x)), JSON.stringify(c));
  benar('§6 dan yang belum diimpor', c.some((x) => /belum diimpor/.test(x)));
}
cek('§6 tanggal ISO', kunciTanggal('2026-10-01T00:00:00Z'), '2026-10-01');
cek('§6 tanggal kosong', kunciTanggal(''), '');
cek('§6 outlet berbeda tidak digabung',
  cekSilangHarian({ harian: [H({ outlet_id: 'o1' }), H({ outlet_id: 'o2', outlets: { name: 'Mojokerto' } })], rinci: [] }).baris.length, 2);
cek('§6 tanpa argumen tidak melempar', cekSilangHarian().baris, []);
cek('§6 semua cocok: catatannya menyebut itu', catatanCekSilang(ringkasCekSilang([{ status: STATUS.COCOK, harianTotal: 1, turbolyTotal: 1, korporat: 0, selisih: 0 }])), ['Semua hari cocok.']);

console.log(`\n${gagal === 0 ? '✅' : '❌'} test-cek-silang-harian: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
