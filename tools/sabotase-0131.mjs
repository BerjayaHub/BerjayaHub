/**
 * SABOTASE 0131 — memeriksa bahwa tes & auditnya benar-benar MENGGIGIT.
 *
 * Ini perubahan paling berbahaya sejauh ini: ia membuka kunci nota LUNAS dan
 * memindahkan uang secara otomatis. Tiap pelonggaran di bawah menghasilkan
 * keadaan yang terlihat normal di layar — stok yang tidak ditarik, kas yang
 * tidak menyesuaikan, atau kunci yang tertinggal terbuka — dan tidak satu pun
 * dari mereka mengeluh.
 *
 * Jalankan: node tools/sabotase-0131.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0131_nota_batal_dan_koreksi.sql';
const SVC = 'js/modules/inventory/nota.service.js';
const HAL = 'js/modules/inventory/nota-staff.js';
const UI = 'js/core/ui.js';

const asli = new Map();
for (const rel of [MIG, SVC, HAL, UI]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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

const TES = 'tools/test-migrasi-0131.mjs';
const AUDIT = 'tools/audit-batal-koreksi-nota.cjs';

console.log('\n== Stok ==');

sabotase(
  'membatalkan nota TIDAK menarik stoknya — barang hantu bertahan di gudang',
  MIG,
  /  for r in select product_id, qty from goods_receipt_items where receipt_id = p_nota loop\n    insert into stock_movements[\s\S]*?\n  end loop;/,
  '  -- stok tidak ditarik',
  TES
);

sabotase(
  'penyeimbangnya positif, bukan negatif — stoknya justru berlipat',
  MIG,
  "values (v_g.business_unit_id, v_g.outlet_id, r.product_id, 'receive', -r.qty,",
  "values (v_g.business_unit_id, v_g.outlet_id, r.product_id, 'receive', r.qty,",
  TES
);

console.log('\n== Kas ==');

sabotase(
  'nota lunas yang dibatalkan tidak mengembalikan uangnya',
  MIG,
  "perform sesuaikan_kas_nota(p_nota, -v_total, 'nota dibatalkan: ' || btrim(p_alasan));",
  '',
  TES
);

sabotase(
  'koreksi nota lunas tidak menyesuaikan kas — buku kas dan nota bercerita berbeda',
  MIG,
  /  perform sesuaikan_kas_nota\(p_id, v_selisih, coalesce\(nullif\(btrim\(p_alasan\), ''\), 'perbaikan isi nota'\)\);/,
  '',
  TES
);

sabotase(
  'arah entri kasnya terbalik — nota yang jadi lebih mahal justru mengembalikan uang',
  MIG,
  "case when p_selisih > 0 then 'out' else 'in' end,",
  "case when p_selisih > 0 then 'in' else 'out' end,",
  TES
);

// SELURUH RANTAI PENJAGA, bukan satu barisnya.
//
// Dua sabotase pertama versi ini mencabut penjaga 'pusat' dan
// 'belum lunas' satu per satu, lalu dilaporkan LOLOS. Sebabnya jujur:
// keduanya memang tidak menahan apa pun sendirian — nota yang belum dibayar
// dan nota yang dibayar pusat sama-sama tidak punya `payment_entry_id`, jadi
// pencarian entri aslinya yang menahan mereka.
//
// Yang benar-benar dijaga adalah RANTAInya. Jadi yang disabotase rantainya.
sabotase(
  'seluruh penjaga sesuaikan_kas_nota dicabut — nota yang belum dibayar pun dibuatkan entri kas',
  MIG,
  /  if v_g\.payment_status is distinct from 'lunas' then return null; end if;[\s\S]*?  if v_asli\.id is null then return null; end if;/,
  '',
  TES
);

sabotase(
  'selisihnya dihitung terbalik — sesudah dikurangi sebelum',
  MIG,
  'v_selisih := v_sesudah - v_sebelum;',
  'v_selisih := v_sebelum - v_sesudah;',
  TES
);

console.log('\n== Kunci nota lunas ==');

sabotase(
  'kunci lunas dibuka untuk SEMUA jalur — PWA lama bisa mengubah nilai tanpa kas ikut bergerak',
  MIG,
  /  if v_bayar = 'lunas' and coalesce\(current_setting\('berjaya\.koreksi_nota', true\), ''\) <> 'on' then\n    raise exception[^\n]*\n  end if;/,
  '',
  TES
);

// DIPERIKSA AUDIT, BUKAN TES — dan itu jujur.
//
// `set_config(..., true)` berlaku sampai TRANSAKSINYA selesai. Tiap panggilan
// RPC lewat PostgREST adalah satu transaksi, dan tiap `query()` di PGlite juga.
// Jadi kuncinya memang menutup sendiri walau penutupan eksplisitnya dicabut —
// tesnya tidak bisa membedakan, dan memaksanya berpura-pura bisa hanya akan
// menghasilkan tes yang hijau karena alasan yang salah.
//
// Yang tetap benar: penutupan eksplisit itu menjaga dari kasus di mana
// pemanggilnya membungkus beberapa operasi dalam SATU transaksi. Auditlah yang
// menghitung buka-versus-tutup.
sabotase(
  'kunci tidak ditutup lagi sesudah koreksi selesai',
  MIG,
  /  perform set_config\('berjaya\.koreksi_nota', '', true\);\n\n  select coalesce/,
  '\n  select coalesce',
  AUDIT
);

sabotase(
  'koreksi yang GAGAL meninggalkan kuncinya terbuka',
  MIG,
  /  exception when others then\n    perform set_config\('berjaya\.koreksi_nota', '', true\);\n    raise;\n  end;/,
  '  exception when others then\n    raise;\n  end;',
  AUDIT
);

console.log('\n== Penjaga lain ==');

sabotase(
  'alasan pembatalan tidak lagi wajib',
  MIG,
  /  if coalesce\(btrim\(p_alasan\), ''\) = '' then\n[\s\S]*?\n  end if;/,
  '',
  TES
);

sabotase(
  'siapa pun bisa membatalkan nota outlet lain',
  MIG,
  /  if not has_outlet_scope\(v_uid, v_g\.outlet_id\) then\n    raise exception 'Nota ini bukan wewenangmu\.';\n  end if;/,
  '',
  TES
);

sabotase(
  'nota yang sudah diekspor ESB boleh dibatalkan — ESB dan Berjaya Hub berbeda selamanya',
  MIG,
  /  if v_g\.esb_exported_at is not null then\n    raise exception 'Nota % sudah diekspor ke ESB\. Batalkan tanda ekspornya dulu, lalu perbaiki berkasnya di sana\.', coalesce\(v_g\.code, ''\);\n  end if;/,
  '',
  TES
);

sabotase(
  'nota batal masih bisa dibayar — uang keluar untuk barang yang sudah ditarik',
  MIG,
  /drop trigger if exists trg_tolak_bayar_nota_batal on goods_receipts;\ncreate trigger trg_tolak_bayar_nota_batal[\s\S]*?tolak_bayar_nota_batal\(\);/,
  '',
  TES
);

sabotase(
  'nota batal ikut diekspor ke ESB sebagai pembelian sungguhan',
  MIG,
  "     and g.status = 'aktif'\n",
  '',
  TES
);

sabotase(
  'nota batal masih bisa diubah isinya',
  MIG,
  /  if v_status = 'dibatalkan' then\n    raise exception 'Nota % sudah dibatalkan, isinya tidak bisa diubah lagi\.', coalesce\(v_code, ''\);\n  end if;/,
  '',
  TES
);

sabotase(
  'sesuaikan_kas_nota dibuka untuk klien — siapa pun bisa menambah kas sesukanya',
  MIG,
  'revoke all on function sesuaikan_kas_nota(uuid, numeric, text) from public;',
  'grant execute on function sesuaikan_kas_nota(uuid, numeric, text) to authenticated;',
  AUDIT
);

console.log('\n== Layar ==');

sabotase(
  'tombol Hapus hilang dari baris nota',
  HAL,
  'class="btn-danger nota-hapus"',
  'class="btn-danger nota-hapus-nonaktif"',
  AUDIT
);

sabotase(
  'tombol Hapus ada tapi tidak terhubung',
  HAL,
  "box.querySelectorAll('.nota-hapus')",
  "box.querySelectorAll('.nota-hapus-mati')",
  AUDIT
);

sabotase(
  'dialog pembatalan berhenti menyebut bahwa stoknya ditarik',
  HAL,
  "'Stok yang masuk lewat nota ini akan DITARIK KEMBALI' +",
  "'Yakin?' +",
  AUDIT
);

sabotase(
  'kotak tanggal hilang dari dialog edit — keluhan aslinya tidak tersentuh',
  HAL,
  "{ name: 'tanggal', label: 'Tanggal nota', type: 'date', value: nota?.receipt_date ?? '' },",
  '',
  AUDIT
);

sabotase(
  'dialog edit kembali memakai ubahNota — kas tidak akan pernah menyesuaikan',
  HAL,
  /            selisih = await koreksiNota\(\{\n              id: nota\.id,/,
  '            selisih = 0; await ubahNota(nota.id, {\n              id2: nota.id,',
  AUDIT
);

sabotase(
  'nota batal tidak ditandai — tampil persis seperti nota yang masih berlaku',
  HAL,
  "const batal = n.status === 'dibatalkan';",
  'const batal = false;',
  AUDIT
);

// Polanya HARUS menyebut `type="submit"`.
//
// Teks `${danger ? 'btn-danger' : 'primary'}` muncul dua kali di ui.js —
// sekali di `confirmDialog`, sekali di `formDialog` — dan `String.replace`
// mengganti yang PERTAMA. Versi pertama sabotase ini merusak `confirmDialog`,
// lalu dilaporkan lolos karena audit ini memang menjaga `formDialog`.
// Jebakan yang sama sudah menggigit dua kali di repo ini.
sabotase(
  'formDialog berhenti mengenal opsi danger — tombolnya diam-diam jadi biasa',
  UI,
  `<button type="submit" class="\${danger ? 'btn-danger' : 'primary'} btn-inline"`,
  `<button type="submit" class="primary btn-inline"`,
  AUDIT
);

console.log('');
if (gagal === 0) {
  console.log('Semua sabotase 0131 tertangkap. Tes & auditnya menggigit. ✅');
} else {
  console.error(`${gagal} sabotase LOLOS.`);
}
process.exit(gagal === 0 ? 0 : 1);
