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

import { toast, infoDialog, formDialog, confirmDialog } from '../../core/ui.js';
import { formatNum } from '../../core/format.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { todayWIB } from '../../core/dates.js';
import { createItemPicker } from '../dispatch/item-picker.js';
import { ringkasNota, hargaBaris } from './biaya-rata.js';
import { formatRupiah } from '../../core/format.js';
import {
  simpanNota,
  ubahNota,
  riwayatNota,
  itemNota,
  unggahFotoNota,
  urlFotoNota,
  ringkasanNota,
  bayarNota,
  batalkanPembayaranNota,
  setJatuhTempoNota
} from './nota.service.js';
import { listKantongBisaKubebani } from '../cash/cash.service.js';
import { statusTempo, bolehDibayar, kelompokPerSupplier } from './hutang-nota.js';

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

      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">
        <div class="field" style="margin:0;min-width:150px;flex:1 1 150px">
          <label>Pembayaran</label>
          <select id="nota-bayar-cara">
            <option value="tempo">Tempo — bayar nanti</option>
            <option value="tunai">Tunai — langsung dari kas</option>
          </select>
        </div>
        <div class="field" id="nota-tempo-box" style="margin:0;min-width:150px;flex:1 1 150px">
          <label>Jatuh tempo (opsional)</label>
          <input type="date" id="nota-tempo" />
        </div>
        <div class="field" id="nota-kas-box" hidden style="margin:0;min-width:190px;flex:1 1 190px">
          <label>Bayar dari kas</label>
          <select id="nota-kas"><option value="">memuat…</option></select>
        </div>
      </div>
      <p class="field-help" id="nota-bayar-ket" style="margin:4px 0 0"></p>

      <button class="primary" id="nota-simpan" style="max-width:220px;margin-top:8px">Simpan Nota</button>
      <p class="error-text" id="nota-error"></p>

      <div class="tab-bar" style="margin-top:18px">
        <button class="tab-btn active" data-nota-tab="riwayat">Nota terakhir</button>
        <button class="tab-btn" data-nota-tab="hutang">Hutang Supplier</button>
      </div>
      <div id="nota-riwayat">${loadingHtml('Memuat riwayat…', { baris: 2 })}</div>
    </div>`;

  const picker = createItemPicker(wadah.querySelector('#nota-picker'), {
    products,
    showStock: false,
    // Harga beli per baris menurut nota supplier — angka yang tertulis di
    // kertasnya, bukan hasil bagi per satuan. Dari sinilah biaya rata-rata
    // bahan per outlet dihitung (0118/0123). Layar lain yang memakai picker —
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

  // ---- TUNAI vs TEMPO ----
  //
  // Defaultnya TEMPO, dan itu bukan pilihan sembarangan: nota yang tersimpan
  // tanpa mengurangi kas hanya membuat hutang yang bisa dilunasi belakangan,
  // sementara nota yang salah ditandai tunai sudah terlanjur memotong kas
  // orang lain. Yang pertama diperbaiki dengan menekan Bayar; yang kedua harus
  // dibatalkan, dan pembatalan meninggalkan dua baris di buku kas selamanya.
  const caraEl = wadah.querySelector('#nota-bayar-cara');
  const kasBox = wadah.querySelector('#nota-kas-box');
  const tempoBox = wadah.querySelector('#nota-tempo-box');
  const kasEl = wadah.querySelector('#nota-kas');
  const ketBayar = wadah.querySelector('#nota-bayar-ket');
  let kantongSiap = false;

  const KET_TEMPO =
    'Stok bertambah sekarang, kas belum berkurang. Notanya masuk ke tab Hutang Supplier di bawah, ' +
    'dan bisa dilunasi bersama nota lain dari supplier yang sama.';
  const KET_TUNAI =
    'Kas berkurang begitu nota disimpan. Semua barang harus sudah ada harganya — kalau ada yang kosong, ' +
    'kas cuma berkurang sebesar sebagian isinya dan selisihnya tidak akan muncul sebagai error.';

  async function muatKantong() {
    if (kantongSiap) return;
    try {
      const daftar = await listKantongBisaKubebani(outletId);
      kasEl.innerHTML = daftar.length
        ? daftar.map((k) => `<option value="${k.id}">${esc(k.name)}${k.outlets?.name ? ` — ${esc(k.outlets.name)}` : ''}</option>`).join('')
        : '<option value="">tidak ada kas yang bisa kamu bebani</option>';
      kantongSiap = true;
    } catch (e) {
      kasEl.innerHTML = '<option value="">gagal memuat daftar kas</option>';
      ketBayar.textContent = `Daftar kas gagal dimuat: ${e.message ?? e}. Simpan sebagai tempo dulu, lalu bayar dari tab Hutang Supplier.`;
    }
  }

  function gambarCara() {
    const tunai = caraEl.value === 'tunai';
    kasBox.hidden = !tunai;
    tempoBox.hidden = tunai;
    ketBayar.textContent = tunai ? KET_TUNAI : KET_TEMPO;
    if (tunai) muatKantong();
  }
  caraEl.addEventListener('change', gambarCara);
  gambarCara();

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

      const tunai = caraEl.value === 'tunai';
      const akun = tunai ? kasEl.value : '';
      if (tunai && !akun) {
        errorEl.textContent = 'Pilih dulu kas yang membayarnya, atau ubah pembayarannya jadi Tempo.';
        return;
      }
      // Diperiksa DI SINI, sebelum notanya lahir. Kalau dibiarkan sampai
      // server, notanya sudah tersimpan sementara pembayarannya ditolak — dan
      // orangnya menghadapi setengah pekerjaan yang tidak ia minta.
      if (tunai && items.some((i) => i.line_total === null || i.line_total === undefined || i.line_total === '')) {
        errorEl.textContent =
          'Masih ada barang tanpa harga. Isi harganya dulu, atau simpan sebagai Tempo lalu lunasi setelah harganya lengkap.';
        return;
      }

      let notaId;
      try {
        notaId = await simpanNota({
          outletId,
          receiptDate: wadah.querySelector('#nota-tgl').value,
          supplier: wadah.querySelector('#nota-supplier').value,
          invoiceNo: wadah.querySelector('#nota-invoice').value,
          photoPath,
          notes: wadah.querySelector('#nota-catatan').value,
          items
        });
      } catch (e) {
        errorEl.textContent = e.message ?? 'Gagal menyimpan nota.';
        return;
      }

      // NOTANYA SUDAH ADA MULAI DARI SINI.
      //
      // Apa pun yang gagal setelah titik ini TIDAK boleh dilaporkan sebagai
      // "gagal menyimpan nota" — notanya tersimpan, stoknya sudah bertambah,
      // dan orang yang mengira gagal akan menginputnya untuk kedua kalinya.
      try {
        if (tunai) {
          await bayarNota({ notaIds: [notaId], accountId: akun, date: todayWIB() });
          toast(`Nota tersimpan & dibayar — stok ${items.length} barang bertambah.`, 'success');
        } else {
          const due = wadah.querySelector('#nota-tempo').value;
          if (due) await setJatuhTempoNota(notaId, due);
          toast(`Nota tersimpan — stok ${items.length} barang bertambah, masuk hutang supplier.`, 'success');
        }
      } catch (e) {
        toast(
          `Nota TERSIMPAN dan stoknya sudah bertambah, tapi ${tunai ? 'pembayarannya' : 'jatuh temponya'} gagal: ` +
            `${e.message ?? e}. Jangan input ulang — selesaikan dari tab Hutang Supplier.`,
          'warning'
        );
      }
      renderNotaStaff(wadah, { businessUnitId, outletId, products });
    })
  );

  // ---- DUA TAMPILAN: riwayat & hutang ----
  wadah.querySelectorAll('[data-nota-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      wadah.querySelectorAll('[data-nota-tab]').forEach((x) => x.classList.toggle('active', x === b));
      if (b.dataset.notaTab === 'hutang') gambarHutang();
      else gambarRiwayat();
    })
  );

  gambarRiwayat();

  /** Penanda status bayar, dipakai riwayat maupun daftar hutang. */
  function lencanaStatus(n) {
    const s = statusTempo(n, todayWIB());
    if (s === 'lunas') return '<span class="nota-lunas">lunas</span>';
    if (s === 'terlambat') return `<span class="nota-telat">lewat tempo ${esc(n.due_date)}</span>`;
    if (s === 'hari-ini') return '<span class="nota-telat">jatuh tempo hari ini</span>';
    if (s === 'akan-datang') return `<span class="nota-tempo">tempo ${esc(n.due_date)}</span>`;
    return '<span class="nota-tempo">belum dibayar</span>';
  }

  /**
   * HUTANG SUPPLIER — nota yang belum dibayar, dikelompokkan per supplier.
   *
   * Nota dicentang lalu dibayar SEKALIGUS dengan satu entri kas, karena itulah
   * yang benar-benar terjadi: satu amplop berpindah tangan satu kali. Satu
   * entri per nota akan memenuhi buku kas dengan baris yang tidak punya
   * padanan di dunia nyata.
   */
  async function gambarHutang() {
    const box = wadah.querySelector('#nota-riwayat');
    if (!box) return;
    box.innerHTML = loadingHtml('Memuat hutang…', { baris: 3 });

    let daftar = [];
    let kantong = [];
    try {
      [daftar, kantong] = await Promise.all([
        ringkasanNota(businessUnitId, { outletId, status: 'belum' }),
        listKantongBisaKubebani(outletId).catch(() => [])
      ]);
    } catch (e) {
      // Tab ini memang MATI TOTAL sebelum 0122 dijalankan — view-nya belum
      // ada. Bedanya dengan riwayat: di sini tidak ada yang bisa diselamatkan,
      // jadi yang penting pesannya menyebut sebabnya. "relation nota_ringkas
      // does not exist" tidak bisa ditindaklanjuti oleh siapa pun yang berdiri
      // di depan layar ini.
      const pesan = String(e?.message ?? e);
      box.innerHTML = `<p class="error-text">${
        /nota_ringkas/.test(pesan)
          ? 'Fitur hutang supplier belum aktif di database ini — migration 0122 belum dijalankan. Riwayat nota di tab sebelah tetap bisa dipakai seperti biasa.'
          : esc(pesan)
      }</p>`;
      return;
    }

    const grup = kelompokPerSupplier(daftar, todayWIB());
    if (!grup.length) {
      box.innerHTML = '<p style="color:var(--color-text-muted);font-size:0.88rem">Tidak ada hutang supplier di outlet ini. 🎉</p>';
      return;
    }

    const totalSemua = grup.reduce((s, g) => s + g.total, 0);
    box.innerHTML = `
      <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 8px">
        Total hutang outlet ini: <strong>${formatRupiah(totalSemua)}</strong>.
        Centang nota yang dibayar lalu tekan <strong>Bayar</strong> — beberapa nota yang dibayar bersama
        menghasilkan <strong>satu</strong> baris di buku kas.
        <br />Barangnya dihitung sebagai biaya pada <strong>tanggal notanya</strong>, sedangkan kas berkurang pada
        <strong>tanggal pembayaran</strong>. Untuk nota Agustus yang dibayar September, dua tanggal itu memang berbeda —
        dan keduanya benar.
      </p>
      ${grup
        .map(
          (g) => `<div class="inline-card" style="margin-bottom:10px">
            <div class="page-header" style="margin-bottom:6px">
              <h4 style="margin:0;font-size:0.92rem">${esc(g.supplier)}${g.terlambat ? ` <span class="nota-telat">${g.terlambat} lewat tempo</span>` : ''}</h4>
              <strong style="font-size:0.92rem">${formatRupiah(g.total)}</strong>
            </div>
            <div class="table-scroll"><table class="data-table kartu-sempit">
              <thead><tr><th></th><th>Nomor</th><th>Tanggal</th><th>Status</th><th>Total</th></tr></thead>
              <tbody>${g.notas
                .map(
                  (n) => `<tr>
                    <td><input type="checkbox" class="hutang-pilih" data-id="${n.id}" ${Number(n.baris_tanpa_harga) > 0 ? 'disabled' : ''} /></td>
                    <td data-label="Nomor" style="font-family:ui-monospace,Menlo,monospace;font-size:0.8rem">${esc(n.code)}</td>
                    <td data-label="Tanggal">${esc(n.receipt_date)}</td>
                    <td data-label="Status">${lencanaStatus(n)}${
                      Number(n.baris_tanpa_harga) > 0
                        ? `<div class="nota-total-kurang">${n.baris_tanpa_harga} barang belum berharga — lengkapi lewat Edit sebelum bisa dibayar</div>`
                        : ''
                    }</td>
                    <td data-label="Total">${formatRupiah(n.total)}</td>
                  </tr>`
                )
                .join('')}</tbody>
            </table></div>
          </div>`
        )
        .join('')}
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-top:6px">
        <div class="field" style="margin:0;min-width:190px;flex:1 1 190px">
          <label>Bayar dari kas</label>
          <select id="hutang-kas">${
            kantong.length
              ? kantong.map((k) => `<option value="${k.id}">${esc(k.name)}${k.outlets?.name ? ` — ${esc(k.outlets.name)}` : ''}</option>`).join('')
              : '<option value="">tidak ada kas yang bisa kamu bebani</option>'
          }</select>
        </div>
        <div class="field" style="margin:0;min-width:150px;flex:0 1 150px">
          <label>Tanggal bayar</label>
          <input type="date" id="hutang-tgl" value="${todayWIB()}" max="${todayWIB()}" />
        </div>
        <button class="primary" id="hutang-bayar" style="max-width:200px">Bayar yang dicentang</button>
      </div>
      <p class="error-text" id="hutang-error"></p>`;

    const errBox = box.querySelector('#hutang-error');
    const terpilih = () => {
      const ids = [...box.querySelectorAll('.hutang-pilih:checked')].map((c) => c.dataset.id);
      return daftar.filter((n) => ids.includes(n.id));
    };

    box.querySelectorAll('.hutang-pilih').forEach((c) =>
      c.addEventListener('change', () => {
        const p = bolehDibayar(terpilih());
        errBox.textContent = p.boleh || !terpilih().length ? '' : p.alasan;
      })
    );

    box.querySelector('#hutang-bayar').addEventListener(
      'click',
      sekaliJalan(async () => {
        errBox.textContent = '';
        const pilih = terpilih();
        const p = bolehDibayar(pilih);
        if (!p.boleh) {
          errBox.textContent = p.alasan;
          return;
        }
        const akun = box.querySelector('#hutang-kas').value;
        if (!akun) {
          errBox.textContent = 'Tidak ada kas yang bisa kamu bebani. Minta admin memberi outlet pada kantong kas pemegangnya.';
          return;
        }
        const ok = await confirmDialog({
          title: `Bayar ${pilih.length} nota?`,
          message:
            `Total <strong>${formatRupiah(p.total)}</strong> akan keluar dari kas yang dipilih, sebagai <strong>satu</strong> baris di buku kas. ` +
            'Setelah dibayar, isi notanya tidak bisa diubah lagi sampai pembayarannya dibatalkan.',
          confirmText: 'Bayar'
        });
        if (!ok) return;
        try {
          await bayarNota({
            notaIds: pilih.map((n) => n.id),
            accountId: akun,
            date: box.querySelector('#hutang-tgl').value
          });
          toast(`${pilih.length} nota dilunasi.`, 'success');
          gambarHutang();
        } catch (e) {
          errBox.textContent = e.message ?? 'Gagal membayar.';
        }
      })
    );
  }

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
          <thead><tr><th>Nomor</th><th>Tanggal</th><th>Supplier</th><th>Bayar</th><th>Nota</th><th>Aksi</th></tr></thead>
          <tbody>${tampil
            .map(
              (n) => `<tr>
                <td data-label="Nomor" style="font-family:ui-monospace,Menlo,monospace;font-size:0.8rem">${esc(n.code)}</td>
                <td data-label="Tanggal">${esc(n.receipt_date)}</td>
                <td data-label="Supplier">${esc(n.supplier ?? '-')}</td>
                <td data-label="Bayar">${lencanaStatus(n)}</td>
                <td data-label="Nota">${
                  n.photo_path
                    ? `<button class="nota-foto-lihat" data-path="${esc(n.photo_path)}">Lihat</button>`
                    : '<span style="color:var(--color-danger);font-size:0.8rem">belum ada</span>'
                }</td>
                <td data-label="Aksi">
                  <button class="nota-isi" data-id="${n.id}" data-code="${esc(n.code)}">Isi</button>
                  ${
                    // Nota lunas: tombol Edit DIGANTI, bukan dimatikan diam-diam.
                    // Tombol yang ada tapi ditolak server memaksa orang menebak
                    // apa yang salah; tombol yang berubah namanya menjelaskan
                    // sendiri apa yang harus dilakukan lebih dulu.
                    n.payment_status === 'lunas'
                      ? `<button class="nota-batal" data-id="${n.id}" data-code="${esc(n.code)}">Batalkan pembayaran</button>`
                      : `<button class="nota-edit" data-id="${n.id}" data-code="${esc(n.code)}">Edit</button>`
                  }
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
              ? `<table class="data-table kartu-sempit"><thead><tr><th>Barang</th><th>Jumlah</th><th>Harga beli</th><th>Per satuan</th></tr></thead><tbody>${isi
                  .map(
                    (i) =>
                      `<tr><td data-label="Barang">${esc(i.products?.name ?? '-')}</td>` +
                      `<td data-label="Jumlah">${formatNum(i.qty)} ${esc(i.products?.base_unit ?? '')}</td>` +
                      `<td data-label="Harga beli">${
                        hargaBaris(i) == null
                          ? '<span style="color:var(--color-danger)">belum diisi</span>'
                          : formatRupiah(hargaBaris(i))
                      }</td>` +
                      // Turunan per-satuannya ditampilkan supaya orang bisa
                      // memeriksa dirinya sendiri: Rp180.000 untuk 5.000 gr
                      // adalah Rp36/gr, dan angka itu yang masuk ke biaya
                      // rata-rata bahan. Kalau yang muncul Rp180.000/gr,
                      // berarti kolomnya salah diisi.
                      `<td data-label="Per satuan">${
                        i.unit_cost == null ? '-' : `${formatRupiah(i.unit_cost)}/${esc(i.products?.base_unit ?? '')}`
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

    // ---- BATALKAN PEMBAYARAN ----
    //
    // Pembatalan berlaku untuk SELURUH pembayaran, bukan satu nota di
    // dalamnya — dan kalau pembayarannya menggabungkan beberapa nota, itu
    // harus dikatakan SEBELUM ditekan. Orang yang mengira membatalkan satu
    // nota lalu mendapati enam nota lain ikut terbuka tidak punya cara
    // mengetahui bahwa itu memang perilakunya.
    box.querySelectorAll('.nota-batal').forEach((b) =>
      b.addEventListener(
        'click',
        sekaliJalan(async () => {
          const nota = daftar.find((n) => n.id === b.dataset.id);
          const serumpun = nota?.payment_entry_id
            ? daftar.filter((n) => n.payment_entry_id === nota.payment_entry_id)
            : [nota].filter(Boolean);
          const lain = serumpun.filter((n) => n.id !== b.dataset.id);

          const ok = await confirmDialog({
            title: `Batalkan pembayaran nota ${b.dataset.code}?`,
            message:
              (lain.length
                ? `Nota ini dibayar bersama <strong>${lain.length} nota lain</strong> (${lain.map((n) => esc(n.code)).join(', ')}) dalam satu pembayaran, jadi <strong>semuanya</strong> akan kembali jadi hutang.<br /><br />`
                : '') +
              'Uangnya dikembalikan lewat baris <strong>baru</strong> di buku kas — baris pembayaran yang lama tetap ada. ' +
              'Buku kas mencatat dua kejadian karena memang ada dua kejadian.',
            confirmText: 'Batalkan pembayaran',
            danger: true
          });
          if (!ok) return;
          try {
            const n = await batalkanPembayaranNota(b.dataset.id);
            toast(`${n} nota kembali jadi hutang; kasnya sudah dikembalikan.`, 'success');
            gambarRiwayat();
          } catch (e) {
            toast(e.message ?? 'Gagal membatalkan pembayaran.', 'error');
          }
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
            onReady: (form, { kumpulkan, setError }) => {
              // TITIK TANAMNYA DIPERIKSA DULU.
              //
              // Kalau `ui.js` di perangkat ini masih versi lama, `type: 'html'`
              // tidak dikenal dan wadahnya tidak pernah ada. Memanggil
              // `createItemPicker(null, …)` akan melempar di dalam `onReady`,
              // dan lemparan di situ tidak terlihat di mana pun kecuali console
              // — dialognya tetap berdiri, terlihat wajar, dan tombol Simpan
              // tetap bisa ditekan.
              //
              // `kumpulkan` juga tidak ada di `ui.js` lama; memanggilnya akan
              // melempar sebelum sempat mendaftarkan apa pun.
              const wadah = form.querySelector('#nota-edit-picker');
              if (!wadah || typeof kumpulkan !== 'function') {
                setError?.(
                  'Aplikasi di perangkat ini masih versi lama, jadi daftar barangnya tidak bisa ditampilkan. ' +
                    'Tutup lalu buka lagi aplikasinya, atau muat ulang halamannya.'
                );
                return;
              }

              picker = createItemPicker(wadah, {
                products,
                showStock: false,
                hargaSatuan: true,
                initial: isi.map((i) => ({ product_id: i.product_id, qty: i.qty, line_total: i.line_total ?? '' }))
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

