/**
 * AUDIT: modul Konten Sosmed (0163 + R2).
 *
 * ============ CARA MODUL INI RUSAK TANPA TERLIHAT RUSAK ============
 *
 * Hampir semua kegagalannya tidak berbunyi. Yang dipertaruhkan adalah berkas
 * 141 MB yang hanya ada SATU salinannya, di penyimpanan yang akan
 * menghapusnya sendiri.
 *
 *   trigger sampah kehilangan
 *     `security definer`           -> staff menghapus unggahannya sendiri dan
 *                                     ditolak "permission denied" pada tabel
 *                                     yang tidak pernah ia sebut. Sudah terjadi.
 *   baris dicatat SEBELUM PUT      -> unggahan yang putus di tengah meninggalkan
 *                                     baris yang menunjuk objek yang tidak
 *                                     pernah ada. Layar menampilkannya sebagai
 *                                     berkas sah sampai ada yang memutarnya.
 *   kunci R2 diterima dari browser -> satu pemanggil bisa menimpa berkas outlet
 *                                     lain; tokennya sama untuk semua orang.
 *   konfirmasi "Selesai" kehilangan
 *     kalimat penghapusan          -> admin menekan tombol biasa, dan tujuh hari
 *                                     kemudian berkasnya hilang. Tidak ada
 *                                     salinan lain.
 *   penanda `berkas_dihapus_at`
 *     diisi walau ada yang gagal   -> berkas yang gagal dihapus keluar dari
 *                                     antrean SELAMANYA — bocor tanpa jejak,
 *                                     tetap memakan kuota 10 GB.
 *   `Number(hari_setor)` tanpa
 *     penjaga                      -> isian kosong tersimpan diam-diam sebagai
 *                                     Minggu. Sudah menggigit sekali.
 *   nol baris dari RLS dibiarkan   -> UPDATE yang DITOLAK berhasil dengan nol
 *                                     baris, tanpa galat. Layar bilang
 *                                     "disimpan"; tidak ada yang tersimpan.
 */
const fs = require('fs');
const path = require('path');
const { tanpaKomentar, periksaKewarasan } = require('./lib/tanpa-komentar.cjs');

const AKAR = path.dirname(__dirname);
let gagal = 0;
const salah = (pesan) => {
  gagal++;
  console.error(`❌ ${pesan}`);
};

const baca = (rel) => {
  const p = path.join(AKAR, rel);
  if (!fs.existsSync(p)) {
    salah(`${rel} tidak ada — audit ini kehilangan sasarannya.`);
    return null;
  }
  return fs.readFileSync(p, 'utf8');
};
const bersih = (isi, rel, penanda) => {
  const kode = tanpaKomentar(isi);
  const pesan = periksaKewarasan(isi, kode, penanda);
  if (pesan) salah(`${rel}: ${pesan}`);
  return kode;
};

const tanpaSqlKomentar = (sql) =>
  sql
    .split('\n')
    .map((baris) => {
      let petik = 0;
      for (let i = 0; i < baris.length; i++) {
        if (baris[i] === "'") petik++;
        else if (baris[i] === '-' && baris[i + 1] === '-' && petik % 2 === 0) return baris.slice(0, i);
      }
      return baris;
    })
    .join('\n');

/** Potongan kode sesudah penanda — dipakai supaya pemeriksaan TIDAK se-berkas. */
const blok = (kode, penanda, panjang = 2000) => {
  const i = kode.indexOf(penanda);
  return i < 0 ? '' : kode.slice(i, i + panjang);
};

/**
 * Potongan DI ANTARA dua penanda.
 *
 * ============ KENAPA PANJANG TETAP TIDAK CUKUP ============
 *
 * `blok(kode, 'urlUnggah', 300)` merembes ke `urlTonton` di bawahnya — yang
 * memang berisi `r2_key`, dan memang BOLEH. Auditnya lalu menuduh `urlUnggah`
 * melakukan sesuatu yang dilakukan tetangganya.
 *
 * Itu kebalikan dari mode kegagalan yang biasa di repo ini (hijau karena
 * sasarannya ada di tempat lain), dan sama buruknya: audit yang merah tanpa
 * sebab akan dimatikan orang berikutnya, dan yang mati bukan cuma pemeriksaan
 * yang salah itu.
 */
const blokSampai = (kode, mulai, akhir) => {
  const i = kode.indexOf(mulai);
  if (i < 0) return '';
  const j = kode.indexOf(akhir, i + mulai.length);
  return kode.slice(i, j < 0 ? undefined : j);
};

// =====================================================================
// 1. MIGRATION 0163.
// =====================================================================
const mig = baca('supabase/migrations/0163_konten_sosmed.sql');
if (mig) {
  const kode = tanpaSqlKomentar(mig);
  if (!/create table if not exists konten_tugas/.test(kode)) {
    salah('audit-konten: penyaring komentar SQL ikut memakan kodenya — pemeriksaan di bawah tidak bisa dipercaya.');
  }
  if (/BERKASNYA TIDAK DI SUPABASE/.test(kode)) {
    salah('audit-konten: komentar SQL tidak tersaring — pemeriksaan di bawah bisa hijau karena kalimat penjelasnya.');
  }

  if (!/insert into modules \(code, name, description\)[\s\S]{0,120}'konten_sosmed'/.test(kode)) {
    salah('0163: modul `konten_sosmed` tidak terdaftar di tabel `modules` — tabnya tidak akan pernah muncul di BU mana pun.');
  }

  // ============ TRIGGER SAMPAH: `SECURITY DEFINER` ITU LOAD-BEARING ============
  //
  // Staff punya izin DELETE pada `konten_berkas` (policy di bawah), tapi TIDAK
  // punya izin INSERT pada `konten_berkas_sampah` — dan tidak boleh punya,
  // karena tabel itu daftar perintah hapus untuk pekerjaan terjadwal.
  //
  // Tanpa `security definer`, triggernya berjalan sebagai staff, gagal, dan
  // MEMBATALKAN penghapusannya. Gejalanya: "permission denied for table
  // konten_berkas_sampah" di layar orang yang cuma mau mengganti videonya.
  const sampah = kode.match(/create or replace function catat_sampah_berkas_konten\(\)[\s\S]*?\n\$\$;/);
  if (!sampah) {
    salah(
      '0163: `catat_sampah_berkas_konten` hilang. Ia satu-satunya yang mencatat kunci R2 saat barisnya hilang — ' +
        'tanpa itu objeknya tidak ditunjuk apa pun, tidak muncul di layar mana pun, dan tetap memakan kuota ' +
        'selamanya. Kebocoran yang baru ketahuan sebagai "kenapa R2 saya penuh padahal isinya sedikit".'
    );
  } else {
    if (!/security definer/.test(sampah[0])) {
      salah(
        '0163: `catat_sampah_berkas_konten` kehilangan `security definer`. Ia berjalan sebagai staff, yang tidak ' +
          'punya izin INSERT ke `konten_berkas_sampah` — jadi penghapusan berkas staff GAGAL dengan "permission ' +
          'denied" pada tabel yang tidak pernah ia sebut. Ini sudah terjadi sekali.'
      );
    }
    if (!/set search_path = public/.test(sampah[0])) {
      salah('0163: `catat_sampah_berkas_konten` `security definer` tanpa `set search_path` — jalur pencarian yang bisa dibajak pemanggil.');
    }
    if (!/on conflict \(r2_key\) do nothing/.test(sampah[0])) {
      salah('0163: pencatatan sampah tanpa `on conflict do nothing` — satu kunci yang terdaftar dua kali membatalkan penghapusan barisnya.');
    }
  }
  // ============ TRIGGERNYA TERDAFTAR ≠ TRIGGERNYA JALAN ============
  //
  // Sabotase `when (false)` meninggalkan `after delete on konten_berkas` utuh —
  // jadi audit yang cuma mencari baris itu tetap HIJAU untuk trigger yang tidak
  // pernah menyala sekali pun. Yang diperiksa harus seluruh pernyataannya.
  const trgSampah = kode.match(/create trigger trg_catat_sampah_berkas_konten[\s\S]*?;/);
  if (!trgSampah) {
    salah('0163: trigger sampah tidak terdaftar — kuncinya tidak tercatat, dan objeknya bocor lewat SETIAP jalan hilangnya baris.');
  } else {
    if (!/after delete on konten_berkas/.test(trgSampah[0])) {
      salah('0163: trigger sampah tidak lagi `after delete on konten_berkas` — ia tidak akan menyala pada jalan hilangnya baris yang mana pun.');
    }
    if (/\bwhen\s*\(/.test(trgSampah[0])) {
      salah(
        '0163: trigger sampah diberi syarat `when (...)`. Ia harus menyala untuk SETIAP baris yang hilang — ' +
          'syarat apa pun di situ berarti ada jalan hilangnya baris yang kuncinya tidak tercatat, dan objek itu ' +
          'bocor tanpa jejak.'
      );
    }
  }

  // ============ BATASNYA HANYA BATAS ATAS ============
  //
  // Batas bawah (1 video + 1 foto) TIDAK ditegakkan database. Staff mengunggah
  // videonya dulu dan fotonya menyusul semenit kemudian; menjadikannya syarat
  // menyimpan berarti unggahan PERTAMA selalu ditolak.
  const jaga = kode.match(/create or replace function jaga_jumlah_berkas_konten\(\)[\s\S]*?\n\$\$;/);
  if (!jaga) {
    salah('0163: `jaga_jumlah_berkas_konten` hilang — satu outlet bisa mengunggah 40 video dan menghabiskan kuota semua outlet lain.');
  } else {
    // `v_jumlah >= 3` adalah SUBSTRING dari `v_jumlah >= 300`. Audit tanpa
    // batas kata tetap hijau untuk batas yang dinaikkan seratus kali —
    // ditemukan sabotasenya.
    if (!/v_jumlah >= 3\b/.test(jaga[0])) {
      salah('0163: batas 3 berkas berubah bentuk atau hilang. Satu outlet bisa mengunggah 40 video dan menghabiskan kuota semua outlet lain.');
    }
    if (/video|foto/.test(jaga[0])) {
      salah(
        '0163: `jaga_jumlah_berkas_konten` mulai menegakkan batas BAWAH (jenis berkas). Staff mengunggah video dulu ' +
          'lalu foto; syarat itu menolak unggahan pertama setiap kali. Kelengkapan dinilai layar, bukan database — ' +
          'lihat `kelengkapan()` di aturan-konten.js.'
      );
    }
  }

  // ============ 'DISETOR' TIDAK BOLEH MENIMPA 'SELESAI' ============
  const setor = kode.match(/create or replace function tandai_tugas_disetor\(\)[\s\S]*?\n\$\$;/);
  if (!setor || !/and status = 'belum'/.test(setor?.[0] ?? '')) {
    salah(
      "0163: `tandai_tugas_disetor` tidak lagi dibatasi `status = 'belum'`. Satu berkas yang masuk ke tugas yang " +
        "sudah ditandai selesai akan menurunkannya kembali jadi 'disetor' — dan `purge-konten` kehilangan jejak " +
        'berkas yang seharusnya sudah dibersihkan.'
    );
  }

  // Satu tugas mingguan per outlet per tenggat — dua staff yang membuka layar
  // pada detik yang sama sama-sama mencoba membuatnya.
  if (!/create unique index if not exists konten_tugas_mingguan_uk[\s\S]{0,120}where jenis = 'mingguan'/.test(kode)) {
    salah(
      '0163: indeks unik tugas mingguan hilang. `upsert … ignoreDuplicates` di layanan bergantung padanya; tanpa itu ' +
        'dua staff yang membuka layarnya bersamaan membuat DUA tugas untuk minggu yang sama, dan setorannya terpecah.'
    );
  }

  // ============ HANYA ADMIN YANG BOLEH MENANDAI SELESAI ============
  //
  // `update` adalah satu-satunya jalan ke status 'selesai', dan status itulah
  // yang memicu penghapusan berkasnya. Membukanya untuk staff berarti siapa pun
  // bisa memulai hitungan tujuh hari ke penghapusan.
  if (!/create policy konten_tugas_update on konten_tugas\s*\n\s*for update using \(is_bu_admin/.test(kode)) {
    salah(
      '0163: policy update `konten_tugas` tidak lagi khusus `is_bu_admin`. Status `selesai` yang bisa diset staff ' +
        'berarti berkasnya bisa dijadwalkan terhapus oleh orang yang tidak pernah mengunduhnya.'
    );
  }
  if (/create policy konten_tugas_\w+ on konten_tugas\s*\n\s*for all/.test(kode)) {
    salah('0163: ada policy `for all` pada `konten_tugas` — ia memberi UPDATE ke siapa pun yang lolos `select`-nya.');
  }

  // Staff boleh menghapus unggahannya SENDIRI, dan hanya selama tugasnya belum
  // ditutup.
  const hapus = kode.match(/create policy konten_berkas_delete on konten_berkas[\s\S]*?\);/);
  if (!hapus || !/diunggah_by = auth\.uid\(\) and t\.status <> 'selesai'/.test(hapus?.[0] ?? '')) {
    salah(
      '0163: policy hapus berkas tidak lagi membatasi staff pada unggahannya sendiri & tugas yang belum selesai. ' +
        'Yang hilang bukan cuma izin: berkas yang dihapus dari tugas yang sudah selesai membuat admin mengunduh ' +
        'setoran yang isinya berubah di antara dua ketukan.'
    );
  }

  for (const tabel of ['konten_setelan_outlet', 'konten_tugas', 'konten_berkas', 'konten_berkas_sampah']) {
    if (!new RegExp(`alter table ${tabel} enable row level security`).test(kode)) {
      salah(`0163: RLS tidak dinyalakan di ${tabel} — seluruh policy di bawahnya jadi hiasan.`);
    }
  }
}

// =====================================================================
// 2. ATURAN MURNI.
// =====================================================================
const aturan = baca('js/modules/konten/aturan-konten.js');
if (aturan) {
  const kode = bersih(aturan, 'aturan-konten.js', ['tenggatMingguIni', 'briefEfektif']);

  // ============ Number('') ADALAH 0, BUKAN NaN ============
  //
  // `hari_setor` yang kosong menjadi 0 = Minggu, diam-diam, dan seluruh outlet
  // tiba-tiba punya tenggat hari Minggu. Tidak ada galat di mana pun.
  const tgt = blok(kode, 'export function tenggatMingguIni');
  if (!/hariSetor === null \|\| hariSetor === undefined \|\| hariSetor === ''/.test(tgt)) {
    salah(
      "aturan-konten.js: penjaga eksplisit null/undefined/'' di `tenggatMingguIni` hilang. `Number('')` adalah 0, " +
        'bukan NaN — jadi outlet yang hari setornya belum diisi mendapat tenggat hari MINGGU tanpa satu pun tanda. ' +
        'Jebakan ini sudah menggigit sekali di berkas ini.'
    );
  }
  if (!/Number\.isInteger\(h\) \|\| h < 0 \|\| h > 6/.test(tgt)) {
    salah('aturan-konten.js: `tenggatMingguIni` tidak lagi menolak hari di luar 0–6.');
  }

  // `= {}` pada destrukturisasi HANYA menangkap `undefined`, bukan `null`.
  const be = blok(kode, 'export function briefEfektif', 600);
  if (!/const o = sumber \?\? \{\}/.test(be)) {
    salah(
      'aturan-konten.js: `briefEfektif` kembali memakai destrukturisasi dengan `= {}`. Itu hanya menangkap ' +
        '`undefined`; pemanggil yang mengirim hasil pencarian yang gagal (`null`) membuat layarnya mati dengan ' +
        '"Cannot destructure property of null" — galat yang tidak menyebut apa pun tentang brief.'
    );
  }
  if (!/return \{ teks: BRIEF_BAWAAN, asal: 'bawaan' \}/.test(be)) {
    salah('aturan-konten.js: brief bawaan tidak lagi jadi jatuhan terakhir — staff bisa melihat brief KOSONG dan tidak tahu harus mengambil apa.');
  }
  if (!/minimal 1 video dan 1 foto/.test(kode)) {
    salah('aturan-konten.js: isi `BRIEF_BAWAAN` berubah dan tidak lagi menyebut jumlah minimumnya.');
  }
}

// =====================================================================
// 3. LAYANAN.
// =====================================================================
const svc = baca('js/modules/konten/konten.service.js');
if (svc) {
  const kode = bersih(svc, 'konten.service.js', ['kirimKeR2', 'urlUnggah']);

  // ============ KUNCI R2 DISUSUN SERVER, BUKAN DIKIRIM BROWSER ============
  const uu = blokSampai(kode, 'export function urlUnggah', 'export function urlTonton');
  if (!uu) salah('konten.service.js: `urlUnggah` / `urlTonton` tidak ditemukan — pemeriksaan kunci R2 kehilangan sasarannya.');
  if (/r2_key/.test(uu)) {
    salah(
      'konten.service.js: `urlUnggah` mengirim `r2_key` ke Edge Function. Kuncinya HARUS disusun server ' +
        '(`susunKunci`): token R2-nya sama untuk semua orang, jadi kunci yang ditentukan browser berarti satu ' +
        'pemanggil bisa menimpa berkas outlet lain.'
    );
  }

  // `fetch` tidak bisa melaporkan kemajuan UNGGAH.
  const kirim = blok(kode, 'export function kirimKeR2', 1200);
  if (!/new XMLHttpRequest\(\)/.test(kirim) || !/xhr\.upload\.onprogress/.test(kirim)) {
    salah(
      'konten.service.js: `kirimKeR2` tidak lagi melaporkan kemajuan unggah. `fetch` TIDAK BISA melakukannya; ' +
        'tanpa batang kemajuan, staff melihat layar diam belasan menit untuk berkas 141 MB, menyimpulkan ' +
        'aplikasinya menggantung, lalu menutupnya — dan unggahannya hilang di 80%.'
    );
  }
  if (!/belum tersimpan/.test(kirim)) {
    salah('konten.service.js: pesan gagal unggah tidak lagi mengatakan berkasnya BELUM tersimpan — staff mengira setorannya sudah masuk.');
  }

  // ============ NOL BARIS DARI RLS BUKAN KEBERHASILAN ============
  //
  // UPDATE yang ditolak RLS memulangkan nol baris TANPA error. Layar bilang
  // "disimpan"; tidak ada yang tersimpan. Jebakan yang sama dengan `setSchedule`
  // di modul Shift.
  for (const fn of ['simpanSetelanOutlet', 'simpanBriefTugas', 'tandaiSelesai']) {
    const b = blok(kode, `export async function ${fn}`, 1400);
    if (!b) {
      salah(`konten.service.js: \`${fn}\` hilang.`);
      continue;
    }
    if (!/if \(!data\?\.length\) throw new Error/.test(b)) {
      salah(
        `konten.service.js: \`${fn}\` tidak lagi memeriksa nol baris. UPDATE yang DITOLAK RLS berhasil dengan nol ` +
          'baris dan tanpa galat — layar menampilkan "disimpan" untuk perubahan yang tidak pernah terjadi.'
      );
    }
  }

  // Dua staff yang membuka layarnya pada detik yang sama.
  const tmi = blok(kode, 'export async function tugasMingguIni', 1600);
  if (!/ignoreDuplicates: true/.test(tmi)) {
    salah(
      'konten.service.js: `tugasMingguIni` tidak lagi memakai `ignoreDuplicates`. Staff kedua yang membuka layarnya ' +
        'pada detik yang sama akan melihat galat pelanggaran indeks unik untuk kesalahan yang tidak ia lakukan.'
    );
  }

  // Galat Edge Function yang tidak dibuka isinya berbunyi "non-2xx status code"
  // — kalimat yang tidak menyebut sebabnya sama sekali.
  if (!/isi\?\.error/.test(kode)) {
    salah(
      'konten.service.js: badan galat Edge Function tidak lagi dibuka. Yang sampai ke layar jadi "Edge Function ' +
        'returned a non-2xx status code" — yang menyembunyikan justru kalimat yang berguna, termasuk "setelan R2 ' +
        'belum lengkap".'
    );
  }
}

// =====================================================================
// 4. STAFF APP.
// =====================================================================
const staf = baca('js/modules/konten/konten.page.js');
if (staf) {
  const kode = bersih(staf, 'konten.page.js', ['pasangUnggah']);

  // ============ URUTANNYA YANG MENENTUKAN ============
  //
  // Baris berkas dicatat SESUDAH PUT-nya berhasil. Kalau dicatat lebih dulu,
  // unggahan yang putus di tengah meninggalkan baris yang menunjuk objek yang
  // tidak pernah ada — dan layar menampilkannya sebagai berkas yang sah sampai
  // ada yang mencoba memutarnya.
  const iKirim = kode.indexOf('await kirimKeR2(');
  const iCatat = kode.indexOf('await catatBerkas(');
  if (iKirim < 0 || iCatat < 0) {
    salah('konten.page.js: jalur unggah (`kirimKeR2` lalu `catatBerkas`) tidak lengkap.');
  } else if (iCatat < iKirim) {
    salah(
      'konten.page.js: `catatBerkas` dipanggil SEBELUM `kirimKeR2`. Unggahan yang putus di tengah meninggalkan ' +
        'baris yang menunjuk objek yang tidak pernah ada — layar menampilkannya sebagai berkas sah, dan staff ' +
        'yakin ia sudah menyetornya.'
    );
  }

  // ============ DUA INPUT, SUPAYA `accept` BISA MENYARING ============
  if (!/id="kt-file-video" accept="video\/\*"/.test(kode) || !/id="kt-file-foto" accept="image\/\*"/.test(kode)) {
    salah(
      'konten.page.js: input berkas video & foto tidak lagi terpisah ber-`accept`. Satu input gabungan membuat staff ' +
        'memilih foto saat yang diminta video — dan salahnya baru ketahuan sesudah 141 MB terkirim.'
    );
  }

  // ============ value DIKOSONGKAN SEBELUM return ============
  //
  // Tanpa ini, memilih berkas yang SAMA dua kali berturut-turut tidak memicu
  // `change` sama sekali, dan staff mengira tombolnya rusak.
  const unggah = blok(kode, "input.addEventListener('change'", 600);
  const iReset = unggah.indexOf("input.value = ''");
  const iReturn = unggah.indexOf('if (!file) return');
  if (iReset < 0) {
    salah('konten.page.js: `input.value` tidak dikosongkan — memilih berkas yang sama dua kali tidak memicu apa pun, dan tombolnya tampak rusak.');
  } else if (iReturn >= 0 && iReturn < iReset) {
    salah(
      'konten.page.js: `input.value` dikosongkan SESUDAH `return` awalnya. Pada jalur "tidak ada berkas" nilainya ' +
        'tertinggal, dan pilihan berikutnya yang sama tidak memicu `change`.'
    );
  }

  // Staff tidak punya jalan ke penghapusan R2 — ia menghapus BARISNYA, dan
  // triggernya yang mencatat kuncinya.
  if (/hapusBerkasR2/.test(kode)) {
    salah(
      'konten.page.js: Staff App memanggil `hapusBerkasR2`. Edge Function menolaknya (admin saja), jadi yang ' +
        'didapat staff adalah tombol yang selalu gagal. Jalur staff adalah `hapusBerkasSendiri` — barisnya, dan ' +
        'triggernya yang mencatat kunci R2-nya ke sampah.'
    );
  }

  // Outlet tanpa setelan TIDAK ikut.
  if (!/setelanPer\.has\(o\.id\)/.test(kode)) {
    salah(
      'konten.page.js: layar tidak lagi menyaring outlet yang punya setelan aktif. Outlet tanpa jadwal yang ' +
        'ditampilkan dengan tugas kosong membuat staff mengira ia lupa mengerjakan sesuatu yang memang tidak ada.'
    );
  }
}

// =====================================================================
// 5. ADMIN PORTAL.
// =====================================================================
const adm = baca('js/modules/konten/konten.admin.page.js');
if (adm) {
  const kode = bersih(adm, 'konten.admin.page.js', ['tandaiSelesai', 'dialogSetelan']);

  // ============ SATU-SATUNYA PERINGATAN SEBELUM DATA HILANG ============
  //
  // Menandai selesai adalah satu-satunya hal yang memicu penghapusan berkasnya
  // dari R2. Tidak ada salinan lain di mana pun. Diikat ke BLOK tombolnya,
  // bukan dicari se-berkas: `confirmDialog` juga dipakai aksi Hapus berkas di
  // layar ini, jadi pencarian se-berkas akan tetap hijau sesudah konfirmasi
  // Selesai dicabut — ia menemukan milik aksi lain.
  // Dibatasi sampai handler BERIKUTNYA, bukan 2200 karakter: `[data-hapus-berkas]`
  // di bawahnya juga punya `confirmDialog`, `danger: true`, dan
  // `if (!yakin) return;`. Jendela panjang-tetap tetap hijau sesudah konfirmasi
  // Selesai dicabut — ia menemukan milik aksi lain. Ditemukan sabotasenya.
  const bSelesai = blokSampai(kode, "'[data-selesai]'", "'[data-hapus-berkas]'");
  if (!bSelesai) {
    salah('konten.admin.page.js: aksi Tandai Selesai hilang — tidak ada yang memicu pembersihan berkas, dan R2 tumbuh selamanya.');
  } else {
    if (!/confirmDialog\(\{/.test(bSelesai)) {
      salah('konten.admin.page.js: Tandai Selesai tidak lagi minta konfirmasi.');
    }
    if (!/dihapus otomatis/.test(bSelesai) || !/7 hari/.test(bSelesai)) {
      salah(
        'konten.admin.page.js: konfirmasi Tandai Selesai tidak lagi menyebut bahwa berkasnya akan DIHAPUS dalam 7 ' +
          'hari. Tanpa kalimat itu tombolnya terbaca seperti penanda biasa, dan sepekan kemudian berkasnya hilang — ' +
          'tanpa salinan lain di mana pun.'
      );
    }
    if (!/sudah mengunduhnya/.test(bSelesai)) {
      salah('konten.admin.page.js: konfirmasi Tandai Selesai tidak lagi mengingatkan untuk mengunduh dulu — satu-satunya tindakan yang mencegah kehilangannya.');
    }
    // Dialognya muncul BUKAN yang menentukan — jawabannya dipatuhi yang
    // menentukan.
    if (!/if \(!yakin\) return;/.test(bSelesai)) {
      salah(
        'konten.admin.page.js: jawaban konfirmasi Tandai Selesai tidak dipatuhi. Dialognya tetap muncul, dan ' +
          'menekan Batal tetap memulai hitungan tujuh hari ke penghapusan.'
      );
    }
    // Setoran yang masih kurang harus DIKATAKAN kurang, bukan ditolak.
    if (!/k\.lengkap \? '' :/.test(bSelesai)) {
      salah(
        'konten.admin.page.js: konfirmasi tidak lagi menyebut kekurangan setoran. Admin menandai selesai setoran ' +
          'yang cuma berisi satu foto tanpa pernah tahu videonya belum masuk.'
      );
    }
  }

  // ============ PENJAGA HARI SETOR, LAGI ============
  const bSetel = blok(kode, 'async function dialogSetelan', 2400);
  if (!/Number\.isInteger\(hari\) \|\| hari < 0 \|\| hari > 6/.test(bSetel)) {
    salah(
      "konten.admin.page.js: `dialogSetelan` menyimpan hari setor tanpa penjaga bilangan bulat 0–6. `Number('')` " +
        'adalah 0, jadi pilihan kosong tersimpan diam-diam sebagai Minggu — jebakan yang sama sudah menggigit di ' +
        'aturan-konten.js.'
    );
  }

  // Penanda "sudah diunduh" harus terisi dari ketukan unduhnya, bukan dari
  // tombol terpisah: penanda manual adalah pekerjaan tambahan yang paling mudah
  // dilupakan, dan penanda yang tidak pernah terisi sama saja tidak ada.
  if (!/#kta-unduh[\s\S]{0,400}tandaiDiunduh\(tugasId\)/.test(kode)) {
    salah('konten.admin.page.js: `tandaiDiunduh` tidak lagi terikat ke ketukan tautan unduh — kolom "sudah diunduh" akan selalu kosong.');
  }

  // Ringkasan dihitung dari SELURUH rentang, bukan dari yang lolos saringan
  // status: kalau tidak, menyaring "Selesai" membuat banner berbunyi "semua
  // beres" padahal ada lima outlet yang belum setor.
  if (!/ringkasAntrean\(tugas, ctx\.hariIni\)/.test(kode)) {
    salah(
      'konten.admin.page.js: banner ringkasan dihitung dari daftar yang sudah disaring status. Menyaring "Selesai" ' +
        'lalu membuat banner berbunyi "semua beres" padahal lima outlet belum setor — dua angka bertentangan di satu layar.'
    );
  }
}

// =====================================================================
// 6. TABNYA HARUS BISA DICAPAI.
// =====================================================================
const katalog = baca('js/core/admin-tabs.js');
if (katalog && !/\{ code: 'konten_sosmed', label: 'Konten Sosmed', group: '[^']+' \}/.test(tanpaKomentar(katalog))) {
  salah(
    "admin-tabs.js: `konten_sosmed` tidak ada di katalog tab. `canAccessTab` menolak kode yang tidak dikenal, jadi " +
      'layarnya ada, modulnya menyala, dan tabnya TIDAK PERNAH muncul — tanpa satu pun galat. Tab yang disaring ' +
      'keluar tidak meninggalkan jejak.'
  );
}
const mainAdmin = baca('js/main-admin.js');
if (mainAdmin && !/registerModule\('konten_sosmed', renderKontenAdminPage\)/.test(tanpaKomentar(mainAdmin))) {
  salah('main-admin.js: `konten_sosmed` tidak terdaftar — tab yang diklik lalu tidak terjadi apa-apa.');
}
const mainStaff = baca('js/main-staff.js');
if (mainStaff && !/registerModule\('konten_sosmed', renderKontenPage\)/.test(tanpaKomentar(mainStaff))) {
  salah('main-staff.js: `konten_sosmed` tidak terdaftar — staff tidak punya layar untuk menyetor apa pun.');
}

// =====================================================================
// 7. EDGE FUNCTION konten-r2.
// =====================================================================
const r2 = baca('supabase/functions/konten-r2/index.ts');
if (r2) {
  const kode = bersih(r2, 'konten-r2/index.ts', ['susunKunci', 'upload-url']);

  // ============ KUNCINYA DISUSUN DI SINI ============
  if (!/function susunKunci\(/.test(kode) || !/crypto\.randomUUID\(\)/.test(kode)) {
    salah(
      'konten-r2: `susunKunci` hilang atau tidak lagi memakai id acak. Kunci yang bisa ditebak berarti berkas satu ' +
        'outlet bisa ditimpa oleh outlet lain, karena tokennya sama untuk semua orang.'
    );
  }
  const bUpload = blokSampai(kode, "if (aksi === 'upload-url')", "if (aksi === 'view-url')");
  if (!bUpload) salah("konten-r2: cabang `upload-url` tidak ditemukan — pemeriksaan kunci unggah kehilangan sasarannya.");
  if (/body\.r2_key/.test(bUpload)) {
    salah(
      'konten-r2: `upload-url` membaca kunci dari badan permintaan. Itu membuka SELURUH bucket untuk siapa pun yang ' +
        'punya satu tugas sah — termasuk menimpa berkas outlet lain.'
    );
  }
  if (!/susunKunci\(tugas\.outlet_id, tugas\.id/.test(bUpload)) {
    salah('konten-r2: kunci unggah tidak lagi disusun dari outlet & tugas yang SUDAH diverifikasi.');
  }
  if (!/tugas\.status === 'selesai'/.test(bUpload)) {
    salah(
      "konten-r2: `upload-url` tidak lagi menolak tugas berstatus 'selesai'. Berkas yang masuk ke sana langsung " +
        'masuk antrean penghapusan — hilang beberapa hari kemudian tanpa pernah dilihat siapa pun, dan staff yakin ' +
        'ia sudah menyetornya.'
    );
  }

  // ============ PEMANGGILNYA DIVERIFIKASI, BUKAN DIPERCAYA ============
  //
  // Function ini `service_role`: apa pun yang dikerjakannya MELEWATI RLS.
  if (!/admin\.auth\.getUser\(token\)/.test(kode)) {
    salah(
      'konten-r2: JWT pemanggil tidak lagi diverifikasi. Function ini `service_role`, jadi menerbitkan URL unggah ' +
        'tanpa tahu siapa yang meminta sama saja dengan membuka bucket untuk siapa pun yang punya anon key.'
    );
  }
  if (!/from\('membership_scopes'\)/.test(kode)) {
    salah('konten-r2: wewenang pemanggil tidak lagi diperiksa terhadap `membership_scopes`. RLS tidak berlaku di sini — tidak ada yang menolak otomatis.');
  }

  // `view-url`: kuncinya harus benar-benar milik tugas itu.
  const bView = blokSampai(kode, "if (aksi === 'view-url')", "if (aksi === 'delete')");
  if (!/\.eq\('tugas_id', tugas\.id\)[\s\S]{0,80}\.eq\('r2_key', kunci\)/.test(bView)) {
    salah(
      'konten-r2: `view-url` tidak lagi memastikan kuncinya milik tugas itu. Siapa pun yang punya satu tugas sah ' +
        'bisa meminta URL untuk kunci mana pun di bucket — termasuk milik outlet lain — cukup dengan menyalinnya.'
    );
  }
  const bDel = blok(kode, "if (aksi === 'delete')", 900);
  if (!/if \(!adminBu\) return json/.test(bDel)) {
    salah('konten-r2: aksi `delete` tidak lagi khusus Admin BU — staff bisa menghapus setoran orang lain dari penyimpanan, permanen.');
  }
  // Setelan yang kurang harus BERBUNYI, bukan menghasilkan URL yang ditolak R2
  // dengan XML yang tidak menyebut sebabnya.
  if (!/Setelan R2 belum lengkap/.test(kode)) {
    salah(
      'konten-r2: pemeriksaan secret yang belum lengkap hilang. Kunci kosong menghasilkan URL bertanda tangan yang ' +
        'TERLIHAT sah lalu ditolak R2 dengan galat XML — staff melihat "unggah gagal" dan tidak ada yang tahu bahwa ' +
        'yang kurang cuma satu secret.'
    );
  }
}

// =====================================================================
// 8. Edge Function purge-konten.
// =====================================================================
const purge = baca('supabase/functions/purge-konten/index.ts');
if (purge) {
  const kode = bersih(purge, 'purge-konten/index.ts', ['hapusObjek', 'semuaBeres']);

  // ============ 404 ADALAH KEBERHASILAN ============
  const bHapus = blok(kode, 'async function hapusObjek', 400);
  if (!/res\.ok \|\| res\.status === 404/.test(bHapus)) {
    salah(
      'purge-konten: 404 tidak lagi dianggap berhasil. Objek yang memang sudah tidak ada akan dicoba lagi setiap ' +
        'malam, selamanya, tanpa pernah berhasil — antrean yang tidak pernah habis.'
    );
  }

  // ============ PENANDA HANYA KALAU SEMUANYA BERES ============
  if (!/if \(semuaBeres\)/.test(kode)) {
    salah(
      'purge-konten: `berkas_dihapus_at` diisi tanpa memastikan SEMUA berkasnya terhapus. Satu berkas yang gagal ' +
        'lalu tugasnya ditandai bersih berarti berkas itu keluar dari antrean SELAMANYA — bocor tanpa jejak, tetap ' +
        'memakan kuota 10 GB.'
    );
  }

  // ============ URUTAN: OBJEK DULU, BARIS KEMUDIAN ============
  const iTandai = kode.indexOf("update({ berkas_dihapus_at");
  const iHapusBaris = kode.indexOf("from('konten_berkas').delete()");
  if (iTandai < 0 || iHapusBaris < 0) {
    salah('purge-konten: jalur pembersihan tugas selesai tidak lengkap.');
  } else if (iHapusBaris < iTandai) {
    salah(
      'purge-konten: baris `konten_berkas` dihapus SEBELUM penandanya. Penghapusan baris memicu trigger sampah, ' +
        'jadi pekerjaan ini akan mengejar kunci yang sudah tidak ada — dan penandanya bisa tidak pernah terisi.'
    );
  }

  // Pembersih sampah adalah separuh gunanya: objek yang barisnya hilang lewat
  // jalan apa pun tidak ditunjuk apa pun, jadi tidak ada yang tahu ia ada.
  // Diikat ke SELECT-nya, bukan ke nama tabelnya se-berkas: `update` di bawah
  // juga menyebut tabel yang sama, jadi audit se-berkas tetap hijau sesudah
  // pembacaannya dialihkan ke tabel lain. Ditemukan sabotasenya.
  if (!/from\('konten_berkas_sampah'\)\s*\.select\('r2_key'\)/.test(kode)) {
    salah(
      'purge-konten: pembersih `konten_berkas_sampah` hilang. Objek yang barisnya sudah hilang tidak muncul di layar ' +
        'mana pun — kebocoran yang baru ketahuan bertahun-tahun kemudian sebagai "kenapa R2 saya penuh".'
    );
  }
  // Diikat ke BARIS PENJAGANYA dan ke pembacaan env-nya sekaligus. Mencari
  // nama "CRON_SECRET" saja tetap hijau sesudah `Deno.env.get` diganti nama:
  // penjaganya lalu membandingkan header dengan sesuatu yang tidak pernah
  // terisi. Ditemukan sabotasenya.
  if (!/Deno\.env\.get\('CRON_SECRET'\)/.test(kode) || !/req\.headers\.get\('x-cron-secret'\) !== CRON_SECRET/.test(kode)) {
    salah('purge-konten: pemeriksaan `CRON_SECRET` hilang atau tidak lagi membandingkan header dengan secret yang benar-benar dibaca — siapa pun yang tahu URL-nya bisa memicu penghapusan berkas.');
  }
  // `dry_run` ada karena cron yang melaporkan `succeeded` tanpa pernah
  // mengerjakan apa pun sudah terjadi di repo ini (rekap Telegram, berbulan-bulan).
  //
  // Diikat ke pembacaan BODY-nya: `hasil` memuat kunci `dry_run` juga, jadi
  // pencarian se-berkas tetap hijau untuk `dryRun` yang dipaku jadi false.
  if (!/body\.dry_run === true/.test(kode)) {
    salah('purge-konten: `dry_run` hilang — tidak ada cara memastikan cron-nya benar-benar mengenai sesuatu sebelum ia menghapus.');
  }
}

console.log('');
if (gagal === 0) console.log('Audit modul Konten Sosmed bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
