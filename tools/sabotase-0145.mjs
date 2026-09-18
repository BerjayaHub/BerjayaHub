/**
 * SABOTASE: draft order yang diisi dua HP.
 *
 * Yang dijaga: kembalinya kehilangan diam-diam. Setiap sabotase di berkas ini
 * menghasilkan aplikasi yang TERLIHAT bekerja — toast hijau di kedua HP — dan
 * kehilangan isi draft tanpa satu pun galat.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0145_draft_order_digabung.sql';
const MURNI = 'js/modules/dispatch/perubahan-draft.js';
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
    console.error(`❌ PEMERIKSANYA TIDAK ADA: ${pemeriksa}`);
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

const TES_DB = 'tools/test-migrasi-0145.mjs';
const TES = 'tools/test-perubahan-draft.mjs';
const AUDIT = 'tools/audit-draft-gabung.cjs';

console.log('SABOTASE SERVER:');

// Kembali ke bug aslinya, persis.
sabotase(
  'server kembali menghapus SELURUH isi draft — bug 0111 hidup lagi',
  MIG,
  '    delete from stock_order_items\n     where order_id = p_order and product_id = any(p_hapus);',
  '    delete from stock_order_items where order_id = p_order;',
  TES_DB
);
sabotase(
  'upsert jadi insert polos — dua HP menyentuh satu produk menghasilkan dua baris',
  MIG,
  '    on conflict (order_id, product_id) do update set qty = excluded.qty;',
  ';',
  TES_DB
);
sabotase(
  'catatan ditimpa walau tidak dikirim — catatan rekan hilang karena orang lain menambah satu barang',
  MIG,
  '     set notes = coalesce(p_notes, notes),',
  '     set notes = p_notes,',
  TES_DB
);
sabotase(
  'mengisi dulu baru menghapus — produk yang dihapus lalu ditambahkan lagi ikut terbuang',
  MIG,
  '  if p_hapus is not null and array_length(p_hapus, 1) is not null then',
  '  if false then',
  TES_DB
);
sabotase(
  'penjaga "sudah dikirim ke CK" dicabut — order yang sudah berjalan bisa diubah diam-diam',
  MIG,
  "  if v_o.status = 'open' then",
  '  if false then',
  TES_DB
);
sabotase(
  'wewenang outlet asal dicabut — staff outlet lain bisa mengubah order ini',
  MIG,
  '  if not has_outlet_scope(v_uid, v_o.from_outlet_id) then',
  '  if false then',
  TES_DB
);
sabotase(
  'jejak per baris tidak dicatat — yang tersisa cuma penyimpan terakhir seluruh draft',
  MIG,
  '  new.diubah_by := auth.uid();',
  '  new.diubah_by := null;',
  TES_DB
);

console.log('\nSABOTASE ATURAN SELISIH:');

// INI yang paling halus: barisnya masih ada di layar, jadi tidak ada yang
// terlihat hilang — nilainya yang diam-diam mundur.
// Diperiksa TES murni, bukan TES_DB: aturannya hidup di JavaScript, dan tes
// migration tidak pernah menyentuh berkas itu. Percobaan pertama menunjuk
// TES_DB dan lolos begitu saja — pemeriksa yang tidak pernah membaca berkas
// yang disabotase tidak bisa menangkap apa pun.
sabotase(
  'SELURUH baris di layar ikut dikirim — nilai lama dikembalikan ke baris yang baru diubah rekan',
  MURNI,
  '    if (lama.get(id) !== qty) ubah.push({ product_id: id, qty });',
  '    ubah.push({ product_id: id, qty });',
  TES
);
sabotase(
  'baris yang dibuang dari layar tidak masuk daftar hapus — menghapus jadi mustahil',
  MURNI,
  '    if (!baru.has(id)) hapus.push(id);',
  '    void id;',
  TES
);
sabotase(
  'qty nol disimpan sebagai baris, bukan dianggap dihapus',
  MURNI,
  '    if (q === null || q <= 0) continue;',
  '    if (q === null) continue;',
  TES
);
// Diperiksa AUDIT, bukan TES, dan alasannya jujur: penjaga `q <= 0` di
// sebelahnya menangkap akibatnya — `Number('')` jadi 0, lalu barisnya dilewati
// juga. Tidak ada keluaran yang berubah hari ini. Penjaga ini tetap dijaga
// karena keduanya bisa dicabut satu per satu, dan `Number('') === 0` sudah
// menggigit di beberapa modul lain di proyek ini.
sabotase(
  "Number('') yang bernilai 0 lolos jadi qty — lapis kedua di balik penjaga q <= 0",
  MURNI,
  "  if (v === null || v === undefined || v === '') return null;",
  '  if (v === undefined) return null;',
  AUDIT
);
sabotase(
  'angka dibandingkan tanpa disamakan tipenya — "2000" dari kotak isian dikira berbeda dari 2000',
  MURNI,
  '    const q = angka(b?.qty);',
  '    const q = b?.qty;',
  TES
);

console.log('\nSABOTASE LAYAR:');

sabotase(
  'layar kembali memakai jalur lama yang mengganti seluruh isi draft',
  PAGE,
  '            const hasil = await ubahDraftOrder({',
  '            const hasil = await updateStockOrder({ orderId: btn.dataset.id, items: newItems }) ?? ({',
  AUDIT
);
sabotase(
  'isi saat panel dibuka tidak disimpan — tidak ada pembanding, seluruh layar terkirim',
  PAGE,
  '        const isiAwal = items.map((it) => ({ product_id: it.product_id, qty: it.qty }));',
  '        const isiAwal = [];',
  AUDIT
);
sabotase(
  'catatan selalu dikirim — HP yang cuma menambah barang menimpa catatan rekannya',
  PAGE,
  '              notes: catatanKini === catatanAwal ? null : catatanKini',
  '              notes: catatanKini',
  AUDIT
);
sabotase(
  'hasilnya tidak dilaporkan — orangnya menyimpan 2 baris, membuka draft, menemukan 6, dan mengira aplikasinya menggandakan',
  PAGE,
  '            toast(pesanGabung(hasil, ubah.length), \'success\');',
  "            toast('Order diperbarui.', 'success');",
  AUDIT
);
sabotase(
  'p_hapus tidak selalu dikirim — PostgREST tidak menemukan fungsinya, dan galatnya tidak menyebut draft sama sekali',
  SVC,
  '    p_hapus: hapus ?? [],',
  '    p_hapus: hapus,',
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase draft gabung tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
