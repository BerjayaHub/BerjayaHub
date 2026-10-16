-- =========================================================
-- 0163 — MODUL KONTEN SOSMED
--
--   "saya mengolah semua nya sendiri termasuk pengambilan konten … saya ingin
--    membagi tugas saya kepada outlet juga, jadi perihal upload dan konsep
--    konten dari saya, tetapi pengambilan konten dilakukan oleh staff outlet
--    sendiri dan dijadwalkan setor kepada saya"
--
-- ============ BERKASNYA TIDAK DI SINI ============
--
-- Video tinggal di Cloudflare R2, bukan di Supabase Storage. Alasannya
-- terukur, bukan selera: free plan Supabase membatasi 50 MB per berkas, dan
-- video 1 menit dari HP staff berukuran 141 MB (diukur sendiri di Motorola
-- G57). Jaraknya hampir tiga kali lipat — bukan sesuatu yang bisa ditutup
-- dengan membatasi durasi.
--
-- Dan yang lebih menentukan: kuota 1 GB Supabase dipakai bersama selfie
-- presensi harian. Kalau konten mengisinya sampai penuh, yang berhenti bukan
-- modul ini — yang berhenti adalah CLOCK-IN STAFF. Memisahkan berkasnya ke R2
-- membuat kegagalan modul ini tidak bisa menyentuh bukti penggajian.
--
-- Tabel di bawah menyimpan KUNCI objeknya saja (`r2_key`), bukan isinya.
--
-- ============ TIDAK ADA ALUR PERSETUJUAN ============
--
--   "perihal kualitas video dan foto apakah layak atau tidak, nanti akan saya
--    infokan melalui whatsapp saja"
--
-- Jadi sengaja TIDAK ada status 'diterima'/'revisi'. Membangun alur penilaian
-- yang tidak akan dipakai berarti setiap setoran menggantung di status yang
-- tidak pernah disentuh siapa pun — dan daftar yang penuh barang menggantung
-- berhenti dibaca sebagai daftar pekerjaan.
--
-- Statusnya tiga: belum → disetor → selesai. Perbaikan terjadi lewat WhatsApp,
-- lalu staff menyetor lagi ke tugas yang sama.
-- =========================================================

insert into modules (code, name, description)
values ('konten_sosmed', 'Konten Sosmed', 'Jadwal setor foto & video konten dari outlet')
on conflict (code) do nothing;

-- ---------------------------------------------------------
-- (1) SETELAN PER OUTLET — kapan setor, dan brief tetapnya.
--
-- Per OUTLET, bukan per BU: tiap outlet bisa punya hari setor berbeda supaya
-- beban editing admin tersebar, bukan menumpuk di satu hari.
-- ---------------------------------------------------------
create table if not exists konten_setelan_outlet (
  outlet_id uuid primary key references outlets(id) on delete cascade,
  business_unit_id uuid not null references business_units(id) on delete cascade,

  -- 0 = Minggu … 6 = Sabtu, mengikuti `extract(dow)` Postgres.
  hari_setor int not null default 5 check (hari_setor between 0 and 6),

  -- Brief yang berlaku terus untuk outlet ini kalau tugasnya tidak punya
  -- brief sendiri. Kosong berarti pakai brief bawaan aplikasi.
  brief_tetap text,

  aktif boolean not null default true,
  diperbarui_at timestamptz not null default now(),
  diperbarui_by uuid references user_profiles(id) on delete set null
);

create index if not exists idx_konten_setelan_bu on konten_setelan_outlet(business_unit_id) where aktif;

-- ---------------------------------------------------------
-- (2) TUGAS SETOR.
--
-- ============ BARISNYA LAHIR SAAT DISENTUH, BUKAN DARI CRON ============
--
-- Tugas mingguan TIDAK dibuat oleh pekerjaan terjadwal. Tenggatnya dihitung
-- dari `hari_setor` saat layarnya digambar, dan barisnya baru lahir ketika ada
-- yang menyentuhnya — staff mengunggah, atau admin menulis brief.
--
-- Alasannya satu kejadian nyata di repo ini: cron rekap Telegram melaporkan
-- `succeeded` selama berbulan-bulan sementara gerbangnya menolak dengan 401,
-- dan tidak ada yang tahu. Kalau tugas mingguan bergantung pada cron, cron
-- yang mati diam-diam berarti SELURUH outlet berhenti punya tugas — dan
-- gejalanya cuma "tidak ada apa-apa di layar", yang tidak terlihat seperti
-- kerusakan.
--
-- Dengan dihitung saat dibaca, tidak ada yang bisa mati diam-diam: selama
-- setelannya ada, tenggatnya selalu terhitung.
-- ---------------------------------------------------------
create table if not exists konten_tugas (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  outlet_id uuid not null references outlets(id) on delete cascade,

  -- Tanggal tenggat. Untuk tugas mingguan ini hasil hitungan dari `hari_setor`;
  -- untuk tugas khusus, diisi admin.
  tenggat date not null,

  jenis text not null default 'mingguan' check (jenis in ('mingguan', 'khusus')),

  -- Brief khusus tugas ini. Kosong -> turun ke `brief_tetap` outlet, lalu ke
  -- brief bawaan aplikasi. Ketiganya SATU rantai, dan layar admin menampilkan
  -- yang BENAR-BENAR dibaca staff — bukan menebak.
  brief text,

  status text not null default 'belum' check (status in ('belum', 'disetor', 'selesai')),
  disetor_at timestamptz,

  -- Penanda milik admin. `diunduh_at` sekadar keterangan; yang MENENTUKAN
  -- penghapusan adalah `selesai_at`.
  diunduh_at timestamptz,
  selesai_at timestamptz,
  selesai_by uuid references user_profiles(id) on delete set null,

  -- Diisi saat berkasnya benar-benar sudah dihapus dari R2. Dipakai layar untuk
  -- menulis "berkas sudah dihapus otomatis" alih-alih menampilkan pratinjau
  -- yang rusak — perbedaan antara keterangan dan laporan bug palsu.
  berkas_dihapus_at timestamptz,

  dibuat_at timestamptz not null default now(),
  dibuat_by uuid references user_profiles(id) on delete set null,

  -- Satu tugas mingguan per outlet per tenggat. Tugas khusus boleh lebih dari
  -- satu pada tanggal yang sama, jadi indeksnya parsial.
  constraint konten_tugas_tenggat_wajar check (tenggat > date '2024-01-01')
);

create unique index if not exists konten_tugas_mingguan_uk
  on konten_tugas(outlet_id, tenggat) where jenis = 'mingguan';

create index if not exists idx_konten_tugas_outlet on konten_tugas(outlet_id, tenggat desc);
create index if not exists idx_konten_tugas_bu on konten_tugas(business_unit_id, status);

-- Berkas yang menunggu dihapus: dicari pekerjaan terjadwal tiap malam.
create index if not exists idx_konten_tugas_siap_hapus
  on konten_tugas(selesai_at)
  where status = 'selesai' and berkas_dihapus_at is null;

-- ---------------------------------------------------------
-- (3) BERKAS.
-- ---------------------------------------------------------
create table if not exists konten_berkas (
  id uuid primary key default gen_random_uuid(),
  tugas_id uuid not null references konten_tugas(id) on delete cascade,
  jenis text not null check (jenis in ('video', 'foto')),

  -- Kunci objek di R2. BUKAN URL: URL untuk menonton diterbitkan sesaat
  -- (presigned) tiap kali dibutuhkan, dan menyimpan URL berarti menyimpan
  -- sesuatu yang kedaluwarsa — lalu tautannya mati tanpa ada yang tahu kenapa.
  r2_key text not null unique,
  nama_asli text,
  ukuran_byte bigint check (ukuran_byte is null or ukuran_byte >= 0),

  diunggah_by uuid references user_profiles(id) on delete set null,
  diunggah_at timestamptz not null default now()
);

create index if not exists idx_konten_berkas_tugas on konten_berkas(tugas_id);

-- ---------------------------------------------------------
-- (3b) SAMPAH R2 — BARIS HILANG, OBJEKNYA JANGAN TERTINGGAL.
--
-- ============ KEBOCORAN YANG TIDAK TERLIHAT DARI MANA PUN ============
--
-- Baris `konten_berkas` bisa hilang lewat BANYAK jalan: staff membatalkan
-- unggahannya, admin menghapusnya, atau tugasnya dihapus dan cascade ikut
-- membawanya. Tak satu pun dari jalan itu menyentuh objeknya di R2.
--
-- Akibatnya objek yatim: tidak ditunjuk baris mana pun, jadi tidak muncul di
-- layar mana pun, jadi tidak ada yang tahu ia ada — sementara ia tetap
-- menghitung kuota 10 GB. Kebocoran yang baru ketahuan bertahun-tahun kemudian
-- sebagai "kenapa R2 saya penuh padahal isinya sedikit".
--
-- Menyerahkannya ke pemanggil ("ingat hapus di R2 juga") adalah persis cara
-- kegagalan ini terjadi: satu dari empat jalur pasti lupa.
--
-- Jadi dicatat trigger. Apa pun jalan hilangnya barisnya, kuncinya mendarat di
-- sini, dan pekerjaan terjadwal yang membersihkannya.
-- ---------------------------------------------------------
create table if not exists konten_berkas_sampah (
  r2_key text primary key,
  dicatat_at timestamptz not null default now(),
  -- Diisi saat objeknya benar-benar hilang dari R2. Barisnya SENGAJA tidak
  -- ikut dihapus: ia jejak bahwa pembersihannya pernah terjadi, dan murah.
  dihapus_at timestamptz
);

create index if not exists idx_konten_sampah_menunggu
  on konten_berkas_sampah(dicatat_at) where dihapus_at is null;

-- `security definer` WAJIB di sini, dan ini ditemukan tesnya.
--
-- Trigger berjalan sebagai PEMANGGIL. Tabel sampah sengaja tidak punya policy
-- maupun grant apa pun — jadi tanpa `security definer`, staff yang membatalkan
-- unggahannya sendiri ditolak dengan "permission denied for table
-- konten_berkas_sampah": bukan penghapusan yang gagal dicatat, melainkan
-- penghapusannya sendiri yang mustahil.
--
-- Galatnya pun menyesatkan — ia menyebut tabel yang sama sekali tidak ada
-- hubungannya dengan apa yang sedang dilakukan orangnya.
create or replace function catat_sampah_berkas_konten()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into konten_berkas_sampah (r2_key) values (old.r2_key)
  -- Kunci yang sama bisa tercatat dua kali kalau sebuah berkas sempat
  -- diunggah ulang dengan kunci yang sama lalu dihapus lagi. Yang penting ia
  -- ADA di daftar, bukan berapa kali.
  on conflict (r2_key) do nothing;
  return old;
end;
$$;

revoke all on function catat_sampah_berkas_konten() from public;

drop trigger if exists trg_catat_sampah_berkas_konten on konten_berkas;
create trigger trg_catat_sampah_berkas_konten
  after delete on konten_berkas
  for each row
  execute function catat_sampah_berkas_konten();

alter table konten_berkas_sampah enable row level security;

-- Tidak ada satu pun policy: tabel ini milik pekerjaan terjadwal yang berjalan
-- dengan service role. Tidak ada layar yang perlu membacanya, dan tidak ada
-- orang yang perlu menyentuhnya.

-- ---------------------------------------------------------
-- (4) BATAS JUMLAH BERKAS, DIJAGA DATABASE.
--
--   "minimal 1 video dan 1 foto, maksimal 3 [berkas seluruhnya]"
--
-- Batas ATAS dijaga di sini; batas BAWAH tidak.
--
-- Bedanya disengaja: "maksimal 3" adalah aturan yang bisa dilanggar satu
-- permintaan, dan kalau dilanggar ia memakan kuota R2 tanpa ada yang
-- memutuskan begitu. Sedangkan "minimal 1 video + 1 foto" adalah keadaan yang
-- WAJAR ADA sementara — staff mengunggah videonya dulu, fotonya menyusul
-- semenit kemudian. Menjadikannya constraint berarti unggahan pertama selalu
-- ditolak.
--
-- Jadi batas bawah ditegakkan di layar sebagai syarat "sudah lengkap", bukan
-- sebagai syarat menyimpan.
-- ---------------------------------------------------------
create or replace function jaga_jumlah_berkas_konten()
returns trigger
language plpgsql
as $$
declare
  v_jumlah int;
begin
  select count(*) into v_jumlah from konten_berkas where tugas_id = new.tugas_id;
  if v_jumlah >= 3 then
    raise exception 'Satu setoran paling banyak 3 berkas. Hapus salah satu dulu kalau mau mengganti.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_jaga_jumlah_berkas_konten on konten_berkas;
create trigger trg_jaga_jumlah_berkas_konten
  before insert on konten_berkas
  for each row
  execute function jaga_jumlah_berkas_konten();

-- ---------------------------------------------------------
-- (5) TUGAS TERTANDAI DISETOR BEGITU BERKAS PERTAMA MASUK.
--
-- Di database, bukan di layar. Dua layar (Staff App & Admin Portal) yang
-- masing-masing menebak status dari jumlah berkas akan menyimpang cepat atau
-- lambat — dan menyimpangnya berbentuk "sudah saya setor kok" berhadapan
-- dengan "belum ada yang masuk".
-- ---------------------------------------------------------
create or replace function tandai_tugas_disetor()
returns trigger
language plpgsql
as $$
begin
  update konten_tugas
     set status = 'disetor',
         disetor_at = coalesce(disetor_at, now())
   where id = new.tugas_id
     -- Tugas yang SUDAH selesai tidak diturunkan kembali oleh unggahan baru.
     -- Tanpa syarat ini, satu berkas susulan sesudah kamu menandai selesai akan
     -- membatalkan penandaan itu diam-diam, dan berkasnya tidak pernah dihapus.
     and status = 'belum';
  return new;
end;
$$;

drop trigger if exists trg_tandai_tugas_disetor on konten_berkas;
create trigger trg_tandai_tugas_disetor
  after insert on konten_berkas
  for each row
  execute function tandai_tugas_disetor();

-- ---------------------------------------------------------
-- (6) RLS.
-- ---------------------------------------------------------
alter table konten_setelan_outlet enable row level security;
alter table konten_tugas enable row level security;
alter table konten_berkas enable row level security;

drop policy if exists konten_setelan_select on konten_setelan_outlet;
drop policy if exists konten_setelan_modify on konten_setelan_outlet;
drop policy if exists konten_tugas_select on konten_tugas;
drop policy if exists konten_tugas_insert on konten_tugas;
drop policy if exists konten_tugas_update on konten_tugas;
drop policy if exists konten_tugas_delete on konten_tugas;
drop policy if exists konten_berkas_select on konten_berkas;
drop policy if exists konten_berkas_insert on konten_berkas;
drop policy if exists konten_berkas_delete on konten_berkas;

-- Staff perlu MEMBACA setelannya: dari situ layar HP-nya tahu kapan tenggatnya.
create policy konten_setelan_select on konten_setelan_outlet
  for select using (has_bu_scope(auth.uid(), business_unit_id));

create policy konten_setelan_modify on konten_setelan_outlet
  for all using (is_bu_admin(auth.uid(), business_unit_id))
  with check (is_bu_admin(auth.uid(), business_unit_id));

-- Tugas: terlihat se-BU (supaya rekap admin utuh dan staff melihat tugasnya),
-- tapi hanya bisa DIBUAT di outlet tempat orangnya bertugas.
create policy konten_tugas_select on konten_tugas
  for select using (has_bu_scope(auth.uid(), business_unit_id));

create policy konten_tugas_insert on konten_tugas
  for insert with check (
    is_admin_of_outlet(auth.uid(), outlet_id)
    or has_outlet_scope(auth.uid(), outlet_id)
  );

-- ============ STAFF TIDAK BOLEH MENANDAI SELESAI ============
--
-- 'selesai' adalah penanda MILIK ADMIN, dan ia yang memicu penghapusan berkas
-- tujuh hari kemudian. Kalau staff bisa menandainya, ia bisa menghapus bukti
-- setorannya sendiri — tanpa melanggar apa pun yang terlihat.
create policy konten_tugas_update on konten_tugas
  for update using (is_bu_admin(auth.uid(), business_unit_id))
  with check (is_bu_admin(auth.uid(), business_unit_id));

-- Admin boleh menghapus tugas yang salah dibuat. Berkasnya ikut lewat cascade,
-- dan kuncinya tetap tercatat di `konten_berkas_sampah` oleh trigger — jadi
-- objeknya di R2 tidak tertinggal.
create policy konten_tugas_delete on konten_tugas
  for delete using (is_bu_admin(auth.uid(), business_unit_id));

create policy konten_berkas_select on konten_berkas
  for select using (
    exists (
      select 1 from konten_tugas t
       where t.id = konten_berkas.tugas_id
         and has_bu_scope(auth.uid(), t.business_unit_id)
    )
  );

create policy konten_berkas_insert on konten_berkas
  for insert with check (
    exists (
      select 1 from konten_tugas t
       where t.id = konten_berkas.tugas_id
         and (is_admin_of_outlet(auth.uid(), t.outlet_id) or has_outlet_scope(auth.uid(), t.outlet_id))
    )
  );

-- Staff boleh membatalkan unggahannya SENDIRI (salah ambil), selama tugasnya
-- belum ditandai selesai. Admin boleh menghapus yang mana pun.
create policy konten_berkas_delete on konten_berkas
  for delete using (
    exists (
      select 1 from konten_tugas t
       where t.id = konten_berkas.tugas_id
         and (
           is_bu_admin(auth.uid(), t.business_unit_id)
           or (konten_berkas.diunggah_by = auth.uid() and t.status <> 'selesai')
         )
    )
  );

comment on table konten_tugas is
  'Satu tugas setor konten per outlet per tenggat. Berkasnya di Cloudflare R2; tabel ini hanya menyimpan kuncinya. Tidak ada alur persetujuan — penilaian kualitas lewat WhatsApp (keputusan sadar, lihat kepala migration).';

notify pgrst, 'reload schema';
