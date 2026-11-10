/**
 * AUDIT: opname menyeluruh — yang tidak diisi dianggap habis (0182).
 *
 * ============ KENAPA FITUR INI DIJAGA LEBIH KETAT DARI BIASANYA ============
 *
 * Ini satu-satunya tempat di aplikasi yang menghapus stok barang yang TIDAK
 * disebut siapa pun. Kalau saringannya meleset satu baris, yang hilang bukan
 * satu angka melainkan seluruh gudang:
 *
 *   saringan BU/outlet hilang     -> opname di Sentul mengosongkan rak
 *                                    Serpong, atau rak BU lain
 *   `is_active` hilang            -> produk arsip ikut dinolkan; stoknya tidak
 *                                    pernah tampil di layar mana pun lagi
 *   `finished` ikut               -> stok menu jadi nol, padahal ia memang
 *                                    tidak pernah dihitung lewat opname bahan
 *   pratinjau beda dari kenyataan -> dialog berkata "3 bahan", yang terjadi 300
 *   kalimat lama dibiarkan        -> dialog berbunyi "bahan yang tidak dihitung
 *                                    tidak disentuh" — bohong, di layar yang
 *                                    tidak bisa dibatalkan
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

// Penanda kewarasannya PER BERKAS, bukan satu daftar untuk semua: kata yang
// cuma ada di komentar sebuah berkas (mis. "habis" di layanan) akan membuat
// pemeriksanya melaporkan "pemotong komentar memakan kode" untuk pemotongan
// yang sebenarnya benar.
const bacaKode = (rel, penanda) => {
  const asli = baca(rel);
  if (!asli) return null;
  const kode = tanpaKomentar(asli);
  const pesan = periksaKewarasan(asli, kode, penanda);
  if (pesan) {
    salah(`${rel}: ${pesan} — audit ini tidak bisa dipercaya untuk berkas itu.`);
    return null;
  }
  return kode;
};

const tanpaKomentarSql = (sql) =>
  sql
    .split('\n')
    .map((b) => (b.trim().startsWith('--') ? '' : b))
    .join('\n');

const MIG = 'supabase/migrations/0182_opname_menyeluruh.sql';
const SVC = 'js/modules/inventory/opname.service.js';
const ADM = 'js/modules/inventory/opname.admin.js';
const STAF = 'js/modules/inventory/inventory.page.js';
const TES = 'tools/test-migrasi-0182.mjs';

const mentah = baca(MIG);
const sql = mentah ? tanpaKomentarSql(mentah) : null;
const fungsi = (nama) => {
  if (!sql) return '';
  const i = sql.indexOf(`create or replace function ${nama}(`);
  return i < 0 ? '' : sql.slice(i, sql.indexOf('\n$$;', i));
};

if (sql) {
  const tutup = fungsi('tutup_opname');
  if (!tutup) {
    salah(`${MIG}: \`tutup_opname\` tidak ditulis ulang.`);
  } else {
    // ============ SARINGAN YANG MENENTUKAN APA YANG LENYAP ============
    const wajib = [
      ['p.business_unit_id = v_bu', 'BU lain ikut dinolkan'],
      ['sm.outlet_id = v_outlet', 'stok outlet lain ikut dibaca — rak gudang lain ikut dikosongkan'],
      ['coalesce(p.is_active, true)', 'produk nonaktif ikut dinolkan, padahal kotaknya tidak pernah ada di layar'],
      ["p.product_type <> 'finished'", 'stok menu ikut dinolkan, padahal ia tidak dihitung lewat opname bahan'],
      ['not exists (select 1 from stock_count_items i where i.count_id = p_count and i.product_id = p.id)',
        'bahan yang SUDAH dihitung ikut dinolkan — hitungannya dibuang dan diganti nol']
    ];
    for (const [pola, akibat] of wajib) {
      if (!tutup.includes(pola)) salah(`${MIG}: \`${pola}\` hilang dari tahap 2 — ${akibat}.`);
    }

    // Yang stoknya sudah nol tidak menghasilkan apa-apa. Tanpa penjaga ini,
    // tiap sesi menulis ratusan pergerakan bernilai nol dan riwayat stok jadi
    // tidak bisa dibaca.
    if (!/if r\.sistem <> 0 then/.test(tutup)) {
      salah(`${MIG}: bahan berstok nol tetap menghasilkan pergerakan kosong.`);
    }

    // Jejaknya: baris `stock_count_items` bertanda `otomatis`, dan catatan di
    // pergerakan stoknya. Tanpa keduanya, stok hilang tanpa satu pun baris
    // yang bisa ditunjuk saat ada yang bertanya.
    if (!/insert into stock_count_items[\s\S]{0,400}otomatis\)/.test(tutup)) {
      salah(`${MIG}: penolan tidak meninggalkan baris hitungan — laporan sesi tidak akan menyebut apa yang dinolkan.`);
    }
    if (!/tidak dihitung, dianggap habis/.test(tutup)) {
      salah(`${MIG}: pergerakan stoknya tidak menjelaskan dirinya sendiri.`);
    }

    // ============ TAHAP 1 HARUS UTUH ============
    //
    // Dibandingkan baris demi baris dengan 0085: setiap baris yang hilang di
    // sini adalah penjagaan yang lenyap tanpa tanda (0179 kehilangan dua
    // `insert into asset_log` persis begitu).
    const lama = baca('supabase/migrations/0085_opname_bernomor.sql');
    if (lama) {
      const potong = (teks) => {
        const i = teks.indexOf('create or replace function tutup_opname(');
        return i < 0 ? null : teks.slice(i, teks.indexOf('\n$$;', i));
      };
      const a = potong(tanpaKomentarSql(lama));
      if (!a) salah(`${MIG}: \`tutup_opname\` 0085 tidak ditemukan untuk dibandingkan.`);
      else {
        const barisA = a.split('\n').filter((x) => x.trim());
        const barisB = tutup.split('\n').filter((x) => x.trim());
        const hilang = barisA.filter((x) => !barisB.includes(x));
        if (hilang.length) {
          salah(
            `${MIG}: penulisan ulang \`tutup_opname\` KEHILANGAN ${hilang.length} baris dari 0085 — ` +
              `mis. ${hilang[0].trim().slice(0, 70)}`
          );
        }
      }
    }
  }

  // ============ PRATINJAU HARUS MEMAKAI SARINGAN YANG SAMA ============
  //
  // Dialog yang berkata "3 bahan akan dianggap habis" lalu menolkan 300 jauh
  // lebih berbahaya daripada dialog tanpa angka sama sekali: yang membacanya
  // menekan tombolnya dengan yakin.
  const pra = fungsi('pratinjau_tutup_opname');
  if (!pra) {
    salah(`${MIG}: \`pratinjau_tutup_opname\` tidak ada — akibat terbesarnya tidak bisa dilihat sebelum terjadi.`);
  } else {
    for (const [pola] of [
      ['p.business_unit_id = v_bu'],
      ["p.product_type <> 'finished'"],
      ['coalesce(p.is_active, true)'],
      ['not exists (select 1 from stock_count_items i where i.count_id = p_count and i.product_id = p.id)']
    ]) {
      if (!pra.includes(pola)) {
        salah(`${MIG}: pratinjau memakai saringan yang BERBEDA dari penutupan (\`${pola}\` tidak ada) — angkanya akan berbohong.`);
      }
    }
    if (!/sistem <> 0/.test(pra)) {
      salah(`${MIG}: pratinjau menghitung bahan berstok nol — angkanya jadi jauh lebih menakutkan daripada yang terjadi.`);
    }
    if (/update |insert into |delete from /.test(pra)) {
      salah(`${MIG}: pratinjau MENGUBAH sesuatu — ia dipanggil sebelum orangnya memutuskan.`);
    }
  }

  // Sesi yang DIBATALKAN tidak boleh ikut menolkan apa pun; itu satu-satunya
  // jalan keluar untuk sesi yang terlanjur dibuka tapi tidak jadi dikerjakan.
  if (/create or replace function batalkan_opname/.test(sql)) {
    salah(`${MIG}: \`batalkan_opname\` ikut ditulis ulang — periksa ulang, sesi yang dibatalkan tidak boleh menyentuh stok.`);
  }

  if (!fs.existsSync(path.join(AKAR, TES))) salah(`${TES} tidak ada — aturannya tidak pernah dijalankan.`);
}

// =====================================================================
// Klien: akibatnya harus terbaca SEBELUM tombolnya ditekan
// =====================================================================
const svc = bacaKode(SVC, ['pratinjau_tutup_opname', 'tutup_opname']);
if (svc && !/export async function pratinjauTutupOpname\(/.test(svc)) {
  salah(`${SVC}: \`pratinjauTutupOpname\` tidak ada.`);
}

const adm = bacaKode(ADM, ['tutupOpname', 'confirmDialog']);
if (adm) {
  if (!/pratinjauTutupOpname\(btn\.dataset\.id\)/.test(adm)) {
    salah(`${ADM}: dialog tutup tidak memeriksa berapa bahan yang akan dianggap habis.`);
  }
  // Kalimat lama sekarang BOHONG. Kalimat yang bohong di dialog yang tidak
  // bisa dibatalkan lebih buruk daripada tidak ada kalimat sama sekali.
  if (/tidak dihitung tidak disentuh/.test(adm)) {
    salah(`${ADM}: dialog masih berkata "bahan yang tidak dihitung tidak disentuh" — sejak 0182 itu tidak benar.`);
  }
  if (!/dianggap habis/.test(adm)) {
    salah(`${ADM}: dialog tidak menyebut bahwa yang tidak dihitung akan dianggap habis.`);
  }
  // Gagal membaca pratinjau TIDAK boleh berarti "tidak ada yang akan dinolkan".
  // Dicari DEKLARASINYA dan KALIMATNYA sekaligus: namanya saja masih muncul
  // di berkas walau deklarasinya diganti, dan audit yang cuma mencari nama
  // tetap hijau untuk kode yang tidak bisa dijalankan.
  if (!/let praGagal = ''/.test(adm) || !/Jangan tutup sesinya dulu/.test(adm)) {
    salah(`${ADM}: pratinjau yang gagal dibaca tidak dibedakan dari "tidak ada yang terlewat".`);
  }
}

const staf = bacaKode(STAF, ['opname-kemajuan', 'catatHitungan']);
if (staf && !/dianggap habis \(0\)/.test(staf)) {
  salah(
    `${STAF}: layar opname staff tidak mengatakan bahwa yang tidak diisi akan dianggap habis. ` +
      'Aturannya kebalikan dari yang lama, dan yang pernah memakai aturan lama tidak punya alasan menduganya.'
  );
}

console.log('');
if (gagal === 0) console.log('Audit opname menyeluruh bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
