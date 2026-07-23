import { openCameraCapture } from './camera-capture.js';

/**
 * Buka kamera khusus registrasi wajah (tanpa watermark, wajib wajah jelas
 * terdeteksi baru bisa dikonfirmasi). Dipakai saat staff pertama kali mau
 * clock in dan belum punya descriptor wajah tersimpan.
 *
 * @returns {Promise<number[]>} descriptor wajah (128 angka), siap disimpan.
 */
export async function openFaceRegistration() {
  const { descriptor } = await openCameraCapture({
    getWatermarkText: () => '',
    extractFace: true,
    requireFace: true
  });
  if (!descriptor) throw new Error('Wajah tidak berhasil terdeteksi. Silakan coba lagi.');
  return descriptor;
}
