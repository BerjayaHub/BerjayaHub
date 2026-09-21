/**
 * SABOTASE: Purpose waste/spoil.
 *
 * Tiap sabotase di bawah menghasilkan aplikasi yang tetap jalan. Yang paling
 * berbahaya bukan yang membuat layar merah — melainkan yang membuat biaya waste
 * masuk ke akun COGS yang salah dengan angka yang terlihat wajar, dan yang
 * membuat staff tidak bisa mencatat barang rusak karena sebuah berkas Excel
 * belum diunggah.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0147_purpose_waste.sql';
const MURNI = 'js/modules/inventory/purpose-esb.js';
const JOURNAL = 'js/modules/inventory/esb-journal.js';
const PURCHASE = 'js/modules/inventory/esb-purchase.js';
const WSVC = 'js/modules/inventory/waste.service.js';
const ESVC = 'js/modules/inventory/esb.service.js';
const INV = 'js/modules/inventory/inventory.page.js';
const LAP = 'js/modules/inventory/laporan-waste.js';
const WADM = 'js/modules/inventory/waste.admin.js';
const EADM = 'js/modules/inventory/esb.admin.js';

const asli = new Map();
for (const rel of [MIG, MURNI, JOURNAL, PURCHASE, WSVC, ESVC, INV, LAP, WADM, EADM]) {
  asli.set(rel, fs.readFileSync(P(rel), 'utf8'));
}

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
  // `String.replace` mengganti kemunculan PERTAMA saja. Pola yang muncul lebih
  // dari sekali berarti sabotasenya cuma mengenai salah satu tempat, dan
  // "tertangkap" tidak membuktikan tempat yang lain ikut dijaga.
  if (typeof dari === 'string' && isi.split(dari).length > 2) {
    gagal++;
    console.error(`❌ POLANYA MUNCUL >1 KALI: ${nama} di ${rel} — sabotasenya cuma mengenai yang pertama.`);
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

const PG = 'tools/test-migrasi-0147.mjs';
const TES = 'tools/test-purpose-esb.mjs';
const TES_J = 'tools/test-esb-journal.mjs';
const TES_L = 'tools/test-laporan-waste.mjs';
const AUDIT = 'tools/audit-purpose-waste.cjs';

console.log('SABOTASE "DAFTAR BELUM ADA" — yang mematikan pekerjaan yang selama ini jalan:');

sabotase(
  'BU yang belum mengimpor daftar ikut dikunci — staff tidak bisa mencatat barang rusak sama sekali',
  MIG,
  '  if not v_ada then\n    return v;\n  end if;',
  '  if not v_ada then\n    raise exception \'Daftar Purpose belum diimpor.\';\n  end if;',
  PG
);
sabotase(
  'nilai kosong tidak lagi dibolehkan di database',
  MIG,
  '  if v is null then\n    return null;\n  end if;',
  '  if v is null then\n    raise exception \'Purpose wajib.\';\n  end if;',
  PG
);
sabotase(
  'modul murninya mewajibkan Purpose walau daftarnya kosong',
  MURNI,
  '    return { boleh: true, nilai: null, sebab: \'\' };',
  '    return { boleh: false, nilai: null, sebab: PESAN_WAJIB };',
  TES
);
sabotase(
  'kotak Purpose muncul walau daftarnya kosong — satu kotak yang tidak bisa diisi',
  MURNI,
  'export function purposeWajib(opsi) {\n  return Array.isArray(opsi) && opsi.length > 0;',
  'export function purposeWajib(opsi) {\n  return true;',
  TES
);
sabotase(
  'daftar Purpose yang gagal dimuat mematikan SELURUH layar Bahan',
  INV,
  "      listEsbMaster(businessUnitId, 'purpose').catch(() => [])",
  "      listEsbMaster(businessUnitId, 'purpose')",
  AUDIT
);

console.log('\nSABOTASE EJAAN YANG TERKIRIM:');

sabotase(
  'yang tersimpan ejaan yang DIKETIK, bukan dari daftarnya — "waste bar" ditolak ESB',
  MIG,
  '  if v_kanonik is null then',
  '  v_kanonik := v;\n  if false then',
  PG
);
sabotase(
  'modul murninya mengembalikan isi kotaknya, bukan ejaan daftarnya',
  MURNI,
  '  return { boleh: true, nilai: cocok.value, sebab: \'\' };',
  "  return { boleh: true, nilai: v, sebab: '' };",
  TES
);
sabotase(
  'pencocokannya jadi peka huruf besar-kecil — pilihan yang sah ikut ditolak',
  MIG,
  '     and lower(btrim(m.nama)) = lower(v)',
  '     and m.nama = v',
  PG
);
sabotase(
  'normalisasinya membuang tanda baca — "COGS - Food" dan "COGS Food" jadi sama',
  MURNI,
  "  return teks(v).replace(/\\s+/g, ' ').toLowerCase();",
  "  return teks(v).replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase();",
  AUDIT
);
// Jangkarnya diperpanjang sampai baris berikutnya: `v_purpose :=
// purpose_esb_sah(...)` ada di DUA fungsi (catat_waste dan
// ubah_purpose_waste), dan `String.replace` cuma mengenai yang pertama.
sabotase(
  'nilai yang diketik sendiri lolos ke database lewat jalur staff',
  MIG,
  "  v_purpose := purpose_esb_sah(v_bu, p_purpose);\n\n  select name into v_nama from products where id = p_product;",
  "  v_purpose := nullif(btrim(coalesce(p_purpose, '')), '');\n\n  select name into v_nama from products where id = p_product;",
  PG
);
sabotase(
  'nilai yang diketik sendiri lolos lewat jalur admin',
  MIG,
  '  v_purpose := purpose_esb_sah(v_bu, p_purpose);\n  if v_purpose is null then',
  "  v_purpose := nullif(btrim(coalesce(p_purpose, '')), '');\n  if v_purpose is null then",
  PG
);
sabotase(
  'layar staff berhenti memeriksa nilainya sebelum mengirim',
  INV,
  '    const cekPurpose = periksaPurpose(v.purpose, purposeOptions);',
  '    const cekPurpose = { boleh: true, nilai: v.purpose ?? null, sebab: \'\' };',
  AUDIT
);

console.log('\nSABOTASE ARTI NILAINYA — akun COGS yang salah, tanpa satu pun tanda:');

sabotase(
  'Purpose kembali ditebak dari pemetaan, bukan dari kejadiannya',
  JOURNAL,
  '    const purpose = teks(w.purpose) || null;',
  "    const purpose = peta?.purpose?.get?.(teks(w.jenis).toLowerCase()) ?? null;",
  TES_J
);
sabotase(
  'waste tanpa Purpose tetap berangkat — jurnalnya masuk ESB tanpa akun tujuan',
  JOURNAL,
  '    if (adaMasalah || !purpose) {',
  '    if (adaMasalah) {',
  TES_J
);
sabotase(
  "'purpose' kembali jadi jenis pemetaan — kelompok kosong yang tidak bisa dikerjakan siapa pun",
  PURCHASE,
  "'unit', 'item', 'supplier'];",
  "'unit', 'item', 'supplier', 'purpose'];",
  TES_J
);
sabotase(
  'kolom purpose tidak diambil dari database — setiap waste tertahan dengan alasan yang salah',
  ESVC,
  "      .select('id, code, jenis, notes, purpose, outlet_id, created_at, esb_exported_at', { count: 'exact' })",
  "      .select('id, code, jenis, notes, outlet_id, created_at, esb_exported_at', { count: 'exact' })",
  AUDIT
);

console.log('\nSABOTASE JALAN MENGISI MUNDUR:');

sabotase(
  'kejadian yang SUDAH diekspor ikut berubah — catatan berbeda di dua tempat, selamanya',
  MIG,
  "     and w.esb_exported_at is null\n     and is_bu_admin(v_uid, w.business_unit_id);\n  get diagnostics v_n = row_count;\n  return v_n;\nend;\n$$;\n\nrevoke all on function ubah_purpose_waste",
  '     and is_bu_admin(v_uid, w.business_unit_id);\n  get diagnostics v_n = row_count;\n  return v_n;\nend;\n$$;\n\nrevoke all on function ubah_purpose_waste',
  PG
);
// BU yang dipakai MEMERIKSA diambil dari baris yang benar-benar dipegang
// pemanggilnya. Tanpa itu, `limit 1` tanpa urutan bisa memilih waste milik BU
// lain — yang daftar Purpose-nya kosong, sehingga keadaan "belum diimpor"
// berlaku dan nilai APA PUN diterima, lalu ditulis ke baris milik BU sendiri.
sabotase(
  'daftar pemeriksanya bisa milik BU lain — nilai apa pun lolos lewat array campuran',
  MIG,
  '  select w.business_unit_id into v_bu\n    from waste_runs w\n   where w.id = any(p_waste)\n     and is_bu_admin(v_uid, w.business_unit_id)\n   limit 1;',
  '  select w.business_unit_id into v_bu\n    from waste_runs w\n   where w.id = any(p_waste)\n   limit 1;',
  PG
);
sabotase(
  'mengosongkan Purpose diterima — kejadiannya tetap tertahan, tanpa jejak kenapa',
  MIG,
  "  if v_purpose is null then\n    raise exception 'Pilih Purpose-nya dulu.",
  "  if false then\n    raise exception 'Pilih Purpose-nya dulu.",
  PG
);
sabotase(
  'penolakannya berhenti menyebut jalan keluarnya — yang membacanya membuka SQL Editor',
  MIG,
  'Buka tandanya dulu lewat Admin Portal -> Inventory -> Ekspor ESB -> "Batalkan tanda ekspor"',
  'Hubungi administrator',
  PG
);
sabotase(
  'tombol mengisi Purpose dicabut dari layar — kemampuannya ada, jalannya tidak',
  WADM,
  '      const n = await ubahPurposeWaste([wasteId], v.purpose);',
  '      const n = 0;',
  AUDIT
);
sabotase(
  'kolom Purpose tidak digambar sebagai sel khusus — tidak ada tombolnya',
  WADM,
  '                  j === KOLOM_PURPOSE',
  '                  false',
  AUDIT
);
sabotase(
  '"0 berubah" dilaporkan sebagai berhasil — admin mengira pekerjaannya selesai',
  WADM,
  '      if (n === 0) {',
  '      if (false) {',
  AUDIT
);
sabotase(
  'tabelnya tidak dimuat ulang — tombolnya tetap berbunyi "belum diisi" sesudah diisi',
  WADM,
  '    await muat();\n  }',
  '  }',
  AUDIT
);
sabotase(
  'baris lama diberi tombol Edit — tidak ada waste_runs yang bisa diubahnya',
  WADM,
  '    if (!meta?.wasteId || meta.lama) {',
  '    if (false) {',
  AUDIT
);
sabotase(
  'kejadian yang sudah diekspor tetap diberi tombol — kliknya pasti ditolak',
  WADM,
  '    if (meta.terkunci) {',
  '    if (false) {',
  AUDIT
);

console.log('\nSABOTASE ANGKA PEKERJAANNYA:');

sabotase(
  'kejadian tanpa Purpose dihitung per BARIS — satu waste menu terbaca jadi sepuluh pekerjaan',
  LAP,
  '    if (!purpose && !b?.lama && b?.waste_id) kejadianTanpaPurpose.add(b.waste_id);',
  '    if (!purpose && !b?.lama && b?.waste_id) kejadianTanpaPurpose.add(`${b.waste_id}|${b.product_id}`);',
  TES_L
);
sabotase(
  'baris LAMA ikut dihitung — admin disuruh mengerjakan yang tidak bisa dikerjakan, selamanya',
  LAP,
  '    if (!purpose && !b?.lama && b?.waste_id) kejadianTanpaPurpose.add(b.waste_id);',
  '    if (!purpose && b?.waste_id) kejadianTanpaPurpose.add(b.waste_id);',
  TES_L
);
sabotase(
  'Purpose kosong jadi sel kosong — di Excel terbaca "tidak berlaku", bukan "belum dikerjakan"',
  LAP,
  "    r.purpose || (r.lama ? '-' : PURPOSE_KOSONG),",
  '    r.purpose,',
  TES_L
);
sabotase(
  'posisi kolom Purpose ditulis sebagai angka — tombolnya menempel di sel Catatan',
  LAP,
  "export const KOLOM_PURPOSE = KOLOM_WASTE.findIndex((k) => k.header === 'Purpose');",
  'export const KOLOM_PURPOSE = 8;',
  AUDIT
);
sabotase(
  'penanda terkunci tidak diteruskan — layar menawarkan tombol yang pasti ditolak',
  LAP,
  '      terkunci: r.terkunci',
  '      terkunci: false',
  TES_L
);

console.log('\nSABOTASE JALUR LAYANANNYA:');

sabotase(
  'p_purpose tidak dikirim — PostgREST mencari tanda tangan enam argumen yang sudah dibuang',
  WSVC,
  '      p_purpose: purpose ?? null',
  '      p_purpose: purpose',
  AUDIT
);
sabotase(
  'jalan mengisi Purpose dari Admin Portal dicabut dari layanannya',
  WSVC,
  'export async function ubahPurposeWaste(wasteIds, purpose) {',
  'async function ubahPurposeWaste(wasteIds, purpose) {',
  AUDIT
);
sabotase(
  'rekap waste mati total sebelum 0147 dijalankan — satu kolom baru menyandera seluruh daftar',
  WSVC,
  "    { kolom: `${KOLOM_DASAR}, lama, purpose, esb_terkunci`, pola: /\\b(purpose|esb_terkunci)\\b/ },",
  '    { kolom: `${KOLOM_DASAR}, lama, purpose, esb_terkunci`, pola: null },',
  AUDIT
);
sabotase(
  'galat izin & jaringan ikut ditelan, menyamar jadi "kolomnya belum ada"',
  WSVC,
  "      if (!t.pola || !t.pola.test(String(e?.message ?? ''))) throw e;",
  '      void e;',
  AUDIT
);

console.log('\nSABOTASE IMPOR DAFTARNYA:');

sabotase(
  'berkas Master Purpose tidak bisa dibaca — dropdown-nya tidak akan pernah terisi',
  EADM,
  "    purpose: ['Purpose Name']",
  "    purpose: ['Purpose']",
  AUDIT
);
sabotase(
  'Master Purpose hilang dari pilihan impor — kemampuannya ada, jalannya tidak',
  EADM,
  '          <option value="purpose">Master Purpose</option>\n',
  '',
  AUDIT
);
sabotase(
  'baris nonaktif ikut diimpor — ditawarkan ke staff, lalu ditolak ESB',
  EADM,
  "    if (iStatus >= 0 && String(r[iStatus] ?? '').trim().toLowerCase() === 'inactive') continue;\n",
  '',
  AUDIT
);
sabotase(
  'baris berjenis lain ikut jadi opsi — nama produk ditawarkan sebagai Purpose yang sah',
  MURNI,
  "    if (teks(m?.jenis) !== 'purpose') continue;",
  '    if (false) continue;',
  AUDIT
);
sabotase(
  'nama kembar membuat yang TERAKHIR menang — ejaannya tergantung urutan dari database',
  MURNI,
  '    if (sudah.has(k)) continue;',
  '    if (false) continue;',
  TES
);
// Kunci kembar di satu objek literal SAH di JavaScript, dan yang belakangan
// menang diam-diam. Inilah bug yang sungguh terjadi saat menulis fitur ini:
// langkah "Daftar induk ESB" berbunyi "5 Purpose kosong (isi di Rekap Waste /
// Spoil)". Tidak ada galat, tidak ada peringatan, dan `node --check` diam.
sabotase(
  'LABEL_JENIS punya kunci kembar — satu label muncul di tempat yang salah, diam-diam',
  EADM,
  "  'purpose-kosong': 'Purpose kosong (isi di Rekap Waste / Spoil)'",
  "  purpose: 'Purpose kosong (isi di Rekap Waste / Spoil)'",
  AUDIT
);

console.log('\nSABOTASE MIGRATION 0147:');

sabotase(
  'tanda tangan 6-argumen dibiarkan hidup — permintaan tanpa p_purpose tersimpan diam-diam',
  MIG,
  'drop function if exists catat_waste(uuid, text, uuid, numeric, text, text);',
  '',
  PG
);
sabotase(
  'kolom purpose tidak dibuat — seluruh fitur berdiri di atas kolom yang tidak ada',
  MIG,
  'alter table waste_runs add column if not exists purpose text;',
  '',
  PG
);
sabotase(
  'Purpose diperiksa SESUDAH barisnya ditulis — penolakannya meninggalkan kejadian separuh jadi',
  MIG,
  '  v_purpose := purpose_esb_sah(v_bu, p_purpose);\n\n  select name into v_nama from products where id = p_product;',
  '  select name into v_nama from products where id = p_product;',
  AUDIT
);
sabotase(
  'pengisi Purpose dikarang untuk kejadian yang Purpose-nya kosong',
  MIG,
  '          case when v_purpose is null then null else v_uid end,',
  '          v_uid,',
  AUDIT
);
sabotase(
  'kolom purpose hilang dari cabang kedua view — jumlah kolomnya tidak sama, view-nya gagal',
  MIG,
  '         null::text  as purpose,\n',
  '',
  PG
);
sabotase(
  'penanda terkunci tidak dibuat — layar tidak bisa tahu mana yang sudah diekspor',
  MIG,
  '         (w.esb_exported_at is not null) as esb_terkunci',
  '         false as esb_terkunci',
  PG
);

console.log('');
if (gagal === 0) console.log('Semua sabotase Purpose tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
