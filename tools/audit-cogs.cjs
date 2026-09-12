/**
 * AUDIT: Nilai Opname & laporan COGS.
 *
 * ============ SATU ANGKA SALAH YANG TIDAK TERLIHAT SALAH ============
 *
 *   COGS = stok awal + pembelian − stok akhir
 *
 * Tiga angka, dua di antaranya dari opname. Tiap cara ia bisa rusak
 * menghasilkan laporan yang tetap rapi:
 *
 *   opname tidak ada dianggap nol  -> COGS melonjak atau jadi negatif
 *   dipakai `system_qty`           -> stok akhir jadi angka CATATAN, padahal
 *                                     seluruh guna opname justru karena
 *                                     keduanya berbeda
 *   opname 'cancelled' ikut        -> dinilai dari hitungan yang sengaja tidak
 *                                     pernah diberlakukan ke stok (0085)
 *   nota batal ikut                -> pembelian, dan COGS, lebih besar
 *   stok awal diambil dari `from`  -> opname di dalam periode jadi stok awal,
 *                                     dan pembelian hari itu terhitung dua kali
 *
 * Tidak satu pun melempar error.
 */
const fs = require('fs');
const path = require('path');
const { tanpaKomentar } = require('./lib/tanpa-komentar.cjs');

const AKAR = path.dirname(__dirname);
let gagal = 0;
const salah = (pesan) => {
  gagal++;
  console.error(`❌ ${pesan}`);
};

const baca = (rel) => {
  const p = path.join(AKAR, rel);
  if (!fs.existsSync(p)) {
    salah(`${rel} tidak ada — audit ini kehilangan sasarannya.`);
    return null;
  }
  return fs.readFileSync(p, 'utf8');
};

// ---------------------------------------------------------------
// 1. Nilai Opname di laporan opname.
// ---------------------------------------------------------------
const opn = baca('js/modules/inventory/laporan-opname.js');
if (opn) {
  const kode = tanpaKomentar(opn);
  if (!/\{ header: 'Nilai Opname'/.test(kode)) {
    salah('laporan-opname.js: kolom `Nilai Opname` hilang — nilai stok yang benar-benar ada tidak disebut di mana pun.');
  }
  if (!/const nilaiAda = h == null \? null : h \* dihitung;/.test(kode)) {
    salah(
      'laporan-opname.js: Nilai Opname tidak dihitung dari `dihitung`. ' +
        'Kalau ia memakai `sistem`, angkanya jadi nilai CATATAN — dan seluruh guna opname justru karena keduanya berbeda.'
    );
  }
  if (!/nilaiOpnameTeks: denganNilai \? rupiah\(nilaiOpname\) : null/.test(kode)) {
    salah('laporan-opname.js: `nilaiOpnameTeks` tidak diekspor — layar tidak punya angka untuk ditampilkan.');
  }
  // Baris berstok tanpa HPP harus ditandai: ia membuat nilai opname lebih kecil.
  if (!/if \(h == null && \(selisih !== 0 \|\| dihitung !== 0\)\) adaTanpaHpp = true;/.test(kode)) {
    salah(
      'laporan-opname.js: baris BERSTOK tanpa HPP tidak lagi ditandai. ' +
        'Sejak ada kolom Nilai Opname, baris berselisih NOL pun menyumbang nilai — HPP yang kosong di situ ' +
        'membuat total nilai opname lebih kecil tanpa satu pun tanda.'
    );
  }
}

const opnAdmin = baca('js/modules/inventory/opname.admin.js');
if (opnAdmin && !/nilaiOpnameTeks/.test(tanpaKomentar(opnAdmin))) {
  salah('opname.admin.js: Nilai Opname tidak ditampilkan — angkanya dihitung tapi tidak pernah terlihat.');
}

// ---------------------------------------------------------------
// 2. Aturan COGS-nya sendiri.
// ---------------------------------------------------------------
const murni = baca('js/modules/report/cogs.js');
if (murni) {
  const kode = tanpaKomentar(murni);
  for (const n of ['nilaiStok', 'barisCogs', 'ringkasCogs']) {
    if (!new RegExp(`export function ${n}\\(`).test(kode)) salah(`cogs.js: \`${n}\` tidak diekspor.`);
  }
  if (!/cogs: nAwal \+ beli - nAkhir,/.test(kode)) {
    salah('cogs.js: rumus COGS berubah. Arah stok akhir paling mudah terbalik, dan hasilnya tetap terbaca wajar.');
  }
  // Opname bukan lagi SUMBER angkanya, melainkan penanda "sudah dikunci".
  if (!/terkunci: !!\(opnameAwal\?\.tanggal && opnameAkhir\?\.tanggal\)/.test(kode)) {
    salah(
      'cogs.js: penanda "dikunci opname" hilang. ' +
        'Angka yang berdiri di atas hitungan fisik dan yang baru menurut catatan TIDAK bisa dibedakan dari ' +
        'angkanya sendiri — perbedaan itu harus ditulis.'
    );
  }
  if (!/catatan\.push\(PERINGATAN_AKHIR_TANPA_OPNAME\)/.test(kode)) {
    salah('cogs.js: outlet tanpa opname akhir tidak diberi peringatan apa pun.');
  }
  // Saldo negatif harus ikut. Stok boleh menembus nol (0020/0134).
  if (/qty\s*<\s*0/.test(kode) || /Math\.max\(0,/.test(kode)) {
    salah('cogs.js: saldo negatif dibuang atau dijepit ke nol — nilai stok jadi lebih besar dari kenyataannya.');
  }
}

// ---------------------------------------------------------------
// 3. Cara datanya diambil.
// ---------------------------------------------------------------
const svc = baca('js/modules/report/report.service.js');
if (svc) {
  const kode = tanpaKomentar(svc);

  if (!/key: 'cogs'/.test(kode)) salah("report.service.js: laporan 'cogs' tidak terdaftar di katalog REPORTS.");
  if (!/build: buildCogs/.test(kode)) salah('report.service.js: `buildCogs` tidak dipasang ke entri katalognya.');

  const i = kode.indexOf('async function opnameTerakhirPerOutlet');
  const blokSesi = i >= 0 ? kode.slice(i, i + 1500) : '';
  if (!blokSesi) {
    salah('report.service.js: `opnameTerakhirPerOutlet` tidak ada.');
  } else {
    // 'closed' SAJA. 'open' belum selesai dihitung; 'cancelled' sengaja ditutup
    // TANPA menyentuh stok (0085) — menilai stok dari keduanya berarti memakai
    // hitungan yang belum atau tidak pernah berlaku.
    if (!/\.eq\('status', 'closed'\)/.test(blokSesi)) {
      salah(
        "report.service.js: opname yang dipakai tidak disaring `status = 'closed'`. " +
          "Sesi 'open' belum selesai dan 'cancelled' sengaja tidak pernah menyentuh stok — keduanya bukan keadaan rak."
      );
    }
    if (!/\.order\('count_date', \{ ascending: false \}\)/.test(blokSesi)) {
      salah('report.service.js: opname tidak diurutkan menurun — yang terambil bisa sesi paling AWAL, bukan paling akhir.');
    }
  }

  // Dipotong sampai FUNGSI BERIKUTNYA, bukan sejumlah karakter tetap.
  //
  // Percobaan pertama memakai `slice(j, j + 4000)` dan auditnya merah untuk
  // kode yang benar: `note:` berada di ujung `buildCogs`, beberapa ratus
  // karakter di luar jendelanya. Angka ajaib seperti itu ikut menyusut artinya
  // tiap kali fungsinya bertambah panjang — dan yang pertama terlewat selalu
  // pemeriksaan paling ujung.
  //
  // Lebih buruk lagi: selama auditnya merah tanpa syarat, SETIAP sabotase yang
  // bersandar padanya melaporkan "tertangkap" tanpa membuktikan apa pun.
  const j = kode.indexOf('async function buildCogs');
  const jSelesai = kode.indexOf('async function buildProfitLoss');
  const blok = j >= 0 ? kode.slice(j, jSelesai > j ? jSelesai : undefined) : '';
  if (!blok) {
    salah('report.service.js: `buildCogs` tidak ada.');
  } else {
    // Stok awal = keadaan SEBELUM hari pertama periode.
    if (!/sebelum\.setDate\(sebelum\.getDate\(\) - 1\);/.test(blok)) {
      salah(
        'report.service.js `buildCogs`: stok awal tidak lagi diambil dari SEHARI SEBELUM periode. ' +
          'Memakai `from` sendiri mengambil opname DI DALAM periode sebagai stok awal, dan pembelian hari itu ' +
          'jadi terhitung dua kali.'
      );
    }
    if (!/if \(n\.status === 'dibatalkan'\) continue;/.test(blok)) {
      salah(
        "report.service.js `buildCogs`: nota dibatalkan (0131) ikut dihitung sebagai pembelian. " +
          'Barangnya sudah ditarik — pembelian, dan karenanya COGS, jadi lebih besar dari yang sebenarnya.'
      );
    }
    // STOKNYA DARI SALDO, BUKAN DARI SATU SESI OPNAME.
    //
    // Sesi opname hanya berisi bahan yang dihitung di sesi itu; sesi perbaikan
    // berisi satu bahan. Memakainya sebagai "nilai seluruh stok" salah
    // beberapa ratus kali lipat, dan laporannya tetap tercetak rapi.
    // KEDUA UJUNGNYA diperiksa, masing-masing.
    //
    // Percobaan pertama cuma menuntut nama `nilaiStokPerOutlet` MUNCUL, dan
    // sabotase yang mematikan panggilan stok AWAL lolos — panggilan stok akhir
    // masih ada, jadi auditnya puas. Satu ujung yang kembali ke nol sudah
    // cukup membuat COGS anjlok atau melonjak.
    for (const [ujung, pola] of [
      ['awal', /nilaiStokPerOutlet\(\{ businessUnitId, outletId, tanggal: hariSebelum, hpp \}\)/],
      ['akhir', /nilaiStokPerOutlet\(\{ businessUnitId, outletId, tanggal: to, hpp \}\)/]
    ]) {
      if (!pola.test(blok)) {
        salah(
          `report.service.js \`buildCogs\`: stok ${ujung} tidak diambil dari saldo. ` +
            'Nilai satu sesi opname bukan nilai seluruh stok — sesi perbaikan hanya berisi bahan yang dibetulkan.'
        );
      }
    }
    if (/nilaiSesiOpname\(/.test(kode)) {
      salah(
        'report.service.js: `nilaiSesiOpname` hidup lagi. Itu jalur lama yang menilai stok dari SATU sesi opname, ' +
          'dan itulah bug yang dilaporkan (sesi perbaikan bernilai Rp54.701 dipakai sebagai stok akhir).'
      );
    }
    if (!/note:/.test(blok)) {
      salah(
        'report.service.js `buildCogs`: tidak ada catatan metodologi. ' +
          'Angka ini beda arti dari HPP resep di Laba Kotor, dan tanpa keterangan keduanya akan dikira saling menggantikan.'
      );
    }
  }

  const k = kode.indexOf('async function nilaiStokPerOutlet');
  const blokSaldo = k >= 0 ? kode.slice(k, k + 1200) : '';
  if (!blokSaldo) {
    salah('report.service.js: `nilaiStokPerOutlet` tidak ada.');
  } else {
    if (!/rpc\('saldo_stok_pada'/.test(blokSaldo)) {
      salah('report.service.js: saldo stok tidak diambil lewat `saldo_stok_pada` (0137).');
    }
    // RPC yang mengembalikan HIMPUNAN baris ikut dipotong PostgREST di ~1000.
    // Satu BU di sini punya 800+ produk di beberapa outlet.
    if (!/ambilSemua\(/.test(blokSaldo)) {
      salah(
        'report.service.js `nilaiStokPerOutlet`: saldo diambil tanpa `ambilSemua`. ' +
          'RPC berhimpunan pun dipotong PostgREST di sekitar 1000 baris — stok akhirnya cuma jadi lebih kecil, tanpa error.'
      );
    }
  }
}

// ---------------------------------------------------------------
// 4. Migration saldonya.
// ---------------------------------------------------------------
/**
 * Komentar baris penuh DIBUANG sebelum SQL-nya diperiksa.
 *
 * Berkas 0137 menjelaskan keputusannya sendiri di komentar — termasuk kalimat
 * "`security invoker`, BUKAN definer". Tanpa pembuangan ini, KALIMAT ITU yang
 * memenuhi pemeriksaan, dan deklarasi yang sudah diganti jadi `security
 * definer` tetap lolos. Sabotase pertama pada aturan ini lolos persis begitu.
 *
 * Hanya komentar SATU BARIS PENUH yang dibuang, bukan `--` di ujung baris
 * berkode: `--` bisa muncul di dalam literal string, dan pembersih yang terlalu
 * rakus akan merusak SQL-nya sendiri.
 */
const tanpaKomentarSql = (sql) => String(sql).replace(/^[ \t]*--.*$/gm, '');

const mig = baca('supabase/migrations/0137_saldo_stok_pada_tanggal.sql');
if (mig) {
  const sql = tanpaKomentarSql(mig);
  if (!/create or replace function saldo_stok_pada\(/.test(mig)) {
    salah('0137: `saldo_stok_pada` tidak ada — laporan COGS tidak punya stok awal/akhir.');
  }
  // Batasnya akhir hari WIB. Tujuh jam menggeser seluruh pergerakan sore ke
  // tanggal berikutnya, dan stok akhir bulan tidak memuat pembelian sore
  // tanggal terakhir. Angkanya tetap wajar dibaca.
  if (!/sm\.created_at < \(\(\(p_tanggal \+ 1\)::timestamp\) at time zone 'Asia\/Jakarta'\)/.test(mig)) {
    salah("0137: batas waktunya bukan akhir hari WIB — pergerakan sore hari akan jatuh ke tanggal yang salah.");
  }
  // `security invoker`: RLS stock_movements tetap berlaku, sama seperti
  // `stock_balances` (0018). Tidak ada alasan melonggarkannya.
  if (!/security invoker/.test(sql) || /security definer/.test(sql)) {
    salah('0137: `saldo_stok_pada` bukan `security invoker` — RLS `stock_movements` jadi bisa dilewati.');
  }
  if (!/having sum\(sm\.qty_delta\) <> 0/.test(mig)) {
    salah('0137: saldo nol tidak dibuang — payloadnya jadi ratusan baris kosong per outlet.');
  }
  if (/having sum\(sm\.qty_delta\) > 0/.test(mig)) {
    salah('0137: saldo NEGATIF ikut dibuang. Stok boleh menembus nol di aplikasi ini — membuangnya membuat nilai stok lebih besar dari kenyataan.');
  }
}

if (gagal === 0) {
  console.log(
    'Nilai Opname & COGS: nilai opname dari jumlah yang BENAR-BENAR dihitung, stok COGS dari SALDO (bukan satu sesi ' +
      "opname), hanya sesi 'closed' yang jadi penanda, dan nota batal tidak ikut. ✅"
  );
}
process.exit(gagal === 0 ? 0 : 1);
