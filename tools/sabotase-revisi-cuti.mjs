/**
 * SABOTASE: revisi cuti & isi pesan keputusannya (0178).
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Revisi cuti menyentuh HAK staff: hari yang tidak pernah ia minta bisa
 * tercatat atas namanya, dan jatah cutinya ikut bergeser — kadang surut, untuk
 * bulan yang rekapnya sudah pernah dibaca orang. Satu-satunya yang
 * menyeimbangkan itu adalah jejaknya, dan jejak yang hilang tidak memunculkan
 * galat apa pun.
 *
 * Pesannya sama halusnya: baris yang hilang dari pesan WhatsApp tidak terlihat
 * sebagai kehilangan — penerimanya cuma tidak tahu apa yang tidak ia lihat.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0178_revisi_cuti.sql';
const MURNI = 'js/modules/leave/pesan-cuti.js';
const SVC = 'js/modules/leave/leave.service.js';
const ADMIN = 'js/modules/leave/leave.admin.page.js';
const EDGE = 'supabase/functions/notify-telegram/index.ts';

const BERKAS = [MIG, MURNI, SVC, ADMIN, EDGE];
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
// "Tertangkap" hanya berarti sesuatu kalau pemeriksanya memang hijau sebelum
// kodenya dirusak. Pemeriksa yang sudah merah sejak awal akan melaporkan
// SELURUH sabotase sebagai tertangkap, dan harness ini berubah jadi stempel.
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

const AUDIT = 'tools/audit-pesan-cuti.cjs';
const PG = 'tools/test-migrasi-0178.mjs';
const TES = 'tools/test-pesan-cuti.mjs';

for (const p of [AUDIT, PG, TES]) pastikanHijau(p);

// =====================================================================
console.log('SABOTASE HAK STAFF — yang paling mahal:');
// =====================================================================

// ============ ALASAN WAJIB ADALAH GANTI RUGINYA ============
//
// Pembatasan "hanya boleh dipersempit" dilepas di jalur revisi. Yang
// menyeimbangkannya cuma satu: selalu ada kalimat yang menjelaskan kenapa,
// dan nama yang bisa ditanya.
sabotase(
  'alasan revisi tidak lagi wajib',
  MIG,
  "  if btrim(coalesce(p_alasan, '')) = '' then",
  '  if false then',
  PG
);

sabotase(
  'nama perevisi tidak disimpan — jejaknya hilang saat akunnya dihapus',
  MIG,
  '         direvisi_by_nama = v_nama,',
  '',
  AUDIT
);

// ============ PENGAJUAN PENDING LEWAT JALUR INI ============
//
// Jalur revisi tidak mengenal batas "hanya boleh dipersempit". Kalau
// pengajuan yang BELUM diputuskan boleh lewat sini, batas yang menjaga
// keputusan pertama bisa dilewati begitu saja.
sabotase(
  'pengajuan yang masih menunggu boleh lewat jalur revisi',
  MIG,
  "  if v_r.status = 'pending' then",
  '  if false then',
  PG
);

sabotase(
  'wewenangnya dicabut — cuti outlet lain bisa diubah',
  MIG,
  '  if not (\n    (v_r.outlet_id is not null and is_admin_of_outlet(v_uid, v_r.outlet_id))',
  '  if false and (\n    (v_r.outlet_id is not null and is_admin_of_outlet(v_uid, v_r.outlet_id))',
  PG
);

// Angka hari yang tertinggal memotong jatah cuti sebesar yang TIDAK dipakai —
// dan salahnya tidak kelihatan karena baris tanggalnya sendiri sudah benar.
sabotase(
  'jumlah hari tidak dihitung ulang',
  MIG,
  '         day_count = (p_end - p_start) + 1,',
  '         day_count = v_r.day_count,',
  PG
);

// `*_awal` adalah PERMINTAAN ASLI staff, bukan "nilai sebelum perubahan
// terakhir". Menimpanya menghapus satu-satunya jejak apa yang ia minta.
sabotase(
  'kolom *_awal ikut ditimpa — jejak permintaan staff hilang',
  MIG,
  '         alasan_revisi = btrim(p_alasan)',
  '         alasan_revisi = btrim(p_alasan),\n         start_date_awal = v_r.start_date',
  AUDIT
);

sabotase(
  'jenis cuti BU lain boleh dipakai — pemotongan jatah pindah BU',
  MIG,
  '  if v_bu_type is not null and v_bu_type <> v_r.business_unit_id then',
  '  if false then',
  PG
);

// =====================================================================
console.log('\nSABOTASE ISI PESAN:');
// =====================================================================

sabotase(
  'alasan yang ditulis staff hilang lagi dari pesan keputusan',
  MURNI,
  '  if (alasan) baris.push(`💬 Alasan: ${alasan}`);',
  '',
  TES
);

sabotase(
  'keberadaan lampiran tidak disebut',
  MURNI,
  "  if (r?.attachment_path) baris.push('📎 Ada lampiran');",
  '',
  TES
);

sabotase(
  'lokasi BU/outlet hilang dari pesan',
  MURNI,
  '  if (lokasi) baris.push(`🏢 ${lokasi}`);',
  '',
  TES
);

// Begitu keduanya muncul bersamaan, ikon yang sama membuat kalimat staff
// terbaca sebagai keputusan atasannya.
sabotase(
  'alasan staff & catatan admin kembali memakai label yang sama',
  MURNI,
  '  if (catatan) baris.push(`🗒 Catatan admin: ${catatan}`);',
  '  if (catatan) baris.push(`💬 ${catatan}`);',
  TES
);

sabotase(
  'penanda REVISI dicabut dari baris paling atas',
  MURNI,
  '    revisiKe > 0 ? `${judul} — **REVISI ke-${revisiKe}**` : judul,',
  '    judul,',
  TES
);

sabotase(
  'cuti yang dibatalkan ditulis sebagai "ditolak"',
  MURNI,
  "      ? '🚫 **Cuti Dibatalkan**'",
  "      ? '❌ **Cuti Ditolak**'",
  TES
);

// Dua saluran yang menceritakan peristiwa yang sama tidak boleh bercerita
// berbeda — dan yang menyimpang duluan selalu yang lebih jarang dibaca.
sabotase(
  'Telegram berhenti membawa alasan staff',
  EDGE,
  '    r.reason ? `💬 Alasan: ${esc(r.reason)}` : \'\',',
  '',
  AUDIT
);

sabotase(
  'revisi yang tidak mengubah status tidak dikabarkan ke grup',
  EDGE,
  '      const direvisi = old_record && (Number(record.revisi_ke) || 0) > (Number(old_record.revisi_ke) || 0);',
  '      const direvisi = false;',
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE LAYAR ADMIN:');
// =====================================================================

sabotase('tombol Revisi dicabut', ADMIN, 'class="btn-revisi-cuti"', 'class="btn-revisi-sembunyi"', AUDIT);

sabotase(
  'tombol Revisi tidak dipasangi penangan klik',
  ADMIN,
  "  root.querySelectorAll('.btn-revisi-cuti').forEach((btn) =>",
  '  [].forEach((btn) =>',
  AUDIT
);

sabotase(
  'peringatan cuti lampau dihapus — jatah berubah surut tanpa ada yang tahu',
  ADMIN,
  'Cuti ini tanggalnya SUDAH LEWAT',
  'Cuti ini',
  AUDIT
);

// Dialog Setujui TIDAK boleh ikut longgar: batas itu yang menjaga keputusan
// pertama agar tidak mencatatkan hari yang tidak pernah diminta staff.
sabotase(
  'dialog Setujui kehilangan batas rentang pengajuannya',
  ADMIN,
  '        min: record.start_date,\n        max: record.end_date\n      },',
  '      },',
  AUDIT
);

sabotase(
  'kolom jejak revisi tidak diambil dari server — penandanya selalu kosong',
  SVC,
  "        'leave_type_id, business_unit_id, revisi_ke, direvisi_at, direvisi_by_nama, alasan_revisi, ' +",
  '',
  AUDIT
);

// ---------------------------------------------------------------
console.log('');
if (gagal === 0) console.log('Semua sabotase revisi cuti tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS / tidak terpasang.`);
process.exit(gagal === 0 ? 0 : 1);
