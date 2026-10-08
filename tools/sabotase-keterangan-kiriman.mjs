/**
 * SABOTASE: keterangan per baris surat jalan (0132 + 0157).
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Keterangan adalah kolom yang KOSONG untuk sebagian besar baris, dan
 * kegagalannya tidak punya gejala: kolom yang gagal tersimpan terlihat persis
 * seperti kolom yang memang tidak diisi. Satu-satunya cara menemukannya adalah
 * ada orang yang ingat pernah mengetiknya — dan itu bukan pemeriksaan, itu
 * keberuntungan.
 *
 * Sabotase paling halus di bawah ini: mengembalikan perilaku 0132 yang DULU
 * benar. Ia tidak merusak apa pun yang bisa dilihat; ia cuma membuat
 * penghapusan diam-diam dibatalkan.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0157_keterangan_draft_bisa_dikosongkan.sql';
const PICKER = 'js/modules/dispatch/item-picker.js';
const SVC = 'js/modules/dispatch/dispatch.service.js';
const PAGE = 'js/modules/dispatch/dispatch.page.js';
const DUP = 'js/modules/dispatch/duplikat-item.js';
const PESAN = 'js/modules/dispatch/pesan-kiriman.js';
const PDF = 'js/modules/dispatch/dispatch-pdf.js';

const asli = new Map();
for (const rel of [MIG, PICKER, SVC, PAGE, DUP, PESAN, PDF]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

const PENANDA = path.join(AKAR, 'tools/.sabotase-aktif');
const tandai = (rel) => fs.writeFileSync(PENANDA, `${path.basename(process.argv[1])} merusak ${rel}\n`);
const lepasTanda = () => {
  try {
    fs.unlinkSync(PENANDA);
  } catch {
    /* belum pernah ada — tidak apa-apa */
  }
};

const pulih = () => {
  // ============ MODE PERIKSA POLA TIDAK MEMULIHKAN APA PUN ============
  //
  // Karena ia tidak pernah merusak apa pun. `fs.writeFileSync` dengan isi yang
  // SAMA tetap sebuah penulisan: berkasnya dipotong lebih dulu, lalu diisi
  // ulang. Proses lain yang kebetulan membacanya pada milidetik itu melihat
  // berkas kosong atau separuh.
  //
  // Itu benar-benar terjadi: `audit-sabotase-terpasang.cjs` menjalankan 53
  // harness sekaligus, ketiganya-puluh-tiga menulis ulang berkasnya saat
  // keluar, dan `audit-import-ekspor.cjs` yang berjalan berbarengan melaporkan
  // "mengimpor REPORTS tapi berkasnya tidak mengekspornya" — untuk berkas yang
  // isinya tidak pernah berubah sedetik pun.
  if (process.env.SABOTASE_PERIKSA_POLA) return lepasTanda();
  for (const [rel, isi] of asli) fs.writeFileSync(P(rel), isi);
  lepasTanda();
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
  // `String.replace` dengan string hanya mengganti kemunculan PERTAMA.
  if (typeof dari === 'string' && isi.split(dari).length > 2) {
    gagal++;
    console.error(`❌ POLANYA MUNCUL >1 KALI: ${nama} di ${rel} — sabotasenya cuma mengenai yang pertama.`);
    return;
  }
  // ============ MODE PERIKSA POLA ============
  //
  // Dipakai `tools/audit-sabotase-terpasang.cjs`: berhenti TEPAT sesudah pola
  // `dari` dipastikan cocok, sebelum satu berkas pun disentuh.
  //
  // Alasannya satu kejadian nyata: `sabotase-0132.mjs` basi sejak `0142` —
  // tiga polanya tidak cocok lagi dengan kodenya — dan tidak ada yang tahu
  // berbulan-bulan, karena harness sabotase berat (tiap sabotase menjalankan
  // pemeriksanya sendiri) sehingga tidak pernah ikut sweep rutin. Harness yang
  // polanya tidak terpasang TIDAK menguji apa pun, dan ia melaporkannya hanya
  // kalau ada yang menjalankannya.
  //
  // Mode ini tidak menjalankan pemeriksa sama sekali, jadi seluruh 50+ harness
  // bisa disapu dalam hitungan detik.
  if (process.env.SABOTASE_PERIKSA_POLA) {
    console.log(`   \u2714 pola terpasang: ${nama}`);
    return;
  }
  tandai(rel);
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

const PG = 'tools/test-migrasi-0157.mjs';
const TES = 'tools/test-duplikat-item.mjs';
const AUDIT = 'tools/audit-keterangan-kiriman.cjs';

console.log('SABOTASE "KOSONG" VERSUS "TIDAK DIKIRIM":');

sabotase(
  'kembali ke perilaku 0132 — keterangan yang dihapus muncul lagi sendiri',
  MIG,
  "    if it ? 'keterangan' then\n      v_ket := nullif(btrim(coalesce(it->>'keterangan', '')), '');\n    else\n      v_ket := v_lama -> v_pid::text ->> 'k';\n    end if;",
  "    v_ket := coalesce(nullif(btrim(coalesce(it->>'keterangan', '')), ''), v_lama -> v_pid::text ->> 'k');",
  PG
);
sabotase(
  'cabang "kunci tidak ada" berhenti mempertahankan nilai lama — PWA lama menghapus semuanya',
  MIG,
  "      v_ket := v_lama -> v_pid::text ->> 'k';",
  '      v_ket := null;',
  PG
);
sabotase(
  'salinan isi lama dibuang sama sekali',
  MIG,
  "  select coalesce(jsonb_object_agg(product_id::text, jsonb_build_object('k', keterangan, 'o', ordered_qty)), '{}'::jsonb)\n    into v_lama\n    from dispatch_items where dispatch_id = p_dispatch;",
  "  v_lama := '{}'::jsonb;",
  PG
);
sabotase(
  'spasi tidak dirapikan — keterangan berisi spasi tersimpan sebagai teks',
  MIG,
  "      v_ket := nullif(btrim(coalesce(it->>'keterangan', '')), '');",
  "      v_ket := it->>'keterangan';",
  PG
);

console.log('\nSABOTASE PENJAGA LAMA YANG IKUT LONGGAR:');

sabotase(
  'penjaga "draft tidak boleh kosong" hilang saat fungsinya ditulis ulang',
  MIG,
  '  if v_jumlah = 0 then',
  '  if false then',
  PG
);
sabotase(
  'penjaga "semua barang jumlah kirimnya 0" hilang',
  MIG,
  '  if v_positif = 0 then',
  '  if false then',
  PG
);
sabotase(
  'penjaga wewenang hilang',
  MIG,
  '  if not boleh_kelola_draft(p_dispatch) then',
  '  if false then',
  AUDIT
);

console.log('\nSABOTASE PICKER:');

sabotase(
  'kotak keterangannya tidak digambar sama sekali',
  PICKER,
  '            ? `<input type="text" class="pf-ket" placeholder="keterangan" value="${esc(',
  '            ? `<input type="hidden" class="pf-ket-mati" value="${esc(',
  AUDIT
);
sabotase(
  'INTI: snapshot tidak membawanya — ganti saringan kategori, isiannya hilang',
  PICKER,
  "      keterangan: row.querySelector('.pf-ket')?.value",
  '      keterangan: undefined',
  AUDIT
);
sabotase(
  'nilai awal tidak dimuat — kotaknya terbuka kosong, lalu menimpanya',
  PICKER,
  'line_total: i.line_total, keterangan: i.keterangan',
  'line_total: i.line_total',
  AUDIT
);
sabotase(
  'dikirim tanpa syarat — layar yang tidak punya kotaknya ikut menghapus',
  PICKER,
  "          ...(kolomKeterangan ? { keterangan: String(e.keterangan ?? '').trim() } : {})",
  "          keterangan: String(e.keterangan ?? '').trim()",
  AUDIT
);

console.log('\nSABOTASE LAYANAN & LAYAR:');

sabotase(
  'layanan membuang keterangannya lagi — kotaknya bekerja, isinya tidak sampai',
  SVC,
  '      ...(i.keterangan === undefined ? {} : { keterangan: i.keterangan })\n',
  '',
  AUDIT
);
sabotase(
  'kunci selalu dikirim walau `undefined`',
  SVC,
  '      ...(i.keterangan === undefined ? {} : { keterangan: i.keterangan })',
  '      keterangan: i.keterangan',
  AUDIT
);
sabotase(
  'layar draft berhenti menyalakan kolomnya',
  PAGE,
  '      kolomKeterangan: true,',
  '      kolomKeterangan: false,',
  AUDIT
);
sabotase(
  'layar draft tidak memuat nilai yang sudah ada',
  PAGE,
  'qty: i.sent_qty, keterangan: i.keterangan',
  'qty: i.sent_qty',
  AUDIT
);

console.log('\nSABOTASE PENGGABUNGAN BARIS KEMBAR:');

sabotase(
  'keterangan baris kedua hilang saat baris pertamanya kosong',
  DUP,
  "        if (k !== undefined && String(k).trim() !== '') ket = k;",
  '        void k;',
  TES
);
sabotase(
  'kolom keterangan muncul sendiri di dokumen yang tidak punya konsepnya',
  DUP,
  "      ...('keterangan' in (it ?? {}) ? { keterangan: ket ?? it.keterangan } : {}),",
  '      keterangan: ket ?? it?.keterangan,',
  TES
);

console.log('\nSABOTASE TEKS WHATSAPP:');

const TES_PESAN = 'tools/test-pesan-kiriman.mjs';

sabotase(
  'INTI: keterangan hilang lagi dari pesan WhatsApp — dokumen yang dibaca DULU yang kehilangannya',
  PESAN,
  '  const catatan = catatanBaris(it);\n  return catatan.length ? `${inti}\\n   _${catatan.join(' + "' — ')}_` : inti;",
  '  return inti;',
  TES_PESAN
);
sabotase(
  'catatannya disambung di belakang jumlahnya — terbungkus jadi dua baris, terbaca seperti dua barang',
  PESAN,
  '  return catatan.length ? `${inti}\\n   _${catatan.join(' + "' — ')}_` : inti;",
  '  return catatan.length ? `${inti} — ${catatan.join(' + "' — ')}` : inti;",
  TES_PESAN
);
sabotase(
  '`Number(null)` adalah 0 — setiap baris tanpa `ordered` berbunyi "diminta 0"',
  PESAN,
  '  if (it?.ordered != null && Number(it.ordered) !== Number(it.sent)) {',
  '  if (Number(it?.ordered) !== Number(it?.sent)) {',
  TES_PESAN
);
sabotase(
  '"diminta X" disebut walau jumlahnya sama — keramaian yang membuat baris penting ikut tak dibaca',
  PESAN,
  '  if (it?.ordered != null && Number(it.ordered) !== Number(it.sent)) {',
  '  if (it?.ordered != null) {',
  TES_PESAN
);
sabotase(
  'pemotongan 60 karakter dipaksakan ke semua pemakai, termasuk WhatsApp',
  PESAN,
  '  if (ket) hasil.push(potong > 0 ? ket.slice(0, potong) : ket);',
  '  if (ket) hasil.push(ket.slice(0, 60));',
  AUDIT
);
sabotase(
  'ringkasan "barang TIDAK dikirim" dibuang — nol di tengah daftar tenggelam',
  PESAN,
  '  if (kosong.length) {',
  '  if (false) {',
  TES_PESAN
);

console.log('\nSABOTASE "KERTAS & PESAN MENYIMPANG LAGI":');

sabotase(
  'PDF menyusun catatan barisnya sendiri lagi — dua salinan dari satu aturan',
  PDF,
  '    const catatan = catatanBaris(it, { potong: 60 });',
  "    const catatan = [];\n    if (it.keterangan) catatan.push(String(it.keterangan).slice(0, 60));",
  AUDIT
);
sabotase(
  '`suratJalanWaText` tidak diekspor ulang — layar pengiriman gagal memuat',
  PDF,
  "export { suratJalanWaText } from './pesan-kiriman.js';",
  '',
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase keterangan kiriman tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS — pemeriksanya tidak menjaga apa yang dikiranya dijaga.`);
process.exit(gagal === 0 ? 0 : 1);
