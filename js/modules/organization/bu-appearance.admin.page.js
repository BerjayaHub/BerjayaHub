import { getBusinessUnit, updateBuTheme, uploadBuLogo } from './organization.service.js';

export async function renderBuAppearancePage(container, { businessUnitId }) {
  container.innerHTML = `<p>Memuat...</p>`;
  const bu = await getBusinessUnit(businessUnitId);

  container.innerHTML = `
    <h1>Tampilan Business Unit</h1>
    <p style="color:var(--color-text-muted)">Pengaturan ini berlaku untuk <strong>${bu.name}</strong> — warna & logo akan otomatis dipakai di Staff App untuk staff BU ini.</p>

    <div class="inline-card" style="max-width:420px">
      <h3 style="margin-top:0">Warna Tema</h3>
      <div class="field">
        <label>Warna Utama</label>
        <input type="color" id="theme-color-input" value="${bu.theme_color}" style="height:44px;padding:4px" />
      </div>
      <button class="primary" id="btn-save-theme">Simpan Warna</button>
      <p class="error-text" id="theme-error"></p>
    </div>

    <div class="inline-card" style="max-width:420px;margin-top:16px">
      <h3 style="margin-top:0">Logo</h3>
      ${bu.logo_url ? `<img src="${bu.logo_url}" alt="Logo saat ini" style="width:80px;height:80px;object-fit:cover;border-radius:12px;border:1px solid var(--color-border);margin-bottom:10px" />` : '<p style="font-size:0.85rem;color:var(--color-text-muted)">Belum ada logo, masih pakai default.</p>'}
      <div class="field">
        <label>Ganti Logo (JPG/PNG, disarankan persegi)</label>
        <input type="file" accept="image/png, image/jpeg" id="logo-input" />
      </div>
      <button class="primary" id="btn-save-logo">Upload Logo</button>
      <p class="error-text" id="logo-error"></p>
    </div>
  `;

  document.getElementById('btn-save-theme').addEventListener('click', async () => {
    try {
      await updateBuTheme(businessUnitId, { theme_color: document.getElementById('theme-color-input').value });
      alert('Warna tema disimpan. Staff akan lihat perubahan setelah login ulang.');
    } catch (error) {
      document.getElementById('theme-error').textContent = error.message ?? 'Gagal menyimpan warna.';
    }
  });

  document.getElementById('btn-save-logo').addEventListener('click', async () => {
    const file = document.getElementById('logo-input').files[0];
    if (!file) return alert('Pilih file logo dulu.');
    try {
      await uploadBuLogo(businessUnitId, file);
      await renderBuAppearancePage(container, { businessUnitId });
    } catch (error) {
      document.getElementById('logo-error').textContent = error.message ?? 'Gagal upload logo.';
    }
  });
}
