/**
 * SABOTASE: mengubah jumlah di draft order (0184).
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Bug aslinya hidup berbulan-bulan karena ia hanya muncul di SATU jalur:
 * mengubah baris yang sudah ada. Menambah barang baru selalu berhasil, jadi
 * layarnya tampak bekerja — dan yang melaporkannya terdengar seperti salah
 * pakai, karena pesannya sendiri berkata "jangan tambah baris baru".
 *
 * Yang dijaga di sini: perbaikannya tidak kembali jadi `on conflict`, dan
 * triggernya tidak ikut dilonggarkan demi melewatinya.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0184_ubah_draft_order_tanpa_upsert.sql';
const MIG129 = 'supabase/migrations/0129_satu_bahan_satu_baris.sql';

const BERKAS = [MIG, MIG129];
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

const AUDIT = 'tools/audit-upsert-vs-trigger.cjs';
const PG = 'tools/test-migrasi-0184.mjs';

for (const p of [AUDIT, PG]) pastikanHijau(p);

// =====================================================================
console.log('SABOTASE: KEMBALI KE UPSERT');
// =====================================================================
//
// Bentuk persis bug aslinya. Tertangkapnya WAJIB oleh dua pemeriksa yang
// berbeda: auditnya (yang mengenali polanya di tabel mana pun) dan tesnya
// (yang benar-benar menjalankannya di Postgres).

sabotase(
  'perbaikannya kembali jadi `on conflict do update`',
  MIG,
  '    update stock_order_items\n       set qty = v_qty\n     where order_id = p_order and product_id = v_pid;\n\n    if not found then',
  '    insert into stock_order_items(order_id, product_id, qty)\n    values (p_order, v_pid, v_qty)\n    on conflict (order_id, product_id) do update set qty = excluded.qty;\n\n    if false then',
  AUDIT
);

sabotase(
  'barisnya diubah tapi yang baru tidak pernah disisipkan',
  MIG,
  '    if not found then',
  '    if false then',
  PG
);

// `update` yang kehilangan penyaringnya menimpa SELURUH baris order — semua
// barang jadi berjumlah sama, dan tidak ada galat sama sekali.
sabotase(
  'update menimpa seluruh baris, bukan barisnya sendiri',
  MIG,
  '     where order_id = p_order and product_id = v_pid;',
  '     where order_id = p_order;',
  PG
);

// =====================================================================
console.log('\nSABOTASE: TRIGGERNYA DILONGGARKAN DEMI MELEWATINYA');
// =====================================================================
//
// Jalan pintas yang paling menggoda: matikan penjaganya, bukan perbaiki
// pemanggilnya. Akibatnya CK menyiapkan barang yang sama dua kali.

sabotase(
  'trigger baris kembar tidak lagi menolak apa pun',
  MIG129,
  "    raise exception '% sudah ada di order ini. Ubah jumlah di baris yang sudah ada, jangan tambah baris baru.',\n      coalesce(v_nama, 'Bahan ini') using errcode = 'unique_violation';",
  '    null;',
  PG
);

sabotase(
  'triggernya tidak dipasang lagi',
  MIG129,
  'create trigger trg_bahan_kembar_order\n  before insert or update of product_id on stock_order_items',
  'create trigger trg_bahan_kembar_order\n  before update of qty on stock_order_items',
  PG
);

// =====================================================================
console.log('\nSABOTASE: PENJAGAAN LAIN YANG IKUT DISALIN');
// =====================================================================

sabotase(
  'wewenang outlet asal hilang saat fungsinya ditulis ulang',
  MIG,
  "  if not has_outlet_scope(v_uid, v_o.from_outlet_id) then\n    raise exception 'Hanya staff outlet asal yang bisa mengubah order ini.';\n  end if;",
  '',
  PG
);

sabotase(
  'order yang sudah dikirim ke CK bisa diubah lagi',
  MIG,
  "  if v_o.status = 'open' then\n    raise exception 'Order ini sudah dikirim ke CK. Isinya tidak bisa diubah lagi — batalkan dulu, lalu susun draft baru.';\n  end if;",
  '',
  PG
);

// `coalesce(p_notes, notes)` — HP yang cuma menambah barang tidak boleh
// menghapus catatan yang baru ditulis orang lain di HP sebelah.
sabotase(
  'catatan orang lain ikut tertimpa',
  MIG,
  '     set notes = coalesce(p_notes, notes),',
  '     set notes = p_notes,',
  PG
);

sabotase(
  'baris yang diminta hapus tidak jadi dihapus',
  MIG,
  '    delete from stock_order_items\n     where order_id = p_order and product_id = any(p_hapus);',
  '    null;',
  PG
);

// ---------------------------------------------------------------
console.log('');
if (gagal === 0) console.log('Semua sabotase ubah draft order tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS / tidak terpasang.`);
process.exit(gagal === 0 ? 0 : 1);
