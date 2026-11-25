/**
 * SABOTASE: penambahan aset (0190).
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Seluruh fitur ini ada untuk satu hal: supaya pertambahan jumlah aset punya
 * SEBAB yang tercatat, bukan cuma angka yang berubah. Dan semua cara ia bisa
 * rusak berbentuk sama — tetap berjalan, tetap menghasilkan angka yang masuk
 * akal, tetap tanpa galat:
 *
 *   - `qty = p_jumlah` alih-alih `qty = qty + p_jumlah`: benar untuk satu
 *     orang, menimpa diam-diam untuk dua orang;
 *   - baris log penjelasnya hilang: stoknya tetap benar, dan satu-satunya yang
 *     hilang adalah hal yang diminta;
 *   - pembatalan yang dipaksakan melewati sisa: stok minus, yang terlihat
 *     seperti galat sistem dan karena itu tidak pernah diperiksa;
 *   - kotak "berapa unit" yang tidak mengatakan bahwa isinya TAMBAHAN: diisi
 *     jumlah akhir, stoknya melonjak, dan tidak ada yang merasa melakukannya.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0190_penambahan_aset.sql';
const SVC = 'js/modules/asset/asset.service.js';
const PAGE = 'js/modules/asset/asset.page.js';
const ATURAN = 'js/modules/asset/aturan-aset-bu.js';

const BERKAS = [MIG, SVC, PAGE, ATURAN];
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

const PG = 'tools/test-migrasi-0190.mjs';
const AUDIT = 'tools/audit-penambahan-aset.cjs';
const MURNI = 'tools/test-aturan-aset-bu.mjs';

for (const p of [PG, AUDIT, MURNI]) pastikanHijau(p);

// =====================================================================
console.log('SABOTASE: DITAMBAHKAN vs DITETAPKAN');
// =====================================================================

sabotase(
  'jumlahnya ditetapkan, bukan ditambahkan (pencatatan bersamaan saling menimpa)',
  MIG,
  '     set qty = qty + p_jumlah, updated_by = v_uid, updated_at = now()',
  '     set qty = p_jumlah, updated_by = v_uid, updated_at = now()',
  PG
);

sabotase(
  'baris stoknya tidak dikunci sebelum dibaca',
  MIG,
  `  select qty into v_sebelum from asset_stock
   where asset_item_id = p_item and outlet_id = p_outlet
   for update;`,
  `  select qty into v_sebelum from asset_stock
   where asset_item_id = p_item and outlet_id = p_outlet;`,
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE: SEBABNYA HILANG');
// =====================================================================

// Inilah kerusakan yang paling tepat sasaran: stoknya tetap benar, layarnya
// tetap jalan, dan satu-satunya yang hilang adalah hal yang diminta.
sabotase(
  'baris riwayat yang menjelaskan sebabnya dibuang',
  MIG,
  `  insert into asset_log (asset_item_id, outlet_id, aksi, kolom, sebelum, sesudah, catatan, oleh, oleh_nama)
  values (p_item, p_outlet, 'tambah', p_sumber, v_sebelum::text, v_sesudah::text,`,
  `  insert into asset_log (asset_item_id, outlet_id, aksi, kolom, sebelum, sesudah, catatan, oleh, oleh_nama)
  select p_item, p_outlet, 'tambah', p_sumber, v_sebelum::text, v_sesudah::text,`,
  PG
);

sabotase(
  'kejadiannya tidak disimpan (stok berubah tanpa baris yang bisa ditanya)',
  MIG,
  `  insert into asset_penambahan (asset_item_id, outlet_id, jumlah, sumber, catatan, tanggal,
                                qty_sebelum, qty_sesudah, dicatat_by, dicatat_by_nama)
  values (p_item, p_outlet, p_jumlah, p_sumber, v_catatan, v_tgl,
          v_sebelum, v_sesudah, v_uid, v_nama)
  returning id into v_id;`,
  '  v_id := gen_random_uuid();',
  PG
);

sabotase(
  'angka sebelum & sesudah tidak ikut disimpan',
  MIG,
  '                                qty_sebelum, qty_sesudah, dicatat_by, dicatat_by_nama)',
  '                                dicatat_by, dicatat_by_nama)',
  AUDIT
);

sabotase(
  'tanggal masuk yang bukan hari ini tidak ikut ke riwayat',
  MIG,
  `          case when v_tgl = (now() at time zone 'Asia/Jakarta')::date then v_catatan
               else btrim(coalesce(v_catatan || ' · ', '') || 'tanggal masuk ' || to_char(v_tgl, 'DD Mon YYYY')) end,`,
  '          v_catatan,',
  PG
);

// =====================================================================
console.log('\nSABOTASE: ISIAN YANG TIDAK DIJAGA');
// =====================================================================

sabotase(
  'jumlah nol/minus diterima (pengurangan menyamar jadi pembelian)',
  MIG,
  `  if p_jumlah is null or p_jumlah <= 0 then
    raise exception 'Jumlah yang ditambahkan harus lebih dari nol.';
  end if;`,
  '',
  PG
);

sabotase(
  'tanggal masa depan diterima',
  MIG,
  `  if v_tgl > (now() at time zone 'Asia/Jakarta')::date then
    raise exception 'Tanggal penambahan tidak boleh di masa depan.';
  end if;`,
  '',
  PG
);

sabotase(
  'sumber ngawur diterima (ejaan bebas masuk ke rekap)',
  MIG,
  `  if p_sumber not in ('pembelian', 'hibah', 'temuan', 'kembali', 'lainnya') then
    raise exception 'Sumber "%" tidak dikenal.', p_sumber;
  end if;`,
  '',
  PG
);

sabotase(
  'wewenang outlet tidak diperiksa',
  MIG,
  `  if not has_outlet_scope(v_uid, p_outlet) then
    raise exception 'Aset ini di luar outlet yang bisa kamu kelola.';
  end if;`,
  '',
  PG
);

sabotase(
  'kolom sumber kehilangan batas nilainya di database',
  MIG,
  "                  check (sumber in ('pembelian', 'hibah', 'temuan', 'kembali', 'lainnya')),",
  ',',
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE: PEMBATALAN');
// =====================================================================

sabotase(
  'pembatalan melebihi sisa dipaksakan (stok jadi minus)',
  MIG,
  `  if r.jumlah > v_sisa then
    raise exception 'Tinggal % unit di outlet ini, tidak bisa menarik penambahan % unit. Betulkan jumlahnya dulu lewat Edit kalau memang catatannya yang keliru.',
      v_sisa, r.jumlah;
  end if;`,
  '',
  PG
);

sabotase(
  'barisnya dihapus saat dibatalkan (jejaknya ikut hilang)',
  MIG,
  `  update asset_penambahan
     set dibatalkan_at = now(), dibatalkan_by = v_uid,
         dibatalkan_by_nama = nama_pengguna(v_uid), alasan_batal = btrim(p_alasan)
   where id = p_id;`,
  '  delete from asset_penambahan where id = p_id;',
  PG
);

sabotase(
  'pembatalan ganda diterima (stok dipotong dua kali)',
  MIG,
  "  if r.dibatalkan_at is not null then raise exception 'Catatan ini sudah dibatalkan.'; end if;",
  '',
  PG
);

sabotase(
  'alasan pembatalan tidak wajib',
  MIG,
  `  if btrim(coalesce(p_alasan, '')) = '' then
    raise exception 'Alasan pembatalan wajib diisi.';
  end if;`,
  '',
  PG
);

sabotase(
  'siapa pun bisa membatalkan catatan penambahan',
  MIG,
  `  if not is_admin_of_outlet(v_uid, r.outlet_id) then
    raise exception 'Hanya admin outlet yang boleh membatalkan catatan penambahan.';
  end if;`,
  '',
  PG
);

// =====================================================================
console.log('\nSABOTASE: JALAN MASUK LANGSUNG');
// =====================================================================

sabotase(
  'policy tulis langsung dibuka (catatan bertambah tanpa stok ikut bertambah)',
  MIG,
  `create policy asset_penambahan_select on asset_penambahan
  for select using (`,
  `create policy asset_penambahan_insert on asset_penambahan
  for insert with check (true);
create policy asset_penambahan_select on asset_penambahan
  for select using (`,
  PG
);

// =====================================================================
console.log('\nSABOTASE: LAYAR & KALIMATNYA');
// =====================================================================

sabotase(
  'kalimat riwayat penambahan hilang (terbaca sebagai kolom bernama "pembelian")',
  ATURAN,
  "  if (l?.aksi === 'tambah') {",
  '  if (false) {',
  MURNI
);

sabotase(
  'kalimatnya cuma mengulang angka akhir, tidak menyebut selisihnya',
  ATURAN,
  '    const jml = Number.isFinite(masuk) && masuk > 0 ? `+${masuk} unit` : `${ke} unit`;',
  '    const jml = `${ke} unit`;',
  MURNI
);

sabotase(
  'tombol Tambah dibuang dari daftar',
  PAGE,
  '<button class="as-tambah" data-item="${a.itemId}">Tambah</button>',
  '',
  AUDIT
);

sabotase(
  'tombolnya ada tapi tidak terhubung ke dialognya',
  PAGE,
  `    list.querySelectorAll('.as-tambah').forEach((b) =>
      b.addEventListener('click', () => dialogTambahStok(rows.find((a) => a.itemId === b.dataset.item)))
    );`,
  '',
  AUDIT
);

// Kotak ini pernah salah diisi dengan jumlah AKHIR di hampir setiap aplikasi
// yang punya dua-duanya.
sabotase(
  'dialog berhenti mengatakan bahwa yang diisi adalah TAMBAHANNYA',
  PAGE,
  "          help: 'Isi jumlah TAMBAHANNYA, bukan jumlah akhir. Angka ini akan DITAMBAHKAN ke jumlah yang sekarang.'",
  "          help: 'Jumlah unit.'",
  AUDIT
);

sabotase(
  'toast tidak menyebut jumlah sesudahnya',
  PAGE,
  '        `Ditambahkan ${formatNum(values.jumlah)} unit. Sekarang ${formatNum(hasil?.sesudah ?? 0)} unit di outlet ini.`,',
  '        `Ditambahkan ${formatNum(values.jumlah)} unit.`,',
  AUDIT
);

sabotase(
  'sumber & tanggal tidak ditanyakan (riwayatnya kembali cuma angka)',
  PAGE,
  "        { name: 'sumber', label: 'Dari mana', type: 'select', value: 'pembelian', options: SUMBER_TAMBAH_OPTIONS },",
  '',
  AUDIT
);

sabotase(
  'layanan memakai jalur yang menetapkan angka, bukan RPC penambah',
  SVC,
  "  const { data, error } = await supabase.rpc('tambah_stok_aset', {",
  "  const { data, error } = await supabase.rpc('catat_stok_aset', {",
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS — pemeriksanya belum cukup.`);
process.exit(gagal === 0 ? 0 : 1);
