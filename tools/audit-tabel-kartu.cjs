/**
 * Menjaga tabel yang berubah jadi KARTU di layar sempit tetap utuh labelnya.
 *
 * CARANYA BEKERJA: di layar ≤560px, tabel ber-kelas `kartu-sempit` menumpuk
 * barisnya jadi kartu dan menampilkan judul kolom di kiri tiap nilai —
 * judul itu diambil dari atribut `data-label` pada selnya sendiri, karena
 * `<thead>` sudah disembunyikan.
 *
 * KENAPA HARUS DIPERIKSA MESIN: sel yang lupa diberi `data-label` tidak
 * menghasilkan error apa pun. Ia cuma muncul sebagai angka telanjang tanpa
 * keterangan, di tengah kartu yang sel-sel lainnya berlabel rapi — dan justru
 * itu lebih membingungkan daripada tabel yang sama sekali tidak punya label,
 * karena pembacanya menganggap label yang hilang itu berarti sesuatu.
 *
 * Ini gampang sekali terjadi: baris tabel di modul ini sering dirender oleh
 * fungsi pembantu di luar blok `<table>`-nya, jadi penambahan label yang
 * dikerjakan "di sekitar tabel" akan melewatkannya.
 *
 * YANG DIKECUALIKAN:
 *   - `colspan` — sel yang membentang penuh (mis. "Belum ada data") memang
 *     tidak punya kolom sendiri untuk dinamai.
 *   - `<td>` di berkas yang tidak memakai `kartu-sempit` sama sekali.
 */

const fs = require('fs');
const path = require('path');

const AKAR = path.join(__dirname, '..', 'js');

function berkasJs(dir, keluar = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) berkasJs(p, keluar);
    else if (e.name.endsWith('.js')) keluar.push(p);
  }
  return keluar;
}

let temuan = 0;
let berkasDiperiksa = 0;
let selBerlabel = 0;

for (const berkas of berkasJs(AKAR)) {
  const src = fs.readFileSync(berkas, 'utf8');
  if (!src.includes('kartu-sempit')) continue;
  berkasDiperiksa++;
  const rel = path.relative(path.join(__dirname, '..'), berkas);

  for (const m of src.matchAll(/<td\b[^>]*>/g)) {
    const tag = m[0];
    if (/data-label=/.test(tag)) {
      selBerlabel++;
      continue;
    }
    if (/colspan=/.test(tag)) continue;
    temuan++;
    const baris = src.slice(0, m.index).split('\n').length;
    console.error(`❌ ${rel}:${baris} — <td> tanpa data-label di berkas yang memakai kartu-sempit. Di HP sel ini muncul tanpa keterangan.`);
  }
}

if (temuan) {
  console.error(`\n${temuan} sel tanpa label. Tidak menimbulkan error — hanya angka telanjang di tengah kartu yang sel lainnya berlabel.`);
  process.exit(1);
}
console.log(`${berkasDiperiksa} berkas memakai tabel-kartu; ${selBerlabel} sel semuanya berlabel. ✅`);
