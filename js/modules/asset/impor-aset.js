/**
 * IMPOR INVENTARIS ASET — unduh template berisi, isi di Excel, unggah kembali.
 *
 *   "di admin portal, saya ingin ada import excel untuk inventaris asset ini,
 *    beserta foto nya apakah bisa?"
 *
 * ============ FOTO DI EXCEL MENEMPEL PADA KOORDINAT, BUKAN PADA BARIS ============
 *
 * Ini hal terpenting di berkas ini, dan ia bukan pilihan rancangan — ia bentuk
 * berkas .xlsx itu sendiri.
 *
 * Gambar disimpan di `xl/media/`, dan posisinya ditulis di `xl/drawings/`
 * sebagai jangkar: "mulai di kolom 0 baris 7". Ia TIDAK menempel pada baris
 * seperti isi sel. Kalau seseorang menyisipkan satu baris di tengah lewat
 * Excel, Excel memang menggeser jangkarnya — tapi kalau barisnya disalin,
 * diurutkan, atau dipindah lewat cara lain, gambarnya bisa tetap di tempatnya.
 *
 * Akibatnya seluruh foto bisa bergeser satu barang: kursi memakai foto meja,
 * meja memakai foto lemari, dan SEMUANYA terlihat wajar. Tidak ada galat, dan
 * tidak ada satu pun kolom yang bisa dipakai memeriksanya.
 *
 * Maka dua hal di bawah ini WAJIB, dan keduanya diuji:
 *
 *   1. `cocokkanFoto` mengembalikan juga foto yang jatuh DI LUAR baris data —
 *      bukan membuangnya diam-diam. Foto melayang adalah tanda paling awal
 *      bahwa jangkarnya sudah tidak sejalan dengan barisnya.
 *   2. Layarnya WAJIB menampilkan pratinjau "foto ini untuk barang ini"
 *      sebelum menyimpan. Satu-satunya yang bisa memastikan jangkarnya benar
 *      adalah mata orang yang punya barangnya.
 *
 * ============ DICOCOKKAN LEWAT KODE, BUKAN ID MAUPUN NAMA ============
 *
 * Dulu kolom kuncinya UUID baris aset ("8d8f548c-0b72-4be0-…"). Sejak 0168
 * setiap item punya KODE yang dibuat sistem (B001, K012), dan kode itu jauh
 * lebih baik sebagai kunci:
 *
 *   - bisa dibaca dan diperiksa orang; UUID tidak bisa dicocokkan dengan apa
 *     pun di dunia nyata, jadi satu-satunya cara memakainya adalah percaya;
 *   - menunjuk ITEM (se-BU), bukan baris satu outlet — persis yang dibutuhkan
 *     template yang memuat beberapa outlet sekaligus;
 *   - sudah tertempel di barangnya.
 *
 * Baris BERKODE diperbarui; baris tanpa kode jadi barang BARU. Kode TIDAK
 * pernah diketik orang — ia sudah terisi di template, dan kolomnya cuma perlu
 * dibiarkan.
 *
 * ============ SEL KOSONG BERARTI "JANGAN DIAPA-APAKAN" ============
 *
 * Untuk baris ber-ID. Mengosongkan Catatan adalah cara paling wajar mengatakan
 * "yang ini belum saya urus" — memperlakukannya sebagai perintah menghapus
 * akan membuang catatan orang lain, diam-diam, pada unggahan berikutnya.
 *
 * Untuk baris BARU tidak ada yang bisa dipertahankan, jadi kosong = kosong.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa Excel maupun browser.
 */

/**
 * Judul kolom template, berurutan.
 *
 * `Foto` di kolom PERTAMA, sama dengan berkas hasil Export Excel yang sudah
 * ada. Gambar yang dijangkar di kolom itu jatuh di baris yang sama dengan data
 * barangnya, dan orang yang menempelkan foto baru akan meletakkannya di tempat
 * yang sama pula karena di situlah foto-foto lain berada.
 */
export const KOLOM_IMPOR_ASET = [
  'Foto',
  'Kode',
  'Nama Barang',
  'Kategori',
  'Jumlah',
  'Ukuran',
  'Kondisi',
  'Catatan kondisi',
  'Outlet',
  'Catatan'
];

/**
 * Judul kolom kunci versi LAMA, sebelum 0168.
 *
 * ============ KENAPA MASIH DITERIMA ============
 *
 * Template yang sudah terlanjur diunduh orang berisi kolom ini, dan sebagian
 * sudah diisi berjam-jam sebelum perubahannya terpasang. Menolaknya dengan
 * "Berkasnya tidak memuat baris judul template" berarti pekerjaan itu hilang,
 * dan pesannya tidak menjelaskan apa pun tentang sebab sebenarnya.
 *
 * UUID di kolom itu adalah id baris aset lama, dan 0168 MEMPERTAHANKAN id itu
 * sebagai id baris stok — jadi pencocokannya masih bisa dikerjakan.
 */
export const KOLOM_ID_LAMA = 'ID (jangan diubah)';

/** Kondisi yang diterima database (0045). Kuncinya kode, isinya label Excel. */
export const KONDISI_IMPOR = { normal: 'Normal', rusak: 'Rusak', lainnya: 'Lain-lain' };

const teks = (v) => (v === null || v === undefined ? '' : String(v).trim());
const normal = (v) => teks(v).toLowerCase().replace(/\s+/g, ' ');

/**
 * Label kondisi dari Excel -> kode database.
 *
 * Menerima label maupun kodenya: orang yang mengetik sendiri menulis "rusak",
 * dan yang menyalin dari template mendapat "Rusak". Keduanya jawaban yang sama.
 * Kosong = 'normal', nilai bawaan kolomnya di database.
 */
export function kodeKondisi(v) {
  const s = normal(v);
  if (!s) return 'normal';
  for (const [kode, label] of Object.entries(KONDISI_IMPOR)) {
    if (s === kode || s === normal(label)) return kode;
  }
  return null;
}

/**
 * Angka dari sel Excel.
 *
 * `Number('')` dan `Number(null)` adalah **0**, bukan NaN — jadi sel kosong
 * akan tersimpan sebagai jumlah nol, dan "0 unit" terbaca seperti barang yang
 * habis, bukan seperti kolom yang belum diisi. Kosong menjawab `null`, dan
 * pemanggilnya yang memutuskan artinya.
 */
export function angkaSel(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  // Format Indonesia: "1.500" ribuan, "1,5" desimal.
  const bersih = teks(v)
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}\b)/g, '')
    .replace(',', '.');
  // PENJAGANYA DI SINI, dan cuma di sini.
  //
  // Percobaan pertama juga memeriksa `teks(v) === ''` di atas — dan klausa itu
  // tidak pernah mengubah satu pun jawaban: string kosong maupun "   " sama-
  // sama menyisakan `bersih` kosong, yang gagal di baris ini juga. Ia dibuang
  // alih-alih dijaga sabotase yang tidak bisa merusak apa pun.
  //
  // Yang dijaga baris ini: `Number('')` dan `Number('-')` adalah **0**, bukan
  // NaN. Tanpa ini sel Jumlah yang kosong tersimpan sebagai 0 — dan "0 unit"
  // terbaca seperti barang yang habis, bukan seperti kolom yang belum diisi.
  if (!/\d/.test(bersih)) return null;
  const n = Number(bersih);
  return Number.isFinite(n) ? n : null;
}

/**
 * Baris untuk berkas template yang diunduh.
 *
 * @param {Array} aset hasil `listAssets`
 * @param {Map<string,string>} fotoSel id aset -> data URL foto (atau 'GAGAL')
 * @returns {Array[]} baris siap tulis
 */
export function barisTemplateAset(aset, fotoSel = new Map()) {
  return (Array.isArray(aset) ? aset : []).map((a) => [
    // `null` berarti sel foto kosong. 'GAGAL' dipertahankan apa adanya supaya
    // yang membacanya tahu fotonya ADA tapi tidak terbawa — sel kosong terbaca
    // sebagai "barang ini belum difoto", dan orang akan memfoto ulang barang
    // yang fotonya sudah ada.
    a.photo_path ? (fotoSel.get(a.id) ?? 'GAGAL') : null,
    teks(a.kode),
    teks(a.name),
    teks(a.category),
    // ============ "BELUM DIDATA" DITULIS KOSONG, BUKAN NOL ============
    //
    // Template satu outlet memuat SELURUH item BU, termasuk yang outlet itu
    // belum pernah menghitungnya. Menuliskannya "0" berarti orang yang
    // mengunduh template lalu mengunggahnya kembali tanpa mengubah apa pun
    // akan MENETAPKAN nol untuk seluruh barang yang belum dihitung —
    // mengubah "belum ada yang melihat" jadi "sudah dicek, memang tidak ada"
    // dalam satu klik, tanpa galat, dan tanpa cara mengembalikannya.
    //
    // Sel kosong juga yang membuat baris itu DILEWATI saat diunggah; lihat
    // `susunImporAset`.
    a.belumDidata ? null : Number(a.qty) || 0,
    teks(a.size),
    KONDISI_IMPOR[a.condition] ?? teks(a.condition),
    teks(a.condition_note),
    teks(a.outlets?.name),
    teks(a.notes)
  ]);
}

/**
 * Cari baris header di dalam sheet, lalu petakan kolom LEWAT JUDULNYA.
 *
 * Bukan lewat nomor indeks. Berkas yang diunduh punya judul & subjudul di
 * atasnya, orang menambah kolom catatan sendiri di kanan, dan urutan kolom
 * berubah begitu template ini ditambah satu kolom. Indeks tetap akan membaca
 * kolom yang salah tanpa satu pun galat — nama masuk ke kolom kategori, dan
 * seluruh impornya terlihat berhasil.
 *
 * @param {Array[]} aoa isi sheet sebagai array-of-array
 * @returns {{barisHeader: number, kolom: Record<string, number>}|null}
 */
export function cariHeader(aoa) {
  const baris = Array.isArray(aoa) ? aoa : [];
  for (let r = 0; r < baris.length; r++) {
    const sel = (baris[r] ?? []).map((v) => normal(v));
    // Dua kolom ini yang membuat sebuah baris BENAR-BENAR header template ini.
    // Mencari "Foto" saja akan mengenali baris mana pun yang kebetulan memuat
    // kata itu — termasuk subjudul "… 12 berfoto".
    const iNama = sel.indexOf(normal('Nama Barang'));
    const iKode = sel.indexOf(normal('Kode'));
    const iIdLama = sel.indexOf(normal(KOLOM_ID_LAMA));
    // Salah satu kolom kunci sudah cukup — template lama memakai ID, yang baru
    // memakai Kode. Lihat catatan di `KOLOM_ID_LAMA`.
    if (iNama < 0 || (iKode < 0 && iIdLama < 0)) continue;

    const kolom = {};
    for (const judul of [...KOLOM_IMPOR_ASET, KOLOM_ID_LAMA]) {
      const i = sel.indexOf(normal(judul));
      if (i >= 0) kolom[judul] = i;
    }
    return { barisHeader: r, kolom };
  }
  return null;
}

/**
 * Cocokkan gambar ke baris data.
 *
 * @param {Array<{row: number, id: any}>} gambar jangkar dari ExcelJS —
 *   `range.tl.nativeRow`, 0-based, sama sistem dengan indeks `aoa`.
 * @param {number} barisHeader indeks baris header
 * @param {number} jumlahBaris banyaknya baris data di bawah header
 * @returns {{perBaris: Map<number, any>, melayang: Array, ganda: Array}}
 */
export function cocokkanFoto(gambar, barisHeader, jumlahBaris) {
  const perBaris = new Map();
  const melayang = [];
  const ganda = [];
  const awal = barisHeader + 1;
  const akhir = awal + jumlahBaris - 1;

  for (const g of Array.isArray(gambar) ? gambar : []) {
    const r = Number(g?.row);
    if (!Number.isInteger(r) || r < awal || r > akhir) {
      // DILAPORKAN, bukan dibuang. Foto yang jatuh di luar baris data adalah
      // tanda paling awal bahwa jangkarnya sudah tidak sejalan dengan barisnya
      // — dan membuangnya diam-diam menghilangkan satu-satunya petunjuk itu.
      melayang.push(g);
      continue;
    }
    // Dua gambar di satu baris: yang PERTAMA dipakai, yang kedua dilaporkan.
    // Menimpanya diam-diam membuat foto yang dipakai bergantung pada urutan
    // baca yang tidak dijanjikan siapa pun.
    if (perBaris.has(r)) {
      ganda.push(g);
      continue;
    }
    perBaris.set(r, g);
  }
  return { perBaris, melayang, ganda };
}

/**
 * Susun rencana impor: apa yang ditambah, apa yang diubah, apa yang ditolak.
 *
 * TIDAK menyentuh database. Ia menghasilkan rencana supaya layarnya bisa
 * menampilkannya lebih dulu — foto yang menempel ke barang yang salah hanya
 * bisa ketahuan oleh mata orang yang punya barangnya.
 *
 * @param {object} o
 * @param {Array[]} o.aoa isi sheet
 * @param {Array<{row:number,id:any}>} o.gambar jangkar gambar
 * @param {Array} o.asetSekarang aset yang ada, untuk memeriksa ID
 * @param {Array<{id:string,name:string}>} o.outlets outlet yang boleh ditulis
 */
export function susunImporAset({ aoa, gambar = [], asetSekarang = [], outlets = [] }) {
  const header = cariHeader(aoa);
  if (!header) {
    return {
      tambah: [],
      ubah: [],
      tolak: [],
      lewati: [],
      foto: { melayang: [], ganda: [] },
      galat: 'Berkasnya tidak memuat baris judul template. Unduh templatenya dulu, isi di situ, lalu unggah kembali.'
    };
  }

  const { barisHeader, kolom } = header;
  const isi = (aoa ?? []).slice(barisHeader + 1);
  // Baris yang SELURUH selnya kosong dibuang — Excel sering menyimpan ratusan
  // baris kosong di bawah data, dan masing-masing akan jadi satu "nama barang
  // wajib diisi" yang menenggelamkan kesalahan sungguhan.
  const jumlahBaris = isi.length;
  const { perBaris, melayang, ganda } = cocokkanFoto(gambar, barisHeader, jumlahBaris);

  // DUA peta, bukan satu.
  //
  // Kode menunjuk ITEM (se-BU), sedangkan "sel kosong = pertahankan nilai
  // lama" menuntut baris OUTLET yang tepat. Satu peta berkunci kode saja akan
  // mengambil nilai lama milik outlet yang salah begitu template memuat lebih
  // dari satu outlet — dan yang tertulis adalah catatan outlet sebelah.
  const kodeBaku = (v) => teks(v).toUpperCase();
  const itemPerKode = new Map();
  const barisPerKodeOutlet = new Map();
  const barisPerId = new Map();
  for (const a of asetSekarang ?? []) {
    if (a?.id) barisPerId.set(String(a.id), a);
    const k = kodeBaku(a?.kode);
    if (!k) continue;
    if (!itemPerKode.has(k)) itemPerKode.set(k, a);
    if (a?.outlet_id) barisPerKodeOutlet.set(`${k}|${a.outlet_id}`, a);
  }
  const outletPerNama = new Map((outlets ?? []).map((o) => [normal(o.name), o.id]));
  const ambil = (row, judul) => (kolom[judul] === undefined ? '' : row?.[kolom[judul]]);

  const tambah = [];
  const ubah = [];
  const tolak = [];
  const lewati = [];

  for (let i = 0; i < isi.length; i++) {
    const row = isi[i] ?? [];
    const barisExcel = barisHeader + 1 + i;
    const kosong = [...KOLOM_IMPOR_ASET, KOLOM_ID_LAMA].every((j) => teks(ambil(row, j)) === '');
    const punyaFoto = perBaris.has(barisExcel);
    if (kosong && !punyaFoto) continue;

    const nomor = barisExcel + 1; // yang dilihat orang di Excel, 1-based
    const kode = kodeBaku(ambil(row, 'Kode'));
    const idLama = teks(ambil(row, KOLOM_ID_LAMA));
    const nama = teks(ambil(row, 'Nama Barang'));

    // Template lama: UUID baris stok. 0168 mempertahankan id itu, jadi
    // barisnya masih bisa ditemukan — dan dari barisnya, itemnya.
    const dariIdLama = idLama ? barisPerId.get(idLama) : null;
    if (idLama && !dariIdLama) {
      tolak.push({ baris: nomor, nama, sebab: `ID "${idLama}" tidak ada di inventaris ini. Jangan mengubah kolom ID.` });
      continue;
    }

    const item = kode ? itemPerKode.get(kode) : dariIdLama;

    if (kode && !item) {
      tolak.push({ baris: nomor, nama, sebab: `Kode "${kode}" tidak ada di inventaris ini. Jangan mengubah kolom Kode.` });
      continue;
    }
    if (!nama && !item) {
      tolak.push({ baris: nomor, nama: '', sebab: 'Nama barang wajib diisi untuk barang baru.' });
      continue;
    }

    const outletSel = teks(ambil(row, 'Outlet'));
    const outletId = outletSel ? outletPerNama.get(normal(outletSel)) : (item?.outlet_id ?? null);
    if (outletSel && !outletId) {
      tolak.push({ baris: nomor, nama, sebab: `Outlet "${outletSel}" tidak ada, atau bukan outlet yang bisa kamu isi.` });
      continue;
    }
    if (!outletId) {
      tolak.push({ baris: nomor, nama, sebab: 'Outlet wajib diisi.' });
      continue;
    }

    const qtySel = angkaSel(ambil(row, 'Jumlah'));
    if (qtySel !== null && qtySel < 0) {
      tolak.push({ baris: nomor, nama, sebab: 'Jumlah tidak boleh negatif.' });
      continue;
    }

    // Baris outlet ini yang sudah ada — INI yang dipakai mempertahankan sel
    // kosong, bukan `item` yang cuma menunjuk barangnya.
    const lama = kode
      ? (barisPerKodeOutlet.get(`${kode}|${outletId}`) ?? null)
      : (dariIdLama?.outlet_id === outletId ? dariIdLama : null);

    // ============ BARIS BELUM DIDATA YANG DIBIARKAN KOSONG: DILEWATI ============
    //
    // Template memuat seluruh item BU, jadi sebagian besarnya adalah barang
    // yang outlet ini belum pernah menghitungnya. Membiarkan barisnya apa
    // adanya adalah cara paling wajar mengatakan "yang ini belum saya urus".
    //
    // Memperlakukannya sebagai jumlah nol akan menetapkan "sudah dicek, tidak
    // ada" untuk ratusan barang sekaligus — hanya karena orangnya mengunggah
    // kembali berkas yang baru saja ia unduh.
    if (!lama && qtySel === null && !punyaFoto) {
      lewati.push({ baris: nomor, nama: nama || teks(item?.name), kode });
      continue;
    }

    // Kondisi dibaca SESUDAH `lama` ada: sel kosong berarti "pertahankan
    // kondisi yang tercatat", dan itu cuma bisa diputuskan kalau barisnya
    // sudah diketahui.
    const kondisiSel = teks(ambil(row, 'Kondisi'));
    const kondisi = kondisiSel ? kodeKondisi(kondisiSel) : lama ? null : 'normal';
    if (kondisiSel && !kondisi) {
      tolak.push({ baris: nomor, nama, sebab: `Kondisi "${kondisiSel}" tidak dikenal. Isi: Normal, Rusak, atau Lain-lain.` });
      continue;
    }

    // Kondisi "Lain-lain" MENUNTUT catatannya — itu aturan form yang sudah ada
    // (0045), dan impor yang melewatinya akan menghasilkan baris yang tidak
    // bisa dijelaskan oleh siapa pun yang membacanya nanti.
    const catatanKondisi = teks(ambil(row, 'Catatan kondisi'));
    const kondisiAkhir = kondisi ?? lama?.condition;
    const catatanKondisiAkhir = catatanKondisi || (kondisiSel ? '' : teks(lama?.condition_note));
    if (kondisiAkhir === 'lainnya' && !catatanKondisiAkhir) {
      tolak.push({ baris: nomor, nama, sebab: 'Kondisi "Lain-lain" harus disertai Catatan kondisi.' });
      continue;
    }

    const nilai = {
      baris: nomor,
      fotoDi: punyaFoto ? perBaris.get(barisExcel) : null,
      // Item yang SUDAH ADA dikenali lewat kodenya, jadi barisnya tidak pernah
      // berubah jadi item baru hanya karena namanya diketik sedikit berbeda.
      itemId: item?.itemId ?? null,
      kode: kode || teks(item?.kode),
      name: nama || teks(item?.name),
      category: teks(ambil(row, 'Kategori')),
      qty: qtySel,
      size: teks(ambil(row, 'Ukuran')),
      condition: kondisi,
      condition_note: catatanKondisi,
      outlet_id: outletId,
      notes: teks(ambil(row, 'Catatan'))
    };

    // "ubah" = outlet ini SUDAH punya barisnya. Item yang sudah terdaftar tapi
    // belum pernah didata di outlet ini tetap masuk "tambah" — karena memang
    // baris stok baru yang dibuat, bukan yang lama yang diubah.
    if (lama) ubah.push({ ...nilai, id: lama.id, lama });
    else tambah.push(nilai);
  }

  return { tambah, ubah, tolak, lewati, foto: { melayang, ganda }, galat: null };
}

/**
 * Nilai yang BENAR-BENAR dikirim untuk satu baris.
 *
 * Untuk baris ber-ID, sel kosong berarti "jangan diapa-apakan": nilai lamanya
 * dipertahankan. Tanpa ini, satu unggahan akan mengosongkan seluruh kolom yang
 * kebetulan tidak diisi orangnya — dan itu bug 0119 dalam bentuk kelima.
 */
export function nilaiSimpan(baris) {
  const lama = baris.lama ?? {};
  const pakai = (baru, lamaNilai) => (teks(baru) === '' ? (lamaNilai ?? null) : teks(baru));
  return {
    id: baris.id ?? null,
    // Sejak 0168, yang menentukan BARANG MANA adalah itemnya, bukan baris
    // stoknya. Tanpa ini, baris "ubah" dari template akan diperlakukan sebagai
    // barang baru: item kedua dengan kode kedua untuk barang yang sama, dan
    // jumlah lamanya tertinggal di item yang tidak lagi dilihat siapa pun.
    itemId: baris.itemId ?? lama.itemId ?? null,
    name: baris.name,
    category: pakai(baris.category, lama.category),
    qty: baris.qty === null || baris.qty === undefined ? (baris.id ? (Number(lama.qty) ?? 1) : 1) : baris.qty,
    size: pakai(baris.size, lama.size),
    condition: baris.condition ?? lama.condition ?? 'normal',
    condition_note: pakai(baris.condition_note, lama.condition_note),
    outlet_id: baris.outlet_id ?? lama.outlet_id ?? null,
    notes: pakai(baris.notes, lama.notes)
  };
}

/** Ringkasan siap-tampil untuk pratinjau. */
export function ringkasImpor(rencana) {
  return {
    tambah: rencana?.tambah?.length ?? 0,
    ubah: rencana?.ubah?.length ?? 0,
    tolak: rencana?.tolak?.length ?? 0,
    // Dilaporkan TERPISAH dari "ditolak": yang ini bukan kesalahan, cuma baris
    // yang memang belum diisi. Menggabungkannya membuat pratinjau terlihat
    // penuh masalah padahal berkasnya baik-baik saja.
    lewati: rencana?.lewati?.length ?? 0,
    foto: (rencana?.tambah ?? []).concat(rencana?.ubah ?? []).filter((b) => b.fotoDi).length,
    melayang: rencana?.foto?.melayang?.length ?? 0,
    ganda: rencana?.foto?.ganda?.length ?? 0
  };
}
