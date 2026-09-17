/**
 * SABOTASE: membatalkan tanda ekspor ESB.
 *
 * Yang dijaga: layarnya ADA (inilah yang dulu hilang), alasannya wajib di dua
 * sisi, jejaknya tertulis, jejak lama tidak disalahbaca, dan "berhasil" tidak
 * pernah terucap untuk nol baris.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0143_batal_tanda_esb_berjejak.sql';
const MURNI = 'js/modules/inventory/batal-tanda-esb.js';
const PAGE = 'js/modules/inventory/esb.admin.js';
const SVC = 'js/modules/inventory/esb.service.js';

const asli = new Map();
for (const rel of [MIG, MURNI, PAGE, SVC]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

const pulih = () => {
  for (const [rel, isi] of asli) fs.writeFileSync(P(rel), isi);
};
process.on('exit', pulih);
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

const jalan = (cmd) => {
  try {
    execFileSync('node', [cmd], { cwd: AKAR, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};

let gagal = 0;
const sabotase = (nama, rel, dari, ke, pemeriksa) => {
  if (!fs.existsSync(P(pemeriksa))) {
    gagal++;
    console.error(`❌ PEMERIKSANYA TIDAK ADA: ${pemeriksa} — "tertangkap" di sini tidak berarti apa-apa.`);
    return;
  }
  const isi = asli.get(rel);
  const rusak = isi.replace(dari, ke);
  if (rusak === isi) {
    gagal++;
    console.error(`❌ SABOTASE TIDAK TERPASANG: ${nama} — polanya tidak ketemu di ${rel}.`);
    return;
  }
  fs.writeFileSync(P(rel), rusak);
  const hijau = jalan(pemeriksa);
  pulih();
  if (hijau) {
    gagal++;
    console.error(`❌ LOLOS: ${nama}\n   ${pemeriksa} tetap hijau padahal ${rel} sudah dirusak.`);
  } else {
    console.log(`   ✔ tertangkap: ${nama}`);
  }
};

const TES_DB = 'tools/test-migrasi-0143.mjs';
const TES = 'tools/test-batal-tanda-esb.mjs';
const AUDIT = 'tools/audit-batal-tanda-esb.cjs';

console.log('SABOTASE MIGRATION:');

// INI sabotase terpentingnya: ia memulihkan keadaan yang bertahan tiga
// migration tanpa disadari siapa pun — fungsi yang ada, diuji hijau, dan tidak
// bisa dipanggil dari mana pun.
// Sabotasenya cuma membubuhkan "-- " di depan barisnya, dan itu pernah LOLOS:
// audit versi pertama memakai `includes`, jadi perintah yang sudah mati tetap
// memuat teks yang dicarinya. Sekarang diperiksa oleh tes Postgres sungguhan,
// yang memasang tanda tangan lama lebih dulu lalu membuktikan ia hilang.
sabotase(
  'tanda tangan lama dihidupkan lagi — panggilan tanpa p_alasan jatuh ke sana: berhasil, tanpa alasan, tanpa jejak',
  MIG,
  'drop function if exists batalkan_tanda_esb(uuid[]);',
  '-- drop function if exists batalkan_tanda_esb(uuid[]);',
  TES_DB
);
sabotase(
  'perintah membuang tanda tangan lama dihapus seluruhnya',
  MIG,
  'drop function if exists batalkan_tanda_kiriman_esb(uuid[]);',
  '',
  AUDIT
);
sabotase(
  'alasannya tidak divalidasi di server — jejaknya terisi kekosongan',
  MIG,
  '  v_alasan text := alasan_batal_esb_sah(p_alasan);\n  v_n int;\nbegin\n  if p_notas is null',
  '  v_alasan text := btrim(coalesce(p_alasan, \'\'));\n  v_n int;\nbegin\n  if p_notas is null',
  TES_DB
);
sabotase(
  'batas panjangnya dilonggarkan jadi satu huruf — "x" lolos sebagai alasan',
  MIG,
  'create or replace function panjang_alasan_batal_esb()\nreturns int\nlanguage sql\nimmutable\nas $$ select 10 $$;',
  'create or replace function panjang_alasan_batal_esb()\nreturns int\nlanguage sql\nimmutable\nas $$ select 1 $$;',
  AUDIT
);
sabotase(
  'pelakunya tidak dicatat — yang tersisa cuma "kapan", tanpa "siapa"',
  MIG,
  '         esb_dibatalkan_by = v_uid,\n         esb_alasan_batal = v_alasan\n   where g.id = any(p_notas)',
  '         esb_alasan_batal = v_alasan\n   where g.id = any(p_notas)',
  TES_DB
);
sabotase(
  'izin bu_admin dicabut — staff outlet mana pun bisa membuka tanda ekspor',
  MIG,
  '     and g.esb_exported_at is not null\n     and is_bu_admin(v_uid, g.business_unit_id);',
  '     and g.esb_exported_at is not null;',
  TES_DB
);
sabotase(
  'baris yang TIDAK bertanda ikut ditulisi jejak — penelusuran nanti menemukan pembatalan yang tidak pernah terjadi',
  MIG,
  '     and g.esb_exported_at is not null\n     and is_bu_admin(v_uid, g.business_unit_id);',
  '     and is_bu_admin(v_uid, g.business_unit_id);',
  TES_DB
);
sabotase(
  'kiriman dilupakan — izin BU-nya dibuka lebar',
  MIG,
  '     and d.esb_exported_at is not null\n     and is_bu_admin(v_uid, d.business_unit_id);',
  '     and d.esb_exported_at is not null;',
  TES_DB
);

console.log('\nSABOTASE PESAN KE STAFF:');

sabotase(
  'pesannya kembali tidak menyebut siapa yang bisa membukanya — staff mencari tombol yang tidak ada di aplikasinya',
  MIG,
  "  raise exception 'Nota % sudah diekspor ke ESB, jadi isinya terkunci. Minta admin BU membuka tandanya lewat Admin Portal -> Inventory -> Ekspor ESB -> \"Batalkan tanda ekspor\", lalu perbaiki dan unggah ulang berkasnya.',",
  "  raise exception 'Nota % sudah diekspor ke ESB. Batalkan tanda ekspornya dulu, perbaiki, lalu unggah ulang berkasnya.',",
  TES_DB
);
sabotase(
  'aksi Edit berhenti memakai penjaga bersama — pesannya akan menyimpang dari dua penjaga lainnya',
  MIG,
  "  if v_g.esb_exported_at is not null then\n    perform tolak_karena_terekspor_esb(v_g.code);\n  end if;\n\n  select coalesce(sum(coalesce(line_total, qty * unit_cost)), 0) into v_sebelum",
  "  if v_g.esb_exported_at is not null then\n    raise exception 'Nota % terkunci.', coalesce(v_g.code, '');\n  end if;\n\n  select coalesce(sum(coalesce(line_total, qty * unit_cost)), 0) into v_sebelum",
  TES_DB
);

console.log('\nSABOTASE ATURAN MURNI:');

sabotase(
  'panjang alasannya dihitung SEBELUM dirapikan — sebelas spasi lolos sebagai alasan sebelas huruf',
  MURNI,
  '  const v = teks(alasan).trim();',
  '  const v = teks(alasan);',
  TES
);
sabotase(
  'batas panjang di layar menyimpang dari server',
  MURNI,
  'export const PANJANG_ALASAN_MIN = 10;',
  'export const PANJANG_ALASAN_MIN = 3;',
  AUDIT
);
// INI jebakan yang paling halus di seluruh fitur ini.
sabotase(
  'jejak LAMA dibaca sebagai tanda yang sedang terbuka — nota sehat dilaporkan terbuka, lalu dibuka lagi',
  MURNI,
  '  return batal > ekspor ? \'terbuka\' : \'pernah-dibuka\';',
  "  return 'terbuka';",
  TES
);
sabotase(
  'yang sudah terbuka ikut tampil di daftar — dicentang, lalu "0 dari 3 terbuka"',
  MURNI,
  '    .filter(sedangBertanda)',
  '    .filter(() => true)',
  TES
);
// "Daftarnya diurut di tempat" sempat disabotase di sini dengan mencabut
// `.slice()`. Sabotasenya LOLOS, dan benar demikian: `filter` di atasnya sudah
// mengembalikan larik baru, jadi `.slice()` tidak pernah menjaga apa pun.
// `.slice()`-nya dibuang dari modulnya alih-alih dipertahankan sebagai penjaga
// palsu — sifat yang dijaga (larik asli tidak berubah) tetap diuji di §4.
sabotase(
  'penyaringnya dicabut sehingga larik asli layar ikut diurut di punggungnya',
  MURNI,
  '    .filter(sedangBertanda)\n    .sort(',
  '    .sort(',
  TES
);
sabotase(
  '"berhasil" terucap walau nol baris terbuka',
  MURNI,
  '  if (b === 0) {',
  '  if (false) {',
  TES
);
sabotase(
  'sebagian terbuka dilaporkan sebagai sukses penuh',
  MURNI,
  '  if (b < d) {',
  '  if (false) {',
  TES
);
sabotase(
  'nama pembatal yang diblokir RLS menghapus seluruh jejaknya',
  MURNI,
  "    oleh: teks(baris?.pembatal?.full_name) || 'tidak diketahui',",
  '    oleh: baris.pembatal.full_name,',
  TES
);

console.log('\nSABOTASE LAYAR & LAYANAN:');

// Kembali ke keadaan semula: fungsinya ada, tesnya hijau, tombolnya tidak ada.
sabotase(
  'tombol "Batalkan tanda ekspor" hilang lagi — jalan keluarnya kembali SQL Editor',
  PAGE,
  'id="batal-jalankan"',
  'id="batal-jalankan-nonaktif"',
  AUDIT
);
sabotase(
  'alasannya tidak diperiksa di layar — orangnya baru tahu sesudah database menolaknya',
  PAGE,
  "          const periksa = alasanSah(box.querySelector('#batal-alasan').value);",
  "          const periksa = { boleh: true, alasan: box.querySelector('#batal-alasan').value, sebab: '' };",
  AUDIT
);
sabotase(
  'hasilnya tidak dibandingkan dengan yang dicentang',
  PAGE,
  '            const hasil = hasilPembatalan(ids.length, n);',
  "            const hasil = { nada: 'success', pesan: 'Berhasil.' };",
  AUDIT
);
sabotase(
  'peringatan "tidak menghapus dokumennya di ESB" dicabut',
  PAGE,
  '⚠ ${esc(PERINGATAN_ESB)}',
  '⚠ Perhatikan.',
  AUDIT
);
sabotase(
  'konfirmasinya dihapus — satu ketukan membuka tanda puluhan nota',
  PAGE,
  '            danger: true\n          });\n          if (!setuju) return;',
  '            danger: false\n          });\n          if (!setuju) return;',
  AUDIT
);
// Baris yang disembunyikan penyaring tetap ada di DOM, dan centangnya tetap
// sah. Membaca yang terlihat saja akan melewatkannya tanpa satu pun error.
sabotase(
  'centang dibaca dari baris yang TERLIHAT saja — yang tersaring diam-diam tidak ikut',
  PAGE,
  "box.querySelectorAll('#batal-baris .batal-pilih:checked')",
  "[...box.querySelectorAll('#batal-baris tr')].filter((t) => !t.hidden).flatMap((t) => [...t.querySelectorAll('.batal-pilih:checked')])",
  AUDIT
);
sabotase(
  'daftarnya tidak disaring lewat modul murni',
  PAGE,
  '      const daftar = susunDaftarBertanda(baris);',
  '      const daftar = baris;',
  AUDIT
);
sabotase(
  'p_alasan berhenti selalu dikirim — galatnya jadi "function not found", yang tidak menyebut alasan sama sekali',
  SVC,
  "    argumenRpc({ p_notas: notaIds, p_alasan: String(alasan ?? '') })",
  '    argumenRpc({ p_notas: notaIds, p_alasan: alasan })',
  AUDIT
);
sabotase(
  'daftar "sudah bertanda" tidak menyaring tandanya — seluruh nota ikut tampil sebagai bisa dibuka',
  SVC,
  "      .not('esb_exported_at', 'is', null)\n      // `receipt_date` bertipe DATE",
  '      // `receipt_date` bertipe DATE',
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase pembatalan tanda ESB tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
