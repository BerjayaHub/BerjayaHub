-- =========================================================
-- 0182 — OPNAME MENYELURUH: YANG TIDAK DIISI DIANGGAP HABIS (0)
--
--   "sekarang saya ingin bila yang tidak diisi maka dianggap 0"
--
-- ============ APA YANG BERUBAH ============
--
-- Sebelum ini (0085): hanya bahan yang BENAR-BENAR dihitung menghasilkan
-- penyesuaian. Bahan yang tidak disentuh mempertahankan stok sistemnya.
--
-- Sekarang: menutup sesi opname menolkan SELURUH bahan aktif di outlet itu
-- yang tidak dihitung. Satu sesi opname = pernyataan menyeluruh tentang isi
-- gudang outlet itu, bukan koreksi sebagian.
--
-- ============ YANG HARUS DITERIMA, DAN DITULIS DI SINI SUPAYA TIDAK LUPA ====
--
-- Opname SEBAGIAN tidak mungkin lagi. Sesi yang dibuka untuk membetulkan tiga
-- bahan, lalu ditutup, akan menolkan semua bahan lain di outlet itu. Itu
-- konsekuensi yang diminta dan disengaja — tapi ia tidak boleh DIAM:
--
--   * layar staff mengatakannya sebelum orang mulai menghitung;
--   * `pratinjau_tutup_opname` menyebut berapa bahan yang akan dinolkan,
--     ditampilkan di dialog admin SEBELUM tombol Tutup ditekan;
--   * tiap penolan meninggalkan baris `stock_count_items` bertanda
--     `otomatis = true` dan pergerakan stok yang catatannya berbunyi
--     "tidak dihitung, dianggap habis".
--
-- Tanpa ketiganya, stok gudang bisa lenyap karena orangnya belum sampai ke rak
-- itu — dan tidak ada satu pun tempat yang bisa ditanya kenapa.
--
-- ============ YANG TETAP TIDAK DISENTUH ============
--
--   * `batalkan_opname` — sesi yang dibatalkan tidak menyentuh stok sama
--     sekali, termasuk tidak menolkan apa pun. Itu jalan keluar untuk sesi
--     yang terlanjur dibuka tapi tidak jadi dikerjakan.
--   * Produk bertipe `finished` (menu) — stoknya tidak dihitung lewat opname
--     bahan, persis seperti di layarnya.
--   * Produk NONAKTIF — ia tidak tampil di layar opname, jadi menolkannya
--     berarti menghukum orang karena tidak mengisi kotak yang tidak pernah
--     ada.
-- =========================================================

-- ---------------------------------------------------------
-- 1. PENANDA BARIS YANG LAHIR SENDIRI
--
-- Tanpa kolom ini, baris "0" hasil penolan tidak bisa dibedakan dari angka 0
-- yang benar-benar diketik orang di depan rak. Keduanya sama-sama nol, dan
-- hanya satu yang berarti "sudah dilihat, memang habis".
-- ---------------------------------------------------------
alter table stock_count_items add column if not exists otomatis boolean not null default false;

comment on column stock_count_items.otomatis is
  'true = baris ini tidak diketik siapa pun; ia lahir saat sesi ditutup karena bahannya tidak dihitung (0182).';

-- ---------------------------------------------------------
-- 2. PRATINJAU — ANGKANYA DILIHAT SEBELUM TERJADI
--
-- Menutup sesi mengubah stok dan tidak bisa dibatalkan. Admin harus bisa
-- melihat "37 bahan akan dianggap habis" SEBELUM menekan tombolnya, bukan
-- menemukannya di laporan minggu depan.
-- ---------------------------------------------------------
create or replace function pratinjau_tutup_opname(p_count uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bu uuid;
  v_outlet uuid;
  v_status text;
  v_dihitung int;
  v_nol int;
  v_nama text[];
begin
  select business_unit_id, outlet_id, status into v_bu, v_outlet, v_status
    from stock_counts where id = p_count;
  if v_bu is null then raise exception 'Sesi opname tidak ditemukan.'; end if;
  if not has_outlet_scope(auth.uid(), v_outlet) then
    raise exception 'Kamu tidak punya akses ke outlet ini.';
  end if;

  select count(*) into v_dihitung from stock_count_items where count_id = p_count;

  -- Yang akan dinolkan: bahan aktif BU ini yang tidak punya baris hitungan DAN
  -- stok sistemnya bukan nol. Yang stoknya sudah nol tidak menghasilkan
  -- pergerakan apa pun, jadi menyebutnya di dialog hanya membesarkan angka
  -- yang menakutkan tanpa menambah keterangan.
  select count(*), (array_agg(nama order by nama))[1:10]
    into v_nol, v_nama
    from (
      select p.name as nama,
             (select coalesce(sum(sm.qty_delta), 0) from stock_movements sm
               where sm.outlet_id = v_outlet and sm.product_id = p.id) as sistem
        from products p
       where p.business_unit_id = v_bu
         and coalesce(p.is_active, true)
         and p.product_type <> 'finished'
         and not exists (select 1 from stock_count_items i where i.count_id = p_count and i.product_id = p.id)
    ) x
   where x.sistem <> 0;

  return jsonb_build_object(
    'status', v_status,
    'dihitung', coalesce(v_dihitung, 0),
    'akan_dinolkan', coalesce(v_nol, 0),
    'contoh', coalesce(to_jsonb(v_nama), '[]'::jsonb)
  );
end;
$$;

revoke all on function pratinjau_tutup_opname(uuid) from public;
grant execute on function pratinjau_tutup_opname(uuid) to authenticated;

comment on function pratinjau_tutup_opname(uuid) is
  'Berapa bahan yang dihitung & berapa yang akan dianggap habis kalau sesi ini ditutup (0182). Tidak mengubah apa pun.';

-- ---------------------------------------------------------
-- 3. `tutup_opname` — DUA TAHAP
--
-- Ditulis ulang dari 0085 dengan SATU tambahan: tahap kedua. Tahap pertamanya
-- (penyesuaian dari hitungan yang masuk) disalin apa adanya, dan auditnya
-- membandingkan baris demi baris supaya tidak ada penjagaan yang hilang
-- diam-diam — kekeliruan yang persis terjadi di 0179.
-- ---------------------------------------------------------
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

  -- ---- TAHAP 1: yang benar-benar dihitung ----
  for r in select product_id, counted_qty, system_qty from stock_count_items where count_id = p_count loop
    if r.counted_qty - r.system_qty <> 0 then
      insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by, count_id)
      values (v_bu, v_outlet, r.product_id, 'adjustment', r.counted_qty - r.system_qty,
              'Opname ' || v_code, auth.uid(), p_count);
      v_n := v_n + 1;
    end if;
  end loop;

  -- ---- TAHAP 2 (0182): yang TIDAK dihitung dianggap habis ----
  --
  -- Stok sistemnya dibaca DI SINI, saat menutup — bukan dari potret mana pun.
  -- Antara pembukaan sesi dan penutupannya bisa ada nota masuk, penjualan, dan
  -- waste; yang harus dinolkan adalah keadaan terakhir, bukan keadaan saat
  -- sesinya dibuka.
  --
  -- Barisnya ikut dicatat di `stock_count_items` (counted 0, `otomatis`),
  -- supaya laporan sesi ini menyebutkan apa saja yang dinolkan. Tanpa itu,
  -- stok hilang tanpa satu pun baris yang bisa ditunjuk.
  for r in
    select p.id as product_id,
           (select coalesce(sum(sm.qty_delta), 0) from stock_movements sm
             where sm.outlet_id = v_outlet and sm.product_id = p.id) as sistem
      from products p
     where p.business_unit_id = v_bu
       and coalesce(p.is_active, true)
       and p.product_type <> 'finished'
       and not exists (select 1 from stock_count_items i where i.count_id = p_count and i.product_id = p.id)
  loop
    if r.sistem <> 0 then
      insert into stock_count_items (count_id, product_id, system_qty, counted_qty, counted_by, notes, otomatis)
      values (p_count, r.product_id, r.sistem, 0, auth.uid(), 'Tidak dihitung — dianggap habis', true);

      insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by, count_id)
      values (v_bu, v_outlet, r.product_id, 'adjustment', -r.sistem,
              'Opname ' || v_code || ' — tidak dihitung, dianggap habis', auth.uid(), p_count);
      v_n := v_n + 1;
    end if;
  end loop;

  update stock_counts set status = 'closed', closed_by = auth.uid(), closed_at = now() where id = p_count;
  if not found then raise exception 'Tidak tersimpan — kamu tidak punya wewenang di outlet ini.'; end if;

  return v_n;
end;
$$;

revoke all on function tutup_opname(uuid) from public;
grant execute on function tutup_opname(uuid) to authenticated;

comment on function tutup_opname(uuid) is
  'Tutup sesi opname: hitungan yang masuk disesuaikan, dan bahan yang TIDAK dihitung dianggap habis (0182).';

notify pgrst, 'reload schema';
