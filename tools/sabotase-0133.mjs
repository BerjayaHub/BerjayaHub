/**
 * SABOTASE 0133 — memeriksa bahwa tes & auditnya MENGGIGIT.
 *
 * Kesalahan paling mahal di berkas ini adalah MENUKAR dua keadaan: mengizinkan
 * pembatalan pada kiriman yang sudah diterima, atau meneruskan yang belum.
 * Keduanya tidak melempar error apa pun — yang pertama membuat pembukuan
 * berbohong tentang barang yang sungguhan ada di sana, yang kedua memindahkan
 * stok yang tidak pernah berpindah.
 *
 * Jalankan: node tools/sabotase-0133.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0133_kiriman_salah_alamat.sql';
const SVC = 'js/modules/dispatch/dispatch.service.js';
const HAL = 'js/modules/dispatch/dispatch.page.js';

const asli = new Map();
for (const rel of [MIG, SVC, HAL]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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

const TES = 'tools/test-migrasi-0133.mjs';
const AUDIT = 'tools/audit-kiriman-salah-alamat.cjs';

console.log('\n== Dua keadaan yang tidak boleh tertukar ==');

sabotase(
  'kiriman yang SUDAH diterima boleh dibatalkan — pembukuan berbohong tentang barang yang ada di sana',
  MIG,
  /  if v_d\.status = 'received' then\n    raise exception 'Kiriman % sudah diterima[\s\S]*?\n  end if;/,
  '',
  TES
);

sabotase(
  'kiriman yang BELUM diterima boleh diteruskan — memindahkan stok yang tidak pernah berpindah',
  MIG,
  /  if v_d\.status <> 'received' then\n    raise exception 'Kiriman % belum diterima[\s\S]*?\n  end if;/,
  '',
  TES
);

console.log('\n== Batalkan ==');

sabotase(
  'stok kiriman LAMA tidak dikembalikan — barangnya hilang dari pembukuan selamanya',
  MIG,
  /  for r in\n    select product_id, sum\(qty_delta\) as delta[\s\S]*?\n  end loop;/,
  '',
  TES
);

sabotase(
  'pengembaliannya masuk ke outlet TUJUAN, bukan pengirim',
  MIG,
  "values (v_d.business_unit_id, v_d.from_outlet_id, r.product_id, 'transfer_in', -r.delta,",
  "values (v_d.business_unit_id, v_d.to_outlet_id, r.product_id, 'transfer_in', -r.delta,",
  TES
);

sabotase(
  'pengembaliannya searah, bukan berlawanan — stoknya justru terpotong dua kali',
  MIG,
  "'transfer_in', -r.delta,",
  "'transfer_in', r.delta,",
  TES
);

sabotase(
  'penerima kehilangan wewenang menolak — hanya pengirim yang bisa membetulkan',
  MIG,
  'if not (has_outlet_scope(v_uid, v_d.from_outlet_id) or has_outlet_scope(v_uid, v_d.to_outlet_id)) then',
  'if not has_outlet_scope(v_uid, v_d.from_outlet_id) then',
  TES
);

sabotase(
  'alasan pembatalan tidak lagi wajib',
  MIG,
  /  if coalesce\(btrim\(p_alasan\), ''\) = '' then\n    raise exception 'Sebutkan alasan pembatalannya[^\n]*\n  end if;/,
  '',
  TES
);

sabotase(
  'kiriman yang sudah diekspor ESB boleh dibatalkan',
  MIG,
  /  if v_d\.esb_exported_at is not null then\n    raise exception 'Kiriman % sudah diekspor ke ESB[^\n]*\n  end if;/,
  '',
  TES
);

sabotase(
  'draft ikut dibatalkan lewat pintu ini, bukan lewat "Hapus draft"',
  MIG,
  // Pola harus melewati baris KOMENTAR di antara `then` dan `raise` —
  // versi pertama menganggap keduanya bersebelahan, lalu dilaporkan
  // "tidak terpasang". Sabotase yang tidak terpasang tidak menguji apa pun.
  /  if v_d\.status = 'draft' then\n(?:[^\n]*\n)*?    raise exception 'Ini masih DRAFT[^\n]*\n  end if;/,
  '',
  TES
);

console.log('\n== Teruskan ==');

sabotase(
  'yang diteruskan jumlah DIKIRIM, bukan yang benar-benar diterima',
  MIG,
  "             'qty', received_qty,",
  "             'qty', sent_qty,",
  TES
);

sabotase(
  'baris yang tidak sampai ikut diteruskan',
  MIG,
  'where dispatch_id = p_dispatch and coalesce(received_qty, 0) > 0;',
  'where dispatch_id = p_dispatch;',
  TES
);

sabotase(
  'siapa pun bisa meneruskan, bukan hanya outlet yang memegang barangnya',
  MIG,
  /  if not has_outlet_scope\(v_uid, v_d\.to_outlet_id\) then\n    raise exception 'Hanya outlet yang menerima[^\n]*\n  end if;/,
  '',
  TES
);

sabotase(
  'kiriman koreksi tidak tersambung ke kiriman yang salah',
  MIG,
  'update dispatches set koreksi_dari = p_dispatch where id = v_baru;',
  '',
  TES
);

sabotase(
  'tujuan yang sama dengan tempat barangnya sekarang diterima',
  MIG,
  /  if p_tujuan = v_d\.to_outlet_id then\n    raise exception[^\n]*\n  end if;/,
  '',
  TES
);

console.log('\n== Layar ==');

sabotase(
  'tombol tolak hilang dari Kiriman Masuk — penerima wajib menerima yang bukan miliknya',
  HAL,
  'class="btn-danger btn-tolak-kiriman"',
  'class="btn-danger btn-tolak-nonaktif"',
  AUDIT
);

sabotase(
  'tombol Batalkan di riwayat tidak terhubung',
  HAL,
  "hasil.querySelectorAll('.btn-batal-kiriman')",
  "hasil.querySelectorAll('.btn-batal-mati')",
  AUDIT
);

sabotase(
  'tombol Teruskan hilang dari riwayat',
  HAL,
  'class="btn-teruskan-kiriman"',
  'class="btn-teruskan-nonaktif"',
  AUDIT
);

sabotase(
  'tombolnya tidak lagi mengikuti keadaan — Batalkan muncul juga pada yang sudah diterima',
  HAL,
  "d.status === 'received' && d.to_outlet_id === state.outletId",
  'false',
  AUDIT
);

sabotase(
  'konfirmasi berhenti menyebut JENIS kirimannya',
  HAL,
  "const jenisKirim = isCK ? 'KIRIM KE OUTLET' : jenisSel?.value === 'retur' ? 'RETUR KE CENTRAL KITCHEN' : 'TRANSFER ANTAR OUTLET';",
  "const jenisKirim = 'kiriman';",
  AUDIT
);

sabotase(
  'layanan berhenti mengambil to_outlet_id — layar tidak bisa memutuskan tombolnya',
  SVC,
  'to_outlet_id, alasan_batal, from_outlet:outlets!from_outlet_id(name)',
  'from_outlet:outlets!from_outlet_id(name)',
  AUDIT
);

console.log('');
if (gagal === 0) {
  console.log('Semua sabotase 0133 tertangkap. Tes & auditnya menggigit. ✅');
} else {
  console.error(`${gagal} sabotase LOLOS.`);
}
process.exit(gagal === 0 ? 0 : 1);
