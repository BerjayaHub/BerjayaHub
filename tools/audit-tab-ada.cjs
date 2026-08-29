/**
 * AUDIT: tab yang ditunjuk kode harus ADA di setiap peran.
 *
 * ============ BUG YANG MELAHIRKAN AUDIT INI ============
 *
 * Di modul Pengiriman, `tabsFor()` mengembalikan dua daftar tab yang berbeda:
 *
 *     return isCK
 *       ? [ ..., { key: 'drafts', ... }, ... ]     // Central Kitchen
 *       : [ { key: 'order' }, { key: 'transfer' } ] // outlet biasa  <- tanpa 'drafts'
 *
 * Sementara tombol "Kirim & Buat Surat Jalan" — yang dipakai KEDUA peran —
 * menutup pekerjaannya dengan:
 *
 *     state.tab = 'drafts';
 *     buildTabs();
 *
 * Untuk outlet biasa, `buildTabs()` tidak menemukan 'drafts' lalu melempar
 * balik ke tab pertama. Tidak ada error. Tidak ada pesan. Staff melihat toast
 * "Draft dibuat, kirim dari tab Draft", mendarat di layar yang sama sekali
 * lain, dan drafnya tidak muncul di mana pun. Barang yang sudah diserahkan
 * secara fisik tetap tercatat di outlet asal.
 *
 * ============ KENAPA PEMERIKSAAN NAIF TIDAK CUKUP ============
 *
 * Audit yang sekadar bertanya "apakah 'drafts' ada di file ini?" akan
 * **HIJAU** untuk bug di atas — karena 'drafts' MEMANG ada, di cabang yang
 * satunya. Itulah yang membuat kegagalan ini bisa lolos: dari kejauhan
 * semuanya tampak lengkap.
 *
 * Jadi audit ini membandingkan CABANG PER CABANG. Sebuah kunci tab yang
 * ditunjuk `state.tab = '...'` harus ada di SEMUA cabang, bukan di salah
 * satunya.
 */
const fs = require('fs');
const path = require('path');

const AKAR = path.dirname(__dirname);
let gagal = 0;
const salah = (pesan) => {
  gagal++;
  console.error(`❌ ${pesan}`);
};

function semuaJs(dir, keluar = []) {
  for (const nama of fs.readdirSync(path.join(AKAR, dir))) {
    const rel = `${dir}/${nama}`;
    if (fs.statSync(path.join(AKAR, rel)).isDirectory()) semuaJs(rel, keluar);
    else if (nama.endsWith('.js')) keluar.push(rel);
  }
  return keluar;
}

/**
 * Ambil isi sebuah array literal yang dimulai di `mulai` (indeks `[`).
 *
 * Dihitung dengan menghitung kurung, bukan regex: daftar tab berisi objek
 * bersarang dan template literal, dan pencocokan sampai `]` pertama akan
 * berhenti di tengah objek lalu melaporkan kunci yang tidak lengkap — audit
 * yang salah membaca lebih buruk daripada tidak ada audit, karena ia
 * menghasilkan keluhan palsu yang lama-lama diabaikan.
 */
function isiArray(teks, mulai) {
  let dalam = 0;
  for (let i = mulai; i < teks.length; i++) {
    const c = teks[i];
    if (c === '[') dalam++;
    else if (c === ']') {
      dalam--;
      if (dalam === 0) return teks.slice(mulai + 1, i);
    }
  }
  return null;
}

const kunciDari = (potongan) => [...potongan.matchAll(/\{\s*key:\s*'([^']+)'/g)].map((m) => m[1]);

for (const rel of semuaJs('js')) {
  const isi = fs.readFileSync(path.join(AKAR, rel), 'utf8');

  // Hanya berkas yang benar-benar memindahkan tab lewat penetapan literal.
  const diminta = [...isi.matchAll(/state\.tab\s*=\s*'([^']+)'/g)].map((m) => ({
    kunci: m[1],
    baris: isi.slice(0, m.index).split('\n').length
  }));
  if (!diminta.length) continue;

  // Kumpulkan tiap array literal yang isinya memang daftar tab (punya `key:`
  // sekaligus `render:` — dua-duanya, supaya array lain yang kebetulan punya
  // `key` tidak ikut terseret).
  const cabang = [];
  for (let i = 0; i < isi.length; i++) {
    if (isi[i] !== '[') continue;
    const dalam = isiArray(isi, i);
    if (dalam == null) continue;
    if (!/\bkey:\s*'/.test(dalam) || !/\brender:/.test(dalam)) continue;
    cabang.push({ kunci: kunciDari(dalam), baris: isi.slice(0, i).split('\n').length });
    i += dalam.length; // jangan menghitung ulang array bersarang di dalamnya
  }

  if (!cabang.length) {
    salah(
      `${rel}: ada \`state.tab = '...'\` tapi tidak ditemukan satu pun daftar tab. ` +
        'Audit ini kehilangan sasarannya, jadi ia dilaporkan gagal daripada diam-diam lolos.'
    );
    continue;
  }

  for (const { kunci, baris } of diminta) {
    const adaDi = cabang.filter((c) => c.kunci.includes(kunci));

    if (!adaDi.length) {
      salah(
        `${rel}:${baris}: \`state.tab = '${kunci}'\` menunjuk tab yang TIDAK ADA di daftar mana pun. ` +
          `Kunci yang tersedia: ${[...new Set(cabang.flatMap((c) => c.kunci))].join(', ')}.`
      );
      continue;
    }

    if (adaDi.length < cabang.length) {
      const kurang = cabang.filter((c) => !c.kunci.includes(kunci));
      salah(
        `${rel}:${baris}: \`state.tab = '${kunci}'\` hanya ada di sebagian daftar tab. ` +
          `Hilang di daftar yang dimulai baris ${kurang.map((c) => c.baris).join(', ')} ` +
          `(isinya: ${kurang.map((c) => c.kunci.join('/')).join(' | ')}). ` +
          'Untuk peran yang memakai daftar itu, perpindahan tabnya akan dibuang tanpa error — ' +
          'layarnya pindah ke tempat lain dan pekerjaannya tidak pernah selesai.'
      );
    }
  }
}

if (gagal === 0) {
  console.log('Tab: setiap `state.tab = ...` menunjuk tab yang ada di SEMUA cabang peran. ✅');
}
process.exit(gagal === 0 ? 0 : 1);
