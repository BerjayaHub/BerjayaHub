/**
 * SABOTASE: transfer kas dari kantong pilihan & revisinya (0176).
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Fitur ini menggeser saldo DUA orang lewat satu tombol, dan yang kedua tidak
 * sedang menatap layar. Setiap cara ia rusak berakhir sebagai angka yang
 * terlihat wajar di kedua sisi — tidak ada galat, dan yang kehilangan uang
 * baru tahu saat menghitung laci.
 *
 * Yang diuji di sini bukan kodenya, melainkan apakah pemeriksanya masih
 * benar-benar menjaga sesuatu.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0176_transfer_kantong_dan_revisi.sql';
const MURNI = 'js/modules/cash/revisi-transfer-kas.js';
const SVC = 'js/modules/cash/cash.service.js';
const PAGE = 'js/modules/cash/cash.page.js';
// Penjaga `ubah_kas` tinggal di sini — versi TERAKHIR yang mendefinisikan
// `alasan_tolak_koreksi_kas`. Ikut dijaga karena melonggarkannya membuat jalur
// satu-baris bisa menyentuh transfer.
const MIG_KOREKSI = 'supabase/migrations/0149_disbursement_kas.sql';

const BERKAS = [MIG, MURNI, SVC, PAGE, MIG_KOREKSI];
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

const AUDIT = 'tools/audit-transfer-kantong.cjs';
const PG = 'tools/test-migrasi-0176.mjs';
const TES = 'tools/test-revisi-transfer-kas.mjs';

// =====================================================================
console.log('SABOTASE UANG — yang paling mahal:');
// =====================================================================

// ============ OVERLOAD LAMA YANG DIBIARKAN HIDUP ============
//
// PostgREST memilih fungsi lewat himpunan nama argumen. Dua tanda tangan yang
// cuma beda satu argumen berarti pemanggilan yang lupa mengirim kantong tetap
// "berhasil" — lewat jalur lama, memotong Kas Utama. Persis bug yang sedang
// diperbaiki, tapi kali ini tanpa satu pun tanda di layar.
sabotase(
  'tanda tangan lama transfer_cash dibiarkan hidup',
  MIG,
  'drop function if exists transfer_cash(uuid, numeric, text);',
  '',
  PG
);
sabotase(
  'tanda tangan lama dibiarkan hidup — DAN auditnya harus merah juga',
  MIG,
  'drop function if exists transfer_cash(uuid, numeric, text);',
  '',
  AUDIT
);

sabotase(
  'kantong asal tidak diperiksa pemiliknya — kantong orang lain bisa dipakai',
  MIG,
  'where id = p_from_account and holder_id = v_uid and is_active;',
  'where id = p_from_account;',
  PG
);

sabotase(
  'kaki penerima ikut berkantong — pengirim menentukan isi laci orang lain',
  MIG,
  "values (p_to_user, null, 'transfer_in', p_amount, v_uid, v_tid, p_notes, v_uid);",
  "values (p_to_user, p_from_account, 'transfer_in', p_amount, v_uid, v_tid, p_notes, v_uid);",
  PG
);

sabotase(
  'kantong asal boleh minus saat mengirim',
  MIG,
  '  if v_saldo < p_amount then\n    raise exception \'Saldo % cuma %, tidak cukup untuk mengirim %.\',',
  '  if false then\n    raise exception \'Saldo % cuma %, tidak cukup untuk mengirim %.\',',
  PG
);

// =====================================================================
console.log('\nSABOTASE REVISI:');
// =====================================================================

// Diukur ke baris yang diklik, PENERIMA ikut bisa merevisi — padahal uang itu
// bukan miliknya untuk dikembalikan sendiri.
sabotase(
  'wewenang diukur ke baris yang diklik, bukan ke pengirim',
  MIG,
  'if not boleh_koreksi_kas(v_out.holder_id) then',
  'if not boleh_koreksi_kas(v.holder_id) then',
  PG
);

sabotase(
  'kantong asal saat revisi tidak diikat ke pengirim — admin bisa memindahkannya ke kantongnya sendiri',
  MIG,
  'where id = p_from_account and holder_id = v_out.holder_id and is_active;',
  'where id = p_from_account and is_active;',
  PG
);

// Kaki lama masih di tabel; menghitungnya berarti uang yang sudah keluar
// dihitung dua kali, dan revisi yang cuma menaikkan sedikit pun ditolak.
sabotase(
  'saldo pengirim dihitung termasuk kaki yang sedang direvisi',
  MIG,
  '     and id <> v_out.id;',
  ';',
  PG
);

sabotase(
  'kaki penerima tidak ikut dipindahkan — uang hilang di satu sisi',
  MIG,
  '         holder_id = p_to_user,\n         account_id = null,',
  '         account_id = null,',
  PG
);

sabotase(
  'alasan revisi tidak lagi wajib — saldo dua orang bergeser tanpa keterangan',
  MIG,
  "  if btrim(coalesce(p_alasan, '')) = '' then",
  '  if false then',
  PG
);

sabotase(
  'jejak perevisi dibuang',
  MIG,
  '         alasan_ubah = btrim(p_alasan)\n   where id = v_out.id;',
  '         alasan_ubah = null\n   where id = v_out.id;',
  AUDIT
);

// ============ PENJAGA YANG TIDAK BOLEH IKUT DILONGGARKAN ============
//
// `alasan_tolak_koreksi_kas` menjaga `ubah_kas`, yang cuma bisa menyentuh
// SATU baris. Kalau ia berhenti menolak transfer, satu kaki bisa berubah
// sendirian — uang hilang di satu sisi tanpa muncul di sisi lain.
// Diperiksa AUDITNYA, bukan tes PGlite: tes itu memasang `ubah_kas` tiruan
// (migration aslinya menyeret setengah modul kas), jadi merusak migrationnya
// tidak akan terasa di sana sama sekali. Sabotase yang menyasar pemeriksa yang
// buta adalah sabotase yang selalu "tertangkap" tanpa memeriksa apa pun.
sabotase(
  'ubah_kas dibiarkan menyentuh transfer — satu kaki berubah sendirian',
  MIG_KOREKSI,
  "  if v.entry_type not in ('in', 'out') then",
  '  if false then',
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE LAYAR:');
// =====================================================================

sabotase(
  'server lama dianggap mengizinkan — dialog dibuka lalu ditolak server',
  MURNI,
  "  if (e?.alasan_tolak_transfer === undefined) {",
  '  if (false) {',
  TES
);

sabotase(
  'akibat ke penerima lama tidak lagi dikatakan',
  MURNI,
  '    `Baris ini akan HILANG dari riwayat kas ${lama}, dan saldonya berkurang ${Math.abs(angka(jumlahLama))}.`,',
  '',
  TES
);

sabotase(
  'saldo minus penerima lama tidak lagi dikabarkan',
  MURNI,
  "    return `Saldo ${nama} sekarang MINUS ${Math.abs(saldo)} — uangnya sudah terpakai sebelum transfer ini ditarik. Beri tahu dia.`;",
  "    return '';",
  TES
);

// Tanda minus kaki keluar bocor ke ringkasan: "−300.000 → 250.000" terbaca
// seperti arah uangnya ikut berubah.
sabotase(
  'tanda minus kaki keluar ikut tampil di ringkasan perubahan',
  MURNI,
  '  const jml0 = Math.abs(angka(semula?.jumlah));',
  '  const jml0 = angka(semula?.jumlah);',
  TES
);

sabotase(
  'saldo kantong hilang dari label pilihan — memilih laci tanpa tahu isinya',
  PAGE,
  '    const label = (n, id) => `${n} — ${formatRupiah(saldoDari(id))}`;',
  '    const label = (n) => `${n}`;',
  AUDIT
);

sabotase(
  'kantong asal tidak ikut terkirim saat transfer',
  PAGE,
  '        fromAccountId: values.from_account || null',
  '        fromAccountId: null',
  AUDIT
);

sabotase('tombol revisi transfer dicabut', PAGE, 'class="btn-kas-revisi"', 'class="btn-kas-sembunyi"', AUDIT);

sabotase(
  'argumenRpc dicabut dari transferCash — kunci null hilang, RPC-nya 42883',
  SVC,
  "  const { error } = await supabase.rpc('transfer_cash', argumenRpc({",
  "  const { error } = await supabase.rpc('transfer_cash', ({",
  AUDIT
);

// ---------------------------------------------------------------
console.log('');
if (gagal === 0) console.log('Semua sabotase transfer kantong tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS / tidak terpasang.`);
process.exit(gagal === 0 ? 0 : 1);
