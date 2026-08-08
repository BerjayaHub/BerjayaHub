// Uji lapisan tombol Back.
//
// Sebelum ini aplikasi tidak menyentuh History API sama sekali, jadi Back —
// gerakan paling refleks di HP — KELUAR dari aplikasi. Yang sedang diisi
// hilang, tanpa konfirmasi apa pun.
class HistoryPalsu {
  constructor() { this.entri = ['akar']; }
  pushState(s) { this.entri.push(s?.berjaya ?? 'x'); }
  back() { if (this.entri.length > 1) { this.entri.pop(); return true; } return false; }
  get dalam() { return this.entri.length - 1; }
}

function buatNavigasi(h) {
  const tumpukan = [];
  return {
    dorong(nama, kembali) {
      const lapis = { nama, kembali };
      tumpukan.push(lapis);
      h.pushState({ berjaya: nama });
      return () => {
        const i = tumpukan.lastIndexOf(lapis);
        if (i === -1) return;
        tumpukan.splice(i, 1);
        h.back();
      };
    },
    /** @returns {'lapis'|'keluar'} */
    back() {
      const keluarDariBrowser = !h.back();
      const lapis = tumpukan.pop();
      if (!lapis) return keluarDariBrowser ? 'keluar' : 'keluar';
      lapis.kembali();
      return 'lapis';
    },
    bersihkan() { tumpukan.length = 0; },
    get dalam() { return tumpukan.length; }
  };
}

let gagal = 0;
const cek = (ok, ket) => { console.log(`${ok ? '✓' : '✗'} ${ket}`); if (!ok) gagal++; };

// Skenario 1: Beranda -> modul -> Back -> Beranda (bukan keluar aplikasi).
let h = new HistoryPalsu(); let nav = buatNavigasi(h);
let layar = 'beranda';
nav.dorong('modul:kas', () => (layar = 'beranda'));
layar = 'kas';
cek(nav.back() === 'lapis' && layar === 'beranda', 'modul -> Back -> kembali ke Beranda');
cek(nav.dalam === 0, 'tumpukan kosong setelah kembali ke Beranda');
cek(nav.back() === 'keluar', 'di Beranda, Back berikutnya memang keluar aplikasi');

// Skenario 2: dialog di dalam modul -> Back menutup dialog, TIDAK keluar modul.
h = new HistoryPalsu(); nav = buatNavigasi(h);
layar = 'beranda';
nav.dorong('modul:kas', () => (layar = 'beranda'));
layar = 'kas';
let dialog = 'terbuka';
nav.dorong('form', () => (dialog = 'tertutup'));
cek(nav.back() === 'lapis' && dialog === 'tertutup' && layar === 'kas', 'dialog -> Back menutup dialog, tetap di modul');
cek(nav.back() === 'lapis' && layar === 'beranda', 'Back lagi -> baru kembali ke Beranda');

// Skenario 3: dialog ditutup lewat tombol Batal -> lapis TIDAK boleh tertinggal.
h = new HistoryPalsu(); nav = buatNavigasi(h);
layar = 'beranda';
nav.dorong('modul:kas', () => (layar = 'beranda'));
layar = 'kas';
const lepas = nav.dorong('form', () => (dialog = 'tertutup'));
lepas(); // ditutup lewat tombol
cek(nav.dalam === 1, 'tutup lewat tombol membuang lapisnya, tidak jadi lapis hantu');
cek(nav.back() === 'lapis' && layar === 'beranda', 'Back setelah itu langsung ke Beranda, bukan "tidak terjadi apa-apa"');

// Skenario 4: pindah ke Beranda lewat tombol Home -> tumpukan dibersihkan.
h = new HistoryPalsu(); nav = buatNavigasi(h);
nav.dorong('modul:a', () => {});
nav.dorong('form', () => {});
nav.bersihkan();
cek(nav.dalam === 0, 'tombol Beranda mengosongkan tumpukan');
cek(nav.back() === 'keluar', 'setelah itu Back berarti keluar, bukan melompat ke lapis basi');

if (gagal) { console.error(`\n${gagal} perilaku Back salah.`); process.exit(1); }
console.log('\nPerilaku tombol Back benar untuk 9 kasus. ✅');

// ---- Penjaga isian belum tersimpan ----
//
// Heuristiknya sengaja miring ke satu sisi: boleh bertanya walau tidak perlu,
// tapi tidak boleh diam saat isian benar-benar akan hilang. Pertanyaan berlebih
// hanya mengganggu; isian yang hilang tidak bisa dibatalkan.
{
  let gagal2 = 0;
  const cek2 = (ok, ket) => { console.log(`${ok ? '✓' : '✗'} ${ket}`); if (!ok) gagal2++; };

  function buatPenjaga() {
    let adaIsian = false;
    let layar = 'modul';
    return {
      ketik() { adaIsian = true; },
      simpanSukses() { adaIsian = false; },
      bukaModul() { adaIsian = false; layar = 'modul'; },
      /** @param {boolean} jawabTinggalkan */
      back(jawabTinggalkan) {
        if (adaIsian) {
          if (!jawabTinggalkan) return 'tetap';
          adaIsian = false;
        }
        layar = 'beranda';
        return 'keluar';
      },
      get layar() { return layar; }
    };
  }

  let g = buatPenjaga();
  cek2(g.back(true) === 'keluar', 'tanpa isian -> Back langsung ke Beranda, tanpa ditanya');

  g = buatPenjaga(); g.ketik();
  cek2(g.back(false) === 'tetap' && g.layar === 'modul', 'ada isian + pilih "Lanjut mengisi" -> tetap di modul');
  cek2(g.back(true) === 'keluar', 'ditanya lagi, pilih "Tinggalkan" -> baru keluar');

  g = buatPenjaga(); g.ketik(); g.simpanSukses();
  cek2(g.back(false) === 'keluar', 'setelah tersimpan (toast sukses) -> tidak ditanya lagi');

  g = buatPenjaga(); g.ketik(); g.bukaModul();
  cek2(g.back(false) === 'keluar', 'buka modul lain mereset tandanya');

  if (gagal2) { console.error(`\n${gagal2} perilaku penjaga isian salah.`); process.exit(1); }
  console.log('Penjaga isian belum tersimpan benar untuk 5 kasus. ✅');
}
