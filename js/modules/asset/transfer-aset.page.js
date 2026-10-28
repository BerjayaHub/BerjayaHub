import { toast, confirmDialog, formDialog, shareDialog, escapeHtml as esc } from '../../core/ui.js';
import { formatNum } from '../../core/format.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { exportTablePDF } from '../../core/pdf.js';
import { listMyOutlets } from '../../core/my-outlets.js';
import {
  listAssets,
  listOutletTujuan,
  kirimTransferAset,
  batalkanTransferAset,
  listTransferAset
} from './asset.service.js';
import { barisPdfTransfer, ringkasTransfer, tanggalSurat, transferWaText } from './pesan-transfer-aset.js';

/**
 * TRANSFER ASET — Staff App & Admin Portal.
 *
 * ============ BEDANYA DENGAN PENGIRIMAN BAHAN ============
 *
 * Tidak ada langkah terima. Stok asal berkurang dan stok tujuan bertambah
 * pada detik Kirim ditekan.
 *
 * Itu membuat layar ini lebih berbahaya daripada kelihatannya: tidak ada
 * siapa pun di seberang yang akan menghitung ulang dan menolak. Karena itu
 * ringkasan sebelum kirim menyebutkan dengan angka apa yang akan berpindah,
 * dan tujuannya ditulis apa adanya — termasuk saat tujuannya di luar sistem.
 */
export async function renderTransferAsetPage(container, { businessUnitId, outletId, isAdmin = false }) {
  container.innerHTML = loadingHtml('Memuat transfer aset…');

  let outletSaya, outletTujuan;
  try {
    [outletSaya, outletTujuan] = await Promise.all([listMyOutlets(businessUnitId), listOutletTujuan()]);
  } catch (error) {
    container.innerHTML = `<p class="error-text">Gagal memuat: ${esc(error.message ?? error)}</p>`;
    return;
  }
  if (!outletSaya.length) {
    container.innerHTML = `<h1>Transfer Aset</h1><p style="color:var(--color-text-muted)">Kamu belum punya outlet yang bisa mengirim.</p>`;
    return;
  }

  const hariIni = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const state = {
    outletId: outletSaya.some((o) => o.id === outletId) ? outletId : outletSaya[0].id,
    dari: hariIni().slice(0, 8) + '01',
    sampai: hariIni()
  };
  let riwayat = [];

  async function muat() {
    container.innerHTML = loadingHtml('Memuat…');
    try {
      riwayat = await listTransferAset({ outletId: state.outletId, dari: state.dari, sampai: state.sampai });
    } catch (error) {
      container.innerHTML = `<p class="error-text">Gagal memuat: ${esc(error.message ?? error)}</p>`;
      return;
    }
    gambar();
  }

  /** Bentuk data surat jalan — SATU sumber untuk WhatsApp dan PDF. */
  function suratDari(t) {
    return {
      kode: t.kode,
      tanggal: t.created_at,
      asal: t.asal?.name ?? '-',
      tujuanOutlet: t.tujuan?.name ?? '',
      tujuanLain: t.tujuan_lain ?? '',
      pembawa: t.pembawa,
      catatan: t.catatan ?? '',
      oleh: t.dikirim_by_nama ?? '',
      dibatalkan: Boolean(t.dibatalkan_at),
      alasanBatal: t.alasan_batal ?? '',
      items: (t.asset_transfer_item ?? []).map((i) => ({ kode: i.item_kode, nama: i.item_nama, qty: Number(i.qty) }))
    };
  }

  function gambar() {
    const namaOutlet = outletSaya.find((o) => o.id === state.outletId)?.name ?? '';

    container.innerHTML = `
      <div class="page-header">
        <h1>Transfer Aset</h1>
        <button id="tr-baru" class="btn-primary">+ Transfer barang</button>
      </div>

      <p style="margin:0 0 12px;color:var(--color-text-muted);font-size:0.85rem">
        Stok berpindah <strong>saat dikirim</strong> — tidak ada langkah terima di outlet tujuan.
      </p>

      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">
        <div class="field" style="margin:0">
          <label for="tr-outlet">Outlet saya</label>
          <select id="tr-outlet">
            ${outletSaya.map((o) => `<option value="${o.id}" ${o.id === state.outletId ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="margin:0"><label for="tr-dari">Dari</label><input id="tr-dari" type="date" value="${state.dari}"></div>
        <div class="field" style="margin:0"><label for="tr-sampai">Sampai</label><input id="tr-sampai" type="date" value="${state.sampai}"></div>
      </div>

      <h2 style="font-size:1rem">Riwayat surat jalan — ${esc(namaOutlet)}</h2>
      ${
        riwayat.length
          ? `<div class="table-scroll"><table class="data-table kartu-sempit">
               <thead><tr><th>No. SJ</th><th>Tanggal</th><th>Arah</th><th>Barang</th><th>Pembawa</th><th>Aksi</th></tr></thead>
               <tbody>
                 ${riwayat
                   .map((t) => {
                     const s = suratDari(t);
                     const r = ringkasTransfer(s);
                     const masuk = t.to_outlet_id === state.outletId;
                     return `<tr${t.dibatalkan_at ? ' style="opacity:.55"' : ''}>
                       <td data-label="No. SJ" style="font-family:monospace;font-size:0.78rem">${esc(t.kode)}${
                         t.dibatalkan_at ? '<br><span class="badge badge-rejected" style="font-size:0.6rem">DIBATALKAN</span>' : ''
                       }</td>
                       <td data-label="Tanggal" style="font-size:0.8rem">${esc(tanggalSurat(t.created_at))}</td>
                       <td data-label="Arah" style="font-size:0.82rem">${
                         masuk
                           ? `← masuk dari <strong>${esc(t.asal?.name ?? '-')}</strong>`
                           : `→ ${esc(r.tujuan)}`
                       }</td>
                       <td data-label="Barang" style="font-size:0.82rem">${r.jenis} jenis · ${formatNum(r.unit)} unit</td>
                       <td data-label="Pembawa" style="font-size:0.82rem">${esc(t.pembawa)}</td>
                       <td data-label="Aksi">
                         <button class="tr-wa" data-id="${t.id}">Bagikan</button>
                         <button class="tr-pdf" data-id="${t.id}">PDF</button>
                         ${
                           isAdmin && !t.dibatalkan_at && !masuk
                             ? `<button class="tr-batal" data-id="${t.id}">Batalkan</button>`
                             : ''
                         }
                       </td>
                     </tr>`;
                   })
                   .join('')}
               </tbody>
             </table></div>`
          : '<p style="color:var(--color-text-muted)">Belum ada transfer di rentang ini.</p>'
      }
    `;

    container.querySelector('#tr-outlet').addEventListener('change', (e) => {
      state.outletId = e.target.value;
      muat();
    });
    container.querySelector('#tr-dari').addEventListener('change', (e) => {
      state.dari = e.target.value;
      muat();
    });
    container.querySelector('#tr-sampai').addEventListener('change', (e) => {
      state.sampai = e.target.value;
      muat();
    });
    container.querySelector('#tr-baru').addEventListener('click', dialogTransfer);

    container.querySelectorAll('.tr-wa').forEach((b) =>
      b.addEventListener('click', () => {
        const t = riwayat.find((x) => x.id === b.dataset.id);
        if (!t) return;
        shareDialog({
          title: `Surat jalan ${t.kode}`,
          helper: 'Teks ini bisa langsung dikirim ke grup WhatsApp.',
          defaultMessage: transferWaText(suratDari(t))
        });
      })
    );

    container.querySelectorAll('.tr-pdf').forEach((b) =>
      b.addEventListener('click', sekaliJalan(async () => {
        const t = riwayat.find((x) => x.id === b.dataset.id);
        if (!t) return;
        const s = suratDari(t);
        const r = ringkasTransfer(s);
        await exportTablePDF({
          filename: `surat-jalan-${t.kode}`,
          title: `Surat Jalan Transfer Aset — ${t.kode}`,
          // Subjudulnya memuat fakta yang SAMA dengan pesan WhatsApp-nya.
          // Kertas di tangan supir dan pesan di HP harus mengatakan hal yang
          // sama; kalau keduanya disusun terpisah, yang menyimpang isinya.
          subtitle:
            `${tanggalSurat(t.created_at)} · Dari: ${s.asal} · Ke: ${r.tujuan} · Pembawa: ${s.pembawa}` +
            (s.dibatalkan ? ` · DIBATALKAN (${s.alasanBatal})` : ''),
          columns: [
            { header: 'No', width: 0.4 },
            { header: 'Kode', width: 0.9 },
            { header: 'Nama Barang', width: 3 },
            { header: 'Jumlah', width: 0.8, align: 'right' }
          ],
          rows: barisPdfTransfer(s),
          orientation: 'portrait'
        });
        toast('PDF surat jalan terunduh.', 'success');
      }))
    );

    container.querySelectorAll('.tr-batal').forEach((b) =>
      b.addEventListener('click', sekaliJalan(() => dialogBatal(riwayat.find((x) => x.id === b.dataset.id))))
    );
  }

  // -------------------------------------------------------------
  async function dialogTransfer() {
    let stok;
    try {
      stok = (await listAssets({ businessUnitId, outletId: state.outletId })).filter((a) => !a.belumDidata && a.qty > 0);
    } catch (error) {
      return toast(error.message ?? 'Gagal memuat daftar barang.', 'error');
    }
    if (!stok.length) {
      return toast('Belum ada barang berjumlah di atas nol di outlet ini.', 'warning');
    }

    const pilihan = [
      // "Lain-lain" ditaruh PALING BAWAH, bukan paling atas: ia pilihan
      // terakhir, dan menaruhnya di depan membuat orang memilihnya sebelum
      // mencari outlet yang sebenarnya ada.
      ...outletTujuan
        .filter((o) => o.id !== state.outletId)
        .map((o) => ({ value: o.id, label: `${o.name} — ${o.buNama}` })),
      { value: '__lain__', label: '⚠️ Lain-lain (di luar outlet)' }
    ];

    const nilai = await formDialog({
      title: `Transfer dari ${esc(outletSaya.find((o) => o.id === state.outletId)?.name ?? '')}`,
      fields: [
        {
          name: 'tujuan',
          label: 'Tujuan',
          type: 'searchselect',
          required: true,
          options: pilihan,
          placeholder: 'cari outlet…',
          help: 'Boleh outlet BU mana pun. Pilih "Lain-lain" kalau barangnya keluar dari semua outlet.'
        },
        {
          name: 'tujuan_lain',
          label: 'Tujuan lain-lain (wajib kalau memilih Lain-lain)',
          type: 'text',
          placeholder: 'mis. dipinjam untuk acara CSR / diserahkan ke vendor',
          // Barang yang keluar tanpa keterangan ke mana adalah barang yang
          // hilang dengan surat jalan.
          help: 'Tulis ke mana perginya — ini yang akan dicari orang kalau barangnya ditagih nanti.'
        },
        {
          name: 'pembawa',
          label: 'Nama pembawa barang (wajib)',
          type: 'text',
          required: true,
          placeholder: 'mis. Pak Joko — supir',
          // Tanpa penerima, pembawa adalah satu-satunya orang yang bisa
          // ditanya "barangnya ke mana".
          help: 'Tidak ada konfirmasi terima, jadi ini satu-satunya orang yang bisa ditanya kalau barangnya tidak sampai.'
        },
        { name: 'catatan', label: 'Catatan (opsional)', type: 'text' },
        {
          name: 'file',
          label: 'Foto serah terima (opsional)',
          type: 'photo',
          facing: 'environment',
          help: 'Ambil Foto membuka kamera langsung.'
        }
      ],
      submitText: 'Lanjut pilih barang'
    });
    if (!nilai) return;

    const keLain = nilai.tujuan === '__lain__';
    if (keLain && !nilai.tujuan_lain?.trim()) {
      return toast('Tujuan lain-lain wajib diisi — tulis ke mana barangnya pergi.', 'warning');
    }
    if (!keLain && nilai.tujuan_lain?.trim()) {
      // Dua tujuan sekaligus akan ditolak database; dicegat di sini supaya
      // pesannya menyebut apa yang harus dikerjakan, bukan nama constraint.
      return toast('Kamu memilih outlet TAPI juga mengisi tujuan lain-lain. Kosongkan salah satunya.', 'warning');
    }

    // Pemilihan barang: satu dialog berisi seluruh barang yang ADA di outlet,
    // dengan kotak jumlah masing-masing. Dikosongkan = tidak ikut dikirim.
    const isian = await formDialog({
      title: 'Barang yang dikirim',
      fields: stok.map((a) => ({
        name: `q_${a.itemId}`,
        label: `${a.kode} — ${a.name} (ada ${formatNum(a.qty)})`,
        type: 'number',
        min: 0,
        max: a.qty,
        placeholder: '0'
      })),
      submitText: 'Kirim'
    });
    if (!isian) return;

    const items = stok
      .map((a) => ({ itemId: a.itemId, nama: a.name, kode: a.kode, ada: a.qty, qty: Number(isian[`q_${a.itemId}`]) || 0 }))
      .filter((i) => i.qty > 0);

    if (!items.length) return toast('Belum ada barang yang diisi jumlahnya.', 'warning');
    const kelebihan = items.find((i) => i.qty > i.ada);
    if (kelebihan) {
      return toast(`"${kelebihan.nama}" cuma ada ${formatNum(kelebihan.ada)} di outlet ini.`, 'warning');
    }

    const tujuanNama = keLain
      ? `${nilai.tujuan_lain.trim()} (di luar outlet)`
      : (outletTujuan.find((o) => o.id === nilai.tujuan)?.name ?? '-');

    // ============ RINGKASAN SEBELUM KIRIM, DENGAN ANGKANYA ============
    //
    // Tidak ada penerima yang akan menolak. Ini satu-satunya kesempatan
    // melihat apa yang akan berpindah sebelum berpindah.
    const ok = await confirmDialog({
      title: 'Kirim sekarang?',
      messageHtml:
        `<p style="margin:0 0 8px">Ke <strong>${esc(tujuanNama)}</strong>, dibawa <strong>${esc(nilai.pembawa)}</strong>.</p>` +
        `<ul style="margin:0 0 8px;padding-left:18px;font-size:0.85rem">
           ${items.map((i) => `<li>${esc(i.kode)} ${esc(i.nama)} — <strong>${formatNum(i.qty)}</strong> dari ${formatNum(i.ada)}</li>`).join('')}
         </ul>` +
        (keLain
          ? '<p style="margin:0 0 8px;color:var(--color-danger)">Tujuannya di luar semua outlet, jadi jumlah ini akan HILANG dari catatan sistem.</p>'
          : '') +
        '<p style="margin:0;font-size:0.85rem;color:var(--color-text-muted)">Stok langsung berpindah — tidak ada konfirmasi terima di tujuan.</p>',
      confirmText: 'Kirim',
      danger: keLain
    });
    if (!ok) return;

    let hasil;
    try {
      hasil = await kirimTransferAset({
        dariOutletId: state.outletId,
        keOutletId: keLain ? null : nilai.tujuan,
        tujuanLain: keLain ? nilai.tujuan_lain : null,
        pembawa: nilai.pembawa,
        items,
        catatan: nilai.catatan,
        file: nilai.file
      });
    } catch (error) {
      return toast(error.message ?? 'Gagal mengirim.', 'error');
    }

    toast(`Terkirim. Surat jalan ${hasil.kode}.`, 'success');
    await muat();

    // Dialog bagikan dibuka SESUDAH tersimpan, dan hanya kalau tersimpan.
    const baru = riwayat.find((t) => t.kode === hasil.kode);
    if (baru) {
      await shareDialog({
        title: `Surat jalan ${hasil.kode}`,
        helper: 'Kirim ke grup WhatsApp supaya outlet tujuan tahu barangnya berangkat.',
        defaultMessage: transferWaText(suratDari(baru))
      });
    }
  }

  async function dialogBatal(t) {
    if (!t) return;
    const s = suratDari(t);
    const r = ringkasTransfer(s);
    const nilai = await formDialog({
      title: `Batalkan ${t.kode}?`,
      fields: [
        {
          name: 'alasan',
          label: 'Alasan pembatalan (wajib)',
          type: 'text',
          required: true,
          placeholder: 'mis. salah outlet tujuan',
          help: `${r.jenis} jenis · ${formatNum(r.unit)} unit akan ditarik kembali ke outlet asal.`
        }
      ],
      submitText: 'Batalkan surat jalan'
    });
    if (!nilai?.alasan?.trim()) return;
    try {
      await batalkanTransferAset(t.id, nilai.alasan);
      toast('Surat jalan dibatalkan, jumlahnya dikembalikan.', 'success');
      await muat();
    } catch (error) {
      toast(error.message ?? 'Gagal membatalkan.', 'error');
    }
  }

  await muat();
}
