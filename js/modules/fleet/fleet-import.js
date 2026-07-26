import { listVehicles, createVehicle, updateVehicle, loadFleetMasters, ensureBrand, ensureModel, ensureArea } from './fleet.service.js';

// ---- Loader SheetJS (dari CDN, dipakai untuk baca .xlsx/.csv) ----
let xlsxPromise = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xlsxPromise) {
    xlsxPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => reject(new Error('Gagal memuat pustaka Excel (cek koneksi internet).'));
      document.head.appendChild(s);
    });
  }
  return xlsxPromise;
}

async function readRows(file) {
  const XLSX = await loadXLSX();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
}

/** Kunci baris jadi huruf kecil tanpa spasi/titik supaya judul kolom fleksibel. */
function keyOf(k) {
  return String(k)
    .trim()
    .toLowerCase()
    .replace(/[.\-_/]/g, ' ')
    .replace(/\s+/g, ' ');
}
function normalizeRow(row) {
  const o = {};
  for (const k in row) o[keyOf(k)] = row[k];
  return o;
}
/** Ambil nilai dari beberapa kemungkinan nama kolom. */
function pick(r, ...names) {
  for (const n of names) {
    const v = r[keyOf(n)];
    if (v !== undefined && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function num(v) {
  if (!v) return null;
  const n = Number(String(v).replace(/[^\d-]/g, ''));
  return Number.isFinite(n) && n !== 0 ? n : null;
}

/**
 * Tanggal -> 'YYYY-MM-DD'. Menerima 'YYYY-MM-DD', 'DD/MM/YYYY', 'DD-MM-YYYY',
 * serta serial Excel. Format Indonesia (hari dulu) diprioritaskan.
 */
function toISODate(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (dmy) {
    let [, d, m, y] = dmy;
    if (y.length === 2) y = String(2000 + Number(y));
    const dd = Number(d);
    const mm = Number(m);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    }
  }
  // Serial Excel (mis. 45658) — basis 1899-12-30.
  if (/^\d{5}$/.test(s)) {
    const dt = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
    return dt.toISOString().slice(0, 10);
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

const STATUS_MAP = {
  tersedia: 'idle',
  idle: 'idle',
  ready: 'idle',
  direntalkan: 'rented',
  rented: 'rented',
  disewa: 'rented',
  perawatan: 'maintenance',
  maintenance: 'maintenance',
  servis: 'maintenance',
  nonaktif: 'inactive',
  inactive: 'inactive'
};

const normStr = (s) => String(s ?? '').trim();
const same = (a, b) => normStr(a).toLowerCase() === normStr(b).toLowerCase();

/**
 * Import massal kendaraan dari .xlsx/.csv.
 * Merk, Tipe, dan Area Rental yang belum ada otomatis didaftarkan ke master
 * (Tipe menempel pada Merk di baris yang sama), jadi dropdown di form langsung
 * ikut terisi tanpa perlu input manual.
 */
export async function importVehicles(businessUnitId, file, { updateExisting = true } = {}) {
  const rows = await readRows(file);
  if (!rows.length) throw new Error('File kosong atau format tidak terbaca.');

  const existing = await listVehicles(businessUnitId);
  const byPlate = new Map(existing.map((v) => [normStr(v.plate_number).toLowerCase(), v]));
  const masters = await loadFleetMasters(businessUnitId);

  const result = { added: 0, updated: 0, skipped: 0, newBrands: 0, newModels: 0, newAreas: 0, errors: [] };

  for (const [i, raw] of rows.entries()) {
    const baris = i + 2; // +1 header, +1 karena manusia mulai dari 1
    const r = normalizeRow(raw);
    const plate = pick(r, 'nomor polisi', 'nopol', 'plat', 'plat nomor', 'no polisi', 'plate');
    if (!plate) continue;

    const brandName = pick(r, 'merk', 'merek', 'brand');
    const modelName = pick(r, 'tipe', 'type', 'model');
    const areaName = pick(r, 'area rental', 'area', 'rental area');
    const statusRaw = pick(r, 'status');
    const status = STATUS_MAP[statusRaw.toLowerCase()] ?? 'idle';
    if (statusRaw && !STATUS_MAP[statusRaw.toLowerCase()]) {
      result.errors.push(`Baris ${baris} (${plate}): status "${statusRaw}" tidak dikenal, dipakai "Tersedia".`);
    }

    // ---- Daftarkan master baru ----
    let brand = null;
    try {
      if (brandName) {
        brand = masters.brands.find((b) => same(b.name, brandName)) ?? null;
        if (!brand) {
          brand = await ensureBrand(businessUnitId, brandName);
          if (brand) {
            masters.brands.push(brand);
            result.newBrands++;
          }
        }
      }
      if (brand && modelName) {
        const found = masters.models.find((m) => m.brand_id === brand.id && same(m.name, modelName));
        if (!found) {
          const created = await ensureModel(businessUnitId, brand.id, modelName);
          if (created) {
            masters.models.push(created);
            result.newModels++;
          }
        }
      }
      if (areaName && !masters.areas.some((a) => same(a.name, areaName))) {
        const created = await ensureArea(businessUnitId, areaName);
        if (created) {
          masters.areas.push(created);
          result.newAreas++;
        }
      }
    } catch (e) {
      result.errors.push(`Baris ${baris} (${plate}): master gagal disimpan — ${e.message ?? e}`);
    }

    const payload = {
      business_unit_id: businessUnitId,
      plate_number: plate,
      brand: brandName || null,
      model: modelName || null,
      vehicle_type: pick(r, 'jenis', 'jenis kendaraan', 'vehicle type') || null,
      year: num(pick(r, 'tahun', 'year')),
      color: pick(r, 'warna', 'color') || null,
      chassis_number: pick(r, 'no rangka', 'nomor rangka', 'rangka', 'chassis') || null,
      engine_number: pick(r, 'no mesin', 'nomor mesin', 'mesin', 'engine') || null,
      stnk_owner_name: pick(r, 'nama stnk', 'pemilik stnk', 'atas nama', 'nama pemilik') || null,
      rental_area: areaName || null,
      status,
      stnk_number: pick(r, 'no stnk', 'nomor stnk') || null,
      stnk_tax_expiry: toISODate(pick(r, 'pajak stnk', 'jatuh tempo pajak stnk', 'pajak')),
      stnk_expiry: toISODate(pick(r, 'stnk 5 tahun', 'masa berlaku stnk', 'stnk')),
      kir_number: pick(r, 'no kir', 'nomor kir') || null,
      kir_expiry: toISODate(pick(r, 'masa kir', 'kir', 'jatuh tempo kir')),
      notes: pick(r, 'catatan', 'keterangan', 'notes') || null
    };

    const found = byPlate.get(plate.toLowerCase());
    try {
      if (found) {
        if (!updateExisting) {
          result.skipped++;
          continue;
        }
        // Jangan timpa info rental yang sedang berjalan lewat import.
        const { status: _s, ...rest } = payload;
        await updateVehicle(found.id, found.status === 'rented' ? rest : payload);
        result.updated++;
      } else {
        await createVehicle(payload);
        result.added++;
        byPlate.set(plate.toLowerCase(), { id: null, plate_number: plate, status });
      }
    } catch (e) {
      result.errors.push(`Baris ${baris} (${plate}): ${e.message ?? e}`);
    }
  }

  return result;
}

function downloadCsv(filename, content) {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadVehicleTemplate() {
  downloadCsv(
    'template-kendaraan.csv',
    'Nomor Polisi,Merk,Tipe,Jenis,Tahun,Warna,No Rangka,No Mesin,Nama STNK,Area Rental,Status,No STNK,Pajak STNK,STNK 5 Tahun,No KIR,Masa KIR,Catatan\n' +
      'B 1234 XYZ,Toyota,Avanza,Mobil,2019,Hitam,MHKM1BA3JKJ000001,1NR0000001,Budi Santoso,Jakarta Selatan,Tersedia,STNK-001,2026-08-15,2029-08-15,KIR-001,2026-09-30,\n' +
      'B 5678 ABC,Daihatsu,Xenia,Mobil,2020,Silver,MHKV5EA2JLK000002,3NR0000002,PT Berjaya Armada,Tangerang,Direntalkan,STNK-002,2026-11-02,2030-11-02,KIR-002,2026-12-20,unit armada kota\n'
  );
}
