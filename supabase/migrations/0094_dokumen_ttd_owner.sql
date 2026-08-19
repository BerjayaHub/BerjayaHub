-- =========================================================
-- Berjaya Hub OMS — 0094
-- DOKUMEN & TANDA TANGAN OWNER.
--
-- Alurnya:
--   1. Siapa pun yang berhak di BU mengunggah PDF  -> status 'menunggu'
--   2. Aplikasi memberi tautan  owner.html?dok=<id>  untuk dikirim lewat chat
--   3. Owner membuka tautan, HARUS login dulu, lalu mendarat di dokumennya
--   4. Owner menandatangani (TTD tersimpan ditempelkan) ATAU menolak
--   5. Hasil: PDF bertandatangan + Lembar Pengesahan terpisah
--
-- =========================================================
-- SATU-SATUNYA HAL YANG BOLEH DITULIS OWNER
-- =========================================================
--
-- 0093 membuat owner tidak bisa menulis apa pun, dan itu sifat bawaan: dia
-- bukan anggota BU, jadi `has_bu_scope()` selalu gagal untuknya.
--
-- Menandatangani jelas MENULIS. Kalau lubangnya dibuka dengan policy UPDATE
-- biasa di `documents`, owner otomatis juga bisa mengubah `file_path` — yaitu
-- menukar berkas yang ditandatangani dengan berkas lain. Dan karena barisnya
-- tetap satu dan statusnya tetap 'ditandatangani', pertukaran itu tidak akan
-- meninggalkan jejak apa pun.
--
-- Maka tidak ada policy UPDATE untuk owner sama sekali. Satu-satunya jalannya
-- `putuskan_dokumen()` di bagian (5): SECURITY DEFINER, hanya menyentuh kolom
-- keputusan, dan menolak dokumen yang sudah pernah diputus.
--
-- =========================================================
-- SEJAUH MANA TANDA TANGAN INI BISA DIPERCAYA — DIKATAKAN DI SINI
-- =========================================================
--
-- Gambar tanda tangan yang ditempel ke PDF BUKAN bukti kriptografis. Siapa pun
-- yang punya berkas hasilnya bisa memotong gambarnya dan menempelkannya ke
-- dokumen lain, dan hasilnya akan terlihat sama persis.
--
-- Yang memberi bobot pada pengesahan di sini ada tiga, dan ketiganya di
-- database, bukan di gambarnya:
--
--   - `file_hash`   sidik jari isi berkas SAAT DITANDATANGANI. Kalau berkas di
--                   storage ditukar setelahnya, hash-nya tidak lagi cocok dan
--                   ketidakcocokan itu bisa ditunjukkan.
--   - `decided_by`  siapa, dari sesi login yang mana.
--   - `decided_at`  kapan, menurut jam server — bukan jam perangkat penanda
--                   tangan, yang bisa disetel mundur.
--
-- Batasnya juga perlu dikatakan: hash dihitung DI PERAMBAN sebelum diunggah.
-- Pengunggah yang berniat curang bisa mengirim hash yang tidak sesuai isinya.
-- Itu melindungi dari berkas yang berubah SESUDAH ditandatangani, bukan dari
-- pengunggah yang jahat sejak awal. Menutup celah itu butuh perhitungan hash
-- di sisi server (Edge Function), dan itu pekerjaan tersendiri.
-- =========================================================

-- ---------------------------------------------------------
-- (1) TANDA TANGAN TERSIMPAN — satu per orang.
--
-- Hanya berkas gambarnya yang disimpan di storage; barisnya di sini supaya
-- ada yang bisa dijadikan acuan FK dan waktu perubahannya tercatat.
-- ---------------------------------------------------------
create table if not exists owner_signatures (
  user_id uuid primary key references user_profiles(id) on delete cascade,
  image_path text not null,
  updated_at timestamptz not null default now()
);

alter table owner_signatures enable row level security;

-- Milik sendiri, sepenuhnya. Tidak ada yang boleh membaca TTD orang lain —
-- termasuk super admin. Tanda tangan yang bisa diambil orang lain dari
-- database bukan lagi tanda tangan.
drop policy if exists owner_signatures_own on owner_signatures;
create policy owner_signatures_own on owner_signatures
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on table owner_signatures is
  'Gambar tanda tangan tersimpan. RLS sengaja "hanya diri sendiri", tanpa pengecualian super admin.';

-- ---------------------------------------------------------
-- (2) DOKUMEN
-- ---------------------------------------------------------
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  outlet_id uuid references outlets(id) on delete set null,

  title text not null,
  notes text,

  file_path text not null,
  file_hash text not null,
  file_size bigint,

  uploaded_by uuid not null references user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),

  status text not null default 'menunggu'
    check (status in ('menunggu', 'ditandatangani', 'ditolak')),

  decided_by uuid references user_profiles(id) on delete set null,
  decided_at timestamptz,
  reject_reason text,

  signed_path text,       -- PDF yang sudah ditempeli TTD
  sheet_path text,        -- Lembar Pengesahan terpisah

  constraint documents_judul_isi check (length(btrim(title)) > 0),

  -- Status dan bukti keputusannya harus jalan bersama. Tanpa ini, baris
  -- 'ditandatangani' tanpa signed_path bisa ada — dan halaman akan menampilkan
  -- "sudah disahkan" untuk dokumen yang tidak punya berkas hasilnya.
  constraint documents_keputusan_utuh check (
    (status = 'menunggu' and decided_by is null and decided_at is null)
    or (status = 'ditandatangani' and decided_by is not null and decided_at is not null and signed_path is not null)
    or (status = 'ditolak' and decided_by is not null and decided_at is not null and length(btrim(coalesce(reject_reason, ''))) > 0)
  )
);

create index if not exists idx_documents_bu_status on documents(business_unit_id, status);
create index if not exists idx_documents_created on documents(created_at desc);

alter table documents enable row level security;

comment on constraint documents_keputusan_utuh on documents is
  'Menolak WAJIB beralasan. Alur pengesahan yang hanya punya tombol setuju bukan pengesahan — ia formalitas, dan penolakan tanpa alasan tertulis tidak bisa ditindaklanjuti siapa pun.';

-- Baca: pengunggahnya, admin BU, dan owner yang mengawasi BU itu.
drop policy if exists documents_select on documents;
create policy documents_select on documents
  for select to authenticated
  using (
    uploaded_by = auth.uid()
    or is_bu_admin(auth.uid(), business_unit_id)
    or owner_punya_bu(auth.uid(), business_unit_id)
  );

-- Unggah: anggota BU, atas namanya sendiri, dan SELALU mulai dari 'menunggu'.
-- Kolom keputusan dipaksa kosong di sini supaya tidak ada yang bisa mengunggah
-- dokumen yang sudah lahir dalam keadaan "disetujui".
drop policy if exists documents_insert on documents;
create policy documents_insert on documents
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and has_bu_scope(auth.uid(), business_unit_id)
    and status = 'menunggu'
    and decided_by is null
    and decided_at is null
    and signed_path is null
    and sheet_path is null
  );

-- Hapus: hanya pengunggahnya, dan HANYA selagi belum diputus. Dokumen yang
-- sudah ditandatangani atau ditolak adalah catatan — menghapusnya berarti
-- menghapus keputusan yang pernah diambil owner.
drop policy if exists documents_delete_belum_diputus on documents;
create policy documents_delete_belum_diputus on documents
  for delete to authenticated
  using (uploaded_by = auth.uid() and status = 'menunggu');

-- CATATAN: tidak ada policy UPDATE sama sekali, untuk siapa pun. Perubahan
-- status hanya lewat `putuskan_dokumen()` di bagian (5).

-- ---------------------------------------------------------
-- (3) BUCKET: TANDA TANGAN
--
-- Path: {user_id}/ttd.png — id pemiliknya di depan supaya izinnya bisa
-- diperiksa dari nama berkasnya sendiri.
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('owner-signature', 'owner-signature', false)
on conflict (id) do nothing;

drop policy if exists ttd_owner_all on storage.objects;
create policy ttd_owner_all on storage.objects
  for all to authenticated
  using (
    bucket_id = 'owner-signature'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'owner-signature'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------
-- (4) BUCKET: DOKUMEN
--
-- Path: {business_unit_id}/{waktu}-{acak}.pdf — sama alasannya dengan
-- receipt-photos di 0084: berkasnya diunggah DULU, barisnya dibuat sesudahnya,
-- jadi saat unggahannya diperiksa barisnya memang belum ada.
--
-- Tidak publik. Dokumen yang dimintakan tanda tangan owner adalah justru jenis
-- dokumen yang paling tidak boleh terbuka bagi siapa pun yang menebak URL-nya.
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

drop policy if exists dokumen_insert on storage.objects;
create policy dokumen_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and has_bu_scope(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

drop policy if exists dokumen_select on storage.objects;
create policy dokumen_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and (
      has_bu_scope(auth.uid(), ((storage.foldername(name))[1])::uuid)
      or owner_punya_bu(auth.uid(), ((storage.foldername(name))[1])::uuid)
    )
  );

-- Owner harus bisa MENULIS hasil tanda tangan ke bucket ini — itu satu-satunya
-- penulisan storage yang dia lakukan. Dibatasi ke folder BU yang diawasinya.
drop policy if exists dokumen_insert_owner on storage.objects;
create policy dokumen_insert_owner on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and owner_punya_bu(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

-- Menghapus berkas: hanya BU-nya sendiri, dipakai saat unggahan gagal di
-- tengah jalan sehingga menyisakan berkas tanpa baris.
drop policy if exists dokumen_delete on storage.objects;
create policy dokumen_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and has_bu_scope(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

-- ---------------------------------------------------------
-- (5) MEMUTUSKAN — satu pintu, dan hanya untuk owner.
--
-- SECURITY DEFINER karena owner memang tidak punya hak UPDATE di `documents`,
-- dan tidak boleh diberi. Fungsi ini yang memegang haknya, dan ia hanya
-- menyentuh kolom keputusan.
--
-- `p_hash_saat_tanda_tangan` dibandingkan dengan hash yang tersimpan. Kalau
-- berbeda, berarti berkas di storage sudah berubah sejak diunggah, dan
-- penandatanganan DIBATALKAN. Tanpa perbandingan ini, seseorang bisa mengunggah
-- dokumen polos, menunggu owner membukanya, lalu menukar isinya tepat sebelum
-- tombolnya ditekan.
-- ---------------------------------------------------------
create or replace function putuskan_dokumen(
  p_dokumen uuid,
  p_status text,
  p_hash_saat_tanda_tangan text default null,
  p_signed_path text default null,
  p_sheet_path text default null,
  p_alasan text default null
)
returns documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_doc documents;
begin
  if v_uid is null then
    raise exception 'Harus login';
  end if;

  if p_status not in ('ditandatangani', 'ditolak') then
    raise exception 'Keputusan tidak dikenal: %', p_status;
  end if;

  -- `for update` mengunci barisnya: dua klik yang datang hampir bersamaan
  -- tidak bisa dua-duanya lolos pemeriksaan "masih menunggu".
  select * into v_doc from documents where id = p_dokumen for update;

  if not found then
    raise exception 'Dokumen tidak ditemukan';
  end if;

  if not owner_punya_bu(v_uid, v_doc.business_unit_id) then
    raise exception 'Hanya owner BU ini yang boleh memutuskan dokumen ini';
  end if;

  -- Sudah pernah diputus -> berhenti. Pesannya menyebut keputusan yang sudah
  -- ada, supaya yang membaca tahu ini bukan kegagalan teknis.
  if v_doc.status <> 'menunggu' then
    raise exception 'Dokumen ini sudah % dan tidak bisa diputus ulang', v_doc.status;
  end if;

  if p_status = 'ditandatangani' then
    if p_signed_path is null then
      raise exception 'Berkas hasil tanda tangan belum ada';
    end if;
    if p_hash_saat_tanda_tangan is null or p_hash_saat_tanda_tangan <> v_doc.file_hash then
      raise exception 'Isi dokumen berubah sejak diunggah — penandatanganan dibatalkan';
    end if;

    update documents set
      status = 'ditandatangani',
      decided_by = v_uid,
      decided_at = now(),
      signed_path = p_signed_path,
      sheet_path = p_sheet_path
    where id = p_dokumen
    returning * into v_doc;
  else
    if length(btrim(coalesce(p_alasan, ''))) = 0 then
      raise exception 'Penolakan harus disertai alasan';
    end if;

    update documents set
      status = 'ditolak',
      decided_by = v_uid,
      decided_at = now(),
      reject_reason = btrim(p_alasan)
    where id = p_dokumen
    returning * into v_doc;
  end if;

  return v_doc;
end;
$$;

revoke all on function putuskan_dokumen(uuid, text, text, text, text, text) from public;
grant execute on function putuskan_dokumen(uuid, text, text, text, text, text) to authenticated;

comment on function putuskan_dokumen(uuid, text, text, text, text, text) is
  'Satu-satunya jalur tulis owner ke documents. Menolak dokumen yang sudah diputus, dan membatalkan penandatanganan bila hash berkasnya tidak lagi cocok.';

notify pgrst, 'reload schema';
