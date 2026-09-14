/**
 * AUDIT: laporan Rincian Mutasi Kas (0140).
 *
 * ============ CARA LAPORAN INI BISA SALAH TANPA TERLIHAT SALAH ============
 *
 *   pembeda pakai `untuk_nota`       -> entri PENYESUAIAN hilang dari laporan,
 *                                       dan yang hilang justru koreksinya
 *   nilai baris pakai unit_cost*qty  -> meleset ribuan rupiah pada qty yang
 *                                       tidak membagi habis; tidak ada yang
 *                                       tampak salah di layar mana pun
 *   baris tanpa harga jadi 0         -> total rapi dan lebih kecil dari
 *                                       kenyataan, tanpa satu pun tanda
 *   `entry_amount` tidak dibawa      -> nota yang dikoreksi sesudah dibayar
 *                                       terhitung dua kali
 *   aturan izin disalin, tidak dibagi-> dua salinan yang cepat atau lambat
 *                                       berbeda; bedanya muncul sebagai baris
 *                                       yang hilang tanpa pesan apa pun
 *   diambil tanpa `ambilSemua`       -> dipotong PostgREST di ~1000 baris
 *   `p_tanpa_kantong` dihapus        -> "Kas Utama" jadi tidak bisa dibedakan
 *                                       dari "semua kantong"
 *
 * Tidak satu pun melempar error.
 */
const fs = require('fs');
const path = require('path');
const { tanpaKomentar, periksaKewarasan } = require('./lib/tanpa-komentar.cjs');

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

/**
 * Komentar SATU BARIS PENUH dibuang sebelum SQL diperiksa.
 *
 * 0140 menjelaskan keputusannya sendiri di komentar — termasuk kalimat yang
 * menyebut `untuk_nota` dan `payment_entry_id`. Tanpa pembuangan ini, KALIMAT
 * ITU yang memenuhi pemeriksaan, dan kode yang sudah diubah tetap lolos. Jebakan
 * yang persis sama pernah meloloskan sabotase `security definer` di 0137.
 *
 * Hanya baris yang SELURUHNYA komentar; `--` di ujung baris berkode dibiarkan,
 * karena `--` bisa muncul di dalam literal string.
 */
const tanpaKomentarSql = (sql) => String(sql).replace(/^[ \t]*--.*$/gm, '');

/**
 * Pemotong komentar + penjaganya.
 *
 * Dua pemeriksaan di berkas ini berbentuk LARANGAN (`.sort(` di modul murni,
 * `.catch(` di build laporan). Pada bentuk itu, pemotong yang kelebihan makan
 * membuat auditnya HIJAU karena sasarannya sudah terlanjur terhapus — larangan
 * yang berhenti berlaku tanpa ada yang tahu. `periksaKewarasan` menyebut
 * potongan yang PASTI ada supaya kejadian itu berteriak.
 */
const bersih = (isi, rel, penanda) => {
  const kode = tanpaKomentar(isi);
  const pesan = periksaKewarasan(isi, kode, penanda);
  if (pesan) salah(`${rel}: ${pesan}`);
  return kode;
};

/** Potongan antara dua penanda, supaya jendela periksa tidak berupa angka ajaib. */
const blokAntara = (teks, mulai, selesai) => {
  const i = teks.indexOf(mulai);
  if (i < 0) return '';
  const j = selesai ? teks.indexOf(selesai, i + mulai.length) : -1;
  return teks.slice(i, j > i ? j : undefined);
};

// ---------------------------------------------------------------
// 1. Migration 0140.
// ---------------------------------------------------------------
const mig = baca('supabase/migrations/0140_rincian_mutasi_kas.sql');
if (mig) {
  const sql = tanpaKomentarSql(mig);

  for (const fn of ['boleh_lihat_kas', 'kantong_kas_terlihat', 'rincian_mutasi_kas']) {
    if (!new RegExp(`function ${fn}\\(`).test(sql)) salah(`0140: fungsi \`${fn}\` tidak ada.`);
    if (!new RegExp(`grant execute on function ${fn}\\(`).test(sql)) {
      salah(`0140: \`${fn}\` tidak di-grant ke authenticated — layarnya akan menjawab 42501.`);
    }
  }

  // PEMBEDANYA `payment_entry_id`, BUKAN `untuk_nota`.
  //
  // Entri penyesuaian dari koreksi_nota/batalkan_nota (0131) juga ber-
  // `untuk_nota` true tapi tidak ada nota yang menunjuknya. Memakai `untuk_nota`
  // membuat entri itu lenyap dari laporan — dan yang lenyap adalah koreksinya.
  if (!/join terlihat t on t\.id = g\.payment_entry_id/.test(sql)) {
    salah(
      '0140: nota tidak lagi disambungkan lewat `payment_entry_id`. ' +
        'Kalau pembedanya `untuk_nota`, entri PENYESUAIAN (0131) hilang dari laporan tanpa satu pun tanda.'
    );
  }
  if (/\bt\.untuk_nota\b/.test(sql) || /\bce\.untuk_nota\b/.test(sql)) {
    salah(
      '0140: `untuk_nota` dipakai sebagai penyaring. Itu jalur yang membuang entri penyesuaian — ' +
        'ia ber-`untuk_nota` true tapi tidak ada nota yang menunjuknya.'
    );
  }
  if (!/where not exists \(select 1 from nota n where n\.payment_entry_id = t\.id\)/.test(sql)) {
    salah(
      '0140: bagian kas-ledger tidak lagi memakai `not exists` terhadap nota. ' +
        'Tanpa itu, pembayaran nota muncul DUA KALI: sekali per bahan, sekali sebagai entri utuh.'
    );
  }

  // Nilai baris: `line_total` dulu. `unit_cost * qty` saja meleset ribuan
  // rupiah pada qty yang tidak membagi habis (100.000/3 -> 33.333 x 3 = 99.999).
  if (!/coalesce\(gri\.line_total, gri\.qty \* gri\.unit_cost\)/.test(sql)) {
    salah(
      '0140: nilai baris bahan tidak memakai `coalesce(line_total, qty * unit_cost)`. ' +
        'Rumus ini harus sama dengan `nota_ringkas` dan `bayar_nota`, kalau tidak laporannya berselisih dengan ' +
        'nominal yang benar-benar dibayarkan.'
    );
  }
  // NULL, bukan 0. Baris belum berharga yang ditulis nol membuat total terlihat
  // sah padahal ada barang yang belum bernilai.
  if (/coalesce\(gri\.line_total, gri\.qty \* gri\.unit_cost, 0\)/.test(sql)) {
    salah('0140: baris tanpa harga dijadikan 0. Total jadi terlihat rapi dan lebih kecil dari kenyataan.');
  }

  // `entry_amount` = nominal entri induknya, satu-satunya cara layar bisa tahu
  // isi nota sudah berubah sesudah dibayar.
  if (!/entry_amount numeric/.test(sql)) {
    salah(
      '0140: `entry_amount` tidak dikembalikan. Tanpanya, nota yang dikoreksi SESUDAH dibayar terhitung dua kali — ' +
        'sekali di baris bahannya, sekali di entri penyesuaiannya — dan hasilnya tetap terlihat masuk akal.'
    );
  }
  // `baris_id` yang membuat urutannya deterministik; satu nota boleh memuat
  // bahan yang sama dua kali, jadi tanggal + nama saja masih bisa seri.
  if (!/baris_id uuid/.test(sql)) {
    salah('0140: `baris_id` tidak dikembalikan — penomoran halaman jadi tidak punya kunci urut yang pasti unik.');
  }

  // SATU aturan izin, dipakai dua fungsi.
  if (!/boleh_lihat_kas\(ce\.holder_id, ce\.outlet_id\)/.test(sql)) {
    salah('0140: penyaring izin tidak memanggil `boleh_lihat_kas` — aturannya jadi disalin, bukan dibagi.');
  }
  const blokIzin = blokAntara(sql, 'function boleh_lihat_kas', 'grant execute on function boleh_lihat_kas');
  if (!blokIzin) {
    salah('0140: badan `boleh_lihat_kas` tidak ditemukan.');
  } else {
    for (const [apa, pola] of [
      ['super admin', /is_super_admin\(auth\.uid\(\)\)/],
      ['pemegangnya sendiri', /p_holder = auth\.uid\(\)/],
      ['admin outlet peruntukan', /is_admin_of_outlet\(auth\.uid\(\), p_outlet\)/],
      ['admin BU pemegangnya', /is_bu_admin\(auth\.uid\(\), ms\.business_unit_id\)/]
    ]) {
      if (!pola.test(blokIzin)) {
        salah(
          `0140 \`boleh_lihat_kas\`: cabang "${apa}" hilang. ` +
            'Aturannya harus sama persis dengan laporan_kas_user (0063) — kalau tidak, dua laporan kas menjawab ' +
            'pertanyaan yang sama dengan jumlah baris yang berbeda.'
        );
      }
    }
    if (!/auth\.uid\(\)/.test(blokIzin)) {
      salah('0140 `boleh_lihat_kas`: tidak menyebut `auth.uid()` sama sekali — izinnya terbuka untuk siapa saja.');
    }
  }

  // "Kas Utama" (account_id NULL) BEDA dari "semua kantong".
  if (!/p_tanpa_kantong boolean default false/.test(sql)) {
    salah(
      '0140: parameter `p_tanpa_kantong` hilang. `p_account` NULL sudah berarti "semua kantong", jadi ia tidak bisa ' +
        'sekaligus berarti "Kas Utama" — dua pertanyaan yang sangat berbeda.'
    );
  }
  if (!/when coalesce\(p_tanpa_kantong, false\) then ce\.account_id is null/.test(sql)) {
    salah('0140: `p_tanpa_kantong` tidak lagi menyaring `account_id is null` — filter Kas Utama jadi tidak berbuat apa-apa.');
  }

  // Penjaga bentuk tunggal: PostgREST memilih fungsi berdasarkan HIMPUNAN NAMA
  // argumen, jadi bentuk kedua yang tertinggal menjawab dari kode lain.
  if (!/raise exception 'rincian_mutasi_kas punya % bentuk/.test(sql)) {
    salah('0140: penjaga "hanya satu bentuk `rincian_mutasi_kas`" hilang.');
  }
}

// ---------------------------------------------------------------
// 2. Modul murni penyusunnya.
// ---------------------------------------------------------------
const murni = baca('js/modules/report/mutasi-kas.js');
if (murni) {
  const kode = bersih(murni, 'mutasi-kas.js', ['export function susunMutasiKas', 'const beda = induk - jumlah;', 'urut.push({']);

  for (const n of ['susunMutasiKas', 'selisihRekonsiliasi']) {
    if (!new RegExp(`export function ${n}\\(`).test(kode)) salah(`mutasi-kas.js: \`${n}\` tidak diekspor.`);
  }

  // Rekonsiliasi: inti laporannya.
  if (!/const beda = induk - jumlah;/.test(kode)) {
    salah(
      'mutasi-kas.js: selisih rekonsiliasi tidak lagi dihitung sebagai `entry_amount − Σ baris`. ' +
        'Arahnya paling mudah terbalik, dan hasilnya tetap terbaca wajar.'
    );
  }
  if (!/if \(n === null\) return null;/.test(kode)) {
    salah(
      'mutasi-kas.js: baris tanpa harga tidak lagi membatalkan rekonsiliasi. ' +
        'Selisihnya sudah punya penjelasan — menuliskannya sebagai "koreksi nota" berarti menuduh hal yang tidak terjadi.'
    );
  }
  if (!/Math\.abs\(beda\) < TOLERANSI_REKONSILIASI/.test(kode)) {
    salah('mutasi-kas.js: toleransi pembulatan hilang — tiap nota akan melahirkan baris "koreksi" senilai nol koma sekian.');
  }

  // Baris tanpa harga: "-", BUKAN 0.
  if (!/r\.nominal === null \? '-'/.test(kode)) {
    salah('mutasi-kas.js: baris tanpa harga tidak lagi ditulis "-". Rp0 membuat total terlihat sah padahal ada yang belum bernilai.');
  }
  if (!/Number\.isFinite\(n\) \? n : null/.test(kode)) {
    salah(
      'mutasi-kas.js: angka non-finite tidak lagi disaring. ' +
        '`Number(\'\')` adalah 0 dan `Infinity` lolos ke formatRupiah sebagai "Rp∞" — di laporan keuangan.'
    );
  }

  // Dua kolom nominal: itulah yang membuat "keluar masuk saldo" bisa dibaca.
  for (const h of ['Masuk', 'Keluar', 'Rincian', 'Kategori', 'Sumber', 'Kantong']) {
    if (!new RegExp(`header: '${h}'`).test(kode)) salah(`mutasi-kas.js: kolom \`${h}\` hilang dari KOLOM_MUTASI_KAS.`);
  }
  if (!/numeric: true/.test(kode)) {
    salah('mutasi-kas.js: tidak ada kolom bertanda `numeric` — di Excel kolom nominalnya jadi TEKS dan SUM-nya nol.');
  }

  // Urutan server dipertahankan.
  if (/\.sort\(/.test(kode)) {
    salah(
      'mutasi-kas.js: barisnya diurutkan ulang di layar. Urutan sudah ditentukan server, dan penomoran halaman ' +
        '`ambilSemua` bergantung padanya — dua sumber urutan cepat atau lambat menyimpang.'
    );
  }
}

// ---------------------------------------------------------------
// 3. Pengambilan datanya.
// ---------------------------------------------------------------
const cash = baca('js/modules/cash/cash.service.js');
if (cash) {
  const kode = tanpaKomentar(cash);
  const blok = blokAntara(kode, 'export async function rincianMutasiKas', '\n}\n');
  if (!blok) {
    salah('cash.service.js: `rincianMutasiKas` tidak ada.');
  } else {
    if (!/ambilSemua\(/.test(blok)) {
      salah(
        'cash.service.js `rincianMutasiKas`: diambil tanpa `ambilSemua`. RPC berhimpunan pun dipotong PostgREST di ' +
          'sekitar 1000 baris — sebulan belanja bahan satu BU sudah melewatinya, dan yang hilang bukan error, cuma total yang lebih kecil.'
      );
    }
    if (!/count: 'exact'/.test(blok)) {
      salah('cash.service.js `rincianMutasiKas`: tanpa `count: exact`, `ambilSemua` harus menebak kapan berhenti.');
    }
    if (!/\.order\('baris_id'\)/.test(blok)) {
      salah(
        'cash.service.js `rincianMutasiKas`: urutannya tidak dikunci `baris_id`. ' +
          'Satu nota boleh memuat bahan yang sama dua kali; urutan yang seri membuat penomoran halaman melewatkan ' +
          'baris sekaligus menggandakan baris lain.'
      );
    }
    if (!/p_tanpa_kantong: !!tanpaKantong/.test(blok)) {
      salah('cash.service.js `rincianMutasiKas`: `p_tanpa_kantong` tidak dikirim — filter Kas Utama jadi tidak pernah sampai ke server.');
    }
  }
  if (!/export async function listKantongKasTerlihat/.test(kode)) {
    salah('cash.service.js: `listKantongKasTerlihat` tidak ada — dropdown kantong tidak punya isinya.');
  }
}

const svc = baca('js/modules/report/report.service.js');
if (svc) {
  const kode = bersih(svc, 'report.service.js', [
    'export const REPORTS',
    'async function buildCashMutationDetail',
    'return susunMutasiKas('
  ]);
  if (!/key: 'cash_mutation_detail'/.test(kode)) salah("report.service.js: laporan 'cash_mutation_detail' tidak terdaftar di REPORTS.");
  if (!/build: buildCashMutationDetail/.test(kode)) salah('report.service.js: `buildCashMutationDetail` tidak dipasang ke entri katalognya.');
  if (!/pakaiFilterKantong: true/.test(kode)) salah('report.service.js: `pakaiFilterKantong` hilang — dropdown kantongnya tidak akan pernah muncul.');

  const blok = blokAntara(kode, 'async function buildCashMutationDetail', '\n}\n');
  if (!blok) {
    salah('report.service.js: `buildCashMutationDetail` tidak ada.');
  } else {
    if (!/susunMutasiKas\(\{ baris, periode/.test(blok)) {
      salah('report.service.js `buildCashMutationDetail`: hasilnya tidak disusun lewat modul murni `susunMutasiKas`.');
    }
    // TANPA `.catch(() => [])`.
    //
    // Laporan kas yang gagal dimuat lalu tampil KOSONG tidak bisa dibedakan
    // dari periode yang memang tidak ada transaksinya. Biarkan galatnya naik
    // supaya layar menuliskannya.
    if (/\.catch\(/.test(blok)) {
      salah(
        'report.service.js `buildCashMutationDetail`: galat pengambilan data ditelan `.catch`. ' +
          'Laporan kosong karena gagal tidak bisa dibedakan dari periode yang memang tidak ada transaksinya.'
      );
    }
  }
}

// ---------------------------------------------------------------
// 4. Filter kantong di layar.
// ---------------------------------------------------------------
const page = baca('js/modules/report/report.admin.page.js');
if (page) {
  const kode = tanpaKomentar(page);
  if (!/pakaiFilterKantong/.test(kode)) salah('report.admin.page.js: dropdown kantong tidak pernah dimunculkan.');
  if (!/listKantongKasTerlihat\(\)/.test(kode)) salah('report.admin.page.js: daftar kantong tidak diambil.');
  // `utama` BUKAN id. Kalau ia dikirim mentah sebagai `accountId`, server
  // membandingkannya dengan kolom uuid dan seluruh laporan gagal dengan 22P02.
  if (!/accountId: state\.accountId === 'utama' \? null : state\.accountId \|\| null/.test(kode)) {
    salah("report.admin.page.js: penanda 'utama' dikirim sebagai id kantong — itu bukan uuid, dan servernya akan menolak seluruh permintaan.");
  }
  if (!/tanpaKantong: state\.accountId === 'utama'/.test(kode)) {
    salah("report.admin.page.js: bendera `tanpaKantong` tidak dikirim — memilih Kas Utama jadi sama saja dengan 'semua kantong'.");
  }
  if (!/if \(!kantongWrap\.hidden\) isiOpsiKantong\(\);/.test(kode)) {
    salah(
      'report.admin.page.js: daftar kantong tidak ikut menyempit saat pemegang diganti. ' +
        'Kantong milik orang sebelumnya tetap terpilih dan hasilnya kosong tanpa sebab yang terlihat di layar.'
    );
  }
}

if (gagal === 0) {
  console.log(
    'Rincian Mutasi Kas: dipecah per item lewat `payment_entry_id` (bukan `untuk_nota`), nilai baris dari `line_total`, ' +
      'baris tanpa harga tetap "-", nota terkoreksi direkonsiliasi, dan izinnya satu aturan untuk dua laporan. ✅'
  );
}
process.exit(gagal === 0 ? 0 : 1);
