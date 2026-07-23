/**
 * Face recognition presensi, pakai face-api.js (fork @vladmandic, aktif
 * di-maintain) — 100% jalan di browser (client-side), gratis, tanpa API key.
 * Model weights di-load dari CDN jsDelivr, tidak perlu hosting sendiri.
 *
 * Alur:
 * 1. Staff daftar wajah sekali (lihat face-registration.js) -> descriptor
 *    (array 128 angka yang mewakili wajah) disimpan di Supabase.
 * 2. Setiap clock in/out, ambil descriptor dari foto yang baru diambil,
 *    lalu dibandingkan (euclidean distance) dengan descriptor acuan.
 * 3. Jarak di bawah MATCH_THRESHOLD -> dianggap cocok.
 */

const FACE_API_VERSION = '1.7.15';
const FACE_API_URL = `https://cdn.jsdelivr.net/npm/@vladmandic/face-api@${FACE_API_VERSION}/dist/face-api.esm.js`;
const MODEL_URL = `https://cdn.jsdelivr.net/npm/@vladmandic/face-api@${FACE_API_VERSION}/model`;

// Jarak euclidean di bawah ini dianggap "wajah yang sama". 0.6 adalah nilai
// default yang direkomendasikan face-api.js untuk verifikasi 1-ke-1.
export const MATCH_THRESHOLD = 0.6;

let faceapiModule = null;
let modelsLoaded = false;
let loadingPromise = null;

/**
 * Load library + model sekali saja (di-cache), dipanggil sebelum deteksi.
 * Aman dipanggil berkali-kali (idempotent).
 */
export async function loadFaceModels() {
  if (modelsLoaded) return faceapiModule;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    faceapiModule = await import(FACE_API_URL);
    await faceapiModule.tf.setBackend('webgl').catch(() => faceapiModule.tf.setBackend('cpu'));
    await Promise.all([
      faceapiModule.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapiModule.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
      faceapiModule.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
    ]);
    modelsLoaded = true;
    return faceapiModule;
  })();

  return loadingPromise;
}

/**
 * Deteksi 1 wajah dari elemen gambar/video/canvas, dan hitung descriptor-nya.
 * Return null kalau tidak ada wajah terdeteksi (bukan error, biar caller
 * bisa kasih pesan yang sesuai seperti "Wajah tidak terdeteksi, coba lagi").
 */
export async function getFaceDescriptor(imageEl) {
  const faceapi = await loadFaceModels();
  const detection = await faceapi
    .detectSingleFace(imageEl, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
    .withFaceLandmarks(true)
    .withFaceDescriptor();

  if (!detection) return null;
  return Array.from(detection.descriptor); // Float32Array -> array biasa, siap disimpan sebagai jsonb
}

/** Jarak euclidean antara 2 descriptor (array angka panjang 128). */
export function descriptorDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/** true kalau 2 descriptor dianggap wajah yang sama. */
export function isSameFace(a, b) {
  return descriptorDistance(a, b) <= MATCH_THRESHOLD;
}
