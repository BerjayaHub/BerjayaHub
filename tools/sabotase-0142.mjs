/**
 * SABOTASE: pengecekan kiriman yang bisa dicicil (0142).
 *
 * Yang dijaga: "belum dicek" tidak pernah menyamar jadi angka, cicilan dua
 * orang tidak saling menghapus, jejak pengeceknya utuh, dan Simpan Sementara
 * tidak pernah menggerakkan stok.
 *
 * ============ JEBAKAN `String.replace` ============
 *
 * Mengganti dengan STRING hanya mengenai kemunculan PERTAMA. Pola yang muncul
 * lebih dari sekali harus memakai regex `/…/g` — `insert into stock_movements`
 * di migration ini muncul dua kali (transfer_out & transfer_in).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0142_cek_kiriman_bisa_dicicil.sql';
const MURNI = 'js/modules/dispatch/cek-kiriman.js';
const PAGE = 'js/modules/dispatch/dispatch.page.js';
const SVC = 'js/modules/dispatch/dispatch.service.js';

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

const TES_MIG = 'tools/test-migrasi-0142.mjs';
const TES = 'tools/test-cek-kiriman.mjs';
const AUDIT = 'tools/audit-cek-kiriman.cjs';

console.log('SABOTASE "KOSONG BUKAN NOL":');

sabotase(
  'string kosong tidak disaring — kotak kosong tercatat 0, yaitu "barangnya tidak datang"',
  MURNI,
  "  if (t === '') return null;",
  '  if (false) return null;',
  TES
);
sabotase(
  'nol dianggap belum dicek — barang yang memang tidak datang jadi mustahil dilaporkan',
  MURNI,
  '  if (!Number.isFinite(n) || n < 0) return null;\n  return n;',
  '  if (!Number.isFinite(n) || n <= 0) return null;\n  return n;',
  TES
);
sabotase(
  'negatif diterima — jumlah diterima yang minus menambah stok ke arah yang salah',
  MURNI,
  '  if (!Number.isFinite(n) || n < 0) return null;',
  '  if (!Number.isFinite(n)) return null;',
  TES
);
sabotase(
  'kolom dicek_qty tidak boleh NULL — "belum dijawab" jadi tidak punya tempat',
  MIG,
  'check (dicek_qty is null or dicek_qty >= 0)',
  'check (coalesce(dicek_qty, 0) >= 0)',
  AUDIT
);

console.log('\nSABOTASE CICILAN DUA ORANG:');

sabotase(
  'baris tanpa kunci dicek_qty ikut ditulis — staff kedua MENGHAPUS hitungan staff pertama',
  MIG,
  "    if not (it ? 'dicek_qty') then continue; end if;",
  '    if false then continue; end if;',
  TES_MIG
);
sabotase(
  'jejak pengecek ditimpa tanpa syarat — nama yang menghitung hilang justru saat ada selisih',
  MIG,
  '    if v_qty is distinct from v_lama then',
  '    if true then',
  TES_MIG
);
sabotase(
  'pembatalan cek tidak membersihkan jejaknya — nama menempel pada hitungan yang sudah tidak ada',
  MIG,
  '             dicek_by = case when v_qty is null then null else v_uid end,',
  '             dicek_by = v_uid,',
  TES_MIG
);
sabotase(
  'nilai negatif disimpan apa adanya',
  MIG,
  '    if v_qty is not null and v_qty < 0 then v_qty := 0; end if;',
  '    if false then v_qty := 0; end if;',
  TES_MIG
);
sabotase(
  'isian layar tidak lagi menang atas yang tersimpan — layar berkata "belum dicek" untuk kotak yang terisi',
  MURNI,
  '    const dari = isian instanceof Map && isian.has(it?.id) ? isian.get(it.id) : it?.dicek_qty;',
  '    const dari = it?.dicek_qty;',
  TES
);
// Pemeriksanya TES, bukan AUDIT: sabotase ini menyaring baris null tanpa
// mengubah bentuk objek yang dihasilkan, jadi pola teks di auditnya tetap
// cocok. Yang bisa melihat bedanya cuma menjalankan fungsinya.
sabotase(
  'muatan berhenti menyertakan baris kosong — pembatalan cek jadi mustahil',
  MURNI,
  '  return [...peta.entries()].map(([item_id, v]) => ({ item_id, dicek_qty: bacaCek(v) }));',
  '  return [...peta.entries()].filter(([, v]) => bacaCek(v) !== null).map(([item_id, v]) => ({ item_id, dicek_qty: bacaCek(v) }));',
  TES
);

console.log('\nSABOTASE "SIMPAN SEMENTARA TIDAK MENGGERAKKAN STOK":');

sabotase(
  'Simpan Sementara ikut menutup SJ — seluruh gunanya hilang',
  MIG,
  "  return jsonb_build_object(\n    'diubah', v_ubah,",
  "  update dispatches set status = 'received' where id = p_dispatch;\n  return jsonb_build_object(\n    'diubah', v_ubah,",
  AUDIT
);
sabotase(
  'izin outlet tujuan dicabut — outlet lain bisa mengecek kiriman yang bukan miliknya',
  MIG,
  '  if not has_outlet_scope(v_uid, v_d.to_outlet_id) then\n    raise exception \'Hanya outlet tujuan yang boleh mengecek kiriman ini.\';',
  '  if false then\n    raise exception \'Hanya outlet tujuan yang boleh mengecek kiriman ini.\';',
  TES_MIG
);
sabotase(
  'kiriman yang sudah diterima masih bisa diubah hasil ceknya',
  MIG,
  "  if v_d.status <> 'sent' then\n    raise exception 'Kiriman ini sudah diproses, hasil cek tidak bisa diubah lagi.';",
  "  if false then\n    raise exception 'Kiriman ini sudah diproses, hasil cek tidak bisa diubah lagi.';",
  TES_MIG
);

console.log('\nSABOTASE "TERIMA TIDAK MENEBAK":');

sabotase(
  'baris yang belum dicek berhenti menghentikan penerimaan — kembali menebak diam-diam',
  MIG,
  '  if v_belum is not null then',
  '  if false then',
  TES_MIG
);
sabotase(
  'penolakannya berhenti menyebut nama barangnya',
  MIG,
  "  select string_agg(p.name, ', ' order by p.name) into v_belum",
  "  select case when count(*) > 0 then 'ada' end into v_belum",
  TES_MIG
);
// PEMERIKSANYA AUDIT, DAN INI PERLU DIKATAKAN JUJUR.
//
// `coalesce(r.dicek_qty, 0)` adalah pertahanan BERLAPIS, bukan penjaganya:
// penjagaan sebenarnya ada di `raise exception` beberapa baris di atas, yang
// menghentikan seluruh penerimaan selama masih ada `dicek_qty` NULL. Selama
// penjaga itu berdiri, baris ini tidak pernah tercapai — jadi tesnya TIDAK
// merah, dan itu memang benar.
//
// Ia tetap dijaga audit supaya kalau suatu saat penjaga di atas dilonggarkan,
// yang tersisa di bawah tidak diam-diam berubah jadi "terima sesuai kiriman".
sabotase(
  'lapis kedua berubah jadi "terima sesuai kiriman"',
  MIG,
  '    v_recv := coalesce(r.dicek_qty, 0);',
  '    v_recv := coalesce(r.dicek_qty, r.sent_qty);',
  AUDIT
);
sabotase(
  'pergerakan stok dibaca dari p_items, bukan dari tabelnya — baris yang tidak terkirim kehilangan stoknya',
  MIG,
  '    select di.id, di.product_id, di.sent_qty, di.dicek_qty\n      from dispatch_items di\n     where di.dispatch_id = p_dispatch',
  "    select di.id, di.product_id, di.sent_qty, di.dicek_qty\n      from dispatch_items di\n     where di.dispatch_id = p_dispatch and di.id in (select (x->>'item_id')::uuid from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x)",
  TES_MIG
);
sabotase(
  'angka dari layar ditulis lewat jalan sendiri, bukan simpan_cek_kiriman',
  MIG,
  '  perform simpan_cek_kiriman(p_dispatch, p_items);',
  '',
  AUDIT
);

console.log('\nSABOTASE LAYAR:');

sabotase(
  'kotak "Diterima" kembali terisi angka kiriman — bug utamanya hidup lagi',
  PAGE,
  "                               value=\"${it.dicek_qty == null ? '' : round(it.dicek_qty)}\" />",
  '                               value="${round(it.sent_qty)}" />',
  AUDIT
);
sabotase(
  'kotaknya berhenti diisi dari hasil cek tersimpan — cicilan orang sebelumnya hilang dari layar',
  PAGE,
  "value=\"${it.dicek_qty == null ? '' : round(it.dicek_qty)}\"",
  'value=""',
  AUDIT
);
sabotase(
  'tombol borongan menimpa baris yang sudah diisi orang lain',
  PAGE,
  "        for (const el of kartu.querySelectorAll('.recv-input')) if (el.value.trim() === '') el.value = el.dataset.kirim;",
  "        for (const el of kartu.querySelectorAll('.recv-input')) el.value = el.dataset.kirim;",
  AUDIT
);
sabotase(
  'tombol Simpan Sementara dihapus',
  PAGE,
  '<button class="btn-save-cek" data-id="${d.id}" style="max-width:220px">💾 Simpan Sementara</button>',
  '',
  AUDIT
);
// Kelasnya cuma DIGANTI NAMA, tombolnya masih tergambar. Pemeriksaan yang cuma
// mencari `btn-save-cek` lolos di sini — nama lamanya masih jadi awalan nama
// barunya — sementara penangan kliknya tidak pernah tersambung.
sabotase(
  'kelas tombolnya diganti nama — tombolnya ada tapi tidak berfungsi',
  PAGE,
  '<button class="btn-save-cek" data-id="${d.id}"',
  '<button class="btn-save-cek-nonaktif" data-id="${d.id}"',
  AUDIT
);
sabotase(
  'Simpan Sementara berhenti mengatakan stok belum bergerak',
  PAGE,
  'Stok belum bergerak.',
  'Beres.',
  AUDIT
);
sabotase(
  'tombol Terima berhenti bertanya saat masih ada baris kosong',
  PAGE,
  '        if (r.belum) {',
  '        if (false) {',
  AUDIT
);
sabotase(
  'menutup dialog tanpa memilih tetap melanjutkan penerimaan',
  PAGE,
  "          if (!pilih || pilih.aksi === 'batal') return;",
  '          if (!pilih) return;',
  AUDIT
);
sabotase(
  'kemajuan pengecekan tidak lagi ditampilkan',
  PAGE,
  '        `<strong>${esc(teksKemajuan(r, jejak))}</strong>` +',
  "        '' +",
  AUDIT
);
sabotase(
  'jejak "dicek siapa" per baris dihapus',
  PAGE,
  '<div class="recv-jejak">dicek ${esc(it.pengecek.full_name)}</div>',
  '<div></div>',
  AUDIT
);
sabotase(
  'nama pengecek tidak ikut diambil — jejaknya tersimpan tapi tak pernah terlihat',
  SVC,
  "'pengecek:user_profiles!dicek_by(full_name), products(name, base_unit)'",
  "'products(name, base_unit)'",
  AUDIT
);
sabotase(
  'jaring pengaman kolom-belum-ada tidak mengenali kolom 0142 — seluruh isi kiriman menghilang sebelum migration jalan',
  SVC,
  '|dicek_qty|dicek_at|dicek_by',
  '',
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase cek kiriman tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
