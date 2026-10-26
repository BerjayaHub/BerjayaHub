/**
 * ATURAN IMPOR MASTER SPAREPART dari berkas "Product List" ESB.
 *
 * Murni: tidak menyentuh DOM, tidak menyentuh Supabase. Ia menerima isi sheet
 * sebagai array-of-array dan menghasilkan RENCANA — apa yang akan ditambah,
 * apa yang akan ditimpa, apa yang ditolak dan kenapa — supaya layarnya bisa
 * menampilkannya SEBELUM ada yang ditulis.
 *
 * ============ KENAPA RENCANA DULU, BUKAN LANGSUNG TULIS ============
 *
 * Berkasnya 1.926 baris. Impor yang langsung jalan dan baru melaporkan
 * hasilnya tidak memberi siapa pun kesempatan menyadari bahwa kolom harga yang
 * terbaca ternyata "Company Supply", bukan "Store Retail" — dan sesudahnya
 * tidak ada cara membedakan harga yang tertimpa dari harga yang memang begitu.
 *
 * ============ BENTUK BERKASNYA (diperiksa dari berkas sungguhan) ============
 *
 *   baris 1    : "Product List"
 *   baris 3-13 : keterangan ekspor (perusahaan, saringan, diunduh kapan/oleh)
 *   baris 14   : kosong
 *   baris 15   : HEADER — 36 kolom, dari sharedStrings
 *   baris 16+  : data, 1.926 baris; sel teks bertipe `inlineStr`, angka biasa
 *
 * Catatan yang penting untuk pembacanya: berkas ini memakai KEDUA cara
 * menyimpan teks sekaligus — header lewat sharedStrings, data lewat
 * `inlineStr`. Pembaca yang hanya menangani salah satunya tidak melempar
 * galat: ia menghasilkan sheet tanpa judul kolom, atau 1.926 baris kosong.
 * SheetJS menangani keduanya; modul ini menerima hasilnya, bukan XML-nya.
 */

/** Judul kolom yang kita pakai. Sisanya ada di berkas tapi tidak kita baca. */
export const KOLOM_PRODUCT_LIST = {
  sku: 'SKU',
  nama: 'Product',
  kategori: 'Type',
  merek: 'Brand',
  tags: 'Tags',
  aktif: 'Active'
};

/** Kolom harga yang boleh dipilih. Default: Store Retail — harga jual outlet. */
export const KOLOM_HARGA = ['Store Retail', 'Retail (Inc Tax)', 'Store Supply', 'Company Supply', 'Company Wholesale'];
export const KOLOM_HARGA_DEFAULT = 'Store Retail';

const teks = (v) => (v === null || v === undefined ? '' : String(v));

/**
 * Bentuk BAKU sebuah SKU — dan satu-satunya bentuk yang boleh dikirim ke
 * database.
 *
 * ============ KENAPA YANG DIKIRIM HARUS SUDAH BAKU ============
 *
 * Indeks unik di database memakai `upper(btrim(sku))`. `btrim` satu argumen
 * membuang SPASI saja — bukan tab, bukan baris baru. `String.trim()` di
 * JavaScript membuang ketiganya. Jadi SKU berakhiran tab dianggap SAMA oleh
 * modul ini tapi BERBEDA oleh indeksnya: pemeriksaan kembar di sini bilang
 * "sudah ada", lalu `insert` di sana membuat baris kedua.
 *
 * Yang dikirim adalah hasil fungsi ini, bukan isi sel apa adanya — dengan
 * begitu kedua sisi menilai hal yang sama. Spasi di TENGAH tidak disentuh:
 * "A B" dan "A  B" tetap dua SKU berbeda, di sini maupun di sana.
 */
export function normalSku(v) {
  return teks(v).replace(/^[\s ]+|[\s ]+$/g, '').toUpperCase();
}

const normalJudul = (v) => teks(v).replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Angka dari sel yang bisa berisi apa saja.
 *
 * @returns {{nilai: number|null, ragu: boolean}} `ragu` berarti selnya BERISI
 *   sesuatu tapi bentuknya tidak bisa dipastikan.
 *
 * ============ KENAPA MENOLAK, BUKAN MENEBAK ============
 *
 * "455.000" bisa berarti 455 ribu (pemisah ribuan Indonesia) atau 455 koma nol
 * nol nol (desimal Inggris). Menebak salah satunya menghasilkan harga yang
 * keliru seribu kali — dan harga 455 di layar terbaca seperti harga yang
 * memang murah, bukan seperti kesalahan baca. Yang ragu dilaporkan supaya
 * orangnya memutuskan, bukan diam-diam dipilihkan.
 *
 * Yang TIDAK ragu: angka sungguhan dari xlsx (ESB mengirim 455000.0), dan
 * teks yang bentuknya cuma bisa dibaca satu cara.
 */
export function angkaHarga(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? { nilai: v, ragu: false } : { nilai: null, ragu: true };
  const s = teks(v)
    .replace(/[\s ]/g, '')
    .replace(/^rp\.?/i, '');
  if (s === '') return { nilai: null, ragu: false };

  if (/^-?\d+$/.test(s)) return { nilai: Number(s), ragu: false };

  // Satu titik dengan 1-2 angka di belakangnya: desimal. Pemisah ribuan selalu
  // tiga angka, jadi bentuk ini tidak bisa berarti ribuan.
  if (/^-?\d+\.\d{1,2}$/.test(s)) return { nilai: Number(s), ragu: false };

  // Titik-titik dengan kelompok TIGA angka: pemisah ribuan, satu-satunya
  // bacaan yang mungkin ("1.234.567").
  if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) return { nilai: Number(s.replace(/\./g, '')), ragu: false };

  // "455.000" sendirian — tiga angka di belakang satu titik — justru yang
  // paling ambigu, dan tertangkap oleh pola di atas sebagai ribuan. Itu
  // bacaan yang benar untuk berkas Indonesia. Sisanya: koma, dua pemisah
  // bercampur, huruf. Tidak ditebak.
  return { nilai: null, ragu: true };
}

/** Kata yang menandai sebuah baris sebagai JASA, bukan barang. */
const PETUNJUK_JASA = ['jasa', 'service', 'servis', 'labour', 'labor', 'ongkos'];

/**
 * TEBAK jenis sebuah baris: 'sparepart' atau 'jasa'.
 *
 * ============ INI TEBAKAN, DAN HARUS DIPERLAKUKAN SEBAGAI TEBAKAN ============
 *
 * Berkas ESB tidak punya kolom "ini jasa atau barang". Satu-satunya petunjuk
 * adalah kata di nama/kategori/tags — dan itu salah ke DUA arah:
 *
 *   - "SERVICE KIT", "POWER STEERING SEAL KIT" adalah BARANG yang namanya
 *     memuat kata jasa;
 *   - jasa yang dinamai "GANTI OLI" atau "BALANCING" tidak memuat satu pun
 *     kata kuncinya.
 *
 * Diukur dari berkas sungguhan (1.926 baris): tepat SATU baris tertebak jasa
 * — `RA.SERV.UP.LOW.01` "SERVICE GANTI UPPER LOWER RADIATOR MATIC", Rp 750.000
 * — dan baris itu memang jasa. Tidak ada tebakan palsu di berkas ini, tapi
 * tidak adanya tebakan palsu HARI INI bukan jaminan untuk berkas berikutnya.
 *
 * Karena itu: tebakan ini hanya dipakai untuk baris BARU, dan rencananya
 * melaporkan daftarnya (`dugaanJasa`, `jenisBeda`) supaya mata orang yang
 * melihatnya. Baris yang sudah ada TIDAK diubah jenisnya — lihat catatan di
 * RPC `impor_sparepart`.
 */
export function jenisBaris({ kategori, tags, nama } = {}) {
  const gabung = `${teks(kategori)} ${teks(tags)} ${teks(nama)}`.toLowerCase();
  return PETUNJUK_JASA.some((k) => gabung.includes(k)) ? 'jasa' : 'sparepart';
}

/**
 * Cari baris header, lalu petakan kolom LEWAT JUDULNYA — bukan lewat nomor.
 *
 * Indeks tetap (kolom B, kolom W) akan membaca kolom yang salah tanpa satu pun
 * galat begitu ESB menambah satu kolom di tengah: nama masuk ke kolom SKU, dan
 * seluruh impornya tetap terlihat berhasil.
 *
 * @returns {{barisHeader: number, kolom: Record<string, number>, judul: string[]}|null}
 */
export function cariHeaderProductList(aoa) {
  const baris = Array.isArray(aoa) ? aoa : [];
  for (let r = 0; r < baris.length; r++) {
    const sel = (baris[r] ?? []).map(normalJudul);

    // DUA kolom yang membuat sebuah baris benar-benar header berkas ini.
    // Mencari "SKU" saja akan mengenali baris keterangan mana pun yang
    // kebetulan memuat kata itu.
    const iSku = sel.indexOf(normalJudul(KOLOM_PRODUCT_LIST.sku));
    const iNama = sel.indexOf(normalJudul(KOLOM_PRODUCT_LIST.nama));
    if (iSku < 0 || iNama < 0) continue;

    const kolom = {};
    for (const [kunci, judul] of Object.entries(KOLOM_PRODUCT_LIST)) {
      const i = sel.indexOf(normalJudul(judul));
      if (i >= 0) kolom[kunci] = i;
    }
    for (const judul of KOLOM_HARGA) {
      const i = sel.indexOf(normalJudul(judul));
      if (i >= 0) kolom[judul] = i;
    }
    return { barisHeader: r, kolom, judul: (baris[r] ?? []).map((v) => teks(v).trim()) };
  }
  return null;
}

/**
 * Susun rencana impor.
 *
 * @param {object} o
 * @param {Array[]} o.aoa isi sheet
 * @param {Array<{sku:string,name:string,harga_dasar:any,jenis:string}>} o.sparepartSekarang
 *   master yang sudah ada di BU ini — untuk memisahkan BARU dari DITIMPA
 * @param {string} [o.kolomHarga] judul kolom harga yang dipakai
 * @returns {{
 *   ok: boolean, sebab?: string, barisHeader?: number, kolomHarga?: string,
 *   kirim?: Array, baru?: Array, ditimpa?: Array, ditolak?: Array,
 *   kembar?: Array, hargaRagu?: Array, hargaKosong?: Array, nonaktif?: Array,
 *   tidakDiBerkas?: Array
 * }}
 */
export function susunRencanaImpor({ aoa, sparepartSekarang = [], kolomHarga = KOLOM_HARGA_DEFAULT } = {}) {
  const h = cariHeaderProductList(aoa);
  if (!h) {
    return {
      ok: false,
      sebab: `Kolom "${KOLOM_PRODUCT_LIST.sku}" dan "${KOLOM_PRODUCT_LIST.nama}" tidak ditemukan — berkasnya bukan ekspor Product List dari ESB?`
    };
  }
  const iHarga = h.kolom[kolomHarga];
  if (iHarga === undefined) {
    return {
      ok: false,
      sebab: `Kolom harga "${kolomHarga}" tidak ada di berkas ini. Yang tersedia: ${KOLOM_HARGA.filter(
        (k) => h.kolom[k] !== undefined
      ).join(', ') || '(tidak satu pun)'}.`
    };
  }

  // Master yang ada, dikunci dengan bentuk SKU yang SAMA dengan yang dipakai
  // database — kalau tidak, "baru" dan "ditimpa" tertukar di layar pratinjau.
  const lama = new Map();
  for (const s of Array.isArray(sparepartSekarang) ? sparepartSekarang : []) {
    const k = normalSku(s?.sku);
    if (k) lama.set(k, s);
  }

  const baris = Array.isArray(aoa) ? aoa : [];
  const sel = (r, i) => (i === undefined ? '' : r?.[i]);

  const perSku = new Map(); // SKU baku -> baris siap kirim
  const kembar = [];
  const ditolak = [];
  const hargaRagu = [];
  const hargaKosong = [];
  const nonaktif = [];

  for (let r = h.barisHeader + 1; r < baris.length; r++) {
    const row = baris[r] ?? [];
    const noBaris = r + 1; // seperti yang dilihat orang di Excel
    const skuMentah = teks(sel(row, h.kolom.sku));
    const sku = normalSku(skuMentah);
    const nama = teks(sel(row, h.kolom.nama)).trim();

    // Baris benar-benar kosong (ekspor sering menyisakan beberapa di bawah)
    // dilewati tanpa dilaporkan — melaporkannya mengubur yang penting.
    if (!sku && !nama && row.every((c) => teks(c).trim() === '')) continue;

    if (!sku) {
      ditolak.push({ baris: noBaris, nama, sebab: 'SKU kosong' });
      continue;
    }
    if (!nama) {
      ditolak.push({ baris: noBaris, sku, sebab: 'Nama produk kosong' });
      continue;
    }

    // Baris NONAKTIF di ESB tidak ikut. Memasukkannya berarti menawarkan
    // barang yang ESB sendiri sudah tidak mau menerima — dan kegagalannya
    // baru terbaca berminggu kemudian, saat nota diekspor.
    if (h.kolom.aktif !== undefined) {
      const a = teks(sel(row, h.kolom.aktif)).trim().toLowerCase();
      if (a === '0' || a === 'false' || a === 'inactive' || a === 'no') {
        nonaktif.push({ baris: noBaris, sku, nama });
        continue;
      }
    }

    const kategori = teks(sel(row, h.kolom.kategori)).trim();
    const merek = teks(sel(row, h.kolom.merek)).trim();
    const tags = teks(sel(row, h.kolom.tags)).trim();
    const { nilai, ragu } = angkaHarga(sel(row, iHarga));

    if (ragu) hargaRagu.push({ baris: noBaris, sku, nama, isi: teks(sel(row, iHarga)) });
    // Harga NOL dikirim sebagai kosong, bukan sebagai nol.
    //
    // "Store Retail 0" di ekspor ESB berarti harganya belum ditetapkan, bukan
    // barangnya gratis. Mengirimkan 0 akan menimpa harga yang sudah benar di
    // Berjaya Hub dengan nol — dan nol tidak terlihat seperti kesalahan, ia
    // terlihat seperti barang yang memang belum dijual.
    const harga = nilai === null || nilai === 0 ? null : nilai;
    if (harga === null && !ragu) hargaKosong.push({ baris: noBaris, sku, nama });

    const siap = {
      baris: noBaris,
      sku,
      name: nama,
      jenis: jenisBaris({ kategori, tags, nama }),
      kategori: kategori || null,
      merek: merek || null,
      harga
    };

    // SKU kembar DI DALAM berkas. Mengirim keduanya membuat yang pertama
    // terhitung "baru" dan yang kedua "diperbarui" — angka yang dilaporkan
    // jadi tidak cocok dengan yang orangnya lihat di pratinjau. Yang TERAKHIR
    // dipakai (sama dengan urutan tulis di database), yang sebelumnya
    // dilaporkan supaya berkas sumbernya bisa dibereskan.
    if (perSku.has(sku)) kembar.push({ ...perSku.get(sku), digantiBaris: noBaris });
    perSku.set(sku, siap);
  }

  const kirim = [...perSku.values()];
  const baru = kirim.filter((b) => !lama.has(b.sku));
  const ditimpa = kirim
    .filter((b) => lama.has(b.sku))
    .map((b) => {
      const s = lama.get(b.sku);
      return {
        ...b,
        namaLama: teks(s?.name),
        jenisLama: teks(s?.jenis) || 'sparepart',
        hargaLama: s?.harga_dasar === null || s?.harga_dasar === undefined ? null : Number(s.harga_dasar),
        namaBerubah: teks(s?.name) !== b.name
      };
    });

  // Baris BARU yang tertebak jasa. Dilaporkan supaya ada yang melihatnya —
  // tebakannya dari kata di nama, dan kata di nama bisa menipu ke dua arah.
  const dugaanJasa = baru.filter((b) => b.jenis === 'jasa');

  // Baris yang SUDAH ADA dan tebakannya berbeda dari yang tersimpan.
  //
  // Database TIDAK akan mengubahnya (jenis baris lama adalah keputusan admin,
  // bukan isi berkas). Daftar ini ada supaya selisihnya terlihat, bukan supaya
  // sistemnya bertindak: tanpa daftar ini, satu-satunya cara tahu bahwa impor
  // "tidak sepakat" dengan master adalah memeriksa 1.926 baris satu per satu.
  const jenisBeda = ditimpa
    .filter((b) => b.jenis !== b.jenisLama)
    .map((b) => ({ sku: b.sku, name: b.name, diBerkas: b.jenis, tersimpan: b.jenisLama }));

  // Yang ADA di Berjaya Hub tapi TIDAK di berkas. Dilaporkan, TIDAK disentuh.
  //
  // Berkas ESB tidak memuat satu pun jasa, jadi "bersihkan yang tidak ada di
  // berkas" akan menghapus seluruh daftar jasa yang diketik admin sendiri.
  // Daftar ini ada supaya orangnya TAHU, bukan supaya sistemnya bertindak.
  const diBerkas = new Set(kirim.map((b) => b.sku));
  const tidakDiBerkas = [...lama.values()]
    .filter((s) => !diBerkas.has(normalSku(s?.sku)))
    .map((s) => ({ sku: normalSku(s?.sku), name: teks(s?.name), jenis: teks(s?.jenis) }));

  return {
    ok: true,
    barisHeader: h.barisHeader,
    kolomHarga,
    kirim,
    baru,
    ditimpa,
    ditolak,
    kembar,
    hargaRagu,
    hargaKosong,
    nonaktif,
    tidakDiBerkas,
    dugaanJasa,
    jenisBeda
  };
}

/**
 * Peringatan yang harus dibaca orangnya SEBELUM menekan apa pun.
 *
 * Urutannya bukan hiasan: yang paling bisa merusak di atas. Pratinjau yang
 * menaruh "1.926 baris siap" di baris pertama dan "97 harga tidak terbaca" di
 * baris kesembilan sudah memberi tahu — dan sudah gagal memberi tahu.
 *
 * @returns {Array<{tingkat: 'bahaya'|'awas'|'kabar', teks: string}>}
 */
export function peringatanRencana(r) {
  if (!r?.ok) return [{ tingkat: 'bahaya', teks: r?.sebab ?? 'Berkas tidak bisa dibaca.' }];
  const out = [];
  const n = (a) => (Array.isArray(a) ? a.length : 0);

  if (n(r.hargaRagu)) {
    out.push({
      tingkat: 'bahaya',
      teks: `${n(r.hargaRagu)} baris harganya TIDAK BISA DIPASTIKAN (misalnya ada koma atau huruf). Baris itu akan masuk TANPA harga — harga lamanya tidak diubah. Perbaiki di berkas kalau harganya memang mau diperbarui.`
    });
  }
  if (n(r.kembar)) {
    out.push({
      tingkat: 'bahaya',
      teks: `${n(r.kembar)} SKU muncul lebih dari sekali di berkas ini. Yang dipakai baris yang PALING BAWAH; baris di atasnya diabaikan.`
    });
  }
  if (n(r.ditimpa)) {
    const ganti = r.ditimpa.filter((b) => b.namaBerubah).length;
    out.push({
      tingkat: 'awas',
      teks: `${n(r.ditimpa)} sparepart sudah ada dan akan DITIMPA${ganti ? `, ${ganti} di antaranya namanya berubah` : ''}.`
    });
  }
  if (n(r.ditolak)) {
    out.push({ tingkat: 'awas', teks: `${n(r.ditolak)} baris ditolak (SKU atau nama kosong) dan tidak akan masuk.` });
  }
  if (n(r.hargaKosong)) {
    out.push({
      tingkat: 'awas',
      teks: `${n(r.hargaKosong)} baris kolom "${r.kolomHarga}"-nya kosong atau nol. Baris itu masuk tanpa harga; harga lamanya di Berjaya Hub TIDAK dihapus.`
    });
  }
  if (n(r.jenisBeda)) {
    out.push({
      tingkat: 'awas',
      teks: `${n(r.jenisBeda)} SKU jenisnya berbeda dari yang tersimpan. Yang TERSIMPAN dipakai — impor tidak mengubah jenis baris yang sudah ada. Ubah dari layar Sparepart kalau memang perlu.`
    });
  }
  if (n(r.dugaanJasa)) {
    out.push({
      tingkat: 'kabar',
      teks: `${n(r.dugaanJasa)} baris baru DITEBAK sebagai Jasa dari namanya. Periksa daftarnya — tebakan dari nama bisa keliru.`
    });
  }
  if (n(r.tidakDiBerkas)) {
    const jasa = r.tidakDiBerkas.filter((s) => s.jenis === 'jasa').length;
    out.push({
      tingkat: 'kabar',
      teks: `${n(r.tidakDiBerkas)} sparepart/jasa yang sudah terdaftar tidak ada di berkas ini${
        jasa ? ` (${jasa} di antaranya jasa)` : ''
      }. Semuanya DIBIARKAN — impor tidak pernah menghapus.`
    });
  }
  if (n(r.nonaktif)) {
    out.push({ tingkat: 'kabar', teks: `${n(r.nonaktif)} baris nonaktif di ESB dilewati.` });
  }
  out.push({ tingkat: 'kabar', teks: `${n(r.baru)} baru, ${n(r.ditimpa)} ditimpa — ${n(r.kirim)} baris akan dikirim.` });
  return out;
}
