/**
 * Menangkap pemakaian nama yang tidak pernah dideklarasikan atau diimpor.
 *
 * KENAPA AUDIT INI ADA. `sebabBahan()` pernah dipakai di
 * `product.admin.page.js` tanpa pernah diimpor. Berkasnya tetap SAH sebagai
 * ES module, jadi `audit-syntax` hijau; kesalahannya baru muncul saat baris
 * itu benar-benar dijalankan — yaitu tepat ketika orangnya mengetuk baris
 * produk untuk melihat bahannya. Gejalanya: panel bahan tidak muncul sama
 * sekali, tanpa pesan apa pun di layar.
 *
 * Itu kelas kesalahan yang paling mudah lolos di proyek tanpa build step:
 * tidak ada penyusun yang memeriksa, dan pengujian modul murni tidak
 * menyentuh berkas layar. Satu-satunya yang bisa menemukannya adalah
 * pemeriksaan seperti ini, atau seseorang yang kebetulan mengetuk baris itu.
 *
 * CARANYA sengaja konservatif: hanya melaporkan nama yang dipanggil sebagai
 * FUNGSI (`nama(`) dan tidak ditemukan sebagai impor, deklarasi, parameter,
 * atau nama bawaan. Audit yang mengejar semua rujukan akan penuh temuan palsu,
 * dan audit yang sering salah akan dimatikan orang — setelah itu ia tidak
 * menjaga apa pun.
 */

const fs = require('fs');
const path = require('path');

const AKAR = path.join(__dirname, '..', 'js');

const BAWAAN = new Set([
  'console','window','document','navigator','location','history','fetch','alert','confirm','prompt',
  'setTimeout','setInterval','clearTimeout','clearInterval','requestAnimationFrame','queueMicrotask',
  'Object','Array','String','Number','Boolean','Math','JSON','Date','Promise','Map','Set','WeakMap','WeakSet',
  'Error','TypeError','RangeError','RegExp','Symbol','BigInt','Proxy','Reflect','Intl',
  'parseInt','parseFloat','isNaN','isFinite','encodeURIComponent','decodeURIComponent','encodeURI','decodeURI',
  'URL','URLSearchParams','Blob','File','FileReader','FormData','Headers','Request','Response','AbortController',
  'Image','Audio','Event','CustomEvent','IntersectionObserver','MutationObserver','ResizeObserver',
  'localStorage','sessionStorage','crypto','structuredClone','atob','btoa','TextEncoder','TextDecoder',
  'Uint8Array','Int8Array','Float32Array','Float64Array','ArrayBuffer','DataView',
  'super','this','typeof','void','import','require','module','exports','globalThis','self','process',
  'if','for','while','switch','catch','return','function','class','new','delete','await','yield','do','else','try','finally','case','of','in',
  // Kata kunci yang di depan tanda kurung terlihat persis seperti panggilan
  // fungsi. `async (x) => …` bukan pemanggilan `async()`.
  'async','not','and','or','instanceof'
]);

/** Nama yang "ada" di sebuah berkas: impor, deklarasi, parameter, label. */
function namaTersedia(src) {
  const ada = new Set();
  const tambah = (s) => {
    for (const bagian of String(s).split(/[,{}\[\]\s]+/)) {
      const n = bagian.trim().replace(/^\.\.\./, '').split(':').pop().split('=')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n)) ada.add(n);
    }
  };

  // import ... from '...'
  for (const m of src.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]/g)) tambah(m[1]);
  // const/let/var/function/class
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([\s\S]{0,200}?)=/g)) tambah(m[1]);
  for (const m of src.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g)) ada.add(m[1]);
  for (const m of src.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) ada.add(m[1]);
  // parameter fungsi & arrow — diambil kasar, memang sengaja longgar
  for (const m of src.matchAll(/\(([^()]{0,400})\)\s*(?:=>|\{)/g)) tambah(m[1]);
  for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) ada.add(m[1]);
  // catch (e)
  for (const m of src.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g)) ada.add(m[1]);
  return ada;
}


/**
 * Membuang komentar & teks dengan PEMINDAI KARAKTER, bukan regex.
 *
 * Versi regex-nya salah untuk dua hal yang justru banyak di berkas ini:
 * template literal BERSARANG (`${`...`}`) dan tanda kutip di dalam kalimat
 * bahasa Indonesia di komentar. Akibatnya kata-kata biasa — "dihitung(",
 * "Catatan(", "tengah(" — bocor keluar sebagai panggilan fungsi palsu. Enam
 * belas temuan palsu sudah cukup untuk membuat audit ini diabaikan, dan audit
 * yang diabaikan tidak menjaga apa pun.
 *
 * Teks yang dibuang diganti spasi, bukan dihapus, supaya nomor barisnya tetap.
 */
function buangKomentarDanTeks(src) {
  let keluar = '';
  let i = 0;
  const n = src.length;
  // Tumpukan untuk `${ }` di dalam template literal: tiap kali masuk ekspresi,
  // isinya adalah KODE lagi dan harus tetap diperiksa.
  const tumpukan = [];
  let mode = 'kode';
  let kurung = 0;

  const spasi = (teks) => teks.replace(/[^\n]/g, ' ');

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];

    if (mode === 'kode') {
      if (c === '/' && d === '/') {
        const akhir = src.indexOf('\n', i);
        const potong = akhir === -1 ? src.slice(i) : src.slice(i, akhir);
        keluar += spasi(potong);
        i += potong.length;
        continue;
      }
      if (c === '/' && d === '*') {
        const akhir = src.indexOf('*/', i + 2);
        const potong = akhir === -1 ? src.slice(i) : src.slice(i, akhir + 2);
        keluar += spasi(potong);
        i += potong.length;
        continue;
      }
      if (c === "'" || c === '"') {
        mode = c;
        keluar += ' ';
        i++;
        continue;
      }
      if (c === '`') {
        mode = '`';
        keluar += ' ';
        i++;
        continue;
      }
      if (c === '}' && tumpukan.length && kurung === 0) {
        mode = '`';
        kurung = tumpukan.pop();
        keluar += ' ';
        i++;
        continue;
      }
      // LITERAL REGEX. `/\B(?=(\d{3})+)/` memuat "B(" dan "d(" yang terlihat
      // persis seperti panggilan fungsi. Dibedakan dari operator bagi lewat
      // karakter bermakna terakhir sebelumnya: sesudah nilai (`)`, `]`, atau
      // nama) sebuah `/` berarti BAGI; di posisi lain ia awal regex.
      if (c === '/') {
        const sblm = keluar.replace(/\s+$/, '').slice(-1);
        const bagi = sblm && /[\w$)\]]/.test(sblm);
        if (!bagi) {
          let j = i + 1;
          let dalamKelas = false;
          while (j < n) {
            const e = src[j];
            if (e === '\\') { j += 2; continue; }
            if (e === '\n') break; // regex tidak boleh lintas baris -> bukan regex
            if (e === '[') dalamKelas = true;
            else if (e === ']') dalamKelas = false;
            else if (e === '/' && !dalamKelas) { j++; break; }
            j++;
          }
          if (j <= n && src[j - 1] === '/') {
            while (j < n && /[a-z]/.test(src[j])) j++; // bendera: g, i, m, s, u, y
            keluar += spasi(src.slice(i, j));
            i = j;
            continue;
          }
        }
      }
      if (c === '{') kurung++;
      else if (c === '}') kurung--;
      keluar += c;
      i++;
      continue;
    }

    // Di dalam teks
    if (c === '\\') {
      keluar += c === '\n' ? '\n' : '  ';
      i += 2;
      continue;
    }
    if (mode === '`' && c === '$' && d === '{') {
      tumpukan.push(kurung);
      kurung = 0;
      mode = 'kode';
      keluar += '  ';
      i += 2;
      continue;
    }
    if (c === mode) {
      mode = 'kode';
      keluar += ' ';
      i++;
      continue;
    }
    keluar += c === '\n' ? '\n' : ' ';
    i++;
  }
  return keluar;
}

function berkasJs(dir, keluar = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) berkasJs(p, keluar);
    else if (e.name.endsWith('.js')) keluar.push(p);
  }
  return keluar;
}

let temuan = 0;
let diperiksa = 0;

for (const berkas of berkasJs(AKAR)) {
  const src = fs.readFileSync(berkas, 'utf8');
  const ada = namaTersedia(src);

  const bersih = buangKomentarDanTeks(src);

  const dilihat = new Set();
  for (const m of bersih.matchAll(/(^|[^\w$.?])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const nama = m[2];
    if (BAWAAN.has(nama) || ada.has(nama) || dilihat.has(nama)) continue;
    dilihat.add(nama);
    temuan++;
    // Panjang `bersih` sama persis dengan `src` (teks diganti spasi, bukan
    // dihapus), jadi indeksnya bisa dipakai langsung. Versi sebelumnya mencari
    // ulang namanya di sumber asli dan menunjuk ke kemunculan PERTAMA di mana
    // pun — termasuk di dalam komentar, yaitu tempat yang justru sedang dibuang.
    const baris = bersih.slice(0, m.index).split('\n').length;
    console.error(`❌ ${path.relative(path.join(__dirname, '..'), berkas)}:${baris} — "${nama}()" dipakai tapi tidak diimpor / dideklarasikan`);
  }
  diperiksa++;
}

if (temuan) {
  console.error(`\n${temuan} nama tidak dikenal. Ini gagal saat DIJALANKAN, bukan saat dimuat — jadi tidak akan tertangkap audit sintaks.`);
  process.exit(1);
}
console.log(`${diperiksa} berkas diperiksa. Semua fungsi yang dipanggil punya asal-usul. ✅`);
