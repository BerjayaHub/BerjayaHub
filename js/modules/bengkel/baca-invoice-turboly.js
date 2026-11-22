/**
 * MEMBACA EKSPOR "DETAILED SERVICE INVOICE" DARI TURBOLY.
 *
 * Murni: tidak menyentuh DOM, tidak menyentuh Supabase, tidak membaca berkas.
 * Yang masuk ke sini sudah berupa larik-dari-larik (hasil SheetJS), yang
 * keluar sudah berupa invoice beserta barisnya — supaya seluruh aturannya
 * bisa diuji tanpa browser dan tanpa Excel.
 *
 * ============ KENAPA BUKAN "BACA SAJA KOLOMNYA" ============
 *
 * Berkasnya punya 25 baris pengantar sebelum header (judul, nama perusahaan,
 * 20 baris filter, "Downloaded At", "Downloaded By"), lalu 46 kolom. Urutan
 * kolomnya BUKAN kontrak: Turboly bisa menyisipkan kolom baru kapan saja, dan
 * pembaca yang memakai nomor kolom akan tetap "berhasil" — cuma mengambil
 * harga dari kolom diskon. Jadi kolomnya dicari lewat NAMANYA, dan nama yang
 * wajib tapi tidak ketemu menghentikan impor dengan menyebutkan nama itu.
 *
 * ============ TIGA HAL YANG MUDAH SALAH DAN MAHAL ============
 *
 *   1. `Cost` adalah TOTAL satu baris, bukan harga per unit. Oli 4 liter:
 *      Cost 459.000, dan Gross Profit = Total − Cost. Diperlakukan per unit,
 *      HPP-nya jadi empat kali lipat — dan angkanya tetap terlihat wajar.
 *   2. Satu invoice punya BANYAK baris, dan impor ulang harus mengganti
 *      seluruh isi invoice itu. Nomor baris dari Turboly (`No.`) hanya nomor
 *      urut di dalam BERKAS, bukan identitas baris — memakainya sebagai kunci
 *      akan menimpa baris yang salah begitu ada invoice yang disunting.
 *   3. Jasa (`Item Type = Service`) tidak punya modal. Mencampurnya dengan
 *      sparepart membuat margin sparepart terlihat jauh lebih sehat daripada
 *      kenyataannya.
 */

const teks = (v) => (v === null || v === undefined ? '' : String(v).trim());
const rapat = (v) => teks(v).replace(/\s+/g, ' ');

/** Angka yang MENOLAK sampah, bukan mengubahnya jadi 0. */
export function angka(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  // Ekspor Excel kadang memberi teks berformat: "1.234,56" atau "Rp 1,234.56".
  const bersih = String(v)
    .replace(/[Rr][Pp]\.?/g, '')
    .replace(/\s/g, '')
    .replace(/\.(?=\d{3}\b)/g, '')
    .replace(',', '.');
  if (bersih === '' || !/^-?\d*\.?\d+$/.test(bersih)) return null;
  const n = Number(bersih);
  return Number.isFinite(n) ? n : null;
}

/** Kolom yang WAJIB ada; tanpa salah satunya, berkasnya bukan ekspor yang benar. */
export const KOLOM_WAJIB = ['Invoice Date', 'Store', 'Service Invoice', 'Item Type', 'Qty', 'Total'];

/**
 * Kolom yang dipakai, dan nama bidangnya di aplikasi.
 *
 * Yang TIDAK diambil sengaja tidak diambil: nomor telepon pelanggan, VIN,
 * hull number, dan tag. Menyimpan data pribadi yang tidak dipakai laporan
 * mana pun berarti menanggung risikonya tanpa mendapat gunanya.
 */
export const PETA_KOLOM = {
  'Invoice Date': 'tanggal',
  Store: 'store',
  'Service Invoice': 'invoice_no',
  Type: 'tipe',
  Status: 'status',
  Customer: 'customer',
  Company: 'company',
  'Customer Group': 'customer_group',
  Salesperson: 'salesperson',
  'Service Advisor': 'service_advisor',
  Registration: 'nopol',
  'Vehicle Make': 'merek',
  'Vehicle Model': 'model',
  'Item Type': 'item_type',
  SKU: 'sku',
  'Product Name': 'nama',
  'Product Brand': 'brand',
  'Product Type': 'product_type',
  Qty: 'qty',
  Discount: 'diskon',
  'Price Ex Tax': 'harga_satuan',
  Subtotal: 'subtotal',
  Tax: 'pajak',
  Total: 'total',
  Cost: 'modal',
  'Gross Profit': 'laba_turboly',
  'Service Work Order': 'work_order',
  'Service Order': 'service_order',
  'Payment Types': 'pembayaran'
};

/** Sebab sebuah baris ditolak / ditandai. Dipakai layar untuk menjelaskan. */
export const MASALAH = {
  TANPA_INVOICE: 'tanpa-invoice',
  TANPA_TANGGAL: 'tanpa-tanggal',
  TANPA_STORE: 'tanpa-store',
  QTY_TIDAK_SAH: 'qty-tidak-sah',
  LABA_TIDAK_COCOK: 'laba-tidak-cocok'
};

export const PESAN_MASALAH = {
  [MASALAH.TANPA_INVOICE]: 'Baris tanpa nomor Service Invoice — tidak bisa dikelompokkan ke invoice mana pun.',
  [MASALAH.TANPA_TANGGAL]: 'Baris tanpa Invoice Date.',
  [MASALAH.TANPA_STORE]: 'Baris tanpa Store — tidak bisa ditentukan outletnya.',
  [MASALAH.QTY_TIDAK_SAH]: 'Qty kosong atau bukan angka.',
  [MASALAH.LABA_TIDAK_COCOK]: 'Gross Profit dari Turboly tidak sama dengan Total − Cost.'
};

/**
 * Keterangan di atas header: Store, rentang tanggal, waktu unduh.
 *
 * Dipakai layar untuk mengatakan "berkas ini OTONIX Malang, 1–30 Nov" SEBELUM
 * ada yang menekan Simpan. Berkas periode lain yang terlanjur diimpor akan
 * mengganti isi invoice yang benar dengan yang salah — dan satu-satunya tanda
 * adalah angka yang berubah tanpa sebab.
 */
export function bacaPengantar(baris) {
  const hasil = { store: '', dari: '', sampai: '', diunduh: '' };
  for (const r of Array.isArray(baris) ? baris.slice(0, 40) : []) {
    const sel = teks(r?.[0]);
    const ambil = (awalan) => (sel.toLowerCase().startsWith(awalan) ? sel.slice(awalan.length).trim() : null);
    const s = ambil('store:');
    if (s !== null) hasil.store = s;
    const d = ambil('from date:');
    if (d !== null) hasil.dari = d;
    const t = ambil('to date:');
    if (t !== null) hasil.sampai = t;
    const u = ambil('downloaded at:');
    if (u !== null) hasil.diunduh = u;
  }
  return hasil;
}

/**
 * Cari baris header dan petakan nama kolom ke nomor kolomnya.
 *
 * Headernya dikenali dari ISINYA (memuat 'Service Invoice' dan 'Item Type'),
 * bukan dari nomor barisnya: jumlah baris filter di pengantar BERUBAH
 * mengikuti saringan yang dipakai saat mengekspor, dan nomor baris tetap akan
 * "berhasil" membaca baris yang salah.
 */
export function cariHeader(baris) {
  const daftar = Array.isArray(baris) ? baris : [];
  for (let i = 0; i < daftar.length; i++) {
    const sel = (daftar[i] ?? []).map((x) => rapat(x));
    if (sel.includes('Service Invoice') && sel.includes('Item Type')) {
      const peta = new Map();
      sel.forEach((nama, kolom) => {
        if (nama && !peta.has(nama)) peta.set(nama, kolom);
      });
      return { baris: i, peta };
    }
  }
  return null;
}

/**
 * Baca seluruh berkas jadi invoice + barisnya.
 *
 * @returns {{
 *   pengantar: {store, dari, sampai, diunduh},
 *   invoices: Array<{invoice_no, tanggal, store, customer, nopol, baris: Array}>,
 *   ditolak: Array<{nomor: number, sebab: string, isi: object}>,
 *   peringatan: Array<{nomor: number, sebab: string, isi: object}>,
 *   ringkas: object,
 *   galat: string
 * }}
 */
export function bacaEksporTurboly(baris) {
  const daftar = Array.isArray(baris) ? baris : [];
  const pengantar = bacaPengantar(daftar);
  const kosong = { pengantar, invoices: [], ditolak: [], peringatan: [], ringkas: ringkasKosong(), galat: '' };

  const header = cariHeader(daftar);
  if (!header) {
    return { ...kosong, galat: 'Baris header tidak ketemu. Pastikan ini berkas "Detailed Service Invoice" dari Turboly, bukan laporan lain.' };
  }

  const hilang = KOLOM_WAJIB.filter((k) => !header.peta.has(k));
  if (hilang.length) {
    return { ...kosong, galat: `Kolom wajib tidak ada: ${hilang.join(', ')}. Ekspor ulang dengan kolom lengkap.` };
  }

  const ambil = (r, nama) => {
    const k = header.peta.get(nama);
    return k === undefined ? undefined : r[k];
  };

  const ditolak = [];
  const peringatan = [];
  const perInvoice = new Map();

  for (let i = header.baris + 1; i < daftar.length; i++) {
    const r = daftar[i] ?? [];
    // Baris benar-benar kosong = ujung tabel atau pemisah; bukan kesalahan.
    if (r.every((c) => teks(c) === '')) continue;

    const isi = {};
    for (const [kolom, bidang] of Object.entries(PETA_KOLOM)) {
      const v = ambil(r, kolom);
      if (v === undefined) continue;
      isi[bidang] = ['qty', 'diskon', 'harga_satuan', 'subtotal', 'pajak', 'total', 'modal', 'laba_turboly'].includes(bidang)
        ? angka(v)
        : rapat(v);
    }
    isi.nomor_berkas = i - header.baris; // untuk menyebut barisnya di pesan galat

    const sebab = periksaBaris(isi);
    if (sebab) {
      ditolak.push({ nomor: isi.nomor_berkas, sebab, isi });
      continue;
    }

    // ============ LABA DARI TURBOLY DIPERIKSA, BUKAN DIPERCAYA ============
    //
    // `Gross Profit` seharusnya = Total − Cost. Kalau tidak, salah satu
    // angkanya tidak berarti seperti yang kita kira — dan menghitung laba
    // dari angka yang artinya belum pasti menghasilkan laporan yang salah
    // tanpa satu pun tanda. Barisnya tetap masuk, tapi ditandai.
    if (isi.laba_turboly !== null && isi.laba_turboly !== undefined && isi.modal !== null && isi.modal !== undefined) {
      const selisih = Math.abs((isi.total ?? 0) - (isi.modal ?? 0) - isi.laba_turboly);
      if (selisih > 1) peringatan.push({ nomor: isi.nomor_berkas, sebab: MASALAH.LABA_TIDAK_COCOK, isi });
    }

    const kunci = isi.invoice_no;
    if (!perInvoice.has(kunci)) {
      perInvoice.set(kunci, {
        invoice_no: isi.invoice_no,
        tanggal: isi.tanggal,
        store: isi.store,
        tipe: isi.tipe ?? '',
        status: isi.status ?? '',
        customer: isi.customer ?? '',
        company: isi.company ?? '',
        nopol: isi.nopol ?? '',
        merek: isi.merek ?? '',
        model: isi.model ?? '',
        work_order: isi.work_order ?? '',
        service_order: isi.service_order ?? '',
        pembayaran: isi.pembayaran ?? '',
        baris: []
      });
    }
    perInvoice.get(kunci).baris.push(isi);
  }

  const invoices = [...perInvoice.values()];
  return { pengantar, invoices, ditolak, peringatan, ringkas: ringkasImpor(invoices, ditolak, peringatan), galat: '' };
}

function periksaBaris(isi) {
  if (!isi.invoice_no) return MASALAH.TANPA_INVOICE;
  if (!isi.tanggal) return MASALAH.TANPA_TANGGAL;
  if (!isi.store) return MASALAH.TANPA_STORE;
  // Qty 0 SAH — Turboly memakainya untuk baris pelengkap/compliment. Yang
  // tidak sah adalah qty yang kosong atau bukan angka: ia berarti barisnya
  // tidak bisa dihitung sama sekali.
  if (isi.qty === null || isi.qty === undefined) return MASALAH.QTY_TIDAK_SAH;
  return '';
}

function ringkasKosong() {
  return {
    invoice: 0,
    baris: 0,
    sparepart: 0,
    jasa: 0,
    omzet: 0,
    omzetSparepart: 0,
    omzetJasa: 0,
    modal: 0,
    laba: 0,
    tanpaModal: 0,
    tanpaNopol: 0,
    tanpaSku: 0,
    ditolak: 0,
    peringatan: 0,
    store: []
  };
}

/**
 * Angka yang ditampilkan SEBELUM impor disimpan.
 *
 * "Berhasil mengimpor 412 baris" sesudahnya tidak menolong siapa pun: yang
 * perlu dilihat adalah apakah totalnya masuk akal untuk periode itu — dan itu
 * harus terlihat saat masih bisa dibatalkan.
 */
export function ringkasImpor(invoices, ditolak = [], peringatan = []) {
  const r = ringkasKosong();
  const store = new Set();
  for (const inv of invoices ?? []) {
    r.invoice += 1;
    if (inv.store) store.add(inv.store);
    for (const b of inv.baris ?? []) {
      r.baris += 1;
      const sparepart = String(b.item_type ?? '').toLowerCase() === 'sparepart';
      const total = Number(b.total) || 0;
      r.omzet += total;
      if (sparepart) {
        r.sparepart += 1;
        r.omzetSparepart += total;
        // Modal dijumlahkan APA ADANYA — `Cost` sudah total per baris.
        // Dikalikan qty, HPP oli 4 liter jadi 1,8 juta alih-alih 459 ribu.
        if (b.modal === null || b.modal === undefined) r.tanpaModal += 1;
        else r.modal += Number(b.modal) || 0;
        if (!b.sku) r.tanpaSku += 1;
      } else {
        r.jasa += 1;
        r.omzetJasa += total;
      }
      if (!b.nopol) r.tanpaNopol += 1;
    }
  }
  // Laba HANYA dari sparepart yang bermodal. Jasa tidak punya modal barang,
  // dan memasukkannya ke angka yang sama membuat margin sparepart terlihat
  // jauh lebih sehat daripada kenyataannya.
  r.laba = r.omzetSparepart - r.modal;
  r.ditolak = (ditolak ?? []).length;
  r.peringatan = (peringatan ?? []).length;
  r.store = [...store].sort();
  return r;
}

/**
 * Bentuk yang dikirim ke RPC: satu larik invoice, tiap invoice membawa
 * barisnya sendiri. Kolom yang tidak dipakai database dibuang di sini, bukan
 * di SQL — supaya yang berangkat lewat jaringan cuma yang memang disimpan.
 */
export function untukRpc(invoices) {
  return (invoices ?? []).map((inv) => ({
    invoice_no: inv.invoice_no,
    tanggal: inv.tanggal,
    store: inv.store,
    tipe: inv.tipe,
    status: inv.status,
    customer: inv.customer,
    company: inv.company,
    nopol: inv.nopol,
    merek: inv.merek,
    model: inv.model,
    work_order: inv.work_order,
    service_order: inv.service_order,
    pembayaran: inv.pembayaran,
    baris: (inv.baris ?? []).map((b, i) => ({
      urut: i + 1,
      item_type: String(b.item_type ?? '').toLowerCase() === 'sparepart' ? 'sparepart' : 'jasa',
      sku: b.sku ?? '',
      nama: b.nama ?? '',
      brand: b.brand ?? '',
      product_type: b.product_type ?? '',
      qty: b.qty ?? 0,
      harga_satuan: b.harga_satuan ?? 0,
      diskon: b.diskon ?? 0,
      total: b.total ?? 0,
      // `null`, BUKAN 0. Modal yang tidak diketahui dan modal nol adalah dua
      // hal yang berbeda, dan 0 membuat labanya terlihat 100%.
      modal: b.modal === undefined ? null : b.modal,
      laba_turboly: b.laba_turboly === undefined ? null : b.laba_turboly
    }))
  }));
}
