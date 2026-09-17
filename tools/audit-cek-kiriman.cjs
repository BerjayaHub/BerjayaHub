/**
 * AUDIT: pengecekan kiriman yang bisa dicicil (0142).
 *
 * ============ CARA FITUR INI RUSAK TANPA TERLIHAT RUSAK ============
 *
 *   kotak "Diterima" terisi lagi   -> "belum dicek" menyamar jadi "dicek dan
 *                                     pas"; susutnya nol, laporannya rapi, dan
 *                                     selisihnya muncul berminggu-minggu
 *                                     kemudian di opname
 *   `Number('')` tidak disaring    -> kotak kosong tercatat 0, yaitu "barangnya
 *                                     tidak datang sama sekali" — salah ke arah
 *                                     yang berlawanan, sama diamnya
 *   baris tanpa kunci ikut ditulis -> staff kedua MENGHAPUS hitungan staff
 *                                     pertama saat menyimpan bagiannya sendiri
 *   `dicek_by` ditimpa tanpa syarat-> nama pengecek hilang dari baris yang ia
 *                                     hitung sendiri, justru saat ada selisih
 *   terima menebak yang kosong     -> seluruh gunanya hilang
 *   Simpan Sementara menggerakkan
 *   stok                           -> SJ bisa berhenti di tengah selamanya
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

/** Komentar SATU BARIS PENUH dibuang sebelum SQL diperiksa (jebakan 0137). */
const tanpaKomentarSql = (sql) => String(sql).replace(/^[ \t]*--.*$/gm, '');

const blokAntara = (teks, mulai, selesai) => {
  const i = teks.indexOf(mulai);
  if (i < 0) return '';
  const j = selesai ? teks.indexOf(selesai, i + mulai.length) : -1;
  return teks.slice(i, j > i ? j : undefined);
};

// ---------------------------------------------------------------
// 1. Migration.
// ---------------------------------------------------------------
const mig = baca('supabase/migrations/0142_cek_kiriman_bisa_dicicil.sql');
if (mig) {
  const sql = tanpaKomentarSql(mig);

  for (const kolom of ['dicek_qty', 'dicek_by', 'dicek_at']) {
    // `create table if not exists` TIDAK menambah kolom ke tabel yang sudah ada.
    if (!new RegExp(`alter table dispatch_items add column if not exists ${kolom}\\b`).test(sql)) {
      salah(`0142: kolom \`${kolom}\` tidak ditambahkan dengan \`add column if not exists\`.`);
    }
  }
  // NULL harus SAH — ia yang berarti "belum dicek".
  if (!/check \(dicek_qty is null or dicek_qty >= 0\)/.test(sql)) {
    salah(
      '0142: batasan `dicek_qty` bukan `is null or >= 0`. NULL WAJIB sah — ia satu-satunya cara menyimpan "belum ' +
        'dijawab" yang tidak bisa tertukar dengan jawaban.'
    );
  }

  for (const fn of ['simpan_cek_kiriman', 'receive_dispatch']) {
    if (!new RegExp(`function ${fn}\\(`).test(sql)) salah(`0142: fungsi \`${fn}\` tidak ada.`);
    if (!new RegExp(`grant execute on function ${fn}\\(`).test(sql)) {
      salah(`0142: \`${fn}\` tidak di-grant ke authenticated — layarnya akan menjawab 42501.`);
    }
  }

  const blokCek = blokAntara(sql, 'function simpan_cek_kiriman', 'grant execute on function simpan_cek_kiriman');
  if (!blokCek) {
    salah('0142: badan `simpan_cek_kiriman` tidak ditemukan.');
  } else {
    // KUNCI YANG TIDAK ADA ≠ NILAI NULL.
    if (!/if not \(it \? 'dicek_qty'\) then continue; end if;/.test(blokCek)) {
      salah(
        "0142 `simpan_cek_kiriman`: baris tanpa kunci `dicek_qty` tidak dilewati. `it->>'dicek_qty'` menghasilkan NULL " +
          'baik saat nilainya null maupun saat kuncinya tidak ada — tanpa pembeda ini, staff kedua MENGHAPUS hitungan ' +
          'staff pertama saat menyimpan bagiannya sendiri.'
      );
    }
    // Jejak pengecek hanya berpindah kalau angkanya BERUBAH.
    if (!/if v_qty is distinct from v_lama then/.test(blokCek)) {
      salah(
        '0142 `simpan_cek_kiriman`: `dicek_by` ditulis ulang tanpa syarat. Staff yang menyimpan seluruh formulir akan ' +
          'menghapus nama orang yang benar-benar menghitung barisnya — justru nama yang dicari saat ada selisih.'
      );
    }
    if (!/has_outlet_scope\(v_uid, v_d\.to_outlet_id\)/.test(blokCek)) {
      salah('0142 `simpan_cek_kiriman`: siapa pun bisa mengecek kiriman outlet lain.');
    }
    if (!/v_d\.status <> 'sent'/.test(blokCek)) salah('0142 `simpan_cek_kiriman`: kiriman yang sudah diproses masih bisa diubah.');
    // TIDAK BOLEH menggerakkan stok.
    if (/insert into stock_movements/.test(blokCek)) {
      salah(
        '0142 `simpan_cek_kiriman`: menulis ke `stock_movements`. Simpan Sementara tidak boleh menggerakkan satu gram ' +
          'pun — SJ yang stoknya separuh berpindah bisa berhenti di tengah selamanya.'
      );
    }
    if (/update dispatches set status/.test(blokCek)) {
      salah('0142 `simpan_cek_kiriman`: menutup SJ. Seluruh gunanya justru supaya SJ TETAP terbuka.');
    }
  }

  const blokTerima = blokAntara(sql, 'function receive_dispatch', 'grant execute on function receive_dispatch');
  if (!blokTerima) {
    salah('0142: badan `receive_dispatch` tidak ditemukan.');
  } else {
    // MENOLAK yang belum dicek, dan menyebut namanya.
    if (!/di\.dicek_qty is null/.test(blokTerima) || !/raise exception 'Masih ada bahan yang belum dicek/.test(blokTerima)) {
      salah(
        '0142 `receive_dispatch`: baris yang belum dicek tidak lagi menghentikan penerimaan. Menerima diam-diam ' +
          '"sesuai kiriman" adalah persis kebiasaan yang diperbaiki 0142; menerima diam-diam nol sama buruknya ke arah lain.'
      );
    }
    if (!/string_agg\(p\.name/.test(blokTerima)) {
      salah('0142 `receive_dispatch`: penolakannya tidak menyebut nama barangnya — orangnya harus menyisir ulang seluruh tabel.');
    }
    // Pergerakan stok dibaca dari TABEL, bukan dari `p_items`.
    if (!/from dispatch_items di\s*\n\s*where di\.dispatch_id = p_dispatch/.test(blokTerima)) {
      salah(
        '0142 `receive_dispatch`: pergerakan stok tidak lagi dibaca dari tabelnya. Layar yang tertinggal versi bisa ' +
          'mengirim sebagian baris saja, dan yang tidak terkirim kehilangan pergerakan stoknya tanpa satu pun tanda.'
      );
    }
    if (!/perform simpan_cek_kiriman\(p_dispatch, p_items\)/.test(blokTerima)) {
      salah('0142 `receive_dispatch`: angka dari layar tidak dituangkan lewat `simpan_cek_kiriman` — jadi ada dua jalan menulis hasil cek.');
    }
    // LAPIS KEDUA, dan auditlah satu-satunya yang bisa menjaganya.
    //
    // `coalesce(r.dicek_qty, 0)` tidak pernah tercapai selama `raise exception`
    // di atas berdiri, jadi tes perilaku TIDAK bisa membedakannya dari
    // `coalesce(r.dicek_qty, r.sent_qty)`. Yang dijaga di sini: kalau penjaga di
    // atas suatu saat dilonggarkan, yang tersisa harus tetap 0 — bukan diam-diam
    // berubah jadi "terima sesuai kiriman".
    if (!/v_recv := coalesce\(r\.dicek_qty, 0\);/.test(blokTerima)) {
      salah(
        '0142 `receive_dispatch`: lapis kedua bukan lagi `coalesce(dicek_qty, 0)`. Kalau penjaga "belum dicek" di ' +
          'atasnya suatu saat dilonggarkan, baris yang tak terhitung akan diterima sebagai angka kiriman — persis ' +
          'kebiasaan yang diperbaiki 0142.'
      );
    }
  }
}

// ---------------------------------------------------------------
// 2. Modul murninya.
// ---------------------------------------------------------------
const murni = baca('js/modules/dispatch/cek-kiriman.js');
if (murni) {
  const kode = bersih(murni, 'cek-kiriman.js', ['export function bacaCek', 'export function ringkasCek']);

  for (const n of ['bacaCek', 'sudahDicek', 'ringkasCek', 'teksKemajuan', 'pengecekTerakhir', 'muatanCek']) {
    if (!new RegExp(`export function ${n}\\(`).test(kode)) salah(`cek-kiriman.js: \`${n}\` tidak diekspor.`);
  }
  // KOSONG BUKAN NOL.
  if (!/if \(t === ''\) return null;/.test(kode)) {
    salah(
      "cek-kiriman.js: string kosong tidak disaring. `Number('')` adalah 0 — kotak yang dibiarkan kosong akan tercatat " +
        'sebagai "barangnya tidak datang sama sekali", dan stok outlet tidak bertambah.'
    );
  }
  if (!/if \(!Number\.isFinite\(n\) \|\| n < 0\) return null;/.test(kode)) {
    salah('cek-kiriman.js: angka non-finite atau negatif tidak ditolak.');
  }
  // Isian layar menang atas yang tersimpan.
  if (!/isian instanceof Map && isian\.has\(it\?\.id\) \? isian\.get\(it\.id\) : it\?\.dicek_qty/.test(kode)) {
    salah(
      'cek-kiriman.js: kemajuan tidak lagi dihitung dari apa yang SEDANG DIKETIK. Layar akan berkata "3 belum dicek" ' +
        'sementara ketiganya sudah terisi di depan mata orangnya.'
    );
  }
  // Nama yang belum dicek dibawa, bukan cuma jumlahnya.
  if (!/namaBelum: belum/.test(kode)) {
    salah('cek-kiriman.js: nama bahan yang belum dicek tidak dibawa — "3 bahan belum dicek" membuat orangnya menyisir ulang seluruh tabel.');
  }
  // Muatan selalu menyertakan kuncinya.
  if (!/\{ item_id, dicek_qty: bacaCek\(v\) \}/.test(kode)) {
    salah(
      'cek-kiriman.js `muatanCek`: kunci `dicek_qty` tidak selalu disertakan. Di server, kunci yang TIDAK ADA berarti ' +
        '"tidak sedang saya sentuh" — muatan yang menghilangkannya membuat pembatalan cek mustahil.'
    );
  }
}

// ---------------------------------------------------------------
// 3. Layarnya.
// ---------------------------------------------------------------
const page = baca('js/modules/dispatch/dispatch.page.js');
if (page) {
  const kode = bersih(page, 'dispatch.page.js', ['btn-save-cek', 'class="recv-input']);

  // KOTAKNYA MULAI KOSONG — ini bug utama yang diperbaiki.
  if (/class="recv-input isian-sempit" min="0" data-item="\$\{it\.id\}" value="\$\{round\(it\.sent_qty\)\}"/.test(kode)) {
    salah(
      'dispatch.page.js: kotak "Diterima" kembali terisi angka kiriman. "Belum dicek" lalu tidak bisa dibedakan dari ' +
        '"dicek dan pas" — menekan Simpan tanpa menghitung apa pun menghasilkan catatan yang identik dengan hitungan teliti.'
    );
  }
  if (!/value="\$\{it\.dicek_qty == null \? '' : round\(it\.dicek_qty\)\}"/.test(kode)) {
    salah('dispatch.page.js: kotak "Diterima" tidak lagi diisi dari hasil cek tersimpan — cicilan orang sebelumnya hilang dari layar.');
  }
  if (!/placeholder="belum dicek"/.test(kode)) {
    salah('dispatch.page.js: kotak kosong tidak diberi keterangan "belum dicek" — kosong tanpa penjelasan terbaca seperti kelalaian layar.');
  }

  // Jalan pintas supaya kotak kosong tidak jadi siksaan.
  if (!/btn-semua-sesuai/.test(kode) || !/btn-samakan/.test(kode)) {
    salah('dispatch.page.js: tombol "Semua sesuai kiriman" / "= dikirim" hilang — kiriman yang memang pas jadi harus diketik satu per satu.');
  }
  if (!/if \(el\.value\.trim\(\) === ''\) el\.value = el\.dataset\.kirim;/.test(kode)) {
    salah(
      'dispatch.page.js: tombol borongan menimpa baris yang SUDAH diisi. Hitungan orang lain tidak boleh hilang hanya ' +
        'karena satu tombol ditekan.'
    );
  }

  // Simpan Sementara.
  //
  // KELASNYA DISEBUT LENGKAP BERIKUT TANDA KUTIP PENUTUPNYA. Mencari
  // `btn-save-cek` saja lolos untuk kelas yang dinamai `btn-save-cek-nonaktif`
  // — nama yang dicari masih jadi AWALAN nama barunya, tombolnya tidak pernah
  // tersambung, dan auditnya tetap hijau. Jebakan yang persis sama sudah
  // meloloskan sabotase kebijakan `cash_entries_select_bu_admin` di 0141.
  if (!/class="btn-save-cek"/.test(kode)) salah('dispatch.page.js: tombol Simpan Sementara tidak digambar.');
  if (!/querySelectorAll\('\.btn-save-cek'\)/.test(kode)) {
    salah('dispatch.page.js: tombol Simpan Sementara digambar tapi tidak pernah dipasangi penangan klik.');
  }
  if (!/simpanCekKiriman\(btn\.dataset\.id, muatanCek\(isianKartu\(kartu\)\)\)/.test(kode)) {
    salah('dispatch.page.js: Simpan Sementara tidak mengirim muatan dari modul murni.');
  }
  if (!/Stok belum bergerak/.test(kode)) {
    salah('dispatch.page.js: Simpan Sementara tidak mengatakan bahwa stok belum bergerak — orangnya akan mengira barangnya sudah masuk pembukuan.');
  }

  // Kemajuan & jejak.
  if (!/teksKemajuan\(r, jejak\)/.test(kode)) salah('dispatch.page.js: kemajuan pengecekan tidak ditampilkan di kartunya.');
  if (!/pengecekTerakhir\(items/.test(kode)) salah('dispatch.page.js: siapa yang terakhir mengecek tidak ditampilkan.');
  if (!/recv-jejak/.test(kode)) salah('dispatch.page.js: jejak "dicek siapa" per baris tidak digambar.');

  // Terima tidak menebak.
  const blok = blokAntara(kode, "btn-save-receive').forEach", 'lengkapiKeteranganKiriman');
  if (!blok) {
    salah('dispatch.page.js: penangan tombol Terima tidak ditemukan.');
  } else {
    if (!/if \(r\.belum\)/.test(blok)) {
      salah(
        'dispatch.page.js: tombol Terima tidak lagi bertanya saat masih ada baris kosong. Dua jawabannya sama-sama sah; ' +
          'yang tidak sah adalah memilihkannya tanpa memberi tahu.'
      );
    }
    for (const [apa, pola] of [
      ['batal', /value: 'batal'/],
      ['sesuai kiriman', /value: 'sesuai'/],
      ['nol', /value: 'nol'/]
    ]) {
      if (!pola.test(blok)) salah(`dispatch.page.js: pilihan "${apa}" hilang dari pertanyaan baris yang belum dicek.`);
    }
    if (!/if \(!pilih \|\| pilih\.aksi === 'batal'\) return;/.test(blok)) {
      salah('dispatch.page.js: menutup dialog tanpa memilih tetap melanjutkan penerimaan.');
    }
  }
}

const svc = baca('js/modules/dispatch/dispatch.service.js');
if (svc) {
  const kode = bersih(svc, 'dispatch.service.js', ['export async function simpanCekKiriman']);
  if (!/export async function simpanCekKiriman\(/.test(kode)) salah('dispatch.service.js: `simpanCekKiriman` tidak ada.');
  if (!/dicek_qty, dicek_at/.test(kode)) salah('dispatch.service.js: kolom hasil cek tidak ikut diambil — layar tidak akan melihat cicilan orang lain.');
  if (!/pengecek:user_profiles!dicek_by\(full_name\)/.test(kode)) {
    salah('dispatch.service.js: nama pengecek tidak ikut diambil — jejaknya tersimpan di database tapi tidak pernah terlihat.');
  }
  // Jaring pengaman "migration belum dijalankan" harus ikut mengenali kolom baru.
  if (!/dicek_qty\|dicek_at\|dicek_by/.test(kode)) {
    salah(
      'dispatch.service.js: jaring pengaman kolom-belum-ada tidak mengenali kolom 0142. Antara push dan migration, ' +
        'SATU kolom tak dikenal membuat SELURUH isi kiriman menghilang dari layar — persis yang terjadi di 0122 & 0132.'
    );
  }
}

if (gagal === 0) {
  console.log(
    'Cek kiriman: kotaknya mulai kosong, cicilan dua orang tidak saling menimpa, jejak pengeceknya utuh, Simpan ' +
      'Sementara tidak menggerakkan stok, dan Terima menolak menebak. ✅'
  );
}
process.exit(gagal === 0 ? 0 : 1);
