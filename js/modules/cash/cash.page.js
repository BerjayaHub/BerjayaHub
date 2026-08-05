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
  listMyCashEntries,
  getCashProofUrl,
  getCashProofUrls,
  listMyCashAccounts,
  getMyCashAccountLimit,
  saveCashAccount,
  hapusKantongKas,
  listMyCashAccountBalances,
  pindahKas,
  todayWIB
} from './cash.service.js';

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
  container.innerHTML = `<p>Memuat kas...</p>`;

  let categories, members, accounts, limit, outlets;
  try {
    [categories, members, accounts, limit, outlets] = await Promise.all([
      listCashCategories().catch(() => []),
      listCashMembers().catch(() => []),
      listMyCashAccounts().catch(() => []),
      getMyCashAccountLimit().catch(() => 1),
      listMyOutletsAllBu().catch(() => [])
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
  const pakaiKantong = limit > 1;

  container.innerHTML = `
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
        ${pakaiKantong ? '<button id="cash-move">⇄ Pindah Kas</button>' : ''}
        <button id="cash-transfer">Transfer</button>
        ${pakaiKantong ? '<button id="cash-manage">🏷️ Kelola Kas</button>' : ''}
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:20px">
      <h2 style="font-size:1rem;margin:0">Riwayat Kas</h2>
      <button id="cash-pdf" style="max-width:150px">⇩ Export PDF</button>
    </div>
    <div id="cash-history"></div>
  `;

  const catOptions = (dir) => [
    { value: '', label: '-- tanpa kategori --' },
    ...categories.filter((c) => c.direction === 'both' || c.direction === dir).map((c) => ({ value: c.id, label: c.name }))
  ];
  const akunOptions = () => accounts.map((a) => ({ value: a.id, label: a.name }));

  // Entri yang sedang tampil, dipakai tombol Export PDF. Mengambil ulang dari
  // server saat export berisiko menghasilkan PDF yang ISINYA BERBEDA dari yang
  // dilihat orangnya — dan perbedaan itu tidak akan pernah dia sadari.
  let entriTampil = [];
  // Saldo per kantong hasil refresh terakhir — termasuk baris "Kas Utama"
  // (account_id NULL) kalau memang ada uang di sana.
  let saldoKantong = [];

  async function refresh() {
    try {
      const [balance, entries, saldoAkun] = await Promise.all([
        getMyCashBalance(),
        listMyCashEntries(),
        pakaiKantong ? listMyCashAccountBalances().catch(() => []) : Promise.resolve([])
      ]);
      entriTampil = entries;
      saldoKantong = saldoAkun;
      container.querySelector('#cash-balance').textContent = formatRupiah(balance);

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
        ? `<div class="table-scroll">
            <table class="data-table table-freeze-1">
            <thead><tr><th>Keterangan</th><th>Tanggal</th><th>Jenis</th>${pakaiKantong ? '<th>Kantong</th>' : ''}<th>Outlet</th><th>Jumlah</th><th></th></tr></thead>
            <tbody>
              ${entries
                .map((e) => {
                  const amt = Number(e.amount);
                  const color = amt >= 0 ? 'var(--color-primary)' : 'var(--color-danger)';
                  const ket =
                    e.notes ||
                    e.cash_categories?.name ||
                    (e.counterpart?.full_name ? `${amt >= 0 ? 'dari' : 'ke'} ${e.counterpart.full_name}` : '-');
                  return `<tr>
                    <td><strong>${escapeHtml(ket)}</strong>
                      ${e.cash_categories?.name ? `<div style="font-size:0.74rem;color:var(--color-text-muted)">${escapeHtml(e.cash_categories.name)}</div>` : ''}
                      ${e.qty ? `<div style="font-size:0.74rem;color:var(--color-text-muted)">${formatNum(e.qty)} ${escapeHtml(e.unit ?? '')}</div>` : ''}</td>
                    <td style="font-size:0.82rem">${fmtDate(e.entry_date)}</td>
                    <td style="font-size:0.82rem">${escapeHtml(ENTRY_LABEL[e.entry_type] ?? e.entry_type)}</td>
                    ${pakaiKantong ? `<td style="font-size:0.82rem">${escapeHtml(e.cash_accounts?.name ?? 'Kas Utama')}</td>` : ''}
                    <td style="font-size:0.82rem">${escapeHtml(e.outlets?.name ?? '-')}</td>
                    <td style="color:${color};font-weight:600;white-space:nowrap">${amt >= 0 ? '+' : '−'}${formatRupiah(Math.abs(amt))}</td>
                    <td>${e.proof_path ? `<button class="btn-proof" data-path="${escapeHtml(e.proof_path)}">Bukti</button>` : ''}</td>
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

    const tombol = container.querySelector('#cash-pdf');
    const labelAsli = tombol.textContent;
    tombol.disabled = true;
    tombol.textContent = 'Menyiapkan…';

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
          e.notes ||
          e.cash_categories?.name ||
          (e.counterpart?.full_name ? `${amt >= 0 ? 'dari' : 'ke'} ${e.counterpart.full_name}` : '-');
        const jumlah = e.qty ? `${formatNum(e.qty)} ${e.unit ?? ''}`.trim() : '-';
        const gbr = foto.get(e.id);
        return [
          fmtDate(e.entry_date),
          ket,
          ENTRY_LABEL[e.entry_type] ?? e.entry_type,
          ...(pakaiKantong ? [e.cash_accounts?.name ?? 'Kas Utama'] : []),
          e.outlets?.name ?? '-',
          jumlah,
          // Tanda − (minus panjang) diganti tanda hubung biasa: helvetica bawaan
          // jsPDF tidak punya glyph-nya dan mencetaknya sebagai kotak.
          `${amt >= 0 ? '+' : '-'}${formatRupiah(Math.abs(amt))}`,
          gbr ? { image: gbr, w: 46, h: 34 } : '-'
        ];
      });

      const masuk = entriTampil.reduce((t, e) => t + Math.max(0, Number(e.amount) || 0), 0);
      const keluar = entriTampil.reduce((t, e) => t + Math.min(0, Number(e.amount) || 0), 0);

      await exportTablePDF({
        orientation: 'portrait',
        title: 'Riwayat Kas',
        subtitle: `${namaSaya} · ${entriTampil.length} transaksi · Masuk ${formatRupiah(masuk)} · Keluar ${formatRupiah(Math.abs(keluar))}`,
        columns: [
          { header: 'Tanggal', width: 0.9 },
          { header: 'Keterangan', width: 2 },
          { header: 'Jenis', width: 0.9 },
          ...(pakaiKantong ? [{ header: 'Kantong', width: 1 }] : []),
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
      tombol.disabled = false;
      tombol.textContent = labelAsli;
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
        ...(pakaiKantong && accounts.length
          ? [
              {
                name: 'account_id',
                label: 'Masuk ke kantong',
                type: 'select',
                required: true,
                options: akunOptions(),
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
        { name: 'qty', label: 'Jumlah barang', type: 'qty', placeholder: 'mis. 10' },
        { name: 'unit', label: 'Satuan', type: 'text', placeholder: 'mis. liter / pcs / kg' },
        { name: 'date', label: 'Tanggal', type: 'date', value: todayWIB() },
        ...(pakaiKantong && accounts.length
          ? [{ name: 'account_id', label: 'Diambil dari kantong', type: 'select', required: true, options: akunOptions() }]
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
                    <span style="color:var(--color-text-muted)">· ${formatRupiah(Number(saldo) || 0)}</span></span>
                  <button class="kk-edit" data-id="${escapeHtml(a.id)}" title="Ubah nama kantong">✎</button>
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

  async function tambahKantong() {
    const values = await formDialog({
      title: 'Tambah Kantong Kas',
      description: 'Namai sesuai peruntukannya, mis. "Kas Owner" atau "Kas Operasional".',
      fields: [{ name: 'name', label: 'Nama kantong', type: 'text', required: true, placeholder: 'mis. Kas Operasional' }],
      submitText: 'Tambah'
    });
    if (!values) return;
    try {
      await saveCashAccount({ name: values.name, sort_order: accounts.length });
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
      fields: [{ name: 'name', label: 'Nama kantong', type: 'text', required: true, value: a.name }],
      submitText: 'Simpan'
    });
    if (!values) return;
    try {
      await saveCashAccount({ id: a.id, name: values.name, sort_order: a.sort_order });
      toast('Nama kantong diperbarui.', 'success');
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

  container.querySelector('#cash-transfer').addEventListener('click', async () => {
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
  });

  await refresh();
}

function fmtDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}
