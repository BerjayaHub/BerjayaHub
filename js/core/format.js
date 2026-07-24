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

/** "Rp1.000.000" */
export function formatRupiah(n) {
  return 'Rp' + formatThousands(Math.round(Number(n) || 0));
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
