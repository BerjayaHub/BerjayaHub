#!/usr/bin/env node
/**
 * Audit: kolom yang dipakai di js/ tapi TIDAK ADA di skema tabelnya.
 *
 * Jalankan:  node tools/audit-kolom-tabel.cjs
 *
 * KENAPA ADA:
 * `shift_schedules` tidak punya `created_at` — hampir semua tabel lain punya,
 * jadi jari mengetiknya begitu saja. PostgREST membalas error, error-nya
 * ditelan `catch`, hasilnya null, dan staff dicap "Tanpa jadwal". Tidak ada
 * yang meledak; yang muncul cuma data yang salah dan terlihat wajar.
 *
 * Skema dibaca dari supabase/migrations (create table + alter table add column),
 * jadi audit ini ikut bergerak sendiri saat skemanya berubah.
 *
 * TERBATAS pada pemakaian yang bisa dibaca dengan yakin: .eq/.order/.gte/dst
 * dengan nama kolom literal, di dalam rantai yang diawali .from('tabel'), plus
 * kolom POLOS di dalam .select().
 *
 * Di dalam .select(), yang diperiksa hanya potongan yang berupa nama kolom apa
 * adanya. Embed (`outlets!outlet_id(name)`), alias (`creator:user_profiles(...)`),
 * `*`, dan apa pun yang mengandung tanda kurung dilewati — sintaksnya terlalu
 * kaya untuk ditebak, dan audit yang sering salah tuduh akan berhenti dipercaya
 * lalu diabaikan. Lebih baik memeriksa sedikit hal dengan yakin.
 */

const fs = require('fs');
const path = require('path');

const AKAR = path.resolve(__dirname, '..');
const MIGRASI = path.join(AKAR, 'supabase', 'migrations');
const JS = path.join(AKAR, 'js');

// ---- 1. Bangun skema dari migration ----
const skema = new Map(); // nama tabel -> Set(kolom)
const tambah = (tabel, kolom) => {
  if (!skema.has(tabel)) skema.set(tabel, new Set());
  skema.get(tabel).add(kolom);
};

for (const f of fs.readdirSync(MIGRASI).filter((x) => x.endsWith('.sql')).sort()) {
  const sql = fs.readFileSync(path.join(MIGRASI, f), 'utf8');

  for (const m of sql.matchAll(/create table (?:if not exists )?([a-z_]+)\s*\(([\s\S]*?)\n\);/gi)) {
    const tabel = m[1];
    for (const baris of m[2].split('\n')) {
      const t = baris.trim();
      if (!t || t.startsWith('--')) continue;
      if (/^(primary key|unique|constraint|check|foreign key|exclude)\b/i.test(t)) continue;
      const k = t.match(/^([a-z_]+)\s/);
      if (k) tambah(tabel, k[1]);
    }
  }
  // Satu pernyataan ALTER bisa memanjang beberapa baris dan menambah beberapa
  // kolom sekaligus. Versi pertama audit ini memakai spasi literal antar kata,
  // jadi bentuk berbaris-baris — yang justru dipakai di repo ini — terlewat
  // seluruhnya. Audit yang melewatkan justru bentuk yang paling sering dipakai
  // lebih berbahaya daripada tidak ada audit: ia memberi rasa aman palsu.
  for (const stmt of sql.matchAll(/alter table\s+([a-z_]+)([\s\S]*?);/gi)) {
    const tabel = stmt[1];
    for (const a of stmt[2].matchAll(/add column\s+(?:if not exists\s+)?([a-z_]+)/gi)) tambah(tabel, a[1]);
    for (const d of stmt[2].matchAll(/drop column\s+(?:if exists\s+)?([a-z_]+)/gi)) skema.get(tabel)?.delete(d[1]);
  }
}

// ---- 2. Periksa pemakaian di js/ ----
function daftarFile(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) daftarFile(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const PENYARING = /\.(eq|neq|gt|gte|lt|lte|is|like|ilike|in|order)\(\s*'([a-z_]+)'/g;

/**
 * Nama kolom POLOS di dalam sebuah string .select().
 *
 * Dipecah per koma di kedalaman 0 saja: `outlets!outlet_id(name)` punya koma di
 * dalam kurungnya pada kasus lain, dan memecahnya mentah-mentah akan
 * menghasilkan potongan seperti `full_name)` yang lalu dituduh sebagai kolom
 * yang tidak ada. Tuduhan palsu seperti itu yang membuat orang berhenti
 * menjalankan audit sama sekali.
 */
function kolomPolos(select) {
  const potongan = [];
  let dalam = 0;
  let kini = '';
  for (const c of select) {
    if (c === '(') dalam++;
    if (c === ')') dalam--;
    if (c === ',' && dalam === 0) {
      potongan.push(kini);
      kini = '';
    } else kini += c;
  }
  potongan.push(kini);
  // Hanya yang benar-benar berupa nama kolom. Sisanya (embed, alias, `*`,
  // penggantian nama, cast) sengaja dilewati.
  return potongan.map((p) => p.trim()).filter((p) => /^[a-z_][a-z0-9_]*$/.test(p));
}

let masalah = 0;
let diperiksa = 0;

for (const file of daftarFile(JS)) {
  const isi = fs.readFileSync(file, 'utf8');
  // Jendelanya harus muat SELURUH rantai. Dengan batas 600 karakter, select
  // panjang seperti `listReservations` terpotong di tengah — tanda kutip
  // penutupnya tidak pernah ketemu, jadi seluruh rantai itu diam-diam tidak
  // diperiksa sama sekali. Justru query terpanjang yang paling butuh diperiksa.
  for (const m of isi.matchAll(/\.from\('([a-z_]+)'\)([\s\S]{0,2000}?)(?=\n\s*(?:const|let|return|\}|export|async|function)|;\s*\n)/g)) {
    const tabel = m[1];
    const kolomTabel = skema.get(tabel);
    if (!kolomTabel) continue; // view / tabel dari luar migration -> lewati
    for (const u of m[2].matchAll(PENYARING)) {
      const kolom = u[2];
      diperiksa++;
      if (!kolomTabel.has(kolom)) {
        const baris = isi.slice(0, m.index + u.index).split('\n').length;
        console.error(`✗ ${path.relative(AKAR, file)}:${baris}`);
        console.error(`  .${u[1]}('${kolom}') pada tabel ${tabel} — kolom itu tidak ada di skema.`);
        masalah++;
      }
    }

    for (const sel of m[2].matchAll(/\.select\(\s*(['"`])([\s\S]*?)\1/g)) {
      for (const kolom of kolomPolos(sel[2])) {
        diperiksa++;
        if (!kolomTabel.has(kolom)) {
          const baris = isi.slice(0, m.index + sel.index).split('\n').length;
          console.error(`✗ ${path.relative(AKAR, file)}:${baris}`);
          console.error(`  .select() menyebut '${kolom}' pada tabel ${tabel} — kolom itu tidak ada di skema.`);
          masalah++;
        }
      }
    }
  }
}

if (masalah) {
  console.error(`\n${masalah} pemakaian kolom yang tidak ada. Query-nya akan gagal saat dijalankan.`);
  process.exit(1);
}
console.log(`${diperiksa} pemakaian kolom diperiksa terhadap ${skema.size} tabel. Semuanya ada di skema. ✅`);
