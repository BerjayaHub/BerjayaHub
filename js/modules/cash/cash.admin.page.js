import { toast, confirmDialog, formDialog } from '../../core/ui.js';
import { formatRupiah } from '../../core/format.js';
import {
  ENTRY_LABEL,
  listCashCategories,
  listCashMembers,
  createCashCategory,
  updateCashCategory,
  deleteCashCategory,
  listCashBalances,
  listCashEntriesAdmin,
  ubahSupplierKas,
  getCashProofUrl,
  daftarKantongKas,
  aturKantongKas,
  alasanTolakKoreksiKas,
  ubahKas,
  coretKas
} from './cash.service.js';
import { listMyOutletsAllBu } from '../../core/my-outlets.js';
import { listEsbMaster } from '../inventory/esb.service.js';
import { monthRangeWIB } from '../../core/dates.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { notaTerkaitEntriKas } from '../inventory/nota.service.js';
import { bukaDialogNota } from '../inventory/nota-dialog.js';
import { pecahKeterangan, petaNotaPerEntri } from './keterangan-nota.js';
import { keadaanKoreksi, totalKas } from './koreksi-kas.js';
import { LABEL_PENGELUARAN, saringPengeluaran, ringkasPengeluaran } from './jenis-pengeluaran.js';
import { kodeKas, cocokKodeKas } from './kode-kas.js';

const DIRECTIONS = [
  { value: 'both', label: 'Masuk & Keluar' },
  { value: 'in', label: 'Masuk saja' },
  { value: 'out', label: 'Keluar saja' }
];

const TABS = [
  { key: 'balances', label: 'Saldo & Mutasi' },
  { key: 'accounts', label: 'Kantong Kas' },
  { key: 'categories', label: 'Kategori' }
];

/**
 * Kas melekat pada USER (migration 0040), jadi halaman ini lintas BU.
 *
 * SEJAK 0141 BUKAN LAGI SUPER-ADMIN-ONLY. Admin BU boleh membukanya, dan yang
 * ia lihat dibatasi RLS `cash_entries_select_bu_admin`: kas orang yang punya
 * keanggotaan di BU yang ia admini, bukan seluruh organisasi. Super admin tetap
 * melihat semuanya lewat kebijakan lamanya.
 *
 * Karena itu kalimat pembuka halaman ini SENGAJA tidak lagi menjanjikan
 * "seluruh pemegang kas di organisasi" — janji yang tidak ditepati untuk admin
 * BU akan terbaca sebagai data yang hilang.
 */
export async function renderCashAdminPage(container) {
  container.innerHTML = `
    <h1>Kas</h1>
    <p style="font-size:0.82rem;color:var(--color-text-muted);margin-top:0">
      Kas melekat pada orang, bukan BU/outlet. Super admin melihat seluruh pemegang kas di organisasi;
      admin BU melihat pemegang kas yang bernaung di BU yang ia kelola — tanpa memandang outlet basisnya.
    </p>
    <div class="tab-bar">
      ${TABS.map((t, i) => `<button class="tab-btn ${i === 0 ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>`).join('')}
    </div>
    <div id="cash-admin-content"></div>
  `;
  const content = document.getElementById('cash-admin-content');
  async function showTab(key) {
    container.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === key));
    if (key === 'balances') await renderBalancesTab(content);
    if (key === 'accounts') await renderAccountsTab(content);
    if (key === 'categories') await renderCategoriesTab(content);
  }
  container.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
  await showTab('balances');
}

// ---- Tab: Saldo & Mutasi ----

async function renderBalancesTab(content) {
  content.innerHTML = loadingHtml('Memuat…', { baris: 5 });
  let balances, staff;
  try {
    [balances, staff] = await Promise.all([listCashBalances(), listCashMembers()]);
  } catch (error) {
    content.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  const nameById = new Map(staff.map((s) => [s.user_id, s.full_name]));
  const rows = balances.filter((b) => Number(b.balance) !== 0 || nameById.has(b.holder_id));
  const total = rows.reduce((sum, b) => sum + Number(b.balance || 0), 0);
  const range = monthRangeWIB();

  content.innerHTML = `
    <h2 style="font-size:1.05rem">Saldo Kas per Pemegang</h2>
    <div class="table-scroll" style="max-width:460px"><table class="data-table table-freeze-1">
      <thead><tr><th>Pemegang</th><th>Saldo</th></tr></thead>
      <tbody>
        ${rows.map((b) => `<tr><td>${esc(nameById.get(b.holder_id) ?? '-')}</td><td>${formatRupiah(b.balance)}</td></tr>`).join('') || '<tr><td colspan="2">Belum ada data kas.</td></tr>'}
      </tbody>
    </table></div>
    <p style="font-weight:600;margin-top:8px">Total kas seluruh pemegang: ${formatRupiah(total)}</p>

    <h2 style="font-size:1.05rem;margin-top:20px">Mutasi Kas</h2>
    <div class="inline-card" style="max-width:640px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="margin:0"><label>Pemegang</label>
        <select id="cm-holder"><option value="">Semua</option>${staff.map((s) => `<option value="${s.user_id}">${esc(s.full_name)}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0"><label>Jenis</label>
        <select id="cm-type"><option value="">Semua</option>${Object.entries(ENTRY_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0"><label>Pengeluaran</label>
        <select id="cm-bahan">${Object.entries(LABEL_PENGELUARAN)
          .map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`)
          .join('')}</select>
      </div>
      <div class="field" style="margin:0"><label>Dari</label><input type="date" id="cm-from" value="${range.from}" /></div>
      <div class="field" style="margin:0"><label>Sampai</label><input type="date" id="cm-to" value="${range.to}" /></div>
      <div class="field" style="margin:0"><label>Cari nomor kas</label>
        <input type="search" id="cm-kode" placeholder="mis. KAS-7E9CF9F2" autocomplete="off" style="min-width:170px" />
      </div>
      <button class="primary" id="cm-go" style="max-width:120px">Tampilkan</button>
    </div>
    <div id="cm-result"></div>
  `;
  const go = () => loadMutasi(content);
  content.querySelector('#cm-go').addEventListener('click', go);
  // Saringan jenis pengeluaran dikerjakan di sisi tampilan — datanya sudah ada
  // di memori, jadi menunggu jaringan untuk memilih satu dari tiga pilihan
  // hanya membuatnya terasa berat tanpa menambah apa pun.
  content.querySelector('#cm-bahan').addEventListener('change', go);
  content.querySelector('#cm-kode').addEventListener('input', go);
  await go();
}

async function loadMutasi(content) {
  const holderId = content.querySelector('#cm-holder').value || '';
  const entryType = content.querySelector('#cm-type').value || '';
  const from = content.querySelector('#cm-from').value;
  const to = content.querySelector('#cm-to').value;
  const saringBahan = content.querySelector('#cm-bahan')?.value ?? '';
  // Nomor kas yang dicari datang dari layar EKSPOR — "KAS-7E9CF9F2" di kolom
  // "Dokumen terpengaruh". Tanpa kotak ini, yang membacanya tahu ada dua entri
  // yang perlu dibereskan dan tidak punya cara menemukannya di antara puluhan
  // baris.
  const cariKode = content.querySelector('#cm-kode')?.value ?? '';
  const result = content.querySelector('#cm-result');
  result.innerHTML = loadingHtml('Memuat…', { baris: 5 });
  let rows;
  try {
    rows = await listCashEntriesAdmin({ holderId, entryType, dateFrom: from || '', dateTo: to || '' });
  } catch (error) {
    result.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }

  // Nota terkait + izin koreksi, keduanya sekali untuk seluruh halaman.
  //
  // Gagal salah satunya TIDAK boleh mengosongkan tabel mutasinya: yang hilang
  // cuma tautan nomor nota dan keterangan di tombol. Angka-angkanya — satu-
  // satunya alasan orang membuka layar ini — tetap benar.
  const [notas, tolak] = await Promise.all([
    notaTerkaitEntriKas(
      rows.map((r) => r.id),
      rows.map((r) => r.penyesuaian_nota)
    ).catch(() => []),
    alasanTolakKoreksiKas(rows.map((r) => r.id))
  ]);
  const notaPerEntri = petaNotaPerEntri(rows, notas);
  // `alasan_tolak` ditempelkan ke barisnya supaya `keadaanKoreksi` — modul
  // murni yang sama dengan Staff App — bisa dipakai apa adanya di sini.
  for (const r of rows) r.alasan_tolak = tolak.get(r.id) ?? null;

  // RINGKASANNYA DIHITUNG DARI SELURUH BARIS, saringannya dipakai sesudahnya.
  //
  // Kalau angkanya ikut menyusut mengikuti saringan, "12 untuk bahan · 3 selain
  // bahan" berubah jadi "3 · 3" begitu salah satunya dipilih — dan yang
  // membacanya kehilangan satu-satunya petunjuk berapa yang ada di sisi lain.
  const { masuk, keluar, dicoret } = totalKas(rows);
  const rincian = ringkasPengeluaran(rows);
  const semuaBaris = rows;
  rows = saringPengeluaran(rows, saringBahan);
  if (cariKode.trim()) rows = rows.filter((r) => cocokKodeKas(r.id, cariKode));

  result.innerHTML = `
    <p style="margin:12px 0 6px;font-weight:600">Masuk ${formatRupiah(masuk)} · Keluar ${formatRupiah(keluar)} · Net ${formatRupiah(masuk - keluar)}${
      dicoret ? ` · ${dicoret} dihapus (tidak dihitung)` : ''
    }</p>
    <p style="margin:0 0 8px;font-size:0.82rem;color:var(--color-text-muted)">
      Pengeluaran: <strong>${rincian.bahan}</strong> untuk bahan (${formatRupiah(rincian.totalBahan)}) ·
      <strong>${rincian.nonBahan}</strong> selain bahan (${formatRupiah(rincian.totalNonBahan)}) — yang kedua inilah yang berangkat sebagai Disbursement.
      ${
        rows.length !== semuaBaris.length
          ? `<br>Menampilkan ${rows.length} dari ${semuaBaris.length} baris.`
          : ''
      }
    </p>
    <div class="table-scroll"><table class="data-table kartu-sempit">
      <thead><tr><th style="width:30px"></th><th>No. Kas</th><th>Tanggal</th><th>Pemegang</th><th>Jenis</th><th>Kategori / Lawan</th><th>Jumlah</th><th>Supplier</th><th>Bukti</th><th>Aksi</th></tr></thead>
      <tbody>
        ${rows
          .map((r) => {
            const amt = Number(r.amount);
            const k = keadaanKoreksi(r);
            const ket = r.cash_categories?.name ?? (r.counterpart?.full_name ? `${amt >= 0 ? 'dari' : 'ke'} ${r.counterpart.full_name}` : '-');
            const warna = k.dicoret ? 'var(--color-text-muted)' : amt >= 0 ? 'var(--color-primary)' : 'var(--color-danger)';
            // Hanya kas KELUAR yang pernah jadi Disbursement, dan hanya yang
            // belum diekspor & belum dicoret yang masih bisa diisi. Centang
            // pada baris yang tidak memenuhi itu cuma menawarkan pekerjaan
            // yang pasti ditolak database.
            const bisaSupplier = r.entry_type === 'out' && !k.dicoret && !r.esb_exported_at;
            return `<tr${k.dicoret ? ' class="kas-dicoret"' : ''}>
              <td>${
                bisaSupplier ? `<input type="checkbox" class="cm-pilih" value="${esc(r.id)}" />` : ''
              }</td>
              <td data-label="No. Kas" style="font-size:0.76rem;white-space:nowrap;font-family:monospace">${esc(kodeKas(r.id))}</td>
              <td style="font-size:0.82rem" data-label="Tanggal">${fmtDate(r.entry_date)}</td>
              <td data-label="Pemegang"><strong>${esc(r.holder?.full_name ?? '-')}</strong></td>
              <td data-label="Jenis">${ENTRY_LABEL[r.entry_type] ?? r.entry_type}</td>
              <td data-label="Kategori / Lawan">${esc(ket)}
                ${r.notes ? `<div style="font-size:0.75rem;color:var(--color-text-muted)">${ketHtml(r.notes, notaPerEntri.get(r.id))}</div>` : ''}
                ${k.jejak ? `<div class="kas-jejak">${esc(k.jejak)}</div>` : ''}</td>
              <td style="color:${warna};font-weight:600;white-space:nowrap" data-label="Jumlah">${amt >= 0 ? '+' : '−'}${formatRupiah(Math.abs(amt))}</td>
              <td data-label="Supplier" style="font-size:0.8rem">${
                r.entry_type !== 'out'
                  ? '<span style="color:var(--color-text-muted)">—</span>'
                  : r.supplier
                    ? esc(r.supplier)
                    : '<span class="nota-telat">belum diisi</span>'
              }${
                r.esb_exported_at
                  ? '<br><span style="font-size:0.72rem;color:var(--color-text-muted)">terkunci — sudah diekspor</span>'
                  : ''
              }</td>
              <td data-label="Bukti">${r.proof_path ? `<button class="btn-proof" data-path="${esc(r.proof_path)}">Bukti</button>` : '<span style="color:var(--color-text-muted)">—</span>'}</td>
              <td data-label="Aksi">${tombolKoreksi(r, k)}</td>
            </tr>`;
          })
          .join('') || '<tr><td colspan="10">Tidak ada data.</td></tr>'}
      </tbody>
    </table></div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
      <button id="cm-isi-supplier">Isi Supplier untuk yang dicentang</button>
      <span style="font-size:0.78rem;color:var(--color-text-muted)">
        Payment To untuk ekspor ESB Disbursement. Seluruh kas keluar yang tercatat sebelum kolom ini ada belum terisi.
      </span>
    </div>
  `;
  result.querySelectorAll('.btn-proof').forEach((btn) =>
    btn.addEventListener('click', async () => {
      try {
        const url = await getCashProofUrl(btn.dataset.path);
        if (url) window.open(url, '_blank');
      } catch (error) {
        toast(error.message ?? 'Gagal membuka bukti.', 'error');
      }
    })
  );

  const semuaNota = new Map(notas.map((n) => [n.id, n]));
  result.querySelectorAll('.btn-nota').forEach((btn) =>
    btn.addEventListener('click', () => bukaDialogNota(semuaNota.get(btn.dataset.id)))
  );

  result.querySelector('#cm-isi-supplier')?.addEventListener(
    'click',
    sekaliJalan(async () => {
      // Dibaca dari SELURUH tbody: baris yang disembunyikan penyaring tetap
      // ada di DOM dan centangnya tetap sah.
      const ids = [...result.querySelectorAll('.cm-pilih:checked')].map((c) => c.value);
      if (!ids.length) return toast('Centang dulu kas keluar yang mau diisi suppliernya.', 'warning');

      const bu = rows.find((r) => ids.includes(r.id))?.business_unit_id ?? null;
      const daftar = await listEsbMaster(bu, 'supplier').catch(() => []);
      if (!daftar.length) {
        return toast('Daftar supplier ESB belum diimpor — impor dulu di Ekspor ESB langkah 3.', 'warning');
      }

      const v = await formDialog({
        title: `Isi Supplier untuk ${ids.length} kas keluar`,
        description:
          'Jadi kolom "Payment To" saat diekspor ke ESB. Seluruh baris yang dicentang diisi nama yang sama — ' +
          'centang per supplier, bukan sekaligus semuanya.',
        fields: [
          {
            name: 'supplier',
            label: 'Dibayar ke (supplier)',
            type: 'searchselect',
            required: true,
            allowCreate: true,
            options: daftar
              .map((m) => ({ value: m.nama, label: m.nama, hint: m.kode ? `kode ESB ${m.kode}` : '' }))
              .sort((a, b) => a.label.localeCompare(b.label, 'id'))
          }
        ],
        submitText: 'Simpan'
      });
      if (!v?.supplier) return;

      try {
        const n = await ubahSupplierKas(ids, v.supplier);
        // Angka dari database DIBANDINGKAN dengan yang dicentang: baris milik
        // kas yang bukan wewenangnya, atau yang tandanya berubah sejak halaman
        // ini dimuat, dilewati tanpa melempar — melaporkan "berhasil" begitu
        // saja membuat admin mengira pekerjaannya selesai.
        if (n === ids.length) toast(`${n} kas keluar diisi "${v.supplier}".`, 'success');
        else toast(`${n} dari ${ids.length} terisi — sisanya bukan wewenangmu, sudah diekspor, atau sudah dihapus.`, 'warning');
      } catch (e) {
        return toast(e.message ?? 'Gagal menyimpan supplier.', 'error');
      }
      await loadMutasi(content);
    })
  );

  const perId = new Map(rows.map((r) => [r.id, r]));
  result.querySelectorAll('.btn-kas-ubah').forEach((btn) =>
    btn.addEventListener('click', () => ubahEntriAdmin(perId.get(btn.dataset.id), content))
  );
  result.querySelectorAll('.btn-kas-hapus').forEach((btn) =>
    btn.addEventListener('click', () => hapusEntriAdmin(perId.get(btn.dataset.id), content))
  );
}

/**
 * Keterangan dengan nomor notanya jadi tombol — modul murni yang SAMA dengan
 * Staff App (`pecahKeterangan`). Meniru aturannya di sini akan membuat nomor
 * nota yang sama bisa diketuk di satu layar dan tidak di layar lainnya.
 */
function ketHtml(ket, notas) {
  const { bagian, tambahan } = pecahKeterangan(ket, notas ?? []);
  const tombol = (t) => `<button type="button" class="btn-nota" data-id="${esc(t.notaId)}">${esc(t.teks)}</button>`;
  const utama = bagian.map((b) => (b.notaId ? tombol(b) : esc(b.teks))).join('');
  const ekor = tambahan.length ? `<div class="kas-nota-ekor">Nota: ${tambahan.map(tombol).join(' ')}</div>` : '';
  return (utama || esc(ket ?? '-')) + ekor;
}

/** Sama persis dengan Staff App: tombol yang tidak boleh ditekan tetap digambar. */
function tombolKoreksi(r, k) {
  if (k.dicoret) return '<span style="color:var(--color-text-muted)">—</span>';
  if (!k.bolehKoreksi) {
    const sebab = esc(k.alasanTolak);
    return `<button class="btn-kas-info" disabled title="${sebab}" aria-label="${sebab}">🔒</button>`;
  }
  const id = esc(r.id);
  return `<button class="btn-kas-ubah" data-id="${id}" title="Ubah entri ini">✎</button>
          <button class="btn-kas-hapus btn-danger" data-id="${id}" title="Hapus entri ini">🗑</button>`;
}

/**
 * Ubah entri kas milik ORANG LAIN.
 *
 * Outletnya dipilih dari daftar outlet ADMIN YANG LOGIN, bukan milik
 * pemegangnya — dan itu memang batasnya: admin hanya bisa menunjuk outlet yang
 * ia kenal. Kalau outlet lama tidak ada di daftarnya, nilainya dipertahankan
 * sebagai pilihan tersendiri supaya menyimpan perubahan keterangan tidak
 * diam-diam MEMINDAHKAN peruntukan entrinya ke outlet lain.
 */
async function ubahEntriAdmin(r, content) {
  if (!r) return;
  const keluar = r.entry_type === 'out';
  let outlets = [];
  let daftarSupplier = [];
  if (keluar) {
    [outlets, daftarSupplier] = await Promise.all([
      listMyOutletsAllBu().catch(() => []),
      // Daftar supplier ESB (0144) — Payment To untuk berkas Disbursement.
      // Gagal dibacanya berarti kolomnya tidak muncul dan nilainya dikirim apa
      // adanya; dialognya tidak boleh mati karena satu daftar tambahan.
      listEsbMaster(r.business_unit_id, 'supplier').catch(() => [])
    ]);
  }
  const opsiOutlet = outlets.map((o) => ({
    value: o.id,
    label: o.business_unit_name ? `${o.business_unit_name} — ${o.name}` : o.name
  }));
  if (keluar && r.outlet_id && !opsiOutlet.some((o) => o.value === r.outlet_id)) {
    opsiOutlet.unshift({ value: r.outlet_id, label: '(outlet asalnya — di luar aksesmu)' });
  }

  const values = await formDialog({
    title: `Ubah entri kas ${r.holder?.full_name ?? ''}`.trim(),
    description:
      'Pemegang, kantong, jenis, dan foto notanya tidak bisa diubah dari sini. Perubahan ini tercatat atas namamu ' +
      'dan terlihat oleh pemegang kasnya.',
    fields: [
      { name: 'amount', label: 'Jumlah uang (Rp)', type: 'money', required: true, value: Math.abs(Number(r.amount) || 0) },
      { name: 'notes', label: 'Keterangan', type: 'text', required: true, value: r.notes ?? '' },
      ...(keluar
        ? [{ name: 'outlet_id', label: 'Untuk outlet', type: 'select', required: true, value: r.outlet_id ?? '', options: opsiOutlet }]
        : []),
      // SELURUH kas keluar yang ada hari ini tidak punya Supplier — kolomnya
      // baru lahir di 0149. Tanpa kotaknya di sini, satu-satunya yang bisa
      // mengisinya adalah pemegang kasnya sendiri, satu per satu.
      ...(keluar && daftarSupplier.length
        ? [
            {
              name: 'supplier',
              label: 'Dibayar ke (supplier)',
              type: 'searchselect',
              allowCreate: true,
              value: r.supplier ?? '',
              options: daftarSupplier
                .map((m) => ({ value: m.nama, label: m.nama, hint: m.kode ? `kode ESB ${m.kode}` : '' }))
                .sort((a, b) => a.label.localeCompare(b.label, 'id')),
              help: 'Jadi kolom "Payment To" saat diekspor ke ESB Disbursement.'
            }
          ]
        : []),
      { name: 'date', label: 'Tanggal', type: 'date', value: r.entry_date ?? '' }
    ],
    submitText: 'Simpan perubahan'
  });
  if (!values) return;
  if (!(values.amount > 0)) return toast('Jumlah uang harus lebih dari 0.', 'warning');
  try {
    await ubahKas({
      id: r.id,
      amount: values.amount,
      // Kategori, qty & satuan SENGAJA dikirim apa adanya dari barisnya: dialog
      // ini tidak menampilkannya, dan `ubah_kas` menulis PENUH — field yang
      // tidak disebut akan terhapus (bug 0119).
      categoryId: r.category_id ?? null,
      outletId: values.outlet_id ?? r.outlet_id,
      notes: values.notes,
      qty: r.qty ?? null,
      unit: r.unit ?? null,
      // `ubah_kas` menulis PENUH: field yang tidak dikirim akan TERHAPUS.
      // Tanpa baris ini, admin yang membetulkan satu huruf di keterangan akan
      // MENGHAPUS Payment To-nya, dan entrinya tertahan saat diekspor dengan
      // alasan yang terlihat datang entah dari mana. Itu bug 0119 dalam bentuk
      // ketiga.
      //
      // Nilai lamanya dipakai kalau kotaknya tidak digambar — daftar supplier
      // yang gagal dimuat membuat `values.supplier` undefined.
      supplier: values.supplier ?? r.supplier ?? null,
      date: values.date
    });
    toast('Entri kas diperbarui.', 'success');
    await loadMutasi(content);
  } catch (error) {
    toast(error.message ?? 'Gagal menyimpan.', 'error');
  }
}

async function hapusEntriAdmin(r, content) {
  if (!r) return;
  const values = await formDialog({
    title: 'Hapus Entri Kas?',
    description:
      `${r.holder?.full_name ?? '-'} · ${r.notes ?? '-'} · ${formatRupiah(Math.abs(Number(r.amount) || 0))}. ` +
      'Barisnya TIDAK dibuang — ia tetap terlihat di sini dan di Staff App pemegangnya, ditandai dihapus beserta ' +
      'namamu dan alasannya, dan berhenti menghitung saldo.',
    fields: [{ name: 'alasan', label: 'Alasan penghapusan', type: 'text', required: true, placeholder: 'mis. salah input, dobel' }],
    submitText: 'Hapus'
  });
  if (!values) return;
  try {
    await coretKas(r.id, values.alasan);
    toast('Entri kas dihapus. Jejaknya tetap tersimpan.', 'success');
    await loadMutasi(content);
  } catch (error) {
    toast(error.message ?? 'Gagal menghapus.', 'error');
  }
}

// ---- Tab: Kantong Kas ----

/**
 * KENAPA TAB INI ADA.
 *
 * 0120 membuat kantong kas bisa diberi OUTLET, supaya staff outlet itu boleh
 * mencatat pengeluaran dari kantong milik orang lain (Shenda menginput nota,
 * kas Risma yang berkurang).
 *
 * Satu-satunya layar yang bisa mengisi outlet itu ada di STAFF APP, di balik
 * tombol yang hanya digambar kalau jatah kantongnya lebih dari satu — dan
 * pemegang berjatah 1 bahkan belum punya baris kantong sama sekali; kasnya
 * hidup sebagai "Kas Utama". Jadi tidak ada seorang pun, termasuk super admin,
 * yang bisa menyalakan fitur itu.
 *
 * Di sini adminnya yang membuatkan.
 */

const KET_OUTLET_KANTONG_ADMIN =
  'Kalau kantong ini diberi outlet, SIAPA PUN yang bertugas di outlet itu bisa mencatat pengeluaran dari kantong ' +
  'pemegangnya — mis. staff yang menginput nota dari supplier. Uangnya tetap milik pemegangnya dan selisihnya tetap ' +
  'tanggung jawabnya; setiap entri mencatat siapa yang membuatnya. Kosongkan kalau kantong ini pribadi.';

async function renderAccountsTab(content) {
  content.innerHTML = loadingHtml('Memuat…', { baris: 5 });
  let kantong, staff, outlets;
  try {
    [kantong, staff, outlets] = await Promise.all([daftarKantongKas(), listCashMembers(), listMyOutletsAllBu().catch(() => [])]);
  } catch (error) {
    content.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }

  const adaKasUtamaBerisi = kantong.some((k) => !k.kantong_nyata);

  content.innerHTML = `
    <div class="page-header">
      <h2 style="font-size:1.05rem;margin:0">Kantong Kas</h2>
      <button class="primary" id="btn-new-akun" style="max-width:190px">+ Tambah Kantong</button>
    </div>
    <p style="font-size:0.82rem;color:var(--color-text-muted);max-width:720px">
      Kantong yang diberi <strong>outlet</strong> boleh dibebani siapa pun yang bertugas di outlet itu — inilah yang
      membuat staff bisa menginput nota supplier sementara uangnya berkurang dari kas pemegangnya.
      Kantong tanpa outlet tetap pribadi: hanya pemegangnya.
    </p>
    ${
      adaKasUtamaBerisi
        ? `<p style="font-size:0.82rem;color:var(--color-text-muted);max-width:720px">
             Baris <strong>Kas Utama</strong> adalah uang yang tidak berada di kantong mana pun — tempat kas berada
             sebelum kantong pertama dibuat. Ia tidak bisa diberi outlet. Saldo totalnya tetap terhitung, dan membuat
             kantong baru tidak memindahkan isinya.
           </p>`
        : ''
    }
    <div class="table-scroll"><table class="data-table table-freeze-1">
      <thead><tr><th>Pemegang</th><th>Kantong</th><th>Outlet</th><th>Saldo</th><th>Status</th><th>Aksi</th></tr></thead>
      <tbody>
        ${
          kantong
            .map((k) => {
              if (!k.kantong_nyata) {
                return `<tr style="color:var(--color-text-muted)">
                  <td>${esc(k.holder_name)}</td>
                  <td><em>Kas Utama</em></td>
                  <td>—</td>
                  <td>${formatRupiah(k.balance)}</td>
                  <td>—</td>
                  <td style="font-size:0.75rem">tanpa kantong</td>
                </tr>`;
              }
              return `<tr>
                <td>${esc(k.holder_name)}</td>
                <td>${esc(k.name)}</td>
                <td>${k.outlet_name ? `🏪 ${esc(k.outlet_name)}` : '<span style="color:var(--color-text-muted)">pribadi</span>'}</td>
                <td>${formatRupiah(k.balance)}</td>
                <td>${k.is_active ? 'Aktif' : 'Ditutup'}</td>
                <td><button class="btn-edit-akun" data-json='${escAttr(JSON.stringify(k))}'>Edit</button></td>
              </tr>`;
            })
            .join('') || '<tr><td colspan="6">Belum ada kantong kas.</td></tr>'
        }
      </tbody>
    </table></div>
  `;

  content.querySelector('#btn-new-akun').addEventListener('click', () => openAkunDialog(content, null, staff, outlets));
  content
    .querySelectorAll('.btn-edit-akun')
    .forEach((btn) => btn.addEventListener('click', () => openAkunDialog(content, JSON.parse(btn.dataset.json), staff, outlets)));
}

async function openAkunDialog(content, existing, staff, outlets) {
  const isEdit = !!existing;
  const opsiOutlet = [
    { value: '', label: 'Pribadi — hanya pemegangnya' },
    ...outlets.map((o) => ({
      value: o.id,
      label: `Kas outlet ${o.name}${o.business_unit_name ? ` (${o.business_unit_name})` : ''}`
    }))
  ];

  const values = await formDialog({
    title: isEdit ? `Kantong Kas — ${existing.holder_name}` : 'Tambah Kantong Kas',
    description: isEdit
      ? 'Kantong tidak bisa dipindahkan ke pemegang lain; memindahkannya berarti memindahkan riwayat uangnya tanpa satu pun entri yang mencatatnya. Pakai Transfer.'
      : 'Pilih pemegangnya, lalu namai sesuai peruntukannya — mis. "Kas Operasional Serpong".',
    fields: [
      // Saat mengedit, pemegangnya TIDAK dirender sama sekali — bukan dirender
      // lalu dimatikan. `formDialog` tidak mengenal `disabled`, jadi field yang
      // "dikunci" akan tampil biasa saja dan bisa diubah; penolakannya baru
      // datang dari server, setelah orangnya mengira sudah berhasil memindahkan.
      // Pemegangnya disebut di judul dialog.
      ...(isEdit
        ? []
        : [{ name: 'holder_id', label: 'Pemegang', type: 'select', required: true, options: staff.map((s) => ({ value: s.user_id, label: s.full_name })) }]),
      { name: 'name', label: 'Nama kantong', type: 'text', required: true, value: existing?.name ?? '', placeholder: 'mis. Kas Operasional' },
      { name: 'outlet_id', label: 'Dipakai untuk outlet', type: 'select', value: existing?.outlet_id ?? '', options: opsiOutlet, help: KET_OUTLET_KANTONG_ADMIN },
      ...(isEdit ? [{ name: 'is_active', label: 'Aktif', type: 'checkbox', value: existing.is_active }] : [])
    ],
    submitText: 'Simpan'
  });
  if (!values) return;

  // MENCABUT OUTLET DIKONFIRMASI. Akibatnya tidak terlihat di layar ini: staff
  // yang selama ini bisa mencatat nota dari kantong itu akan berhenti bisa, dan
  // yang ia lihat cuma pilihan kasnya menghilang tanpa sebab yang bisa ia
  // telusuri — lalu ia akan mencatatnya ke kasnya sendiri, persis masalah semula.
  if (isEdit && existing.outlet_id && !values.outlet_id) {
    const ok = await confirmDialog({
      title: 'Jadikan kantong pribadi?',
      message: `Staff di outlet ${esc(existing.outlet_name ?? 'itu')} tidak akan bisa lagi mencatat pengeluaran dari "${esc(existing.name)}" milik ${esc(existing.holder_name)}. Riwayat yang sudah ada tidak berubah.`,
      confirmText: 'Jadikan pribadi'
    });
    if (!ok) return;
  }

  try {
    // TULIS PENUH: keempat field selalu dikirim. RPC-nya tidak punya nilai
    // yang berarti "jangan sentuh", justru supaya pemanggil separuh-jadi
    // ketahuan seketika alih-alih diam-diam mengosongkan field yang tak disebut.
    await aturKantongKas({
      id: existing?.id ?? null,
      holderId: isEdit ? existing.holder_id : values.holder_id,
      name: values.name,
      outletId: values.outlet_id,
      isActive: isEdit ? values.is_active !== false : true
    });
    toast(isEdit ? 'Kantong kas diperbarui.' : 'Kantong kas ditambahkan.', 'success');
    await renderAccountsTab(content);
  } catch (error) {
    toast(error.message ?? 'Gagal menyimpan.', 'error');
  }
}

// ---- Tab: Kategori ----

async function renderCategoriesTab(content) {
  content.innerHTML = loadingHtml('Memuat…', { baris: 5 });
  let cats;
  try {
    cats = await listCashCategories(false);
  } catch (error) {
    content.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  content.innerHTML = `
    <div class="page-header">
      <h2 style="font-size:1.05rem;margin:0">Kategori Kas</h2>
      <button class="primary" id="btn-new-cat" style="max-width:180px">+ Tambah Kategori</button>
    </div>
    <table class="data-table" style="max-width:520px">
      <thead><tr><th>Nama</th><th>Arah</th><th>Status</th><th>Aksi</th></tr></thead>
      <tbody>
        ${cats
          .map(
            (c) => `<tr>
              <td>${esc(c.name)}</td>
              <td>${DIRECTIONS.find((d) => d.value === c.direction)?.label ?? c.direction}</td>
              <td>${c.is_active ? 'Aktif' : 'Nonaktif'}</td>
              <td>
                <button class="btn-edit-cat" data-json='${escAttr(JSON.stringify(c))}'>Edit</button>
                <button class="btn-del-cat" data-id="${c.id}">Hapus</button>
              </td>
            </tr>`
          )
          .join('') || '<tr><td colspan="4">Belum ada kategori.</td></tr>'}
      </tbody>
    </table>
  `;
  document.getElementById('btn-new-cat').addEventListener('click', () => openCatDialog(content, null));
  content.querySelectorAll('.btn-edit-cat').forEach((btn) => btn.addEventListener('click', () => openCatDialog(content, JSON.parse(btn.dataset.json))));
  content.querySelectorAll('.btn-del-cat').forEach((btn) =>
    btn.addEventListener('click', sekaliJalan(async () => {
      const ok = await confirmDialog({ title: 'Hapus kategori?', confirmText: 'Hapus', danger: true });
      if (!ok) return;
      try {
        await deleteCashCategory(btn.dataset.id);
        toast('Kategori dihapus.', 'success');
        await renderCategoriesTab(content);
      } catch (error) {
        toast(error.message ?? 'Gagal menghapus.', 'error');
      }
    }))
  );
}

async function openCatDialog(content, existing) {
  const isEdit = !!existing;
  const values = await formDialog({
    title: isEdit ? 'Edit Kategori Kas' : 'Tambah Kategori Kas',
    fields: [
      { name: 'name', label: 'Nama Kategori', type: 'text', required: true, value: existing?.name ?? '', placeholder: 'mis. Belanja Bahan' },
      { name: 'direction', label: 'Berlaku untuk', type: 'select', required: true, value: existing?.direction ?? 'both', options: DIRECTIONS },
      ...(isEdit ? [{ name: 'is_active', label: 'Aktif', type: 'checkbox', value: existing.is_active }] : [])
    ],
    submitText: 'Simpan'
  });
  if (!values) return;
  try {
    if (isEdit) await updateCashCategory(existing.id, { name: values.name, direction: values.direction, is_active: values.is_active });
    else await createCashCategory({ name: values.name, direction: values.direction });
    toast(isEdit ? 'Kategori diperbarui.' : 'Kategori ditambahkan.', 'success');
    await renderCategoriesTab(content);
  } catch (error) {
    toast(error.message ?? 'Gagal menyimpan.', 'error');
  }
}

function fmtDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escAttr(s) {
  return esc(s);
}
