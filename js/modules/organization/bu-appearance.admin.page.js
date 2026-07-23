import { getBusinessUnit, updateBuTheme, uploadBuLogo } from './organization.service.js';
import { toast } from '../../core/ui.js';

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
    document.getElementById('theme-error').textContent = '';
    try {
      await updateBuTheme(businessUnitId, { theme_color: document.getElementById('theme-color-input').value });
      toast('Warna tema disimpan. Staff lihat perubahannya setelah login ulang.', 'success');
    } catch (error) {
      const msg = error.message ?? 'Gagal menyimpan warna.';
      document.getElementById('theme-error').textContent = msg;
      toast(msg, 'error');
    }
  });

  document.getElementById('btn-save-logo').addEventListener('click', async () => {
    document.getElementById('logo-error').textContent = '';
    const file = document.getElementById('logo-input').files[0];
    if (!file) return toast('Pilih file logo dulu.', 'warning');
    try {
      await uploadBuLogo(businessUnitId, file);
      toast('Logo berhasil diperbarui.', 'success');
      await renderBuAppearancePage(container, { businessUnitId });
    } catch (error) {
      const msg = error.message ?? 'Gagal upload logo.';
      document.getElementById('logo-error').textContent = msg;
      toast(msg, 'error');
    }
  });
}
