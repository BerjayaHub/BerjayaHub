import { escapeHtml, toast, formDialog, confirmDialog } from '../../core/ui.js';
import { formatRupiah, formatNum } from '../../core/format.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { todayWIB } from '../../core/dates.js';
import { listProducts } from '../product/product.service.js';
// Daftar RESMI outlet BU ini — bukan "outlet yang saya kelola".
// Layar ini MENULIS harga, dan sumber daftar untuk layar yang menulis harus
// daftar resmi BU-nya; `audit-outlet-tulis.cjs` yang menjaga aturan itu.
import { listOutletsForBu } from '../organization/organization.service.js';
// Penjaga wewenang. RLS `omp_modify` (0096) hanya meloloskan admin BU & super
// admin, jadi tombol yang tampil untuk yang lain akan ditolak DIAM-DIAM:
// PostgREST mengembalikan sukses dengan nol baris, bukan error. Lebih baik
// tombolnya memang tidak ada.
import { sayaAdminBu } from '../../core/base-scope.js';
import {
  listHargaAktif,
  riwayatHarga,
  pasangHargaBaru,
  perbaikiHarga,
  setKetersediaan,
  menuTanpaHarga,
  jumlahMasihBawaan
} from './harga-outlet.service.js';

/**
 * Admin Portal → Menu → Harga per Outlet.
 *
 * ============ INI SUMBER KEBENARAN HARGA ============
 *
 * Sejak `0099`, `record_sales()` membaca harga dari sini dan TIDAK punya
 * cadangan ke `products.sale_price`. Menu yang belum berharga di sebuah outlet
 * membuat SELURUH transaksi penjualan di outlet itu ditolak.
 *
 * Karena itu layar ini bukan sekadar layar konfigurasi — daftar "belum ada
 * harga" di bawah adalah daftar hal yang akan membuat staff gagal menyimpan
 * penjualan di tengah jam sibuk. Ia ditaruh di ATAS tabel, bukan di bawah.
 *
 * ============ MENAIKKAN HARGA ≠ MEMPERBAIKI HARGA ============
 *
 * Dua tombol berbeda, sengaja:
 *
 *   "Ubah harga"    -> baris BARU mulai tanggal tertentu. Harga lama ditutup
 *                      otomatis oleh trigger dan tetap tersimpan. Transaksi
 *                      lama tidak tersentuh.
 *   "Perbaiki"      -> menyunting baris yang sedang berlaku. Untuk SALAH KETIK
 *                      saja. Riwayatnya tidak bertambah.
 *
 * Kalau keduanya digabung jadi satu tombol "edit", riwayat harga akan hilang
 * setiap kali harga naik — dan bersamanya hilang kemampuan menjawab "berapa
 * harga menu ini bulan lalu" untuk menu yang kebetulan tidak terjual hari itu.
 */

const rp = (n) => (n == null ? '—' : formatRupiah(n));

export async function renderHargaOutletTab(content, ctx) {
  content.innerHTML = loadingHtml('Memuat outlet…');

  let outlets;
  let bolehUbah = false;
  try {
    const [daftar, admin] = await Promise.all([
      listOutletsForBu(ctx.businessUnitId),
      sayaAdminBu(ctx.businessUnitId).catch(() => false)
    ]);
    outlets = daftar.filter((o) => o.is_active !== false);
    bolehUbah = admin;
  } catch (error) {
    content.innerHTML = `<p class="error-text">Gagal memuat outlet: ${escapeHtml(error?.message ?? String(error))}</p>`;
    return;
  }
  if (!outlets.length) {
    content.innerHTML = '<p class="report-note">BU ini belum punya outlet aktif, jadi harga belum bisa ditempelkan ke mana pun.</p>';
    return;
  }

  content.innerHTML = `
    <div class="module-header"><div class="module-header-title">🏷️ Harga per Outlet</div></div>
    <p class="report-note" style="margin-bottom:12px">
      Harga jual menempel pada <strong>outlet</strong>, bukan pada Business Unit — satu menu bisa berbeda harga
      di tiap outlet. Harga inilah yang dipakai saat penjualan dicatat.
      Mengubah harga membuat <strong>baris baru</strong>; harga lama tetap tersimpan dan transaksi lama tidak berubah.
    </p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">
      <div class="field" style="margin:0;flex:1;min-width:180px">
        <label style="font-size:0.72rem">Outlet</label>
        <select id="hg-outlet">
          <option value="">Semua outlet</option>
          ${outlets.map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="margin:0;flex:1;min-width:180px">
        <label style="font-size:0.72rem">Cari menu</label>
        <input type="search" id="hg-cari" placeholder="nama menu…" />
      </div>
    </div>
    <div id="hg-isi">${loadingHtml('Memuat harga…')}</div>
  `;

  const state = { outletId: '', cari: '', bolehUbah };

  content.querySelector('#hg-outlet').addEventListener('change', (e) => {
    state.outletId = e.target.value;
    gambar(content, ctx, state, outlets);
  });
  content.querySelector('#hg-cari').addEventListener('input', (e) => {
    state.cari = e.target.value.trim().toLowerCase();
    gambar(content, ctx, state, outlets);
  });

  await gambar(content, ctx, state, outlets);
}

async function gambar(content, ctx, state, outlets) {
  const isi = content.querySelector('#hg-isi');
  isi.innerHTML = loadingHtml('Memuat harga…');

  let harga;
  let products;
  try {
    [harga, products] = await Promise.all([listHargaAktif(ctx.businessUnitId), listProducts(ctx.businessUnitId)]);
  } catch (error) {
    isi.innerHTML = `<p class="error-text">Gagal memuat: ${escapeHtml(error?.message ?? String(error))}</p>`;
    return;
  }

  const kurang = menuTanpaHarga({ outlets, products, hargaAktif: harga });
  const bawaan = jumlahMasihBawaan(harga);

  const namaOutlet = new Map(outlets.map((o) => [o.id, o.name]));
  const namaMenu = new Map(products.map((p) => [p.id, p.name]));

  const tampil = harga
    .filter((h) => (!state.outletId || h.outlet_id === state.outletId))
    .filter((h) => !state.cari || (namaMenu.get(h.product_id) ?? '').toLowerCase().includes(state.cari))
    .sort(
      (a, b) =>
        (namaOutlet.get(a.outlet_id) ?? '').localeCompare(namaOutlet.get(b.outlet_id) ?? '') ||
        (namaMenu.get(a.product_id) ?? '').localeCompare(namaMenu.get(b.product_id) ?? '')
    );

  isi.innerHTML = `
    ${
      state.bolehUbah
        ? ''
        : `<p class="report-note" style="margin-bottom:12px">Kamu bisa <strong>melihat</strong> harga di sini, tapi mengubahnya perlu izin admin BU.</p>`
    }
    ${panelBelumBerharga(kurang, state)}
    ${
      bawaan > 0
        ? `<p class="report-note" style="margin-bottom:12px">
             <strong>${bawaan} harga masih persis hasil pengisian awal</strong> — semua outlet menerima angka yang sama
             dari harga acuan BU. Selama belum disesuaikan, profitabilitas per outlet akan menampilkan margin yang
             identik di semua outlet. Itu bukan kesimpulan; itu tanda harganya belum dibedakan.
           </p>`
        : ''
    }

    ${
      tampil.length
        ? `<div class="table-scroll">
             <table class="data-table table-freeze-1">
               <thead><tr><th>Menu</th><th>Outlet</th><th>Harga</th><th>Kemasan</th><th>Fee/Promo</th><th>Berlaku sejak</th><th>Aksi</th></tr></thead>
               <tbody>
                 ${tampil
                   .map(
                     (h) => `<tr${h.is_available ? '' : ' style="opacity:0.55"'}>
                       <td>${escapeHtml(namaMenu.get(h.product_id) ?? '-')}</td>
                       <td>${escapeHtml(namaOutlet.get(h.outlet_id) ?? '-')}</td>
                       <td><strong>${rp(h.selling_price)}</strong>${
                         h.is_available ? '' : '<br /><span style="font-size:0.72rem">tidak dijual</span>'
                       }</td>
                       <td>${rp(h.packaging_cost)}</td>
                       <td>${formatNum(h.fee_online_percent, 1)}% / ${formatNum(h.promo_percent, 1)}%</td>
                       <td>${escapeHtml(h.effective_from)}</td>
                       <td>
                         <div style="display:flex;gap:6px;flex-wrap:wrap">
                           ${
                             state.bolehUbah
                               ? `<button class="primary" data-ubah="${h.id}" style="min-height:38px">Ubah harga</button>
                                  <button data-perbaiki="${h.id}" style="min-height:38px">Perbaiki</button>`
                               : ''
                           }
                           <button data-riwayat="${h.id}" style="min-height:38px">Riwayat</button>
                           ${
                             state.bolehUbah
                               ? `<button data-tersedia="${h.id}" data-nilai="${h.is_available ? '0' : '1'}" style="min-height:38px">
                                    ${h.is_available ? 'Setop jual' : 'Jual lagi'}
                                  </button>`
                               : ''
                           }
                         </div>
                       </td>
                     </tr>`
                   )
                   .join('')}
               </tbody>
             </table>
           </div>`
        : '<p class="report-note">Tidak ada harga pada saringan ini.</p>'
    }
  `;

  const cariBaris = (id) => harga.find((h) => h.id === id);
  const muatUlang = () => gambar(content, ctx, state, outlets);

  isi.querySelectorAll('[data-ubah]').forEach((b) =>
    b.addEventListener('click', () => bukaUbahHarga(cariBaris(b.dataset.ubah), namaMenu, namaOutlet, muatUlang))
  );
  isi.querySelectorAll('[data-perbaiki]').forEach((b) =>
    b.addEventListener('click', () => bukaPerbaiki(cariBaris(b.dataset.perbaiki), namaMenu, muatUlang))
  );
  isi.querySelectorAll('[data-riwayat]').forEach((b) =>
    b.addEventListener('click', () => bukaRiwayat(cariBaris(b.dataset.riwayat), namaMenu, namaOutlet))
  );
  isi.querySelectorAll('[data-tersedia]').forEach((b) =>
    b.addEventListener(
      'click',
      sekaliJalan(async () => {
        try {
          await setKetersediaan(b.dataset.tersedia, b.dataset.nilai === '1');
          toast('Ketersediaan diperbarui.', 'success');
          await muatUlang();
        } catch (error) {
          toast(error.message ?? 'Gagal mengubah ketersediaan.', 'error');
        }
      })
    )
  );

  isi.querySelector('#hg-isi-kurang')?.addEventListener('click', () =>
    bukaIsiMassal(ctx, kurang, products, muatUlang)
  );
}

/**
 * Daftar outlet × menu yang belum berharga.
 *
 * DI ATAS tabel, bukan di bawah: sejak 0099 ini bukan informasi tambahan
 * melainkan daftar hal yang akan menolak transaksi staff.
 */
function panelBelumBerharga(kurang, state) {
  if (!kurang.length) return '';
  const tampil = state.outletId ? kurang.filter((k) => k.outletId === state.outletId) : kurang;
  if (!tampil.length) return '';

  return `
    <div class="report-note" style="border-left-color:#b91c1c;background:#fff5f5;margin-bottom:14px">
      <strong>${tampil.length} menu belum punya harga di outletnya.</strong>
      <p style="margin:6px 0">
        Penjualan menu ini akan <strong>ditolak seluruhnya</strong> — bukan tersimpan dengan omzet Rp 0.
        Itu disengaja: omzet nol yang tersimpan diam-diam merusak margin, BEP, dan tidak akan ketahuan dari opname.
      </p>
      <div class="table-scroll" style="margin:8px 0">
        <table class="data-table">
          <thead><tr><th>Outlet</th><th>Menu</th></tr></thead>
          <tbody>
            ${tampil
              .slice(0, 25)
              .map((k) => `<tr><td>${escapeHtml(k.outlet)}</td><td>${escapeHtml(k.menu)}</td></tr>`)
              .join('')}
          </tbody>
        </table>
      </div>
      ${tampil.length > 25 ? `<p style="margin:0 0 8px">…dan ${tampil.length - 25} lagi.</p>` : ''}
      ${state.bolehUbah ? '<button class="primary" id="hg-isi-kurang" style="min-height:44px">Isi harga sekaligus</button>' : ''}
    </div>`;
}

async function bukaUbahHarga(baris, namaMenu, namaOutlet, muatUlang) {
  if (!baris) return;
  const nilai = await formDialog({
    title: `Ubah harga — ${namaMenu.get(baris.product_id) ?? ''}`,
    description:
      `Outlet ${namaOutlet.get(baris.outlet_id) ?? '-'}. Harga sekarang ${formatRupiah(baris.selling_price)}. ` +
      'Harga baru dibuat sebagai baris tersendiri; harga lama otomatis ditutup sehari sebelum tanggal berlaku, ' +
      'dan transaksi yang sudah tercatat tidak berubah.',
    submitText: 'Simpan harga baru',
    fields: [
      { name: 'selling_price', label: 'Harga jual baru', type: 'money', required: true, value: baris.selling_price },
      { name: 'effective_from', label: 'Berlaku mulai', type: 'date', required: true, value: todayWIB() },
      { name: 'packaging_cost', label: 'Biaya kemasan per porsi', type: 'money', value: baris.packaging_cost },
      { name: 'fee_online_percent', label: 'Fee marketplace (%)', type: 'number', value: baris.fee_online_percent },
      { name: 'promo_percent', label: 'Promo (%)', type: 'number', value: baris.promo_percent },
      { name: 'notes', label: 'Catatan', type: 'text' }
    ]
  });
  if (!nilai) return;

  try {
    await pasangHargaBaru({
      businessUnitId: baris.business_unit_id,
      outletId: baris.outlet_id,
      productId: baris.product_id,
      sellingPrice: nilai.selling_price,
      packagingCost: nilai.packaging_cost || 0,
      feeOnlinePercent: Number(nilai.fee_online_percent) || 0,
      promoPercent: Number(nilai.promo_percent) || 0,
      effectiveFrom: nilai.effective_from,
      notes: nilai.notes
    });
    toast('Harga baru tersimpan. Harga lama tetap tercatat di riwayat.', 'success');
    await muatUlang();
  } catch (error) {
    toast(error.message ?? 'Gagal menyimpan harga.', 'error');
  }
}

async function bukaPerbaiki(baris, namaMenu, muatUlang) {
  if (!baris) return;
  const yakin = await confirmDialog({
    title: 'Perbaiki harga yang sedang berlaku?',
    message:
      'Ini untuk membetulkan SALAH KETIK, bukan untuk menaikkan harga. Riwayatnya tidak bertambah — ' +
      'angka lama akan hilang. Untuk kenaikan harga, pakai "Ubah harga".',
    confirmText: 'Ya, perbaiki'
  });
  if (!yakin) return;

  const nilai = await formDialog({
    title: `Perbaiki — ${namaMenu.get(baris.product_id) ?? ''}`,
    submitText: 'Simpan perbaikan',
    fields: [
      { name: 'selling_price', label: 'Harga jual', type: 'money', required: true, value: baris.selling_price },
      { name: 'packaging_cost', label: 'Biaya kemasan', type: 'money', value: baris.packaging_cost },
      { name: 'fee_online_percent', label: 'Fee marketplace (%)', type: 'number', value: baris.fee_online_percent },
      { name: 'promo_percent', label: 'Promo (%)', type: 'number', value: baris.promo_percent },
      { name: 'notes', label: 'Catatan', type: 'text', value: baris.notes ?? '' }
    ]
  });
  if (!nilai) return;

  try {
    await perbaikiHarga(baris.id, {
      sellingPrice: nilai.selling_price,
      packagingCost: nilai.packaging_cost || 0,
      feeOnlinePercent: Number(nilai.fee_online_percent) || 0,
      promoPercent: Number(nilai.promo_percent) || 0,
      notes: nilai.notes
    });
    toast('Harga diperbaiki.', 'success');
    await muatUlang();
  } catch (error) {
    toast(error.message ?? 'Gagal memperbaiki harga.', 'error');
  }
}

async function bukaRiwayat(baris, namaMenu, namaOutlet) {
  if (!baris) return;
  let daftar = [];
  try {
    daftar = await riwayatHarga({ outletId: baris.outlet_id, productId: baris.product_id });
  } catch (error) {
    toast(error.message ?? 'Gagal memuat riwayat.', 'error');
    return;
  }

  const { infoDialog } = await import('../../core/ui.js');
  infoDialog({
    title: `Riwayat harga — ${namaMenu.get(baris.product_id) ?? ''} @ ${namaOutlet.get(baris.outlet_id) ?? ''}`,
    bodyHtml: `
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Harga</th><th>Berlaku</th><th>Catatan</th></tr></thead>
          <tbody>
            ${daftar
              .map(
                (h) => `<tr>
                  <td>${formatRupiah(h.selling_price)}</td>
                  <td>${escapeHtml(h.effective_from)} — ${h.effective_to ? escapeHtml(h.effective_to) : '<em>sekarang</em>'}</td>
                  <td>${escapeHtml(h.notes ?? '')}</td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
      <p class="report-note" style="margin-top:10px">
        Transaksi yang sudah tercatat memakai harga saat itu (<code>sales.unit_price</code>) dan
        <strong>tidak berubah</strong> walau harga di sini diubah.
      </p>`
  });
}

/**
 * Isi harga untuk banyak outlet × menu sekaligus.
 *
 * Memakai harga acuan BU sebagai nilai awal — itu satu-satunya angka yang
 * tersedia. Dikatakan apa adanya di dialognya supaya tidak dikira harga yang
 * sudah benar per outlet.
 */
async function bukaIsiMassal(ctx, kurang, products, muatUlang) {
  const acuan = new Map(products.map((p) => [p.id, p.sale_price]));
  const bisa = kurang.filter((k) => acuan.get(k.productId) != null);
  const tanpaAcuan = kurang.length - bisa.length;

  if (!bisa.length) {
    toast('Tidak ada harga acuan yang bisa dipakai. Isi dulu harga di Master Produk, atau isi satu per satu.', 'warning');
    return;
  }

  const nilai = await formDialog({
    title: 'Isi harga sekaligus',
    description:
      `${bisa.length} menu akan diisi dengan harga acuan BU-nya masing-masing.` +
      (tanpaAcuan ? ` ${tanpaAcuan} menu dilewati karena acuannya juga kosong.` : '') +
      ' Semua outlet mendapat angka yang SAMA — sesuaikan yang berbeda setelahnya.',
    submitText: `Isi ${bisa.length} harga`,
    fields: [{ name: 'effective_from', label: 'Berlaku mulai', type: 'date', required: true, value: todayWIB() }]
  });
  if (!nilai) return;

  let sukses = 0;
  const gagal = [];
  for (const k of bisa) {
    try {
      await pasangHargaBaru({
        businessUnitId: ctx.businessUnitId,
        outletId: k.outletId,
        productId: k.productId,
        sellingPrice: acuan.get(k.productId),
        effectiveFrom: nilai.effective_from,
        notes: 'Diisi massal dari harga acuan BU.'
      });
      sukses++;
    } catch (error) {
      // Dikumpulkan, bukan menghentikan sisanya. Satu baris yang gagal (mis.
      // rentangnya bertabrakan) tidak boleh membatalkan puluhan yang berhasil —
      // dan yang gagal harus disebutkan namanya, bukan dihitung saja.
      gagal.push(`${k.outlet} · ${k.menu}: ${error.message ?? 'gagal'}`);
    }
  }

  toast(
    gagal.length ? `${sukses} harga terisi, ${gagal.length} gagal — lihat rincian di bawah.` : `${sukses} harga terisi.`,
    gagal.length ? 'warning' : 'success'
  );
  if (gagal.length) {
    const { infoDialog } = await import('../../core/ui.js');
    infoDialog({
      title: 'Yang tidak jadi terisi',
      bodyHtml: `<ul>${gagal.map((g) => `<li>${escapeHtml(g)}</li>`).join('')}</ul>`
    });
  }
  await muatUlang();
}
