import { toast, confirmDialog, formDialog, infoDialog } from '../../core/ui.js';
import { listOutletsSayaKelola } from '../../core/my-outlets.js';
import {
  listBuOutlets,
  listAllItems,
  createItem,
  updateItem,
  deleteItem,
  listAllSessions,
  createSession,
  updateSession,
  deleteSession,
  listRunsForAdmin,
  getRunItems,
  getChecklistPhotoUrl,
  getChecklistPhotoUrls,
  getItemSessionMap,
  setItemSessions,
  getItemOutletMap,
  setItemCakupan
} from './cleaning.service.js';
import { monthRangeWIB, todayWIB } from '../../core/dates.js';
import { perkiraanBerikutnya, labelJadwal } from './jadwal-item.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';

const TABS = [
  { key: 'items', label: 'Item Aktivitas' },
  { key: 'sessions', label: 'Sesi' },
  { key: 'report', label: 'Rekap' }
];

export async function renderCleaningAdminPage(container, { businessUnitId }) {
  container.innerHTML = `
    <h1>Daily Activities</h1>
    <div class="tab-bar">
      ${TABS.map((t, i) => `<button class="tab-btn ${i === 0 ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>`).join('')}
    </div>
    <div id="clean-admin-content"></div>
  `;
  const content = document.getElementById('clean-admin-content');
  // DUA daftar, dan bedanya penting:
  //   `outlets`       — yang boleh DILIHAT. Untuk menampilkan NAMA outlet pada
  //                     item/sesi yang sudah ada. Kalau dipakai daftar sempit,
  //                     item milik outlet lain tampil sebagai "Outlet" tanpa nama.
  //   `outletsKelola` — yang boleh DIATUR. Hanya untuk memilih CAKUPAN saat
  //                     membuat/mengubah item & sesi, karena itu yang menulis.
  const [outlets, outletsKelola] = await Promise.all([
    listBuOutlets(businessUnitId).catch(() => []),
    listOutletsSayaKelola(businessUnitId).catch(() => [])
  ]);
  async function showTab(key) {
    container.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === key));
    if (key === 'items') await renderItemsTab(content, businessUnitId, outlets, outletsKelola);
    if (key === 'sessions') await renderSessionsTab(content, businessUnitId, outlets, outletsKelola);
    if (key === 'report') await renderReportTab(content, businessUnitId);
  }
  container.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
  await showTab('items');
}

// ---- Tab: Item ----

async function renderItemsTab(content, businessUnitId, outlets = [], outletsKelola = []) {
  content.innerHTML = loadingHtml('Memuat…', { baris: 5 });
  let items, sessions, petaSesi, petaOutlet;
  try {
    // Item BU + item SEMUA outlet, supaya tidak ada yang "hilang" karena filter.
    items = await listAllItems(businessUnitId);
    sessions = await listAllSessions(businessUnitId).catch(() => []);
    petaSesi = await getItemSessionMap(items.map((i) => i.id));
    petaOutlet = await getItemOutletMap(items.map((i) => i.id));
  } catch (error) {
    content.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  const namaSesi = new Map((sessions ?? []).map((x) => [x.id, x.name]));
  content.innerHTML = `
    <div class="page-header">
      <h2 style="font-size:1.05rem;margin:0">Item Aktivitas</h2>
      <button class="primary" id="btn-new-item" style="max-width:180px">+ Tambah Item</button>
    </div>
    <p style="font-size:0.8rem;color:var(--color-text-muted);margin:0 0 10px;max-width:70ch">
      Item <strong>Semua outlet</strong> adalah standar BU dan hanya bisa diubah Admin BU.
      Admin outlet bisa menambah item <strong>khusus outletnya</strong> — item itu
      <em>ditambahkan</em> di atas standar BU, bukan menggantikannya.
      <br />Kolom <strong>Sesi</strong>: item yang belum ditugaskan berlaku di <em>semua</em> sesi.
      Begitu kamu menugaskannya ke satu sesi, ia <strong>berhenti muncul di sesi lain</strong>.
    </p>
    <div class="table-scroll"><table class="data-table">
      <thead><tr><th>Urutan</th><th>Item</th><th>Jadwal</th><th>Berlaku di</th><th>Sesi</th><th>Status</th><th>Aksi</th></tr></thead>
      <tbody>
        ${items
          .map(
            (it) => `
          <tr>
            <td>${it.sort_order}</td>
            <td>${escapeHtml(it.label)}</td>
            <td style="font-size:0.85rem">${
              labelJadwal(it.interval_days) ??
              '<span style="color:var(--color-text-muted)">tiap hari</span>'
            }</td>
            <td style="font-size:0.82rem">${
              it.outlet_id
                ? escapeHtml(outlets.find((o) => o.id === it.outlet_id)?.name ?? 'Outlet')
                : (petaOutlet.get(it.id) ?? []).length
                  ? (petaOutlet.get(it.id) ?? [])
                      .map((oid) => `<span class="badge" style="font-size:0.68rem">${escapeHtml(outlets.find((o) => o.id === oid)?.name ?? 'Outlet')}</span>`)
                      .join(' ')
                  : '<span class="badge badge-approved" style="font-size:0.68rem">Semua outlet</span>'
            }</td>
            <td style="font-size:0.82rem">${
              (petaSesi.get(it.id) ?? []).length
                ? petaSesi
                    .get(it.id)
                    .map((sid) => `<span class="badge" style="font-size:0.68rem">${escapeHtml(namaSesi.get(sid) ?? 'Sesi')}</span>`)
                    .join(' ')
                : '<span style="color:var(--color-text-muted)">Semua sesi</span>'
            }</td>
            <td>${it.is_active ? 'Aktif' : 'Nonaktif'}</td>
            <td style="white-space:nowrap">
              <button class="btn-item-sessions" data-id="${it.id}" data-label="${escapeAttr(it.label)}" title="Atur sesi mana yang memakai item ini">Sesi</button>
              <button class="btn-edit-item" data-json='${escapeAttr(JSON.stringify(it))}'>Edit</button>
              <button class="btn-del-item" data-id="${it.id}">Hapus</button>
            </td>
          </tr>`
          )
          .join('') || '<tr><td colspan="6">Belum ada item.</td></tr>'}
      </tbody>
    </table></div>
  `;

  content.querySelectorAll('.btn-item-sessions').forEach((btn) =>
    btn.addEventListener('click', () => openItemSessionDialog(content, businessUnitId, outlets, sessions ?? [], btn.dataset.id, btn.dataset.label, petaSesi.get(btn.dataset.id) ?? []))
  );
  document.getElementById('btn-new-item').addEventListener('click', () => openItemDialog(content, businessUnitId, null, outlets, petaOutlet, outletsKelola));
  content.querySelectorAll('.btn-edit-item').forEach((btn) =>
    btn.addEventListener('click', () => openItemDialog(content, businessUnitId, JSON.parse(btn.dataset.json), outlets, petaOutlet, outletsKelola))
  );
  content.querySelectorAll('.btn-del-item').forEach((btn) =>
    btn.addEventListener('click', sekaliJalan(async () => {
      const ok = await confirmDialog({ title: 'Hapus item?', confirmText: 'Hapus', danger: true });
      if (!ok) return;
      try {
        await deleteItem(btn.dataset.id);
        toast('Item dihapus.', 'success');
        await renderItemsTab(content, businessUnitId, outlets, outletsKelola);
      } catch (error) {
        toast(error.message ?? 'Gagal menghapus.', 'error');
      }
    }))
  );
}

/**
 * Pilih sesi mana saja yang memakai satu item.
 *
 * Memakai deretan checkbox, bukan multi-select: di layar HP, `<select multiple>`
 * praktis tidak bisa dipakai — memilih dua opsi butuh menahan tombol yang tidak
 * ada di papan ketik sentuh.
 */
async function openItemSessionDialog(content, businessUnitId, outlets, sessions, itemId, label, terpilih) {
  if (!sessions.length) {
    return toast('Belum ada sesi di BU ini. Buat sesinya dulu di tab Sesi.', 'warning');
  }
  const dipilih = new Set(terpilih);
  const values = await formDialog({
    title: `Sesi untuk "${label}"`,
    description:
      'Centang sesi yang memakai item ini. Kalau TIDAK ada yang dicentang, item ini berlaku di semua sesi — ' +
      'itu juga perilaku sebelum fitur ini ada.',
    fields: sessions.map((s) => ({
      name: `s_${s.id}`,
      label: `${s.name}${s.outlet_id ? ` — ${outlets.find((o) => o.id === s.outlet_id)?.name ?? 'outlet'}` : ' (semua outlet)'}`,
      type: 'checkbox',
      value: dipilih.has(s.id)
    })),
    submitText: 'Simpan'
  });
  if (!values) return;

  const baru = sessions.filter((s) => values[`s_${s.id}`]).map((s) => s.id);
  try {
    await setItemSessions(itemId, baru);
    toast(baru.length ? `Item dipakai di ${baru.length} sesi.` : 'Item kembali berlaku di semua sesi.', 'success');
    await renderItemsTab(content, businessUnitId, outlets, outletsKelola);
  } catch (error) {
    toast(error.message ?? 'Gagal menyimpan.', 'error');
  }
}

async function openItemDialog(content, businessUnitId, existing, outlets = [], petaOutlet = new Map(), outletsKelola = []) {
  const isEdit = !!existing;
  // Keadaan awal disatukan dari DUA sumber: kolom `outlet_id` (satu outlet) dan
  // tabel daftar (beberapa outlet). Dua sumber untuk satu pertanyaan memang
  // rawan, tapi memisahkannya begitu yang menentukan siapa boleh menyunting —
  // lihat catatan di migration 0076.
  const outletAwal = existing
    ? existing.outlet_id
      ? [existing.outlet_id]
      : petaOutlet.get(existing.id) ?? []
    : [];
  const modeAwal = existing && outletAwal.length ? 'pilih' : 'semua';
  const values = await formDialog({
    title: isEdit ? 'Edit Item' : 'Tambah Item',
    fields: [
      { name: 'label', label: 'Nama Item', type: 'text', required: true, value: existing?.label ?? '' },
      // Cakupan kini BISA diubah saat mengedit. Dulu dikunci karena
      // memindahkannya mengubah ceklis outlet lain — itu benar, tapi jalan
      // keluarnya salah: yang dibutuhkan peringatan, bukan larangan. Melarang
      // memaksa admin membuat item kembar lalu menonaktifkan yang lama, dan dua
      // item bernama sama dengan riwayat terpisah jauh lebih membingungkan.
      {
        name: 'cakupan',
        label: 'Berlaku di',
        type: 'select',
        value: modeAwal,
        help:
          'Pilih "Outlet tertentu" lalu centang outletnya di bawah — bisa satu, bisa beberapa. ' +
          (existing ? 'Mengubahnya langsung mengubah ceklis outlet yang terkait; riwayat pengerjaan yang sudah ada tidak ikut berubah.' : ''),
        options: [
          { value: 'semua', label: 'Semua outlet BU (standar)' },
          { value: 'pilih', label: 'Outlet tertentu (bisa lebih dari satu)' }
        ]
      },
      // Checkbox, bukan <select multiple>: di HP, memilih dua opsi di
      // select-multiple butuh menahan tombol yang tidak ada di papan ketik
      // sentuh. Semuanya ditampilkan sekaligus; yang menentukan tetap pilihan
      // "Berlaku di" di atas, supaya tidak ada aturan tersirat semacam
      // "kalau tidak ada yang dicentang berarti semua".
      // Daftar KELOLA, bukan daftar lihat: mencentang outlet yang bukan
      // wewenangnya akan ditolak `cio_write` (0076), dan penolakannya muncul
      // setelah orangnya menekan Simpan.
      ...outletsKelola.map((o) => ({
        name: `o_${o.id}`,
        label: o.name,
        type: 'checkbox',
        value: outletAwal.includes(o.id)
      })),
      {
        name: 'interval_days',
        label: 'Dikerjakan tiap berapa hari',
        type: 'number',
        min: 1,
        max: 365,
        value: existing?.interval_days ?? 1,
        // Dihitung dari TERAKHIR DIKERJAKAN, bukan tanggal tetap — dan itu
        // harus disebut, karena kedua tafsirnya sama-sama masuk akal dan
        // menghasilkan jadwal yang berbeda.
        help:
          '1 = setiap hari (standar). Isi 2 untuk dua hari sekali, 7 untuk seminggu sekali. ' +
          'Dihitung dari TERAKHIR item ini dikerjakan di outlet bersangkutan — bukan dari tanggal tetap. ' +
          'Kalau terlewat, item tetap muncul sampai dikerjakan.'
      },
      { name: 'sort_order', label: 'Urutan', type: 'number', min: 0, value: existing?.sort_order ?? 0 },
      ...(isEdit ? [{ name: 'is_active', label: 'Aktif', type: 'checkbox', value: existing.is_active }] : [])
    ],
    submitText: 'Simpan'
  });
  if (!values) return;

  // PRATINJAU sebelum menyimpan, hanya kalau memang berjadwal.
  //
  // Ditampilkan sebagai PERKIRAAN dengan alasannya, bukan sebagai kalender
  // pasti: karena hitungannya dari terakhir dikerjakan, tanggal kedua dan
  // seterusnya mengandaikan itemnya dikerjakan TEPAT pada tanggal sebelumnya.
  // Menyebutnya "jadwal" akan membuat admin menjanjikan ke stafnya sesuatu yang
  // tidak dijamin sistemnya.
  const intervalBaru = Number(values.interval_days);
  if (Number.isFinite(intervalBaru) && intervalBaru > 1) {
    const tanggal = perkiraanBerikutnya({ hariIni: todayWIB(), terakhir: null, interval: intervalBaru, jumlah: 5 });
    const lanjut = await confirmDialog({
      title: `Muncul ${labelJadwal(intervalBaru)}`,
      message:
        `<p>Kalau <strong>${escapeHtml(values.label)}</strong> dikerjakan tepat waktu, ia akan muncul di Staff App pada:</p>` +
        `<ul style="margin:6px 0 0 16px;padding:0">${tanggal.map((t) => `<li>${tanggalPanjang(t)}</li>`).join('')}</ul>` +
        `<p style="margin-top:8px;font-size:0.85rem;color:var(--color-text-muted)">
           Ini <strong>perkiraan</strong>. Hitungannya dari terakhir dikerjakan, jadi kalau telat sehari,
           tanggal-tanggal sesudahnya ikut bergeser. Item yang terlewat tetap muncul sampai dikerjakan.
         </p>`,
      confirmText: 'Simpan'
    });
    if (!lanjut) return;
  }

  try {
    if (isEdit) {
      const pilihan = values.cakupan === 'pilih' ? outletsKelola.filter((o) => values[`o_${o.id}`]).map((o) => o.id) : [];
      if (values.cakupan === 'pilih' && !pilihan.length) {
        return toast('Centang minimal satu outlet, atau pilih "Semua outlet BU".', 'warning');
      }
      const berubah = JSON.stringify([...outletAwal].sort()) !== JSON.stringify([...pilihan].sort());
      if (berubah) {
        const namaOutlet = (ids) => (ids.length ? ids.map((id) => outlets.find((o) => o.id === id)?.name ?? 'outlet').join(', ') : 'semua outlet BU');
        const ok = await confirmDialog({
          title: 'Ubah cakupan item?',
          message:
            `"${existing.label}" akan berlaku di ${namaOutlet(pilihan)} (sebelumnya ${namaOutlet(outletAwal)}). ` +
            'Ceklis di outlet terkait langsung berubah mulai sesi berikutnya. Riwayat pengerjaan yang sudah tercatat tidak terpengaruh.',
          confirmText: 'Simpan'
        });
        if (!ok) return;
      }
      await updateItem(existing.id, {
        label: values.label,
        interval_days: values.interval_days,
        sort_order: Number(values.sort_order) || 0,
        is_active: values.is_active
      });
      if (berubah) await setItemCakupan(existing.id, pilihan);
      toast(berubah ? 'Cakupan item diperbarui.' : 'Item diperbarui.', 'success');
    } else {
      const pilihan = values.cakupan === 'pilih' ? outletsKelola.filter((o) => values[`o_${o.id}`]).map((o) => o.id) : [];
      if (values.cakupan === 'pilih' && !pilihan.length) {
        return toast('Centang minimal satu outlet, atau pilih "Semua outlet BU".', 'warning');
      }
      // Dibuat dengan satu outlet dulu (atau BU), baru cakupannya ditetapkan.
      // `createItem` tidak dibuat menerima daftar supaya aturan "1 outlet =
      // dimiliki outlet itu" cuma ditulis di SATU tempat: setItemCakupan().
      const baru = await createItem({
        businessUnitId,
        outletId: pilihan.length === 1 ? pilihan[0] : null,
        label: values.label,
        interval_days: values.interval_days,
        sort_order: Number(values.sort_order) || 0
      });
      if (pilihan.length > 1 && baru?.id) await setItemCakupan(baru.id, pilihan);
      toast('Item ditambahkan.', 'success');
    }
    await renderItemsTab(content, businessUnitId, outlets, outletsKelola);
  } catch (error) {
    toast(error.message ?? 'Gagal menyimpan item.', 'error');
  }
}

// ---- Tab: Sesi ----

async function renderSessionsTab(content, businessUnitId, outlets = [], outletsKelola = []) {
  content.innerHTML = loadingHtml('Memuat…', { baris: 5 });
  let sessions;
  try {
    sessions = await listAllSessions(businessUnitId);
  } catch (error) {
    content.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  content.innerHTML = `
    <div class="page-header">
      <h2 style="font-size:1.05rem;margin:0">Sesi Aktivitas (mis. Buka, Tutup)</h2>
      <button class="primary" id="btn-new-session" style="max-width:180px">+ Tambah Sesi</button>
    </div>
    <table class="data-table">
      <thead><tr><th>Urutan</th><th>Sesi</th><th>Berlaku di</th><th>Status</th><th>Aksi</th></tr></thead>
      <tbody>
        ${sessions
          .map(
            (s) => `
          <tr>
            <td>${s.sort_order}</td>
            <td>${escapeHtml(s.name)}</td>
            <td style="font-size:0.82rem">${
              s.outlet_id
                ? escapeHtml(outlets.find((o) => o.id === s.outlet_id)?.name ?? 'Outlet')
                : '<span class="badge badge-approved" style="font-size:0.68rem">Semua outlet</span>'
            }</td>
            <td>${s.is_active ? 'Aktif' : 'Nonaktif'}</td>
            <td>
              <button class="btn-edit-session" data-json='${escapeAttr(JSON.stringify(s))}'>Edit</button>
              <button class="btn-del-session" data-id="${s.id}">Hapus</button>
            </td>
          </tr>`
          )
          .join('') || '<tr><td colspan="5">Belum ada sesi.</td></tr>'}
      </tbody>
    </table>
  `;
  document.getElementById('btn-new-session').addEventListener('click', () => openSessionDialog(content, businessUnitId, null, outlets, outletsKelola));
  content.querySelectorAll('.btn-edit-session').forEach((btn) =>
    btn.addEventListener('click', () => openSessionDialog(content, businessUnitId, JSON.parse(btn.dataset.json), outlets, outletsKelola))
  );
  content.querySelectorAll('.btn-del-session').forEach((btn) =>
    btn.addEventListener('click', sekaliJalan(async () => {
      const ok = await confirmDialog({ title: 'Hapus sesi?', confirmText: 'Hapus', danger: true });
      if (!ok) return;
      try {
        await deleteSession(btn.dataset.id);
        toast('Sesi dihapus.', 'success');
        await renderSessionsTab(content, businessUnitId, outlets, outletsKelola);
      } catch (error) {
        toast(error.message ?? 'Gagal menghapus.', 'error');
      }
    }))
  );
}

async function openSessionDialog(content, businessUnitId, existing, outlets = [], outletsKelola = []) {
  const isEdit = !!existing;
  const values = await formDialog({
    title: isEdit ? 'Edit Sesi' : 'Tambah Sesi',
    fields: [
      { name: 'name', label: 'Nama Sesi', type: 'text', required: true, value: existing?.name ?? '', placeholder: 'mis. Buka' },
      {
        name: 'outlet_id',
        label: 'Berlaku di',
        type: 'select',
        value: existing?.outlet_id ?? '',
        help: existing
          ? 'Mengubahnya langsung mengubah daftar sesi di outlet yang terkait. Riwayat pengerjaan yang sudah ada tidak ikut berubah.'
          : 'Admin outlet hanya bisa membuat sesi khusus outletnya sendiri.',
        options: [{ value: '', label: 'Semua outlet BU (standar)' }, ...outletsKelola.map((o) => ({ value: o.id, label: `Khusus ${o.name}` }))]
      },
      { name: 'sort_order', label: 'Urutan', type: 'number', min: 0, value: existing?.sort_order ?? 0 },
      ...(isEdit ? [{ name: 'is_active', label: 'Aktif', type: 'checkbox', value: existing.is_active }] : [])
    ],
    submitText: 'Simpan'
  });
  if (!values) return;
  try {
    if (isEdit) {
      const cakupanBaru = values.outlet_id || null;
      const pindah = (existing.outlet_id ?? null) !== cakupanBaru;
      if (pindah) {
        const dari = existing.outlet_id ? outlets.find((o) => o.id === existing.outlet_id)?.name ?? 'outlet' : 'semua outlet BU';
        const ke = cakupanBaru ? outlets.find((o) => o.id === cakupanBaru)?.name ?? 'outlet' : 'semua outlet BU';
        const ok = await confirmDialog({
          title: 'Pindahkan cakupan sesi?',
          message: `Sesi "${existing.name}" akan berpindah dari ${dari} ke ${ke}. Daftar sesi di outlet terkait langsung berubah. Riwayat pengerjaan tidak terpengaruh.`,
          confirmText: 'Pindahkan'
        });
        if (!ok) return;
      }
      await updateSession(existing.id, {
        name: values.name,
        sort_order: Number(values.sort_order) || 0,
        is_active: values.is_active,
        outlet_id: cakupanBaru
      });
      toast(pindah ? 'Sesi dipindahkan & diperbarui.' : 'Sesi diperbarui.', 'success');
    } else {
      await createSession({
        businessUnitId,
        outletId: values.outlet_id || null,
        name: values.name,
        sort_order: Number(values.sort_order) || 0
      });
      toast('Sesi ditambahkan.', 'success');
    }
    await renderSessionsTab(content, businessUnitId, outlets, outletsKelola);
  } catch (error) {
    toast(error.message ?? 'Gagal menyimpan sesi.', 'error');
  }
}

// ---- Tab: Rekap ----

async function renderReportTab(content, businessUnitId) {
  let outlets;
  try {
    outlets = await listBuOutlets(businessUnitId);
  } catch (error) {
    content.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  content.innerHTML = `
    <div class="inline-card" style="max-width:600px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="margin:0"><label>Outlet</label>
        <select id="rep-outlet"><option value="">Semua outlet</option>${outlets.map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0"><label>Dari</label><input type="date" id="rep-from" value="${monthRangeWIB().from}" /></div>
      <div class="field" style="margin:0"><label>Sampai</label><input type="date" id="rep-to" value="${monthRangeWIB().to}" /></div>
      <button class="primary" id="rep-go" style="max-width:120px">Tampilkan</button>
    </div>
    <div id="rep-result"></div>
  `;
  const run = () => loadReport(content, businessUnitId);
  document.getElementById('rep-go').addEventListener('click', run);
  await run();
}

async function loadReport(content, businessUnitId) {
  const outletId = content.querySelector('#rep-outlet').value || '';
  const dateFrom = content.querySelector('#rep-from').value || '';
  const dateTo = content.querySelector('#rep-to').value || '';
  const result = content.querySelector('#rep-result');
  result.innerHTML = loadingHtml('Memuat…', { baris: 5 });
  let runs;
  try {
    runs = await listRunsForAdmin({ businessUnitId, outletId, dateFrom, dateTo });
  } catch (error) {
    result.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
    return;
  }
  // Semua signed URL bukti diambil SEKALI untuk seluruh halaman. Satu permintaan
  // per baris akan menembakkan ratusan koneksi berbarengan dan sebagian tertunda
  // lama — hasilnya tabel yang tampak "sebagian fotonya rusak".
  const semuaPath = runs.flatMap((r) => [r.photo_path, ...(r.checklist_run_items ?? []).map((i) => i.photo_path)]);
  const fotoUrl = await getChecklistPhotoUrls(semuaPath).catch(() => new Map());

  /** Sampai 3 thumbnail + sisanya sebagai angka. Kolom tabel bukan galeri. */
  function selBukti(r) {
    const paths = [...(r.checklist_run_items ?? []).map((i) => i.photo_path), r.photo_path].filter(Boolean);
    if (!paths.length) return '<span style="color:var(--color-text-muted)">–</span>';
    const tampil = paths.slice(0, 3);
    const sisa = paths.length - tampil.length;
    return `<div style="display:flex;gap:4px;align-items:center">
      ${tampil
        .map((p) => {
          const url = fotoUrl.get(p);
          return url
            ? `<img src="${escapeHtml(url)}" alt="Bukti" class="ck-thumb" data-path="${escapeHtml(p)}"
                 style="width:34px;height:34px;object-fit:cover;border-radius:5px;cursor:pointer;border:1px solid var(--color-border)" />`
            : `<button class="btn-run-photo" data-path="${escapeHtml(p)}" title="Buka foto">📷</button>`;
        })
        .join('')}
      ${sisa > 0 ? `<span style="font-size:0.74rem;color:var(--color-text-muted)">+${sisa}</span>` : ''}
    </div>`;
  }

  result.innerHTML = `
    <div class="table-scroll" style="margin-top:16px"><table class="data-table">
      <thead><tr><th>Tanggal</th><th>Outlet</th><th>Sesi</th><th>Oleh</th><th>Bukti</th><th>Catatan</th><th>Aksi</th></tr></thead>
      <tbody>
        ${runs
          .map(
            (r) => `
          <tr>
            <td>${r.run_date}<div style="font-size:0.72rem;color:var(--color-text-muted)">${jamOf(r.created_at)}</div></td>
            <td>${escapeHtml(r.outlets?.name ?? '-')}</td>
            <td>${escapeHtml(r.checklist_sessions?.name ?? '-')}</td>
            <td>${escapeHtml(r.user_profiles?.full_name ?? '-')}
              <div style="font-size:0.7rem;color:var(--color-text-muted)">memulai sesi</div></td>
            <td>${selBukti(r)}</td>
            <td>${escapeHtml(r.notes ?? '-')}</td>
            <td><button class="btn-run-detail" data-id="${r.id}">Detail</button></td>
          </tr>`
          )
          .join('') || '<tr><td colspan="7">Tidak ada data.</td></tr>'}
      </tbody>
    </table></div>
  `;

  // Thumbnail diklik -> buka besar. Dibuat ulang signed URL-nya, bukan memakai
  // yang di <img>: yang ini berumur 1 jam dan bisa sudah kedaluwarsa kalau
  // halamannya dibuka lama.
  result.querySelectorAll('.ck-thumb').forEach((img) =>
    img.addEventListener('click', async () => {
      try {
        const url = await getChecklistPhotoUrl(img.dataset.path);
        if (url) window.open(url, '_blank');
      } catch (error) {
        toast(error.message ?? 'Gagal membuka foto.', 'error');
      }
    })
  );

  result.querySelectorAll('.btn-run-photo').forEach((btn) =>
    btn.addEventListener('click', async () => {
      try {
        const url = await getChecklistPhotoUrl(btn.dataset.path);
        if (url) window.open(url, '_blank');
      } catch (error) {
        toast(error.message ?? 'Gagal membuka foto.', 'error');
      }
    })
  );
  result.querySelectorAll('.btn-run-detail').forEach((btn) =>
    btn.addEventListener('click', async () => {
      try {
        const items = await getRunItems(btn.dataset.id);
        // Foto per item (sejak migration 0052). Semua signed URL diambil sekali.
        const fotoUrl = await getChecklistPhotoUrls(items.map((i) => i.photo_path));
        const bodyHtml = items.length
          ? `<div style="display:flex;flex-direction:column;gap:8px">${items
              .map((i) => {
                const url = i.photo_path ? fotoUrl.get(i.photo_path) : null;
                return `<div style="display:flex;gap:10px;align-items:flex-start">
                  ${
                    url
                      ? `<a href="${escapeAttr(url)}" target="_blank" rel="noopener"><img src="${escapeAttr(url)}" alt="" loading="lazy"
                          style="width:64px;height:64px;object-fit:cover;border-radius:8px;background:#eee;border:1px solid var(--color-border,#e3e3e3)" /></a>`
                      : // DIBEDAKAN, karena artinya sama sekali berbeda:
                        //   tidak dicentang -> memang tidak dikerjakan, wajar tanpa foto;
                        //   dicentang tanpa foto -> pekerjaan yang diakui tanpa bukti.
                        // Menampilkan keduanya sebagai "tanpa foto" membuat yang
                        // kedua tenggelam di antara yang pertama.
                        i.checked
                        ? `<span style="width:64px;height:64px;display:inline-flex;align-items:center;justify-content:center;text-align:center;border-radius:8px;background:var(--color-bg);color:var(--color-danger);font-size:0.64rem;flex-shrink:0;border:1px solid var(--color-danger)">tanpa bukti</span>`
                        : `<span style="width:64px;height:64px;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;background:#f2f2f2;color:var(--color-text-muted);font-size:0.66rem;flex-shrink:0">tidak dikerjakan</span>`
                  }
                  <span style="flex:1;min-width:0">
                    <span style="font-weight:600">${i.checked ? '✅' : '⬜'} ${escapeHtml(i.checklist_items?.label ?? '-')}</span>
                    ${
                      // Pengerja per ITEM (0071). Satu sesi bisa dilanjutkan
                      // rekan satu outlet, jadi nama di tingkat sesi tidak cukup
                      // — ia hanya menyebut siapa yang memulai.
                      i.checked
                        ? `<div style="font-size:0.74rem;color:var(--color-text-muted)">${escapeHtml(i.pengerja?.full_name ?? 'Staff')}${i.done_at ? ` · ${jamOf(i.done_at)}` : ''}</div>`
                        : ''
                    }
                    ${i.note ? `<div style="font-size:0.76rem;color:var(--color-text-muted)">${escapeHtml(i.note)}</div>` : ''}
                  </span>
                </div>`;
              })
              .join('')}</div>`
          : '<p>Tidak ada item.</p>';
        const tanpaBukti = items.filter((i) => i.checked && !i.photo_path).length;
        await infoDialog({
          title: 'Detail Aktivitas',
          bodyHtml:
            (tanpaBukti
              ? `<p class="error-text" style="margin:0 0 10px">${tanpaBukti} item dicentang tanpa foto bukti.
                   Baris seperti ini hanya mungkin berasal dari sebelum aturan fotonya ditegakkan di database (migration 0070).</p>`
              : '') + bodyHtml
        });
      } catch (error) {
        toast(error.message ?? 'Gagal memuat detail.', 'error');
      }
    })
  );
}

/** Jam WIB dari timestamp, untuk kolom Tanggal di rekap. */
function jamOf(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
}

/** Tanggal panjang untuk pratinjau: "Rabu, 19 Agu 2026". */
function tanggalPanjang(iso) {
  // Ditambah 'T00:00:00' supaya diurai sebagai waktu LOKAL. Tanpa itu string
  // tanggal polos diurai sebagai UTC, dan di WIB namanya bergeser ke hari
  // sebelumnya — pratinjau yang menyebut hari yang salah lebih buruk daripada
  // tidak ada pratinjau.
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}
