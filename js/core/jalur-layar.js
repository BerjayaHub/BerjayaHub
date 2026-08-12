/**
 * Jalur layar: "di mana persisnya orang ini berada di dalam sebuah modul".
 *
 * Satu menu Admin Portal bisa punya DUA lapis tab. "Inventory" adalah grup
 * berisi tab Master Produk / Menu / Produksi; dan Master Produk sendiri punya
 * tab Produk / Resep / Satuan. Menyimpan satu nama layar saja tidak cukup —
 * "resep" tidak berarti apa-apa tanpa tahu ia ada di dalam Master Produk.
 *
 * Karena itu tempatnya disimpan sebagai JALUR: `master_product/recipes`. Tiap
 * lapis hanya mengurus potongannya sendiri dan meneruskan sisanya ke bawah,
 * jadi menambah lapis ketiga nanti tidak menyentuh lapis yang sudah ada.
 *
 * Tidak ada impor di file ini, supaya bisa diuji tanpa browser.
 */

const BATAS = '/';

/** Potongan pertama — milik lapis ini. `null` kalau tidak ada. */
export function kepala(jalur) {
  const s = String(jalur ?? '').trim();
  if (!s) return null;
  const i = s.indexOf(BATAS);
  const k = (i === -1 ? s : s.slice(0, i)).trim();
  return k || null;
}

/** Sisanya — diteruskan ke lapis di bawahnya. `null` kalau habis. */
export function ekor(jalur) {
  const s = String(jalur ?? '').trim();
  const i = s.indexOf(BATAS);
  if (i === -1) return null;
  const sisa = s.slice(i + 1).trim();
  return sisa || null;
}

/**
 * Menyambung potongan jadi jalur. Yang kosong dibuang, bukan dijadikan
 * potongan kosong — `gabung('master_product', null)` harus menghasilkan
 * `master_product`, bukan `master_product/`, supaya `kepala()` di lapis bawah
 * tidak menerima string kosong yang tidak berarti apa-apa.
 */
export function gabung(...bagian) {
  return bagian
    .map((b) => String(b ?? '').trim())
    .filter(Boolean)
    .join(BATAS);
}
