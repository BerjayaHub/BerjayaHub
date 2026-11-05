/**
 * ATURAN DAFTAR ASET SE-BU — murni.
 *
 * Tidak menyentuh DOM, tidak menyentuh Supabase.
 *
 * ============ KODE TIDAK DIBUAT DI SINI ============
 *
 * Aturan prefix ("Bar" -> B, diperpanjang saat bentrok) hanya ada di SQL,
 * di `prefix_kategori_aset()`. Berkas ini MEMBACA kode, tidak pernah membuatnya.
 *
 * Dua salinan aturan yang sama di dua bahasa pasti menyimpang pada perbaikan
 * berikutnya, dan penyimpangannya tidak memunculkan galat: layarnya
 * menjanjikan "B002", databasenya memberi "BA001", dan yang pertama sudah
 * terlanjur dibacakan ke orang atau ditempel di barangnya.
 */

const teks = (v) => (v === null || v === undefined ? '' : String(v));

/** Bentuk baku nama untuk MENDUGA kembar — bukan untuk menyimpan. */
export function namaBaku(v) {
  return teks(v).replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Pecah kode jadi prefix dan nomor, supaya bisa diurutkan seperti yang
 * diharapkan orang.
 *
 * Mengurutkan kode sebagai teks biasa menaruh B10 sebelum B9. Itu tidak
 * terlihat seperti kesalahan — daftarnya tetap berurutan, cuma tidak seperti
 * yang dicari mata orang yang menyusuri rak.
 */
export function bacaKode(kode) {
  // Prefix SELALU huruf saja, nomor selalu angka di belakangnya.
  //
  // Itu dijamin oleh `prefix_kategori_aset()` di 0168, yang memakai huruf —
  // bukan angka — saat harus memperpanjang prefix yang bentrok. Kalau
  // prefixnya boleh berakhiran angka, "X2007" sama masuk akalnya dibaca
  // sebagai X2 nomor 007 maupun X nomor 2007, dan fungsi ini harus menebak.
  const m = /^([A-Za-z]+)(\d+)$/.exec(teks(kode).trim());
  if (!m) return { prefix: teks(kode).trim().toUpperCase(), nomor: null };
  return { prefix: m[1].toUpperCase(), nomor: Number(m[2]) };
}

/** Pembanding untuk `sort`: prefix dulu, lalu nomor sebagai ANGKA. */
export function urutKode(a, b) {
  const x = bacaKode(a);
  const y = bacaKode(b);

  // Kode yang tidak terbaca ditaruh di BELAKANG — diperiksa SEBELUM prefixnya
  // dibandingkan. Kalau tidak, "???" menang atas "B001" karena '?' lebih kecil
  // daripada 'B', dan daftarnya dibuka oleh barisnya yang paling cacat.
  if (x.nomor === null && y.nomor === null) return x.prefix.localeCompare(y.prefix);
  if (x.nomor === null) return 1;
  if (y.nomor === null) return -1;

  if (x.prefix !== y.prefix) return x.prefix.localeCompare(y.prefix);
  return x.nomor - y.nomor;
}

/**
 * Urutan daftar aset satu outlet: YANG ADA DI SINI LEBIH DULU.
 *
 * ============ KENAPA BUKAN URUT KODE SAJA ============
 *
 *   "saya ingin item item yang stock nya 0 ada di paling bawah, dan item yang
 *    ada jumlah stocknya ada di atas, tujuannya agar staff tidak bingung saat
 *    melihat daftar item"
 *
 * Daftar ini memuat SELURUH item BU, termasuk ratusan yang outlet ini belum
 * pernah menyentuhnya (lihat `gabungItemDenganStok`). Diurutkan kode saja,
 * delapan barang yang benar-benar ada di rak bisa terselip di antara 135 baris
 * kosong — dan yang membukanya menggulir melewati barang milik outlet lain
 * untuk menemukan miliknya sendiri.
 *
 * ============ TIGA KELOMPOK, BUKAN DUA ============
 *
 *   1. ada isinya       (qty > 0)   — yang benar-benar ada di outlet ini
 *   2. nol              (qty = 0)   — SUDAH dihitung, memang habis
 *   3. belum didata                 — belum ada yang melihat ke sana
 *
 * Kelompok 2 dan 3 TIDAK digabung, walaupun keduanya menampilkan "tidak ada".
 * "Habis" adalah jawaban; "belum didata" adalah pertanyaan yang belum dijawab
 * siapa pun. Yang belum dijawab ditaruh PALING bawah: barisnya ada di layar
 * cuma karena itemnya ada di BU, bukan karena ada hubungannya dengan outlet
 * ini — dan jumlahnya bisa ratusan. Yang sudah dihitung dan memang habis
 * tetap di atasnya, karena nol yang sudah dipastikan adalah keterangan nyata
 * tentang rak outlet ini.
 *
 * Di dalam tiap kelompok urutannya tetap kode, supaya letak barang tidak
 * berpindah-pindah tiap kali jumlahnya berubah.
 */
export function kelompokStok(a) {
  if (a?.belumDidata) return 2;
  return (Number(a?.qty) || 0) > 0 ? 0 : 1;
}

/** Pembanding daftar aset: kelompok stok dulu, baru kode, baru nama. */
export function urutDaftarAset(a, b) {
  const ka = kelompokStok(a);
  const kb = kelompokStok(b);
  if (ka !== kb) return ka - kb;
  return urutKode(a?.kode, b?.kode) || teks(a?.name).localeCompare(teks(b?.name), 'id');
}

/**
 * Gabungkan daftar item se-BU dengan stok satu outlet.
 *
 * ============ "BELUM DIDATA" BUKAN "TIDAK PUNYA" ============
 *
 * Item yang belum pernah disentuh outlet ini TIDAK punya baris stok. Ia tetap
 * ditampilkan — itulah gunanya daftar se-BU — tapi ia HARUS bisa dibedakan
 * dari item yang sudah didata dan jumlahnya memang nol.
 *
 * Kalau keduanya sama-sama tampil "0", dua keadaan yang berbeda artinya jadi
 * tidak bisa dibedakan: yang satu berarti "sudah dicek, tidak ada", yang satu
 * berarti "belum ada yang melihat". Laporan yang menjumlahkan keduanya tetap
 * benar; yang salah adalah orang yang membacanya dan mengira semuanya sudah
 * dihitung.
 *
 * @param {object} o
 * @param {Array} o.items item master BU: {id, kode, name, category, size}
 * @param {Array} o.stok baris asset_stock outlet ini: {asset_item_id, qty, ...}
 * @returns {Array} satu baris per item, selalu
 */
export function gabungItemDenganStok({ items = [], stok = [] } = {}) {
  const perItem = new Map();
  for (const s of Array.isArray(stok) ? stok : []) {
    if (s?.asset_item_id) perItem.set(s.asset_item_id, s);
  }

  return (Array.isArray(items) ? items : []).map((i) => {
    const s = perItem.get(i?.id);
    return {
      itemId: i?.id,
      stokId: s?.id ?? null,
      kode: teks(i?.kode),
      name: teks(i?.name),
      category: i?.category ?? null,
      // Ukuran outlet menang kalau ada; kalau tidak, ukuran acuan itemnya.
      size: s?.size ?? i?.size ?? null,
      qty: s ? Number(s.qty) || 0 : 0,
      condition: s?.condition ?? 'normal',
      condition_note: s?.condition_note ?? null,
      notes: s?.notes ?? null,
      photo_path: s?.photo_path ?? null,
      // ============ FOTO ACUAN DARI OUTLET LAIN ============
      //
      // Dipakai hanya kalau outlet ini belum punya fotonya sendiri. Outlet
      // yang belum mendata item ini tidak bisa mengenalinya dari kode dan nama
      // saja — "Botol kris" tidak memberi tahu siapa pun botol yang mana, dan
      // dua outlet lalu mendata dua barang berbeda dengan nama yang sama.
      //
      // Disimpan di kolom SENDIRI, bukan ditimpakan ke `photo_path`. Kalau
      // ditimpakan, layar tidak bisa lagi membedakan "foto barang ini" dari
      // "foto barang serupa milik outlet lain" — dan staff yang mengiranya
      // foto sendiri akan memakainya sebagai bukti kondisi barangnya.
      // ============ TIGA LAPIS, DAN URUTANNYA PENTING ============
      //
      //   1. foto outlet ini sendiri        (`s.photo_path`)
      //   2. foto outlet lain se-BU         (`i.photo_path`, 0171)
      //   3. foto WARISAN dari BU asal      (`i.foto_asal_path`, 0179)
      //
      // Lapis ketiga dipakai saat aset baru saja ditransfer dari BU lain dan
      // belum ada satu pun outlet di sini yang memotretnya. Tanpa lapis itu,
      // barang yang baru datang tampil tanpa foto — dan yang menerimanya
      // tidak punya cara memastikan barang yang mana yang dimaksud.
      photo_acuan: s?.photo_path ? null : (i?.photo_path ?? i?.foto_asal_path ?? null),
      photo_acuan_outlet: s?.photo_path ? null : (i?.photo_outlet_id ?? i?.foto_asal_outlet_id ?? null),
      // Dibedakan supaya layar bisa menyebut asalnya dengan jujur: "foto
      // outlet lain" dan "foto dari BU asal" menuntut tingkat kepercayaan
      // yang berbeda saat dipakai memeriksa kondisi barang.
      photo_acuan_warisan: !s?.photo_path && !i?.photo_path && Boolean(i?.foto_asal_path),
      // Tidak adanya baris stok ADALAH penandanya. Tidak ada kolom tambahan
      // yang bisa basi atau lupa diisi.
      belumDidata: !s,
      updated_at: s?.updated_at ?? null
    };
  });
}

/**
 * Kelompokkan item yang DIDUGA kembar: namanya sama kalau huruf besar dan
 * spasi diabaikan, tapi tersimpan sebagai item berbeda.
 *
 * Ini DUGAAN, bukan vonis. "Kursi Bar" dan "kursi bar" hampir pasti barang
 * yang sama; "Meja 2" dan "meja 2" mungkin juga — tapi yang tahu pasti cuma
 * orang yang berdiri di depan barangnya. Karena itu fungsi ini menyusun
 * daftar untuk DILIHAT, dan tidak pernah menggabungkan apa pun sendiri.
 *
 * @param {Array} items
 * @returns {Array<{namaBaku: string, items: Array}>}
 */
export function dugaanKembar(items = []) {
  const peta = new Map();
  for (const i of Array.isArray(items) ? items : []) {
    const k = namaBaku(i?.name);
    if (!k) continue;
    if (!peta.has(k)) peta.set(k, []);
    peta.get(k).push(i);
  }
  return [...peta.entries()]
    .filter(([, daftar]) => daftar.length > 1)
    .map(([k, daftar]) => ({
      namaBaku: k,
      items: [...daftar].sort((a, b) => urutKode(a?.kode, b?.kode))
    }))
    .sort((a, b) => a.namaBaku.localeCompare(b.namaBaku));
}

/**
 * Apakah nama yang sedang diketik MIRIP dengan item yang sudah ada?
 *
 * Dipakai sebelum menambah item baru. Peringatan, bukan penolakan: barang yang
 * namanya mirip tapi memang berbeda itu ada, dan menolaknya akan membuat
 * pendataan berhenti pada barang yang paling sulit dinamai.
 *
 * @returns {Array} item yang mirip, kosong kalau tidak ada
 */
export function cariMirip(nama, items = []) {
  const k = namaBaku(nama);
  if (!k) return [];
  return (Array.isArray(items) ? items : []).filter((i) => namaBaku(i?.name) === k);
}

/**
 * Ringkasan satu outlet, untuk ditampilkan di atas daftarnya.
 *
 * `belumDidata` dipisahkan dari `nol` dengan sengaja — dua angka itu menuntut
 * tindakan yang berbeda. Yang pertama perlu didatangi, yang kedua sudah selesai.
 */
export function ringkasOutlet(baris = []) {
  const b = Array.isArray(baris) ? baris : [];
  return {
    item: b.length,
    belumDidata: b.filter((r) => r.belumDidata).length,
    nol: b.filter((r) => !r.belumDidata && r.qty === 0).length,
    rusak: b.filter((r) => !r.belumDidata && r.condition === 'rusak').length,
    totalUnit: b.reduce((a, r) => a + (Number(r.qty) || 0), 0)
  };
}

// =========================================================
// RIWAYAT & KERUSAKAN (0170)
// =========================================================

const LABEL_KOLOM = {
  qty: 'Jumlah',
  kondisi: 'Kondisi',
  catatan: 'Catatan',
  nama: 'Nama',
  kategori: 'Kategori',
  outlet: 'Outlet'
};

const LABEL_JENIS = { rusak: 'Rusak', pecah: 'Pecah', hilang: 'Hilang' };

/**
 * Satu baris riwayat jadi KALIMAT.
 *
 * ============ KENAPA BUKAN SEKADAR MENAMPILKAN KOLOMNYA ============
 *
 * Tabel berisi `qty | 12 | 8` memang memuat seluruh faktanya, tapi yang
 * membacanya harus menerjemahkan sendiri — dan ia membacanya justru saat
 * sedang bingung kenapa angkanya tidak cocok. Kalimat "Jumlah 12 → 8"
 * menjawab pertanyaannya tanpa langkah tambahan.
 *
 * Yang paling penting: baris 'rusak' TIDAK dibaca sebagai perubahan kolom.
 * Ia kejadian, dan kalimatnya harus menyebut SEBABNYA — itu satu-satunya
 * alasan baris itu ada.
 */
export function kalimatRiwayat(l) {
  const kolom = LABEL_KOLOM[l?.kolom] ?? teks(l?.kolom);
  const dari = teks(l?.sebelum);
  const ke = teks(l?.sesudah);

  if (l?.aksi === 'rusak') {
    const jenis = LABEL_JENIS[l?.kolom] ?? kolom;
    return `${jenis} ${ke} unit${teks(l?.catatan) ? ` — ${teks(l.catatan)}` : ''}`;
  }
  if (l?.aksi === 'batal-rusak') {
    const jenis = LABEL_JENIS[l?.kolom] ?? kolom;
    return `Pembatalan catatan ${jenis.toLowerCase()} ${dari} unit${teks(l?.catatan) ? ` — ${teks(l.catatan)}` : ''}`;
  }
  if (l?.aksi === 'didata') return `Didata pertama kali: ${ke} unit`;
  if (l?.aksi === 'hapus') return `Dihapus dari outlet ini (terakhir ${dari} unit)`;
  if (l?.aksi === 'pindah') return `Dipindahkan: ${dari || '—'} → ${ke || '—'}`;

  // Kosong DIKATAKAN sebagai "(kosong)", bukan dibiarkan jadi "→ ".
  // Panah yang menunjuk ruang kosong terbaca seperti tampilan yang rusak,
  // bukan seperti catatan yang memang dikosongkan.
  const sisi = (v) => (v === '' ? '(kosong)' : v);
  return `${kolom}: ${sisi(dari)} → ${sisi(ke)}`;
}

/**
 * Rekap kerusakan untuk sebuah daftar kejadian.
 *
 * Yang DIBATALKAN tidak ikut dihitung — barangnya tidak pernah benar-benar
 * hilang. Tapi barisnya tetap ada di daftar, karena pembatalan yang tidak
 * terlihat sama membingungkannya dengan kerusakan yang tidak tercatat.
 */
export function rekapKerusakan(baris = []) {
  const b = (Array.isArray(baris) ? baris : []).filter((r) => !r?.dibatalkan_at);
  const per = {};
  for (const k of Object.keys(LABEL_JENIS)) per[k] = 0;
  for (const r of b) {
    const j = teks(r?.jenis);
    if (per[j] === undefined) per[j] = 0;
    per[j] += Number(r?.qty) || 0;
  }
  return {
    kejadian: b.length,
    dibatalkan: (Array.isArray(baris) ? baris : []).length - b.length,
    unit: b.reduce((a, r) => a + (Number(r?.qty) || 0), 0),
    per
  };
}
