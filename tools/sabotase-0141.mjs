/**
 * SABOTASE: koreksi kas + akses admin BU (0141).
 *
 * Yang dijaga bukan "tombolnya ada", melainkan bahwa SALDO tidak pernah diam-
 * diam berbeda antar layar, jejak koreksinya tidak pernah hilang, dan izinnya
 * tidak pernah menutup kasus yang justru sedang dibuka.
 *
 * ============ JEBAKAN YANG SUDAH MENGGIGIT LIMA KALI ============
 *
 * `String.replace` dengan STRING hanya mengganti kemunculan PERTAMA. Pola yang
 * muncul lebih dari sekali harus memakai regex `/…/g`. `dicoret_at is null`
 * di 0141 adalah kasus terbesarnya: ia muncul di LIMA tempat, dan mematikan
 * satu saja tidak membuktikan bahwa empat lainnya dijaga.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0141_koreksi_kas_dan_akses_admin_bu.sql';
const MURNI = 'js/modules/cash/koreksi-kas.js';
const SVC = 'js/modules/cash/cash.service.js';
const TABS = 'js/core/admin-tabs.js';
const MAIN = 'js/main-admin.js';
const PAGE = 'js/modules/cash/cash.page.js';
const ADMIN = 'js/modules/cash/cash.admin.page.js';

const asli = new Map();
for (const rel of [MIG, MURNI, SVC, TABS, MAIN, PAGE, ADMIN]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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

const TES_MIG = 'tools/test-migrasi-0141.mjs';
const TES = 'tools/test-koreksi-kas.mjs';
const AUDIT = 'tools/audit-koreksi-kas.cjs';

console.log('SABOTASE IZIN KOREKSI:');

// SABOTASE INI SEMPAT SALAH SASARAN, dan itu layak dicatat.
//
// Versi pertamanya menambahkan `has_outlet_scope(auth.uid(), ms.outlet_id)` ke
// dalam `boleh_koreksi_kas` dan LOLOS — ternyata `has_outlet_scope` (0001)
// sudah memperlakukan bu_admin sebagai bercakupan di SELURUH outlet BU-nya,
// jadi syarat itu tidak mengubah apa pun untuk kasus Seruni. Alasan yang saya
// tulis di komentar migrationnya waktu itu keliru.
//
// Yang BENAR-BENAR berbahaya adalah menyeret OUTLET ENTRINYA ke dalam aturan
// izin — kesalahan yang jauh lebih mudah dilakukan orang ("sekalian pastikan ia
// admin outletnya"). Kas MASUK tidak punya outlet peruntukan (0063), jadi
// `is_admin_of_outlet(x, NULL)` selalu false dan SELURUH baris kas masuk
// berhenti bisa dikoreksi siapa pun — termasuk pemegangnya sendiri.
sabotase(
  'izin koreksi menyeret outlet ENTRINYA — seluruh kas masuk berhenti bisa dikoreksi',
  MIG,
  '  if not boleh_koreksi_kas(v.holder_id) then',
  '  if not (boleh_koreksi_kas(v.holder_id) and is_admin_of_outlet(auth.uid(), v.outlet_id)) then',
  TES_MIG
);
sabotase(
  'izin koreksi dibuka untuk siapa saja',
  MIG,
  '    is_super_admin(auth.uid())\n    -- Pemegangnya sendiri',
  '    true\n    -- Pemegangnya sendiri',
  TES_MIG
);
sabotase(
  'pemegangnya sendiri berhenti boleh mengoreksi kasnya',
  MIG,
  '    or p_holder = auth.uid()',
  '    or false',
  TES_MIG
);
sabotase(
  'RPC ubah berhenti memeriksa sebab penolakan — penjaganya cuma tinggal di layar',
  MIG,
  "  v_tolak := alasan_tolak_koreksi_kas(p_entry);\n  if v_tolak is not null then raise exception '%', v_tolak; end if;\n\n  if p_amount is null",
  "  if p_amount is null",
  TES_MIG
);

console.log('\nSABOTASE YANG TIDAK BOLEH DIKOREKSI:');

sabotase(
  'entri pembayaran nota boleh diubah — nota tetap LUNAS dengan angka yang tidak cocok',
  MIG,
  '  select string_agg(code, \', \' order by code) into v_kode\n    from goods_receipts where payment_entry_id = p_entry;',
  '  v_kode := null;',
  TES_MIG
);
sabotase(
  'penolakan pembayaran nota berhenti menunjuk jalan keluarnya',
  MIG,
  "           'Pakai modul Bahan -> Nota Terima -> Batalkan Pembayaran; stok dan status notanya ikut dibereskan di sana.'",
  "           'Tidak bisa.'",
  AUDIT
);
sabotase(
  'transfer & pindah antar kantong boleh dikoreksi sepotong — uang muncul/lenyap di antara pasangannya',
  MIG,
  "  if v.entry_type not in ('in', 'out') then",
  '  if false then',
  TES_MIG
);
sabotase(
  'entri penyesuaian nota (0131) boleh dikoreksi tangan',
  MIG,
  '  if v.penyesuaian_nota is not null then',
  '  if false then',
  TES_MIG
);
sabotase(
  'entri yang sudah dicoret bisa dicoret & diubah lagi',
  MIG,
  '  if v.dicoret_at is not null then',
  '  if false then',
  TES_MIG
);
sabotase(
  'alasan penghapusan berhenti wajib — coretan tak bisa dibedakan dari kesalahan sistem',
  MIG,
  "  if coalesce(btrim(p_alasan), '') = '' then\n    raise exception 'Sebutkan alasan penghapusannya — walau sesingkat \"salah input\".';\n  end if;",
  '  null;',
  TES_MIG
);

console.log('\nSABOTASE SALDO YANG MENGABAIKAN CORETAN:');

// `/…/g`: `dicoret_at is null` muncul di LIMA tempat. Mematikan satu saja tidak
// membuktikan empat lainnya dijaga — dan yang terlewat tidak melempar error,
// ia cuma menjawab angka yang berbeda dari tetangganya.
sabotase(
  'SELURUH penyaring coretan dimatikan sekaligus',
  MIG,
  /dicoret_at is null/g,
  'true',
  TES_MIG
);
sabotase(
  'view cash_balances berhenti menyaring — saldo utama ikut menghitung yang dihapus',
  MIG,
  '  from cash_entries\n  where dicoret_at is null\n  group by holder_id;',
  '  from cash_entries\n  group by holder_id;',
  TES_MIG
);
sabotase(
  'saldo per kantong berhenti menyaring',
  MIG,
  '  left join cash_accounts ca on ca.id = ce.account_id\n  where ce.dicoret_at is null\n  group by ce.holder_id',
  '  left join cash_accounts ca on ca.id = ce.account_id\n  group by ce.holder_id',
  TES_MIG
);
sabotase(
  'laporan Kas per Pemegang ikut menghitung yang dihapus',
  MIG,
  '  where ce.entry_date between p_from and p_to\n    and ce.dicoret_at is null\n    and (p_user is null or ce.holder_id = p_user)\n    and (p_outlet is null or ce.outlet_id = p_outlet)\n    and (p_category is null or ce.category_id = p_category)\n    and boleh_lihat_kas',
  '  where ce.entry_date between p_from and p_to\n    and (p_user is null or ce.holder_id = p_user)\n    and (p_outlet is null or ce.outlet_id = p_outlet)\n    and (p_category is null or ce.category_id = p_category)\n    and boleh_lihat_kas',
  TES_MIG
);
sabotase(
  'Rincian Mutasi Kas ikut menghitung yang dihapus',
  MIG,
  '      and ce.dicoret_at is null\n      and (p_user is null or ce.holder_id = p_user)',
  '      and (p_user is null or ce.holder_id = p_user)',
  TES_MIG
);
sabotase(
  'daftar kantong kas admin ikut menghitung yang dihapus',
  MIG,
  '    select ce.holder_id, ce.account_id, sum(ce.amount) as balance\n      from cash_entries ce\n     where ce.dicoret_at is null',
  '    select ce.holder_id, ce.account_id, sum(ce.amount) as balance\n      from cash_entries ce\n     where true',
  AUDIT
);

console.log('\nSABOTASE JEJAK & KOLOM OUTLET:');

sabotase(
  'coret jadi HAPUS PERMANEN — jejak "dihapus oleh siapa" mustahil disimpan',
  MIG,
  "  update cash_entries\n     set dicoret_at = now(),\n         dicoret_by = v_uid,\n         alasan_coret = btrim(p_alasan)\n   where id = p_entry;",
  '  delete from cash_entries where id = p_entry;',
  AUDIT
);
sabotase(
  'siapa yang menghapus berhenti dicatat',
  MIG,
  '         dicoret_by = v_uid,',
  '         dicoret_by = null,',
  TES_MIG
);
sabotase(
  'siapa yang mengubah berhenti dicatat',
  MIG,
  '         diubah_by = v_uid',
  '         diubah_by = null',
  TES_MIG
);
sabotase(
  'tanda nominal mengikuti apa yang dikirim layar — kas keluar bisa MENAMBAH saldo',
  MIG,
  "     set amount = case when v_type = 'out' then -abs(p_amount) else abs(p_amount) end,",
  '     set amount = p_amount,',
  TES_MIG
);
sabotase(
  'riwayat kas jadi security invoker — kolom Outlet kembali kosong',
  MIG,
  // Polanya menyertakan BARIS PERTAMA BADAN fungsinya (`select` + `ce.id`)
  // supaya yang tersasar pasti `riwayat_kas_saya`: `security definer` muncul di
  // belasan tempat di berkas ini, dan `String.replace` hanya mengganti yang
  // pertama — yang kebetulan milik fungsi lain.
  'security definer\nstable\nset search_path = public\nas $$\n  select\n    ce.id,',
  'security invoker\nstable\nset search_path = public\nas $$\n  select\n    ce.id,',
  AUDIT
);
sabotase(
  'riwayat kas tidak lagi dibatasi ke pemanggilnya — fungsi definer yang membuka kas semua orang',
  MIG,
  '  where ce.holder_id = auth.uid()',
  '  where true',
  TES_MIG
);
sabotase(
  'entri yang dicoret ikut disaring keluar dari riwayat — jejaknya tak bisa dilihat siapa pun',
  MIG,
  '  where ce.holder_id = auth.uid()\n  order by ce.created_at desc',
  '  where ce.holder_id = auth.uid() and ce.dicoret_at is null\n  order by ce.created_at desc',
  AUDIT
);
sabotase(
  'kebijakan baca admin BU dicabut — admin BU tidak melihat satu baris pun',
  MIG,
  'create policy cash_entries_select_bu_admin on cash_entries',
  'create policy cash_entries_select_bu_admin_nonaktif on cash_entries',
  AUDIT
);

console.log('\nSABOTASE MODUL MURNI:');

sabotase(
  'entri yang dicoret ikut menghitung total layar — beda dari saldo di kartu atasnya',
  MURNI,
  "  if (e?.dicoret_at) return 0;",
  '  if (false) return 0;',
  TES
);
sabotase(
  'tombol dimatikan kalau `alasan_tolak` tidak terbaca — semua orang kehilangan Ubah/Hapus',
  MURNI,
  '    bolehKoreksi: !dicoret && !alasanTolak,',
  '    bolehKoreksi: !dicoret && alasanTolak === null && e?.alasan_tolak !== undefined,',
  TES
);
sabotase(
  'sebab penolakan dibuang — tombol mati tanpa keterangan apa pun',
  MURNI,
  '    alasanTolak,',
  "    alasanTolak: '',",
  TES
);
sabotase(
  'jejak "dihapus oleh" berhenti menyebut namanya',
  MURNI,
  '    const oleh = teks(e.dicoret_oleh);\n    const alasan = teks(e.alasan_coret);',
  "    const oleh = '';\n    const alasan = teks(e.alasan_coret);",
  TES
);
sabotase(
  'jejak "diubah oleh" dibuang saat entrinya juga dicoret',
  MURNI,
  '  if (e?.diubah_at) {',
  '  if (e?.diubah_at && !e?.dicoret_at) {',
  TES
);
sabotase(
  'berapa yang dicoret berhenti dilaporkan',
  MURNI,
  '      dicoret++;\n      continue;',
  '      continue;',
  TES
);
sabotase(
  'nominal non-finite lolos — "Rp∞" di layar keuangan',
  MURNI,
  '  return Number.isFinite(n) ? n : 0;',
  '  return n;',
  TES
);

console.log('\nSABOTASE LAYANAN & MENU:');

sabotase(
  'riwayat kas kembali lewat embed tabel — kolom Outlet kosong lagi',
  SVC,
  "  const { data, error } = await supabase.rpc('riwayat_kas_saya', { p_limit: limit });",
  '  const { data, error } = await supabase.from(\'cash_entries\').select(\'*\');',
  AUDIT
);
sabotase(
  'kolom kategori tidak ikut diambil layar admin — menyunting keterangan MENGHAPUS kategorinya',
  SVC,
  // Daftar kolomnya tumbuh di 0149 (supplier, untuk_nota, esb_exported_at) —
  // pola lamanya sudah tidak menunjuk ke mana pun. Yang dijaga tetap sama:
  // `ubah_kas` menulis PENUH, jadi kolom yang tidak ikut diambil akan
  // TERHAPUS saat admin membetulkan keterangannya.
  "'category_id, outlet_id, qty, unit, supplier, untuk_nota, esb_exported_at, dicoret_at, alasan_coret, diubah_at, '",
  "'outlet_id, supplier, untuk_nota, esb_exported_at, dicoret_at, alasan_coret, diubah_at, '",
  AUDIT
);
sabotase(
  'nama penghapus tidak diratakan — jejaknya hilang di Admin Portal saja',
  SVC,
  "    dicoret_oleh: r.pencoret?.full_name ?? '',",
  "    dicoret_oleh: '',",
  AUDIT
);
sabotase(
  'Kas kembali super-admin-only — admin BU tidak akan pernah melihat menunya',
  TABS,
  "  { code: 'cash_ledger', label: 'Kas (semua pemegang)', group: 'Kas' },",
  "  { code: 'cash_ledger', label: 'Kas (semua pemegang)', group: 'Kas', superAdminOnly: true },",
  AUDIT
);
sabotase(
  'Kas dikembalikan ke grup User yang khusus super admin',
  TABS,
  "  { code: 'cash_ledger', label: 'Kas (semua pemegang)', group: 'Kas' },",
  "  { code: 'cash_ledger', label: 'Kas (semua pemegang)', group: 'User' },",
  AUDIT
);
sabotase(
  'Kas hilang dari menu admin sama sekali',
  MAIN,
  "  { code: 'cash_ledger', name: 'Kas' }\n];",
  '];',
  AUDIT
);

console.log('\nSABOTASE LAYAR:');

sabotase(
  'Staff App kembali membaca embed tabel',
  PAGE,
  '        riwayatKasSaya(),',
  '        Promise.resolve([]),',
  AUDIT
);
sabotase(
  'tombol yang tidak boleh ditekan disembunyikan, bukan dimatikan dengan sebabnya',
  PAGE,
  '      return `<button class="btn-kas-info" disabled title="${sebab}" aria-label="${sebab}">🔒</button>`;',
  "      return '';",
  AUDIT
);
sabotase(
  'alasan penghapusan tidak dikirim dari Staff App',
  PAGE,
  '      await coretKas(e.id, values.alasan);',
  "      await coretKas(e.id, 'dihapus');",
  AUDIT
);
sabotase(
  'total PDF kembali menghitung entri yang dicoret',
  PAGE,
  '      const { masuk, keluar, dicoret } = totalKas(entriTampil);',
  '      const masuk = 0, keluar = 0, dicoret = 0;',
  AUDIT
);
sabotase(
  'Admin Portal meniru sendiri aturan nomor nota',
  ADMIN,
  '  const { bagian, tambahan } = pecahKeterangan(ket, notas ?? []);',
  '  const bagian = [{ teks: String(ket ?? "") }], tambahan = [];',
  AUDIT
);
sabotase(
  'tautan nomor nota di Admin Portal tidak dipasangi penangan klik',
  ADMIN,
  "  result.querySelectorAll('.btn-nota').forEach((btn) =>",
  '  [].forEach((btn) =>',
  AUDIT
);
sabotase(
  'izin koreksi tidak diambil layar admin — tombolnya digambar menebak-nebak',
  ADMIN,
  '    alasanTolakKoreksiKas(rows.map((r) => r.id))',
  '    Promise.resolve(new Map())',
  AUDIT
);
sabotase(
  'ringkasan admin kembali menghitung entri yang dicoret',
  ADMIN,
  '  const { masuk, keluar, dicoret } = totalKas(rows);',
  '  const masuk = 0, keluar = 0, dicoret = 0;',
  AUDIT
);
sabotase(
  'dialog admin berhenti mengirim ulang kategori — menyunting keterangan MENGHAPUSNYA (bug 0119)',
  ADMIN,
  '      categoryId: r.category_id ?? null,',
  '      categoryId: null,',
  AUDIT
);
sabotase(
  'dialog admin berhenti mengirim ulang jumlah barang & satuannya',
  ADMIN,
  '      qty: r.qty ?? null,\n      unit: r.unit ?? null,',
  '      qty: null,\n      unit: null,',
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase koreksi kas tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
