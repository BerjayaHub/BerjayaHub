/**
 * AUDIT: revisi Surat Jalan yang sudah diterima (0165).
 *
 * ============ CARA FITUR INI RUSAK TANPA TERLIHAT RUSAK ============
 *
 * Seluruhnya berbentuk sama: angka di layar benar, stok diam-diam melenceng.
 * Tidak ada galat di mana pun, dan yang membacanya baru tahu saat opname
 * berikutnya — berminggu-minggu kemudian, saat sebabnya sudah tidak bisa
 * ditelusuri.
 *
 *   ubah jumlah diterima ikut
 *     memotong stok asal          -> stok CK berkurang DUA KALI untuk satu
 *                                    pengiriman
 *   tambah barang TIDAK memotong
 *     stok asal                   -> barang keluar dari CK tanpa tercatat
 *   gerakan lama ditimpa          -> laporan periode lampau berubah sendiri
 *                                    berbulan-bulan sesudah ditutup
 *   penjaga status dicabut        -> SJ yang masih draft/sent ikut "direvisi",
 *                                    menulis gerakan stok untuk barang yang
 *                                    belum berpindah sama sekali
 *   jejak tanpa nama pelaku       -> catatan pertanggungjawaban yang tidak
 *                                    mempertanggungjawabkan siapa pun
 *   tanda ESB dibiarkan           -> berkas yang sudah dikirim memuat angka
 *                                    lama, dan selisihnya tidak pernah sampai
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

const blokSampai = (kode, mulai, akhir) => {
  const i = kode.indexOf(mulai);
  if (i < 0) return '';
  const j = kode.indexOf(akhir, i + mulai.length);
  return kode.slice(i, j < 0 ? undefined : j);
};

// =====================================================================
// 1. MIGRATION 0165.
// =====================================================================
const mig = baca('supabase/migrations/0165_revisi_kiriman_diterima.sql');
if (mig) {
  const kode = tanpaSqlKomentar(mig);
  if (!/create or replace function revisi_kiriman_diterima/.test(kode)) {
    salah('audit-revisi-kiriman: penyaring komentar SQL ikut memakan kodenya — pemeriksaan di bawah tidak bisa dipercaya.');
  }
  if (/KAPAN STOK SEBENARNYA BERGERAK/.test(kode)) {
    salah('audit-revisi-kiriman: komentar SQL tidak tersaring — pemeriksaan di bawah bisa hijau karena kalimat penjelasnya.');
  }

  const fn = blokSampai(kode, 'create or replace function revisi_kiriman_diterima', '\n$$;');

  // ============ PENJAGA STATUS ============
  //
  // Tanpa ini, SJ yang masih 'sent' ikut "direvisi" — dan RPC-nya menulis
  // gerakan stok untuk barang yang belum berpindah sama sekali.
  if (!/if v_d\.status <> 'received' then/.test(fn)) {
    salah(
      "0165: penjaga `status = 'received'` hilang. SJ yang masih draft/dikirim akan ikut direvisi, dan RPC-nya " +
        'menulis gerakan stok untuk barang yang belum berpindah sama sekali.'
    );
  }
  for (const [pola, apa] of [
    [/Draft Surat Jalan/, 'arahan untuk status draft'],
    [/layar Terima/, 'arahan untuk status dikirim']
  ]) {
    if (!pola.test(fn)) {
      salah(`0165: pesan penolakannya tidak lagi memuat ${apa} — "tidak bisa direvisi" saja meninggalkan orangnya di tempat yang sama.`);
    }
  }

  if (!/if not boleh_revisi_kiriman\(p_dispatch\) then/.test(fn)) {
    salah('0165: pemeriksaan wewenang hilang. Fungsinya `security definer`, jadi RLS tidak berlaku di dalamnya sama sekali.');
  }
  if (!/if v_alasan = '' then/.test(fn)) {
    salah('0165: alasan revisi tidak lagi wajib — perubahan stok tanpa sebab yang tercatat tidak bisa dipertanggungjawabkan.');
  }

  // ============ DUA JALUR STOK YANG BERBEDA ============
  //
  // Ini pemeriksaan terpenting di berkas ini.
  const bBaru = blokSampai(fn, 'if v_lama.id is null then', 'else');
  if (!bBaru) {
    salah('0165: cabang "barang baru" hilang — menambah barang ke SJ yang sudah diterima tidak akan memotong stok asal.');
  } else {
    if (!/v_d\.from_outlet_id, v_pid, 'transfer_out', -v_sent/.test(bBaru)) {
      salah(
        '0165: penambahan barang tidak lagi menulis `transfer_out` di outlet ASAL. Barangnya keluar dari CK tanpa ' +
          'tercatat — stok CK terbaca lebih besar dari kenyataan, selamanya.'
      );
    }
    if (!/v_d\.to_outlet_id, v_pid, 'transfer_in', v_recv/.test(bBaru)) {
      salah('0165: penambahan barang tidak lagi menulis `transfer_in` di outlet tujuan.');
    }
    if (!/if v_sent is null or v_sent < 0 then/.test(bBaru)) {
      salah(
        '0165: `sent_qty` tidak lagi wajib untuk barang baru. Menebaknya dari jumlah diterima menyamarkan susut ' +
          'jadi nol pada barang yang justru ditambahkan karena ada selisih.'
      );
    }
  }

  const bLama = blokSampai(fn, 'v_delta := v_recv - coalesce(v_lama.received_qty, 0);', 'v_ubah := v_ubah + 1;');
  if (!bLama) {
    salah('0165: cabang "ubah jumlah diterima" hilang.');
  } else {
    if (!/v_d\.to_outlet_id, v_pid, 'transfer_in', v_delta/.test(bLama)) {
      salah('0165: koreksi jumlah diterima tidak lagi menulis gerakan stok di outlet tujuan — angkanya berubah, stoknya tidak.');
    }
    // ============ DAN TIDAK BOLEH MENYENTUH STOK ASAL ============
    //
    // `transfer_out` memakai `sent_qty`, yang TIDAK ikut berubah. Kalau cabang
    // ini ikut menulis gerakan di outlet asal, stok CK berkurang dua kali
    // untuk satu pengiriman.
    if (/from_outlet_id, v_pid, 'transfer_out'/.test(bLama)) {
      salah(
        '0165: koreksi jumlah diterima ikut menggerakkan stok outlet ASAL. `transfer_out` memakai `sent_qty` yang ' +
          'tidak ikut berubah — stok CK akan berkurang DUA KALI untuk satu pengiriman, tanpa galat di mana pun.'
      );
    }
  }

  // ============ KOREKSI DITULIS, BUKAN MENIMPA ============
  if (/update stock_movements/.test(fn)) {
    salah(
      '0165: gerakan stok lama ditimpa. Stok sekarang mungkin benar, tapi laporan periode lampau berubah sendiri ' +
        'berbulan-bulan sesudah ditutup — dan tidak ada yang bisa menjelaskan kenapa angkanya bergeser.'
    );
  }
  if (/delete from stock_movements/.test(fn)) {
    salah('0165: gerakan stok lama dihapus. Riwayat "apa yang terjadi hari itu" hilang, dan itu satu-satunya hal yang tidak bisa dibuat ulang.');
  }

  // ============ JEJAK: NAMA DISIMPAN, BUKAN CUMA ID ============
  if (!/v_nama_pelaku text := coalesce\(\(select full_name from user_profiles where id = auth\.uid\(\)\)/.test(fn)) {
    salah(
      '0165: nama pelaku tidak lagi diambil saat perubahan. Jejak yang cuma menyimpan id bergantung pada baris ' +
        '`user_profiles` yang masih ada — staff yang keluar membuat seluruh riwayatnya berbunyi "pengguna tak dikenal".'
    );
  }
  for (const [pola, apa] of [
    [/'by', v_uid, 'by_nama', v_nama_pelaku/g, 'nama pelaku di jejak baris'],
    [/direvisi_by_nama = v_nama_pelaku/, 'nama pelaku di header SJ']
  ]) {
    const cocok = typeof pola.test === 'function' && pola.global ? (fn.match(pola) ?? []).length >= 2 : pola.test(fn);
    if (!cocok) {
      salah(`0165: ${apa} hilang. \`direvisi_by\` ber-\`on delete set null\`, jadi penunjuknya menguap begitu barisnya dihapus.`);
    }
  }
  if (!/alter table dispatches add column if not exists direvisi_by_nama text;/.test(kode)) {
    salah('0165: kolom `direvisi_by_nama` hilang dari skema.');
  }
  if (!/alter table dispatch_items add column if not exists revisi jsonb not null default '\[\]'::jsonb;/.test(kode)) {
    salah('0165: kolom jejak `dispatch_items.revisi` hilang.');
  }
  // Jejak DITAMBAH, tidak ditimpa.
  if (!/revisi = revisi \|\| jsonb_build_object/.test(fn)) {
    salah(
      '0165: jejak revisi menimpa isi lamanya, bukan menambah. Riwayat revisi yang menyisakan satu entri terakhir ' +
        'tidak bisa menjawab "siapa yang mengubahnya pertama kali".'
    );
  }

  // ============ TANDA ESB DICABUT ============
  if (!/esb_exported_at = null/.test(fn) || !/esb_dibatalkan_at = now\(\)/.test(fn)) {
    salah(
      '0165: tanda ekspor ESB tidak lagi dicabut saat SJ direvisi. Berkas yang sudah dikirim memuat angka lama, ' +
        'dan SJ ini tidak akan pernah ikut ekspor berikutnya — selisihnya tidak pernah sampai ke ESB.'
    );
  }
  if (!/esb_dibatalkan_by = v_uid/.test(fn)) {
    salah('0165: pencabutan tanda ESB tidak berjejak.');
  }

  // Penjaga wewenang terpisah, supaya layar bisa menanyakannya tanpa menulis.
  const bw = blokSampai(kode, 'create or replace function boleh_revisi_kiriman', '\n$$;');
  if (!/has_outlet_scope\(auth\.uid\(\), d\.from_outlet_id\) or has_outlet_scope\(auth\.uid\(\), d\.to_outlet_id\)/.test(bw)) {
    salah(
      'boleh_revisi_kiriman: tidak lagi membuka untuk CK MAUPUN outlet tujuan. Memaksa yang salah ketik menunggu ' +
        'pihak lain membuat orang memilih jalan lain: SJ tandingan, atau angka yang dibiarkan salah.'
    );
  }
  if (!/d\.status = 'received'/.test(bw)) {
    salah('boleh_revisi_kiriman: penjaga status hilang — tombol Revisi akan muncul untuk SJ yang belum diterima.');
  }
}

// =====================================================================
// 2. MODUL MURNI.
// =====================================================================
const mod = baca('js/modules/dispatch/revisi-kiriman.js');
if (mod) {
  const kode = bersih(mod, 'revisi-kiriman.js', ['akibatStok', 'susunMuatanRevisi']);

  // Hanya yang BERUBAH yang dikirim.
  if (!/if \(Number\(asli\.received_qty \?\? 0\) === terima\) continue;/.test(kode)) {
    salah(
      'revisi-kiriman.js: baris yang angkanya tidak berubah ikut dikirim. RPC menulis satu gerakan stok per baris ' +
        'yang dikirim — yang tidak berubah menghasilkan gerakan bernilai nol, sampah yang membuat riwayat stok ' +
        'sulit dibaca justru saat sedang ditelusuri.'
    );
  }
  // Baris lama TIDAK membawa sent_qty.
  const bLama = blokSampai(kode, 'if (Number(asli.received_qty ?? 0) === terima) continue;', '\n  }');
  if (/sent_qty/.test(bLama)) {
    salah(
      'revisi-kiriman.js: baris yang sudah ada ikut membawa `sent_qty`. Itu yang memotong stok asal — mengirimnya ' +
        'untuk baris lama membuat stok CK bergerak pada revisi yang seharusnya hanya menyentuh outlet tujuan.'
    );
  }

  // ============ AKIBAT KE DUA OUTLET DIBEDAKAN ============
  const ak = blokSampai(kode, 'export function akibatStok', 'export function pesanAkibat');
  if (!/if \(!asli\) \{/.test(ak)) {
    salah('revisi-kiriman.js: `akibatStok` tidak lagi membedakan barang baru dari baris yang sudah ada.');
  }
  if (!/keAsal\.push\(\{ product_id: m\.product_id, delta: -Number\(m\.sent_qty\)/.test(ak)) {
    salah('revisi-kiriman.js: barang baru tidak lagi dihitung memotong stok asal.');
  }
  // Baris yang sudah ada TIDAK boleh menyentuh keAsal.
  const bUbah = blokSampai(ak, 'const delta = Number(m.received_qty)', '  }');
  if (/keAsal/.test(bUbah)) {
    salah(
      'revisi-kiriman.js: perubahan jumlah diterima ikut dihitung menyentuh stok asal. Layar lalu mengumumkan ' +
        'pemotongan stok CK yang tidak terjadi — dan orang CK mencari barang yang tidak ke mana-mana.'
    );
  }

  // `sent_qty` wajib untuk barang baru.
  if (!/Barang baru harus disertai jumlah KIRIM-nya/.test(kode)) {
    salah('revisi-kiriman.js: barang baru tidak lagi mensyaratkan jumlah kirim.');
  }

  // Penolakan menyebut sebabnya.
  const al = blokSampai(kode, 'export function alasanTakBisaRevisi', 'export const bisaRevisi');
  for (const [pola, apa] of [
    [/Draft Surat Jalan/, 'arahan untuk draft'],
    [/layar Terima/, 'arahan untuk yang belum diterima'],
    [/pengirim maupun/, 'sebab penolakan wewenang']
  ]) {
    if (!pola.test(al)) {
      salah(`revisi-kiriman.js: penolakan tidak lagi menyebut ${apa}. Tombol yang hilang tanpa penjelasan membuat orang mengira fiturnya rusak.`);
    }
  }

  // Jejak: `by_nama` diutamakan.
  if (!/teks\(r\?\.by_nama\) \|\| peta\.get\(teks\(r\?\.by\)\)/.test(kode)) {
    salah(
      'revisi-kiriman.js: `by_nama` tidak lagi diutamakan di jejak. Nama SAAT perubahan yang benar untuk catatan ' +
        'pertanggungjawaban, bukan nama hari ini — dan staff yang barisnya hilang membuat seluruh riwayatnya anonim.'
    );
  }
  if (!/pengguna tak dikenal/.test(kode)) {
    salah('revisi-kiriman.js: pelaku yang tidak ketemu dibiarkan kosong. Jejak revisi tanpa pelaku sama saja dengan tidak ada jejaknya.');
  }
}

// =====================================================================
// 3. LAYANAN & LAYAR.
// =====================================================================
const svc = baca('js/modules/dispatch/dispatch.service.js');
if (svc) {
  const kode = bersih(svc, 'dispatch.service.js', ['revisiKirimanDiterima']);
  if (!/supabase\.rpc\('revisi_kiriman_diterima'/.test(kode)) {
    salah('dispatch.service.js: `revisiKirimanDiterima` tidak lagi lewat RPC — tulis langsung melewati seluruh penjaganya.');
  }
  // `revisi` harus ikut terambil, kalau tidak dialognya menampilkan jejak yang
  // tertinggal satu langkah dari angkanya.
  const gi = blokSampai(kode, 'export async function getDispatchItems', '\n}');
  if (!/'revisi, '/.test(gi)) {
    salah('dispatch.service.js: kolom `revisi` tidak lagi ikut diambil — dialog revisi tidak bisa menampilkan riwayatnya.');
  }
}

const dlg = baca('js/modules/dispatch/dialog-revisi-kiriman.js');
if (dlg) {
  const kode = bersih(dlg, 'dialog-revisi-kiriman.js', ['bukaDialogRevisiKiriman']);
  if (!/alasanTakBisaRevisi\(sj, outletSaya\)/.test(kode)) {
    salah(
      'dialog-revisi-kiriman.js: dialognya tidak lagi menolak lebih dulu. Orangnya akan mengisi seluruh dialog ' +
        'lalu ditolak server — pekerjaannya terbuang, dan penolakannya terbaca seperti kerusakan.'
    );
  }
  if (!/if \(!muatan\.length\)/.test(kode)) {
    salah('dialog-revisi-kiriman.js: muatan kosong tidak lagi ditahan — RPC akan menolak dengan kalimatnya sendiri sesudah perjalanan sia-sia.');
  }
  if (!/masalah\.length/.test(kode)) {
    salah('dialog-revisi-kiriman.js: masalah isian tidak lagi dilaporkan per barang.');
  }
}

const page = baca('js/modules/dispatch/dispatch.page.js');
if (page) {
  const kode = bersih(page, 'dispatch.page.js', ['btn-revisi-kiriman']);
  if (!/class="btn-revisi-kiriman"/.test(kode)) {
    salah('dispatch.page.js: tombol Revisi hilang — RPC-nya ada dan tidak bisa dicapai siapa pun dari layar.');
  }
  // ============ CABANG CK HARUS ADA SENDIRI ============
  //
  // Bentuknya dua cabang terpisah, bukan satu `||`: cabang pertama (outlet
  // tujuan) membawa Revisi + Teruskan, cabang kedua (CK) hanya Revisi.
  // Menggabungkannya jadi satu `||` sempat dipakai dan membuat
  // `audit-kiriman-salah-alamat` kehilangan sasarannya.
  if (!/d\.status === 'received' && d\.from_outlet_id === state\.outletId/.test(kode)) {
    salah(
      'dispatch.page.js: tombol Revisi tidak lagi muncul untuk kedua pihak. CK yang salah menulis jumlah kirim ' +
        'tidak punya cara membetulkannya sendiri.'
    );
  }
  if (!/bukaDialogRevisiKiriman\(\{/.test(kode)) {
    salah('dispatch.page.js: tombolnya ada tapi tidak membuka dialog apa pun — diklik, lalu tidak terjadi apa-apa.');
  }
  if (!/querySelectorAll\('\.btn-revisi-kiriman'\)/.test(kode)) {
    salah('dispatch.page.js: tombol Revisi tidak terhubung ke penangan apa pun.');
  }

  // ============ DUA CABANG, DUA TOMBOL — DIPERIKSA MASING-MASING ============
  //
  // Mencari `class="btn-revisi-kiriman"` se-berkas tetap hijau sesudah tombol
  // di SALAH SATU cabang dicabut: ia menemukan milik cabang yang lain. Lalu
  // satu pihak kehilangan tombolnya tanpa satu pun pemeriksa berbunyi.
  // Ditemukan sabotasenya.
  const cabangTujuan = blokSampai(
    kode,
    "d.status === 'received' && d.to_outlet_id === state.outletId",
    "d.status === 'received' && d.from_outlet_id === state.outletId"
  );
  const cabangAsal = blokSampai(kode, "d.status === 'received' && d.from_outlet_id === state.outletId", '</td>');
  for (const [blok, siapa] of [
    [cabangTujuan, 'outlet tujuan'],
    [cabangAsal, 'CK (outlet asal)']
  ]) {
    if (!/class="btn-revisi-kiriman"/.test(blok)) {
      salah(`dispatch.page.js: tombol Revisi hilang dari cabang ${siapa} — pihak itu tidak punya cara membetulkan angkanya sendiri.`);
    }
  }
  // Teruskan HANYA di cabang outlet tujuan — yang memegang barangnya.
  if (/btn-teruskan-kiriman/.test(cabangAsal)) {
    salah('dispatch.page.js: tombol Teruskan muncul di cabang CK. CK tidak memegang barangnya; meneruskan dari sana akan ditolak server.');
  }
}

console.log('');
if (gagal === 0) console.log('Audit revisi SJ diterima bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
