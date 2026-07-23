import { loadFaceModels, getFaceDescriptor } from './face-recognition.js';

/**
 * Buka kamera depan langsung di dalam app (bukan file picker/galeri), staff ambil
 * foto, watermark (teks) otomatis ditempel ke foto sebelum dikonfirmasi.
 *
 * @param {() => string} getWatermarkText - dipanggil TEPAT SAAT foto diambil,
 *   supaya jam di watermark akurat sesuai waktu jepret, bukan waktu modal dibuka.
 * @param {boolean} [extractFace=true] - kalau true, coba deteksi & ambil face
 *   descriptor dari frame sebelum watermark ditempel (dipakai buat face recognition).
 * @param {boolean} [requireFace=false] - kalau true, tombol "Pakai Foto" baru aktif
 *   setelah wajah berhasil terdeteksi (dipakai saat registrasi wajah, wajib jelas).
 * @returns {Promise<{blob: Blob, descriptor: number[]|null}>} foto JPEG + descriptor
 *   wajah (null kalau extractFace=false atau tidak ada wajah terdeteksi).
 */
export function openCameraCapture({ getWatermarkText, extractFace = true, requireFace = false }) {
  return new Promise((resolve, reject) => {
    const overlay = document.createElement('div');
    overlay.className = 'camera-overlay';
    overlay.innerHTML = `
      <div class="camera-modal">
        <video id="camera-video" autoplay playsinline muted></video>
        <canvas id="camera-canvas" style="display:none"></canvas>
        <p id="camera-error" class="error-text"></p>
        <div class="camera-controls">
          <button id="camera-shoot" class="primary" disabled>Ambil Foto</button>
          <button id="camera-retake" style="display:none">Ulangi</button>
          <button id="camera-confirm" class="primary" style="display:none">Pakai Foto</button>
          <button id="camera-cancel">Batal</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const video = overlay.querySelector('#camera-video');
    const canvas = overlay.querySelector('#camera-canvas');
    const errorEl = overlay.querySelector('#camera-error');
    const shootBtn = overlay.querySelector('#camera-shoot');
    const retakeBtn = overlay.querySelector('#camera-retake');
    const confirmBtn = overlay.querySelector('#camera-confirm');
    const cancelBtn = overlay.querySelector('#camera-cancel');
    let stream;

    function cleanup() {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      overlay.remove();
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then((s) => {
        stream = s;
        video.srcObject = s;
        shootBtn.disabled = false;
      })
      .catch((err) => {
        errorEl.textContent = 'Tidak bisa akses kamera depan: ' + (err.message ?? err.name ?? 'izin ditolak.');
      });

    // Load model face recognition di background begitu modal dibuka, supaya
    // pas tombol "Ambil Foto" ditekan modelnya sudah siap (tidak nunggu lama).
    if (extractFace) loadFaceModels().catch(() => {});

    cancelBtn.addEventListener('click', () => {
      cleanup();
      reject(new Error('Pengambilan foto dibatalkan.'));
    });

    let capturedDescriptor = null;

    shootBtn.addEventListener('click', async () => {
      shootBtn.disabled = true;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      if (extractFace) {
        errorEl.textContent = 'Mendeteksi wajah...';
        try {
          capturedDescriptor = await getFaceDescriptor(canvas);
          errorEl.textContent = capturedDescriptor
            ? ''
            : requireFace
              ? 'Wajah tidak terdeteksi jelas. Pastikan wajah menghadap kamera & pencahayaan cukup, lalu ambil ulang foto.'
              : 'Wajah tidak terdeteksi jelas. Kamu tetap bisa lanjut, tapi sebaiknya ulangi dengan pencahayaan lebih baik & wajah menghadap kamera.';
        } catch (err) {
          capturedDescriptor = null;
          errorEl.textContent = '';
        }
      }

      const text = getWatermarkText();
      if (text) {
        const fontSize = Math.max(16, Math.round(canvas.height * 0.035));
        ctx.font = `bold ${fontSize}px sans-serif`;
        const padding = fontSize * 0.6;
        const textWidth = ctx.measureText(text).width;
        const barHeight = fontSize + padding * 2;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, canvas.height - barHeight, Math.min(canvas.width, textWidth + padding * 2), barHeight);
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, padding, canvas.height - barHeight / 2);
      }

      video.style.display = 'none';
      canvas.style.display = 'block';
      shootBtn.style.display = 'none';
      shootBtn.disabled = false;
      retakeBtn.style.display = 'inline-block';
      confirmBtn.style.display = 'inline-block';
      confirmBtn.disabled = requireFace && !capturedDescriptor;
    });

    retakeBtn.addEventListener('click', () => {
      capturedDescriptor = null;
      errorEl.textContent = '';
      video.style.display = 'block';
      canvas.style.display = 'none';
      shootBtn.style.display = 'inline-block';
      retakeBtn.style.display = 'none';
      confirmBtn.style.display = 'none';
    });

    confirmBtn.addEventListener('click', () => {
      canvas.toBlob(
        (blob) => {
          cleanup();
          if (blob) resolve({ blob, descriptor: capturedDescriptor });
          else reject(new Error('Gagal memproses foto.'));
        },
        'image/jpeg',
        0.85
      );
    });
  });
}

/** Format watermark standar: "Nama Outlet; 07.56; Clock In" */
export function formatWatermarkText(outletName, kindLabel) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const time = `${pad(now.getHours())}.${pad(now.getMinutes())}`;
  return `${outletName}; ${time}; ${kindLabel}`;
}
