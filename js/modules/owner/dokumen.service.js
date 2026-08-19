import { supabase } from '../../config/supabase-client.js';

/**
 * Dokumen & tanda tangan owner.
 *
 * ============ PDF-LIB, BUKAN JSPDF ============
 *
 * `js/core/pdf.js` memuat jsPDF, dan jsPDF hanya bisa MEMBUAT PDF baru — ia
 * tidak bisa membuka PDF yang sudah ada lalu menambahkan sesuatu ke dalamnya.
 * Menempelkan tanda tangan ke dokumen yang diunggah orang lain menuntut yang
 * kedua. Maka satu pustaka baru dipakai khusus untuk itu, dan hanya dimuat saat
 * layar tanda tangan dibuka — bukan di awal, supaya halaman owner yang cuma
 * melihat KPI tidak ikut menunggu unduhan pustaka yang tidak dipakainya.
 *
 * ============ HASH ============
 *
 * Sidik jari isi berkas dihitung SEBELUM diunggah, disimpan bersama barisnya,
 * dan dibandingkan lagi tepat sebelum ditandatangani. Yang dijaga: berkas
 * ditukar di storage setelah owner membuka tautannya.
 *
 * Yang TIDAK dijaga, dan ini perlu dikatakan: hash dihitung di peramban
 * pengunggah. Pengunggah yang berniat curang bisa mengirim hash yang tidak
 * sesuai isi berkasnya. Menutupnya butuh perhitungan di sisi server. Batas ini
 * juga tertulis di header migration 0094.
 */

let pdfLibPromise = null;

function loadPdfLib() {
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  if (!pdfLibPromise) {
    pdfLibPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
      s.onload = () => (window.PDFLib ? resolve(window.PDFLib) : reject(new Error('Pustaka PDF termuat tapi kosong.')));
      s.onerror = () => reject(new Error('Gagal memuat pustaka tanda tangan PDF (cek koneksi internet).'));
      document.head.appendChild(s);
    });
  }
  return pdfLibPromise;
}

/** SHA-256 sebuah berkas, dalam heksadesimal. */
export async function hashBerkas(file) {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const acak = () => Math.random().toString(36).slice(2, 10);

// =====================================================================
// TANDA TANGAN TERSIMPAN
// =====================================================================

export async function ambilTtdSaya() {
  const { data, error } = await supabase.from('owner_signatures').select('user_id, image_path, updated_at').maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * Simpan/ganti tanda tangan. `blob` berupa PNG berlatar transparan — dihasilkan
 * kanvas di layar, bukan foto, supaya latarnya tidak ikut menutupi teks
 * dokumen saat ditempel.
 */
export async function simpanTtd(blob) {
  const { data: sesi } = await supabase.auth.getUser();
  const uid = sesi?.user?.id;
  if (!uid) throw new Error('Sesi habis, silakan masuk lagi.');

  // Nama berkas selalu baru. Menimpa nama yang sama membuat versi lama tetap
  // tersimpan di cache peramban dan CDN, sehingga tanda tangan yang sudah
  // diganti masih bisa muncul di dokumen berikutnya.
  const path = `${uid}/ttd-${Date.now()}-${acak()}.png`;

  const { error: upErr } = await supabase.storage.from('owner-signature').upload(path, blob, {
    contentType: 'image/png',
    upsert: false
  });
  if (upErr) throw upErr;

  const { error } = await supabase
    .from('owner_signatures')
    .upsert({ user_id: uid, image_path: path, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;

  return path;
}

/** URL sementara untuk menampilkan berkas dari bucket privat. */
export async function urlSementara(bucket, path, detik = 300) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, detik);
  if (error) throw error;
  return data?.signedUrl ?? null;
}

async function unduhBytes(bucket, path) {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) throw error;
  return new Uint8Array(await data.arrayBuffer());
}

// =====================================================================
// DOKUMEN
// =====================================================================

export async function listDokumen({ businessUnitId, status = null }) {
  let q = supabase
    .from('documents')
    .select(
      'id, title, notes, file_path, file_hash, file_size, status, created_at, decided_at, reject_reason, signed_path, sheet_path, outlet_id, ' +
        'pengunggah:user_profiles!uploaded_by(full_name), pemutus:user_profiles!decided_by(full_name), outlets!outlet_id(name)'
    )
    .eq('business_unit_id', businessUnitId)
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function ambilDokumen(id) {
  const { data, error } = await supabase
    .from('documents')
    .select(
      'id, business_unit_id, title, notes, file_path, file_hash, file_size, status, created_at, decided_at, reject_reason, signed_path, sheet_path, outlet_id, ' +
        'pengunggah:user_profiles!uploaded_by(full_name), pemutus:user_profiles!decided_by(full_name), outlets!outlet_id(name)'
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** Unggah PDF baru untuk dimintakan tanda tangan. */
export async function unggahDokumen({ businessUnitId, outletId = null, title, notes = null, file }) {
  if (file.type !== 'application/pdf') throw new Error('Hanya berkas PDF yang bisa dimintakan tanda tangan.');

  const { data: sesi } = await supabase.auth.getUser();
  const uid = sesi?.user?.id;
  if (!uid) throw new Error('Sesi habis, silakan masuk lagi.');

  const hash = await hashBerkas(file);
  const path = `${businessUnitId}/${Date.now()}-${acak()}.pdf`;

  const { error: upErr } = await supabase.storage.from('documents').upload(path, file, {
    contentType: 'application/pdf',
    upsert: false
  });
  if (upErr) throw upErr;

  const { data, error } = await supabase
    .from('documents')
    .insert({
      business_unit_id: businessUnitId,
      outlet_id: outletId,
      title: title.trim(),
      notes: notes?.trim() || null,
      file_path: path,
      file_hash: hash,
      file_size: file.size,
      uploaded_by: uid
    })
    .select('id')
    .single();

  if (error) {
    // Barisnya gagal dibuat, tapi berkasnya sudah telanjur naik. Kalau tidak
    // dibersihkan, bucket menyimpan PDF yang tidak dimiliki baris mana pun —
    // tidak terlihat siapa pun, tidak bisa dihapus lewat aplikasi, dan tetap
    // bisa dibuka oleh siapa saja yang berhak di BU itu.
    await supabase.storage.from('documents').remove([path]);
    throw error;
  }
  return data.id;
}

/**
 * Tempel tanda tangan ke PDF.
 *
 * Ditempatkan di halaman TERAKHIR, kanan bawah, karena di situlah letak tanda
 * tangan pada hampir semua dokumen persetujuan. Ukurannya mengikuti lebar
 * halaman, bukan angka tetap — PDF ukuran A5 dan A3 sama-sama sah, dan lebar
 * tetap akan membuat tanda tangan menutupi separuh halaman pada yang kecil.
 */
async function tempelTtd(pdfBytes, ttdBytes, { nama, waktu }) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const pdf = await PDFDocument.load(pdfBytes);
  const png = await pdf.embedPng(ttdBytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  const halaman = pdf.getPages();
  const hal = halaman[halaman.length - 1];
  const { width } = hal.getSize();

  const lebar = Math.min(160, width * 0.28);
  const skala = lebar / png.width;
  const tinggi = png.height * skala;

  const x = width - lebar - 48;
  const y = 64;

  hal.drawImage(png, { x, y, width: lebar, height: tinggi });
  hal.drawText(nama, { x, y: y - 12, size: 8, font, color: rgb(0.2, 0.2, 0.2) });
  hal.drawText(waktu, { x, y: y - 22, size: 7, font, color: rgb(0.45, 0.45, 0.45) });

  return pdf.save();
}

/**
 * Lembar Pengesahan — halaman terpisah yang memuat keterangan pengesahan.
 *
 * Ada DUA berkas hasil, dan itu disengaja. PDF bertandatangan enak dikirim ke
 * pihak luar; Lembar Pengesahan memuat hal-hal yang tidak pantas dicoretkan ke
 * atas dokumen aslinya — sidik jari berkas, waktu menurut server, dan
 * pernyataan sejauh mana tanda tangan ini berlaku.
 */
async function buatLembarPengesahan({ dokumen, nama, waktu, ttdBytes }) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const pdf = await PDFDocument.create();
  const hal = pdf.addPage([595, 842]); // A4 potret
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const tebal = await pdf.embedFont(StandardFonts.HelveticaBold);

  let y = 780;
  const tulis = (teks, { size = 10, f = font, jarak = 18, warna = rgb(0.1, 0.1, 0.1) } = {}) => {
    hal.drawText(String(teks ?? '-'), { x: 56, y, size, font: f, color: warna });
    y -= jarak;
  };

  tulis('LEMBAR PENGESAHAN', { size: 16, f: tebal, jarak: 30 });
  tulis('Berjaya Hub', { size: 10, warna: rgb(0.45, 0.45, 0.45), jarak: 34 });

  tulis('Judul dokumen', { size: 8, warna: rgb(0.45, 0.45, 0.45), jarak: 13 });
  tulis(dokumen.title, { size: 12, f: tebal, jarak: 26 });

  tulis('Diunggah oleh', { size: 8, warna: rgb(0.45, 0.45, 0.45), jarak: 13 });
  tulis(dokumen.pengunggah?.full_name ?? '-', { jarak: 24 });

  tulis('Disahkan oleh', { size: 8, warna: rgb(0.45, 0.45, 0.45), jarak: 13 });
  tulis(nama, { size: 12, f: tebal, jarak: 24 });

  tulis('Waktu pengesahan (WIB, menurut jam server)', { size: 8, warna: rgb(0.45, 0.45, 0.45), jarak: 13 });
  tulis(waktu, { jarak: 24 });

  tulis('Sidik jari berkas (SHA-256)', { size: 8, warna: rgb(0.45, 0.45, 0.45), jarak: 13 });
  // Dipotong dua baris: 64 karakter tidak muat dalam satu baris A4 pada ukuran
  // yang masih terbaca, dan hash yang terpotong di tepi halaman tidak bisa
  // dipakai memverifikasi apa pun.
  tulis(dokumen.file_hash?.slice(0, 32) ?? '-', { size: 9, jarak: 12 });
  tulis(dokumen.file_hash?.slice(32) ?? '', { size: 9, jarak: 30 });

  if (ttdBytes) {
    const png = await pdf.embedPng(ttdBytes);
    const lebar = Math.min(180, 595 * 0.3);
    const skala = lebar / png.width;
    hal.drawImage(png, { x: 56, y: y - png.height * skala, width: lebar, height: png.height * skala });
    y -= png.height * skala + 24;
  }

  // Batas keberlakuan ditulis DI DALAM lembarnya, bukan hanya di kode. Lembar
  // yang menyatakan lebih dari yang bisa dibuktikannya justru merugikan yang
  // menandatangani.
  const batas = [
    'Pengesahan ini dicatat di basis data Berjaya Hub beserta identitas',
    'penanda tangan dan waktu menurut jam server. Gambar tanda tangan pada',
    'dokumen ini bukan tanda tangan elektronik tersertifikasi. Keaslian berkas',
    'dapat diperiksa dengan membandingkan sidik jari di atas terhadap berkas',
    'aslinya.'
  ];
  y -= 8;
  for (const baris of batas) {
    hal.drawText(baris, { x: 56, y, size: 8, font, color: rgb(0.45, 0.45, 0.45) });
    y -= 12;
  }

  return pdf.save();
}

/**
 * Tandatangani sebuah dokumen.
 *
 * Urutannya penting dan sengaja: berkas dibuat & diunggah DULU, barisnya
 * diputus BELAKANGAN. Kalau dibalik, kegagalan saat menempel tanda tangan akan
 * meninggalkan baris berstatus 'ditandatangani' yang berkas hasilnya tidak
 * pernah ada — dan halaman akan menampilkannya sebagai sudah sah.
 *
 * (Constraint `documents_keputusan_utuh` di 0094 menolak keadaan itu di tingkat
 * database juga. Dua lapis, karena yang satu ini yang menentukan urutan dan
 * yang satu lagi yang menjamin tidak ada jalan lain.)
 */
export async function tandatanganiDokumen({ dokumen, namaPenandaTangan }) {
  const ttd = await ambilTtdSaya();
  if (!ttd?.image_path) throw new Error('Tanda tangan belum tersimpan. Buat dulu di tab Tanda Tangan.');

  const [asli, ttdBytes] = await Promise.all([
    unduhBytes('documents', dokumen.file_path),
    unduhBytes('owner-signature', ttd.image_path)
  ]);

  // Sidik jari DIHITUNG ULANG dari berkas yang baru saja diunduh — bukan
  // dipercaya dari kolomnya. Perbandingannya nanti dikerjakan lagi di database
  // (0094), tapi memeriksanya di sini membuat penolakannya bisa dijelaskan
  // sebelum berkas hasil telanjur dibuat dan diunggah.
  const hashSekarang = [...new Uint8Array(await crypto.subtle.digest('SHA-256', asli))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  if (hashSekarang !== dokumen.file_hash) {
    throw new Error('Isi dokumen berbeda dengan yang diunggah semula. Penandatanganan dibatalkan — minta pengunggah mengirim ulang.');
  }

  const waktu = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const [bertandaTangan, lembar] = await Promise.all([
    tempelTtd(asli, ttdBytes, { nama: namaPenandaTangan, waktu }),
    buatLembarPengesahan({ dokumen, nama: namaPenandaTangan, waktu, ttdBytes })
  ]);

  const dasar = `${dokumen.business_unit_id}/${Date.now()}-${acak()}`;
  const pathTtd = `${dasar}-ttd.pdf`;
  const pathLembar = `${dasar}-pengesahan.pdf`;

  const naik = async (path, bytes) => {
    const { error } = await supabase.storage.from('documents').upload(path, new Blob([bytes], { type: 'application/pdf' }), {
      contentType: 'application/pdf',
      upsert: false
    });
    if (error) throw error;
  };
  await naik(pathTtd, bertandaTangan);
  await naik(pathLembar, lembar);

  const { data, error } = await supabase.rpc('putuskan_dokumen', {
    p_dokumen: dokumen.id,
    p_status: 'ditandatangani',
    p_hash_saat_tanda_tangan: dokumen.file_hash,
    p_signed_path: pathTtd,
    p_sheet_path: pathLembar,
    p_alasan: null
  });
  if (error) {
    // Keputusannya ditolak database (mis. sudah diputus orang lain lebih dulu).
    // Berkas hasil yang telanjur naik dibuang supaya tidak ada PDF
    // "bertandatangan" yang beredar tanpa keputusan di belakangnya.
    await supabase.storage.from('documents').remove([pathTtd, pathLembar]);
    throw error;
  }
  return data;
}

export async function tolakDokumen({ dokumenId, alasan }) {
  const teks = (alasan ?? '').trim();
  if (!teks) throw new Error('Penolakan harus disertai alasan.');

  const { data, error } = await supabase.rpc('putuskan_dokumen', {
    p_dokumen: dokumenId,
    p_status: 'ditolak',
    p_hash_saat_tanda_tangan: null,
    p_signed_path: null,
    p_sheet_path: null,
    p_alasan: teks
  });
  if (error) throw error;
  return data;
}

/** Tautan yang dikirim ke owner lewat chat. */
export function tautanDokumen(id) {
  const dasar = window.location.href.replace(/[^/]*$/, '');
  return `${dasar}owner.html?dok=${encodeURIComponent(id)}`;
}
