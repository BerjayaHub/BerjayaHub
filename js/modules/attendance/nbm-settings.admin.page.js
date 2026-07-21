import { listOutletsWithGeofence } from './attendance.service.js';
import {
  getNbmConfig,
  upsertNbmConfig,
  listOvertimeTiers,
  addOvertimeTier,
  removeOvertimeTier,
  listHolidays,
  addHoliday,
  removeHoliday
} from './nbm.service.js';

export async function renderNbmSettingsTab(container, businessUnitId) {
  container.innerHTML = `<p>Memuat pengaturan NBM...</p>`;
  const outlets = await listOutletsWithGeofence(businessUnitId);

  if (!outlets.length) {
    container.innerHTML = `<p>Belum ada outlet di BU ini.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="field" style="max-width:280px">
      <label>Pilih Outlet</label>
      <select id="nbm-outlet-select">
        ${outlets.map((o) => `<option value="${o.id}">${o.name}</option>`).join('')}
      </select>
    </div>
    <div id="nbm-outlet-detail"></div>
  `;

  const select = document.getElementById('nbm-outlet-select');
  select.addEventListener('change', () => renderOutletDetail(select.value, businessUnitId));
  await renderOutletDetail(select.value, businessUnitId);
}

async function renderOutletDetail(outletId, businessUnitId) {
  const detail = document.getElementById('nbm-outlet-detail');
  detail.innerHTML = `<p>Memuat...</p>`;

  const [config, tiers, holidays] = await Promise.all([
    getNbmConfig(outletId),
    listOvertimeTiers(outletId),
    listHolidays({ businessUnitId, outletId })
  ]);

  detail.innerHTML = `
    <form class="inline-card" id="nbm-config-form" style="max-width:420px;margin-top:16px">
      <h3>Nominal NBM</h3>
      <div class="field">
        <label>NBM Normal (Rp)</label>
        <input type="number" name="base_amount" value="${config?.base_amount ?? 0}" min="0" required />
      </div>
      <div class="field">
        <label>NBM Hari Libur (Rp) — kosongkan kalau sama seperti NBM normal</label>
        <input type="number" name="holiday_amount" value="${config?.holiday_amount ?? ''}" min="0" />
      </div>
      <div class="field">
        <label>Bonus Storing (Rp)</label>
        <input type="number" name="storing_bonus_amount" value="${config?.storing_bonus_amount ?? 0}" min="0" required />
      </div>
      <button class="primary" type="submit">Simpan</button>
      <p class="error-text" id="nbm-config-error"></p>
    </form>

    <div class="inline-card" style="max-width:480px;margin-top:16px">
      <h3>Bonus Lembur Bertingkat</h3>
      <table class="data-table">
        <thead><tr><th>Lewat Jam</th><th>Bonus</th><th></th></tr></thead>
        <tbody id="nbm-tiers-body">
          ${tiers.map((t) => tierRowHtml(t)).join('') || '<tr><td colspan="3">Belum ada.</td></tr>'}
        </tbody>
      </table>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;align-items:flex-end">
        <div class="field" style="margin:0"><label>Jam (24h)</label><input type="time" id="tier-time" /></div>
        <div class="field" style="margin:0;display:flex;align-items:center;gap:6px">
          <input type="checkbox" id="tier-next-day" style="width:auto" />
          <label style="margin:0" for="tier-next-day">Keesokan hari (lewat tengah malam)</label>
        </div>
        <div class="field" style="margin:0"><label>Bonus (Rp)</label><input type="number" id="tier-amount" min="0" /></div>
        <button class="primary" id="btn-add-tier" style="max-width:100px">+ Tambah</button>
      </div>
    </div>

    <div class="inline-card" style="max-width:480px;margin-top:16px">
      <h3>Hari Libur</h3>
      <table class="data-table">
        <thead><tr><th>Tanggal</th><th>Nama</th><th></th></tr></thead>
        <tbody id="nbm-holidays-body">
          ${holidays.map((h) => holidayRowHtml(h)).join('') || '<tr><td colspan="3">Belum ada.</td></tr>'}
        </tbody>
      </table>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;align-items:flex-end">
        <div class="field" style="margin:0"><label>Tanggal</label><input type="date" id="holiday-date" /></div>
        <div class="field" style="margin:0"><label>Nama</label><input type="text" id="holiday-name" placeholder="misal: Lebaran" /></div>
        <button class="primary" id="btn-add-holiday" style="max-width:100px">+ Tambah</button>
      </div>
    </div>
  `;

  document.getElementById('nbm-config-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    try {
      await upsertNbmConfig(outletId, {
        base_amount: Number(form.base_amount.value),
        holiday_amount: form.holiday_amount.value === '' ? null : Number(form.holiday_amount.value),
        storing_bonus_amount: Number(form.storing_bonus_amount.value)
      });
    } catch (error) {
      document.getElementById('nbm-config-error').textContent = error.message ?? 'Gagal menyimpan.';
    }
  });

  document.getElementById('btn-add-tier').addEventListener('click', async () => {
    const time = document.getElementById('tier-time').value; // "HH:MM"
    const nextDay = document.getElementById('tier-next-day').checked;
    const amount = document.getElementById('tier-amount').value;
    if (!time || !amount) return alert('Isi jam dan nominal bonus dulu.');
    const [hh, mm] = time.split(':').map(Number);
    const thresholdMinutes = (nextDay ? 1440 : 0) + hh * 60 + mm;
    try {
      await addOvertimeTier(outletId, {
        threshold_minutes: thresholdMinutes,
        bonus_amount: Number(amount),
        label: `Lewat ${time}${nextDay ? ' (besok)' : ''}`
      });
      await renderOutletDetail(outletId, businessUnitId);
    } catch (error) {
      alert(error.message ?? 'Gagal menambah tingkatan lembur.');
    }
  });

  document.getElementById('btn-add-holiday').addEventListener('click', async () => {
    const date = document.getElementById('holiday-date').value;
    const name = document.getElementById('holiday-name').value.trim();
    if (!date || !name) return alert('Isi tanggal dan nama hari libur dulu.');
    try {
      await addHoliday({ holiday_date: date, name, outlet_id: outletId });
      await renderOutletDetail(outletId, businessUnitId);
    } catch (error) {
      alert(error.message ?? 'Gagal menambah hari libur.');
    }
  });

  document.querySelectorAll('.btn-remove-tier').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Hapus tingkatan lembur ini?')) return;
      await removeOvertimeTier(btn.dataset.tierId);
      await renderOutletDetail(outletId, businessUnitId);
    });
  });

  document.querySelectorAll('.btn-remove-holiday').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Hapus hari libur ini?')) return;
      await removeHoliday(btn.dataset.holidayId);
      await renderOutletDetail(outletId, businessUnitId);
    });
  });
}

function tierRowHtml(t) {
  return `
    <tr>
      <td>${t.label ?? formatThreshold(t.threshold_minutes)}</td>
      <td>Rp${Number(t.bonus_amount).toLocaleString('id-ID')}</td>
      <td><button class="btn-remove-tier" data-tier-id="${t.id}">✕</button></td>
    </tr>
  `;
}

function holidayRowHtml(h) {
  return `
    <tr>
      <td>${h.holiday_date}</td>
      <td>${h.name}</td>
      <td><button class="btn-remove-holiday" data-holiday-id="${h.id}">✕</button></td>
    </tr>
  `;
}

function formatThreshold(minutes) {
  const day = minutes >= 1440 ? ' (besok)' : '';
  const m = minutes % 1440;
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}${day}`;
}
