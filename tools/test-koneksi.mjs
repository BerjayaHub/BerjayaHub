// Uji logika penanda koneksi.
//
// Yang diuji bukan tampilannya, tapi KAPAN tandanya menyala — dan terutama
// kapan ia TIDAK boleh menyala. Penanda offline yang muncul saat masalahnya
// sebenarnya izin (403) akan membuat orang mencari sinyal selama sepuluh menit
// untuk masalah yang tidak ada hubungannya dengan sinyal.
function buatPemantau() {
  let offline = false;
  return {
    get offline() { return offline; },
    /** Meniru fetchTerpantau: hasil apa pun dari server = jaringan hidup. */
    async minta(hasil) {
      if (hasil === 'gagal-jaringan') { offline = true; throw new TypeError('Failed to fetch'); }
      offline = false;              // 200, 403, 500 — semuanya sampai ke server
      return hasil;
    },
    peristiwaOffline() { offline = true; }
  };
}

let gagal = 0;
const cek = (ok, ket) => { console.log(`${ok ? '✓' : '✗'} ${ket}`); if (!ok) gagal++; };

const p = buatPemantau();
await p.minta(200);
cek(p.offline === false, 'permintaan berhasil -> tidak ada penanda');

try { await p.minta('gagal-jaringan'); } catch { /* diharapkan */ }
cek(p.offline === true, 'fetch gagal total -> penanda offline menyala');

await p.minta(200);
cek(p.offline === false, 'permintaan berikutnya berhasil -> penanda dilepas');

// 403 dan 500 BUKAN masalah koneksi.
try { await p.minta('gagal-jaringan'); } catch {}
await p.minta(403);
cek(p.offline === false, 'balasan 403 melepas penanda — servernya jelas terjangkau');
try { await p.minta('gagal-jaringan'); } catch {}
await p.minta(500);
cek(p.offline === false, 'balasan 500 juga: error server, bukan error koneksi');

// Peristiwa `offline` bawaan browser dipercaya untuk MENYALAKAN...
const q = buatPemantau();
q.peristiwaOffline();
cek(q.offline === true, 'mode pesawat -> menyala seketika tanpa menunggu permintaan gagal');
// ...tapi hanya permintaan yang benar-benar berhasil yang boleh MEMATIKAN.
await q.minta(200);
cek(q.offline === false, 'baru dilepas setelah ada permintaan yang sungguh berhasil');

if (gagal) { console.error(`\n${gagal} perilaku penanda koneksi salah.`); process.exit(1); }
console.log('\nPenanda koneksi benar untuk 7 kasus. ✅');
