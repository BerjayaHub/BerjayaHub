-- =========================================================
-- Berjaya Hub OMS — 0190
-- PENAMBAHAN ASET: pembelian baru punya jejaknya sendiri
--
--   "tambahkan aksi tambah untuk menambahkan jumlah asset, apabila terjadi
--    pembelian baru, sehingga akan tercatat di history bukan cuma perubahan
--    angka tanpa ada riwayat nya"
--
-- =========================================================
-- ANGKA YANG BERUBAH BUKAN RIWAYAT
-- =========================================================
--
-- Sebelum ini, menambah piring hasil pembelian dilakukan dengan membuka Edit
-- dan mengetik 30 di tempat 28. Triggernya memang mencatat ("qty: 28 jadi
-- 30"), jadi secara teknis ada jejaknya — tapi jejak itu tidak menjawab satu
-- pun pertanyaan yang benar-benar ditanyakan orang enam bulan kemudian:
--
--   dibeli, dihibahkan, atau ternyata selama ini salah hitung?
--   kapan barangnya masuk — hari diketik, atau minggu lalu?
--   notanya mana?
--
-- Dan selama satu-satunya jalan adalah mengetik angka baru, "28 jadi 30" tidak
-- bisa dibedakan dari "28 jadi 30 karena yang mengetik salah lihat baris".
--
-- Bentuk perbaikannya MENIRU kerusakan aset (0170), bukan membuat pola baru:
--
--   asset_damage       -> kejadiannya; qty berkurang sebagai AKIBAT barisnya
--   asset_penambahan   -> kejadiannya; qty bertambah sebagai AKIBAT barisnya
--
-- Triggernya tetap satu-satunya pencatat angka (0170: "diisi TRIGGER supaya
-- tidak bisa terlewat lewat jalur mana pun"), dan RPC di bawah menambahkan
-- SATU baris log lagi yang menjelaskan sebabnya — persis seperti
-- `catat_kerusakan_aset`.
--
-- =========================================================
-- KENAPA MENAMBAH, BUKAN MENETAPKAN
-- =========================================================
--
-- `catat_stok_aset` (0169) menetapkan angka akhir: `qty = 30`. Untuk Edit itu
-- benar. Untuk pembelian TIDAK: dua orang yang sama-sama membuka layar saat
-- jumlahnya 28, lalu masing-masing mencatat pembelian 2 dan 3, akan saling
-- menimpa — yang terakhir menyimpan menang, dan pembelian yang satu lagi
-- hilang tanpa galat. Di sini jumlahnya DITAMBAHKAN (`qty = qty + n`) di atas
-- baris yang sudah dikunci `for update`, jadi keduanya masuk.

-- ---------------------------------------------------------
-- 1. KEJADIAN PENAMBAHAN
-- ---------------------------------------------------------
create table if not exists asset_penambahan (
  id              uuid primary key default gen_random_uuid(),
  asset_item_id   uuid not null references asset_items(id) on delete cascade,
  outlet_id       uuid not null references outlets(id) on delete cascade,

  jumlah          numeric not null check (jumlah > 0),

  -- Sumbernya PILIHAN TETAP, bukan teks bebas.
  --
  -- Teks bebas akan berisi "beli", "pembelian", "Beli baru", "PEMBELIAN" —
  -- empat ejaan untuk satu hal, dan rekap mana pun yang mengelompokkannya
  -- akan salah tanpa terlihat salah. Catatan bebas tetap ada di `catatan`.
  sumber          text not null default 'pembelian'
                  check (sumber in ('pembelian', 'hibah', 'temuan', 'kembali', 'lainnya')),
  catatan         text,

  -- Tanggal KEJADIAN, bukan tanggal pengetikan — alasannya sama dengan
  -- `asset_damage.tanggal` (0170): barang datang Sabtu, didata Senin.
  tanggal         date not null default (now() at time zone 'Asia/Jakarta')::date,

  -- Jumlah SEBELUM dan SESUDAH ikut disimpan.
  --
  -- Bisa saja dihitung ulang dari urutan kejadian, tapi hanya selama tidak ada
  -- satu pun perubahan lain di antaranya — dan Edit, kerusakan, serta transfer
  -- semuanya ikut menggeser angkanya. Disimpan, barisnya tetap bisa dibaca
  -- sendirian bertahun-tahun kemudian.
  qty_sebelum     numeric,
  qty_sesudah     numeric,

  dicatat_by      uuid references user_profiles(id) on delete set null,
  -- Namanya DISIMPAN sebagai teks: `on delete set null` pada orang yang keluar
  -- akan menghapus satu-satunya penunjuk "siapa" (0170).
  dicatat_by_nama text,
  created_at      timestamptz not null default now(),

  dibatalkan_at   timestamptz,
  dibatalkan_by   uuid references user_profiles(id) on delete set null,
  dibatalkan_by_nama text,
  alasan_batal    text
);

create index if not exists idx_asset_tambah_item on asset_penambahan(asset_item_id, outlet_id);
create index if not exists idx_asset_tambah_tanggal on asset_penambahan(outlet_id, tanggal desc);

comment on table asset_penambahan is
  'Kejadian aset bertambah (pembelian/hibah/temuan). Jumlah di asset_stock bertambah sebagai AKIBAT baris ini, bukan sebagai gantinya.';
comment on column asset_penambahan.sumber is
  'pembelian | hibah | temuan (koreksi hitung) | kembali (dari outlet lain) | lainnya. Pilihan tetap supaya bisa direkap.';

-- ---------------------------------------------------------
-- 2. RPC: catat penambahan
--
-- Wewenangnya SAMA dengan Edit (`has_outlet_scope`), bukan lebih ketat: orang
-- yang sama sudah bisa mengubah angkanya lewat Edit, dan pintu baru yang lebih
-- sempit hanya akan membuatnya kembali memakai Edit — yaitu tepat kebiasaan
-- yang sedang diperbaiki di sini.
-- ---------------------------------------------------------
create or replace function tambah_stok_aset(
  p_item uuid, p_outlet uuid, p_jumlah numeric,
  p_sumber text default 'pembelian', p_tanggal date default null, p_catatan text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_nama text;
  v_tgl date := coalesce(p_tanggal, (now() at time zone 'Asia/Jakarta')::date);
  v_sebelum numeric;
  v_sesudah numeric;
  v_id uuid;
  v_catatan text := nullif(btrim(coalesce(p_catatan, '')), '');
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if not has_outlet_scope(v_uid, p_outlet) then
    raise exception 'Aset ini di luar outlet yang bisa kamu kelola.';
  end if;
  if p_jumlah is null or p_jumlah <= 0 then
    raise exception 'Jumlah yang ditambahkan harus lebih dari nol.';
  end if;
  if p_sumber not in ('pembelian', 'hibah', 'temuan', 'kembali', 'lainnya') then
    raise exception 'Sumber "%" tidak dikenal.', p_sumber;
  end if;
  -- Tanggal mundur BOLEH, maju tidak — alasannya sama dengan 0170: tanggal
  -- maju tidak pernah berarti apa pun, dan membuat rekap bulan berjalan memuat
  -- kejadian yang belum terjadi.
  if v_tgl > (now() at time zone 'Asia/Jakarta')::date then
    raise exception 'Tanggal penambahan tidak boleh di masa depan.';
  end if;

  v_nama := nama_pengguna(v_uid);

  -- Dikunci dulu, baru ditambahkan. Lihat "KENAPA MENAMBAH, BUKAN MENETAPKAN"
  -- di kepala berkas.
  select qty into v_sebelum from asset_stock
   where asset_item_id = p_item and outlet_id = p_outlet
   for update;

  if v_sebelum is null then
    raise exception 'Barang ini belum didata di outlet tersebut. Pakai "Tambah Aset" untuk mendatanya pertama kali.';
  end if;

  update asset_stock
     set qty = qty + p_jumlah, updated_by = v_uid, updated_at = now()
   where asset_item_id = p_item and outlet_id = p_outlet
  returning qty into v_sesudah;

  insert into asset_penambahan (asset_item_id, outlet_id, jumlah, sumber, catatan, tanggal,
                                qty_sebelum, qty_sesudah, dicatat_by, dicatat_by_nama)
  values (p_item, p_outlet, p_jumlah, p_sumber, v_catatan, v_tgl,
          v_sebelum, v_sesudah, v_uid, v_nama)
  returning id into v_id;

  -- Baris log dari trigger sudah mencatat angkanya ("28 jadi 30"); yang ini
  -- menjelaskan SEBABNYA. Tanpa ini riwayatnya kembali jadi perubahan angka
  -- tanpa keterangan — persis keadaan yang membuat perubahan ini diminta.
  --
  -- Tanggal kejadian ikut ditulis ke catatan log: yang membaca Riwayat
  -- membacanya di sana, dan baris log hanya punya waktu PENGETIKAN.
  insert into asset_log (asset_item_id, outlet_id, aksi, kolom, sebelum, sesudah, catatan, oleh, oleh_nama)
  values (p_item, p_outlet, 'tambah', p_sumber, v_sebelum::text, v_sesudah::text,
          case when v_tgl = (now() at time zone 'Asia/Jakarta')::date then v_catatan
               else btrim(coalesce(v_catatan || ' · ', '') || 'tanggal masuk ' || to_char(v_tgl, 'DD Mon YYYY')) end,
          v_uid, v_nama);

  return jsonb_build_object('id', v_id, 'sebelum', v_sebelum, 'sesudah', v_sesudah);
end;
$$;

revoke all on function tambah_stok_aset(uuid, uuid, numeric, text, date, text) from public;
grant execute on function tambah_stok_aset(uuid, uuid, numeric, text, date, text) to authenticated;

-- ---------------------------------------------------------
-- 3. RPC: batalkan penambahan
--
-- Salah ketik "20" yang seharusnya "2" memang masih bisa dibetulkan lewat
-- Edit, dan Edit sengaja tetap terbuka. Tapi membetulkannya lewat Edit
-- meninggalkan catatan pembelian 20 yang berdiri sendiri — angka stoknya
-- benar, riwayatnya berbohong. Jadi penambahan bisa dibatalkan, dan yang
-- dibatalkan TETAP TERLIHAT beserta alasannya (meniru 0170).
-- ---------------------------------------------------------
create or replace function batalkan_penambahan_aset(p_id uuid, p_alasan text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  r record;
  v_sisa numeric;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if btrim(coalesce(p_alasan, '')) = '' then
    raise exception 'Alasan pembatalan wajib diisi.';
  end if;

  select * into r from asset_penambahan where id = p_id for update;
  if r.id is null then raise exception 'Catatan penambahan tidak ditemukan.'; end if;
  if r.dibatalkan_at is not null then raise exception 'Catatan ini sudah dibatalkan.'; end if;
  if not is_admin_of_outlet(v_uid, r.outlet_id) then
    raise exception 'Hanya admin outlet yang boleh membatalkan catatan penambahan.';
  end if;

  select qty into v_sisa from asset_stock
   where asset_item_id = r.asset_item_id and outlet_id = r.outlet_id
   for update;
  if v_sisa is null then
    raise exception 'Barang ini sudah tidak didata di outlet tersebut.';
  end if;

  -- MENOLAK, bukan memotong jadi nol.
  --
  -- Membatalkan pembelian 10 sementara yang tersisa tinggal 3 berarti 7-nya
  -- sudah terpakai, pecah, atau pindah. Memaksakannya jadi angka minus
  -- menyembunyikan selisih itu di dalam stok, dan stok minus adalah angka yang
  -- tidak pernah diperiksa siapa pun karena ia terlihat seperti galat sistem.
  if r.jumlah > v_sisa then
    raise exception 'Tinggal % unit di outlet ini, tidak bisa menarik penambahan % unit. Betulkan jumlahnya dulu lewat Edit kalau memang catatannya yang keliru.',
      v_sisa, r.jumlah;
  end if;

  update asset_penambahan
     set dibatalkan_at = now(), dibatalkan_by = v_uid,
         dibatalkan_by_nama = nama_pengguna(v_uid), alasan_batal = btrim(p_alasan)
   where id = p_id;

  update asset_stock
     set qty = qty - r.jumlah, updated_by = v_uid, updated_at = now()
   where asset_item_id = r.asset_item_id and outlet_id = r.outlet_id;

  insert into asset_log (asset_item_id, outlet_id, aksi, kolom, sebelum, sesudah, catatan, oleh, oleh_nama)
  values (r.asset_item_id, r.outlet_id, 'batal-tambah', r.sumber, r.jumlah::text, null,
          btrim(p_alasan), v_uid, nama_pengguna(v_uid));

  return jsonb_build_object('ditarik', r.jumlah, 'sisa', v_sisa - r.jumlah);
end;
$$;

revoke all on function batalkan_penambahan_aset(uuid, text) from public;
grant execute on function batalkan_penambahan_aset(uuid, text) to authenticated;

-- ---------------------------------------------------------
-- 4. RLS
--
-- Tulis HANYA lewat kedua RPC di atas: tidak ada policy insert/update/delete.
-- `insert` langsung dari klien akan menambah catatan pembelian tanpa menyentuh
-- stoknya — dua angka yang berbeda, dua-duanya terlihat benar di layarnya
-- masing-masing.
-- ---------------------------------------------------------
alter table asset_penambahan enable row level security;

drop policy if exists asset_penambahan_select on asset_penambahan;
create policy asset_penambahan_select on asset_penambahan
  for select using (
    exists (
      select 1 from outlets o
       where o.id = asset_penambahan.outlet_id
         and has_bu_scope(auth.uid(), o.business_unit_id)
    )
  );

notify pgrst, 'reload schema';
