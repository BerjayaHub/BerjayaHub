/**
 * LAYANAN MODUL KONTEN SOSMED.
 *
 * Berkasnya di Cloudflare R2, barisnya di Supabase. Berkas tidak pernah
 * melewati Supabase sama sekali: Edge Function `konten-r2` menerbitkan URL
 * bertanda tangan, dan browser mengirim/mengambil langsung ke R2.
 */
import { supabase } from '../../config/supabase-client.js';
import { pesanTolakan } from '../../core/my-outlets.js';
import { tenggatMingguIni } from './aturan-konten.js';

const teks = (v) => (v === null || v === undefined ? '' : String(v).trim());

/** Setelan semua outlet di satu BU. */
export async function listSetelanOutlet(businessUnitId) {
  const { data, error } = await supabase
    .from('konten_setelan_outlet')
    .select('outlet_id, business_unit_id, hari_setor, brief_tetap, aktif, diperbarui_at')
    .eq('business_unit_id', businessUnitId);
  if (error) throw new Error(pesanTolakan(error, 'memuat setelan konten'));
  return data ?? [];
}

/** ADMIN BU. Simpan setelan satu outlet. */
export async function simpanSetelanOutlet(outletId, businessUnitId, { hariSetor, briefTetap, aktif } = {}) {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const tambalan = {
    outlet_id: outletId,
    business_unit_id: businessUnitId,
    diperbarui_at: new Date().toISOString(),
    diperbarui_by: user?.id ?? null
  };
  if (hariSetor !== undefined) tambalan.hari_setor = Number(hariSetor);
  if (briefTetap !== undefined) tambalan.brief_tetap = teks(briefTetap) || null;
  if (aktif !== undefined) tambalan.aktif = !!aktif;

  const { data, error } = await supabase
    .from('konten_setelan_outlet')
    .upsert(tambalan, { onConflict: 'outlet_id' })
    .select('outlet_id');
  if (error) throw new Error(pesanTolakan(error, 'menyimpan setelan konten'));
  // UPDATE yang ditolak RLS berhasil dengan NOL baris, tanpa galat sama sekali
  // — jebakan yang sama dengan `setSchedule` di modul Shift.
  if (!data?.length) throw new Error(pesanTolakan(new Error('row-level security'), 'menyimpan setelan konten'));
}

/** Tugas satu BU dalam rentang tenggat, beserta berkasnya. */
export async function listTugas({ businessUnitId, dari, sampai, outletId = null }) {
  let q = supabase
    .from('konten_tugas')
    .select(
      'id, outlet_id, business_unit_id, tenggat, jenis, brief, status, disetor_at, diunduh_at, selesai_at, berkas_dihapus_at, ' +
        'konten_berkas(id, jenis, r2_key, nama_asli, ukuran_byte, diunggah_at, diunggah_by)'
    )
    .eq('business_unit_id', businessUnitId)
    .gte('tenggat', dari)
    .lte('tenggat', sampai)
    .order('tenggat', { ascending: false });
  if (outletId) q = q.eq('outlet_id', outletId);
  const { data, error } = await q;
  if (error) throw new Error(pesanTolakan(error, 'memuat tugas konten'));
  return data ?? [];
}

/**
 * Tugas minggu berjalan untuk satu outlet — DIBUAT kalau belum ada.
 *
 * ============ BARISNYA LAHIR SAAT DISENTUH ============
 *
 * Tidak ada cron yang membuat tugas mingguan. Tenggatnya dihitung dari
 * `hari_setor`, dan barisnya lahir saat layar pertama kali dibuka.
 *
 * Alasannya ada di 0163: cron yang mati diam-diam berarti SELURUH outlet
 * berhenti punya tugas, dan gejalanya cuma layar kosong — yang tidak terlihat
 * seperti kerusakan. Ini sudah terjadi sekali di repo ini dengan rekap
 * Telegram.
 *
 * ============ `insert` BIASA, BUKAN `upsert` ============
 *
 * Versi pertama memakai `upsert … { onConflict: 'outlet_id,tenggat',
 * ignoreDuplicates: true }`, dan itu TIDAK PERNAH BISA BEKERJA.
 *
 * Indeks uniknya PARTIAL (`where jenis = 'mingguan'`), dan `ON CONFLICT`
 * hanya bisa menyimpulkan indeks partial kalau predikatnya ikut disebut —
 * sesuatu yang PostgREST tidak punya cara mengirimnya. Postgres menolak dengan
 * `42P10: there is no unique or exclusion constraint matching the ON CONFLICT
 * specification`.
 *
 * Dan karena galat `upsert`-nya tidak ditangkap, barisnya tidak pernah dibuat,
 * pembacaan berikutnya memulangkan null, dan layar menuliskan **"Jadwal setor
 * outlet ini belum lengkap"** — menyalahkan jadwal yang sebenarnya sudah benar.
 * Satu kalimat salah yang mengirim orang memeriksa tempat yang keliru.
 *
 * `insert` biasa tidak butuh penyimpulan indeks sama sekali. Lomba antara dua
 * staff yang membuka layarnya pada detik yang sama tetap ditangani — oleh
 * indeks uniknya, yang memulangkan `23505`, dan itu kita diamkan: baris yang
 * kita inginkan memang sudah ada.
 */
export async function tugasMingguIni({ businessUnitId, outletId, hariSetor, hariIni }) {
  const tenggat = tenggatMingguIni(hariIni, hariSetor);
  if (!tenggat) return null;

  const ambil = () =>
    supabase
      .from('konten_tugas')
      .select(
        'id, outlet_id, business_unit_id, tenggat, jenis, brief, status, disetor_at, berkas_dihapus_at, ' +
          'konten_berkas(id, jenis, r2_key, nama_asli, ukuran_byte, diunggah_at, diunggah_by)'
      )
      .eq('outlet_id', outletId)
      .eq('tenggat', tenggat)
      .eq('jenis', 'mingguan')
      .maybeSingle();

  let { data, error } = await ambil();
  if (error) throw new Error(pesanTolakan(error, 'memuat tugas minggu ini'));
  if (data) return data;

  const {
    data: { user }
  } = await supabase.auth.getUser();
  const { error: galatBuat } = await supabase.from('konten_tugas').insert({
    business_unit_id: businessUnitId,
    outlet_id: outletId,
    tenggat,
    jenis: 'mingguan',
    dibuat_by: user?.id ?? null
  });
  // 23505 = baris itu dibuat device/tab lain sepersekian detik lebih dulu.
  // Itu hasil yang kita inginkan, bukan kegagalan. Galat LAIN harus berbunyi —
  // galat pembuatan yang ditelan adalah persis bagaimana bug ini lahir.
  if (galatBuat && galatBuat.code !== '23505') {
    throw new Error(pesanTolakan(galatBuat, 'membuat tugas konten minggu ini'));
  }

  ({ data, error } = await ambil());
  if (error) throw new Error(pesanTolakan(error, 'memuat tugas minggu ini'));
  // Barisnya dibuat tapi tidak terbaca = izin baca, bukan jadwal. Dibedakan
  // supaya pesannya tidak mengirim orang memeriksa hal yang sudah benar.
  if (!data) {
    throw new Error(
      'Tugas minggu ini sudah dibuat tapi tidak bisa dibaca kembali. Biasanya soal izin akses, bukan jadwalnya — beri tahu admin.'
    );
  }
  return data;
}

/** ADMIN BU. Tugas tambahan di luar irama mingguan. */
export async function buatTugasKhusus({ businessUnitId, outletId, tenggat, brief }) {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('konten_tugas')
    .insert({
      business_unit_id: businessUnitId,
      outlet_id: outletId,
      tenggat,
      jenis: 'khusus',
      brief: teks(brief) || null,
      dibuat_by: user?.id ?? null
    })
    .select('id');
  if (error) throw new Error(pesanTolakan(error, 'membuat tugas khusus'));
  return data?.[0]?.id ?? null;
}

/** ADMIN BU. Ubah brief satu tugas — berlaku langsung untuk minggu berjalan. */
export async function simpanBriefTugas(tugasId, brief) {
  const { data, error } = await supabase
    .from('konten_tugas')
    .update({ brief: teks(brief) || null })
    .eq('id', tugasId)
    .select('id');
  if (error) throw new Error(pesanTolakan(error, 'menyimpan brief'));
  if (!data?.length) throw new Error(pesanTolakan(new Error('row-level security'), 'menyimpan brief'));
}

/** ADMIN BU. Penanda "sudah saya unduh" — keterangan, bukan pemicu apa pun. */
export async function tandaiDiunduh(tugasId) {
  await supabase.from('konten_tugas').update({ diunduh_at: new Date().toISOString() }).eq('id', tugasId);
}

/**
 * ADMIN BU. Tandai selesai — INI yang memicu penghapusan berkasnya.
 *
 * Tujuh hari kemudian `purge-konten` menghapusnya dari R2. Barisnya tetap.
 */
export async function tandaiSelesai(tugasId, selesai = true) {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const tambalan = selesai
    ? { status: 'selesai', selesai_at: new Date().toISOString(), selesai_by: user?.id ?? null }
    : // Dibuka kembali: status turun ke keadaan yang SESUAI isinya, bukan selalu
      // 'disetor' — tugas yang ditandai selesai padahal kosong harus kembali
      // jadi 'belum', bukan mengaku sudah disetor.
      { status: 'belum', selesai_at: null, selesai_by: null };

  const { data, error } = await supabase.from('konten_tugas').update(tambalan).eq('id', tugasId).select('id, status');
  if (error) throw new Error(pesanTolakan(error, 'menandai tugas'));
  if (!data?.length) throw new Error(pesanTolakan(new Error('row-level security'), 'menandai tugas'));

  if (!selesai) {
    // Dikembalikan ke 'disetor' kalau memang ada berkasnya. Dikerjakan
    // sesudahnya, bukan ditebak di atas, supaya satu sumber kebenaran: isinya.
    const { count } = await supabase
      .from('konten_berkas')
      .select('id', { count: 'exact', head: true })
      .eq('tugas_id', tugasId);
    if ((count ?? 0) > 0) await supabase.from('konten_tugas').update({ status: 'disetor' }).eq('id', tugasId);
  }
}

// ---- Jembatan ke R2 lewat Edge Function ----

async function panggilR2(payload) {
  const { data, error } = await supabase.functions.invoke('konten-r2', { body: payload });
  if (error) {
    // Galat dari Edge Function sering berisi badan JSON yang jauh lebih
    // berguna daripada "Edge Function returned a non-2xx status code".
    let pesan = error.message ?? String(error);
    try {
      const isi = await error.context?.json?.();
      if (isi?.error) pesan = isi.error;
    } catch {
      /* biarkan pesan aslinya */
    }
    throw new Error(pesan);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

/** Minta URL unggah untuk satu berkas. Kuncinya disusun server, bukan di sini. */
export function urlUnggah({ tugasId, jenis, ext }) {
  return panggilR2({ aksi: 'upload-url', tugas_id: tugasId, jenis, ext });
}

/** Minta URL tonton/unduh yang berlaku sebentar. */
export function urlTonton({ tugasId, r2Key }) {
  return panggilR2({ aksi: 'view-url', tugas_id: tugasId, r2_key: r2Key });
}

/** ADMIN BU. Hapus satu berkas dari R2 sekaligus barisnya. */
export function hapusBerkasR2({ tugasId, r2Key }) {
  return panggilR2({ aksi: 'delete', tugas_id: tugasId, r2_key: r2Key });
}

/**
 * Kirim berkas LANGSUNG ke R2, dengan laporan kemajuan.
 *
 * ============ `XMLHttpRequest`, BUKAN `fetch` ============
 *
 * Bukan karena kuno — karena `fetch` tidak bisa melaporkan kemajuan UNGGAH.
 * Dan untuk berkas 141 MB di wifi outlet, batang kemajuan bukan hiasan: tanpa
 * itu staff melihat layar diam selama belasan menit, menyimpulkan aplikasinya
 * menggantung, lalu menutupnya — dan unggahannya hilang di 80%.
 */
export function kirimKeR2(url, file, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    if (file?.type) xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && typeof onProgress === 'function') onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`R2 menolak unggahan (${xhr.status}). Coba lagi dari awal.`));
    xhr.onerror = () =>
      reject(new Error('Koneksi terputus saat mengunggah. Cek sinyal, lalu coba lagi — berkasnya belum tersimpan.'));
    xhr.onabort = () => reject(new Error('Unggahan dibatalkan.'));
    xhr.send(file);
  });
}

/** Catat berkas yang sudah selesai diunggah. */
export async function catatBerkas({ tugasId, jenis, r2Key, namaAsli, ukuran }) {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const { error } = await supabase.from('konten_berkas').insert({
    tugas_id: tugasId,
    jenis,
    r2_key: r2Key,
    nama_asli: teks(namaAsli).slice(0, 200) || null,
    ukuran_byte: Number(ukuran) || null,
    diunggah_by: user?.id ?? null
  });
  if (error) throw new Error(pesanTolakan(error, 'mencatat berkas'));
}

/** Staff membatalkan unggahannya sendiri. Kunci R2-nya dicatat trigger (0163). */
export async function hapusBerkasSendiri(berkasId) {
  const { error } = await supabase.from('konten_berkas').delete().eq('id', berkasId);
  if (error) throw new Error(pesanTolakan(error, 'menghapus berkas'));
}
