/**
 * Perkiraan berapa menu yang masih BISA DIBUAT dari stok yang ada.
 *
 * Tidak ada impor di file ini, dan sebaiknya tetap begitu: angka ini yang
 * dipakai staff memutuskan menu apa yang masih dijual hari itu, dan angka yang
 * tidak bisa diuji di luar browser adalah angka yang tidak pernah benar-benar
 * diperiksa.
 *
 * =====================================================================
 * SATU TINGKAT SAJA — DAN ITU DISENGAJA
 * =====================================================================
 *
 * Berbeda dari "bahan menipis" (yang membentangkan resep sampai bahan baku),
 * perhitungan di sini BERHENTI di bahan langsung resepnya.
 *
 * Alasannya: pertanyaannya berbeda.
 *
 *   - "Bahan menipis" bertanya APA YANG HARUS DIBELI. Untuk itu cabai yang
 *     dipakai membuat sambal memang harus ikut dihitung.
 *   - Layar ini bertanya BERAPA PORSI YANG BISA DIBUAT SEKARANG. Sambal yang
 *     sudah jadi dan ada di kulkas bisa langsung dipakai — cabainya tidak
 *     relevan lagi.
 *
 * Kalau resepnya dibentangkan sampai bahan baku di sini, sambal siap pakai
 * akan diabaikan dan menunya dilaporkan tidak bisa dibuat padahal bahannya ada
 * di depan mata. Kesalahan yang membuat staff berhenti mempercayai angkanya.
 *
 * =====================================================================
 * PEMBATASNYA ADALAH BAHAN YANG PALING CEPAT HABIS
 * =====================================================================
 *
 * Satu menu butuh beberapa bahan sekaligus. Yang menentukan bukan rata-rata,
 * melainkan yang PALING SEDIKIT: punya 100 porsi nasi tapi cuma 3 potong ayam
 * berarti 3 porsi, bukan 51.
 *
 * Dibulatkan ke BAWAH. Setengah porsi tidak bisa dijual, dan membulatkan ke
 * atas berarti menjanjikan porsi yang bahannya tidak ada.
 */

/** Ambang yang dianggap nol — melindungi dari sisa pembagian floating point. */
const EPS = 1e-9;

/**
 * @param {object|null} resep `{yield_qty, items:[{ingredient_product_id, qty}]}`
 * @param {Map<string, number>} stok productId → jumlah
 * @returns {{bisa: number|null, sebab: 'ok'|'tanpa-resep'|'resep-kosong', pembatas: string|null}}
 */
export function perkiraanMenu(resep, stok) {
  if (!resep) return { bisa: null, sebab: 'tanpa-resep', pembatas: null };

  const items = resep.items ?? [];
  const yieldQty = Number(resep.yield_qty) > 0 ? Number(resep.yield_qty) : 1;

  let bisa = Infinity;
  let pembatas = null;
  let adaBahan = false;

  for (const it of items) {
    const butuh = Number(it.qty) / yieldQty;
    // Bahan dengan takaran 0 atau tidak masuk akal tidak membatasi apa pun —
    // dan TIDAK boleh menghasilkan pembagian dengan nol yang diam-diam
    // berubah jadi Infinity lalu terbaca sebagai "tak terbatas".
    if (!Number.isFinite(butuh) || butuh <= EPS) continue;
    adaBahan = true;

    const ada = Number(stok?.get(it.ingredient_product_id) ?? 0);

    // TOLERANSI SEBELUM DIBULATKAN KE BAWAH — bukan kemewahan.
    //
    // 0,6 kg ayam dengan takaran 0,2 kg/porsi jelas 3 porsi. Tapi di floating
    // point 0.6 / 0.2 = 2.9999999999999996, dan `Math.floor` memotongnya jadi
    // **2**. Staff melihat stok cukup di depan mata sementara layar bilang
    // kurang satu — dan tidak ada error apa pun yang menjelaskannya.
    //
    // Tes yang menangkap ini ditulis sebelum kodenya dianggap selesai; tanpa
    // itu, angkanya akan salah satu porsi pada takaran desimal apa pun dan
    // tetap terlihat masuk akal.
    const dapat = Math.floor((Number.isFinite(ada) ? ada : 0) / butuh + EPS);
    if (dapat < bisa) {
      bisa = dapat;
      pembatas = it.ingredient_product_id;
    }
  }

  if (!adaBahan) return { bisa: null, sebab: 'resep-kosong', pembatas: null };
  return { bisa: Math.max(0, bisa), sebab: 'ok', pembatas };
}

/** Bahan yang terpakai kalau sebuah menu dibuat sebanyak `jumlah` porsi. */
function pemakaianMenu(resep, jumlah) {
  const out = new Map();
  if (!resep || !(jumlah > 0)) return out;
  const yieldQty = Number(resep.yield_qty) > 0 ? Number(resep.yield_qty) : 1;
  for (const it of resep.items ?? []) {
    const butuh = Number(it.qty) / yieldQty;
    if (!Number.isFinite(butuh) || butuh <= EPS) continue;
    out.set(it.ingredient_product_id, (out.get(it.ingredient_product_id) ?? 0) + butuh * jumlah);
  }
  return out;
}

/**
 * Perkiraan untuk SEMUA menu sekaligus.
 *
 * `mode` ditentukan peran outletnya — gerai yang dilayani CK memakai resep
 * varian CK, yang memasak sendiri memakai Standalone. TIDAK ADA CADANGAN ke
 * varian lain: menu yang belum punya resep pada varian yang berlaku memang
 * belum bisa dihitung, dan memakai resep varian lain akan melaporkan angka
 * dari cara kerja yang bukan cara kerja outlet itu.
 *
 * =====================================================================
 * SATU BAHAN DIPAKAI BEBERAPA MENU — YANG SUDAH DIJANJIKAN DIKURANGKAN
 * =====================================================================
 *
 * Versi pertama menghitung tiap menu SENDIRI-SENDIRI, seolah cuma menu itu
 * yang dibuat. Tiap angkanya benar satu per satu, tapi bersama-sama menipu:
 *
 *   Ayam 1 kg → Nasi Ayam (0,2/porsi) 5 · Soto (0,1) 10 · Ayam Goreng (0,25) 4
 *   Kalau ketiganya benar-benar dibuat sebanyak itu: 3 kg ayam. Yang ada 1 kg.
 *
 * Layar itu menjanjikan tiga kali lipat dari yang ada, dan tidak ada apa pun
 * yang menandakannya.
 *
 * Sekarang jumlah yang SUDAH DIISI staff untuk menu lain dikurangkan lebih
 * dulu dari stoknya. Datanya memang sudah ada di layar yang sama — kolom
 * "Jumlah tersedia" — jadi ini bukan tebakan, melainkan konsekuensi dari
 * pilihan yang baru saja dibuat orangnya.
 *
 * MENU ITU SENDIRI TIDAK MENGURANGI DIRINYA. Kalau ikut dikurangkan, mengisi
 * Nasi Ayam 3 akan langsung menurunkan angka Nasi Ayam sendiri — orangnya
 * mengetik lalu melihat sisanya menyusut, dan tidak ada cara membedakan
 * "sudah saya pakai" dari "ternyata tidak cukup". Yang ditanyakan barisnya
 * tetap sama: berapa yang bisa dibuat, kalau sisanya dipakai untuk ini.
 *
 * @param {Map<string, number>} [rencana] menuId → jumlah yang sudah diisi
 * @returns {Map<string, {bisa, sebab, pembatas, dikurangi: boolean}>}
 */
export function petaPerkiraan({ menus, recipes, stok, mode, rencana = new Map() }) {
  const perKunci = new Map((recipes ?? []).map((r) => [`${r.product_id}|${r.mode}`, r]));
  const daftar = menus ?? [];

  // Pemakaian tiap menu menurut jumlah yang sudah diisi, lalu totalnya.
  const perMenu = new Map();
  const total = new Map();
  for (const m of daftar) {
    const pakai = pemakaianMenu(perKunci.get(`${m.id}|${mode}`) ?? null, Number(rencana?.get(m.id) ?? 0));
    perMenu.set(m.id, pakai);
    for (const [bid, q] of pakai) total.set(bid, (total.get(bid) ?? 0) + q);
  }

  const out = new Map();
  for (const m of daftar) {
    const resep = perKunci.get(`${m.id}|${mode}`) ?? null;
    const milikSendiri = perMenu.get(m.id) ?? new Map();
    // Bahan yang BENAR-BENAR dipakai menu ini. Dipakai menentukan apakah
    // pengurangannya berarti untuk baris ini.
    const bahanku = new Set((resep?.items ?? []).map((it) => it.ingredient_product_id));
    let dikurangi = false;

    // Stok yang tersisa untuk menu ini = stok − pemakaian menu LAIN.
    const sisa = new Map(stok ?? []);
    for (const [bid, q] of total) {
      const lain = q - (milikSendiri.get(bid) ?? 0);
      if (lain <= EPS) continue;
      // Penandanya hanya menyala kalau bahan itu memang dipakai menu ini.
      //
      // Versi pertama menyalakannya untuk SETIAP bahan yang berkurang di mana
      // pun — jadi Es Teh ikut ditandai "dikurangi" hanya karena ada orang
      // mengisi Nasi Ayam, padahal keduanya tidak berbagi satu bahan pun.
      // Penanda yang menyala tanpa sebab mengajari orang mengabaikannya, dan
      // sesudah itu ia tidak berguna justru saat benar-benar berarti.
      if (bahanku.has(bid)) dikurangi = true;
      // Tidak pernah minus: stok yang sudah dijanjikan berlebih berarti nol
      // tersisa, bukan utang.
      //
      // PERLU DICATAT JUJUR bahwa penjepitan ini BUKAN penjaganya — sabotase
      // yang membuangnya tidak membuat satu pun tes merah, karena
      // `perkiraanMenu()` sudah menjepit hasil akhirnya di `Math.max(0, …)`.
      // Ini pertahanan berlapis, dan gunanya cuma satu: peta `sisa` tetap
      // masuk akal kalau suatu saat ia dibaca untuk keperluan lain.
      sisa.set(bid, Math.max(0, Number(sisa.get(bid) ?? 0) - lain));
    }

    out.set(m.id, { ...perkiraanMenu(resep, sisa), dikurangi });
  }
  return out;
}

/** Label pendek untuk ditaruh di sebelah kotak isian. */
export function labelPerkiraan(hasil) {
  if (!hasil || hasil.bisa == null) return 'resep belum diatur';
  if (hasil.bisa === 0) return 'bahan habis';
  return `bisa dibuat ± ${hasil.bisa}`;
}
