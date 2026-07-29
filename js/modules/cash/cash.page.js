import { toast, formDialog } from '../../core/ui.js';
import { formatRupiah } from '../../core/format.js';
import {
  ENTRY_LABEL,
  listCashCategories,
  listCashMembers,
  recordCashEntry,
  transferCash,
  getMyCashBalance,
  listMyCashEntries,
  getCashProofUrl,
  todayWIB
} from './cash.service.js';

/**
 * Kas melekat pada USER (migration 0040): saldo & riwayatnya sama persis
 * di BU/outlet mana pun dia sedang login, jadi halaman ini sengaja tidak
 * memakai businessUnitId/outletId sama sekali.
 */
export async function renderCashPage(container, { userId }) {
  container.innerHTML = `<p>Memuat kas...</p>`;

  let categories, members;
  try {
    [categories, members] = await Promise.all([listCashCategories().catch(() => []), listCashMembers().catch(() => [])]);
  } catch (error) {
    container.innerHTML = `<p class="error-text">Gagal memuat: ${error.message ?? error}</p>`;
    return;
  }
  const others = members.filter((s) => s.user_id !== userId);

  container.innerHTML = `
    <h1>Kas</h1>
    <div class="inline-card" style="max-width:460px">
      <h3 style="margin-top:0;font-size:0.95rem">Saldo Kas Saya</h3>
      <p id="cash-balance" style="font-size:1.6rem;font-weight:700;margin:4px 0">—</p>
      <p style="font-size:0.76rem;color:var(--color-text-muted);margin:0">Saldo ini milikmu pribadi — tidak berubah saat kamu pindah BU atau outlet.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="primary" id="cash-in" style="max-width:130px">+ Kas Masuk</button>
        <button id="cash-out">− Kas Keluar</button>
        <button id="cash-transfer">Transfer</button>
      </div>
    </div>
    <h2 style="font-size:1rem;margin-top:20px">Riwayat Kas</h2>
    <div id="cash-history"></div>
  `;

  const catOptions = (dir) => [
    { value: '', label: '-- tanpa kategori --' },
    ...categories.filter((c) => c.direction === 'both' || c.direction === dir).map((c) => ({ value: c.id, label: c.name }))
  ];

  async function refresh() {
    try {
      const [balance, entries] = await Promise.all([getMyCashBalance(), listMyCashEntries()]);
      container.querySelector('#cash-balance').textContent = formatRupiah(balance);
      const box = container.querySelector('#cash-history');
      box.innerHTML = entries.length
        ? `<table class="data-table">
            <thead><tr><th>Tanggal</th><th>Jenis</th><th>Kategori / Ket.</th><th>Jumlah</th><th></th></tr></thead>
            <tbody>
              ${entries
                .map((e) => {
                  const amt = Number(e.amount);
                  const color = amt >= 0 ? 'var(--color-primary)' : 'var(--color-danger)';
                  const ket = e.cash_categories?.name ?? (e.counterpart?.full_name ? `${amt >= 0 ? 'dari' : 'ke'} ${esc(e.counterpart.full_name)}` : '-');
                  return `<tr>
                    <td style="font-size:0.82rem">${fmtDate(e.entry_date)}</td>
                    <td>${ENTRY_LABEL[e.entry_type] ?? e.entry_type}</td>
                    <td>${esc(ket)}${e.notes ? `<div style="font-size:0.75rem;color:var(--color-text-muted)">${esc(e.notes)}</div>` : ''}</td>
                    <td style="color:${color};font-weight:600">${amt >= 0 ? '+' : '−'}${formatRupiah(Math.abs(amt))}</td>
                    <td>${e.proof_path ? `<button class="btn-proof" data-path="${e.proof_path}">Bukti</button>` : ''}</td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>`
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
      container.querySelector('#cash-history').innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    }
  }

  async function openEntry(type) {
    const isOut = type === 'out';
    const values = await formDialog({
      title: isOut ? 'Catat Kas Keluar' : 'Catat Kas Masuk',
      fields: [
        { name: 'amount', label: 'Jumlah', type: 'money', required: true },
        { name: 'category_id', label: 'Kategori', type: 'select', options: catOptions(type) },
        { name: 'date', label: 'Tanggal', type: 'date', value: todayWIB() },
        { name: 'notes', label: 'Keterangan (opsional)', type: 'text' },
        // Bukti kas hampir selalu difoto di tempat (nota, struk), bukan diambil
        // dari galeri — jadi kamera didahulukan, galeri tetap tersedia.
        { name: 'file', label: 'Foto bukti (opsional)', type: 'photo', facing: 'environment' }
      ],
      submitText: 'Simpan'
    });
    if (!values) return;
    if (!(values.amount > 0)) {
      toast('Jumlah harus lebih dari 0.', 'warning');
      return;
    }
    try {
      await recordCashEntry({
        type,
        amount: values.amount,
        categoryId: values.category_id,
        notes: values.notes,
        date: values.date,
        file: values.file
      });
      toast(isOut ? 'Kas keluar tercatat.' : 'Kas masuk tercatat.', 'success');
      await refresh();
    } catch (error) {
      toast(error.message ?? 'Gagal menyimpan.', 'error');
    }
  }

  container.querySelector('#cash-in').addEventListener('click', () => openEntry('in'));
  container.querySelector('#cash-out').addEventListener('click', () => openEntry('out'));
  container.querySelector('#cash-transfer').addEventListener('click', async () => {
    if (!others.length) {
      toast('Belum ada pengguna lain yang bisa menerima transfer.', 'warning');
      return;
    }
    const values = await formDialog({
      title: 'Transfer Kas ke Pengguna Lain',
      description: 'Saldo kamu berkurang, saldo penerima bertambah. Penerima boleh dari BU mana pun.',
      fields: [
        { name: 'to_user', label: 'Kirim ke', type: 'searchselect', required: true, options: others.map((s) => ({ value: s.user_id, label: s.full_name })) },
        { name: 'amount', label: 'Jumlah', type: 'money', required: true },
        { name: 'notes', label: 'Keterangan (opsional)', type: 'text' }
      ],
      submitText: 'Transfer'
    });
    if (!values) return;
    if (!(values.amount > 0)) {
      toast('Jumlah harus lebih dari 0.', 'warning');
      return;
    }
    try {
      await transferCash({ toUserId: values.to_user, amount: values.amount, notes: values.notes });
      toast('Transfer kas berhasil.', 'success');
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
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
