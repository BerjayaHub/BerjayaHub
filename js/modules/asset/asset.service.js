import { supabase } from '../../config/supabase-client.js';
import { compressImage } from '../../core/image-compress.js';
import { ambilSemua } from '../../core/ambil-semua.js';

export const ASSET_CONDITION = { normal: 'Normal', rusak: 'Rusak', lainnya: 'Lain-lain' };
export const ASSET_CONDITION_BADGE = { normal: 'badge-approved', rusak: 'badge-rejected', lainnya: 'badge-pending' };
export const ASSET_CONDITION_OPTIONS = Object.entries(ASSET_CONDITION).map(([value, label]) => ({ value, label }));

/** Label kondisi siap tampil: "Lain-lain" selalu disertai catatannya. */
export function conditionText(a) {
  const base = ASSET_CONDITION[a.condition] ?? a.condition;
  return a.condition === 'lainnya' && a.condition_note ? `${base} — ${a.condition_note}` : base;
}

export async function listAssets({ businessUnitId, outletId, condition, category, q, limit = 500 }) {
  let query = supabase
    .from('assets')
    // Tanpa embed nama pendaftar: layar aset tidak menggambarnya, dan embed
    // yang gagal membatalkan SELURUH query (lihat 0086).
    .select('*, outlets!outlet_id(name)')
    .eq('business_unit_id', businessUnitId)
    .order('name')
    .limit(limit);
  if (outletId) query = query.eq('outlet_id', outletId);
  if (condition) query = query.eq('condition', condition);
  if (category) query = query.eq('category', category);
  if (q) query = query.ilike('name', `%${q}%`);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/**
 * Daftar kategori yang SUDAH dipakai di BU ini.
 *
 * Sengaja dibangun dari nilai yang ada, bukan dari tabel referensi — sama
 * seperti kategori di Master Produk. Menambah kategori berarti mengetik nama
 * baru; tidak ada langkah "buat kategori dulu" yang harus dikerjakan admin
 * sebelum staff bisa mencatat barang.
 *
 * Diambil TANPA batas baris: daftar yang terpotong akan menyembunyikan
 * kategori lama dari kotak pencarian, dan orang akan membuat duplikatnya.
 */
export async function listKategoriAset(businessUnitId) {
  const rows = await ambilSemua((dari, sampai) =>
    supabase
      .from('assets')
      .select('category', { count: 'exact' })
      .eq('business_unit_id', businessUnitId)
      .not('category', 'is', null)
      .range(dari, sampai)
  );

  return [...new Set((rows ?? []).map((r) => r.category?.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'id')
  );
}

/**
 * Pindahkan aset ke outlet/BU lain — LEWAT RPC, bukan `update` biasa.
 *
 * PostgREST membalas SUKSES DENGAN NOL BARIS saat RLS menolak. Pemindahan
 * massal 40 aset yang seluruhnya ditolak akan terlihat berhasil, dan yang
 * mencarinya di outlet tujuan tidak akan menemukannya. RPC-nya mengembalikan
 * jumlah yang benar-benar berpindah supaya layar bisa mengatakan apa adanya.
 *
 * Alasan lengkapnya di kepala migration 0102.
 */
export async function pindahAset({ ids, businessUnitId, outletId }) {
  const { data, error } = await supabase.rpc('pindah_aset', {
    p_ids: ids,
    p_bu: businessUnitId,
    p_outlet: outletId
  });
  if (error) throw error;
  return data ?? { pindah: 0, ditolak: 0, ganti_outlet: 0 };
}

/**
 * Pindahkan BERKAS foto ke folder outlet baru.
 *
 * Harus dikerjakan dari klien: memindahkan objek storage tidak bisa dilakukan
 * dari dalam SQL. `pindah_aset()` sudah mengosongkan `photo_path` bagi yang
 * berganti outlet, jadi kegagalan di sini berakhir sebagai aset tanpa foto —
 * bukan aset dengan tautan yang selalu gagal dibuka.
 *
 * Dikerjakan SATU PER SATU, bukan serentak: puluhan penyalinan berbarengan
 * membuat sebagian permintaan tertunda lama atau ditolak, dan hasilnya
 * "sebagian fotonya hilang" tanpa sebab yang jelas.
 */
export async function pindahFotoAset(daftar) {
  let berhasil = 0;
  const gagal = [];

  for (const { assetId, dariPath, keOutletId } of daftar) {
    if (!dariPath || !keOutletId) continue;
    const ext = (dariPath.split('.').pop() || 'jpg').toLowerCase();
    const tujuan = `${keOutletId}/${assetId}.${ext}`;

    try {
      // `move` memindahkan tanpa mengunduh isinya — jauh lebih hemat daripada
      // unduh-lalu-unggah, dan tidak ada jendela waktu dengan dua salinan.
      const { error } = await supabase.storage.from('asset-photos').move(dariPath, tujuan);
      if (error) throw error;

      // `.select()`: penolakan RLS pada UPDATE membalas sukses dengan 0 baris.
      const { data, error: upErr } = await supabase
        .from('assets')
        .update({ photo_path: tujuan })
        .eq('id', assetId)
        .select('id');
      if (upErr) throw upErr;
      if (!data?.length) throw new Error('path foto tidak tercatat');

      berhasil++;
    } catch (error) {
      gagal.push({ assetId, sebab: error?.message ?? String(error) });
    }
  }

  return { berhasil, gagal };
}

async function currentUserId() {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * Simpan aset (tambah / ubah) beserta fotonya.
 * Foto diunggah SETELAH baris ada, karena path-nya memakai id aset — dengan
 * begitu satu aset selalu punya paling banyak satu foto dan tidak ada file
 * yatim saat penyimpanan gagal.
 */
export async function saveAsset({ id, businessUnitId, outletId, name, category, qty, size, condition, conditionNote, notes, file }) {
  const uid = await currentUserId();
  if (!uid) throw new Error('Sesi tidak ditemukan, silakan login ulang.');

  const payload = {
    business_unit_id: businessUnitId,
    outlet_id: outletId,
    name: name.trim(),
    category: category?.trim() || null,
    qty: Number(qty) || 0,
    size: size?.trim() || null,
    condition,
    // Catatan hanya relevan untuk "Lain-lain" — dibersihkan supaya tidak
    // menyisakan keterangan lama yang menyesatkan saat kondisi diubah.
    condition_note: condition === 'lainnya' ? conditionNote?.trim() || null : null,
    notes: notes?.trim() || null,
    updated_by: uid,
    updated_at: new Date().toISOString()
  };

  let assetId = id;
  if (id) {
    // `.select()`: penolakan RLS pada UPDATE membalas sukses dengan 0 baris.
    // Tanpa ini, mengubah aset outlet lain terlihat berhasil dan datanya tidak
    // berubah sedikit pun.
    const { data, error } = await supabase.from('assets').update(payload).eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('Tidak tersimpan — aset ini di luar outlet yang bisa kamu kelola.');
  } else {
    const { data, error } = await supabase
      .from('assets')
      .insert({ ...payload, created_by: uid })
      .select('id')
      .single();
    if (error) throw error;
    assetId = data.id;
  }

  if (file) {
    // Dikompres SEBELUM path dihitung, karena ekstensinya ikut berubah
    // (webp/jpg). Foto kamera 3 MB jadi ~200 KB — free tier Supabase cuma 1 GB.
    const kecil = await compressImage(file, { preset: 'asset' });
    const ext = (kecil.name?.split('.').pop() || 'jpg').toLowerCase();
    const path = `${outletId}/${assetId}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('asset-photos')
      .upload(path, kecil, { upsert: true, contentType: kecil.type || 'image/jpeg' });
    if (upErr) throw upErr;
    // Fotonya sudah terlanjur terunggah; kalau penyimpanan path-nya ditolak,
    // aset akan punya foto yang tidak pernah bisa ditemukan lagi. Lebih baik
    // gagal dengan lantang di sini.
    const { data: updRow, error: updErr } = await supabase
      .from('assets')
      .update({ photo_path: path })
      .eq('id', assetId)
      .select('id');
    if (updErr) throw updErr;
    if (!updRow?.length) throw new Error('Foto terunggah tapi tidak tercatat — aset ini di luar outlet yang bisa kamu kelola.');
    await hapusFotoSisa(`${outletId}/${assetId}`, path);
  }
  return assetId;
}

/**
 * Hapus foto aset yang sama tapi berekstensi lain.
 *
 * KENAPA PERLU: `upsert` hanya menimpa path yang PERSIS sama. Begitu kompresi
 * mengubah ekstensinya (mis. foto lama `.jpg`, foto baru `.webp`), file lama
 * tidak tertimpa — ia menjadi yatim dan tetap memakan kuota selamanya. Ironis
 * kalau justru muncul dari perubahan yang tujuannya menghemat storage.
 *
 * Kegagalan diabaikan: fotonya sudah tersimpan dengan benar, dan menggagalkan
 * penyimpanan aset hanya karena sisa file lama tidak terhapus jelas berlebihan.
 */
async function hapusFotoSisa(basePath, pathTerpakai) {
  const kandidat = ['jpg', 'jpeg', 'png', 'webp']
    .map((e) => `${basePath}.${e}`)
    .filter((p) => p !== pathTerpakai);
  try {
    await supabase.storage.from('asset-photos').remove(kandidat);
  } catch (error) {
    console.warn('[aset] sisa foto lama tidak terhapus:', error?.message ?? error);
  }
}

/**
 * Hapus aset beserta fotonya.
 *
 * `.select()` di akhir BUKAN hiasan. RLS `assets_delete` hanya mengizinkan
 * admin outlet, dan PostgREST TIDAK menganggap "tidak ada baris yang boleh
 * dihapus" sebagai error — ia membalas sukses dengan 0 baris. Tanpa pemeriksaan
 * ini, staff biasa menekan Hapus, melihat notifikasi "Aset dihapus", lalu
 * bingung karena barangnya masih ada. Kebohongan yang meyakinkan jauh lebih
 * buruk daripada pesan penolakan yang jujur.
 */
export async function deleteAsset(id) {
  // Path fotonya dibaca DULU: setelah barisnya hilang, tidak ada lagi cara
  // menemukan file itu dan ia jadi sampah permanen di storage.
  const { data: aset } = await supabase.from('assets').select('photo_path').eq('id', id).maybeSingle();

  const { data, error } = await supabase.from('assets').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) {
    throw new Error('Tidak bisa dihapus — hanya admin outlet yang boleh menghapus aset.');
  }

  if (aset?.photo_path) {
    try {
      await supabase.storage.from('asset-photos').remove([aset.photo_path]);
    } catch (err) {
      console.warn('[aset] foto tidak ikut terhapus:', err?.message ?? err);
    }
  }
}

export async function getAssetPhotoUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from('asset-photos').createSignedUrl(path, 600);
  if (error) throw error;
  return data?.signedUrl ?? null;
}

/**
 * Signed URL untuk BANYAK foto sekaligus.
 *
 * Satu panggilan untuk semua, bukan satu per baris: tabel dengan 100 aset akan
 * menembakkan 100 permintaan jaringan berbarengan, dan sebagian akan ditolak
 * atau tertunda lama — tabelnya lalu tampak "sebagian fotonya rusak" padahal
 * hanya kena antrean.
 *
 * Gagal = Map kosong, bukan lempar error. Foto adalah pelengkap; daftar aset
 * harus tetap tampil meski fotonya tidak bisa diambil.
 */
export async function getAssetPhotoUrls(paths, expiresIn = 3600) {
  const bersih = [...new Set((paths ?? []).filter(Boolean))];
  if (!bersih.length) return new Map();
  const { data, error } = await supabase.storage.from('asset-photos').createSignedUrls(bersih, expiresIn);
  if (error) {
    console.warn('[aset] gagal membuat signed URL foto:', error.message);
    return new Map();
  }
  return new Map((data ?? []).filter((d) => d.signedUrl && !d.error).map((d) => [d.path, d.signedUrl]));
}
