/**
 * Kompresi gambar di SISI KLIEN, sebelum diunggah ke Supabase Storage.
 *
 * KENAPA PENTING: foto dari kamera HP berukuran 2-4 MB. Free tier Supabase
 * hanya 1 GB, jadi ~300 foto mentah sudah menghabiskan seluruh kuota. Yang
 * paling berbahaya bukan foto aset (bertambah sesekali) melainkan selfie
 * presensi — 2 foto per orang per hari, tumbuh setiap hari selamanya.
 *
 * Dikompres di klien, bukan di server, karena: (1) tidak ada biaya komputasi
 * server sama sekali, (2) yang melintasi jaringan sudah kecil — staff di sinyal
 * lemah tidak perlu mengunggah 3 MB, dan (3) tidak ada jendela waktu di mana
 * file mentah sempat tersimpan.
 *
 * BUKAN alat keamanan. Kompresi hanya soal ukuran; validasi tipe file tetap
 * dilakukan lewat `accept` dan policy Storage.
 */

/** Ukuran sisi terpanjang (px) per jenis pemakaian. */
export const PRESET = {
  // Barang inventaris: perlu detail supaya nomor seri / kerusakan kecil terbaca.
  asset: { maxPx: 1280, quality: 0.8 },
  // Selfie presensi: cukup untuk mengenali wajah, dan jumlahnya paling banyak.
  selfie: { maxPx: 1280, quality: 0.75 },
  // Bukti kas: sering berisi tulisan nota, jadi jangan terlalu kecil.
  bukti: { maxPx: 1280, quality: 0.78 },
  // Daily Activities: satu foto PER ITEM, jadi jumlahnya ~10x lipat sesi.
  // Pertanyaan yang dijawab foto ini cuma satu — bersih atau tidak — dan 900px
  // sudah lebih dari cukup untuk itu.
  aktivitas: { maxPx: 900, quality: 0.72 },
  // Foto profil selalu ditampilkan kecil (avatar), tidak perlu besar.
  avatar: { maxPx: 512, quality: 0.82 }
};

/**
 * Apakah encoder WebP tersedia di browser ini.
 *
 * TIDAK boleh ditebak dari user-agent. Sebagian Safari bisa MENAMPILKAN WebP
 * tapi tidak bisa MEMBUATNYA — dan `toDataURL('image/webp')` di browser itu
 * diam-diam mengembalikan PNG, bukan error. Jadi satu-satunya cara yang jujur
 * adalah mencoba lalu memeriksa hasilnya benar-benar berawalan WebP.
 */
let dukunganWebp = null;
function webpDidukung() {
  if (dukunganWebp !== null) return dukunganWebp;
  try {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    dukunganWebp = c.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    dukunganWebp = false;
  }
  return dukunganWebp;
}

function canvasKeBlob(canvas, mime, quality) {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob === 'function') canvas.toBlob((b) => resolve(b), mime, quality);
    else resolve(null);
  });
}

/**
 * Muat file jadi bitmap dengan orientasi yang sudah benar.
 *
 * `createImageBitmap` dengan imageOrientation:'from-image' memutar foto sesuai
 * EXIF. Tanpa itu, foto potret dari HP tersimpan MIRING setelah digambar ulang
 * ke canvas — canvas mengabaikan EXIF, jadi masalahnya baru muncul SETELAH
 * kompresi diaktifkan dan mudah disalahartikan sebagai bug kamera.
 */
async function muatBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Sebagian browser lama menolak opsi itu — coba tanpa opsi.
      try {
        return await createImageBitmap(file);
      } catch {
        /* jatuh ke <img> di bawah */
      }
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Gambar tidak bisa dibaca.'));
    };
    img.src = url;
  });
}

/**
 * Kompres satu file gambar.
 *
 * @param {File} file
 * @param {{maxPx?:number, quality?:number, preset?:keyof PRESET}} opts
 * @returns {Promise<File>} file baru yang lebih kecil — ATAU file aslinya kalau
 *   kompresi tidak mungkin/tidak menguntungkan.
 *
 * SENGAJA TIDAK PERNAH MELEMPAR ERROR. Kompresi adalah optimasi; kalau gagal,
 * yang benar adalah tetap mengunggah file aslinya, bukan menggagalkan pekerjaan
 * staff yang sedang berdiri di depan outlet.
 */
export async function compressImage(file, opts = {}) {
  if (!file || !file.type?.startsWith('image/')) return file;
  // GIF animasi akan kehilangan animasinya kalau digambar ke canvas. Tidak
  // dipakai di aplikasi ini, tapi lebih baik dilewati daripada dirusak diam-diam.
  if (file.type === 'image/gif') return file;

  const { maxPx = 1280, quality = 0.8 } = opts.preset ? PRESET[opts.preset] ?? {} : opts;

  let bitmap;
  try {
    bitmap = await muatBitmap(file);
  } catch {
    return file;
  }

  const lebarAsli = bitmap.width;
  const tinggiAsli = bitmap.height;
  if (!lebarAsli || !tinggiAsli) return file;

  // Jangan pernah MEMPERBESAR: skala dibatasi maksimal 1.
  const skala = Math.min(1, maxPx / Math.max(lebarAsli, tinggiAsli));
  const w = Math.max(1, Math.round(lebarAsli * skala));
  const h = Math.max(1, Math.round(tinggiAsli * skala));

  let blob = null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    // Latar putih: WebP/JPEG tidak menyimpan transparansi dengan cara yang sama,
    // dan tanpa ini area transparan (mis. PNG) jadi hitam.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);

    if (webpDidukung()) blob = await canvasKeBlob(canvas, 'image/webp', quality);
    if (!blob || blob.type !== 'image/webp') blob = await canvasKeBlob(canvas, 'image/jpeg', quality);
  } catch {
    return file;
  } finally {
    bitmap.close?.();
  }

  if (!blob) return file;

  // Kalau hasilnya justru lebih besar (foto yang memang sudah kecil dan
  // teroptimasi), pakai yang asli. Mengunggah versi "terkompres" yang lebih
  // besar adalah kerugian murni.
  if (blob.size >= file.size) return file;

  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
  const dasar = (file.name || 'foto').replace(/\.[^.]+$/, '');
  return new File([blob], `${dasar}.${ext}`, { type: blob.type, lastModified: Date.now() });
}

/** Ringkasan hemat, untuk pesan ke user & debugging. */
export function ringkasanUkuran(sebelum, sesudah) {
  const kb = (n) => `${Math.round(n / 1024)} KB`;
  if (sesudah >= sebelum) return kb(sesudah);
  const persen = Math.round((1 - sesudah / sebelum) * 100);
  return `${kb(sebelum)} → ${kb(sesudah)} (−${persen}%)`;
}
