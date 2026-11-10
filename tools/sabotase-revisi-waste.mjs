/**
 * SABOTASE: revisi & pembatalan waste/spoil (0181).
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Yang dijaga di sini adalah KESESUAIAN antara dua angka yang tidak pernah
 * tampil bersebelahan: jumlah di laporan waste, dan stok yang benar-benar
 * terpotong. Begitu keduanya berpisah, tidak ada satu pun layar yang
 * menunjukkannya — laporannya rapi, stoknya rapi, dan keduanya salah.
 *
 * Dua bentuk yang paling mudah terjadi dan paling sulit dilihat: revisi yang
 * mengubah angka tanpa menyentuh stok, dan pemulihan yang memasang potongan
 * baru di atas yang lama sehingga stok terpotong dua kali.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0181_revisi_waste.sql';
const MURNI = 'js/modules/inventory/aturan-revisi-waste.js';
const SVC = 'js/modules/inventory/waste.service.js';
const PAGE = 'js/modules/inventory/waste.admin.js';
const ESB = 'js/modules/inventory/esb.service.js';

const BERKAS = [MIG, MURNI, SVC, PAGE, ESB];
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

// ============ PEMERIKSANYA HARUS HIJAU DULU ============
//
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

const AUDIT = 'tools/audit-revisi-waste.cjs';
const PG = 'tools/test-migrasi-0181.mjs';
const TES = 'tools/test-aturan-revisi-waste.mjs';

for (const p of [AUDIT, PG, TES]) pastikanHijau(p);

// =====================================================================
console.log('SABOTASE: ANGKANYA BERUBAH, STOKNYA TIDAK');
// =====================================================================

sabotase(
  'revisi tidak memasang ulang potongan stoknya',
  MIG,
  '  perform bongkar_waste(w.id);\n  v_n := pasang_waste(w.id);\n\n  return jsonb_build_object(\n    \'kode\', w.code,',
  '  perform bongkar_waste(w.id);\n  v_n := 0;\n\n  return jsonb_build_object(\n    \'kode\', w.code,',
  PG
);

// Dipasang tanpa dibongkar: rincian & potongan lama tetap ada, yang baru
// ditambahkan di atasnya. Stok terpotong DUA KALI, dan tidak ada yang merah.
sabotase(
  'revisi memasang tanpa membongkar lebih dulu',
  MIG,
  "  -- Dibongkar SESUDAH barisnya diperbarui, lalu dipasang dari keadaan baru.\n  -- Urutannya penting: `pasang_waste` membaca barisnya, bukan argumen.\n  perform bongkar_waste(w.id);",
  '',
  PG
);

sabotase(
  'bongkar lupa menghapus rinciannya',
  MIG,
  '  delete from waste_items where waste_id = p_waste;',
  '  null;',
  PG
);

// ============ PEMULIHAN YANG MEMOTONG DUA KALI ============
sabotase(
  'pemulihan memasang di atas rincian lama',
  MIG,
  '  perform bongkar_waste(w.id);\n  v_n := pasang_waste(w.id);\n\n  insert into waste_revisi',
  '  v_n := pasang_waste(w.id);\n\n  insert into waste_revisi',
  PG
);

// =====================================================================
console.log('\nSABOTASE: WEWENANG & ALASAN');
// =====================================================================

// `has_outlet_scope` juga true untuk STAFF outlet itu — yaitu orang yang salah
// inputnya sedang dibetulkan.
sabotase(
  'wewenang revisi diperiksa dengan penjaga yang terlalu longgar',
  MIG,
  "  if not is_admin_of_outlet(v_uid, w.outlet_id) then\n    raise exception 'Hanya admin BU atau admin outlet ini yang bisa merevisi waste.';",
  "  if not has_outlet_scope(v_uid, w.outlet_id) then\n    raise exception 'Hanya admin BU atau admin outlet ini yang bisa merevisi waste.';",
  PG
);

sabotase(
  'alasan revisi tidak lagi wajib',
  MIG,
  "  if v_alasan is null then raise exception 'Alasan revisi wajib diisi.'; end if;",
  '',
  PG
);

sabotase(
  'produk milik BU lain diterima',
  MIG,
  "  if not exists (select 1 from products where id = p_product and business_unit_id = w.business_unit_id) then\n    raise exception 'Produk itu bukan milik BU ini.';\n  end if;",
  '',
  PG
);

sabotase(
  'kejadian yang sudah dibatalkan tetap bisa direvisi',
  MIG,
  "  if w.dibatalkan_at is not null then\n    raise exception 'Kejadian ini sudah dibatalkan. Pulihkan dulu kalau memang mau direvisi.';\n  end if;",
  '',
  PG
);

// =====================================================================
console.log('\nSABOTASE: JEJAKNYA');
// =====================================================================

// "Dibatalkan tapi berjejak" kehilangan jejaknya: tidak ada lagi catatan
// bahan apa saja yang dulu ikut terpotong.
sabotase(
  'pembatalan ikut menghapus rincian bahannya',
  MIG,
  '  -- Hanya potongan stoknya yang dibongkar; rinciannya ditinggalkan.\n  delete from stock_movements where waste_run_id = w.id;',
  '  perform bongkar_waste(w.id);',
  AUDIT
);

sabotase(
  'angka lamanya tidak disimpan sebelum ditimpa',
  MIG,
  '  insert into waste_revisi (waste_id, revisi_ke, product_lama, qty_lama, notes_lama,\n                            product_baru, qty_baru, notes_baru, alasan, esb_terkunci, oleh, oleh_nama)\n  values (w.id, w.revisi_ke + 1, w.product_id, w.qty, w.notes,',
  '  insert into waste_revisi (waste_id, revisi_ke, product_lama, qty_lama, notes_lama,\n                            product_baru, qty_baru, notes_baru, alasan, esb_terkunci, oleh, oleh_nama)\n  values (w.id, w.revisi_ke + 1, p_product, p_qty, v_notes,',
  PG
);

// Stoknya sudah dikembalikan tapi laporannya tetap menghitungnya — selisih
// yang tidak akan dicurigai siapa pun.
sabotase(
  'rekap tetap memuat yang dibatalkan',
  MIG,
  '   where w.dibatalkan_at is null\n',
  '\n',
  PG
);

// =====================================================================
console.log('\nSABOTASE: `catat_waste` YANG DITULIS ULANG');
// =====================================================================

sabotase(
  'foto tidak lagi wajib saat mencatat',
  MIG,
  "  if v_foto is null then\n    raise exception 'Foto wajib diisi. Ambil foto bahan yang rusak atau menu yang terbuang dulu, baru simpan.';\n  end if;",
  '',
  PG
);

sabotase(
  'pemeriksaan wewenang outlet hilang saat fungsinya disalin',
  MIG,
  "  if not has_outlet_scope(v_uid, p_outlet) then\n    raise exception 'Kamu tidak berhak mencatat waste di outlet ini.';\n  end if;",
  '',
  PG
);

// =====================================================================
console.log('\nSABOTASE: ATURAN DI LAYAR');
// =====================================================================

sabotase(
  'yang sudah diekspor ke ESB ditolak diam-diam',
  MURNI,
  '  if (meta?.dibatalkan) return { boleh: false, sebab: SEBAB.DIBATALKAN, peringatan: \'\' };',
  '  if (meta?.dibatalkan || meta?.terkunci) return { boleh: false, sebab: SEBAB.DIBATALKAN, peringatan: \'\' };',
  TES
);

sabotase(
  'wewenang berpangkal "boleh"',
  MURNI,
  'export function keadaanRevisiWaste(meta, { bolehKelola = false } = {}) {',
  'export function keadaanRevisiWaste(meta, { bolehKelola = true } = {}) {',
  TES
);

// Tombol di tiap baris: admin mengira sedang merevisi "baris gula" padahal
// yang direvisi seluruh kejadiannya.
sabotase(
  'tiap baris bahan memegang tombolnya sendiri',
  MURNI,
  '    if (sudah.has(id)) return;',
  '',
  TES
);

sabotase(
  'baris lama ikut ditawari tombol',
  MURNI,
  '    if (!id || m?.lama) return;',
  '    if (!id) return;',
  TES
);

sabotase(
  'revisi yang tidak mengubah apa pun tetap dikirim',
  PAGE,
  "    if (!perubahan.length) return toast('Tidak ada yang berubah.', 'warning');",
  '',
  AUDIT
);

sabotase(
  'admin outlet kehilangan tombol yang database-nya izinkan',
  PAGE,
  '  const scopeAdmin = await scopeAdminSaya(businessUnitId).catch(() => ({ adminBu: false, outlets: new Set() }));',
  '  const scopeAdmin = { adminBu: bolehUbahPurpose, outlets: new Set() };',
  AUDIT
);

sabotase(
  'kolom Aksi kehilangan data-label',
  PAGE,
  '<td data-label="Aksi">${selAksi(lap.meta[i], i)}</td>',
  '<td>${selAksi(lap.meta[i], i)}</td>',
  AUDIT
);

sabotase(
  'yang dibatalkan ikut diekspor ke ESB',
  ESB,
  '    runs = (await ambilRuns(`${DASAR}, dibatalkan_at`)).filter((w) => !w.dibatalkan_at);',
  '    runs = await ambilRuns(`${DASAR}, dibatalkan_at`);',
  AUDIT
);

sabotase(
  'saringan ESB tanpa jalan mundur kalau 0181 belum dijalankan',
  ESB,
  "    if (!/dibatalkan_at/.test(String(e?.message ?? ''))) throw e;\n    runs = await ambilRuns(DASAR);",
  '    throw e;',
  AUDIT
);

sabotase(
  'yang dibatalkan tidak pernah ditampilkan',
  SVC,
  'export async function daftarWasteDibatalkan(',
  'export async function daftarWasteDibatalkanX(',
  AUDIT
);

// ---------------------------------------------------------------
console.log('');
if (gagal === 0) console.log('Semua sabotase revisi waste tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS / tidak terpasang.`);
process.exit(gagal === 0 ? 0 : 1);
