/**
 * SABOTASE: revisi SJ yang sudah diterima (0165).
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Fitur ini mengubah STOK DUA OUTLET lewat satu tombol. Seluruh cara ia rusak
 * menghasilkan angka yang terlihat masuk akal di layar sementara stok diam-diam
 * melenceng — tidak ada galat, dan yang membacanya baru tahu saat opname
 * berikutnya, saat sebabnya sudah tidak bisa ditelusuri.
 *
 * Yang diuji di sini bukan kodenya, melainkan apakah PEMERIKSANYA masih
 * benar-benar menjaga sesuatu.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0165_revisi_kiriman_diterima.sql';
const MOD = 'js/modules/dispatch/revisi-kiriman.js';
const SVC = 'js/modules/dispatch/dispatch.service.js';
const DLG = 'js/modules/dispatch/dialog-revisi-kiriman.js';
const PAGE = 'js/modules/dispatch/dispatch.page.js';

const BERKAS = [MIG, MOD, SVC, DLG, PAGE];
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

const AUDIT = 'tools/audit-revisi-kiriman.cjs';
const PG = 'tools/test-migrasi-0165.mjs';
const MURNI = 'tools/test-revisi-kiriman.mjs';

// =====================================================================
console.log('SABOTASE STOK — yang paling mahal:');
// =====================================================================

// ============ DUA PEMERIKSA UNTUK SABOTASE YANG SAMA ============
//
// Auditnya membaca SQL-nya; tes PGlite MENJALANKANNYA lalu menghitung saldo
// stok. Kalau cuma auditnya yang merah, tesnya tidak pernah benar-benar
// membuktikan saldonya cocok.
sabotase(
  'koreksi jumlah diterima ikut memotong stok CK — stok CK berkurang DUA KALI',
  MIG,
  `      insert into stock_movements(business_unit_id, outlet_id, product_id, movement_type, qty_delta, ref_outlet_id, dispatch_id, notes, created_by)
      values (v_d.business_unit_id, v_d.to_outlet_id, v_pid, 'transfer_in', v_delta, v_d.from_outlet_id, p_dispatch,`,
  `      insert into stock_movements(business_unit_id, outlet_id, product_id, movement_type, qty_delta, ref_outlet_id, dispatch_id, notes, created_by)
      values (v_d.business_unit_id, v_d.from_outlet_id, v_pid, 'transfer_out', v_delta, v_d.to_outlet_id, p_dispatch,`,
  AUDIT
);
sabotase(
  'koreksi jumlah diterima ikut memotong stok CK — DAN saldo di tes PGlite harus merah',
  MIG,
  `values (v_d.business_unit_id, v_d.to_outlet_id, v_pid, 'transfer_in', v_delta, v_d.from_outlet_id, p_dispatch,`,
  `values (v_d.business_unit_id, v_d.from_outlet_id, v_pid, 'transfer_out', v_delta, v_d.to_outlet_id, p_dispatch,`,
  PG
);

sabotase(
  'barang baru tidak memotong stok CK — barang keluar tanpa tercatat',
  MIG,
  `      if v_sent > 0 then
        insert into stock_movements(business_unit_id, outlet_id, product_id, movement_type, qty_delta, ref_outlet_id, dispatch_id, notes, created_by)
        values (v_d.business_unit_id, v_d.from_outlet_id, v_pid, 'transfer_out', -v_sent, v_d.to_outlet_id, p_dispatch,`,
  `      if false then
        insert into stock_movements(business_unit_id, outlet_id, product_id, movement_type, qty_delta, ref_outlet_id, dispatch_id, notes, created_by)
        values (v_d.business_unit_id, v_d.from_outlet_id, v_pid, 'transfer_out', -v_sent, v_d.to_outlet_id, p_dispatch,`,
  PG
);

sabotase(
  'koreksi stok outlet dicabut — angkanya berubah, stoknya tidak',
  MIG,
  `      insert into stock_movements(business_unit_id, outlet_id, product_id, movement_type, qty_delta, ref_outlet_id, dispatch_id, notes, created_by)
      values (v_d.business_unit_id, v_d.to_outlet_id, v_pid, 'transfer_in', v_delta, v_d.from_outlet_id, p_dispatch,
              'Revisi ' || coalesce(v_d.code, '') || ': jumlah diterima dibetulkan — ' || v_alasan, v_uid);`,
  '      /* dibuang */',
  PG
);

sabotase(
  'gerakan lama DITIMPA, bukan dikoreksi — laporan periode lampau berubah sendiri',
  MIG,
  '      insert into stock_movements(business_unit_id, outlet_id, product_id, movement_type, qty_delta, ref_outlet_id, dispatch_id, notes, created_by)\n      values (v_d.business_unit_id, v_d.to_outlet_id, v_pid, \'transfer_in\', v_delta,',
  "      update stock_movements set qty_delta = v_recv where dispatch_id = p_dispatch and product_id = v_pid and movement_type = 'transfer_in';\n      insert into stock_movements(business_unit_id, outlet_id, product_id, movement_type, qty_delta, ref_outlet_id, dispatch_id, notes, created_by)\n      values (v_d.business_unit_id, v_d.to_outlet_id, v_pid, 'transfer_in', v_delta,",
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE PENJAGA:');
// =====================================================================

sabotase(
  "penjaga status 'received' dicabut — SJ yang belum dikirim ikut menggerakkan stok",
  MIG,
  "  if v_d.status <> 'received' then\n    raise exception 'Kiriman % sudah dibatalkan, tidak ada yang bisa direvisi.', coalesce(v_d.code, '');\n  end if;",
  '  /* dibuang */',
  PG
);

sabotase(
  'pemeriksaan wewenang dicabut — outlet yang tidak terlibat bisa mengubah stok orang lain',
  MIG,
  '  if not boleh_revisi_kiriman(p_dispatch) then',
  '  if false then',
  PG
);

sabotase(
  'alasan revisi tidak lagi wajib — perubahan stok tanpa sebab yang tercatat',
  MIG,
  "  if v_alasan = '' then",
  '  if false then',
  PG
);

sabotase(
  'barang baru tidak lagi mensyaratkan jumlah kirim — susut tersamarkan jadi nol',
  MIG,
  '      if v_sent is null or v_sent < 0 then',
  '      if false then',
  PG
);

sabotase(
  'CK dicabut dari daftar yang boleh merevisi — yang salah tulis tidak bisa membetulkan sendiri',
  MIG,
  '      and (has_outlet_scope(auth.uid(), d.from_outlet_id) or has_outlet_scope(auth.uid(), d.to_outlet_id))',
  '      and has_outlet_scope(auth.uid(), d.to_outlet_id)',
  PG
);

// =====================================================================
console.log('\nSABOTASE JEJAK & ESB:');
// =====================================================================

sabotase(
  'nama pelaku tidak lagi disimpan — jejak staff yang keluar jadi anonim',
  MIG,
  "  v_nama_pelaku text := coalesce((select full_name from user_profiles where id = auth.uid()), 'pengguna');",
  "  v_nama_pelaku text := null;",
  PG
);

sabotase(
  'jejak revisi DITIMPA, bukan ditambah — "siapa yang mengubahnya pertama kali" hilang',
  MIG,
  "             revisi = revisi || jsonb_build_object(",
  "             revisi = jsonb_build_array(",
  PG
);

sabotase(
  'nama pelaku dicabut dari header SJ — penunjuknya menguap saat barisnya dihapus',
  MIG,
  '  update dispatches set direvisi_at = now(), direvisi_by = v_uid, direvisi_by_nama = v_nama_pelaku where id = p_dispatch;',
  '  update dispatches set direvisi_at = now(), direvisi_by = v_uid where id = p_dispatch;',
  PG
);

sabotase(
  'tanda ekspor ESB dibiarkan — berkas yang sudah dikirim memuat angka lama',
  MIG,
  '  if v_d.esb_exported_at is not null then\n    update dispatches\n       set esb_exported_at = null,',
  '  if false then\n    update dispatches\n       set esb_exported_at = null,',
  PG
);

// =====================================================================
console.log('\nSABOTASE MODUL MURNI:');
// =====================================================================

sabotase(
  'baris yang tidak berubah ikut dikirim — gerakan stok bernilai nol memenuhi riwayat',
  MOD,
  '    if (Number(asli.received_qty ?? 0) === terima) continue;',
  '    /* dibuang */',
  MURNI
);

sabotase(
  'baris lama ikut membawa `sent_qty` — stok CK bergerak pada revisi yang seharusnya tidak',
  MOD,
  '    muatan.push({ product_id: pid, received_qty: terima });',
  '    muatan.push({ product_id: pid, received_qty: terima, sent_qty: asli.sent_qty });',
  MURNI
);

sabotase(
  'perubahan jumlah diterima dihitung menyentuh stok asal — layar mengumumkan pemotongan yang tidak terjadi',
  MOD,
  '    if (delta !== 0) keOutlet.push({ product_id: m.product_id, delta, jenis: JENIS.UBAH });',
  '    if (delta !== 0) { keOutlet.push({ product_id: m.product_id, delta, jenis: JENIS.UBAH }); keAsal.push({ product_id: m.product_id, delta, jenis: JENIS.UBAH }); }',
  MURNI
);

sabotase(
  'barang baru tidak lagi dihitung memotong stok asal',
  MOD,
  '      if (Number(m.sent_qty) > 0) keAsal.push({ product_id: m.product_id, delta: -Number(m.sent_qty), jenis: JENIS.TAMBAH });',
  '      /* dibuang */',
  MURNI
);

sabotase(
  'barang baru tidak lagi mensyaratkan jumlah kirim di layar',
  MOD,
  "        masalah.push({ product_id: pid, pesan: 'Barang baru harus disertai jumlah KIRIM-nya.' });\n        continue;",
  '        muatan.push({ product_id: pid, received_qty: terima, sent_qty: terima });\n        continue;',
  MURNI
);

sabotase(
  '`by_nama` tidak lagi diutamakan — riwayat staff yang keluar jadi anonim',
  MOD,
  '      oleh: teks(r?.by_nama) || peta.get(teks(r?.by)) || (teks(r?.by) ? \'pengguna tak dikenal\' : \'—\'),',
  "      oleh: peta.get(teks(r?.by)) || (teks(r?.by) ? 'pengguna tak dikenal' : '—'),",
  MURNI
);

sabotase(
  'pelaku yang tidak ketemu dibiarkan kosong — jejak tanpa pelaku sama saja tidak ada',
  MOD,
  "      oleh: teks(r?.by_nama) || peta.get(teks(r?.by)) || (teks(r?.by) ? 'pengguna tak dikenal' : '—'),",
  '      oleh: teks(r?.by_nama) || peta.get(teks(r?.by)) || \'\',',
  MURNI
);

sabotase(
  'penolakan draft tidak lagi menunjuk tab Draft Surat Jalan',
  MOD,
  "  if (status === 'draft') return 'Masih draft — ubah langsung di tab Draft Surat Jalan.';",
  "  if (status === 'draft') return 'Tidak bisa direvisi.';",
  MURNI
);

sabotase(
  'penolakan wewenang tidak lagi menyebut sebabnya',
  MOD,
  "    return 'Kamu bukan pengirim maupun outlet tujuannya.';",
  "    return 'Tidak bisa.';",
  MURNI
);

sabotase(
  'jumlah diterima minus diterima begitu saja',
  MOD,
  "      masalah.push({ product_id: pid, pesan: 'Jumlah diterima tidak boleh minus.' });\n      continue;",
  '      /* dibiarkan */',
  MURNI
);

// =====================================================================
console.log('\nSABOTASE LAYANAN & LAYAR:');
// =====================================================================

sabotase(
  'kolom `revisi` tidak lagi diambil — dialog menampilkan riwayat yang tertinggal',
  SVC,
  "        'revisi, ' +",
  '',
  AUDIT
);

sabotase(
  'revisi tidak lagi lewat RPC',
  SVC,
  "  const { data, error } = await supabase.rpc('revisi_kiriman_diterima', {",
  "  const { data, error } = await supabase.from('dispatch_items').update({}).match({",
  AUDIT
);

sabotase(
  'dialog tidak lagi menolak lebih dulu — orangnya mengisi dialog lalu ditolak server',
  DLG,
  '  const tolak = alasanTakBisaRevisi(sj, outletSaya);',
  '  const tolak = null;',
  AUDIT
);

// Tombolnya ada DI DUA CABANG sejak layar dipisah per pihak. Sabotase yang
// mencabut salah satunya sempat LOLOS karena auditnya cuma mencari kelasnya
// se-berkas — ia menemukan milik cabang yang lain. Sekarang tiap cabang
// diperiksa sendiri, dan dua sabotase di bawah menguji keduanya.
sabotase(
  'tombol Revisi dicabut dari cabang CK — CK tidak bisa membetulkan jumlah kirimnya sendiri',
  PAGE,
  '`<button class="btn-revisi-kiriman" data-id="${d.id}">Revisi</button>`',
  "''",
  AUDIT
);

sabotase(
  'tombol Revisi dicabut dari cabang outlet tujuan — yang mengetik angkanya kehilangan tombolnya',
  PAGE,
  '`<button class="btn-revisi-kiriman" data-id="${d.id}">Revisi</button>\n                           <button class="btn-teruskan-kiriman"',
  '`<button class="btn-teruskan-kiriman"',
  AUDIT
);

sabotase(
  'tombol Revisi tidak terhubung — diklik, lalu tidak terjadi apa-apa',
  PAGE,
  "hasil.querySelectorAll('.btn-revisi-kiriman')",
  "hasil.querySelectorAll('.btn-revisi-kiriman-x')",
  AUDIT
);

sabotase(
  'Teruskan ikut muncul di cabang CK — meneruskan barang yang tidak dipegangnya',
  PAGE,
  "                          ? `<button class=\"btn-revisi-kiriman\" data-id=\"${d.id}\">Revisi</button>`",
  "                          ? `<button class=\"btn-revisi-kiriman\" data-id=\"${d.id}\">Revisi</button><button class=\"btn-teruskan-kiriman\" data-id=\"${d.id}\">Teruskan</button>`",
  AUDIT
);

sabotase(
  'cabang CK dicabut — CK tidak bisa membetulkan jumlah kirimnya sendiri',
  PAGE,
  "                        : d.status === 'received' && d.from_outlet_id === state.outletId",
  "                        : false",
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS / tidak terpasang.`);
process.exit(gagal === 0 ? 0 : 1);
