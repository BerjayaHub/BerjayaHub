/**
 * Ekspor nota penerimaan Berjaya Hub ke template **ESB Simple Purchase**.
 *
 * Tujuannya satu: berhenti mengetik dua kali. Berjaya Hub jadi tempat input,
 * lalu Admin Portal mengunduh berkas yang bentuknya persis diterima ESB.
 *
 * ============ BENTUK TEMPLATENYA ============
 *
 * Satu sheet datar, header di BARIS 1, 25 kolom. Tidak ada judul di atasnya —
 * ESB membaca baris pertama sebagai nama kolom, jadi satu baris judul saja
 * membuat seluruh berkas ditolak.
 *
 * `Sequence` mengelompokkan beberapa baris jadi SATU dokumen pembelian: semua
 * baris satu nota memakai angka yang sama, dan kolom kepala (Supplier, Date,
 * Branch, …) diulang di tiap barisnya.
 *
 * `Type` membedakan `Item` (punya Unit/Qty/Price) dari `Cost` (kolom Item diisi
 * nomor COA, tanpa qty). Berjaya Hub hanya mengekspor `Item` — biaya non-barang
 * tidak pernah masuk nota penerimaan di sini.
 *
 * ============ HARGA: PER SATUAN ============
 *
 * ESB membaca `Price` sebagai harga PER SATUAN. Berjaya Hub menyimpan keduanya
 * sejak 0123 (`line_total` yang diketik orang, `unit_cost` turunannya), jadi
 * yang dikirim `unit_cost`.
 *
 * Beras 5.000 gr seharga Rp180.000 berangkat sebagai Qty 5000, Price 36 —
 * bukan Price 180.000. Salah pilih di sini menggandakan seluruh nilai pembelian
 * sebesar qty-nya, dan angkanya tetap terlihat seperti angka. Persis kesalahan
 * yang melahirkan migration 0123 dan 0124.
 *
 * ============ YANG BELUM TERPETAKAN DITOLAK, BUKAN DIKOSONGKAN ============
 *
 * Branch, Location, Payment Method, COA, satuan, dan nama item harus cocok
 * dengan master DI DALAM ESB — dan nama di Berjaya Hub diketik sendiri. Sel
 * yang dikosongkan karena belum dipetakan akan ditolak ESB jauh belakangan,
 * atau lebih buruk: diterima sebagai data baru yang salah.
 *
 * Maka fungsi ini mengembalikan `kurang`: daftar yang belum punya padanan,
 * lengkap dengan nota mana yang terpengaruh. Layarnya wajib menampilkan itu dan
 * menolak mengunduh — bukan mengunduh berkas yang separuh kosong.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa Excel maupun browser.
 */

/**
 * Header template ESB, **berurutan**. Nama & urutannya harus persis.
 *
 * Ditulis sebagai satu daftar supaya ada satu sumber kebenaran: baris data
 * dibangun dari daftar ini juga, jadi kolom yang ditambah/dipindah tidak bisa
 * membuat data bergeser satu kolom tanpa ketahuan.
 */
export const KOLOM_ESB = [
  'Sequence',
  'Supplier',
  'Date',
  'Branch',
  'Location',
  'Payment Method',
  'COANo',
  'Cost Center',
  'Project',
  'Credit Term',
  'Supplier Invoice Number',
  'Currency',
  'Rate',
  'Type',
  'Item',
  'Unit',
  'Qty',
  'Price',
  'Disc',
  'Vat',
  'Other Tax',
  'Tax Rate',
  'Amount',
  'Notes',
  'Additional Info'
];

/** Jenis pemetaan yang dikenal. Dipakai layar pengaturan & pemeriksaan. */
export const JENIS_PETA = ['branch', 'location', 'payment_method', 'coa', 'unit', 'item'];

const teks = (v) => (v === null || v === undefined ? '' : String(v).trim());
const angka = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Cari padanan ESB untuk sebuah nilai lokal.
 *
 * Kuncinya dibandingkan tanpa membedakan huruf besar-kecil dan spasi tepi:
 * "Gerobak Telur" dan "gerobak telur " adalah satu supplier yang sama, dan
 * memaksa admin memetakan keduanya cuma menambah pekerjaan yang tidak
 * mengubah hasil apa pun.
 *
 * @param {Map<string, string>} peta kunci sudah dinormalkan (lihat `buatPeta`)
 */
function padanan(peta, nilai) {
  const k = teks(nilai).toLowerCase();
  if (!k) return null;
  return peta?.get(k) ?? null;
}

/**
 * Susun peta dari baris `esb_map` jadi Map per jenis.
 *
 * @param {{jenis: string, kunci: string, nilai: string}[]} baris
 * @returns {Record<string, Map<string, string>>}
 */
export function buatPeta(baris) {
  const hasil = {};
  for (const j of JENIS_PETA) hasil[j] = new Map();
  for (const b of Array.isArray(baris) ? baris : []) {
    const j = teks(b?.jenis);
    if (!hasil[j]) continue;
    const k = teks(b?.kunci).toLowerCase();
    const v = teks(b?.nilai);
    if (!k || !v) continue;
    hasil[j].set(k, v);
  }
  return hasil;
}

/**
 * Bangun baris template ESB dari nota Berjaya Hub.
 *
 * @param {object} o
 * @param {Array} o.notas  hasil `nota_ringkas` / `goods_receipts`:
 *   { id, code, receipt_date, supplier, invoice_no, notes, outlet_id, outlet_name, payment_status, payment_source }
 * @param {Map<string, Array>} o.itemsPerNota  id nota -> baris item
 *   { product_name, base_unit, qty, unit_cost, line_total }
 * @param {Record<string, Map<string,string>>} o.peta hasil `buatPeta`
 * @param {{currency?: string, rate?: number, mulaiSequence?: number}} [o.opsi]
 * @returns {{baris: Array[], kurang: Array<{jenis: string, nilai: string, nota: string[]}>, notaIds: string[]}}
 */
export function barisEsbPurchase({ notas, itemsPerNota, peta, opsi = {} }) {
  const currency = opsi.currency ?? 'IDR';
  const rate = opsi.rate ?? 1;
  let seq = opsi.mulaiSequence ?? 1;

  const baris = [];
  const notaIds = [];
  /** @type {Map<string, {jenis: string, nilai: string, nota: Set<string>}>} */
  const kurang = new Map();
  const catat = (jenis, nilai, kode) => {
    const nilaiTeks = teks(nilai) || '(kosong)';
    const kunci = `${jenis}::${nilaiTeks.toLowerCase()}`;
    if (!kurang.has(kunci)) kurang.set(kunci, { jenis, nilai: nilaiTeks, nota: new Set() });
    kurang.get(kunci).nota.add(kode);
  };

  for (const n of Array.isArray(notas) ? notas : []) {
    const items = (itemsPerNota?.get?.(n.id) ?? []).filter((i) => angka(i?.qty) > 0);
    // Nota tanpa barang tidak menghasilkan dokumen apa pun di ESB. Mengekspor
    // kepalanya saja akan membuat pembelian kosong yang harus dihapus manual.
    if (!items.length) continue;

    const kode = teks(n.code) || teks(n.id);
    const branch = padanan(peta.branch, n.outlet_name);
    const location = padanan(peta.location, n.outlet_name);
    // Metode bayar dipetakan dari SUMBER pembayarannya, bukan dari statusnya:
    // nota yang belum lunas tetap punya cara bayar yang direncanakan, dan ESB
    // memerlukan kolom itu terisi.
    const caraBayar = n.payment_source === 'pusat' ? 'pusat' : n.payment_status === 'lunas' ? 'kas' : 'tempo';
    const payment = padanan(peta.payment_method, caraBayar);
    const coa = padanan(peta.coa, caraBayar);

    if (!branch) catat('branch', n.outlet_name, kode);
    if (!location) catat('location', n.outlet_name, kode);
    if (!payment) catat('payment_method', caraBayar, kode);
    if (!coa) catat('coa', caraBayar, kode);

    const barisNota = [];
    let adaMasalahItem = false;

    for (const it of items) {
      const item = padanan(peta.item, it.product_name);
      const unit = padanan(peta.unit, it.base_unit);
      if (!item) {
        catat('item', it.product_name, kode);
        adaMasalahItem = true;
      }
      if (!unit) {
        catat('unit', it.base_unit, kode);
        adaMasalahItem = true;
      }

      // HARGA PER SATUAN, bukan harga baris. Lihat catatan panjang di kepala
      // berkas ini — salah pilih menggandakan nilainya sebesar qty.
      const perSatuan = angka(it.unit_cost);
      if (perSatuan === null) {
        catat('harga', it.product_name, kode);
        adaMasalahItem = true;
      }

      barisNota.push([
        seq,
        teks(n.supplier),
        teks(n.receipt_date),
        branch ?? '',
        location ?? '',
        payment ?? '',
        coa ?? '',
        '', // Cost Center
        '', // Project
        '', // Credit Term
        teks(n.invoice_no),
        currency,
        rate,
        'Item',
        item ?? '',
        unit ?? '',
        angka(it.qty) ?? 0,
        perSatuan ?? 0,
        0, // Disc
        0, // Vat
        '', // Other Tax
        '', // Tax Rate
        '', // Amount — dihitung ESB
        teks(n.notes),
        ''  // Additional Info
      ]);
    }

    // Nota yang salah satu barisnya bermasalah TIDAK ikut diekspor sama sekali.
    //
    // Sebagian dokumen jauh lebih sulit dibereskan daripada tidak ada dokumen:
    // di ESB ia sudah jadi pembelian dengan isi yang kurang, dan mengoreksinya
    // berarti menghapus lalu mengunggah ulang.
    const kepalaBermasalah = !branch || !location || !payment || !coa;
    if (adaMasalahItem || kepalaBermasalah) continue;

    baris.push(...barisNota);
    notaIds.push(n.id);
    seq += 1;
  }

  return {
    baris,
    notaIds,
    kurang: [...kurang.values()].map((k) => ({ jenis: k.jenis, nilai: k.nilai, nota: [...k.nota] }))
  };
}

/**
 * Ringkasan siap-tampil: berapa nota & baris yang akan berangkat, dan berapa
 * yang tertahan.
 */
export function ringkasEkspor(hasil, totalNota) {
  const siap = hasil?.notaIds?.length ?? 0;
  return {
    siap,
    tertahan: Math.max(0, (totalNota ?? 0) - siap),
    baris: hasil?.baris?.length ?? 0,
    kurang: hasil?.kurang?.length ?? 0
  };
}
