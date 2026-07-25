import { toast, formDialog } from '../../core/ui.js';
import {
  GENDER_OPTIONS,
  MARITAL_OPTIONS,
  GENDER_LABEL,
  MARITAL_LABEL,
  getMyProfile,
  updateProfileData,
  uploadStaffPhoto,
  getStaffPhotoUrl
} from './profile.service.js';

/**
 * Halaman Profil (Staff App): staff mengisi/mengubah data pribadinya.
 * Scope, role, modul, BU & outlet TIDAK bisa diubah di sini — itu ranah Admin Portal.
 */
export async function renderProfilePage(container, ctx = {}) {
  container.innerHTML = `<p style="color:var(--color-text-muted)">Memuat profil...</p>`;
  let profile;
  try {
    profile = await getMyProfile();
  } catch (error) {
    container.innerHTML = `<p class="error-text">Gagal memuat profil: ${error.message ?? error}</p>`;
    return;
  }
  if (!profile) {
    container.innerHTML = `<p class="error-text">Profil tidak ditemukan.</p>`;
    return;
  }
  const photoUrl = await getStaffPhotoUrl(profile.photo_path);

  const row = (label, value) => `
    <div class="profile-row">
      <span class="profile-label">${label}</span>
      <span class="profile-value">${value ? esc(value) : '<span style="color:var(--color-text-muted)">belum diisi</span>'}</span>
    </div>`;

  container.innerHTML = `
    <h1>Profil Saya</h1>
    <div class="inline-card" style="max-width:560px">
      <div class="profile-head">
        <div class="profile-avatar-wrap">
          ${photoUrl ? `<img src="${photoUrl}" alt="Foto" class="profile-avatar" />` : `<div class="profile-avatar profile-avatar-empty">${initials(profile.full_name)}</div>`}
          <button id="btn-photo" class="profile-photo-btn" title="Ganti foto">📷</button>
          <input type="file" id="photo-input" accept="image/*" hidden />
        </div>
        <div>
          <div style="font-weight:700;font-size:1.05rem">${esc(profile.full_name ?? '-')}</div>
          <div style="font-size:0.82rem;color:var(--color-text-muted)">${esc(profile.phone ?? 'No. telp belum diisi')}</div>
        </div>
      </div>

      <div class="profile-list">
        ${row('Nama sesuai KTP', profile.ktp_name)}
        ${row('No. KTP', profile.ktp_number)}
        ${row('Jenis Kelamin', GENDER_LABEL[profile.gender])}
        ${row('Alamat KTP', profile.ktp_address)}
        ${row('Kode Pos', profile.postal_code)}
        ${row('Nama Ibu Kandung', profile.mother_name)}
        ${row('Nomor Darurat', profile.emergency_contact)}
        ${row('Ukuran Baju', profile.shirt_size)}
        ${row('Ukuran Celana', profile.pants_size)}
        ${row('Ukuran Sepatu', profile.shoe_size)}
        ${row('Status Kawin', MARITAL_LABEL[profile.marital_status])}
        ${row('No. NPWP', profile.npwp)}
      </div>

      <button class="primary" id="btn-edit-profile" style="max-width:220px;margin-top:14px">Lengkapi / Ubah Data</button>
      <p style="font-size:0.76rem;color:var(--color-text-muted);margin-top:10px">
        Business Unit, outlet, role, dan akses modul diatur oleh admin — tidak bisa diubah dari sini.
      </p>
    </div>
  `;

  // Ganti foto
  const fileInput = container.querySelector('#photo-input');
  container.querySelector('#btn-photo').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      await uploadStaffPhoto(profile.id, file);
      toast('Foto profil diperbarui.', 'success');
      await renderProfilePage(container, ctx);
      ctx.onProfileUpdated?.();
    } catch (error) {
      toast(error.message ?? 'Gagal mengunggah foto.', 'error');
    }
  });

  container.querySelector('#btn-edit-profile').addEventListener('click', async () => {
    const values = await formDialog({
      title: 'Data Diri',
      description: 'Lengkapi data berikut. Data ini dipakai untuk keperluan administrasi HR.',
      fields: [
        { name: 'full_name', label: 'Nama Panggilan / Tampilan', type: 'text', required: true, value: profile.full_name ?? '' },
        { name: 'phone', label: 'No. Telp', type: 'tel', value: profile.phone ?? '' },
        { name: 'ktp_name', label: 'Nama sesuai KTP', type: 'text', value: profile.ktp_name ?? '' },
        { name: 'ktp_number', label: 'No. KTP', type: 'text', value: profile.ktp_number ?? '' },
        { name: 'gender', label: 'Jenis Kelamin', type: 'select', value: profile.gender ?? '', options: GENDER_OPTIONS },
        { name: 'ktp_address', label: 'Alamat sesuai KTP', type: 'text', value: profile.ktp_address ?? '' },
        { name: 'postal_code', label: 'Kode Pos', type: 'text', value: profile.postal_code ?? '' },
        { name: 'mother_name', label: 'Nama Ibu Kandung', type: 'text', value: profile.mother_name ?? '' },
        { name: 'emergency_contact', label: 'Nomor Darurat', type: 'tel', value: profile.emergency_contact ?? '' },
        { name: 'shirt_size', label: 'Ukuran Baju', type: 'text', value: profile.shirt_size ?? '', placeholder: 'mis. M / L / XL' },
        { name: 'pants_size', label: 'Ukuran Celana', type: 'text', value: profile.pants_size ?? '' },
        { name: 'shoe_size', label: 'Ukuran Sepatu', type: 'text', value: profile.shoe_size ?? '' },
        { name: 'marital_status', label: 'Status Kawin', type: 'select', value: profile.marital_status ?? '', options: MARITAL_OPTIONS },
        { name: 'npwp', label: 'No. NPWP', type: 'text', value: profile.npwp ?? '' }
      ],
      submitText: 'Simpan'
    });
    if (!values) return;
    try {
      await updateProfileData(profile.id, values);
      toast('Data profil tersimpan.', 'success');
      await renderProfilePage(container, ctx);
      ctx.onProfileUpdated?.();
    } catch (error) {
      toast(error.message ?? 'Gagal menyimpan data.', 'error');
    }
  });
}

export function initials(name) {
  return String(name ?? '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
