/**
 * DIALOG: revisi Surat Jalan yang sudah diterima (0165).
 *
 * Dipakai CK maupun outlet tujuan, dari layar yang sama. Aturannya ada di
 * `revisi-kiriman.js` dan diuji tanpa DOM; berkas ini hanya menggambar dan
 * memanggil.
 */
import { formDialog, toast } from '../../core/ui.js';
import { formatNum } from '../../core/format.js';
import { getDispatchItems, revisiKirimanDiterima } from './dispatch.service.js';
import {
  alasanTakBisaRevisi,
  susunMuatanRevisi,
  akibatStok,
  pesanAkibat,
  bacaJejak,
  kalimatJejak
} from './revisi-kiriman.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * @param {object} o
 *   sj           baris `dispatches` yang sedang dibuka
 *   outletSaya   Set/Array outlet yang cakupannya dipegang pemakai
 *   produk       [{ id, name, base_unit }] untuk menambah barang baru
 *   onSelesai    dipanggil sesudah berhasil
 */
export async function bukaDialogRevisiKiriman({ sj, outletSaya, produk = [], onSelesai }) {
  // Ditolak di sini DAN di database. Yang di sini supaya orangnya tidak
  // mengisi dialog lebih dulu lalu ditolak server — pekerjaannya terbuang, dan
  // penolakannya terbaca seperti kerusakan.
  const tolak = alasanTakBisaRevisi(sj, outletSaya);
  if (tolak) return toast(tolak, 'warning');

  let baris;
  try {
    baris = await getDispatchItems(sj.id);
  } catch (e) {
    return toast(e.message ?? 'Gagal memuat isi kiriman.', 'error');
  }
  if (!baris.length) return toast('Kiriman ini tidak punya baris barang.', 'warning');

  const namaAsal = sj.from_outlet?.name ?? 'outlet asal';
  const namaTujuan = sj.to_outlet?.name ?? 'outlet tujuan';
  const sudahAda = new Set(baris.map((b) => b.product_id));
  const bisaDitambah = (produk ?? []).filter((p) => p && p.id && !sudahAda.has(p.id));

  const barisHtml = baris
    .map((b) => {
      // Tanpa peta nama: jejaknya membawa `by_nama` sendiri dari database
      // (0165), ditulis saat perubahan terjadi. Mencari nama belakangan
      // membuat seluruh riwayat staff yang sudah keluar berbunyi "pengguna
      // tak dikenal" — tepat pada catatan yang gunanya mempertanggungjawabkan
      // perubahan stok.
      const jejak = bacaJejak(b.revisi);
      return `
      <tr>
        <td style="font-size:0.84rem">
          ${esc(b.products?.name ?? '-')}
          <div style="font-size:0.72rem;color:var(--color-text-muted)">
            kirim ${esc(formatNum(b.sent_qty))} ${esc(b.products?.base_unit ?? '')}
          </div>
          ${
            jejak.length
              ? `<details style="margin-top:4px">
                   <summary style="font-size:0.72rem;cursor:pointer">${jejak.length} kali direvisi</summary>
                   <ul style="margin:4px 0 0;padding-left:16px;font-size:0.72rem;color:var(--color-text-muted)">
                     ${jejak.map((j) => `<li>${esc(kalimatJejak(j))}</li>`).join('')}
                   </ul>
                 </details>`
              : ''
          }
        </td>
        <td style="width:110px">
          <input type="text" inputmode="decimal" class="rv-terima qty-input"
                 data-pid="${esc(b.product_id)}" value="${esc(formatNum(b.received_qty ?? 0))}" />
        </td>
      </tr>`;
    })
    .join('');

  const hasil = await formDialog({
    title: `Revisi ${sj.code ?? 'surat jalan'}`,
    description:
      `Kiriman ini sudah diterima ${namaTujuan}, jadi stoknya sudah bergerak. ` +
      `Membetulkan jumlah diterima hanya menggeser stok ${namaTujuan} — stok ${namaAsal} tidak tersentuh, ` +
      `karena yang memotongnya adalah jumlah KIRIM yang tidak ikut berubah.\n\n` +
      `Menambah barang baru menggerakkan keduanya. Setiap perubahan dicatat beserta namamu.`,
    fields: [
      {
        name: 'tabel',
        label: 'Jumlah diterima',
        type: 'html',
        html: `<div class="table-scroll" style="max-height:48vh"><table class="data-table">
                 <thead><tr><th>Barang</th><th style="width:110px">Diterima</th></tr></thead>
                 <tbody>${barisHtml}</tbody>
               </table></div>`
      },
      ...(bisaDitambah.length
        ? [
            {
              name: 'tambah_produk',
              label: 'Tambah barang yang kelupaan ditulis (opsional)',
              type: 'searchselect',
              options: bisaDitambah.map((p) => ({ value: p.id, label: `${p.name} (${p.base_unit ?? '-'})` })),
              placeholder: 'cari nama barang'
            },
            { name: 'tambah_kirim', label: `Jumlah KIRIM barang baru (memotong stok ${namaAsal})`, type: 'qty', placeholder: '0' },
            { name: 'tambah_terima', label: `Jumlah DITERIMA barang baru (menambah stok ${namaTujuan})`, type: 'qty', placeholder: '0' }
          ]
        : []),
      {
        name: 'alasan',
        label: 'Alasan revisi',
        type: 'text',
        required: true,
        placeholder: 'mis. salah ketik saat cek, atau galon kelupaan ditulis'
      }
    ],
    submitText: 'Simpan revisi',
    danger: true
  });
  if (!hasil) return;

  const alasan = String(hasil.alasan ?? '').trim();
  if (!alasan) return toast('Sebutkan alasan revisinya — angka ini sudah menggerakkan stok dua outlet.', 'warning');

  // Dibaca dari DOM dialognya sendiri. `formDialog` tidak mengetahui isi field
  // bertipe `html`, jadi nilainya diambil langsung — pola yang sama dengan
  // layar Terima.
  const isian = [...document.querySelectorAll('.rv-terima')].map((el) => ({
    product_id: el.dataset.pid,
    received_qty: String(el.value ?? '').replace(/\./g, '').replace(',', '.')
  }));

  const pidBaru = String(hasil.tambah_produk ?? '').trim();
  if (pidBaru) {
    isian.push({
      product_id: pidBaru,
      received_qty: String(hasil.tambah_terima ?? '').replace(/\./g, '').replace(',', '.'),
      sent_qty: String(hasil.tambah_kirim ?? '').replace(/\./g, '').replace(',', '.')
    });
  }

  const { muatan, masalah } = susunMuatanRevisi(baris, isian);
  if (masalah.length) {
    const nama = (pid) => baris.find((b) => b.product_id === pid)?.products?.name ?? produk.find((p) => p.id === pid)?.name ?? pid;
    return toast(`${nama(masalah[0].product_id)}: ${masalah[0].pesan}`, 'warning');
  }
  if (!muatan.length) return toast('Tidak ada angka yang berubah.', 'warning');

  try {
    const r = await revisiKirimanDiterima(sj.id, muatan, alasan);
    const akibat = akibatStok(baris, muatan);
    toast(
      `Revisi tersimpan. ${pesanAkibat(akibat, { namaAsal, namaTujuan })}` +
        (r?.esb_dicabut ? ' Tanda ekspor ESB dicabut — kiriman ini ikut ekspor berikutnya.' : ''),
      'success'
    );
    if (typeof onSelesai === 'function') await onSelesai();
  } catch (e) {
    toast(e.message ?? 'Gagal menyimpan revisi.', 'error');
  }
}
