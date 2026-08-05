import { toast, formDialog, confirmDialog, escapeHtml } from '../../core/ui.js';
import { formatRupiah, formatNum } from '../../core/format.js';
import { listMyOutlets } from '../../core/my-outlets.js';
import {
  ENTRY_LABEL,
  listCashCategories,
  listCashMembers,
  recordCashEntry,
  transferCash,
  getMyCashBalance,
  listMyCashEntries,
  getCashProofUrl,
  listMyCashAccounts,
  getMyCashAccountLimit,
  saveCashAccount,
  deleteCashAccount,
  listMyCashAccountBalances,
  pindahKas,
  todayWIB
} from './cash.service.js';

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
      listMyOutlets(businessUnitId).catch(() => [])
    ]);
  } catch (error) {
    container.innerHTML = `<p class="error-text">Gagal memuat: ${escapeHtml(error.message ?? error)}</p>`;
    return;
  }
  const others = members.filter((s) => s.user_id !== userId);
  const pakaiKantong = limit > 1;

  container.innerHTML = `
    <h1>Kas</h1>
    <div class="inline-card" style="max-width:460px">
      <h3 style="margin-top:0;font-size:0.95rem">Saldo Kas Saya</h3>
      <p id="cash-balance" style="font-size:1.6rem;font-weight:700;margin:4px 0">—</p>
      <p style="font-size:0.76rem;color:var(--color-text-muted);margin:0">Saldo ini milikmu pribadi — tidak berubah saat kamu pindah BU atau outlet.</p>
      <div id="cash-accounts" style="margin-top:10px"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="primary" id="cash-in" style="max-width:130px">+ Kas Masuk</button>
        <button id="cash-out">− Kas Keluar</button>
        ${pakaiKantong ? '<button id="cash-move">⇄ Pindah Kas</button>' : ''}
        <button id="cash-transfer">Transfer</button>
        ${pakaiKantong ? '<button id="cash-manage">🏷️ Kelola Kas</button>' : ''}
      </div>
    </div>
    <h2 style="font-size:1rem;margin-top:20px">Riwayat Kas</h2>
    <div id="cash-history"></div>
  `;

  const catOptions = (dir) => [
    { value: '', label: '-- tanpa kategori --' },
    ...categories.filter((c) => c.direction === 'both' || c.direction === dir).map((c) => ({ value: c.id, label: c.name }))
  ];
  const akunOptions = () => accounts.map((a) => ({ value: a.id, label: a.name }));

  async function refresh() {
    try {
      const [balance, entries, saldoAkun] = await Promise.all([
        getMyCashBalance(),
        listMyCashEntries(),
        pakaiKantong ? listMyCashAccountBalances() : Promise.resolve([])
      ]);
      container.querySelector('#cash-balance').textContent = formatRupiah(balance);

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
      return toast('Belum ada outlet yang bisa kamu akses — kas keluar butuh outlet peruntukan.', 'warning');
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
          options: outlets.map((o) => ({ value: o.id, label: o.name })),
          help: 'Uang ini dibelanjakan untuk outlet mana. Pilihannya hanya outlet tempat kamu punya peran.'
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
  async function openPindah() {
    if (accounts.length < 2) return toast('Butuh minimal dua kantong kas untuk memindahkan saldo.', 'warning');
    const values = await formDialog({
      title: 'Pindah Antar Kantong Kas',
      description: 'Total saldomu tidak berubah — uangnya hanya berpindah kantong.',
      fields: [
        { name: 'from', label: 'Dari kantong', type: 'select', required: true, options: akunOptions() },
        { name: 'to', label: 'Ke kantong', type: 'select', required: true, options: akunOptions() },
        { name: 'amount', label: 'Jumlah', type: 'money', required: true },
        { name: 'notes', label: 'Keterangan (opsional)', type: 'text', placeholder: 'mis. pembagian setoran' }
      ],
      submitText: 'Pindahkan'
    });
    if (!values) return;
    if (values.from === values.to) return toast('Kantong asal dan tujuan tidak boleh sama.', 'warning');
    if (!(values.amount > 0)) return toast('Jumlah harus lebih dari 0.', 'warning');
    try {
      await pindahKas({ fromAccountId: values.from, toAccountId: values.to, amount: values.amount, notes: values.notes });
      toast('Saldo dipindahkan.', 'success');
      await refresh();
    } catch (error) {
      toast(error.message ?? 'Gagal memindahkan.', 'error');
    }
  }

  // ---- Kelola nama kantong ----
  async function openKelola() {
    const daftar = await listMyCashAccounts(false).catch(() => []);
    const bodyRows = daftar.length
      ? daftar.map((a) => `• ${a.name}${a.is_active ? '' : ' (nonaktif)'}`).join('\n')
      : '(belum ada)';

    const values = await formDialog({
      title: '🏷️ Kelola Kantong Kas',
      description: `Jatahmu ${limit} kantong. Terpakai ${daftar.filter((a) => a.is_active).length}.\n${bodyRows}`,
      fields: [
        {
          name: 'aksi',
          label: 'Mau apa?',
          type: 'select',
          value: 'tambah',
          options: [
            { value: 'tambah', label: 'Tambah kantong baru' },
            ...daftar.map((a) => ({ value: `edit:${a.id}`, label: `Ubah nama "${a.name}"` })),
            ...daftar.map((a) => ({ value: `hapus:${a.id}`, label: `Hapus "${a.name}"` }))
          ]
        },
        { name: 'name', label: 'Nama kantong', type: 'text', placeholder: 'mis. Kas Operasional' }
      ],
      submitText: 'Lanjut'
    });
    if (!values) return;

    try {
      if (values.aksi === 'tambah') {
        if (!values.name?.trim()) return toast('Isi nama kantongnya.', 'warning');
        await saveCashAccount({ name: values.name, sort_order: daftar.length });
        toast('Kantong kas ditambahkan.', 'success');
      } else if (values.aksi.startsWith('edit:')) {
        if (!values.name?.trim()) return toast('Isi nama barunya.', 'warning');
        await saveCashAccount({ id: values.aksi.slice(5), name: values.name });
        toast('Nama kantong diperbarui.', 'success');
      } else if (values.aksi.startsWith('hapus:')) {
        const id = values.aksi.slice(6);
        const a = daftar.find((x) => x.id === id);
        const ok = await confirmDialog({
          title: `Hapus kantong "${a?.name ?? ''}"?`,
          message: 'Kantong yang sudah dipakai transaksi tidak bisa dihapus — riwayatnya harus tetap punya penunjuk kantong.',
          confirmText: 'Hapus',
          danger: true
        });
        if (!ok) return;
        await deleteCashAccount(id);
        toast('Kantong kas dihapus.', 'success');
      }
      accounts = await listMyCashAccounts().catch(() => []);
      await refresh();
    } catch (error) {
      toast(error.message ?? 'Gagal.', 'error');
    }
  }

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
