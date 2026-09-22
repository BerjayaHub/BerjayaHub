import { toast, formDialog, confirmDialog, escapeHtml } from '../../core/ui.js';
import { formatRupiah, formatNum } from '../../core/format.js';
import { listMyOutletsAllBu } from '../../core/my-outlets.js';
import { exportTablePDF, imageToDataUrl } from '../../core/pdf.js';
import {
  ENTRY_LABEL,
  listCashCategories,
  listCashMembers,
  recordCashEntry,
  transferCash,
  getMyCashBalance,
  getCashProofUrl,
  getCashProofUrls,
  listMyCashAccounts,
  getMyCashAccountLimit,
  saveCashAccount,
  hapusKantongKas,
  listMyCashAccountBalances,
  pindahKas,
  riwayatKasSaya,
  ubahKas,
  coretKas,
  todayWIB
} from './cash.service.js';
import { keadaanKoreksi, jejakKoreksi, totalKas } from './koreksi-kas.js';
import { loadingHtml, tombolSibuk, sekaliJalan } from '../../core/loading.js';
import { notaTerkaitEntriKas } from '../inventory/nota.service.js';
import { listEsbMaster } from '../inventory/esb.service.js';
import { bukaDialogNota } from '../inventory/nota-dialog.js';
import { pecahKeterangan, petaNotaPerEntri } from './keterangan-nota.js';
import { supplierKasWajib, opsiSupplierKas, periksaSupplierKas } from './supplier-kas.js';
import { kantongWajib, opsiKantong, periksaKantong, NAMA_TANPA_KANTONG } from './kantong-wajib.js';

/**
 * Penanda "Kas Utama" di dalam <select>.
 *
 * TIDAK boleh string kosong. formDialog menganggap nilai kosong sebagai
 * "belum diisi", jadi field `required` yang defaultnya Kas Utama akan selalu
 * ditolak dengan pesan "wajib diisi" — padahal pilihannya sudah benar terpilih
 * di layar. Nilainya baru diubah jadi `null` tepat sebelum dikirim ke database.
 */
const KAS_UTAMA = '__utama__';
const idKantong = (v) => (!v || v === KAS_UTAMA ? null : v);

/**
 * Kas melekat pada USER (migration 0040): saldo & riwayatnya sama persis di
 * BU/outlet mana pun dia login.
 *
 * Sejak 0063 satu orang boleh punya beberapa KANTONG kas (mis. Kas Owner &
 * Kas Operasional) — tapi hanya kalau admin memberinya jatah lebih dari satu.
 * Yang jatahnya 1 melihat halaman yang persis sama seperti sebelumnya: tidak
 * ada pilihan kantong di mana pun. Kerumitan hanya muncul untuk yang memang
 * membutuhkannya.
 */
export async function renderCashPage(container, { userId, businessUnitId }) {
  container.innerHTML = loadingHtml('Memuat kas…');

  let categories, members, accounts, limit, outlets, daftarSupplier;
  try {
    [categories, members, accounts, limit, outlets, daftarSupplier] = await Promise.all([
      listCashCategories().catch(() => []),
      listCashMembers().catch(() => []),
      listMyCashAccounts().catch(() => []),
      getMyCashAccountLimit().catch(() => 1),
      listMyOutletsAllBu().catch(() => []),
      // Daftar supplier ESB (0144) — jadi kolom "Payment To" saat kas keluar
      // diekspor sebagai Disbursement (0149). Gagal dibacanya berarti kolomnya
      // tidak muncul dan entrinya tersimpan tanpa supplier; layar Kas tidak
      // boleh mati karena satu daftar tambahan tidak terbaca.
      listEsbMaster(businessUnitId, 'supplier').catch(() => [])
    ]);
  } catch (error) {
    container.innerHTML = `<p class="error-text">Gagal memuat: ${escapeHtml(error.message ?? error)}</p>`;
    return;
  }
  const others = members.filter((s) => s.user_id !== userId);
  // Nama pemegang untuk judul PDF. Kalau tidak ketemu (mis. RPC gagal), PDF
  // tetap dibuat tanpa nama — kehilangan satu baris judul jauh lebih ringan
  // daripada tombol export yang mati.
  const namaSaya = members.find((s) => s.user_id === userId)?.full_name ?? 'Kas saya';
  // DUA PERTANYAAN YANG BERBEDA, dan dulu dijawab satu variabel.
  //
  //   `bolehTambahKantong` — jatahnya. Mengatur apakah ia boleh MEMBUAT
  //                          kantong baru; itu memang urusan admin.
  //   `punyaKantong`       — apakah ia PUNYA kantong. Inilah yang menentukan
  //                          kantongnya ditanyakan, terlihat di riwayat, dan
  //                          bisa dipindahkan.
  //
  // Menyatukan keduanya sebagai `limit > 1` membuat pemegang berjatah 1 yang
  // sudah punya satu kantong tidak pernah ditanya kantongnya, tidak melihat
  // kolom Kantong di riwayatnya, dan tidak punya tombol ⇄ Pindah Kas — jadi
  // uang yang terlanjur di Kas Utama terkunci di sana.
  const bolehTambahKantong = limit > 1;
  const punyaKantong = accounts.length > 0;

  // Bentuk opsinya sama persis dengan kolom Supplier di nota: kode ESB-nya
  // ditampilkan sebagai keterangan, bukan ditempel ke namanya — keterangan
  // yang ikut jadi bagian nilai adalah bug yang sudah pernah terjadi di sini.
  // Aturannya tinggal di `supplier-kas.js` supaya form tambah, form ubah, dan
  // dialog admin tidak bisa menyimpang satu sama lain.
  const opsiSupplier = opsiSupplierKas(daftarSupplier);

  // KEPALA HALAMAN DIBEKUKAN, RIWAYATNYA YANG MENGGULIR.
  //
  // Saldo dan tombol Kas Masuk/Keluar/Transfer adalah satu-satunya bagian yang
  // dipakai berulang kali; riwayatnya panjang. Tanpa pembekuan, mencatat
  // pengeluaran sesudah memeriksa riwayat berarti menggulir balik ke atas tiap
  // kali — dan saldo yang tidak terlihat saat menekan "Kas Keluar" adalah
  // justru angka yang sedang dipertimbangkan orangnya.
  container.innerHTML = `
    <div class="kas-header">
    <h1>Kas</h1>
    <div class="inline-card" style="max-width:460px">
      <h3 style="margin-top:0;font-size:0.95rem">Saldo Kas Saya</h3>
      <p id="cash-balance" style="font-size:1.6rem;font-weight:700;margin:4px 0">—</p>
      <p style="font-size:0.76rem;color:var(--color-text-muted);margin:0">Saldo ini milikmu pribadi — tidak berubah saat kamu pindah BU atau outlet.</p>
      <div id="cash-accounts" style="margin-top:10px"></div>
      <div id="cash-kelola" hidden style="margin-top:10px"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="primary" id="cash-in" style="max-width:130px">+ Kas Masuk</button>
        <button id="cash-out">− Kas Keluar</button>
        ${punyaKantong ? '<button id="cash-move">⇄ Pindah Kas</button>' : ''}
        <button id="cash-transfer">Transfer</button>
        ${bolehTambahKantong ? '<button id="cash-manage">🏷️ Kelola Kas</button>' : ''}
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:20px">
      <h2 style="font-size:1rem;margin:0">Riwayat Kas</h2>
      <button id="cash-pdf" style="max-width:150px">⇩ Export PDF</button>
    </div>
    </div>
    <div id="cash-history"></div>
  `;

  const catOptions = (dir) => [
    { value: '', label: '-- tanpa kategori --' },
    ...categories.filter((c) => c.direction === 'both' || c.direction === dir).map((c) => ({ value: c.id, label: c.name }))
  ];

  // Entri yang sedang tampil, dipakai tombol Export PDF. Mengambil ulang dari
  // server saat export berisiko menghasilkan PDF yang ISINYA BERBEDA dari yang
  // dilihat orangnya — dan perbedaan itu tidak akan pernah dia sadari.
  let entriTampil = [];
  // Saldo per kantong hasil refresh terakhir — termasuk baris "Kas Utama"
  // (account_id NULL) kalau memang ada uang di sana.
  let saldoKantong = [];

  /**
   * Keterangan dengan nomor notanya jadi tombol.
   *
   * Potongannya disusun modul murni `pecahKeterangan`; di sini tinggal
   * meng-escape dan membungkusnya. Meng-escape di SINI, sesudah pemecahan,
   * bukan sebelumnya: kalau teksnya di-escape lebih dulu, kode nota yang
   * memuat `&` atau `<` tidak akan pernah cocok dengan kode aslinya.
   */
  function ketHtml(ket, notas) {
    const { bagian, tambahan } = pecahKeterangan(ket, notas ?? []);
    const tombol = (t) => `<button type="button" class="btn-nota" data-id="${escapeHtml(t.notaId)}">${escapeHtml(t.teks)}</button>`;
    const utama = bagian.map((b) => (b.notaId ? tombol(b) : escapeHtml(b.teks))).join('');
    // Nota yang kodenya tidak tertulis di keterangan tetap ditawarkan, supaya
    // tidak ada nota yang mustahil dibuka hanya karena kalimatnya tidak
    // menyebutnya.
    const ekor = tambahan.length
      ? `<div class="kas-nota-ekor">Nota: ${tambahan.map(tombol).join(' ')}</div>`
      : '';
    return (utama || escapeHtml(ket ?? '-')) + ekor;
  }

  /**
   * Tombol Ubah & Hapus untuk satu baris.
   *
   * TOMBOL YANG TIDAK BOLEH DITEKAN TETAP DIGAMBAR, mati, dengan sebabnya di
   * `title`. Menyembunyikannya berarti orang mencari tombol yang ada di baris
   * sebelahnya, tidak menemukannya, dan menyimpulkan aplikasinya rusak —
   * sedangkan sebab sebenarnya (entri ini pembayaran nota, perbaikannya di
   * modul Bahan) adalah keterangan yang justru perlu dia baca.
   */
  function tombolKoreksi(e, k) {
    if (k.dicoret) return '<span style="color:var(--color-text-muted)">—</span>';
    if (!k.bolehKoreksi) {
      const sebab = escapeHtml(k.alasanTolak);
      return `<button class="btn-kas-info" disabled title="${sebab}" aria-label="${sebab}">🔒</button>`;
    }
    const id = escapeHtml(e.id);
    return `<button class="btn-kas-ubah" data-id="${id}" title="Ubah entri ini">✎</button>
            <button class="btn-kas-hapus btn-danger" data-id="${id}" title="Hapus entri ini">🗑</button>`;
  }

  async function bukaUbahKas(e) {
    if (!e) return;
    const keluar = e.entry_type === 'out';
    const values = await formDialog({
      title: 'Ubah Entri Kas',
      description:
        'Pemegang, kantong, jenis, dan foto notanya tidak bisa diubah dari sini — memindahkan uang ke kas lain ' +
        'bukan koreksi, itu transfer. Perubahan ini tercatat atas namamu.',
      fields: [
        { name: 'amount', label: 'Jumlah uang (Rp)', type: 'money', required: true, value: Math.abs(Number(e.amount) || 0) },
        { name: 'notes', label: 'Keterangan', type: 'text', required: true, value: e.notes ?? '' },
        ...(keluar
          ? [
              {
                name: 'outlet_id',
                label: 'Untuk outlet',
                type: 'select',
                required: true,
                value: e.outlet_id ?? '',
                options: outlets.map((o) => ({
                  value: o.id,
                  label: o.business_unit_name ? `${o.business_unit_name} — ${o.name}` : o.name
                }))
              },
              { name: 'category_id', label: 'Kategori biaya', type: 'select', value: e.category_id ?? '', options: catOptions('out') },
              // PINTU KEDUA. Kolom yang cuma ada di form tambah adalah kolom
              // yang tidak pernah bisa dibetulkan — dan pola itu sudah
              // menggigit sekali di proyek ini, pada kolom Supplier nota.
              ...(supplierKasWajib(daftarSupplier)
                ? [
                    {
                      name: 'supplier',
                      label: 'Dibayar ke (supplier)',
                      type: 'searchselect',
                      required: true,
                      value: e.supplier ?? '',
                      // Nilai lama yang di luar daftar ikut ditawarkan — tanpa
                      // itu, membetulkan satu huruf di keterangan MENGHAPUS
                      // nama yang sudah tersimpan.
                      options: opsiSupplierKas(daftarSupplier, e.supplier ?? '')
                    }
                  ]
                : []),
              { name: 'qty', label: 'Jumlah barang', type: 'qty', value: e.qty ?? '' },
              { name: 'unit', label: 'Satuan', type: 'text', value: e.unit ?? '' }
            ]
          : []),
        { name: 'date', label: 'Tanggal', type: 'date', value: e.entry_date ?? todayWIB() }
      ],
      submitText: 'Simpan perubahan'
    });
    if (!values) return;
    if (!(values.amount > 0)) return toast('Jumlah uang harus lebih dari 0.', 'warning');
    if (keluar) {
      const salahSupplier = periksaSupplierKas(values.supplier ?? e.supplier ?? '', daftarSupplier, { nilaiLama: e.supplier ?? '' });
      if (salahSupplier) return toast(salahSupplier, 'warning');
    }
    try {
      await ubahKas({
        id: e.id,
        amount: values.amount,
        categoryId: values.category_id,
        outletId: values.outlet_id,
        notes: values.notes,
        qty: values.qty,
        unit: values.unit,
        date: values.date,
        supplier: values.supplier
      });
      toast('Entri kas diperbarui.', 'success');
      await refresh();
    } catch (error) {
      toast(error.message ?? 'Gagal menyimpan.', 'error');
    }
  }

  async function bukaHapusKas(e) {
    if (!e) return;
    const values = await formDialog({
      title: 'Hapus Entri Kas?',
      description:
        `${escapeHtml(e.notes ?? '-')} · ${formatRupiah(Math.abs(Number(e.amount) || 0))}. ` +
        'Barisnya TIDAK dibuang — ia tetap terlihat di riwayat, ditandai dihapus beserta namamu dan alasannya, ' +
        'dan berhenti menghitung saldo. Itulah yang membuat koreksinya bisa ditelusuri.',
      fields: [
        { name: 'alasan', label: 'Alasan penghapusan', type: 'text', required: true, placeholder: 'mis. salah input, dobel' }
      ],
      submitText: 'Hapus'
    });
    if (!values) return;
    try {
      await coretKas(e.id, values.alasan);
      toast('Entri kas dihapus. Jejaknya tetap tersimpan.', 'success');
      await refresh();
    } catch (error) {
      toast(error.message ?? 'Gagal menghapus.', 'error');
    }
  }

  /**
   * Tinggi wadah riwayat = sisa layar di bawah kepala yang dibekukan.
   *
   * Diukur, bukan dipatok `60vh`: tinggi kepalanya berubah-ubah — kartu
   * kantong muncul kalau jatahnya lebih dari satu, panel Kelola Kas bisa
   * dibuka. Angka tetap akan meninggalkan ruang kosong di satu keadaan dan
   * memaksa halaman ikut menggulir di keadaan lain.
   *
   * Di mode kartu (<=560px) TIDAK dipakai: barisnya sudah jadi kartu, wadahnya
   * sengaja `overflow-x: visible` di CSS, dan menyetel tinggi di situ akan
   * memaksa `overflow-x` ikut jadi `auto` — persis bug "tombol melebarkan
   * halaman" yang sudah pernah diperbaiki.
   */
  function ukurRiwayat() {
    // Halamannya bisa sudah diganti modul lain sementara pendengar `resize`
    // masih terpasang. Tanpa pelepasan ini, tiap kali orang berpindah modul
    // satu pendengar tertinggal — dan yang terkumpul mengukur simpul yang
    // sudah tidak ada di layar.
    if (!container.isConnected) {
      window.removeEventListener('resize', ukurRiwayat);
      return;
    }
    const kotak = container.querySelector('.kas-riwayat');
    if (!kotak) return;
    if (window.innerWidth <= 560) {
      kotak.style.maxHeight = '';
      return;
    }
    const atas = kotak.getBoundingClientRect().top;
    // Minimal 220px: di layar yang sangat pendek, wadah setinggi 40px lebih
    // buruk daripada halaman yang ikut menggulir sedikit.
    kotak.style.maxHeight = `${Math.max(220, window.innerHeight - atas - 16)}px`;
  }
  window.addEventListener('resize', ukurRiwayat);

  async function refresh() {
    try {
      const [balance, entries, saldoAkun] = await Promise.all([
        getMyCashBalance(),
        // `riwayatKasSaya`, BUKAN `listMyCashEntries`: kolom Outlet kosong untuk
        // entri yang dicatat orang lain ke kantongku, karena embed PostgREST
        // tunduk pada `outlets_select`. Alasan panjangnya di cash.service.js.
        riwayatKasSaya(),
        punyaKantong ? listMyCashAccountBalances().catch(() => []) : Promise.resolve([])
      ]);
      entriTampil = entries;
      saldoKantong = saldoAkun;
      container.querySelector('#cash-balance').textContent = formatRupiah(balance);

      // Nota yang terkait entri-entri ini, supaya nomornya bisa diketuk.
      //
      // Gagal mengambilnya TIDAK boleh mematikan riwayatnya: `notaTerkaitEntriKas`
      // sudah mengembalikan daftar kosong alih-alih melempar, dan `.catch` di
      // sini menjaga kegagalan jaringan. Yang hilang cuma tautannya — angkanya
      // tetap benar, dan riwayat kas yang kosong karena satu query tambahan
      // gagal jauh lebih buruk daripada nomor yang tidak bisa diketuk.
      const notas = await notaTerkaitEntriKas(
        entries.map((e) => e.id),
        entries.map((e) => e.penyesuaian_nota)
      ).catch(() => []);
      const notaPerEntri = petaNotaPerEntri(entries, notas);

      // Panel kelola ikut digambar ulang kalau sedang terbuka, supaya saldonya
      // tidak tertinggal setelah ada transaksi baru.
      if (!container.querySelector('#cash-kelola').hidden) gambarKelola();

      // Rincian kantong hanya ditampilkan kalau memang punya lebih dari satu.
      container.querySelector('#cash-accounts').innerHTML = saldoAkun.length
        ? `<div style="display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--color-border,#eee);padding-top:8px">
             ${saldoAkun
               .map(
                 (a) => `<div style="display:flex;justify-content:space-between;font-size:0.84rem">
                   <span>${escapeHtml(a.account_name)}</span>
                   <strong>${formatRupiah(Number(a.balance) || 0)}</strong>
                 </div>`
               )
               .join('')}
           </div>`
        : '';

      const box = container.querySelector('#cash-history');
      box.innerHTML = entries.length
        ? `<div class="table-scroll kas-riwayat">
            <table class="data-table table-freeze-1 kartu-sempit">
            <thead><tr><th>Keterangan</th><th>Tanggal</th><th>Jenis</th>${punyaKantong ? '<th>Kantong</th>' : ''}<th>Outlet</th><th>Jumlah</th><th>Bukti</th><th>Aksi</th></tr></thead>
            <tbody>
              ${entries
                .map((e) => {
                  const amt = Number(e.amount);
                  const k = keadaanKoreksi(e);
                  const color = k.dicoret ? 'var(--color-text-muted)' : amt >= 0 ? 'var(--color-primary)' : 'var(--color-danger)';
                  const ket =
                    e.notes ||
                    e.category_name ||
                    (e.counterpart_name ? `${amt >= 0 ? 'dari' : 'ke'} ${e.counterpart_name}` : '-');
                  return `<tr${k.dicoret ? ' class="kas-dicoret"' : ''}>
                    <td data-label="Keterangan"><strong>${ketHtml(ket, notaPerEntri.get(e.id))}</strong>
                      ${e.category_name ? `<div style="font-size:0.74rem;color:var(--color-text-muted)">${escapeHtml(e.category_name)}</div>` : ''}
                      ${e.qty ? `<div style="font-size:0.74rem;color:var(--color-text-muted)">${formatNum(e.qty)} ${escapeHtml(e.unit ?? '')}</div>` : ''}
                      ${k.jejak ? `<div class="kas-jejak">${escapeHtml(k.jejak)}</div>` : ''}</td>
                    <td style="font-size:0.82rem" data-label="Tanggal">${fmtDate(e.entry_date)}</td>
                    <td style="font-size:0.82rem" data-label="Jenis">${escapeHtml(ENTRY_LABEL[e.entry_type] ?? e.entry_type)}</td>
                    ${punyaKantong ? `<td style="font-size:0.82rem" data-label="Kantong">${escapeHtml(e.account_name ?? NAMA_TANPA_KANTONG)}</td>` : ''}
                    <td style="font-size:0.82rem" data-label="Outlet">${escapeHtml(e.outlet_name ?? '-')}</td>
                    <td style="color:${color};font-weight:600;white-space:nowrap" data-label="Jumlah">${amt >= 0 ? '+' : '−'}${formatRupiah(Math.abs(amt))}</td>
                    <td data-label="Bukti">${e.proof_path ? `<button class="btn-proof" data-path="${escapeHtml(e.proof_path)}">Bukti</button>` : '<span style="color:var(--color-text-muted)">—</span>'}</td>
                    <td data-label="Aksi">${tombolKoreksi(e, k)}</td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table></div>`
        : '<p style="color:var(--color-text-muted)">Belum ada transaksi kas.</p>';

      box.querySelectorAll('.btn-proof').forEach((btn) =>
        btn.addEventListener('click', async () => {
          try {
            const url = await getCashProofUrl(btn.dataset.path);
            if (url) window.open(url, '_blank');
          } catch (error) {
            toast(error.message ?? 'Gagal membuka bukti.', 'error');
          }
        })
      );

      // Nomor notanya dibuka dari peta yang SUDAH ada di tangan, bukan diambil
      // ulang saat diketuk: dialognya harus muncul seketika, dan nota yang
      // isinya menyusul sudah ditangani `bukaDialogNota` sendiri.
      const semuaNota = new Map(notas.map((n) => [n.id, n]));
      box.querySelectorAll('.btn-nota').forEach((btn) =>
        btn.addEventListener('click', () => bukaDialogNota(semuaNota.get(btn.dataset.id)))
      );

      const perId = new Map(entries.map((e) => [e.id, e]));
      box.querySelectorAll('.btn-kas-ubah').forEach((btn) =>
        btn.addEventListener('click', () => bukaUbahKas(perId.get(btn.dataset.id)))
      );
      box.querySelectorAll('.btn-kas-hapus').forEach((btn) =>
        btn.addEventListener('click', () => bukaHapusKas(perId.get(btn.dataset.id)))
      );

      ukurRiwayat();
    } catch (error) {
      container.querySelector('#cash-history').innerHTML = `<p class="error-text">${escapeHtml(error.message ?? error)}</p>`;
    }
  }

  /**
   * Export riwayat kas ke PDF **portrait**, lengkap dengan foto notanya.
   *
   * Portrait, bukan landscape seperti laporan admin: ini daftar pribadi yang
   * biasanya dicetak atau dikirim apa adanya, dan kolomnya sedikit.
   *
   * Fotonya WAJIB diperkecil dulu. jsPDF menyimpan gambar apa adanya, jadi 30
   * nota dari kamera HP (2-4 MB masing-masing) menghasilkan PDF ratusan MB yang
   * tidak bisa dibuka di HP — dan gejalanya bukan error, melainkan browser yang
   * menggantung. Di PDF notanya hanya dicetak ~54x40 pt, jadi 220 px sudah lebih
   * dari cukup.
   *
   * jsPDF juga memuat gambar secara SINKRON: memberi URL jaringan menghasilkan
   * halaman kosong tanpa error sama sekali. Karena itu semuanya diubah ke data
   * URL lebih dulu, dan yang gagal cukup jadi "-".
   */
  async function exportPdf() {
    if (!entriTampil.length) return toast('Belum ada transaksi untuk diexport.', 'warning');

    // Tombolnya dikunci selama proses. Mengompres puluhan foto butuh beberapa
    // detik tanpa tanda apa pun di layar — dan tombol yang tampak biasa saja
    // akan ditekan lagi, menghasilkan dua proses berat sekaligus.
    const pulihkan = tombolSibuk(container.querySelector('#cash-pdf'), 'Menyiapkan…');

    try {
      const urlNota = await getCashProofUrls(entriTampil.map((e) => e.proof_path));
      const foto = new Map();
      // Diproses berurutan, bukan Promise.all: mengompres 50 foto sekaligus
      // membuat tab-nya membeku di HP kelas menengah.
      for (const e of entriTampil) {
        if (!e.proof_path) continue;
        const url = urlNota.get(e.proof_path);
        if (!url) continue;
        const dataUrl = await imageToDataUrl(url, 220, 0.6);
        if (dataUrl) foto.set(e.id, dataUrl);
      }

      const rows = entriTampil.map((e) => {
        const amt = Number(e.amount) || 0;
        const ket =
          e.notes || e.category_name || (e.counterpart_name ? `${amt >= 0 ? 'dari' : 'ke'} ${e.counterpart_name}` : '-');
        const jumlah = e.qty ? `${formatNum(e.qty)} ${e.unit ?? ''}`.trim() : '-';
        const gbr = foto.get(e.id);
        // Entri yang DICORET ikut tercetak, ditandai. PDF yang diam-diam
        // kehilangan satu baris tidak bisa dibedakan dari PDF yang lengkap —
        // dan yang hilang justru koreksinya.
        const jejak = jejakKoreksi(e);
        return [
          fmtDate(e.entry_date),
          jejak ? `${ket}\n[${jejak}]` : ket,
          ENTRY_LABEL[e.entry_type] ?? e.entry_type,
          ...(punyaKantong ? [e.account_name ?? NAMA_TANPA_KANTONG] : []),
          e.outlet_name ?? '-',
          jumlah,
          // Tanda − (minus panjang) diganti tanda hubung biasa: helvetica bawaan
          // jsPDF tidak punya glyph-nya dan mencetaknya sebagai kotak.
          `${amt >= 0 ? '+' : '-'}${formatRupiah(Math.abs(amt))}`,
          gbr ? { image: gbr, w: 46, h: 34 } : '-'
        ];
      });

      // Totalnya mengabaikan yang dicoret, sama seperti saldo di kartu atasnya.
      // Dua angka berbeda untuk hal yang sama di satu halaman selalu terbaca
      // sebagai salah satunya rusak.
      const { masuk, keluar, dicoret } = totalKas(entriTampil);

      await exportTablePDF({
        orientation: 'portrait',
        title: 'Riwayat Kas',
        subtitle:
          `${namaSaya} · ${entriTampil.length} transaksi · Masuk ${formatRupiah(masuk)} · Keluar ${formatRupiah(keluar)}` +
          (dicoret ? ` · ${dicoret} dihapus (tidak dihitung)` : ''),
        columns: [
          { header: 'Tanggal', width: 0.9 },
          { header: 'Keterangan', width: 2 },
          { header: 'Jenis', width: 0.9 },
          ...(punyaKantong ? [{ header: 'Kantong', width: 1 }] : []),
          { header: 'Outlet', width: 1.1 },
          { header: 'Jumlah', width: 0.8 },
          { header: 'Nominal', width: 1.2, align: 'right' },
          { header: 'Nota', width: 1 }
        ],
        rows,
        filename: 'riwayat-kas'
      });
      toast('PDF riwayat kas terunduh.', 'success');
    } catch (error) {
      toast(error.message ?? 'Gagal membuat PDF.', 'error');
    } finally {
      pulihkan();
    }
  }

  // ---- Kas MASUK: ringkas. Uang datang, belum tentu ada notanya. ----
  async function openMasuk() {
    const values = await formDialog({
      title: 'Catat Kas Masuk',
      fields: [
        { name: 'amount', label: 'Jumlah uang (Rp)', type: 'money', required: true },
        { name: 'notes', label: 'Keterangan', type: 'text', required: true, placeholder: 'mis. setoran dari owner' },
        { name: 'date', label: 'Tanggal', type: 'date', value: todayWIB() },
        // DITANYAKAN BEGITU IA PUNYA KANTONG — bukan `pakaiKantong` (jatah > 1).
        //
        // Kas MASUK ikut ditanya, dan itu bukan tambahan yang bisa dilewat:
        // kalau hanya kas keluar yang diwajibkan, uang masuk terus menumpuk di
        // Kas Utama sementara belanjanya membebani kantong — kantongnya makin
        // negatif tiap bulan, dan saldo kantong negatif adalah keadaan yang
        // mustahil di dunia nyata. Itu persis angka yang terlihat di layar
        // Kantong Kas sebelum ini diperbaiki.
        ...(kantongWajib(accounts)
          ? [
              {
                name: 'account_id',
                label: 'Masuk ke kantong',
                type: 'select',
                required: true,
                options: opsiKantong(accounts),
                help: 'Kalau uangnya perlu dibagi ke beberapa kantong, catat satu per satu — atau pakai ⇄ Pindah Kas setelahnya.'
              }
            ]
          : []),
        {
          name: 'file',
          label: 'Foto transaksi (opsional)',
          type: 'photo',
          facing: 'environment',
          help: 'Boleh dikosongkan — uang masuk tidak selalu punya nota.'
        }
      ],
      submitText: 'Simpan'
    });
    if (!values) return;
    if (!(values.amount > 0)) return toast('Jumlah uang harus lebih dari 0.', 'warning');
    const salahKantongMasuk = periksaKantong(values.account_id, accounts, 'in');
    if (salahKantongMasuk) return toast(salahKantongMasuk, 'warning');
    try {
      await recordCashEntry({
        type: 'in',
        amount: values.amount,
        accountId: values.account_id,
        notes: values.notes,
        date: values.date,
        file: values.file
      });
      toast('Kas masuk tercatat.', 'success');
      await refresh();
    } catch (error) {
      toast(error.message ?? 'Gagal menyimpan.', 'error');
    }
  }

  // ---- Kas KELUAR: lengkap. Ada barangnya, ada notanya, ada peruntukannya. ----
  async function openKeluar() {
    if (!outlets.length) {
      return toast('Belum ada outlet yang bisa kamu akses di BU mana pun — kas keluar butuh outlet peruntukan.', 'warning');
    }
    const values = await formDialog({
      title: 'Catat Kas Keluar',
      fields: [
        { name: 'amount', label: 'Jumlah uang (Rp)', type: 'money', required: true },
        { name: 'notes', label: 'Keterangan', type: 'text', required: true, placeholder: 'mis. Bensin' },
        {
          name: 'outlet_id',
          label: 'Untuk outlet',
          type: 'select',
          required: true,
          // Nama BU ikut ditulis di label karena daftarnya LINTAS BU: dua outlet
          // bernama mirip di BU berbeda tidak bisa dibedakan tanpa itu.
          options: outlets.map((o) => ({
            value: o.id,
            label: o.business_unit_name ? `${o.business_unit_name} — ${o.name}` : o.name
          })),
          help: 'Uang ini dibelanjakan untuk outlet mana. Boleh lintas BU — pilihannya semua outlet tempat kamu punya peran, di BU mana pun.'
        },
        { name: 'category_id', label: 'Kategori biaya', type: 'select', options: catOptions('out') },
        // PAYMENT TO untuk berkas ESB Disbursement (0149), WAJIB sejak 0151.
        //
        // Daftarnya daftar yang SAMA dengan kolom Supplier di nota — bukan
        // daftar kedua yang cepat atau lambat menyimpang.
        //
        // `allowCreate` DICABUT. Versi pertama membiarkannya hidup supaya
        // pengeluaran mendadak jam 9 malam tidak gagal dicatat, dan
        // menyerahkan penyaringannya ke ekspor. Yang terjadi: nama bebas
        // tersimpan, entrinya tertahan berminggu-minggu kemudian, dan yang
        // membetulkannya bukan orang yang mengetiknya — ia sudah tidak ingat
        // nota mana itu. Memberi tahu sekarang, saat orangnya masih memegang
        // notanya, jauh lebih murah.
        ...(supplierKasWajib(daftarSupplier)
          ? [
              {
                name: 'supplier',
                label: 'Dibayar ke (supplier)',
                type: 'searchselect',
                required: true,
                options: opsiSupplier,
                help: 'Jadi kolom "Payment To" saat diekspor ke ESB. Hanya nama yang terdaftar di ESB — yang diketik sendiri ditolak saat diimpor.'
              }
            ]
          : []),
        { name: 'qty', label: 'Jumlah barang', type: 'qty', placeholder: 'mis. 10' },
        { name: 'unit', label: 'Satuan', type: 'text', placeholder: 'mis. liter / pcs / kg' },
        { name: 'date', label: 'Tanggal', type: 'date', value: todayWIB() },
        // DITANYAKAN BEGITU IA PUNYA KANTONG. Gerbang lamanya `jatah > 1`
        // menjawab pertanyaan yang salah — jatah mengatur berapa banyak kantong
        // boleh dipunyai, bukan apakah perlu ditanya. Pemegang berjatah 1
        // dengan satu kantong tidak pernah ditanya, dan seluruh kas keluarnya
        // mendarat di Kas Utama: tercatat penuh, tapi tanpa kantong, jadi
        // tertahan saat diekspor ke ESB (0151).
        ...(kantongWajib(accounts)
          ? [
              {
                name: 'account_id',
                label: 'Diambil dari kantong',
                type: 'select',
                required: true,
                options: opsiKantong(accounts),
                help: 'Uangnya keluar dari kantong mana. Ini yang jadi nomor akun kas saat diekspor ke ESB.'
              }
            ]
          : []),
        {
          name: 'file',
          label: 'Foto nota (wajib)',
          type: 'photo',
          facing: 'environment',
          required: true,
          help: 'Setiap pengeluaran harus punya bukti.'
        }
      ],
      submitText: 'Simpan'
    });
    if (!values) return;
    if (!(values.amount > 0)) return toast('Jumlah uang harus lebih dari 0.', 'warning');
    if (!values.file) return toast('Foto nota wajib dilampirkan.', 'warning');
    // Tanpa `nilaiLama`: entri BARU tidak punya nilai warisan untuk dimaafkan.
    const salahSupplier = periksaSupplierKas(values.supplier, daftarSupplier);
    if (salahSupplier) return toast(salahSupplier, 'warning');
    const salahKantong = periksaKantong(values.account_id, accounts, 'out');
    if (salahKantong) return toast(salahKantong, 'warning');
    try {
      await recordCashEntry({
        type: 'out',
        amount: values.amount,
        categoryId: values.category_id,
        outletId: values.outlet_id,
        accountId: values.account_id,
        notes: values.notes,
        qty: values.qty,
        unit: values.unit,
        date: values.date,
        supplier: values.supplier,
        file: values.file
      });
      toast('Kas keluar tercatat.', 'success');
      await refresh();
    } catch (error) {
      toast(error.message ?? 'Gagal menyimpan.', 'error');
    }
  }

  // ---- Pindah antar kantong sendiri ----
  /**
   * Pilihan kantong untuk dialog pindah.
   *
   * "Kas Utama" (account_id NULL) IKUT DITAWARKAN. Uang yang masuk sebelum
   * kantong pertama dibuat tersimpan di sana, dan versi sebelumnya hanya
   * menawarkan kantong bernama — akibatnya saldo itu terkunci: kelihatan di
   * rincian saldo, tapi tidak ada satu pun jalan untuk memindahkannya.
   *
   * `pindah_kas()` di database memang sudah menerima NULL sejak 0063; yang
   * kurang cuma pilihannya di layar.
   */
  function opsiKantong() {
    const opsi = [];
    const utama = saldoKantong.find((a) => !a.account_id);
    // Kas Utama hanya relevan kalau memang pernah ada isinya. Menawarkan laci
    // yang tidak pernah dipakai hanya menambah pilihan yang membingungkan.
    if (utama) opsi.push({ value: KAS_UTAMA, label: `Kas Utama (${formatRupiah(Number(utama.balance) || 0)})` });
    for (const a of accounts) {
      const saldo = saldoKantong.find((x) => x.account_id === a.id)?.balance ?? 0;
      opsi.push({ value: a.id, label: `${a.name} (${formatRupiah(Number(saldo) || 0)})` });
    }
    return opsi;
  }

  async function openPindah() {
    const opsi = opsiKantong();
    if (opsi.length < 2) return toast('Butuh minimal dua kantong (termasuk Kas Utama) untuk memindahkan saldo.', 'warning');
    const values = await formDialog({
      title: 'Pindah Antar Kantong Kas',
      description:
        'Total saldomu tidak berubah — uangnya hanya berpindah kantong. ' +
        '"Kas Utama" adalah tempat uang yang dicatat sebelum kantong dibuat.',
      fields: [
        { name: 'from', label: 'Dari kantong', type: 'select', required: true, options: opsi },
        { name: 'to', label: 'Ke kantong', type: 'select', required: true, options: opsi, value: opsi[1]?.value ?? KAS_UTAMA },
        { name: 'amount', label: 'Jumlah', type: 'money', required: true },
        { name: 'notes', label: 'Keterangan (opsional)', type: 'text', placeholder: 'mis. pembagian setoran' }
      ],
      submitText: 'Pindahkan'
    });
    if (!values) return;
    // Dibandingkan sebagai string dulu: <select> hanya menyimpan string, dan
    // Kas Utama diwakili penanda KAS_UTAMA — bukan null, bukan string kosong.
    if (String(values.from) === String(values.to)) return toast('Kantong asal dan tujuan tidak boleh sama.', 'warning');
    if (!(values.amount > 0)) return toast('Jumlah harus lebih dari 0.', 'warning');
    try {
      await pindahKas({
        fromAccountId: idKantong(values.from),
        toAccountId: idKantong(values.to),
        amount: values.amount,
        notes: values.notes
      });
      toast('Saldo dipindahkan.', 'success');
      await refresh();
    } catch (error) {
      toast(error.message ?? 'Gagal memindahkan.', 'error');
    }
  }

  // ---- Kelola kantong kas ----
  //
  // Ditampilkan sebagai PANEL di halaman, bukan dialog berisi dropdown "Mau
  // apa?". Versi dropdown menyembunyikan Ubah Nama dan Hapus di dalam daftar
  // pilihan — secara teknis ada, tapi tidak ada yang menemukannya. Tombol yang
  // tidak ditemukan sama saja dengan tombol yang tidak dibuat.

  function openKelola() {
    const panel = container.querySelector('#cash-kelola');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) gambarKelola();
    // Kepalanya berubah tinggi -> sisa layar untuk riwayat ikut berubah.
    ukurRiwayat();
  }

  function gambarKelola() {
    const panel = container.querySelector('#cash-kelola');
    const sisa = limit - accounts.length;
    panel.innerHTML = `
      <div style="border-top:1px solid var(--color-border,#eee);padding-top:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <strong style="font-size:0.88rem">🏷️ Kantong Kas</strong>
          <span style="font-size:0.76rem;color:var(--color-text-muted)">${accounts.length} dari ${limit} jatah</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
          ${
            accounts
              .map((a) => {
                const saldo = saldoKantong.find((x) => x.account_id === a.id)?.balance ?? 0;
                return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                  <span style="flex:1;min-width:120px;font-size:0.86rem">${escapeHtml(a.name)}
                    <span style="color:var(--color-text-muted)">· ${formatRupiah(Number(saldo) || 0)}</span>
                    ${
                      // KANTONG YANG TERBUKA HARUS TERLIHAT TERBUKA.
                      //
                      // Pemegang kas menanggung selisihnya, jadi ia berhak tahu
                      // sekilas kantong mana yang bisa dibebani orang lain —
                      // tanpa membuka dialog satu per satu. Kantong pribadi
                      // TIDAK diberi penanda apa pun: menandai keadaan yang
                      // berlaku untuk hampir semua baris cuma menambah bacaan.
                      a.outlet_id
                        ? `<span class="kk-terbuka" title="Staff outlet ini juga bisa mencatat pengeluaran dari kantong ini">🏪 ${escapeHtml(
                            a.outlets?.name ?? 'outlet'
                          )}</span>`
                        : ''
                    }</span>
                  <button class="kk-edit" data-id="${escapeHtml(a.id)}" title="Ubah nama & outlet kantong">✎</button>
                  <button class="kk-del" data-id="${escapeHtml(a.id)}" title="Hapus kantong">🗑</button>
                </div>`;
              })
              .join('') || '<p style="font-size:0.82rem;color:var(--color-text-muted);margin:0">Belum ada kantong. Semua uangmu ada di Kas Utama.</p>'
          }
        </div>
        <button class="primary kk-add" style="max-width:190px;margin-top:10px"${sisa > 0 ? '' : ' disabled'}>+ Tambah kantong</button>
        ${
          sisa > 0
            ? ''
            : '<p style="font-size:0.76rem;color:var(--color-text-muted);margin:6px 0 0">Jatah kantongmu sudah penuh. Admin bisa menambahnya lewat Master User.</p>'
        }
        <p style="font-size:0.76rem;color:var(--color-text-muted);margin:8px 0 0">
          Mengubah nama kantong ikut mengubah <strong>seluruh laporan</strong>, termasuk periode yang sudah lewat —
          namanya dibaca langsung dari sini, tidak disalin ke tiap transaksi.
          Menghapus kantong <strong>tidak menghilangkan uangnya</strong>: isinya dipindahkan ke kantong yang kamu pilih.
        </p>
      </div>
    `;

    panel.querySelector('.kk-add')?.addEventListener('click', tambahKantong);
    panel.querySelectorAll('.kk-edit').forEach((b) =>
      b.addEventListener('click', () => ubahNamaKantong(accounts.find((a) => a.id === b.dataset.id)))
    );
    panel.querySelectorAll('.kk-del').forEach((b) =>
      b.addEventListener('click', () => hapusKantong(accounts.find((a) => a.id === b.dataset.id)))
    );
  }

  async function muatUlangKantong() {
    accounts = await listMyCashAccounts().catch(() => accounts);
    await refresh();
  }


  /**
   * Pilihan outlet untuk kantong kas.
   *
   * Kosong = kantong pribadi, hanya pemegangnya yang bisa membebani. Itu
   * perilaku lama dan tetap jadi bawaannya — memilih outlet adalah keputusan
   * sadar untuk MEMBUKA kantong ini kepada staff outlet tersebut.
   */
  const opsiOutletKantong = () => [
    { value: '', label: 'Pribadi — hanya saya' },
    ...outlets.map((o) => ({ value: o.id, label: `Kas outlet ${o.name}` }))
  ];

  const KET_OUTLET_KANTONG =
    'Kalau kantong ini diberi outlet, SIAPA PUN yang bertugas di outlet itu bisa mencatat pengeluaran dari kantongmu — ' +
    'mis. staff yang menginput nota dari supplier. Uangnya tetap kasmu, saldonya tetap tanggung jawabmu, ' +
    'dan setiap entri mencatat siapa yang membuatnya.';

  async function tambahKantong() {
    const values = await formDialog({
      title: 'Tambah Kantong Kas',
      description: 'Namai sesuai peruntukannya, mis. "Kas Owner" atau "Kas Operasional".',
      fields: [
        { name: 'name', label: 'Nama kantong', type: 'text', required: true, placeholder: 'mis. Kas Operasional' },
        {
          name: 'outlet',
          label: 'Dipakai untuk outlet',
          type: 'select',
          options: opsiOutletKantong(),
          help: KET_OUTLET_KANTONG
        }
      ],
      submitText: 'Tambah'
    });
    if (!values) return;
    try {
      await saveCashAccount({ name: values.name, sort_order: accounts.length, outletId: values.outlet });
      toast('Kantong kas ditambahkan.', 'success');
      await muatUlangKantong();
    } catch (error) {
      toast(error.message ?? 'Gagal menambah kantong.', 'error');
    }
  }

  async function ubahNamaKantong(a) {
    if (!a) return;
    const values = await formDialog({
      title: `Ubah nama "${a.name}"`,
      description:
        'Nama baru langsung berlaku di seluruh riwayat dan laporan, termasuk transaksi lama — ' +
        'nama kantong tidak disalin ke tiap transaksi, melainkan dibaca dari sini.',
      fields: [
        { name: 'name', label: 'Nama kantong', type: 'text', required: true, value: a.name },
        {
          name: 'outlet',
          label: 'Dipakai untuk outlet',
          type: 'select',
          value: a.outlet_id ?? '',
          options: opsiOutletKantong(),
          help: KET_OUTLET_KANTONG
        }
      ],
      submitText: 'Simpan'
    });
    if (!values) return;

    // MENCABUT OUTLET DIKONFIRMASI, karena akibatnya tidak terlihat di layar
    // ini: staff yang selama ini bisa mencatat nota dari kantong ini akan
    // berhenti bisa — dan yang ia lihat cuma pilihan kasnya menghilang, tanpa
    // sebab yang bisa ia telusuri.
    if (a.outlet_id && !values.outlet) {
      const ok = await confirmDialog({
        title: 'Jadikan kantong pribadi?',
        message: `Staff di outlet ${escapeHtml(a.outlets?.name ?? 'itu')} tidak akan bisa lagi mencatat pengeluaran dari "${escapeHtml(a.name)}". Riwayat yang sudah ada tidak berubah.`,
        confirmText: 'Jadikan pribadi'
      });
      if (!ok) return;
    }

    try {
      await saveCashAccount({ id: a.id, name: values.name, sort_order: a.sort_order, outletId: values.outlet });
      toast('Kantong kas diperbarui.', 'success');
      await muatUlangKantong();
    } catch (error) {
      toast(error.message ?? 'Gagal mengubah nama.', 'error');
    }
  }

  async function hapusKantong(a) {
    if (!a) return;
    const saldo = Number(saldoKantong.find((x) => x.account_id === a.id)?.balance ?? 0);
    // Tujuan selalu ditanyakan, bahkan saat saldonya 0: kantong bersaldo nol
    // masih bisa berisi transaksi masuk & keluar yang saling meniadakan, dan
    // transaksi itu tetap harus punya tempat.
    const tujuan = [
      { value: KAS_UTAMA, label: 'Kas Utama' },
      ...accounts.filter((x) => x.id !== a.id).map((x) => ({ value: x.id, label: x.name }))
    ];
    const values = await formDialog({
      title: `Hapus kantong "${a.name}"?`,
      description:
        `Saldo kantong ini ${formatRupiah(saldo)}. Uang dan seluruh transaksinya TIDAK hilang — ` +
        'semuanya dipindahkan ke kantong yang kamu pilih di bawah, lalu kantong ini dihapus. ' +
        'Total saldomu tidak berubah sepeser pun.',
      fields: [{ name: 'target', label: 'Pindahkan isinya ke', type: 'select', options: tujuan, value: tujuan[0].value }],
      submitText: 'Pindahkan & Hapus'
    });
    if (!values) return;

    const namaTujuan = tujuan.find((t) => String(t.value) === String(values.target))?.label ?? 'Kas Utama';
    const ok = await confirmDialog({
      title: `Hapus "${a.name}"?`,
      message: `Seluruh transaksinya akan tercatat di "${namaTujuan}", termasuk di laporan periode yang sudah lewat.`,
      confirmText: 'Hapus',
      danger: true
    });
    if (!ok) return;

    try {
      const pindah = await hapusKantongKas(a.id, idKantong(values.target));
      toast(pindah ? `Kantong dihapus. ${pindah} transaksi pindah ke "${namaTujuan}".` : 'Kantong dihapus.', 'success');
      await muatUlangKantong();
    } catch (error) {
      toast(error.message ?? 'Gagal menghapus kantong.', 'error');
    }
  }

  container.querySelector('#cash-pdf').addEventListener('click', exportPdf);
  container.querySelector('#cash-in').addEventListener('click', openMasuk);
  container.querySelector('#cash-out').addEventListener('click', openKeluar);
  container.querySelector('#cash-move')?.addEventListener('click', openPindah);
  container.querySelector('#cash-manage')?.addEventListener('click', openKelola);

  container.querySelector('#cash-transfer').addEventListener('click', sekaliJalan(async () => {
    if (!others.length) return toast('Belum ada pengguna lain yang bisa menerima transfer.', 'warning');
    const values = await formDialog({
      title: 'Transfer Kas ke Pengguna Lain',
      description: 'Saldo kamu berkurang, saldo penerima bertambah. Penerima boleh dari BU mana pun.',
      fields: [
        {
          name: 'to_user',
          label: 'Kirim ke',
          type: 'searchselect',
          required: true,
          options: others.map((s) => ({ value: s.user_id, label: s.full_name }))
        },
        { name: 'amount', label: 'Jumlah', type: 'money', required: true },
        { name: 'notes', label: 'Keterangan (opsional)', type: 'text' }
      ],
      submitText: 'Transfer'
    });
    if (!values) return;
    if (!(values.amount > 0)) return toast('Jumlah harus lebih dari 0.', 'warning');
    try {
      await transferCash({ toUserId: values.to_user, amount: values.amount, notes: values.notes });
      toast('Transfer berhasil.', 'success');
      await refresh();
    } catch (error) {
      toast(error.message ?? 'Gagal transfer.', 'error');
    }
  }));

  await refresh();
}

function fmtDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}
