#!/usr/bin/env node
/**
 * Uji parser link YouTube.  Jalankan:  node tools/test-youtube-parser.mjs
 *
 * KENAPA ADA:
 * Admin akan menempel bentuk link yang berbeda-beda tergantung dari mana dia
 * menyalinnya — tombol Share di HP memberi youtu.be, address bar desktop
 * memberi watch?v=, dan Shorts memberi bentuk lain lagi. Kalau satu bentuk saja
 * gagal diurai, gejalanya bukan error yang jelas melainkan tombol Tutorial yang
 * tidak pernah muncul. Itu jenis kegagalan yang paling mahal untuk dilacak,
 * jadi lebih murah diuji di sini.
 *
 * Parser-nya di-copy dari tutorial.service.js supaya file uji ini bisa jalan di
 * Node tanpa menyeret supabase-client (yang butuh browser).
 */

const ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

function parseYoutubeId(input) {
  const teks = String(input ?? '').trim();
  if (!teks) return null;
  if (ID_PATTERN.test(teks)) return teks;

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(teks) ? teks : `https://${teks}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\.|^m\./i, '').toLowerCase();
  const bagian = url.pathname.split('/').filter(Boolean);

  let kandidat = null;
  if (host === 'youtu.be') {
    kandidat = bagian[0] ?? null;
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (bagian[0] === 'embed' || bagian[0] === 'shorts' || bagian[0] === 'live' || bagian[0] === 'v') {
      kandidat = bagian[1] ?? null;
    } else {
      kandidat = url.searchParams.get('v');
    }
  }
  return kandidat && ID_PATTERN.test(kandidat) ? kandidat : null;
}

const ID = 'dQw4w9WgXcQ';

const KASUS = [
  // --- yang HARUS berhasil ---
  ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', ID, 'desktop address bar'],
  ['https://youtube.com/watch?v=dQw4w9WgXcQ', ID, 'tanpa www'],
  ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', ID, 'YouTube mobile web'],
  ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s', ID, 'ada timestamp'],
  ['https://www.youtube.com/watch?app=desktop&v=dQw4w9WgXcQ', ID, 'v bukan parameter pertama'],
  ['https://youtu.be/dQw4w9WgXcQ', ID, 'tombol Share di HP'],
  ['https://youtu.be/dQw4w9WgXcQ?si=AbCdEf123', ID, 'Share + parameter pelacak'],
  ['https://www.youtube.com/embed/dQw4w9WgXcQ', ID, 'kode embed'],
  ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', ID, 'embed nocookie'],
  ['https://www.youtube.com/shorts/dQw4w9WgXcQ', ID, 'Shorts'],
  ['https://www.youtube.com/live/dQw4w9WgXcQ', ID, 'siaran langsung'],
  ['youtu.be/dQw4w9WgXcQ', ID, 'tanpa skema (sering terjadi saat menempel)'],
  ['  https://youtu.be/dQw4w9WgXcQ  ', ID, 'ada spasi di ujung'],
  ['dQw4w9WgXcQ', ID, 'admin menempel ID langsung'],
  ['https://WWW.YouTube.com/watch?v=dQw4w9WgXcQ', ID, 'host huruf besar'],

  // --- yang HARUS ditolak ---
  ['', null, 'kosong'],
  [null, null, 'null'],
  [undefined, null, 'undefined'],
  ['bukan link sama sekali', null, 'teks sembarang'],
  ['https://vimeo.com/123456789', null, 'platform lain'],
  ['https://www.youtube.com/', null, 'beranda YouTube tanpa video'],
  ['https://www.youtube.com/watch?v=terlalupendek', null, 'ID salah panjang'],
  ['https://www.youtube.com/@namachannel', null, 'halaman channel, bukan video'],
  ['https://www.youtube.com/playlist?list=PLabc123', null, 'playlist, bukan video'],
  ['https://evil.com/watch?v=dQw4w9WgXcQ', null, 'domain lain menyamar'],
  ['https://youtu.be.evil.com/dQw4w9WgXcQ', null, 'subdomain menipu'],
  ['javascript:alert(1)', null, 'percobaan skema berbahaya']
];

let gagal = 0;
for (const [input, harapan, catatan] of KASUS) {
  const hasil = parseYoutubeId(input);
  if (hasil !== harapan) {
    gagal++;
    console.error(`✗ ${catatan}`);
    console.error(`  input     : ${JSON.stringify(input)}`);
    console.error(`  diharapkan: ${JSON.stringify(harapan)}`);
    console.error(`  dihasilkan: ${JSON.stringify(hasil)}`);
  }
}

if (gagal) {
  console.error(`\n${gagal} dari ${KASUS.length} kasus gagal.`);
  process.exit(1);
}
console.log(`Parser link YouTube lolos ${KASUS.length} kasus (termasuk domain menipu). ✅`);
