/**
 * Terima barang dari supplier — PER NOTA, di Staff App.
 *
 * BENTUKNYA SENGAJA MENGIKUTI ORDER: satu layar, banyak barang, satu tombol
 * simpan. Penerimaan lama menuntut satu dialog per produk — untuk nota berisi
 * belasan item itu belasan kali membuka dialog, memilih produk, mengetik
 * jumlah, menyimpan. Dan sesudahnya tidak ada satu pun tempat yang bisa
 * menjawab "nota nomor berapa isinya apa saja".
 *
 * Pemilih barangnya memakai `createItemPicker` yang sama dengan Order ke CK —
 * bukan salinan. Dua layar yang mengerjakan hal yang sama dengan dua kode
 * berbeda akan menyimpang, dan yang paling mungkin menyimpang justru cara
 * membaca angka jumlahnya.
 */

import { toast, infoDialog, formDialog } from '../../core/ui.js';
import { formatNum } from '../../core/format.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { todayWIB } from '../../core/dates.js';
import { createItemPicker } from '../dispatch/item-picker.js';
import { ringkasNota } from './biaya-rata.js';
import { formatRupiah } from '../../core/format.js';
import { simpanNota, ubahNota, riwayatNota, itemNota, unggahFotoNota, urlFotoNota } from './nota.service.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * @param {HTMLElement} wadah
 * @param {object} o
 * @param {string} o.businessUnitId
 * @param {string} o.outletId
 * @param {object[]} o.products bahan baku & setengah jadi
 */
export function renderNotaStaff(wadah, { businessUnitId, outletId, products }) {
  wadah.innerHTML = `
    <div class="inline-card fade-in" style="max-width:100%">
      <div class="page-header" style="margin-bottom:8px">
        <h3 style="margin:0;font-size:1rem">Terima dari Supplier</h3>
        <button id="nota-tutup">Tutup</button>
      </div>
      <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 10px">
        Satu nota bisa berisi banyak barang. Nomor terima dibuat otomatis setelah disimpan.
        <br />Foto nota boleh dikosongkan dulu dan ditambahkan belakangan lewat riwayat di bawah.
      </p>

      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <div class="field" style="margin:0;min-width:150px;flex:1 1 150px">
          <label>Tanggal nota</label>
          <input type="date" id="nota-tgl" value="${todayWIB()}" max="${todayWIB()}" />
        </div>
        <div class="field" style="margin:0;min-width:160px;flex:1 1 160px">
          <label>Supplier</label>
          <input type="text" id="nota-supplier" placeholder="mis. Toko Berkah" autocomplete="off" />
        </div>
        <div class="field" style="margin:0;min-width:150px;flex:1 1 150px">
          <label>No. nota supplier</label>
          <input type="text" id="nota-invoice" placeholder="opsional" autocomplete="off" />
        </div>
      </div>

      <div id="nota-picker" style="margin-top:8px"></div>

      <div class="field" style="margin-top:10px">
        <label>Foto nota (opsional)</label>
        <input type="file" id="nota-foto" accept="image/*" capture="environment" />
        <span class="field-help">Boleh dilewati kalau notanya belum ada — tambahkan nanti dari riwayat.</span>
      </div>
      <div class="field" style="margin-top:6px">
        <label>Catatan (opsional)</label>
        <input type="text" id="nota-catatan" placeholder="mis. sebagian barang menyusul" autocomplete="off" />
      </div>

      <div id="nota-total" class="nota-total"></div>

      <button class="primary" id="nota-simpan" style="max-width:220px;margin-top:6px">Simpan Nota</button>
      <p class="error-text" id="nota-error"></p>

      <h4 style="font-size:0.92rem;margin:18px 0 6px">Nota terakhir</h4>
      <div id="nota-riwayat">${loadingHtml('Memuat riwayat…', { baris: 2 })}</div>
    </div>`;

  const picker = createItemPicker(wadah.querySelector('#nota-picker'), {
    products,
    showStock: false,
    // Harga satuan menurut nota supplier. Dari sinilah biaya rata-rata bahan
    // per outlet dihitung (0118). Layar lain yang memakai picker ini —
    // order ke CK, transfer, retur — TIDAK menyalakannya: barangnya berpindah
    // antar outlet, bukan dibeli, dan harga yang ditebak di sana akan masuk ke
    // rata-rata seolah-olah pembelian sungguhan.
    hargaSatuan: true
  });
  const errorEl = wadah.querySelector('#nota-error');
  const totalEl = wadah.querySelector('#nota-total');

  /**
   * Total nota, dan berapa baris yang harganya belum diisi.
   *
   * Jumlah yang kosong disebut TERPISAH. Total yang terlihat wajar padahal
   * separuh barisnya belum berharga adalah angka yang paling mudah dipercaya
   * dan paling salah — dan orang yang mencocokkannya dengan tagihan supplier
   * akan menyimpulkan supplier-nya yang keliru.
   */
  function gambarTotal() {
    const r = ringkasNota(picker.getItems());
    if (!r.berharga && !r.tanpaHarga) {
      totalEl.innerHTML = '';
      return;
    }
    totalEl.innerHTML = `
      <span>Total nota: <strong>${formatRupiah(r.total)}</strong></span>
      ${
        r.tanpaHarga
          ? `<span class="nota-total-kurang">${r.tanpaHarga} barang belum diisi harganya — tidak ikut dihitung, dan tidak memengaruhi biaya rata-rata bahannya.</span>`
          : ''
      }`;
  }
  picker.onUbah(gambarTotal);
  gambarTotal();

  wadah.querySelector('#nota-tutup').addEventListener('click', () => {
    wadah.innerHTML = '';
    wadah.setAttribute('hidden', '');
  });

  wadah.querySelector('#nota-simpan').addEventListener(
    'click',
    sekaliJalan(async () => {
      errorEl.textContent = '';
      const items = picker.getItems();
      if (!items.length) {
        errorEl.textContent = 'Tambahkan minimal satu barang dengan jumlahnya.';
        return;
      }

      // FOTO DIUNGGAH DULU, notanya belakangan. Kalau urutannya dibalik dan
      // unggahannya gagal, nota sudah telanjur tersimpan tanpa foto dan tanpa
      // ada yang tahu bahwa fotonya pernah dipilih.
      let photoPath = null;
      const file = wadah.querySelector('#nota-foto').files?.[0] ?? null;
      try {
        if (file) photoPath = await unggahFotoNota(outletId, file);
      } catch (e) {
        errorEl.textContent = `${e.message ?? e} — notanya belum disimpan, coba lagi atau lewati fotonya.`;
        return;
      }

      try {
        await simpanNota({
          outletId,
          receiptDate: wadah.querySelector('#nota-tgl').value,
          supplier: wadah.querySelector('#nota-supplier').value,
          invoiceNo: wadah.querySelector('#nota-invoice').value,
          photoPath,
          notes: wadah.querySelector('#nota-catatan').value,
          items
        });
        toast(`Nota tersimpan — stok ${items.length} barang bertambah.`, 'success');
        renderNotaStaff(wadah, { businessUnitId, outletId, products });
      } catch (e) {
        errorEl.textContent = e.message ?? 'Gagal menyimpan nota.';
      }
    })
  );

  gambarRiwayat();

  async function gambarRiwayat() {
    const box = wadah.querySelector('#nota-riwayat');
    if (!box) return;
    let daftar = [];
    try {
      daftar = await riwayatNota(businessUnitId, { outletId });
    } catch (e) {
      box.innerHTML = `<p class="error-text">${esc(e.message ?? e)}</p>`;
      return;
    }
    const tampil = daftar.slice(0, 15);
    box.innerHTML = tampil.length
      ? `<div class="table-scroll"><table class="data-table kartu-sempit">
          <thead><tr><th>Nomor</th><th>Tanggal</th><th>Supplier</th><th>Nota</th><th>Aksi</th></tr></thead>
          <tbody>${tampil
            .map(
              (n) => `<tr>
                <td data-label="Nomor" style="font-family:ui-monospace,Menlo,monospace;font-size:0.8rem">${esc(n.code)}</td>
                <td data-label="Tanggal">${esc(n.receipt_date)}</td>
                <td data-label="Supplier">${esc(n.supplier ?? '-')}</td>
                <td data-label="Nota">${
                  n.photo_path
                    ? `<button class="nota-foto-lihat" data-path="${esc(n.photo_path)}">Lihat</button>`
                    : '<span style="color:var(--color-danger);font-size:0.8rem">belum ada</span>'
                }</td>
                <td data-label="Aksi">
                  <button class="nota-isi" data-id="${n.id}" data-code="${esc(n.code)}">Isi</button>
                  <button class="nota-edit" data-id="${n.id}" data-code="${esc(n.code)}">Edit</button>
                  <button class="nota-tambah-foto" data-id="${n.id}" data-code="${esc(n.code)}">${n.photo_path ? 'Ganti foto' : '+ Foto'}</button>
                </td>
              </tr>`
            )
            .join('')}</tbody>
        </table></div>`
      : '<p style="color:var(--color-text-muted);font-size:0.88rem">Belum ada nota di outlet ini.</p>';

    box.querySelectorAll('.nota-foto-lihat').forEach((b) =>
      b.addEventListener('click', async () => {
        const url = await urlFotoNota(b.dataset.path);
        if (!url) return toast('Foto tidak bisa dibuka.', 'error');
        await infoDialog({ title: 'Foto Nota', bodyHtml: `<img src="${url}" alt="Foto nota" style="max-width:100%;border-radius:8px" />` });
      })
    );

    box.querySelectorAll('.nota-isi').forEach((b) =>
      b.addEventListener(
        'click',
        sekaliJalan(async () => {
          const isi = await itemNota(b.dataset.id).catch(() => []);
          await infoDialog({
            title: `Nota ${b.dataset.code}`,
            bodyHtml: isi.length
              ? `<table class="data-table kartu-sempit"><thead><tr><th>Barang</th><th>Jumlah</th><th>Harga/satuan</th><th>Subtotal</th></tr></thead><tbody>${isi
                  .map(
                    (i) =>
                      `<tr><td data-label="Barang">${esc(i.products?.name ?? '-')}</td>` +
                      `<td data-label="Jumlah">${formatNum(i.qty)} ${esc(i.products?.base_unit ?? '')}</td>` +
                      `<td data-label="Harga/satuan">${
                        i.unit_cost == null
                          ? '<span style="color:var(--color-danger)">belum diisi</span>'
                          : formatRupiah(i.unit_cost)
                      }</td>` +
                      `<td data-label="Subtotal">${
                        i.unit_cost == null ? '-' : formatRupiah(Number(i.qty) * Number(i.unit_cost))
                      }</td></tr>`
                  )
                  .join('')}</tbody></table>` +
                (() => {
                  // Total & berapa baris yang belum berharga — persis seperti di
                  // form isian. Dua tempat yang menampilkan hal yang sama harus
                  // memakai perhitungan yang sama, kalau tidak orang akan
                  // menemukan dua total berbeda untuk satu nota.
                  const r = ringkasNota(isi);
                  return `<p style="margin:8px 0 0;font-size:0.86rem">Total nota: <strong>${formatRupiah(r.total)}</strong>${
                    r.tanpaHarga
                      ? `<br /><span class="nota-total-kurang">${r.tanpaHarga} barang belum diisi harganya — tekan <strong>Edit</strong> untuk melengkapinya.</span>`
                      : ''
                  }</p>`;
                })()
              : '<p>Nota ini tidak berisi barang.</p>'
          });
        })
      )
    );

    // ---- EDIT NOTA: pop up, sama bentuknya dengan "Isi" ----
    //
    // Nota yang sudah tersimpan tetap bisa diperbaiki, dan itu memang
    // diperlukan: harga sering baru diketahui belakangan (nota fisiknya
    // menyusul), dan jumlah bisa salah ketik.
    //
    // BARANGNYA TIDAK BISA DITAMBAH DI SINI, hanya diubah atau dinolkan. Itu
    // batas yang disengaja: menambah barang berarti nota fisiknya berbeda dari
    // yang tercatat, dan itu nota baru — bukan koreksi. Menyamarkannya sebagai
    // edit membuat satu nomor nota memuat dua kiriman yang berbeda.
    box.querySelectorAll('.nota-edit').forEach((b) =>
      b.addEventListener(
        'click',
        sekaliJalan(async () => {
          const nota = daftar.find((n) => n.id === b.dataset.id);
          let isi;
          try {
            isi = await itemNota(b.dataset.id);
          } catch (e) {
            toast(e.message ?? 'Isi nota gagal dimuat.', 'error');
            return;
          }
          if (!isi.length) {
            toast('Nota ini tidak berisi barang, jadi tidak ada yang bisa diubah.', 'warning');
            return;
          }

          // PICKER YANG SAMA DENGAN LAYAR BUAT NOTA — bukan salinan.
          //
          // Percobaan pertama membuat satu pasang field per barang lewat
          // `formDialog`: "Telur Ayam — jumlah", "Telur Ayam — harga per gr",
          // dan seterusnya, menurun. Untuk nota berisi enam barang itu dua
          // belas kotak bertumpuk, judulnya mengulang nama bahan yang sama dua
          // kali, dan di HP orangnya menggulir jauh hanya untuk memastikan
          // sudah mengisi semuanya.
          //
          // Dan bentuk itu tidak bisa MENAMBAH barang sama sekali — jumlah
          // fieldnya ditentukan saat dialog dibuka.
          //
          // `createItemPicker` sudah menjawab ketiganya: nama, jumlah, dan
          // harga berjajar dalam satu baris; ada "+ Tambah Produk"; dan pada
          // layar sempit barisnya membungkus sendiri (`@media 560px`) alih-alih
          // memaksa gulir ke samping.
          let picker = null;
          const nilai = await formDialog({
            title: `Edit Nota ${b.dataset.code}`,
            description:
              'Barang boleh ditambah, jumlahnya diubah, atau dihapus dengan tombol ✕. ' +
              'Harga boleh dikosongkan kalau memang belum tahu — yang kosong tidak ikut menghitung biaya rata-rata bahan.',
            fields: [
              { name: 'supplier', label: 'Supplier', type: 'text', value: nota?.supplier ?? '' },
              { name: 'invoice', label: 'No. Invoice', type: 'text', value: nota?.invoice_no ?? '' },
              { name: 'barang', label: 'Barang', type: 'html', html: '<div id="nota-edit-picker"></div>' }
            ],
            submitText: 'Simpan Perubahan',
            onReady: (form, { kumpulkan }) => {
              picker = createItemPicker(form.querySelector('#nota-edit-picker'), {
                products,
                showStock: false,
                hargaSatuan: true,
                initial: isi.map((i) => ({ product_id: i.product_id, qty: i.qty, unit_cost: i.unit_cost ?? '' }))
              });

              // Isinya dibaca SAAT SIMPAN DITEKAN, selagi dialognya masih
              // berdiri. Membacanya sesudah `await` kebetulan masih berhasil —
              // `close()` menunda pembongkaran DOM 200 ms untuk animasi — dan
              // bergantung pada jeda animasi adalah ketergantungan yang tidak
              // terlihat di kode mana pun.
              kumpulkan(() => {
                const items = picker.getItems();
                if (!items.length) {
                  return 'Nota harus berisi minimal satu barang. Kalau seluruhnya salah, hapus barangnya satu per satu lalu buat nota baru.';
                }
                // BARANG YANG DIHAPUS dari picker tidak ikut terkirim — dan
                // ketiadaannya itulah yang dibaca server sebagai "dibatalkan",
                // lalu dibuatkan pergerakan penyeimbang negatif (0084).
                //
                // Mengirimnya sebagai jumlah 0 justru DILEWATI server tanpa
                // efek apa pun: barangnya tetap ada, sementara orangnya sudah
                // melihatnya hilang dari layar.
                return { items };
              });
            }
          });
          if (!nilai) return;

          try {
            await ubahNota(b.dataset.id, {
              supplier: nilai.supplier,
              invoiceNo: nilai.invoice,
              items: nilai.items
            });
          } catch (e) {
            toast(e.message ?? 'Gagal menyimpan perubahan.', 'error');
            return;
          }
          toast(`Nota ${b.dataset.code} diperbarui.`, 'success');
          gambarRiwayat();
        })
      )
    );

    // MENAMBAH FOTO YANG MENYUSUL — jalur yang paling sering dipakai, dan
    // sengaja TIDAK menyentuh barangnya sama sekali (`items: null`). Mengirim
    // ulang daftar barang di sini akan menghasilkan pergerakan penyeimbang
    // untuk perubahan yang tidak pernah diminta siapa pun.
    box.querySelectorAll('.nota-tambah-foto').forEach((b) =>
      b.addEventListener(
        'click',
        sekaliJalan(async () => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.capture = 'environment';
          input.addEventListener('change', async () => {
            const f = input.files?.[0];
            if (!f) return;
            try {
              const path = await unggahFotoNota(outletId, f);
              await ubahNota(b.dataset.id, { photoPath: path, items: null });
              toast(`Foto nota ${b.dataset.code} tersimpan.`, 'success');
              gambarRiwayat();
            } catch (e) {
              toast(e.message ?? 'Gagal menyimpan foto.', 'error');
            }
          });
          input.click();
        })
      )
    );
  }
}

