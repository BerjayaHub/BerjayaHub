// =========================================================
// Format angka gaya Indonesia — dipakai di seluruh app supaya konsisten.
// Ribuan pakai titik (1.000.000), uang diawali "Rp".
// =========================================================

/** "1000000" / 1000000 -> "1.000.000". Hanya angka bulat (buang non-digit). */
export function formatThousands(value) {
  if (value === '' || value == null) return '';
  const digits = String(value).replace(/[^\d]/g, '');
  if (digits === '') return '';
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Angka gaya Indonesia untuk TAMPILAN (ribuan titik, desimal koma): 1.500,5 */
export function formatNum(n, maxDecimals = 2) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '0';
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: maxDecimals }).format(num);
}

/** "Rp1.000.000" */
export function formatRupiah(n) {
  return 'Rp' + new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0));
}

/** "1.000.000" atau teks apa pun -> 1000000 (integer). */
export function parseNumber(str) {
  const digits = String(str ?? '').replace(/[^\d]/g, '');
  return digits === '' ? 0 : parseInt(digits, 10);
}

/** Pasang auto-format ribuan pada sebuah <input> teks (live saat mengetik). */
export function attachThousandsInput(input) {
  if (!input) return;
  const reformat = () => {
    const fromEnd = input.value.length - (input.selectionStart ?? input.value.length);
    input.value = formatThousands(input.value);
    const pos = Math.max(0, input.value.length - fromEnd);
    try {
      input.setSelectionRange(pos, pos);
    } catch {
      // beberapa tipe input tidak mendukung setSelectionRange -> abaikan
    }
  };
  input.addEventListener('input', reformat);
  reformat();
}

// =========================================================
// RUPIAH YANG BOLEH PECAHAN
//
// `formatThousands` di atas MEMBUANG semua non-digit, jadi ia hanya cocok untuk
// rupiah bulat (harga jual menu, nominal kas). Harga bahan per satuan-pakai
// tidak begitu: beras Rp12/gram, tapi cabai bisa Rp13,80/gram — dan memaksanya
// bulat berarti tiap harga dibulatkan diam-diam sebelum sempat tersimpan.
//
// Karena itu ada pasangan sendiri di bawah. Ia mempertahankan SATU koma sebagai
// pemisah desimal (cara Indonesia menulisnya) sementara bagian bulatnya tetap
// diberi titik ribuan.
// =========================================================

/**
 * Format saat mengetik: `13800` -> `13.800`, `13800,5` -> `13.800,5`.
 *
 * Koma yang baru diketik (`13,`) SENGAJA dipertahankan apa adanya. Membuangnya
 * karena "belum ada angka di belakangnya" membuat koma mustahil diketik — tiap
 * kali ditekan, ia lenyap sebelum digit berikutnya sempat masuk.
 */
export function formatRibuanDesimal(value) {
  if (value === '' || value == null) return '';
  const teks = String(value);
  // Koma PERTAMA yang menentukan; sisanya dibuang. Tanpa ini, "1,2,3" lolos ke
  // parser dan menghasilkan angka yang tidak bisa ditebak siapa pun.
  const [bulatMentah, ...ekor] = teks.split(',');
  const bulat = bulatMentah.replace(/[^\d]/g, '');
  const desimal = ekor.join('').replace(/[^\d]/g, '');
  const adaKoma = teks.includes(',');
  const bulatRapi = bulat === '' ? '' : bulat.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  if (!adaKoma) return bulatRapi;
  return `${bulatRapi}${','}${desimal}`;
}

/**
 * Kebalikannya: `"13.800,5"` -> `13800.5`. Kosong -> `null`, BUKAN 0.
 *
 * `null` dan `0` HARUS dibedakan di sini. Harga yang belum diisi bukan harga
 * nol: nol berarti barangnya gratis, dan itu ikut menimbang biaya rata-rata
 * bahan. `Number('')` yang menghasilkan 0 sudah beberapa kali menggigit di repo
 * ini — di sini akibatnya menyebar sampai ke pembanding HPP.
 */
export function bacaRupiah(teks) {
  if (teks == null) return null;
  const s = String(teks).trim();
  if (s === '') return null;
  const [bulat, ...ekor] = s.split(',');
  const b = bulat.replace(/[^\d]/g, '');
  const d = ekor.join('').replace(/[^\d]/g, '');
  if (b === '' && d === '') return null;
  const n = Number(`${b || '0'}.${d || '0'}`);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pasang auto-format Rupiah (ribuan + desimal koma) pada sebuah <input> teks.
 *
 * Posisi kursor dijaga dari BELAKANG, bukan dari depan: menambahkan titik
 * ribuan menggeser seluruh teks ke kanan, dan kursor yang dipatok dari depan
 * akan melompat mundur satu karakter tiap kali ribuan baru terbentuk — persis
 * di tengah pengetikan angka besar.
 */
export function attachRupiahInput(input) {
  if (!input) return;
  const rapikan = () => {
    const dariBelakang = input.value.length - (input.selectionStart ?? input.value.length);
    input.value = formatRibuanDesimal(input.value);
    const pos = Math.max(0, input.value.length - dariBelakang);
    try {
      input.setSelectionRange(pos, pos);
    } catch {
      // beberapa tipe input tidak mendukung setSelectionRange -> abaikan
    }
  };
  input.addEventListener('input', rapikan);
  rapikan();
}
