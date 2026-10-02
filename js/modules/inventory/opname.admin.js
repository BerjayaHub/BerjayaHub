/**
 * Tab OPNAME di Admin Portal — membuka, menutup, membatalkan, dan riwayatnya.
 *
 * KENAPA MEMBUKA & MENUTUP ADA DI SINI, BUKAN DI STAFF APP: menutup sesi
 * mengubah stok dan tidak bisa dibatalkan. Staff tetap yang menghitung dan
 * mengisi — yang dipindah ke admin hanya dua tombol yang akibatnya permanen.
 *
 * Tombolnya disembunyikan untuk yang bukan Admin BU, TAPI ITU BUKAN PENGAMAN.
 * Penjaganya ada di `is_bu_admin()` di dalam RPC-nya (0085); yang di sini cuma
 * supaya orang tidak menekan sesuatu yang pasti ditolak.
 */

import { toast, confirmDialog, formDialog, infoDialog } from '../../core/ui.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { sayaAdminBu } from '../../core/base-scope.js';
import { listProducts, listRecipesFull, computeCosts } from '../product/product.service.js';
import { exportTableXLSX } from '../../core/xlsx.js';
import { susunLaporanOpname } from './laporan-opname.js';
import {
  bukaOpname,
  tutupOpname,
  batalkanOpname,
  riwayatOpname,
  itemOpname,
  revisiHitungan,
  hapusHitungan
} from './opname.service.js';
import { bolehRevisiOpname, deltaRevisi, deltaHapus, teksDelta, itemTerpakai } from './revisi-opname.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Jumlah bahan untuk dibaca manusia.
 *
 * Dipakai di dialog revisi, dan sengaja TIDAK memakai pemisah ribuan: dialog
 * itu berisi angka sebelum & sesudah berdampingan, dan "4.600" yang berarti
 * empat ribu enam ratus bersebelahan dengan "4,6" yang berarti empat koma enam
 * adalah persis kebingungan yang sedang diperbaiki di layar itu.
 */
const angkaSederhana = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '-';
  return String(Math.round(v * 10000) / 10000).replace('.', ',');
};

const LABEL_STATUS = {
  open: '<span class="badge badge-pending">Sedang berjalan</span>',
  closed: '<span class="badge badge-approved">Selesai</span>',
  cancelled: '<span class="badge" style="background:#eee;color:#666">Dibatalkan</span>'
};

export async function renderOpnameAdmin(container, { businessUnitId, outlets }) {
  container.innerHTML = loadingHtml('Memuat opname…', { baris: 4 });

  let bolehKelola = false;
  let daftar = [];
  let hpp = new Map();
  let semuaProduk = [];
  try {
    const [adminBu, riwayat, products, recipes] = await Promise.all([
      sayaAdminBu(businessUnitId).catch(() => false),
      riwayatOpname(businessUnitId),
      listProducts(businessUnitId),
      listRecipesFull(businessUnitId)
    ]);
    bolehKelola = adminBu;
    daftar = riwayat;
    hpp = computeCosts(products, recipes);
    // Bahan = bahan baku + setengah jadi. Aturan yang SAMA dengan form bahan
    // di Staff App (`inventory.page.js`): produk bertipe `finished` adalah menu
    // jadi, dan menu tidak pernah punya stok fisik untuk dihitung. Menawarkannya
    // di sini akan membuat admin menuliskan hitungan opname ke barang yang
    // stoknya memang tidak pernah dilacak.
    semuaProduk = products.filter((p) => p.is_active !== false && p.product_type !== 'finished');
  } catch (error) {
    container.innerHTML = `<p class="error-text">${esc(error.message ?? error)}</p>`;
    return;
  }

  const outletBelumAdaSesi = outlets.filter((o) => !daftar.some((d) => d.outlet_id === o.id && d.status === 'open'));

  /**
   * Tombol Revisi — atau KETERANGAN kenapa tidak ada.
   *
   * Sel aksi yang kosong tidak mengatakan apa pun: admin yang mencari cara
   * memperbaiki angka salah akan menyimpulkan fiturnya tidak ada, lalu
   * memperbaikinya dengan cara yang tidak berjejak. Jadi alasannya ditulis di
   * tempat tombolnya seharusnya.
   *
   * Keterangan ini hanya untuk yang MEMANG bisa mengelola — bagi yang lain,
   * "Hanya Admin BU" di setiap baris cuma keramaian; kalimat itu sudah ada
   * sekali di kepala halaman.
   */
  function revisiHtml(d) {
    if (!bolehKelola || d.status !== 'closed') return '';
    const { boleh, alasan } = bolehRevisiOpname(d, daftar, { adminBu: bolehKelola });
    if (boleh) return `<button class="opn-revisi" data-id="${d.id}" data-code="${esc(d.code)}">Revisi</button>`;
    return `<span style="font-size:0.76rem;color:var(--color-text-muted)">${esc(alasan)}</span>`;
  }

  container.innerHTML = `
    <div class="page-header">
      <h2 style="font-size:1.05rem;margin:0">Stok Opname</h2>
      ${
        bolehKelola && outletBelumAdaSesi.length
          ? '<button class="primary" id="opn-buka" style="max-width:200px">+ Buka Sesi Opname</button>'
          : ''
      }
    </div>
    <p style="color:var(--color-text-muted);font-size:0.88rem;margin:0 0 12px;max-width:640px">
      Staff mengisi hitungan lewat Staff App ke nomor yang sedang terbuka — boleh diubah berkali-kali, dan
      <strong>stok tidak bergerak sama sekali</strong> sampai sesinya ditutup di sini.
      ${bolehKelola ? '' : '<br /><strong>Hanya Admin BU & Super Admin</strong> yang bisa membuka, menutup, atau membatalkan sesi.'}
      ${
        bolehKelola
          ? '<br />Sesi yang sudah ditutup masih bisa <strong>direvisi</strong> kalau staff salah input — dan koreksinya dicatat bertanggal saat sesi itu ditutup, jadi laporan COGS periodenya ikut benar.'
          : ''
      }
    </p>
    <div class="table-scroll"><table class="data-table table-freeze-1 kartu-sempit">
      <thead><tr><th>Nomor</th><th>Tanggal</th><th>Outlet</th><th>Status</th><th>Dibuka</th><th>Ditutup</th><th>Aksi</th></tr></thead>
      <tbody>
        ${
          daftar
            .map(
              (d) => `<tr>
                <td data-label="Nomor" style="font-family:ui-monospace,Menlo,monospace;font-size:0.82rem">${esc(d.code)}</td>
                <td data-label="Tanggal">${esc(d.count_date)}</td>
                <td data-label="Outlet">${esc(d.outlets?.name ?? '-')}</td>
                <td data-label="Status">${LABEL_STATUS[d.status] ?? esc(d.status)}${
                  d.direvisi_at
                    ? `<br /><span class="badge" style="background:#fff4e5;color:#8a4b00" title="Direvisi ${esc(
                        d.perevisi?.full_name ?? '-'
                      )}">direvisi admin</span>`
                    : ''
                }</td>
                <td data-label="Dibuka" style="font-size:0.82rem">${esc(d.pembuka?.full_name ?? '-')}</td>
                <td data-label="Ditutup" style="font-size:0.82rem">${esc(d.penutup?.full_name ?? '-')}</td>
                <td data-label="Aksi">
                  <button class="opn-lihat" data-id="${d.id}">Lihat</button>
                  ${bolehKelola && d.status === 'open' ? `<button class="opn-tutup" data-id="${d.id}" data-code="${esc(d.code)}">Tutup</button>` : ''}
                  ${bolehKelola && d.status === 'open' ? `<button class="opn-batal" data-id="${d.id}" data-code="${esc(d.code)}">Batalkan</button>` : ''}
                  ${revisiHtml(d)}
                </td>
              </tr>`
            )
            .join('') || '<tr><td colspan="7">Belum ada sesi opname.</td></tr>'
        }
      </tbody>
    </table></div>
  `;

  const muat = () => renderOpnameAdmin(container, { businessUnitId, outlets });

  container.querySelector('#opn-buka')?.addEventListener(
    'click',
    sekaliJalan(async () => {
      const v = await formDialog({
        title: 'Buka Sesi Opname',
        description: 'Setelah dibuka, staff bisa mulai mengisi hitungan lewat Staff App. Stok belum berubah sampai sesi ini ditutup.',
        fields: [
          {
            name: 'outlet_id',
            label: 'Outlet',
            type: 'select',
            required: true,
            // Outlet yang SUDAH punya sesi terbuka tidak ditawarkan: membukanya
            // lagi cuma mengembalikan sesi yang sama, dan menawarkannya membuat
            // orang mengira ia sedang membuat yang baru.
            options: outletBelumAdaSesi.map((o) => ({ value: o.id, label: o.name }))
          },
          { name: 'notes', label: 'Catatan (opsional)', type: 'text', placeholder: 'mis. opname akhir bulan' }
        ],
        submitText: 'Buka Sesi'
      });
      if (!v) return;
      try {
        await bukaOpname(v.outlet_id, v.notes);
        toast('Sesi opname dibuka. Staff sudah bisa mengisi hitungan.', 'success');
        await muat();
      } catch (error) {
        toast(error.message ?? 'Gagal membuka sesi.', 'error');
      }
    })
  );

  container.querySelectorAll('.opn-tutup').forEach((btn) =>
    btn.addEventListener(
      'click',
      sekaliJalan(async () => {
        // Ringkasannya ditampilkan SEBELUM menutup, lengkap dengan nilai
        // rupiahnya. Menutup mengubah stok dan tidak bisa dibatalkan — angka
        // yang akan terjadi harus bisa dilihat dulu, bukan sesudahnya.
        const items = await itemOpname(btn.dataset.id).catch(() => []);
        const lap = susunLaporanOpname({ sesi: { code: btn.dataset.code }, items, hpp, denganNilai: true });
        const ok = await confirmDialog({
          title: `Tutup ${btn.dataset.code}?`,
          message:
            `<p><strong>${lap.jumlahItem}</strong> bahan dihitung, <strong>${lap.jumlahSelisih}</strong> berselisih.</p>` +
            `<p style="margin:6px 0">Kurang: <strong style="color:var(--color-danger)">${lap.nilaiKurangTeks}</strong> · ` +
            `Lebih: <strong>${lap.nilaiLebihTeks}</strong></p>` +
            (lap.jumlahBentrok
              ? `<p style="color:var(--color-danger)">⚠ ${lap.jumlahBentrok} bahan pernah dihitung dua orang dengan angka berbeda — periksa dulu sebelum menutup.</p>`
              : '') +
            (lap.adaTanpaHpp ? '<p style="font-size:0.85rem;color:var(--color-text-muted)">Sebagian bahan belum punya HPP, jadi nilainya belum lengkap.</p>' : '') +
            '<p style="margin-top:8px">Stok akan disesuaikan sekarang, dan <strong>tidak bisa dibatalkan</strong>. Bahan yang tidak dihitung tidak disentuh.</p>',
          confirmText: 'Tutup & sesuaikan stok',
          danger: true
        });
        if (!ok) return;
        try {
          const n = await tutupOpname(btn.dataset.id);
          toast(`${btn.dataset.code} ditutup — ${n} bahan disesuaikan.`, 'success');
          await muat();
        } catch (error) {
          toast(error.message ?? 'Gagal menutup sesi.', 'error');
        }
      })
    )
  );

  container.querySelectorAll('.opn-batal').forEach((btn) =>
    btn.addEventListener(
      'click',
      sekaliJalan(async () => {
        const v = await formDialog({
          title: `Batalkan ${btn.dataset.code}?`,
          description:
            'Sesi ditutup TANPA menyentuh stok sama sekali. Hitungan yang sudah masuk tetap tersimpan sebagai riwayat — yang dibatalkan akibatnya pada stok, bukan catatan bahwa ada orang menghitung.',
          fields: [{ name: 'alasan', label: 'Alasan pembatalan', type: 'text', required: true, placeholder: 'mis. hitungan tidak lengkap, diulang besok' }],
          submitText: 'Batalkan Sesi'
        });
        if (!v) return;
        try {
          await batalkanOpname(btn.dataset.id, v.alasan);
          toast('Sesi dibatalkan. Stok tidak berubah.', 'success');
          await muat();
        } catch (error) {
          toast(error.message ?? 'Gagal membatalkan sesi.', 'error');
        }
      })
    )
  );

  // ============ REVISI SESI YANG SUDAH DITUTUP (0155) ============
  //
  //   "setelah stock opname selesai dan ditutup, ada case staff masih salah
  //    input, apakah admin bisa mengubah hasil stock opname ini agar sesuai"
  //
  // Yang ditulis ke buku stok BUKAN angka hitungannya, melainkan SELISIH
  // terhadap angka lama — dan selisih itu tidak terlihat di layar mana pun
  // kecuali kalau sengaja ditampilkan. Kalau tandanya terbalik, stok bergeser
  // dua kali kesalahannya ke arah yang salah tanpa satu pun galat.
  //
  // Jadi pergerakannya diperlihatkan DULU, dengan angka dan tandanya, sebelum
  // ada apa pun yang tersimpan.
  container.querySelectorAll('.opn-revisi').forEach((btn) =>
    btn.addEventListener(
      'click',
      sekaliJalan(async () => {
        const sesi = daftar.find((d) => d.id === btn.dataset.id);
        let items = [];
        try {
          items = await itemOpname(btn.dataset.id);
        } catch (error) {
          toast(error.message ?? 'Gagal memuat isi sesi.', 'error');
          return;
        }

        const terpakai = itemTerpakai(items);
        const diSesi = new Map(terpakai.map((it) => [it.product_id, it]));

        // Bahan yang SUDAH dihitung lebih dulu — itulah yang 9 dari 10 kali
        // sedang dicari. Bahan yang belum dihitung menyusul di bawahnya,
        // ditandai, supaya "menambahkan yang terlewat" tidak pernah terjadi
        // karena salah pilih dari daftar yang tercampur.
        const opsi = [
          ...terpakai.map((it) => ({
            value: it.product_id,
            label: `${it.products?.name ?? '(produk terhapus)'} — dihitung ${angkaSederhana(it.counted_qty)} ${
              it.products?.base_unit ?? ''
            }`.trim(),
            hint: `sistem ${angkaSederhana(it.system_qty)}`
          })),
          ...semuaProduk
            .filter((p) => !diSesi.has(p.id))
            .map((p) => ({
              value: p.id,
              label: `${p.name} — BELUM dihitung di sesi ini`,
              hint: 'akan ditambahkan sebagai hitungan baru'
            }))
        ];

        const v = await formDialog({
          title: `Revisi ${btn.dataset.code}`,
          description:
            'Koreksinya dicatat BERTANGGAL saat sesi ini ditutup — bukan hari ini — supaya saldo stok per tanggal itu dan laporan COGS periodenya ikut benar. ' +
            'Laporan yang sudah dicetak sebelum revisi akan berbeda angkanya, karena itu alasannya wajib dan angka lamanya disimpan.',
          fields: [
            {
              name: 'aksi',
              label: 'Yang mau dilakukan',
              type: 'select',
              required: true,
              options: [
                { value: 'ubah', label: 'Perbaiki angka hitungan (atau tambahkan bahan yang terlewat)' },
                { value: 'buang', label: 'Buang baris ini — stok kembali ke angka sebelum opname' }
              ]
            },
            {
              name: 'product_id',
              label: 'Bahan',
              type: 'searchselect',
              required: true,
              placeholder: 'ketik nama bahan…',
              options: opsi
            },
            {
              name: 'counted',
              label: 'Hitungan yang benar',
              type: 'number',
              min: 0,
              step: 'any',
              placeholder: 'mis. 4.6',
              help: 'Jumlah fisik yang sesungguhnya, dalam satuan pakai. Dibiarkan kosong kalau barisnya dibuang.'
            },
            {
              name: 'alasan',
              label: 'Alasan revisi',
              type: 'text',
              required: true,
              placeholder: 'mis. staff salah input 46.000, seharusnya 4.600'
            }
          ],
          submitText: 'Lihat dampaknya'
        });
        if (!v) return;

        const it = diSesi.get(v.product_id);
        const produk = semuaProduk.find((p) => p.id === v.product_id);
        const nama = it?.products?.name ?? produk?.name ?? '(bahan)';
        const satuan = it?.products?.base_unit ?? produk?.base_unit ?? '';

        if (v.aksi === 'buang') {
          if (!it) {
            toast('Bahan ini belum dihitung di sesi itu, jadi tidak ada baris yang bisa dibuang.', 'warning');
            return;
          }
          const d = deltaHapus(it);
          const ok = await confirmDialog({
            title: `Buang hitungan ${nama}?`,
            message:
              `<p>Baris hitungannya ditandai dibuang dan <strong>tidak dihitung lagi</strong> di laporan sesi ini — tapi tidak dihapus, supaya tetap terbaca kalau ada rak yang belum dihitung.</p>` +
              `<p style="margin:6px 0">Stok <strong>${esc(nama)}</strong> bergerak <strong>${esc(
                teksDelta(d)
              )} ${esc(satuan)}</strong>, kembali ke angka sebelum opname (${esc(angkaSederhana(it.system_qty))}).</p>` +
              (d === 0
                ? '<p style="font-size:0.85rem;color:var(--color-text-muted)">Hitungannya dulu cocok dengan sistem, jadi penutupan tidak pernah menulis pergerakan apa pun — stoknya tidak berubah.</p>'
                : `<p style="font-size:0.85rem;color:var(--color-text-muted)">Dicatat bertanggal ${esc(
                    sesi?.count_date ?? '-'
                  )}, jadi laporan COGS periode itu ikut berubah.</p>`),
            confirmText: 'Buang baris ini',
            danger: true
          });
          if (!ok) return;
          try {
            const d2 = await hapusHitungan({ countId: btn.dataset.id, productId: v.product_id, alasan: v.alasan });
            toast(`Baris ${nama} dibuang — stok bergerak ${teksDelta(d2)} ${satuan}.`, 'success');
            await muat();
          } catch (error) {
            toast(error.message ?? 'Gagal membuang baris.', 'error');
          }
          return;
        }

        // ============ `Number('')` ADALAH 0, BUKAN NaN ============
        //
        // Isian ini TIDAK `required` — ia memang dibiarkan kosong saat barisnya
        // dibuang. Tanpa penjaga ini, "Perbaiki angka" dengan kotak kosong
        // tersimpan sebagai hitungan NOL: seluruh stok bahan itu dihapus dari
        // buku, bertanggal lampau, dan pesannya berbunyi "berhasil".
        const kosong = v.counted === '' || v.counted == null;
        const counted = Number(v.counted);
        if (kosong || !Number.isFinite(counted) || counted < 0) {
          toast('Isi hitungan yang benar — angka nol pun harus ditulis sebagai 0.', 'warning');
          return;
        }

        const d = it ? deltaRevisi({ lama: it.counted_qty, baru: counted }) : null;
        if (it && d === 0) {
          toast(`Angkanya sudah ${angkaSederhana(counted)} — tidak ada yang perlu direvisi.`, 'warning');
          return;
        }

        const ok = await confirmDialog({
          title: `Revisi ${nama}?`,
          message:
            (it
              ? `<p>Hitungan <strong>${esc(nama)}</strong>: ${esc(angkaSederhana(it.counted_qty))} → <strong>${esc(
                  angkaSederhana(counted)
                )}</strong> ${esc(satuan)}</p>` +
                `<p style="margin:6px 0">Stok bergerak <strong>${esc(teksDelta(d))} ${esc(satuan)}</strong>.</p>` +
                // Potret sistemnya TIDAK dibaca ulang, dan itu disebutkan karena
                // justru di situ orang menduga ada yang terlupa.
                `<p style="font-size:0.85rem;color:var(--color-text-muted)">Kolom Sistem tetap ${esc(
                  angkaSederhana(it.system_qty)
                )} — ia potret stok saat bahannya dihitung, dan membacanya ulang sekarang akan menerapkan koreksinya dua kali.</p>`
              : `<p><strong>${esc(nama)}</strong> belum dihitung di sesi ini — ia akan <strong>ditambahkan</strong> dengan hitungan ${esc(
                  angkaSederhana(counted)
                )} ${esc(satuan)}.</p>` +
                `<p style="font-size:0.85rem;color:var(--color-text-muted)">Pergerakan stoknya dihitung server dari stok bahan ini <strong>pada saat sesi ditutup</strong>, dan angka pastinya muncul sesudah tersimpan.</p>`) +
            `<p style="margin-top:8px">Dicatat bertanggal <strong>${esc(
              sesi?.count_date ?? '-'
            )}</strong> — laporan COGS periode itu ikut berubah.</p>`,
          confirmText: 'Simpan revisi',
          danger: true
        });
        if (!ok) return;
        try {
          const d2 = await revisiHitungan({
            countId: btn.dataset.id,
            productId: v.product_id,
            counted,
            alasan: v.alasan
          });
          toast(`${nama} direvisi — stok bergerak ${teksDelta(d2)} ${satuan}.`, 'success');
          await muat();
        } catch (error) {
          toast(error.message ?? 'Gagal menyimpan revisi.', 'error');
        }
      })
    )
  );

  container.querySelectorAll('.opn-lihat').forEach((btn) =>
    btn.addEventListener(
      'click',
      sekaliJalan(async () => {
        const sesi = daftar.find((d) => d.id === btn.dataset.id);
        const items = await itemOpname(btn.dataset.id).catch(() => []);
        const lap = susunLaporanOpname({
          sesi: { ...sesi, outletName: sesi?.outlets?.name },
          items,
          hpp,
          denganNilai: true
        });

        // ============ BARIS YANG DIBUANG HARUS TETAP TERLIHAT ============
        //
        // Laporannya sengaja TIDAK menghitungnya (0155), dan itu benar — tapi
        // tidak menghitung bukan berarti tidak menampilkan. Baris yang dibuang
        // karena salah paham adalah satu-satunya petunjuk bahwa ada rak yang
        // mungkin belum dihitung, dan kalau ia hilang dari layar juga, tidak
        // ada satu pun cara menemukannya lagi dari dalam aplikasi.
        const dibuang = (items ?? []).filter((it) => it?.dibuang_at);
        const htmlDibuang = dibuang.length
          ? `<p style="margin-top:10px;font-size:0.85rem"><strong>${dibuang.length} baris dibuang</strong>
               <span style="color:var(--color-text-muted)">(tidak ikut dihitung di tabel & nilai di atas)</span></p>
             <ul style="margin:4px 0 0;padding-left:18px;font-size:0.82rem;color:var(--color-text-muted)">${dibuang
               .map(
                 (it) =>
                   `<li>${esc(it.products?.name ?? '(produk terhapus)')} — dihitung ${esc(
                     angkaSederhana(it.counted_qty)
                   )}, dibuang ${esc(it.pembuang?.full_name ?? '-')}${
                     it.dibuang_alasan ? `: ${esc(it.dibuang_alasan)}` : ''
                   }</li>`
               )
               .join('')}</ul>`
          : '';

        await infoDialog({
          title: lap.judul,
          bodyHtml:
            `<p style="font-size:0.85rem;color:var(--color-text-muted)">${esc(lap.subjudul)}</p>` +
            `<p>Kurang: <strong style="color:var(--color-danger)">${lap.nilaiKurangTeks}</strong> · Lebih: <strong>${lap.nilaiLebihTeks}</strong></p>` +
            // NILAI OPNAME ditaruh terpisah dan diberi keterangan, bukan
            // disandingkan begitu saja dengan Kurang/Lebih. Ketiganya rupiah
            // tapi menjawab pertanyaan yang berbeda — dan yang ini adalah
            // angka yang dipakai laporan COGS sebagai stok akhir periode.
            `<p style="margin-top:2px">Nilai stok saat dihitung: <strong>${lap.nilaiOpnameTeks}</strong>
               <span style="font-size:0.8rem;color:var(--color-text-muted)">(dihitung × HPP — dipakai sebagai stok akhir di laporan COGS)</span></p>` +
            // Label kolom ikut menempel di tiap sel: dialog ini yang paling
            // sering dibuka di HP saat admin memeriksa selisih dari lapangan,
            // dan tabel delapan kolom di layar sempit hanya terbaca sebagai kartu.
            `<div class="table-scroll" style="max-height:320px"><table class="data-table kartu-sempit"><thead><tr>${lap.kolom
              .map((k) => `<th>${esc(k.header)}</th>`)
              .join('')}</tr></thead><tbody>${lap.baris
              .map((b) => `<tr>${b.map((sel, i) => `<td data-label="${esc(lap.kolom[i]?.header ?? '')}">${esc(sel)}</td>`).join('')}</tr>`)
              .join('')}</tbody></table></div>` +
            htmlDibuang +
            `<div style="margin-top:10px"><button id="opn-xlsx">⬇ Unduh Excel</button></div>`,
          // DIPASANG LEWAT onReady, bukan sesudah `await`. `infoDialog` baru
          // selesai saat dialognya ditutup, jadi versi sebelumnya memasang
          // listener ke tombol yang sedang dibuang — tombolnya tampak normal
          // tapi tidak pernah mengunduh apa pun.
          onReady: (body) =>
            body.querySelector('#opn-xlsx')?.addEventListener('click', async () => {
              await exportTableXLSX({
                filename: lap.namaBerkas,
                sheetName: 'Opname',
                title: lap.judul,
                subtitle: lap.subjudul,
                columns: lap.kolom,
                rows: lap.baris
              });
            })
        });
      })
    )
  );
}

