/**
 * SABOTASE: revisi hasil opname yang sudah ditutup (0155).
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Fitur ini punya satu sifat yang tidak bisa dilihat dari layar mana pun:
 * koreksinya BERTANGGAL saat opname ditutup, bukan hari ini. Hapus satu kata
 * (`coalesce(c.closed_at, …)` jadi `now()`) dan semuanya tetap berjalan —
 * angka di layar berubah, toastnya bilang berhasil, saldo hari ini benar. Yang
 * hilang cuma kebenaran saldo PER TANGGAL, yaitu stok akhir di laporan COGS.
 *
 * Jadi yang diuji di sini bukan apakah kodenya ada, melainkan apakah
 * pemeriksanya MERAH saat kodenya dirusak.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0155_revisi_opname.sql';
const MURNI = 'js/modules/inventory/revisi-opname.js';
const LAP = 'js/modules/inventory/laporan-opname.js';
const SVC = 'js/modules/inventory/opname.service.js';
const ADM = 'js/modules/inventory/opname.admin.js';

const asli = new Map();
for (const rel of [MIG, MURNI, LAP, SVC, ADM]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

// ============ JEJAK "SABOTASE SEDANG TERPASANG" ============
//
// `process.on('exit')` TIDAK berjalan kalau prosesnya di-SIGKILL — mis. saat
// harness ini kena batas waktu di luar. Yang tertinggal adalah berkas repo
// yang masih tersabotase, dan ia TIDAK terlihat sebagai apa pun: migration-nya
// tetap sah, aplikasinya tetap jalan, dan satu-satunya tanda adalah satu tes
// yang merah entah kenapa berjam-jam kemudian.
//
// Itu benar-benar terjadi: `0153` tertinggal dengan `if false then` di tempat
// penjaga "kas keluar harus menyebut outlet peruntukannya".
//
// Jadi penanda ini ditulis SEBELUM berkas pertama dirusak dan dibuang sesudah
// semuanya pulih. `tools/audit-sisa-sabotase.cjs` berteriak kalau ia tertinggal.
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

const PG = 'tools/test-migrasi-0155.mjs';
const TES = 'tools/test-revisi-opname.mjs';
const TES_LAP = 'tools/test-laporan-opname.mjs';
const AUDIT = 'tools/audit-revisi-opname.cjs';

console.log('SABOTASE "KOREKSINYA DICATAT HARI INI SAJA" — saldo sekarang benar, COGS bulan itu tetap salah:');

sabotase(
  'pergerakan koreksi bertanggal now() — saldo per tanggal opname tetap angka lama',
  MIG,
  "     coalesce(c.closed_at, c.opened_at));",
  '     now());',
  PG
);
sabotase(
  '`created_at` dibuang dari daftar kolomnya — default `now()` mengambil alih tanpa satu pun galat',
  MIG,
  '    (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by, count_id, created_at)',
  '    (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by, count_id)',
  AUDIT
);
sabotase(
  'delta nol tetap menulis baris pergerakan',
  MIG,
  '  if p_delta is null or p_delta = 0 then return; end if;',
  '  if p_delta is null then return; end if;',
  AUDIT
);

console.log('\nSABOTASE "BACA ULANG SAJA STOKNYA" — bentuk bug nanas (0114):');

sabotase(
  'delta dihitung terhadap stok sekarang, bukan angka hitungan lama — koreksinya berlaku dua kali',
  MIG,
  '    v_delta := p_counted - v_lama.counted_qty;',
  `    select coalesce(sum(sm.qty_delta), 0) into v_sistem from stock_movements sm
      where sm.outlet_id = c.outlet_id and sm.product_id = p_product;
    v_delta := p_counted - v_sistem;`,
  PG
);
sabotase(
  'potret sistem baris yang direvisi ikut diperbarui',
  MIG,
  '    update stock_count_items\n       set counted_qty = p_counted,',
  '    update stock_count_items\n       set system_qty = (select coalesce(sum(qty_delta),0) from stock_movements where outlet_id = c.outlet_id and product_id = p_product),\n           counted_qty = p_counted,',
  AUDIT
);
sabotase(
  'potret untuk bahan TERLEWAT memakai stok hari ini — selisihnya memuat setiap nota sesudah opname',
  MIG,
  '       and sm.created_at <= coalesce(c.closed_at, c.opened_at)\n',
  '',
  PG
);
sabotase(
  'pergerakan milik sesi ini sendiri ikut terhitung di potret bahan terlewat',
  MIG,
  '       and sm.count_id is distinct from p_count;',
  ';',
  AUDIT
);

console.log('\nSABOTASE PENJAGA:');

sabotase(
  'siapa pun yang berwenang di outlet bisa mengubah stok bertanggal lampau',
  MIG,
  '  if not is_bu_admin(auth.uid(), c.business_unit_id) then',
  '  if not has_outlet_scope(auth.uid(), c.outlet_id) then',
  PG
);
sabotase(
  'sesi lampau yang sudah ketiban opname berikutnya jadi bisa direvisi',
  MIG,
  '       and c2.closed_at > c.closed_at',
  '       and false',
  PG
);
sabotase(
  'sesi yang sedang berjalan tidak lagi menghalangi — potret stoknya basi tanpa terlihat',
  MIG,
  "  if exists (select 1 from stock_counts c3 where c3.outlet_id = c.outlet_id and c3.status = 'open') then",
  '  if false then',
  PG
);
sabotase(
  'sesi yang DIBATALKAN bisa "direvisi" — padahal ia tidak pernah menyentuh stok',
  MIG,
  "  if c.status <> 'closed' then",
  '  if false then',
  PG
);
sabotase(
  'alasan revisi jadi opsional',
  MIG,
  "  if coalesce(btrim(p_alasan), '') = '' then\n    raise exception 'Isi alasan revisinya",
  "  if false then\n    raise exception 'Isi alasan revisinya",
  PG
);
sabotase(
  'RPC revisinya tidak bisa dipanggil siapa pun',
  MIG,
  'grant execute on function revisi_hitungan_opname(uuid, uuid, numeric, text) to authenticated;',
  '',
  AUDIT
);

console.log('\nSABOTASE "BUANG BARIS":');

sabotase(
  'arah selisih pembuangan terbalik — stoknya digandakan, bukan dibatalkan',
  MIG,
  '  v_delta := v_lama.system_qty - v_lama.counted_qty;',
  '  v_delta := v_lama.counted_qty - v_lama.system_qty;',
  PG
);
sabotase(
  'barisnya dihapus, bukan ditandai — petunjuk rak yang belum dihitung ikut hilang',
  MIG,
  '  update stock_count_items\n     set dibuang_at = now(),',
  '  delete from stock_count_items where id = v_lama.id;\n  update stock_count_items\n     set dibuang_at = now(),',
  AUDIT
);
sabotase(
  'membuang dua kali dibiarkan — stoknya dibalik dua kali',
  MIG,
  "  if v_lama.dibuang_at is not null then raise exception 'Baris ini sudah dibuang sebelumnya.'; end if;",
  '',
  PG
);

console.log('\nSABOTASE JEJAK:');

sabotase(
  'jejak revisi menumpang `sebelumnya` — setiap baris direvisi muncul sebagai pertengkaran antar-penghitung',
  MIG,
  // Diikat ke entri yang menyimpan `qty_lama` SUNGGUHAN. Versi pertama
  // sabotase ini memakai potongan `revisi = revisi || jsonb_build_object(`
  // saja — dan potongan itu muncul DUA kali (cabang menghidupkan baris yang
  // pernah dibuang memakainya juga), jadi harness-nya menolak memasangnya.
  "           revisi = revisi || jsonb_build_object(\n             'qty_lama', v_lama.counted_qty",
  "           sebelumnya = sebelumnya || jsonb_build_object(\n             'qty_lama', v_lama.counted_qty",
  AUDIT
);
sabotase(
  'jejak revisi KEDUA menimpa yang pertama — angka asli staff hilang',
  MIG,
  "           revisi = revisi || jsonb_build_object(\n             'qty_lama', v_lama.counted_qty",
  "           revisi = jsonb_build_array(jsonb_build_object(\n             'qty_lama', v_lama.counted_qty",
  PG
);
sabotase(
  'penanda `direvisi_at` di kepala sesi tidak diisi — sesi yang pernah diubah tidak bisa dibedakan',
  MIG,
  '  update stock_counts set direvisi_at = now(), direvisi_by = auth.uid() where id = p_count;\n\n  return v_delta;\nend;\n$$;\n\nrevoke all on function revisi_hitungan_opname',
  '  return v_delta;\nend;\n$$;\n\nrevoke all on function revisi_hitungan_opname',
  PG
);

console.log('\nSABOTASE MODUL MURNI:');

sabotase(
  'delta revisi ikut memakai potret sistem',
  MURNI,
  'export function deltaRevisi({ lama, baru } = {}) {\n  return num(baru) - num(lama);',
  'export function deltaRevisi({ lama, baru, sistem } = {}) {\n  return num(baru) - num(sistem ?? lama);',
  AUDIT
);
sabotase(
  'arah delta buang terbalik di modul murninya',
  MURNI,
  '  return num(item.system_qty) - num(item.counted_qty);',
  '  return num(item.counted_qty) - num(item.system_qty);',
  TES
);
sabotase(
  '`closed_at` kosong dianggap "paling baru" — revisi ditawarkan pada sesi yang sudah tergantikan',
  MURNI,
  "  const adaLebihBaru = lain.some((d) => d.status === 'closed' && (!ini || String(d.closed_at ?? '') > String(ini)));",
  "  const adaLebihBaru = lain.some((d) => d.status === 'closed' && String(d.closed_at ?? '') > String(ini));",
  TES
);
sabotase(
  'sesi lain disaring per BU, bukan per outlet — satu sesi baru memblokir seluruh BU',
  MURNI,
  '  const lain = (daftar ?? []).filter((d) => d?.outlet_id === sesi.outlet_id && d?.id !== sesi.id);',
  '  const lain = (daftar ?? []).filter((d) => d?.id !== sesi.id);',
  TES
);
sabotase(
  'sesi berjalan tidak lagi menghalangi di layarnya',
  MURNI,
  "  if (lain.some((d) => d.status === 'open')) return { boleh: false, alasan: TOLAK_ADA_SESI_TERBUKA };",
  '',
  TES
);
sabotase(
  'baris yang dibuang tidak disaring — ia ikut Nilai Opname, yaitu stok akhir di COGS',
  MURNI,
  '  return (items ?? []).filter((it) => !it?.dibuang_at);',
  '  return items ?? [];',
  TES
);
sabotase(
  'angka asli NOL hilang karena `||` menggantikan `??`',
  MURNI,
  '  const pertama = item.revisi[0];\n  return pertama?.qty_lama ?? null;',
  '  const pertama = item.revisi[0];\n  return pertama?.qty_lama || null;',
  TES
);
sabotase(
  'yang ditampilkan angka sebelum revisi TERAKHIR, bukan angka yang diketik staff',
  MURNI,
  '  const pertama = item.revisi[0];',
  '  const pertama = item.revisi[item.revisi.length - 1];',
  TES
);
sabotase(
  'ringkasan ikut menghitung baris yang dibuang sebagai "direvisi"',
  MURNI,
  '    jumlahDirevisi: semua.filter((it) => !it?.dibuang_at && adaRevisi(it)).length,',
  '    jumlahDirevisi: semua.filter((it) => adaRevisi(it)).length,',
  TES
);

console.log('\nSABOTASE LAPORAN & LAYANAN:');

sabotase(
  'laporan kembali menyusun baris dari daftar lengkap — yang dibuang ikut dihitung',
  LAP,
  '  const baris = itemTerpakai(items).map((it) => {',
  '  const baris = (items ?? []).map((it) => {',
  AUDIT
);
sabotase(
  'kolom Dihitung berhenti menulis "(semula …)"',
  LAP,
  '      labelDihitung(it),',
  '      angka(dihitung),',
  AUDIT
);
sabotase(
  'ringkasan dihitung dari daftar yang SUDAH disaring — jumlahDibuang selalu nol',
  LAP,
  '  const { jumlahDirevisi, jumlahDibuang } = ringkasRevisi(items);',
  '  const { jumlahDirevisi, jumlahDibuang } = ringkasRevisi(itemTerpakai(items));',
  AUDIT
);
sabotase(
  '`dibuang_at` tidak diminta dari PostgREST — penyaringnya berhenti menyaring tanpa galat',
  SVC,
  'revisi, dibuang_at, dibuang_alasan, products(name',
  'products(name',
  AUDIT
);
sabotase(
  '`closed_at` tidak diminta — "sesi terakhir" tidak bisa ditentukan lagi',
  SVC,
  "'id, code, count_date, status, notes, outlet_id, opened_at, closed_at, direvisi_at,",
  "'id, code, count_date, status, notes, outlet_id, opened_at, direvisi_at,",
  AUDIT
);
sabotase(
  '`direvisi_at` tidak diminta — lencana "direvisi admin" tidak pernah muncul',
  SVC,
  'closed_at, direvisi_at, outlets!outlet_id(name)',
  'closed_at, outlets!outlet_id(name)',
  AUDIT
);

console.log('\nSABOTASE LAYAR ADMIN:');

sabotase(
  "kotak hitungan kosong tersimpan sebagai NOL — `Number('')` adalah 0, bukan NaN",
  ADM,
  '        if (kosong || !Number.isFinite(counted) || counted < 0) {',
  '        if (false) {',
  AUDIT
);
sabotase(
  'dampak pergerakan stoknya tidak diperlihatkan sebelum disimpan',
  ADM,
  '          `<p style="margin:6px 0">Stok bergerak <strong>${esc(teksDelta(d))} ${esc(satuan)}</strong>.</p>` +',
  '          `<p style="margin:6px 0">Stoknya akan disesuaikan.</p>` +',
  AUDIT
);
sabotase(
  'pratinjau deltanya dihitung dari angka yang salah',
  ADM,
  'const d = it ? deltaRevisi({ lama: it.counted_qty, baru: counted }) : null;',
  'const d = it ? deltaRevisi({ lama: it.system_qty, baru: counted }) : null;',
  AUDIT
);
sabotase(
  'tombol Revisi digambar tanpa melihat sesi lain di outlet itu',
  ADM,
  'const { boleh, alasan } = bolehRevisiOpname(d, daftar, { adminBu: bolehKelola });',
  'const { boleh, alasan } = bolehRevisiOpname(d, [d], { adminBu: bolehKelola });',
  AUDIT
);
sabotase(
  'menu jadi ikut ditawarkan untuk dihitung opname',
  ADM,
  "    semuaProduk = products.filter((p) => p.is_active !== false && p.product_type !== 'finished');",
  '    semuaProduk = products.filter((p) => p.is_active !== false);',
  AUDIT
);
sabotase(
  'baris yang dibuang hilang dari dialog "Lihat" — tidak ikut dihitung dijadikan tidak ditampilkan',
  ADM,
  "        const dibuang = (items ?? []).filter((it) => it?.dibuang_at);",
  '        const dibuang = [];',
  AUDIT
);
sabotase(
  'dropdown menawarkan baris yang hitungannya sudah dibuang',
  ADM,
  '        const terpakai = itemTerpakai(items);',
  '        const terpakai = items;',
  AUDIT
);

console.log('');
// Laporan opname punya tesnya sendiri yang sudah ada sejak 0085 — dipakai di
// sini untuk memastikan perubahan 0155 tidak menumpanginya diam-diam.
if (!fs.existsSync(P(TES_LAP))) {
  gagal++;
  console.error(`❌ ${TES_LAP} tidak ada.`);
}

if (gagal === 0) console.log('Semua sabotase revisi opname tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS — pemeriksanya tidak menjaga apa yang dikiranya dijaga.`);
process.exit(gagal === 0 ? 0 : 1);
