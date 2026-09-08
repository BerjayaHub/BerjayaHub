/**
 * Admin Portal → Inventory → **Ekspor ESB**.
 *
 * Tiga langkah, berurutan, dan ditampilkan sebagai tiga langkah supaya jelas
 * mana yang belum dikerjakan:
 *
 *   1. IMPOR daftar induk ESB (Branch, Unit of Material, Product Data).
 *   2. PETAKAN nilai Berjaya Hub ke nilai ESB — dengan pencocokan otomatis,
 *      karena 279 produk terlalu banyak untuk dipilih satu per satu.
 *   3. UNDUH berkasnya, lalu tandai notanya supaya tidak terunggah dua kali.
 *
 * ============ KENAPA UNDUHANNYA TIDAK LEWAT `exportTableXLSX` ============
 *
 * Helper itu menyisipkan baris judul & subjudul di atas header. ESB membaca
 * BARIS PERTAMA sebagai nama kolom, jadi satu baris judul saja membuat seluruh
 * berkas ditolak — dan penolakannya terjadi di ESB, jauh dari sini.
 */

import { toast, confirmDialog } from '../../core/ui.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { monthRangeWIB } from '../../core/dates.js';
import { loadXLSX } from '../../core/xlsx.js';
import { listProducts } from '../product/product.service.js';
import { sayaAdminBu } from '../../core/base-scope.js';
import { KOLOM_ESB, JENIS_PETA, buatPeta, barisEsbPurchase, ringkasEkspor } from './esb-purchase.js';
import { KOLOM_TRANSFER, barisEsbTransfer, ringkasTransfer } from './esb-transfer.js';
import {
  listEsbMaster,
  gantiEsbMaster,
  listEsbMap,
  simpanEsbMap,
  notaUntukEsb,
  tandaiNotaEsb,
  kirimanUntukEsb,
  tandaiKirimanEsb
} from './esb.service.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const LABEL_JENIS = {
  branch: 'Branch',
  location: 'Location',
  payment_method: 'Payment Method',
  coa: 'COANo',
  unit: 'Unit',
  item: 'Item'
};

/** Cara bayar lokal yang selalu perlu padanan, apa pun isi notanya. */
const CARA_BAYAR = ['kas', 'tempo', 'pusat'];

/**
 * Dua jenis dokumen ESB, satu layar, **satu pemetaan**.
 *
 * Origin/Destination di Simple Transfer sumbernya sama-sama nama outlet —
 * persis yang sudah dipetakan untuk Branch & Location di Simple Purchase. Kalau
 * transfer diberi jenis pemetaan sendiri, "AB Sentul" harus dipetakan dua kali,
 * lalu suatu hari yang satu diperbarui dan yang lain tidak. Dua jawaban untuk
 * satu pertanyaan tidak pernah terlihat salah di layar; ia cuma membuat dua
 * berkas ESB tidak konsisten.
 */
const DOKUMEN = {
  purchase: {
    label: 'Simple Purchase',
    sumber: 'nota penerimaan barang (modul Bahan)',
    kolom: KOLOM_ESB,
    berkas: 'esb-purchase',
    satuan: 'nota'
  },
  transfer: {
    label: 'Simple Transfer',
    sumber: 'kiriman antar-outlet yang SUDAH DITERIMA (modul Pengiriman)',
    kolom: KOLOM_TRANSFER,
    berkas: 'esb-transfer',
    satuan: 'kiriman'
  }
};

/**
 * Nama disamakan sebelum dibandingkan: huruf kecil, spasi rangkap jadi satu,
 * dan tanda baca dibuang.
 *
 * "Telur Ayam", "telur  ayam", dan "TELUR AYAM." adalah satu barang yang sama.
 * Tanpa penyamaan ini, pencocokan otomatis hampir tidak pernah kena, dan orang
 * akan memetakan 279 produk dengan tangan.
 */
const normal = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export async function renderEsbAdmin(container, { businessUnitId, outlets }) {
  container.innerHTML = loadingHtml('Memuat…', { baris: 4 });

  // SKALA BU, BUKAN SKALA OUTLET.
  //
  // `esb_map` dan `esb_master` dijaga `is_bu_admin` (0127): pemetaan berlaku
  // untuk seluruh BU, bukan per outlet. Daftar outlet di layar ini cuma dipakai
  // untuk MENYEBUT namanya dan menyaring rentang ekspor — bukan untuk
  // menentukan wewenang.
  //
  // Tanpa penjaga ini, admin outlet melihat editor pemetaan yang lengkap, lalu
  // tiap perubahan ditolak RLS dengan "new row violates row-level security
  // policy" — pesan yang tidak bisa ditindaklanjuti siapa pun.
  if (!(await sayaAdminBu(businessUnitId).catch(() => false))) {
    container.innerHTML =
      '<p style="color:var(--color-text-muted)">Ekspor ESB diatur di tingkat Business Unit, jadi hanya Admin BU atau Super Admin yang bisa membukanya.</p>';
    return;
  }

  let master = [];
  let peta = [];
  let produk = [];
  try {
    [master, peta, produk] = await Promise.all([
      listEsbMaster(businessUnitId).catch(() => []),
      listEsbMap(businessUnitId).catch(() => []),
      listProducts(businessUnitId).catch(() => [])
    ]);
  } catch (e) {
    container.innerHTML = `<p class="error-text">${esc(e.message ?? e)}</p>`;
    return;
  }

  const masterPer = (j) => master.filter((m) => m.jenis === j);
  const petaPer = (j) => new Map(peta.filter((p) => p.jenis === j).map((p) => [normal(p.kunci), p.nilai]));
  const range = monthRangeWIB();

  /** Nilai lokal yang PERLU dipetakan, per jenis. */
  const lokal = {
    branch: outlets.map((o) => o.name),
    location: outlets.map((o) => o.name),
    payment_method: CARA_BAYAR,
    coa: CARA_BAYAR,
    unit: [...new Set(produk.map((p) => p.base_unit).filter(Boolean))].sort(),
    item: [...new Set(produk.filter((p) => p.product_type === 'raw' || p.product_type === 'semi').map((p) => p.name))].sort()
  };

  const belum = (j) => {
    const m = petaPer(j);
    return lokal[j].filter((k) => !m.has(normal(k)));
  };

  container.innerHTML = `
    <h2 style="font-size:1.05rem">Ekspor ke ESB</h2>
    <p style="font-size:0.82rem;color:var(--color-text-muted);max-width:760px">
      Berjaya Hub jadi tempat input, ESB menerima berkasnya. Dua jenis dokumen didukung —
      <strong>Simple Purchase</strong> dari nota penerimaan dan <strong>Simple Transfer</strong> dari modul Pengiriman —
      dan keduanya memakai <strong>pemetaan yang sama</strong>. Dokumen yang ada nilainya belum terpetakan
      <strong>tidak ikut terunduh</strong>; ia muncul di daftar di bawah, supaya ketahuan alih-alih berangkat dengan
      sel kosong yang ditolak ESB belakangan.
    </p>

    <div class="inline-card" style="max-width:820px">
      <h3 style="margin-top:0;font-size:0.95rem">1. Daftar induk ESB</h3>
      <p style="font-size:0.8rem;color:var(--color-text-muted);margin:0 0 8px">
        Unggah berkas <em>ekspor dari ESB</em> apa adanya — Master Branch, Master Unit of Material, Master Product Data.
        Diimpor ulang kapan pun ESB berubah; <strong>pemetaan di langkah 2 tidak ikut terhapus</strong>.
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input type="file" id="esb-file" accept=".xlsx,.xls" />
        <select id="esb-file-jenis">
          <option value="branch">Master Branch</option>
          <option value="unit">Master Unit of Material</option>
          <option value="item">Master Product Data</option>
        </select>
        <button class="primary" id="esb-impor" style="max-width:150px">Impor</button>
      </div>
      <p style="font-size:0.8rem;margin:8px 0 0">
        Tersimpan: ${['branch', 'unit', 'item']
          .map((j) => `<strong>${masterPer(j).length}</strong> ${LABEL_JENIS[j]}`)
          .join(' · ')}
      </p>
      <p class="error-text" id="esb-impor-error"></p>
    </div>

    <div class="inline-card" style="max-width:820px;margin-top:12px">
      <div class="page-header" style="margin-bottom:6px">
        <h3 style="margin:0;font-size:0.95rem">2. Pemetaan</h3>
        <button id="esb-cocokkan" title="Cocokkan otomatis berdasarkan kemiripan nama">⚡ Cocokkan otomatis</button>
      </div>
      <div id="esb-peta"></div>
    </div>

    <div class="inline-card" style="max-width:820px;margin-top:12px">
      <h3 style="margin-top:0;font-size:0.95rem">3. Unduh</h3>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div class="field" style="margin:0"><label>Jenis dokumen</label>
          <select id="esb-dokumen">
            <option value="purchase">Simple Purchase — nota supplier</option>
            <option value="transfer">Simple Transfer — kiriman antar-outlet</option>
          </select>
        </div>
        <div class="field" style="margin:0"><label>Dari tanggal</label><input type="date" id="esb-from" value="${range.from}" /></div>
        <div class="field" style="margin:0"><label>Sampai tanggal</label><input type="date" id="esb-to" value="${range.to}" /></div>
        <div class="field" style="margin:0"><label>Outlet</label>
          <select id="esb-outlet"><option value="">Semua outlet</option>${outlets
            .map((o) => `<option value="${o.id}">${esc(o.name)}</option>`)
            .join('')}</select>
        </div>
        <button class="primary" id="esb-pratinjau" style="max-width:140px">Pratinjau</button>
      </div>
      <p style="font-size:0.8rem;color:var(--color-text-muted);margin:8px 0 0" id="esb-dokumen-ket"></p>
      <div id="esb-hasil" style="margin-top:10px"></div>
    </div>
  `;

  gambarPeta();

  // ---------------------------------------------------------------
  // 1. Impor daftar induk
  // ---------------------------------------------------------------
  container.querySelector('#esb-impor').addEventListener(
    'click',
    sekaliJalan(async () => {
      const errEl = container.querySelector('#esb-impor-error');
      errEl.textContent = '';
      const file = container.querySelector('#esb-file').files?.[0];
      const jenis = container.querySelector('#esb-file-jenis').value;
      if (!file) {
        errEl.textContent = 'Pilih berkasnya dulu.';
        return;
      }
      try {
        const baris = await bacaMasterEsb(file, jenis);
        if (!baris.length) {
          errEl.textContent =
            'Tidak ada baris yang terbaca. Pastikan berkasnya berkas EKSPOR dari ESB (ada baris judul, lalu header di baris ke-6).';
          return;
        }
        const n = await gantiEsbMaster(businessUnitId, jenis, baris);
        // LOCATION TIDAK DISALIN DARI BRANCH.
        //
        // Percobaan pertama menyalinnya, dengan anggapan gudang dan cabang
        // bernama sama. Daftar yang diberikan membuktikan sebaliknya:
        //
        //   Branch "HEAD OFFICE"                        -> Location "Central Kitchen"
        //   Branch "Awal Bermula Cafe & Eatery Serpong" -> Location "Outlet Awal Bermula Coffee & Eatery Serpong"
        //
        // Salinan itu akan mengisi dropdown Location dengan nama-nama yang
        // TIDAK ADA di ESB — dan yang memilihnya tidak punya cara tahu, karena
        // pilihannya tampil seperti pilihan yang sah. Location diketik manual;
        // jumlahnya cuma sebanyak outlet.
        toast(`${n} ${LABEL_JENIS[jenis]} tersimpan.`, 'success');
        renderEsbAdmin(container, { businessUnitId, outlets });
      } catch (e) {
        errEl.textContent = e.message ?? 'Gagal mengimpor.';
      }
    })
  );

  // ---------------------------------------------------------------
  // 2. Pemetaan
  // ---------------------------------------------------------------
  function gambarPeta() {
    const box = container.querySelector('#esb-peta');
    box.innerHTML = JENIS_PETA.map((j) => {
      const m = petaPer(j);
      const pilihan = masterPer(j);
      const kurang = belum(j).length;
      return `
        <details ${kurang ? 'open' : ''} style="margin-bottom:6px">
          <summary style="cursor:pointer;font-size:0.88rem">
            <strong>${LABEL_JENIS[j]}</strong> —
            ${kurang ? `<span class="nota-telat">${kurang} belum dipetakan</span>` : '<span class="nota-lunas">lengkap</span>'}
          </summary>
          <div class="table-scroll"><table class="data-table kartu-sempit">
            <thead><tr><th>Berjaya Hub</th><th>ESB</th></tr></thead>
            <tbody>${lokal[j]
              .map((k) => {
                const kini = m.get(normal(k)) ?? '';
                const opsi = pilihan.length
                  ? `<select class="esb-pilih" data-jenis="${j}" data-kunci="${esc(k)}">
                       <option value=""${kini ? '' : ' selected'}>— belum dipetakan —</option>
                       ${pilihan
                         .map((p) => `<option value="${esc(p.nama)}"${p.nama === kini ? ' selected' : ''}>${esc(p.nama)}</option>`)
                         .join('')}
                     </select>`
                  : // Daftar induknya belum diimpor -> kotak ketik, supaya
                    // pemetaan yang jumlahnya sedikit (COA, cara bayar) tidak
                    // ikut tersandera oleh impor yang belum dilakukan.
                    `<input type="text" class="esb-ketik" data-jenis="${j}" data-kunci="${esc(k)}"
                            value="${esc(kini)}" placeholder="ketik nilai ESB" />`;
                return `<tr><td data-label="Berjaya Hub">${esc(k)}</td><td data-label="ESB">${opsi}</td></tr>`;
              })
              .join('')}</tbody>
          </table></div>
        </details>`;
    }).join('');

    const simpan = async (el) => {
      try {
        await simpanEsbMap(businessUnitId, { jenis: el.dataset.jenis, kunci: el.dataset.kunci, nilai: el.value });
        const i = peta.findIndex((p) => p.jenis === el.dataset.jenis && normal(p.kunci) === normal(el.dataset.kunci));
        if (i >= 0) peta.splice(i, 1);
        if (el.value.trim()) peta.push({ jenis: el.dataset.jenis, kunci: el.dataset.kunci, nilai: el.value.trim() });
      } catch (e) {
        toast(e.message ?? 'Gagal menyimpan pemetaan.', 'error');
      }
    };
    box.querySelectorAll('.esb-pilih').forEach((el) => el.addEventListener('change', () => simpan(el)));
    box.querySelectorAll('.esb-ketik').forEach((el) => el.addEventListener('change', () => simpan(el)));
  }

  container.querySelector('#esb-cocokkan').addEventListener(
    'click',
    sekaliJalan(async () => {
      // Kecocokan PERSIS saja, sesudah nama disamakan. Kemiripan sebagian
      // ("Telur" ~ "Telur Puyuh") adalah tebakan, dan tebakan di sini menjadi
      // pembelian yang tercatat atas barang yang salah — tanpa satu pun error.
      const usul = [];
      for (const j of JENIS_PETA) {
        const m = petaPer(j);
        const idx = new Map(masterPer(j).map((p) => [normal(p.nama), p.nama]));
        for (const k of lokal[j]) {
          if (m.has(normal(k))) continue;
          const cocok = idx.get(normal(k));
          if (cocok) usul.push({ jenis: j, kunci: k, nilai: cocok });
        }
      }
      if (!usul.length) {
        toast('Tidak ada yang bisa dicocokkan otomatis — namanya harus sama persis.', 'warning');
        return;
      }
      const ok = await confirmDialog({
        title: `Cocokkan ${usul.length} nilai?`,
        message:
          `Hanya nama yang <strong>sama persis</strong> yang dicocokkan (beda huruf besar-kecil & tanda baca diabaikan). ` +
          'Yang mirip tapi tidak sama sengaja dibiarkan — menebaknya berarti pembelian tercatat atas barang yang salah.',
        confirmText: 'Cocokkan'
      });
      if (!ok) return;
      let n = 0;
      for (const u of usul) {
        try {
          await simpanEsbMap(businessUnitId, u);
          n++;
        } catch {
          // Satu kegagalan tidak boleh menghentikan sisanya; jumlah yang
          // berhasil tetap dilaporkan apa adanya.
        }
      }
      toast(`${n} dari ${usul.length} nilai dicocokkan.`, n === usul.length ? 'success' : 'warning');
      renderEsbAdmin(container, { businessUnitId, outlets });
    })
  );

  // ---------------------------------------------------------------
  // 3. Pratinjau & unduh
  // ---------------------------------------------------------------
  const jenisDokumen = () => container.querySelector('#esb-dokumen').value;

  function ketDokumen() {
    const d = DOKUMEN[jenisDokumen()];
    container.querySelector('#esb-dokumen-ket').innerHTML =
      `Sumbernya: ${esc(d.sumber)}.` +
      (jenisDokumen() === 'transfer'
        ? ' Qty yang dikirim ke ESB adalah <strong>jumlah yang DITERIMA</strong>, dan tanggalnya tanggal barang diterima — bukan tanggal dikirim.'
        : ' <strong>Harga yang dikirim adalah harga per satuan</strong> (beras 5.000 gr seharga Rp180.000 berangkat sebagai Qty 5000, Price 36).');
  }
  ketDokumen();
  // Hasil pratinjau lama dibersihkan saat jenisnya berganti. Tabel Purchase yang
  // masih terpampang di bawah pilihan "Transfer" akan diunduh sebagai berkas
  // bernama transfer — dan isinya baru ketahuan salah setelah diunggah.
  container.querySelector('#esb-dokumen').addEventListener('change', () => {
    ketDokumen();
    container.querySelector('#esb-hasil').innerHTML = '';
  });

  container.querySelector('#esb-pratinjau').addEventListener('click', sekaliJalan(pratinjau));

  async function pratinjau() {
    const hasilEl = container.querySelector('#esb-hasil');
    hasilEl.innerHTML = loadingHtml('Menyiapkan…', { baris: 3 });
    const jenis = jenisDokumen();
    const dok = DOKUMEN[jenis];
    const from = container.querySelector('#esb-from').value;
    const to = container.querySelector('#esb-to').value;
    const outletId = container.querySelector('#esb-outlet').value || null;

    let hasil;
    let total;
    let ringkas;
    let ids;
    try {
      if (jenis === 'transfer') {
        const data = await kirimanUntukEsb({ businessUnitId, from, to, outletId });
        total = data.kiriman.length;
        if (!total) {
          hasilEl.innerHTML =
            '<p style="color:var(--color-text-muted);font-size:0.88rem">Tidak ada kiriman <strong>yang sudah diterima</strong> di rentang itu. Kiriman yang masih di jalan sengaja belum ditawarkan — stok ESB baru boleh bertambah setelah barangnya sampai. Yang sudah pernah diekspor juga tidak ditawarkan lagi.</p>';
          return;
        }
        hasil = barisEsbTransfer({
          kiriman: data.kiriman,
          itemsPerKiriman: data.itemsPerKiriman,
          peta: buatPeta(peta),
          // Product Code diambil dari daftar induk ESB lewat NAMA hasil
          // pemetaan — kode lokal Berjaya Hub bukan kode ESB.
          kodeItem: new Map(master.filter((m) => m.jenis === 'item' && m.kode).map((m) => [m.nama, m.kode]))
        });
        ringkas = ringkasTransfer(hasil, total);
        ids = hasil.kirimanIds;
      } else {
        const data = await notaUntukEsb({ businessUnitId, from, to, outletId });
        total = data.notas.length;
        if (!total) {
          hasilEl.innerHTML =
            '<p style="color:var(--color-text-muted);font-size:0.88rem">Tidak ada nota baru di rentang itu. Nota yang sudah pernah diekspor sengaja tidak ditawarkan lagi.</p>';
          return;
        }
        hasil = barisEsbPurchase({ notas: data.notas, itemsPerNota: data.itemsPerNota, peta: buatPeta(peta) });
        ringkas = ringkasEkspor(hasil, total);
        ids = hasil.notaIds;
      }
    } catch (e) {
      hasilEl.innerHTML = `<p class="error-text">${esc(e.message ?? e)}</p>`;
      return;
    }

    hasilEl.innerHTML = `
      <p style="font-size:0.88rem;margin:0 0 8px">
        <strong>${ringkas.siap}</strong> ${dok.satuan} siap (${ringkas.baris} baris)${
          ringkas.tertahan ? ` · <span class="nota-telat">${ringkas.tertahan} tertahan</span>` : ''
        }
      </p>
      ${
        hasil.kurang.length
          ? `<div class="table-scroll" style="margin-bottom:8px"><table class="data-table kartu-sempit">
               <thead><tr><th>Jenis</th><th>Nilai Berjaya Hub</th><th>Dokumen terpengaruh</th></tr></thead>
               <tbody>${hasil.kurang
                 .map((k) => {
                   // Modul Purchase menamainya `nota`, modul Transfer `dok`.
                   const daftar = k.dok ?? k.nota ?? [];
                   return (
                     `<tr><td data-label="Jenis">${esc(LABEL_JENIS[k.jenis] ?? k.jenis)}</td>` +
                     `<td data-label="Nilai">${esc(k.nilai)}</td>` +
                     `<td data-label="Dokumen" style="font-size:0.8rem">${esc(daftar.slice(0, 6).join(', '))}${
                       daftar.length > 6 ? ` +${daftar.length - 6}` : ''
                     }</td></tr>`
                   );
                 })
                 .join('')}</tbody></table></div>
             <p class="nota-total-kurang" style="margin:0 0 8px">Petakan dulu di langkah 2, lalu tekan Pratinjau lagi.</p>`
          : ''
      }
      ${
        ringkas.siap
          ? `<button class="primary" id="esb-unduh" style="max-width:260px">⇩ Unduh .xlsx — ${esc(dok.label)}</button>`
          : `<p class="error-text" style="margin:0">Tidak ada ${esc(dok.satuan)} yang bisa diunduh.</p>`
      }
    `;

    container.querySelector('#esb-unduh')?.addEventListener(
      'click',
      sekaliJalan(async () => {
        try {
          await unduhEsb(dok.kolom, hasil.baris, `${dok.berkas}-${from}-sd-${to}`);
        } catch (e) {
          toast(e.message ?? 'Gagal membuat berkas.', 'error');
          return;
        }
        // DITANDAI SESUDAH BERKASNYA JADI, bukan sebelum. Kalau ditandai lebih
        // dulu lalu pembuatan berkasnya gagal, dokumennya hilang dari daftar
        // tanpa pernah sampai ke ESB — dan tidak ada yang tahu sampai stoknya
        // tidak cocok.
        try {
          const n = jenis === 'transfer' ? await tandaiKirimanEsb(ids) : await tandaiNotaEsb(ids);
          toast(`Berkas terunduh. ${n} ${dok.satuan} ditandai sudah diekspor.`, 'success');
        } catch (e) {
          toast(
            `Berkas TERUNDUH, tapi penandaannya gagal: ${e.message ?? e}. ` +
              `${dok.satuan} ini akan ditawarkan lagi di ekspor berikutnya — jangan unggah dua kali.`,
            'warning'
          );
        }
        pratinjau();
      })
    );
  }
}

/**
 * Tulis berkas .xlsx dengan header di BARIS 1, tanpa judul apa pun di atasnya.
 *
 * ESB membaca baris pertama sebagai nama kolom.
 */
async function unduhEsb(kolom, baris, namaFile) {
  const XLSX = await loadXLSX();
  const ws = XLSX.utils.aoa_to_sheet([kolom, ...baris]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, `${namaFile}.xlsx`);
}

/**
 * Baca berkas ekspor ESB.
 *
 * Bentuknya seragam: empat baris judul/keterangan, satu baris kosong, lalu
 * HEADER di baris ke-6. Header dicari, bukan diasumsikan di baris tertentu —
 * ESB boleh menambah baris keterangan kapan saja, dan pembacaan yang mengunci
 * nomor baris akan diam-diam memuat data yang bergeser.
 */
async function bacaMasterEsb(file, jenis) {
  const XLSX = await loadXLSX();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const kolomWajib = {
    branch: ['Branch Name'],
    unit: ['Unit Name'],
    item: ['Product Name']
  }[jenis];

  const iHeader = aoa.findIndex((r) => kolomWajib.every((k) => r.includes(k)));
  if (iHeader < 0) {
    throw new Error(`Kolom "${kolomWajib.join('", "')}" tidak ditemukan — berkasnya bukan ekspor ${jenis} dari ESB?`);
  }
  const header = aoa[iHeader].map((h) => String(h).trim());
  const kol = (nama) => header.indexOf(nama);

  const iNama = kol(kolomWajib[0]);
  const iKode = jenis === 'branch' ? kol('Branch Code') : jenis === 'item' ? kol('Product Code') : -1;
  const iKet = jenis === 'item' ? kol('Category') : jenis === 'branch' ? kol('Branch Type') : -1;

  const out = [];
  for (let i = iHeader + 1; i < aoa.length; i++) {
    const r = aoa[i];
    const nama = String(r[iNama] ?? '').trim();
    if (!nama) continue;
    out.push({
      nama,
      kode: iKode >= 0 ? String(r[iKode] ?? '').trim() : null,
      keterangan: iKet >= 0 ? String(r[iKet] ?? '').trim() : null
    });
  }
  return out;
}
