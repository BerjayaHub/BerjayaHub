/**
 * SABOTASE: input manual bengkel, form dokumen, & hapus massal (0191).
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Semua kerusakan di sini berbentuk sama: layarnya tetap jalan, angkanya tetap
 * keluar, dan yang hilang baru terasa berminggu-minggu kemudian.
 *
 *   - daftar pilihan yang terpotong wadah bergulir: penyaringannya tetap
 *     berjalan, hasilnya tetap dihitung, dan yang mengetik "shell" melihat
 *     KOSONG — lalu menyimpulkan pencariannya belum dibuat. Itu betul-betul
 *     terjadi, dan itu sebabnya sabotase pertama di bawah ada;
 *   - nomor dokumen manual tanpa awalan `MAN/`: impor Turboly berikutnya
 *     menghapus bon yang diketik orang, tanpa berkas untuk memulihkannya;
 *   - harga beli kosong yang disimpan sebagai 0: laporan pengeluaran
 *     membacanya sebagai barang gratis dan diam saja;
 *   - hapus massal tanpa pratinjau: 1.900 baris hilang dengan satu tekanan,
 *     dan yang menekannya belum tentu tahu berapa yang kena.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0191_pembelian_manual_dan_hapus_massal.sql';
const UI = 'js/core/ui.js';
const CSS = 'css/styles.css';
const MURNI = 'js/modules/bengkel/baris-pembelian-manual.js';
const PAGE = 'js/modules/bengkel/penjualan-rinci.admin.page.js';
const SVC = 'js/modules/bengkel/penjualan-rinci.service.js';
const SPPAGE = 'js/modules/sparepart/sparepart.admin.page.js';
const SPSVC = 'js/modules/sparepart/sparepart.service.js';

const BERKAS = [MIG, UI, CSS, MURNI, PAGE, SVC, SPPAGE, SPSVC];
const asli = new Map();
for (const rel of BERKAS) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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

// Pemeriksa yang sudah merah sejak awal melaporkan SELURUH sabotase sebagai
// tertangkap, dan harness ini berubah jadi stempel.
const pastikanHijau = (cmd) => {
  if (process.env.SABOTASE_PERIKSA_POLA) return;
  if (!jalan(cmd)) {
    console.error(`❌ PEMERIKSANYA SUDAH MERAH SEBELUM DISABOTASE: ${cmd} — "tertangkap" di bawah tidak berarti apa-apa.`);
    process.exit(1);
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
  if (typeof dari === 'string' && isi.split(dari).length > 2) {
    gagal++;
    console.error(`❌ POLANYA MUNCUL >1 KALI: ${nama} di ${rel} — sabotasenya cuma mengenai yang pertama.`);
    return;
  }
  if (process.env.SABOTASE_PERIKSA_POLA) {
    console.log(`   ✔ pola terpasang: ${nama}`);
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

const PG = 'tools/test-migrasi-0191.mjs';
const AUDIT = 'tools/audit-input-manual-bengkel.cjs';
const MURNI_TES = 'tools/test-baris-pembelian-manual.mjs';

for (const p of [PG, AUDIT, MURNI_TES]) pastikanHijau(p);

// =====================================================================
console.log('DAFTAR PILIHAN YANG TIDAK TERLIHAT');
// =====================================================================

// Kerusakan yang betul-betul terjadi: pencariannya tetap bekerja, hasilnya
// tetap dihitung, dan yang mengetik "shell" melihat kosong.
sabotase(
  'daftar pilihan kembali terkurung di dalam kotaknya',
  UI,
  '      document.body.appendChild(list);',
  '      widget.appendChild(list);',
  AUDIT
);

sabotase(
  'daftar mengambang tidak ditandai (kehilangan posisinya)',
  UI,
  "      list.classList.add('ss-floating');",
  '',
  AUDIT
);

sabotase(
  'daftar tidak dikembalikan saat ditutup (tertinggal menempel di layar)',
  UI,
  '    if (list.parentElement !== widget) widget.appendChild(list);',
  '',
  AUDIT
);

sabotase(
  'daftar tidak ikut saat layar digulir',
  UI,
  "  window.addEventListener('scroll', ikutGulir, true);",
  '',
  AUDIT
);

sabotase(
  'penyaringan berhenti fuzzy',
  UI,
  '    draw(options.filter((o) => fuzzyMatch(input.value, o.label)));',
  '    draw(options);',
  AUDIT
);

sabotase(
  'daftar mengambang tenggelam di belakang dialog',
  CSS,
  '.ss-list.ss-floating {\n  position: fixed;\n  z-index: 2000;\n}',
  '.ss-list.ss-floating {\n  position: fixed;\n  z-index: 2;\n}',
  AUDIT
);

// =====================================================================
console.log('\nFORM DOKUMEN');
// =====================================================================

sabotase(
  'form dokumen kembali selebar 560px di desktop',
  CSS,
  '.modal-card.modal-dokumen {\n  max-width: min(1100px, calc(100vw - 32px));\n}',
  '.modal-card.modal-dokumen {\n  max-width: 560px;\n}',
  AUDIT
);

// Delapan kolom di layar 360px tidak akan pernah terbaca.
sabotase(
  'tabel baris tidak lagi jadi kartu di HP',
  CSS,
  '  .dok-baris-tabel thead { display: none; }',
  '  .dok-baris-tabel thead { display: table-header-group; }',
  AUDIT
);

// =====================================================================
console.log('\nKETERGANTUNGAN MIGRATION');
// =====================================================================

// Tanpa pemeriksaan ini, 0191 terpasang mulus di atas database yang belum
// punya 0189 — dan gagal berminggu-minggu kemudian, jauh dari sebabnya.
sabotase(
  'ketergantungan pada 0189 tidak diperiksa',
  MIG,
  `do $$
begin
  if to_regprocedure('outlet_admin_saya(uuid, uuid)') is null then
    raise exception
      'Migration 0189 belum dijalankan. Jalankan 0189_impor_bengkel_admin_outlet.sql dulu, baru 0191 ini — fungsi outlet_admin_saya() lahir di sana.';
  end if;
end $$;`,
  '',
  PG
);

// =====================================================================
console.log('\nNOMOR DOKUMEN MANUAL');
// =====================================================================

// Tanpa awalan, impor Turboly berikutnya menghapus bon yang diketik orang.
sabotase(
  'nomor yang diketik sendiri tidak diberi awalan MAN/',
  MIG,
  "    v_no := 'MAN/' || v_no;",
  '    null;',
  PG
);

sabotase(
  'impor ikut menimpa dokumen manual',
  MIG,
  `    if exists (select 1 from bengkel_purchase_lines
                where business_unit_id = p_bu and upper(btrim(po_no)) = upper(v_po) and sumber = 'manual') then
      if not (upper(v_po) = any(v_lewat_manual)) then v_lewat_manual := v_lewat_manual || upper(v_po); end if;
      continue;
    end if;`,
  '',
  PG
);

sabotase(
  'penggantian isi PO tidak dibatasi sumber turboly',
  MIG,
  `        delete from bengkel_purchase_lines
         where business_unit_id = p_bu and upper(btrim(po_no)) = upper(v_po) and sumber = 'turboly';`,
  `        delete from bengkel_purchase_lines
         where business_unit_id = p_bu and upper(btrim(po_no)) = upper(v_po);`,
  AUDIT
);

sabotase(
  'sapuan menyeluruh ikut menghapus dokumen manual',
  MIG,
  `      delete from bengkel_purchase_lines
       where business_unit_id = r.business_unit_id
         and sumber = 'turboly'
         and upper(btrim(po_no)) = any(r.nomor_dokumen);`,
  `      delete from bengkel_purchase_lines
       where business_unit_id = r.business_unit_id
         and upper(btrim(po_no)) = any(r.nomor_dokumen);`,
  AUDIT
);

sabotase(
  'nomor kembar diterima',
  MIG,
  `  if exists (select 1 from bengkel_purchase_lines
              where business_unit_id = p_bu and upper(btrim(po_no)) = upper(v_no)) then
    raise exception 'Nomor dokumen % sudah dipakai.', v_no;
  end if;`,
  '',
  PG
);

sabotase(
  'menyunting menambah baris, bukan mengganti',
  MIG,
  `    delete from bengkel_purchase_lines
     where business_unit_id = p_bu and upper(btrim(po_no)) = v_id_lama and sumber = 'manual';`,
  '',
  PG
);

// =====================================================================
console.log('\nWEWENANG PEMBELIAN MANUAL');
// =====================================================================

sabotase(
  'admin outlet bisa mencatat pembelian pusat',
  MIG,
  `    if not is_bu_admin(v_uid, p_bu) then
      raise exception 'Pembelian pusat (tanpa outlet) hanya bisa dicatat Admin BU.';
    end if;`,
  '',
  PG
);

sabotase(
  'outlet di luar wewenang diterima',
  MIG,
  `    if not is_admin_of_outlet(v_uid, v_outlet) then
      raise exception 'Outlet itu di luar wewenangmu.';
    end if;`,
  '',
  PG
);

sabotase(
  'dokumen hasil impor bisa dihapus lewat pintu manual',
  MIG,
  `  if v_sumber <> 'manual' then
    raise exception 'Dokumen ini hasil impor Turboly. Pakai "Hapus satu dokumen" di tab Impor.';
  end if;`,
  '',
  PG
);

// =====================================================================
console.log('\nHARGA BELI KOSONG');
// =====================================================================

// Nol adalah harga; kosong berarti belum tahu.
sabotase(
  'harga beli yang dikosongkan disimpan sebagai nol',
  MURNI,
  "      harga: h === '' ? '' : String(angkaIsian(h)),",
  "      harga: h === '' ? '0' : String(angkaIsian(h)),",
  MURNI_TES
);

sabotase(
  'isi dari master memakai harga JUAL sebagai harga beli',
  MURNI,
  '    harga: sp.harga_beli === null || sp.harga_beli === undefined ? \'\' : String(sp.harga_beli),',
  '    harga: sp.harga_jual === null || sp.harga_jual === undefined ? \'\' : String(sp.harga_jual),',
  MURNI_TES
);

sabotase(
  'qty nol diterima',
  MURNI,
  "  if (q <= 0) return 'qty harus lebih dari 0';",
  '',
  MURNI_TES
);

sabotase(
  'baris tanpa harga tidak dihitung terpisah di ringkasan',
  MURNI,
  "    if (b.harga === '') r.tanpaHarga += 1;",
  '    if (false) r.tanpaHarga += 1;',
  MURNI_TES
);

// =====================================================================
console.log('\nLAYAR');
// =====================================================================

sabotase(
  'form dokumen tidak lagi meminta lebar desktop',
  PAGE,
  "      lebar: 'dokumen',\n      fields: [{ name: 'dok', label: '', type: 'html', html: htmlDokumen }],\n      submitText: 'Simpan',\n      onReady: (form, { kumpulkan, setError }) => {\n        const tbody = form.querySelector('#kb-tabel tbody');",
  "      fields: [{ name: 'dok', label: '', type: 'html', html: htmlDokumen }],\n      submitText: 'Simpan',\n      onReady: (form, { kumpulkan, setError }) => {\n        const tbody = form.querySelector('#kb-tabel tbody');",
  AUDIT
);

sabotase(
  'baris pembelian memakai harga jual dari master',
  PAGE,
  '            const isi = beliDariMaster(sp);',
  '            const isi = dariMaster(sp);',
  AUDIT
);

sabotase(
  'pilihan "Pembelian pusat" ditawarkan ke semua orang',
  PAGE,
  "      ...(adminBuSaya ? [{ value: '', label: '— Pembelian pusat (tanpa outlet) —' }] : [])",
  "      { value: '', label: '— Pembelian pusat (tanpa outlet) —' }",
  AUDIT
);

sabotase(
  'daftar pembelian manual tidak menyaring sumber',
  SVC,
  "      .eq('sumber', 'manual')",
  '',
  AUDIT
);

sabotase(
  'daftar pembelian manual tidak dikelompokkan per dokumen',
  SVC,
  '      peta.set(b.po_no, {',
  '      peta.set(b.id, {',
  AUDIT
);

// =====================================================================
console.log('\nHAPUS MASSAL SPAREPART');
// =====================================================================

sabotase(
  'hapus massal tanpa pratinjau',
  SPPAGE,
  '      dampak = await dampakHapusMassal(businessUnitId, ids);',
  '      dampak = { total: ids.length, bisa_dihapus: ids.length, dipakai_invoice: 0, harga_outlet: 0, contoh: [] };',
  AUDIT
);

sabotase(
  'pilihan baris tinggal di DOM (hilang tiap huruf yang diketik)',
  SPPAGE,
  '  const terpilih = new Set();',
  '  const terpilih = { has: () => false, add() {}, delete() {}, clear() {}, size: 0 };',
  AUDIT
);

sabotase(
  'tiap centang menggambar ulang seluruh tabel',
  SPPAGE,
  '        segarkanBarMassal();\n      })\n    );',
  '        gambar();\n      })\n    );',
  AUDIT
);

sabotase(
  'yang terpakai invoice ikut terhapus',
  MIG,
  `     and not (
       s.sku is not null and exists (
         select 1 from bengkel_sale_lines l
          join bengkel_sale_invoices i on i.id = l.invoice_id
         where i.business_unit_id = p_bu and upper(btrim(coalesce(l.sku, ''))) = upper(btrim(s.sku))
       )
     );`,
  '     ;',
  PG
);

// Fungsinya `security definer`: RLS tidak menahannya.
sabotase(
  'hapus massal tidak disaring per BU',
  MIG,
  `  select array_agg(s.id) into v_bisa from spareparts s
   where s.business_unit_id = p_bu and s.id = any(p_ids)`,
  `  select array_agg(s.id) into v_bisa from spareparts s
   where s.id = any(p_ids)`,
  PG
);

sabotase(
  'hapus massal terbuka untuk siapa saja',
  MIG,
  `  if not is_bu_admin(v_uid, p_bu) then
    raise exception 'Hanya Admin BU yang boleh menghapus master sparepart.';
  end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then`,
  '  if coalesce(array_length(p_ids, 1), 0) = 0 then',
  PG
);

sabotase(
  'layanan hapus massal memakai delete langsung (penolakan RLS terbaca sukses)',
  SPSVC,
  "  const { data, error } = await supabase.rpc('hapus_sparepart_massal', {",
  "  const { data, error } = await supabase.from('spareparts').delete().in('id', ids).select('id').then((r) => ({ data: r.data, error: r.error })); const _ = ({",
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS — pemeriksanya belum cukup.`);
process.exit(gagal === 0 ? 0 : 1);
