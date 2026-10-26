import { toast, confirmDialog, formDialog, infoDialog, escapeHtml } from '../../core/ui.js';
import { formatRupiah } from '../../core/format.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { loadXLSX, exportTableXLSX } from '../../core/xlsx.js';
import { exportTablePDF } from '../../core/pdf.js';
import { listOutletsForBu } from '../organization/organization.service.js';
import {
  listSpareparts,
  listHargaOutlet,
  simpanSparepart,
  hapusSparepart,
  aturHargaOutlet,
  imporSparepart
} from './sparepart.service.js';
import { KOLOM_HARGA_BELI, KOLOM_HARGA_JUAL, susunRencanaImpor, peringatanRencana } from './impor-sparepart.js';

/**
 * MASTER SPAREPART & JASA — Admin Portal (BU bengkel).
 *
 * Modul ini TIDAK menyimpan stok. Ia hanya memastikan nama dan kode SKU sama
 * di semua outlet, dan menyimpan harga — satu harga dasar se-BU, plus harga
 * khusus per outlet bagi yang memerlukannya.
 */
export async function renderSparepartAdminPage(container, { businessUnitId }) {
  container.innerHTML = loadingHtml('Memuat master sparepart…');

  const state = { q: '', jenis: '', kategori: '', outletHarga: '', hanyaAktif: false };
  const rp = (v) => (v === null || v === undefined ? '<span style="color:var(--color-text-muted)">—</span>' : formatRupiah(v));
  let daftar = [];
  let hargaOutlet = new Map();
  let outlets = [];

  await muat();

  async function muat() {
    try {
      [daftar, hargaOutlet, outlets] = await Promise.all([
        listSpareparts(businessUnitId),
        listHargaOutlet(businessUnitId),
        listOutletsForBu(businessUnitId)
      ]);
    } catch (error) {
      container.innerHTML = `<p class="error-text">Gagal memuat: ${error.message ?? error}</p>`;
      return;
    }
    gambar();
  }

  /**
   * Harga yang BERLAKU di satu outlet, untuk salah satu sisi ('beli'/'jual').
   *
   * `??` bukan `||` — harga khusus Rp0 adalah harga, dan `||` akan
   * membuangnya kembali ke harga BU tanpa ada yang menyadarinya.
   *
   * Kedua sisi dinilai SENDIRI-SENDIRI: outlet boleh menimpa harga jualnya
   * saja dan tetap memakai harga beli BU. Menilainya sebagai satu paket akan
   * membuat harga beli ikut hilang begitu harga jualnya ditimpa.
   */
  function hargaBerlaku(s, outletId, sisi) {
    const dasar = sisi === 'beli' ? s.harga_beli : s.harga_jual;
    if (!outletId) return dasar ?? null;
    const khusus = hargaOutlet.get(s.id)?.get(outletId);
    return (sisi === 'beli' ? khusus?.beli : khusus?.jual) ?? dasar ?? null;
  }

  /** Apakah outlet ini menimpa sisi harga itu? */
  function adaKhusus(s, outletId, sisi) {
    if (!outletId) return false;
    const k = hargaOutlet.get(s.id)?.get(outletId);
    return (sisi === 'beli' ? k?.beli : k?.jual) !== null && (sisi === 'beli' ? k?.beli : k?.jual) !== undefined;
  }

  function tersaring() {
    const q = state.q.trim().toLowerCase();
    return daftar.filter((s) => {
      if (state.jenis && s.jenis !== state.jenis) return false;
      if (state.kategori && (s.kategori ?? '') !== state.kategori) return false;
      if (state.hanyaAktif && s.is_active === false) return false;
      if (!q) return true;
      // SKU ikut dicari. Orang bengkel menyebut barang lewat kodenya sama
      // seringnya dengan lewat namanya.
      return `${s.sku} ${s.name} ${s.merek ?? ''} ${s.kategori ?? ''}`.toLowerCase().includes(q);
    });
  }

  function gambar() {
    const kategoriAda = [...new Set(daftar.map((s) => s.kategori).filter(Boolean))].sort();
    const baris = tersaring();
    const outletNama = outlets.find((o) => o.id === state.outletHarga)?.name ?? '';

    container.innerHTML = `
      <div class="page-header">
        <h1>Sparepart &amp; Jasa</h1>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button id="sp-tambah" class="btn-primary">+ Tambah</button>
          <button id="sp-impor">Impor Excel (Turboly)</button>
          <button id="sp-xlsx">Export Excel</button>
          <button id="sp-pdf">Export PDF</button>
        </div>
      </div>

      <p style="margin:0 0 10px;color:var(--color-text-muted);font-size:0.85rem">
        Master ini TIDAK menyimpan stok. Gunanya menyamakan nama &amp; kode SKU antar outlet, dan menyimpan harga.
      </p>

      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">
        <div class="field" style="margin:0;min-width:220px">
          <label for="sp-q">Cari nama / SKU / merek</label>
          <input id="sp-q" type="search" value="${escapeHtml(state.q)}" placeholder="mis. RACK END atau 555.LTR">
        </div>
        <div class="field" style="margin:0">
          <label for="sp-jenis">Jenis</label>
          <select id="sp-jenis">
            <option value="">Semua</option>
            <option value="sparepart" ${state.jenis === 'sparepart' ? 'selected' : ''}>Sparepart</option>
            <option value="jasa" ${state.jenis === 'jasa' ? 'selected' : ''}>Jasa</option>
          </select>
        </div>
        <div class="field" style="margin:0">
          <label for="sp-kategori">Kategori</label>
          <select id="sp-kategori">
            <option value="">Semua</option>
            ${kategoriAda.map((k) => `<option value="${escapeHtml(k)}" ${state.kategori === k ? 'selected' : ''}>${escapeHtml(k)}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="margin:0">
          <label for="sp-outlet">Harga outlet</label>
          <select id="sp-outlet">
            <option value="">Harga dasar BU</option>
            ${outlets.map((o) => `<option value="${o.id}" ${state.outletHarga === o.id ? 'selected' : ''}>${escapeHtml(o.name)}</option>`).join('')}
          </select>
        </div>
        <label style="display:flex;gap:6px;align-items:center;font-size:0.85rem">
          <input id="sp-aktif" type="checkbox" ${state.hanyaAktif ? 'checked' : ''}> Hanya yang aktif
        </label>
      </div>

      <p style="margin:0 0 8px;font-size:0.85rem;color:var(--color-text-muted)">
        ${baris.length} dari ${daftar.length} baris${state.outletHarga ? ` &middot; menampilkan harga <strong>${escapeHtml(outletNama)}</strong>` : ''}
      </p>

      <table class="data-table">
        <thead>
          <tr>
            <th>SKU</th><th>Nama</th><th>Jenis</th><th>Kategori</th><th>Merek</th>
            <th>Harga beli</th><th>Harga jual</th>
            <th>Status</th><th>Aksi</th>
          </tr>
        </thead>
        <tbody>
          ${
            baris.length
              ? baris
                  .slice(0, 500)
                  .map((s) => barisHtml(s))
                  .join('')
              : '<tr><td colspan="9" style="color:var(--color-text-muted)">Tidak ada yang cocok.</td></tr>'
          }
        </tbody>
      </table>
      ${
        // Daftar ini bisa 1.926 baris. Menggambar semuanya membuat layar
        // tersendat berdetik-detik di HP; yang dipotong DIKATAKAN, supaya tidak
        // ada yang mengira sisanya hilang dari master.
        baris.length > 500
          ? `<p style="color:var(--color-text-muted);font-size:0.85rem">Menampilkan 500 baris pertama dari ${baris.length}. Pakai kotak cari untuk mempersempit — seluruh ${daftar.length} baris tetap ikut saat Export.</p>`
          : ''
      }
    `;

    pasangAksi();
  }

  function barisHtml(s) {
    const sel = (sisi) =>
      `<td>${rp(hargaBerlaku(s, state.outletHarga, sisi))}${
        adaKhusus(s, state.outletHarga, sisi)
          ? ' <span class="badge badge-pending" style="font-size:0.6rem">khusus</span>'
          : ''
      }</td>`;
    return `
      <tr${s.is_active === false ? ' style="opacity:.55"' : ''}>
        <td style="font-family:monospace;font-size:0.8rem">${escapeHtml(s.sku)}</td>
        <td>${escapeHtml(s.name)}</td>
        <td>${s.jenis === 'jasa' ? '<span class="badge badge-pending">Jasa</span>' : 'Sparepart'}</td>
        <td>${escapeHtml(s.kategori ?? '')}</td>
        <td>${escapeHtml(s.merek ?? '')}</td>
        ${sel('beli')}
        ${sel('jual')}
        <td>${s.is_active === false ? 'Nonaktif' : 'Aktif'}</td>
        <td>
          <button class="sp-edit" data-id="${s.id}">Edit</button>
          ${state.outletHarga ? `<button class="sp-harga" data-id="${s.id}">Harga outlet</button>` : ''}
          <button class="sp-hapus" data-id="${s.id}">Hapus</button>
        </td>
      </tr>`;
  }

  function pasangAksi() {
    const q = container.querySelector('#sp-q');
    // `input`, bukan `change`: pencarian yang baru bekerja setelah kotaknya
    // ditinggalkan terasa rusak di daftar sebesar ini.
    q.addEventListener('input', () => {
      state.q = q.value;
      gambar();
      const baru = container.querySelector('#sp-q');
      baru.focus();
      baru.setSelectionRange(baru.value.length, baru.value.length);
    });
    container.querySelector('#sp-jenis').addEventListener('change', (e) => {
      state.jenis = e.target.value;
      gambar();
    });
    container.querySelector('#sp-kategori').addEventListener('change', (e) => {
      state.kategori = e.target.value;
      gambar();
    });
    container.querySelector('#sp-outlet').addEventListener('change', (e) => {
      state.outletHarga = e.target.value;
      gambar();
    });
    container.querySelector('#sp-aktif').addEventListener('change', (e) => {
      state.hanyaAktif = e.target.checked;
      gambar();
    });

    container.querySelector('#sp-tambah').addEventListener('click', () => dialogSparepart(null));
    container.querySelectorAll('.sp-edit').forEach((b) =>
      b.addEventListener('click', () => dialogSparepart(daftar.find((s) => s.id === b.dataset.id)))
    );
    container.querySelectorAll('.sp-harga').forEach((b) =>
      b.addEventListener('click', () => dialogHargaOutlet(daftar.find((s) => s.id === b.dataset.id)))
    );
    container.querySelectorAll('.sp-hapus').forEach((b) =>
      b.addEventListener(
        'click',
        sekaliJalan(async () => {
          const s = daftar.find((x) => x.id === b.dataset.id);
          const ok = await confirmDialog({
            title: 'Hapus sparepart?',
            message: `"${s.name}" (${s.sku}) akan dihapus beserta harga khusus outletnya. Kalau cuma mau menyembunyikannya dari daftar, pilih Edit lalu matikan "Aktif" — itu bisa dibatalkan, ini tidak.`,
            confirmText: 'Hapus'
          });
          if (!ok) return;
          try {
            await hapusSparepart(s.id);
            toast('Terhapus.', 'success');
            await muat();
          } catch (error) {
            toast(error.message ?? 'Gagal menghapus.', 'error');
          }
        })
      )
    );

    container.querySelector('#sp-impor').addEventListener('click', dialogImpor);
    container.querySelector('#sp-xlsx').addEventListener('click', sekaliJalan(eksporXlsx));
    container.querySelector('#sp-pdf').addEventListener('click', sekaliJalan(eksporPdf));
  }

  // -------------------------------------------------------------
  async function dialogSparepart(existing) {
    const values = await formDialog({
      title: existing ? 'Edit Sparepart / Jasa' : 'Tambah Sparepart / Jasa',
      fields: [
        { name: 'sku', label: 'Kode SKU', type: 'text', required: true, value: existing?.sku ?? '', help: 'Kode inilah yang menyamakan barang antar outlet — dan yang dipakai impor Excel untuk mencocokkan.' },
        { name: 'name', label: 'Nama', type: 'text', required: true, value: existing?.name ?? '' },
        {
          name: 'jenis',
          label: 'Jenis',
          type: 'select',
          value: existing?.jenis ?? 'sparepart',
          options: [
            { value: 'sparepart', label: 'Sparepart (barang)' },
            { value: 'jasa', label: 'Jasa' }
          ]
        },
        { name: 'kategori', label: 'Kategori (opsional)', type: 'text', value: existing?.kategori ?? '' },
        { name: 'merek', label: 'Merek (opsional)', type: 'text', value: existing?.merek ?? '' },
        {
          name: 'harga_beli',
          label: 'Harga beli BU (opsional)',
          type: 'number',
          value: existing?.harga_beli ?? '',
          help: 'Dikosongkan = belum ada harga. Bukan berarti gratis.'
        },
        {
          name: 'harga_jual',
          label: 'Harga jual BU (opsional)',
          type: 'number',
          value: existing?.harga_jual ?? '',
          help: 'Outlet bisa menimpanya lewat "Harga outlet".'
        },
        { name: 'is_active', label: 'Aktif', type: 'checkbox', value: existing ? existing.is_active !== false : true }
      ],
      submitText: 'Simpan'
    });
    if (!values) return;
    try {
      await simpanSparepart({ id: existing?.id, business_unit_id: businessUnitId, ...values });
      toast('Tersimpan.', 'success');
      await muat();
    } catch (error) {
      toast(error.message ?? 'Gagal menyimpan.', 'error');
    }
  }

  async function dialogHargaOutlet(s) {
    const outletNama = outlets.find((o) => o.id === state.outletHarga)?.name ?? '';
    const k = hargaOutlet.get(s.id)?.get(state.outletHarga);
    const ketBu = (v) => (v === null || v === undefined ? 'belum diisi' : formatRupiah(v));
    const values = await formDialog({
      title: `Harga ${outletNama}`,
      fields: [
        {
          name: 'hargaBeli',
          label: `Harga beli di ${outletNama}`,
          type: 'number',
          value: k?.beli ?? '',
          // Kosong dan nol adalah dua hal berbeda, dan layarnya harus
          // mengatakannya: kosong = ikut harga BU, nol = memang gratis.
          help: `Kosongkan untuk mengikuti harga BU (${ketBu(s.harga_beli)}). Isi 0 kalau memang gratis di outlet ini.`
        },
        {
          name: 'hargaJual',
          label: `Harga jual di ${outletNama}`,
          type: 'number',
          value: k?.jual ?? '',
          help: `Kosongkan untuk mengikuti harga BU (${ketBu(s.harga_jual)}).`
        }
      ],
      submitText: 'Simpan'
    });
    if (!values) return;
    try {
      await aturHargaOutlet({
        sparepartId: s.id,
        outletId: state.outletHarga,
        hargaBeli: values.hargaBeli,
        hargaJual: values.hargaJual
      });
      toast('Harga outlet disimpan.', 'success');
      await muat();
    } catch (error) {
      toast(error.message ?? 'Gagal menyimpan harga.', 'error');
    }
  }

  // -------------------------------------------------------------
  // IMPOR: BACA → PERINGATKAN → baru boleh ditekan
  // -------------------------------------------------------------
  async function dialogImpor() {
    const pilih = await formDialog({
      title: 'Impor master dari Excel Turboly',
      fields: [
        {
          name: 'file',
          label: 'Berkas Product List (.xlsx) dari Turboly',
          type: 'file',
          required: true,
          accept: '.xlsx,.xls',
          // TIDAK ADA LAGI YANG PERLU DIPILIH.
          //
          // Versi sebelumnya menyuruh memilih satu kolom harga. Itu keliru:
          // berkasnya memuat keduanya, dan memilih berarti membuang setengah
          // datanya tiap impor — tanpa terlihat hilang, karena kolomnya tetap
          // terisi angka yang masuk akal.
          help: `Harga beli ("${KOLOM_HARGA_BELI}") dan harga jual ("${KOLOM_HARGA_JUAL}") masuk sekaligus.`
        }
      ],
      submitText: 'Baca berkas'
    });
    if (!pilih?.file) return;

    let rencana;
    try {
      const XLSX = await loadXLSX();
      const wb = XLSX.read(await pilih.file.arrayBuffer(), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      rencana = susunRencanaImpor({ aoa, sparepartSekarang: daftar });
    } catch (error) {
      toast(`Gagal membaca berkas: ${error.message ?? error}`, 'error');
      return;
    }

    const peringatan = peringatanRencana(rencana);
    if (!rencana.ok) {
      await infoDialog({ title: 'Berkas tidak bisa dipakai', bodyHtml: `<p>${escapeHtml(rencana.sebab)}</p>` });
      return;
    }

    const warna = { bahaya: 'var(--color-danger)', awas: 'var(--color-warning, #b26a00)', kabar: 'var(--color-text-muted)' };
    const contoh = (judul, baris, gambarBaris) =>
      baris.length
        ? `<details style="margin:4px 0"><summary style="cursor:pointer">${judul} (${baris.length})</summary>
             <ul style="margin:6px 0 0;padding-left:18px;font-size:0.8rem;max-height:160px;overflow:auto">
               ${baris.slice(0, 50).map(gambarBaris).join('')}
             </ul>
             ${baris.length > 50 ? `<p style="font-size:0.75rem;color:var(--color-text-muted)">…dan ${baris.length - 50} lagi.</p>` : ''}
           </details>`
        : '';

    const ok = await confirmDialog({
      title: 'Periksa dulu sebelum mengimpor',
      messageHtml: `
        <div style="max-height:52vh;overflow:auto">
          <p style="margin:0 0 8px">Harga beli &amp; harga jual diambil sekaligus dari kolom
            <strong>${escapeHtml(KOLOM_HARGA_BELI)}</strong> dan <strong>${escapeHtml(KOLOM_HARGA_JUAL)}</strong>.</p>
          <ul style="margin:0 0 10px;padding-left:18px">
            ${peringatan.map((p) => `<li style="color:${warna[p.tingkat]};margin-bottom:4px">${escapeHtml(p.teks)}</li>`).join('')}
          </ul>
          ${contoh('Harga tidak bisa dipastikan', rencana.hargaRagu, (b) => `<li>baris ${b.baris} — ${escapeHtml(b.sku)}, kolom ${escapeHtml(b.kolom)}: "${escapeHtml(b.isi)}"</li>`)}
          ${contoh('SKU kembar di berkas', rencana.kembar, (b) => `<li>baris ${b.baris} diabaikan, dipakai baris ${b.digantiBaris} — ${escapeHtml(b.sku)}</li>`)}
          ${contoh(
            'Akan ditimpa',
            rencana.ditimpa,
            (b) =>
              `<li>${escapeHtml(b.sku)}: "${escapeHtml(b.namaLama)}" → "${escapeHtml(b.name)}" ` +
              `<span style="color:var(--color-text-muted)">(beli ${b.hargaBeliLama ?? '—'} → ${b.harga_beli ?? '—'}, ` +
              `jual ${b.hargaJualLama ?? '—'} → ${b.harga_jual ?? '—'})</span></li>`
          )}
          ${contoh('Ditolak', rencana.ditolak, (b) => `<li>baris ${b.baris} — ${escapeHtml(b.sebab)}</li>`)}
          ${contoh('Ditebak sebagai Jasa', rencana.dugaanJasa, (b) => `<li>${escapeHtml(b.sku)} — ${escapeHtml(b.name)}</li>`)}
          ${contoh('Jenisnya beda dari yang tersimpan', rencana.jenisBeda, (b) => `<li>${escapeHtml(b.sku)}: berkas "${b.diBerkas}", tersimpan "${b.tersimpan}" (yang tersimpan dipakai)</li>`)}
          ${contoh('Terdaftar tapi tidak ada di berkas (dibiarkan)', rencana.tidakDiBerkas, (s) => `<li>${escapeHtml(s.sku)} — ${escapeHtml(s.name)}${s.jenis === 'jasa' ? ' (jasa)' : ''}</li>`)}
        </div>`,
      confirmText: `Impor ${rencana.kirim.length} baris`,
      cancelText: 'Batal'
    });
    if (!ok) return;

    try {
      const hasil = await imporSparepart(businessUnitId, rencana.kirim);
      toast(`Impor selesai: ${hasil.baru} baru, ${hasil.diperbarui} diperbarui, ${hasil.dilewati} dilewati.`, 'success');
      await muat();
    } catch (error) {
      toast(error.message ?? 'Gagal mengimpor.', 'error');
    }
  }

  // -------------------------------------------------------------
  function kolomEkspor() {
    return [
      { key: 'sku', label: 'SKU', width: 1.2 },
      { key: 'name', label: 'Nama', width: 3 },
      { key: 'jenis', label: 'Jenis', width: 0.8 },
      { key: 'kategori', label: 'Kategori', width: 1.2 },
      { key: 'merek', label: 'Merek', width: 1.2 },
      { key: 'hargaBeli', label: 'Harga beli', width: 1.2, align: 'right' },
      { key: 'hargaJual', label: 'Harga jual', width: 1.2, align: 'right' },
      // Tanpa kolom ini, berkas ekspor tidak bisa menjawab "ini harga outlet
      // mana" — dan dua ekspor dari dua outlet jadi tidak bisa dibedakan isinya.
      { key: 'sumberHarga', label: 'Sumber harga', width: 1.4 },
      { key: 'status', label: 'Status', width: 0.8 }
    ];
  }

  /**
   * Yang DIEKSPOR adalah yang SEDANG TERSARING, bukan seluruh master.
   *
   * Dan judul berkasnya menyebutkan saringannya. Berkas bernama
   * "sparepart.xlsx" berisi 97 dari 1.926 baris adalah berkas yang akan
   * dikirim ke orang lain sebagai "daftar sparepart kami".
   */
  function barisEkspor() {
    return tersaring().map((s) => {
      const beli = hargaBerlaku(s, state.outletHarga, 'beli');
      const jual = hargaBerlaku(s, state.outletHarga, 'jual');
      const sumber = [];
      if (adaKhusus(s, state.outletHarga, 'beli')) sumber.push('beli: khusus outlet');
      if (adaKhusus(s, state.outletHarga, 'jual')) sumber.push('jual: khusus outlet');
      return {
        sku: s.sku,
        name: s.name,
        jenis: s.jenis === 'jasa' ? 'Jasa' : 'Sparepart',
        kategori: s.kategori ?? '',
        merek: s.merek ?? '',
        hargaBeli: beli === null ? '' : Number(beli),
        hargaJual: jual === null ? '' : Number(jual),
        sumberHarga: sumber.length ? sumber.join(', ') : 'harga BU',
        status: s.is_active === false ? 'Nonaktif' : 'Aktif'
      };
    });
  }

  function keteranganSaringan() {
    const bagian = [];
    if (state.q) bagian.push(`cari "${state.q}"`);
    if (state.jenis) bagian.push(`jenis ${state.jenis}`);
    if (state.kategori) bagian.push(`kategori ${state.kategori}`);
    if (state.hanyaAktif) bagian.push('hanya aktif');
    const outletNama = outlets.find((o) => o.id === state.outletHarga)?.name;
    bagian.push(outletNama ? `harga ${outletNama}` : 'harga dasar BU');
    return bagian.join(' · ');
  }

  async function eksporXlsx() {
    const rows = barisEkspor();
    if (!rows.length) return toast('Tidak ada baris untuk diekspor.', 'warning');
    await exportTableXLSX({
      filename: `sparepart-${new Date().toISOString().slice(0, 10)}`,
      sheetName: 'Sparepart',
      title: 'Master Sparepart & Jasa',
      subtitle: `${rows.length} baris — ${keteranganSaringan()}`,
      columns: kolomEkspor(),
      rows
    });
  }

  async function eksporPdf() {
    const rows = barisEkspor();
    if (!rows.length) return toast('Tidak ada baris untuk diekspor.', 'warning');
    await exportTablePDF({
      filename: `sparepart-${new Date().toISOString().slice(0, 10)}`,
      title: 'Master Sparepart & Jasa',
      subtitle: `${rows.length} baris — ${keteranganSaringan()}`,
      columns: kolomEkspor(),
      rows: rows.map((r) => ({
        ...r,
        hargaBeli: r.hargaBeli === '' ? '—' : formatRupiah(r.hargaBeli),
        hargaJual: r.hargaJual === '' ? '—' : formatRupiah(r.hargaJual)
      }))
    });
  }
}
