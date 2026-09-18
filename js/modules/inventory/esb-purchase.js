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
 * ============ KOLOM DATE BERISI ANGKA, BUKAN TULISAN ============
 *
 * Sel C2 template resmi ESB bertipe tanggal, bukan teks. Berjaya Hub dulu
 * mengirim `"2026-09-01"` sebagai tulisan, dan ESB menolak berkasnya. Yang
 * dikirim sekarang nomor seri Excel — lihat `tanggal-excel.js` untuk alasan
 * angkanya dihitung sendiri alih-alih menyerahkan objek `Date` ke SheetJS.
 *
 * Satu-satunya impornya `serialTanggalExcel` (modul murni juga), supaya berkas
 * ini tetap bisa diuji tanpa Excel maupun browser.
 */

import { serialTanggalExcel } from './tanggal-excel.js';
import { cocokkanSupplier, supplierSiap, normalNama } from './cocok-supplier.js';
import { keSatuanBeli } from './konversi-satuan.js';

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

/**
 * Jenis pemetaan yang dikenal. Dipakai layar pengaturan & pemeriksaan.
 *
 * `supplier` masuk sejak 0144, dan cara kerjanya BERBEDA dari enam lainnya:
 * yang lima pertama selalu perlu dipetakan (nama outlet lokal tidak akan pernah
 * sama dengan nama Branch di ESB), sementara nama supplier yang dipilih dari
 * daftar ESB sudah cocok apa adanya. Pemetaannya cuma untuk EJAAN LAMA yang
 * terlanjur diketik sebelum daftarnya ada.
 */
export const JENIS_PETA = ['branch', 'location', 'payment_method', 'coa', 'unit', 'item', 'supplier'];

/**
 * Batas desimal harga yang diterima ESB.
 *
 * Bukan tebakan: pesan penolakannya berbunyi persis "price cannot have more
 * than 4 decimal places".
 */
export const DESIMAL_HARGA_MAKS = 4;

/**
 * Bulatkan harga per satuan ke batas yang diterima ESB.
 *
 * ============ KENAPA PEMBULATANNYA TIDAK MERUSAK APA PUN ============
 *
 * ESB menghitung sendiri `Amount = Qty × Price`, jadi membulatkan Price
 * menggeser total dokumennya sedikit dari total nota. Besarnya: paling banyak
 * setengah satuan desimal terakhir dikali qty — untuk 62 pcs itu 0,003 rupiah.
 *
 * Alternatifnya tidak ada: ESB menolak berkasnya mentah-mentah kalau angkanya
 * lebih panjang, dan berkas yang ditolak bernilai nol rupiah.
 *
 * ============ SOAL `toFixed` vs `Math.round(x * 1e4)` ============
 *
 * Keduanya dicoba, dan keduanya berbeda hasil pada nilai tepat-di-tengah:
 * `2.00005` jadi `2` lewat `toFixed` dan `2.0001` lewat `Math.round`.
 *
 * TIDAK ADA yang "benar" di antara keduanya. `2.00005` tidak bisa diwakili
 * persis sebagai double — yang sungguh tersimpan 2.0000499999999999723, jadi
 * membulatkannya ke bawah justru lebih setia pada angkanya. Percobaan pertama
 * di sini menulis bahwa `toFixed` lebih unggul; itu keliru, dan dibetulkan.
 *
 * Yang dijamin cuma dua hal, dan itu yang diuji: hasilnya tidak lebih dari 4
 * desimal, dan selisihnya dari angka asli tidak lebih dari setengah satuan
 * desimal terakhir. Untuk harga per gram, selisih 0,00005 rupiah tidak pernah
 * jadi persoalan siapa pun. `toFixed` dipilih karena membaca niatnya langsung.
 */
export function bulatkanHarga(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(DESIMAL_HARGA_MAKS));
}

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
  const k = normalNama(nilai);
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
    // SATU aturan normalisasi untuk semua jenis, dipinjam dari `cocok-supplier`.
    //
    // Dulu kuncinya cuma `trim().toLowerCase()`, sementara pencocokan supplier
    // juga merapikan spasi ganda. Dua aturan yang berbeda untuk satu pekerjaan
    // yang sama pasti menyimpang: "AB  Sentul" hasil salin-tempel akan cocok di
    // satu jalur dan tidak di jalur lain, dan tidak ada layar yang bisa
    // menunjukkan bedanya.
    const k = normalNama(b?.kunci);
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
 * @param {Map<string, {nama: string}>} [o.masterSupplier] hasil `petaSupplier`
 *   — daftar induk supplier ESB. Kalau KOSONG, pemeriksaan suppliernya
 *   dilewati: BU yang belum pernah mengimpor daftar supplier tidak boleh
 *   mendadak kehilangan seluruh notanya karena aturan baru.
 * @param {{currency?: string, rate?: number, mulaiSequence?: number}} [o.opsi]
 * @returns {{baris: Array[], kurang: Array<{jenis: string, nilai: string, nota: string[]}>, notaIds: string[]}}
 */
export function barisEsbPurchase({ notas, itemsPerNota, peta, masterSupplier = new Map(), opsi = {} }) {
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

    // Tanggal yang tidak terbaca MENAHAN notanya, bukan dikosongkan.
    //
    // Sel Date yang kosong tidak ditolak ESB — ia diisi tanggal unggah. Jadi
    // nota bulan lalu masuk sebagai pembelian hari ini, dan laporan bulan yang
    // sudah ditutup ikut bergeser tanpa satu pun pesan kesalahan.
    const tanggal = serialTanggalExcel(n.receipt_date);
    if (tanggal === null) catat('tanggal', n.receipt_date, kode);

    // SUPPLIER: harus ada di daftar induk ESB, atau punya pemetaan ejaan.
    //
    // Yang dikirim nama KANONIK dari daftarnya, bukan yang diketik staff.
    // "toko beras ridho" berangkat sebagai "Toko Beras Ridho" — mengirim ejaan
    // yang diketik berarti mengirim nama yang, bagi ESB, bukan nama yang sama.
    //
    // Daftar induk yang masih kosong MELEWATI pemeriksaan ini sepenuhnya. BU
    // yang belum sempat mengimpor daftar supplier tidak boleh mendadak
    // kehilangan seluruh notanya karena aturan yang baru dinyalakan.
    const adaMasterSupplier = masterSupplier?.size > 0;
    const cocokSup = adaMasterSupplier ? cocokkanSupplier(n.supplier, masterSupplier, peta.supplier) : null;
    const supplier = adaMasterSupplier ? (supplierSiap(cocokSup) ? cocokSup.nama : null) : teks(n.supplier);
    if (adaMasterSupplier && !supplierSiap(cocokSup)) catat('supplier', n.supplier, kode);

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
      // SATUAN BELI, bukan satuan kecil.
      //
      // ESB menolak pembelian yang dikirim dalam satuan yang bukan satuan
      // belinya ("product must be set to purchasable"). Berjaya Hub menyimpan
      // segalanya dalam satuan kecil, jadi Unit/Qty/Price diubah di sini — dan
      // HANYA di sini. Stok & HPP di database tidak tersentuh.
      //
      // Produk tanpa satuan beli berangkat apa adanya; lihat `keSatuanBeli`.
      const konv = keSatuanBeli(it, it);

      const item = padanan(peta.item, it.product_name);
      // Yang dicari di pemetaan adalah satuan yang BENAR-BENAR dikirim.
      // Mencari `base_unit` sementara yang berangkat satuan beli akan membuat
      // notanya lolos dengan satuan yang tidak pernah diperiksa siapa pun.
      const unit = padanan(peta.unit, konv.unitLokal);
      if (!item) {
        catat('item', it.product_name, kode);
        adaMasalahItem = true;
      }
      if (!unit) {
        catat('unit', konv.unitLokal, kode);
        adaMasalahItem = true;
      }

      // HARGA PER SATUAN, bukan harga baris. Lihat catatan panjang di kepala
      // berkas ini — salah pilih menggandakan nilainya sebesar qty.
      //
      // DIBULATKAN KE 4 DESIMAL. `unit_cost` adalah hasil bagi `line_total/qty`
      // (0123), dan pembagian itu hampir selalu berulang: Rp12.000 untuk 62 pcs
      // menghasilkan 193.5483870967742. ESB menolaknya dengan "price cannot
      // have more than 4 decimal places".
      //
      // Yang menipu: Excel MENAMPILKAN 193.5484 — empat desimal, terlihat sah —
      // sementara yang tersimpan di selnya enam belas digit. Berkasnya terlihat
      // benar di layar siapa pun yang memeriksanya sebelum mengunggah.
      // Harganya PER SATUAN YANG DIKIRIM — per pack kalau yang berangkat pack.
      // `keSatuanBeli` menghitungnya dari `line_total` langsung, bukan dari
      // `unit_cost × isi`, supaya galat pembulatan tidak ditumpuk dua kali.
      const perSatuan = bulatkanHarga(konv.harga);
      if (perSatuan === null) {
        catat('harga', it.product_name, kode);
        adaMasalahItem = true;
      }

      barisNota.push([
        seq,
        // Nama KANONIK dari daftar ESB, bukan yang diketik staff.
        supplier ?? '',
        // Nomor seri Excel, bukan tulisan — lihat catatan di kepala berkas.
        tanggal ?? '',
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
        // Qty dalam satuan yang dikirim: 300 pcs berangkat sebagai 3 PACK.
        // Pecahan diterima apa adanya (0,496 KG) — membulatkannya mengubah
        // jumlah dari yang sungguh masuk gudang, dan angkanya tetap wajar.
        konv.qty ?? 0,
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
    const kepalaBermasalah = tanggal === null || !supplier || !branch || !location || !payment || !coa;
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
