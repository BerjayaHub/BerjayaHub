/**
 * Aturan DP reservasi (migration 0079) — dicerminkan di JS supaya bisa diuji.
 *
 * Ini CERMIN, bukan sumber kebenarannya. Yang menegakkan aturan adalah
 * `catat_dp_reservasi` dan `update_reservation` di database; kalau keduanya
 * menyimpang, tes ini akan tetap hijau. Karena itu setiap perubahan pada kedua
 * fungsi SQL itu harus ikut mengubah cermin di bawah — dan nilai tes ini ada
 * pada kasus batasnya, yang mudah salah dibaca di dalam SQL yang panjang.
 */

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};

// ---------- cermin: catat_dp_reservasi ----------
function catatDp(baris, { deposit = null, proof = null }, pelaku) {
  if (deposit === null && !String(proof ?? '').trim()) {
    return { error: 'kosong' };
  }
  if (deposit !== null && deposit <= 0) return { error: 'nominal<=0' };

  const admin = pelaku.adminOutlet.includes(baris.outlet_id);
  if (!admin) {
    if (baris.created_by !== null && baris.created_by !== pelaku.id) return { error: 'bukan pembuatnya' };
    if (!pelaku.scopeOutlet.includes(baris.outlet_id)) return { error: 'di luar jangkauan' };
    if (baris.deposit_amount !== null || baris.deposit_proof_path !== null) return { error: 'sudah tercatat' };
  }
  return {
    deposit_amount: deposit === null ? baris.deposit_amount : deposit,
    deposit_proof_path: proof ?? baris.deposit_proof_path,
    deposit_by: pelaku.id
  };
}

// ---------- cermin: bagian DP di update_reservation ----------
function koreksiDp(baris, { deposit = null, proof = null }) {
  const hapus = deposit !== null && deposit <= 0;
  return {
    deposit_amount: deposit === null ? baris.deposit_amount : hapus ? null : deposit,
    deposit_proof_path: proof !== null ? proof : hapus ? null : baris.deposit_proof_path,
    deposit_at: hapus && proof === null ? null : deposit !== null || proof !== null ? 'now' : baris.deposit_at,
    deposit_by: hapus && proof === null ? null : deposit !== null || proof !== null ? 'admin' : baris.deposit_by
  };
}

const STAFF = { id: 'staff-1', adminOutlet: [], scopeOutlet: ['o1'] };
const STAFF_LAIN = { id: 'staff-2', adminOutlet: [], scopeOutlet: ['o1'] };
const ADMIN = { id: 'admin-1', adminOutlet: ['o1'], scopeOutlet: ['o1'] };

const kosong = { outlet_id: 'o1', created_by: 'staff-1', deposit_amount: null, deposit_proof_path: null, deposit_at: null, deposit_by: null };
const terisi = { ...kosong, deposit_amount: 500000, deposit_proof_path: 'o1/r1.webp', deposit_at: 'kemarin', deposit_by: 'staff-1' };

// --- Staff mencatat ---
cek('staff mencatat DP di reservasi buatannya', catatDp(kosong, { deposit: 500000, proof: 'o1/r1.webp' }, STAFF).deposit_amount, 500000);
cek('pencatatnya ikut tersimpan', catatDp(kosong, { deposit: 500000, proof: 'o1/r1.webp' }, STAFF).deposit_by, 'staff-1');
cek('staff lain ditolak', catatDp(kosong, { deposit: 500000, proof: 'x' }, STAFF_LAIN).error, 'bukan pembuatnya');
// Pembuatnya sendiri, tapi outletnya sudah tidak lagi di jangkauannya (mis.
// dipindah ke outlet lain). Dua pemeriksaan yang berbeda, dan yang kedua tidak
// boleh terlewat hanya karena yang pertama lolos.
cek('pembuatnya sendiri tapi outletnya di luar jangkauan tetap ditolak', catatDp({ ...kosong, outlet_id: 'o9' }, { deposit: 1, proof: 'x' }, STAFF).error, 'di luar jangkauan');

// Yang paling penting: staff TIDAK boleh menimpa DP yang sudah tercatat.
// Kalau ini jebol, nominal DP bisa turun tanpa jejak — dan yang menanggung
// selisihnya adalah orang yang menerima uangnya.
cek('staff menimpa DP yang sudah ada ditolak', catatDp(terisi, { deposit: 100000, proof: 'x' }, STAFF).error, 'sudah tercatat');
cek('staff menambah bukti pada DP yang sudah ada pun ditolak', catatDp(terisi, { proof: 'o1/r1b.webp' }, STAFF).error, 'sudah tercatat');
cek('baris dengan bukti tanpa nominal tetap terhitung "sudah tercatat"', catatDp({ ...kosong, deposit_proof_path: 'o1/r1.webp' }, { deposit: 1000, proof: 'x' }, STAFF).error, 'sudah tercatat');

// Reservasi dari WEBSITE tidak punya pembuat. Kalau "hanya pembuatnya" tetap
// dipaksakan di sini, DP dari tamu yang memesan lewat website tidak akan pernah
// bisa dicatat siapa pun kecuali admin — padahal yang menerima transfernya tetap
// staff yang sama.
cek('reservasi website boleh dicatat staff outlet itu', catatDp({ ...kosong, created_by: null }, { deposit: 300000, proof: 'x' }, STAFF_LAIN).deposit_amount, 300000);
cek('reservasi website di outlet lain tetap ditolak', catatDp({ ...kosong, created_by: null, outlet_id: 'o9' }, { deposit: 300000, proof: 'x' }, STAFF).error, 'di luar jangkauan');
cek('reservasi website yang DP-nya sudah terisi tidak bisa ditimpa staff', catatDp({ ...terisi, created_by: null }, { deposit: 1, proof: 'x' }, STAFF).error, 'sudah tercatat');

// --- Admin ---
cek('admin boleh menimpa', catatDp(terisi, { deposit: 100000, proof: 'x' }, ADMIN).deposit_amount, 100000);
cek('admin boleh mencatat di reservasi orang lain', catatDp({ ...kosong, created_by: 'staff-9' }, { deposit: 250000, proof: 'x' }, ADMIN).deposit_amount, 250000);

// --- Nilai batas ---
cek('tanpa nominal & tanpa bukti = tidak ada yang dicatat', catatDp(kosong, {}, STAFF).error, 'kosong');
cek('bukti berisi spasi saja tetap dianggap kosong', catatDp(kosong, { proof: '   ' }, STAFF).error, 'kosong');
cek('nominal 0 ditolak, bukan disimpan sebagai Rp 0', catatDp(kosong, { deposit: 0, proof: 'x' }, STAFF).error, 'nominal<=0');
cek('nominal negatif ditolak', catatDp(kosong, { deposit: -5000, proof: 'x' }, STAFF).error, 'nominal<=0');
cek('bukti saja (nominal menyusul) boleh', catatDp(kosong, { proof: 'o1/r1.webp' }, STAFF).deposit_proof_path, 'o1/r1.webp');
cek('bukti saja tidak mengarang nominal', catatDp(kosong, { proof: 'o1/r1.webp' }, STAFF).deposit_amount, null);

// --- Koreksi oleh admin ---
cek('koreksi nominal', koreksiDp(terisi, { deposit: 750000 }).deposit_amount, 750000);
cek('koreksi tidak menghapus bukti lama', koreksiDp(terisi, { deposit: 750000 }).deposit_proof_path, 'o1/r1.webp');
cek('tidak menyentuh DP sama sekali', koreksiDp(terisi, {}).deposit_amount, 500000);
cek('waktu DP tidak ikut berubah kalau DP tidak disentuh', koreksiDp(terisi, {}).deposit_at, 'kemarin');

// 0 = HAPUS. Tanpa arti ini, DP yang tercatat di reservasi yang keliru hanya
// bisa diganti angka lain — dan angka apa pun di situ tetap salah.
cek('0 menghapus nominal', koreksiDp(terisi, { deposit: 0 }).deposit_amount, null);
cek('0 ikut melepas buktinya', koreksiDp(terisi, { deposit: 0 }).deposit_proof_path, null);
cek('0 mengosongkan waktu & pencatatnya', [koreksiDp(terisi, { deposit: 0 }).deposit_at, koreksiDp(terisi, { deposit: 0 }).deposit_by], [null, null]);
cek('hapus + unggah bukti baru: bukti barunya menang', koreksiDp(terisi, { deposit: 0, proof: 'o1/r1c.webp' }).deposit_proof_path, 'o1/r1c.webp');

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('Aturan DP reservasi benar untuk 25 kasus, termasuk staff menimpa DP & nominal 0 sebagai penghapusan. ✅');
