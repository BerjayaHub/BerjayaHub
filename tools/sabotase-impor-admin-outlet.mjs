/**
 * SABOTASE: admin outlet mengimpor Turboly (0189).
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Perubahan ini MELONGGARKAN wewenang di satu-satunya tempat di seluruh
 * aplikasi yang bekerja dengan cara MENGHAPUS LALU MENULIS ULANG. Dua sifat
 * itu bertemu di satu titik: satu berkas ekspor Turboly bisa memuat beberapa
 * cabang, dan impornya mengganti isi tiap dokumen.
 *
 * Artinya satu penjagaan yang hilang — atau cuma dipindah urutannya — membuat
 * admin satu outlet menghapus dan menimpa data outlet lain. Tidak ada galat,
 * tidak ada penolakan, dan laporannya tetap rapi: "N baris dilewati karena
 * outlet lain" akan tetap tercetak di atas data yang sudah terhapus.
 *
 * Tiap sabotase di bawah adalah satu kalimat yang hilang dari 0189, dan
 * semuanya tetap berjalan tanpa satu pun pesan merah.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0189_impor_bengkel_admin_outlet.sql';
const SVC = 'js/modules/bengkel/penjualan-rinci.service.js';
const PAGE = 'js/modules/bengkel/penjualan-rinci.admin.page.js';

const BERKAS = [MIG, SVC, PAGE];
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

const PG = 'tools/test-migrasi-0189.mjs';
const AUDIT = 'tools/audit-impor-admin-outlet.cjs';

for (const p of [PG, AUDIT]) pastikanHijau(p);

// =====================================================================
console.log('SABOTASE: BATAS OUTLET DI IMPOR PENJUALAN');
// =====================================================================

// Inilah kerusakan yang paling mahal: admin outlet mana pun bisa menimpa
// seluruh invoice cabang lain hanya dengan mengunggah berkas yang memang
// berisi semuanya.
sabotase(
  'batas outlet dibuang (berkas satu cabang menimpa cabang lain)',
  MIG,
  `    if not v_bu_admin and (
      not (v_outlet = any(v_saya))
      or (v_id is not null and v_outlet_lama is not null and not (v_outlet_lama = any(v_saya)))
    ) then
      if not (v_store = any(v_lewat_outlet)) then v_lewat_outlet := v_lewat_outlet || v_store; end if;
      continue;
    end if;`,
  '',
  PG
);

// Penjagaan arah KEDUA: pemetaan store yang baru dibuat tidak boleh jadi jalan
// memindahkan invoice cabang lain beserta omzetnya ke outlet sendiri.
sabotase(
  'invoice milik outlet lain bisa direbut lewat pemetaan store baru',
  MIG,
  '      or (v_id is not null and v_outlet_lama is not null and not (v_outlet_lama = any(v_saya)))\n',
  '',
  PG
);

// Dilewati tanpa dilaporkan: ia menyangka seluruh berkasnya masuk, dan
// kekurangannya baru terasa di akhir bulan.
sabotase(
  'baris yang dilewati tidak dilaporkan kembali',
  MIG,
  "    'dilewati_outlet_lain', to_jsonb(v_lewat_outlet)",
  "    'dilewati_outlet_lain', to_jsonb('{}'::text[])",
  PG
);

// Nomor yang DILEWATI tidak boleh tercatat sebagai milik impor ini: kalau ia
// ikut, "tarik menyeluruh" nanti akan menyapu invoice cabang lain yang tidak
// pernah ia sentuh.
sabotase(
  'nomor yang dilewati ikut tercatat di riwayat impor',
  MIG,
  "    if not (upper(v_no) = any(v_nomor)) then v_nomor := v_nomor || upper(v_no); end if;\n\n    if v_id is null then",
  "    if v_id is null then",
  PG
);

// =====================================================================
console.log('\nSABOTASE: URUTAN DI IMPOR PEMBELIAN');
// =====================================================================

sabotase(
  'batas outlet dibuang di pembelian',
  MIG,
  `    if not v_bu_admin and v_outlet is not null and not (v_outlet = any(v_saya)) then
      v_lewat_outlet := v_lewat_outlet + 1;
      if not (v_alamat = any(v_alamat_lain)) then v_alamat_lain := v_alamat_lain || v_alamat; end if;
      continue;
    end if;`,
  '',
  PG
);

// PO yang isinya milik outlet lain: SELURUH PO dilewati. Tanpa ini, isinya
// dihapus lebih dulu lalu barisnya "dilewati" — pelaporan rapi di atas data
// yang sudah hilang.
sabotase(
  'PO milik outlet lain dihapus lebih dulu, lalu "dilewati"',
  MIG,
  `    if upper(v_po) = any(v_po_ditolak) then
      v_lewat_outlet := v_lewat_outlet + 1;
      continue;
    end if;`,
  '',
  PG
);

sabotase(
  'pemeriksaan isi PO lama dibuang (alamat kosong jadi surat kuasa)',
  MIG,
  '           and outlet_id is not null and not (outlet_id = any(v_saya))',
  '           and false',
  PG
);

// Pembelian PUSAT harus TETAP boleh — ia menambah, tidak menimpa. Diperketat
// diam-diam, separuh pengeluaran berhenti bisa diimpor tanpa ada yang
// menjelaskan kenapa.
sabotase(
  'pembelian pusat ikut ditolak (padahal boleh)',
  MIG,
  '    if not v_bu_admin and v_outlet is not null and not (v_outlet = any(v_saya)) then',
  '    if not v_bu_admin and not (coalesce(v_outlet, $x$00000000-0000-0000-0000-000000000000$x$::uuid) = any(v_saya)) then',
  PG
);

// =====================================================================
console.log('\nSABOTASE: PEMETAAN');
// =====================================================================

sabotase(
  'admin outlet bisa memetakan store ke outlet lain',
  MIG,
  `    if not (p_outlet = any(v_saya)) then
      raise exception 'Kamu hanya bisa memetakan store ke outlet yang kamu pegang.';
    end if;`,
  '',
  PG
);

sabotase(
  'pemetaan store outlet lain bisa direbut',
  MIG,
  `    if v_lama is not null and not (v_lama = any(v_saya)) then
      raise exception 'Store ini sekarang terpetakan ke outlet lain. Minta Admin BU kalau memang harus dipindah.';
    end if;`,
  '',
  PG
);

sabotase(
  'pemetaan alamat kirim outlet lain bisa direbut',
  MIG,
  `    if v_lama is not null and not (v_lama = any(v_saya)) then
      raise exception 'Alamat ini sekarang terpetakan ke outlet lain. Minta Admin BU kalau memang harus dipindah.';
    end if;`,
  '',
  PG
);

// Sejak 0186 tabel pemetaan memegang dua jenis dengan nama yang boleh sama.
// `select into` mengambil baris pertama tanpa galat — jadi penjualannya masuk
// ke outlet yang salah, dan tidak ada apa pun yang menandainya.
sabotase(
  'pencarian store tidak menyaring `jenis` (bisa terjawab baris alamat kirim)',
  MIG,
  `    select outlet_id into v_outlet from bengkel_store_map
     where business_unit_id = p_bu and jenis = 'store' and lower(btrim(store_name)) = lower(v_store);`,
  `    select outlet_id into v_outlet from bengkel_store_map
     where business_unit_id = p_bu and lower(btrim(store_name)) = lower(v_store);`,
  PG
);

// =====================================================================
console.log('\nSABOTASE: WEWENANG DASAR');
// =====================================================================

sabotase(
  'staff ikut bisa mengimpor penjualan',
  MIG,
  `  if not v_bu_admin and coalesce(array_length(v_saya, 1), 0) = 0 then
    raise exception 'Hanya Admin BU atau admin outlet di BU ini yang bisa mengimpor penjualan Turboly.';
  end if;`,
  '',
  PG
);

sabotase(
  'staff ikut bisa mengimpor pembelian',
  MIG,
  `  if not v_bu_admin and coalesce(array_length(v_saya, 1), 0) = 0 then
    raise exception 'Hanya Admin BU atau admin outlet di BU ini yang bisa mengimpor pembelian.';
  end if;`,
  '',
  PG
);

// Satu orang bisa jadi admin outlet di dua BU. Jawaban yang tidak menyaring BU
// memberinya wewenang di BU yang tidak ditanyakan.
sabotase(
  '`outlet_admin_saya` tidak menyaring BU',
  MIG,
  '     and o.business_unit_id = p_bu;',
  '     and o.business_unit_id is not null;',
  PG
);

// Admin BU dicampur ke `outlet_admin_saya` -> "larik kosong" berarti dua hal
// sekaligus, dan admin BU mendadak punya batas outlet yang bukan haknya.
sabotase(
  'admin BU ikut masuk ke daftar outlet sendiri',
  MIG,
  "     and ms.role = 'outlet_admin'\n",
  "     and ms.role in ('outlet_admin', 'bu_admin')\n",
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE: TARIK & HAPUS');
// =====================================================================

sabotase(
  'admin outlet bisa menarik unggahan orang lain',
  MIG,
  `    if r.dibuat_by is distinct from v_uid then
      raise exception 'Impor ini diunggah orang lain. Minta Admin BU untuk menariknya.';
    end if;`,
  '',
  PG
);

sabotase(
  'penarikan menyeluruh (lintas outlet) ikut dibuka',
  MIG,
  `    if p_semua then
      raise exception 'Penarikan menyeluruh (termasuk dokumen dari impor lain) hanya bisa dilakukan Admin BU.';
    end if;`,
  '',
  PG
);

sabotase(
  'invoice outlet lain bisa dihapus satu-satu',
  MIG,
  `    if not v_bu_admin and (v_outlet is null or not (v_outlet = any(v_saya))) then
      raise exception 'Invoice ini bukan milik outlet yang kamu pegang.';
    end if;`,
  '',
  PG
);

sabotase(
  'PO outlet lain bisa dihapus satu-satu',
  MIG,
  `    if not v_bu_admin and exists (
      select 1 from bengkel_purchase_lines
       where business_unit_id = p_bu and upper(btrim(po_no)) = upper(v_no)
         and (outlet_id is null or not (outlet_id = any(v_saya)))
    ) then
      raise exception 'PO ini memuat baris di luar outlet yang kamu pegang. Minta Admin BU.';
    end if;`,
  '',
  PG
);

// =====================================================================
console.log('\nSABOTASE: LAYAR');
// =====================================================================

// Laporan impor yang tidak menyebut baris yang dilewati adalah bentuk
// kegagalan yang paling lama bertahan di modul ini: orangnya menyangka
// seluruh berkasnya masuk.
sabotase(
  'layar tidak menyebut baris yang dilewati karena outlet lain (penjualan)',
  PAGE,
  'h.dilewati_outlet_lain?.length',
  'false',
  AUDIT
);

sabotase(
  'layar tidak menyebut baris yang dilewati karena outlet lain (pembelian)',
  PAGE,
  '      if (Number(h.dilewati_outlet_lain)) {',
  '      if (false) {',
  AUDIT
);

// Dropdown yang menawarkan outlet yang pasti ditolak server membuat orangnya
// mencoba lalu membaca galat — padahal daftarnya yang salah.
sabotase(
  'dropdown pemetaan menawarkan outlet yang bukan wewenangnya',
  PAGE,
  '    if (!adminBu && punyaku.size) outletKewenanganku = outlets.filter((o) => punyaku.has(o.id));',
  '    if (false) outletKewenanganku = outlets;',
  AUDIT
);

sabotase(
  'daftar pemetaan store tidak menyaring jenis',
  SVC,
  "    .eq('jenis', 'store')",
  '',
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS — pemeriksanya belum cukup.`);
process.exit(gagal === 0 ? 0 : 1);
