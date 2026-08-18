-- =========================================================
-- 0085 — Stok Opname BERNOMOR, dikerjakan bersama
--
-- SEBELUMNYA: opname langsung menulis penyesuaian stok per item, tanpa nomor
-- dan tanpa riwayat. Akibatnya tidak ada satu pun tempat yang bisa menjawab
-- "opname tanggal 17 hasilnya apa" — yang tersisa cuma pergerakan stok
-- bertipe `adjustment` yang berserakan di antara penerimaan dan transfer.
--
-- YANG BERUBAH: opname jadi SESI bernomor. Sesi dibuka sekali per outlet, lalu
-- siapa pun yang berwenang di outlet itu ikut mengisi DENGAN AKUNNYA SENDIRI
-- ke nomor yang sama. Stok baru berubah saat sesinya DITUTUP.
--
-- ============ KENAPA STOK BARU BERUBAH SAAT DITUTUP ============
--
-- Kalau tiap isian langsung menyesuaikan stok, hitungan yang sedang berjalan
-- ikut mengubah angka sistem yang sedang dipakai orang lain menghitung — dan
-- di gudang yang sama, dua orang yang berpapasan akan saling menggeser acuan.
-- Sesi yang ditutup sekaligus membuat seluruh penyesuaian punya satu waktu,
-- satu nomor, dan satu nilai rupiah yang bisa diperiksa.
--
-- ============ DUA ORANG MENGHITUNG ITEM YANG SAMA ============
--
-- Yang dipakai: HITUNGAN TERAKHIR. Sederhana dan bisa ditebak.
--
-- Tapi hitungan sebelumnya TIDAK DIBUANG — ia disimpan di `sebelumnya`. Sebab
-- kalau dua orang menghitung 12 dan 40 untuk barang yang sama, angka mana pun
-- yang dipakai, YANG PENTING justru bahwa selisihnya sebesar itu: salah satu
-- dari mereka menghitung tempat yang salah, dan itu perlu ditanyakan sebelum
-- selisihnya dibebankan ke laporan. Menyimpan yang lama menahan pertanyaan itu
-- tetap bisa diajukan; membuangnya menghapus satu-satunya petunjuk.
-- =========================================================

create table if not exists stock_counts (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  outlet_id uuid not null references outlets(id) on delete cascade,
  code text not null,
  count_date date not null default (now() at time zone 'Asia/Jakarta')::date,
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  notes text,
  -- user_profiles, BUKAN auth.users — lihat catatan di 0086.
  opened_by uuid references user_profiles(id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_by uuid references user_profiles(id) on delete set null,
  closed_at timestamptz
);
create unique index if not exists stock_counts_code_uk on stock_counts(code);

-- SATU sesi terbuka per outlet. Inilah yang membuat "kalau opname sudah
-- dimulai, semua ikut nomor yang sama" berlaku dengan sendirinya — bukan
-- diserahkan pada disiplin orangnya.
create unique index if not exists stock_counts_satu_terbuka
  on stock_counts(outlet_id) where status = 'open';
create index if not exists idx_sc_bu_date on stock_counts(business_unit_id, count_date desc);

create table if not exists stock_count_items (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references stock_counts(id) on delete cascade,
  product_id uuid not null references products(id) on delete restrict,
  -- Stok menurut SISTEM saat item ini dihitung. Dipotret, bukan dibaca ulang
  -- saat penutupan: kalau ada penerimaan di tengah opname, selisih yang
  -- dilaporkan harus tetap selisih yang DILIHAT penghitungnya.
  system_qty numeric not null default 0,
  counted_qty numeric not null,
  counted_by uuid references user_profiles(id) on delete set null,
  counted_at timestamptz not null default now(),
  -- Hitungan yang tergantikan: [{qty, by, at}, ...]
  sebelumnya jsonb not null default '[]'::jsonb,
  notes text
);
create unique index if not exists stock_count_items_uk on stock_count_items(count_id, product_id);
create index if not exists idx_sci_count on stock_count_items(count_id);

alter table stock_movements add column if not exists count_id uuid references stock_counts(id) on delete set null;
create index if not exists idx_sm_count on stock_movements(count_id);

alter table stock_counts enable row level security;
alter table stock_count_items enable row level security;

create policy sc_select on stock_counts
  for select using (has_bu_scope(auth.uid(), business_unit_id));
create policy sc_modify on stock_counts
  for all using (has_outlet_scope(auth.uid(), outlet_id))
  with check (has_outlet_scope(auth.uid(), outlet_id));

create policy sci_select on stock_count_items
  for select using (
    exists (select 1 from stock_counts c where c.id = stock_count_items.count_id and has_bu_scope(auth.uid(), c.business_unit_id))
  );
create policy sci_modify on stock_count_items
  for all using (
    exists (select 1 from stock_counts c where c.id = stock_count_items.count_id and has_outlet_scope(auth.uid(), c.outlet_id))
  )
  with check (
    exists (select 1 from stock_counts c where c.id = stock_count_items.count_id and has_outlet_scope(auth.uid(), c.outlet_id))
  );

-- =========================================================
-- BUKA SESI — atau ikut yang sudah terbuka.
--
-- Sengaja TIDAK melempar error kalau sesinya sudah ada: dari sisi penggunanya,
-- "mulai opname" dan "lanjutkan opname" adalah niat yang sama, dan menolak
-- orang kedua dengan pesan galat cuma membuatnya bertanya-tanya siapa yang
-- sedang memegang. Yang dikembalikan selalu sesi yang berlaku.
-- =========================================================
create or replace function buka_opname(p_outlet uuid, p_notes text default null)
returns uuid
language plpgsql
as $$
declare
  v_bu uuid;
  v_id uuid;
  v_new uuid := gen_random_uuid();
  v_code text;
begin
  select business_unit_id into v_bu from outlets where id = p_outlet;
  if v_bu is null then raise exception 'Outlet tidak dikenal.'; end if;

  -- MEMBUKA & MENUTUP SESI = WEWENANG ADMIN BU / SUPER ADMIN.
  --
  -- `is_bu_admin()` DIPAKAI apa adanya, TIDAK diubah. Fungsi itu dipakai 55
  -- policy lain (kas, presensi, reservasi, produk); mengubah isinya untuk
  -- keperluan opname akan diam-diam menggeser wewenang di seluruh modul itu.
  -- Menambah pemakaian baru aman; mengubah fungsinya tidak.
  --
  -- Staff tetap boleh MENGISI hitungan (lihat `catat_hitungan_opname`) — yang
  -- dibatasi hanya membuka dan menutup, karena menutup mengubah stok dan tidak
  -- bisa dibatalkan.
  if not is_bu_admin(auth.uid(), v_bu) then
    raise exception 'Hanya Admin BU atau Super Admin yang bisa membuka sesi opname.';
  end if;

  select id into v_id from stock_counts where outlet_id = p_outlet and status = 'open';
  if v_id is not null then return v_id; end if;

  v_code := 'OPN-' || to_char((now() at time zone 'Asia/Jakarta'), 'YYMMDD') || '-' || upper(substr(v_new::text, 1, 4));
  insert into stock_counts (id, business_unit_id, outlet_id, code, notes, opened_by)
  values (v_new, v_bu, p_outlet, v_code, nullif(p_notes, ''), auth.uid());
  return v_new;
end;
$$;

-- =========================================================
-- CATAT SATU HITUNGAN. Yang terakhir menang; yang lama disimpan.
-- =========================================================
create or replace function catat_hitungan_opname(
  p_count uuid,
  p_product uuid,
  p_counted numeric,
  p_system numeric,
  p_notes text default null
) returns void
language plpgsql
as $$
declare
  v_status text;
  v_lama stock_count_items%rowtype;
  v_ada int;
begin
  select status into v_status from stock_counts where id = p_count;
  if v_status is null then raise exception 'Sesi opname tidak ditemukan.'; end if;
  -- Sesi yang sudah ditutup tidak boleh diisi lagi: penyesuaian stoknya sudah
  -- terjadi, dan menambah hitungan sesudahnya berarti angka di laporan tidak
  -- lagi cocok dengan pergerakan yang dihasilkannya.
  if v_status <> 'open' then raise exception 'Opname ini sudah ditutup — buka sesi baru untuk menghitung ulang.'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'Jumlah hitungan tidak sah.'; end if;

  select * into v_lama from stock_count_items where count_id = p_count and product_id = p_product;

  if v_lama.id is null then
    insert into stock_count_items (count_id, product_id, system_qty, counted_qty, counted_by, notes)
    values (p_count, p_product, coalesce(p_system, 0), p_counted, auth.uid(), nullif(p_notes, ''));
  else
    update stock_count_items
    set counted_qty = p_counted,
        -- POTRET SISTEM IKUT DIPERBARUI. Ini yang membuat hitungan ulang tetap
        -- benar kalau ada barang masuk di tengah sesi.
        --
        -- Penyesuaiannya nanti dihitung SELISIH (`dihitung − sistem`), bukan
        -- ditimpa absolut. Selama potretnya sezaman dengan hitungannya,
        -- selisihnya tetap sah walau stok bergerak sesudahnya: dihitung 92 saat
        -- sistem 100 menghasilkan −8; kalau kemudian masuk nota 50 (stok jadi
        -- 150), penutupan tetap menghasilkan 142 — dan itu memang benar.
        --
        -- Yang RUSAK adalah kalau potretnya TIDAK diperbarui saat dihitung
        -- ulang: orang kedua menghitung 145 sesudah nota masuk, tapi potretnya
        -- masih 100, jadi selisihnya +45 dan stok akhirnya jadi 195. Tidak ada
        -- error, tidak ada peringatan — hanya stok yang salah 50 unit.
        system_qty = coalesce(p_system, system_qty),
        counted_by = auth.uid(),
        counted_at = now(),
        notes = nullif(p_notes, ''),
        -- Hanya dicatat kalau angkanya BERBEDA. Orang yang membuka lalu
        -- menyimpan ulang angka yang sama tidak sedang menggantikan siapa pun,
        -- dan mencatatnya cuma membuat daftar riwayat penuh baris kosong.
        sebelumnya = case
          when v_lama.counted_qty is distinct from p_counted
          then sebelumnya || jsonb_build_object('qty', v_lama.counted_qty, 'by', v_lama.counted_by, 'at', v_lama.counted_at)
          else sebelumnya
        end
    where count_id = p_count and product_id = p_product;
  end if;

  get diagnostics v_ada = row_count;
  if v_ada = 0 then raise exception 'Tidak tersimpan — kamu tidak punya wewenang di outlet ini.'; end if;
end;
$$;

-- =========================================================
-- TUTUP SESI — di sinilah stok berubah.
--
-- Satu pergerakan `adjustment` per item yang selisihnya bukan nol, semuanya
-- menunjuk `count_id` yang sama. Item yang cocok dengan sistem TIDAK
-- menghasilkan pergerakan: baris berjumlah nol cuma meramaikan riwayat stok
-- tanpa mengubah apa pun.
-- =========================================================
create or replace function tutup_opname(p_count uuid)
returns int
language plpgsql
as $$
declare
  v_bu uuid;
  v_outlet uuid;
  v_status text;
  v_code text;
  r record;
  v_n int := 0;
begin
  select business_unit_id, outlet_id, status, code into v_bu, v_outlet, v_status, v_code
  from stock_counts where id = p_count;
  if v_bu is null then raise exception 'Sesi opname tidak ditemukan.'; end if;
  if v_status <> 'open' then raise exception 'Opname ini sudah ditutup.'; end if;
  if not is_bu_admin(auth.uid(), v_bu) then
    raise exception 'Hanya Admin BU atau Super Admin yang bisa menutup sesi opname.';
  end if;

  -- Hanya item yang BENAR-BENAR dihitung yang menghasilkan penyesuaian.
  -- Barang yang tidak disentuh mempertahankan stok sistemnya — kebalikannya
  -- akan menghapus stok gudang hanya karena orangnya belum sampai ke rak itu.
  for r in select product_id, counted_qty, system_qty from stock_count_items where count_id = p_count loop
    if r.counted_qty - r.system_qty <> 0 then
      insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by, count_id)
      values (v_bu, v_outlet, r.product_id, 'adjustment', r.counted_qty - r.system_qty,
              'Opname ' || v_code, auth.uid(), p_count);
      v_n := v_n + 1;
    end if;
  end loop;

  update stock_counts set status = 'closed', closed_by = auth.uid(), closed_at = now() where id = p_count;
  if not found then raise exception 'Tidak tersimpan — kamu tidak punya wewenang di outlet ini.'; end if;

  return v_n;
end;
$$;

-- =========================================================
-- BATALKAN SESI — ditutup TANPA menyentuh stok sama sekali.
--
-- Kenapa perlu ada: sesi yang telanjur diisi ngawur lalu ditinggal tidak boleh
-- memaksa admin memilih antara dua hal buruk — menerapkan angka ngawur itu ke
-- stok, atau membiarkan sesinya terbuka selamanya sehingga opname berikutnya
-- tidak bisa dimulai (satu sesi terbuka per outlet).
--
-- Hitungannya TIDAK dihapus: sesinya tetap bisa dibuka dan dibaca sebagai
-- riwayat. Yang dibatalkan adalah akibatnya pada stok, bukan catatan bahwa
-- pernah ada orang menghitung.
-- =========================================================
create or replace function batalkan_opname(p_count uuid, p_alasan text)
returns void
language plpgsql
as $$
declare
  v_bu uuid;
  v_status text;
begin
  select business_unit_id, status into v_bu, v_status from stock_counts where id = p_count;
  if v_bu is null then raise exception 'Sesi opname tidak ditemukan.'; end if;
  if v_status <> 'open' then raise exception 'Sesi ini sudah tidak terbuka.'; end if;
  if not is_bu_admin(auth.uid(), v_bu) then
    raise exception 'Hanya Admin BU atau Super Admin yang bisa membatalkan sesi opname.';
  end if;
  -- Alasan WAJIB. Sesi yang dibatalkan tanpa keterangan tidak bisa dibedakan
  -- dari kelalaian saat dibaca berbulan-bulan kemudian.
  if coalesce(trim(p_alasan), '') = '' then
    raise exception 'Isi alasan pembatalan — sesi ini tetap tersimpan sebagai riwayat.';
  end if;

  update stock_counts
  set status = 'cancelled', closed_by = auth.uid(), closed_at = now(),
      notes = coalesce(notes || ' | ', '') || 'DIBATALKAN: ' || trim(p_alasan)
  where id = p_count;
end;
$$;

revoke all on function batalkan_opname(uuid, text) from public;
grant execute on function batalkan_opname(uuid, text) to authenticated;

revoke all on function buka_opname(uuid, text) from public;
grant execute on function buka_opname(uuid, text) to authenticated;
revoke all on function catat_hitungan_opname(uuid, uuid, numeric, numeric, text) from public;
grant execute on function catat_hitungan_opname(uuid, uuid, numeric, numeric, text) to authenticated;
revoke all on function tutup_opname(uuid) from public;
grant execute on function tutup_opname(uuid) to authenticated;
