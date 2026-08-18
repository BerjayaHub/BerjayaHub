-- =========================================================
-- 0084 — Penerimaan barang PER NOTA
--
-- SEBELUMNYA: satu penerimaan = satu produk, satu tombol, satu kali. Padahal
-- barang datang dari supplier dalam satu nota berisi belasan item. Akibatnya
-- staff menekan "Terima" belasan kali, dan sesudahnya tidak ada satu pun tempat
-- yang bisa menjawab "nota nomor berapa isinya apa saja" — padahal itu
-- pertanyaan yang muncul tiap kali ada selisih tagihan dengan supplier.
--
-- Foto nota SENGAJA OPSIONAL. Nota fisik sering menyusul beberapa jam (atau
-- hari) setelah barangnya sampai; mewajibkannya berarti barang tidak tercatat
-- sampai kertasnya ada, dan stok yang terlambat dicatat jauh lebih merepotkan
-- daripada nota yang fotonya menyusul.
--
-- ================== EDIT: STOK IKUT DIKOREKSI ==================
--
-- Nota yang sudah tersimpan SUDAH menambah stok. Kalau isinya diubah, stoknya
-- harus ikut berubah — dan caranya BUKAN dengan mengubah pergerakan lama.
--
-- Pergerakan stok adalah CATATAN SEJARAH: "pada tanggal sekian masuk 10 kg".
-- Mengubahnya jadi 8 berarti berbohong tentang apa yang tercatat saat itu, dan
-- membuat saldo hari-hari di antaranya tidak bisa direkonstruksi. Yang dipakai
-- di sini: pergerakan PENYEIMBANG (+/- selisihnya) dengan catatan yang menyebut
-- nomor notanya. Saldo akhirnya sama, tapi riwayatnya tetap jujur — dan siapa
-- pun yang memeriksa bisa melihat bahwa pernah ada koreksi, kapan, dan berapa.
--
-- Ini juga sebabnya menghapus baris item TIDAK menghapus pergerakan lamanya:
-- yang dibuat adalah penyeimbang negatif sebesar jumlah terakhirnya.
-- =========================================================

create table if not exists goods_receipts (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  outlet_id uuid not null references outlets(id) on delete cascade,
  code text not null,
  -- Tanggal nota menurut SUPPLIER, bisa berbeda dari kapan diinput. Yang
  -- dipakai mencocokkan tagihan adalah tanggal notanya, bukan jam input.
  receipt_date date not null default (now() at time zone 'Asia/Jakarta')::date,
  supplier text,
  invoice_no text,
  photo_path text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists goods_receipts_code_uk on goods_receipts(code);
create index if not exists idx_gr_bu_outlet_date on goods_receipts(business_unit_id, outlet_id, receipt_date desc);

create table if not exists goods_receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references goods_receipts(id) on delete cascade,
  product_id uuid not null references products(id) on delete restrict,
  qty numeric not null check (qty > 0),
  unit_cost numeric,
  notes text
);
create index if not exists idx_gri_receipt on goods_receipt_items(receipt_id);

-- Menyambungkan pergerakan stok ke notanya. Tanpa kolom ini, "pergerakan per
-- nomor nota" harus ditebak dari catatan teks — dan tebakan tidak bisa dipakai
-- menyelesaikan selisih dengan supplier.
alter table stock_movements add column if not exists receipt_id uuid references goods_receipts(id) on delete set null;
create index if not exists idx_sm_receipt on stock_movements(receipt_id);

alter table goods_receipts enable row level security;
alter table goods_receipt_items enable row level security;

create policy gr_select on goods_receipts
  for select using (has_bu_scope(auth.uid(), business_unit_id));
-- Menulis butuh wewenang di OUTLET-nya, bukan sekadar anggota BU: nota
-- menambah stok, dan stok itu milik outlet tertentu.
create policy gr_modify on goods_receipts
  for all using (has_outlet_scope(auth.uid(), outlet_id))
  with check (has_outlet_scope(auth.uid(), outlet_id));

create policy gri_select on goods_receipt_items
  for select using (
    exists (select 1 from goods_receipts g where g.id = goods_receipt_items.receipt_id and has_bu_scope(auth.uid(), g.business_unit_id))
  );
create policy gri_modify on goods_receipt_items
  for all using (
    exists (select 1 from goods_receipts g where g.id = goods_receipt_items.receipt_id and has_outlet_scope(auth.uid(), g.outlet_id))
  )
  with check (
    exists (select 1 from goods_receipts g where g.id = goods_receipt_items.receipt_id and has_outlet_scope(auth.uid(), g.outlet_id))
  );

-- =========================================================
-- SIMPAN NOTA BARU — satu transaksi.
--
-- Nomornya dibuat server, bukan aplikasi: dua staff yang menekan Simpan pada
-- detik yang sama di dua HP tidak boleh menghasilkan nomor kembar, dan hanya
-- server yang bisa menjaminnya. Bentuknya mengikuti pola surat jalan (0024).
-- =========================================================
create or replace function simpan_nota_terima(
  p_outlet uuid,
  p_receipt_date date,
  p_supplier text,
  p_invoice_no text,
  p_photo_path text,
  p_notes text,
  p_items jsonb
) returns uuid
language plpgsql
as $$
declare
  v_bu uuid;
  v_uid uuid := auth.uid();
  v_id uuid := gen_random_uuid();
  v_code text;
  it jsonb;
  v_pid uuid;
  v_qty numeric;
  v_n int := 0;
begin
  select business_unit_id into v_bu from outlets where id = p_outlet;
  if v_bu is null then raise exception 'Outlet tidak dikenal.'; end if;

  v_code := 'TRM-' || to_char((now() at time zone 'Asia/Jakarta'), 'YYMMDD') || '-' || upper(substr(v_id::text, 1, 4));

  insert into goods_receipts (id, business_unit_id, outlet_id, code, receipt_date, supplier, invoice_no, photo_path, notes, created_by)
  values (v_id, v_bu, p_outlet, v_code,
          coalesce(p_receipt_date, (now() at time zone 'Asia/Jakarta')::date),
          nullif(p_supplier, ''), nullif(p_invoice_no, ''), nullif(p_photo_path, ''), nullif(p_notes, ''), v_uid);

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_pid := (it->>'product_id')::uuid;
    v_qty := (it->>'qty')::numeric;
    -- Baris tanpa produk atau berjumlah nol DILEWATI, bukan menggagalkan
    -- seluruh nota: form-nya menyisakan baris kosong di bawah, dan menolak
    -- seluruh nota karena baris kosong itu akan membuat orang mengetik ulang
    -- belasan item.
    if v_pid is null or v_qty is null or v_qty <= 0 then continue; end if;

    insert into goods_receipt_items (receipt_id, product_id, qty, unit_cost, notes)
    values (v_id, v_pid, v_qty, nullif(it->>'unit_cost', '')::numeric, nullif(it->>'notes', ''));

    insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, unit_cost, notes, created_by, receipt_id)
    values (v_bu, p_outlet, v_pid, 'receive', v_qty, nullif(it->>'unit_cost', '')::numeric,
            'Nota ' || v_code, v_uid, v_id);
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then
    raise exception 'Nota harus berisi minimal satu barang dengan jumlah lebih dari 0.';
  end if;

  return v_id;
end;
$$;

-- =========================================================
-- EDIT NOTA — kepala nota bebas, jumlah barang lewat penyeimbang.
--
-- `p_items` berisi keadaan yang DIINGINKAN. Selisihnya terhadap yang tersimpan
-- diterjemahkan jadi pergerakan penyeimbang; pergerakan lama tidak disentuh.
-- =========================================================
create or replace function ubah_nota_terima(
  p_id uuid,
  p_receipt_date date,
  p_supplier text,
  p_invoice_no text,
  p_photo_path text,
  p_notes text,
  p_items jsonb
) returns void
language plpgsql
as $$
declare
  v_bu uuid;
  v_outlet uuid;
  v_code text;
  v_uid uuid := auth.uid();
  it jsonb;
  v_pid uuid;
  v_qty numeric;
  v_lama numeric;
  v_selisih numeric;
  v_ada int;
begin
  select business_unit_id, outlet_id, code into v_bu, v_outlet, v_code from goods_receipts where id = p_id;
  if v_bu is null then raise exception 'Nota tidak ditemukan.'; end if;

  update goods_receipts
  set receipt_date = coalesce(p_receipt_date, receipt_date),
      supplier = nullif(p_supplier, ''),
      invoice_no = nullif(p_invoice_no, ''),
      -- Foto: NULL berarti "jangan sentuh", string kosong berarti "hapus".
      -- Dibedakan karena kasus paling sering adalah MENAMBAHKAN foto yang
      -- menyusul, dan itu tidak boleh menuntut mengunggah ulang yang lain.
      photo_path = case when p_photo_path is null then photo_path else nullif(p_photo_path, '') end,
      notes = nullif(p_notes, ''),
      updated_at = now()
  where id = p_id;
  get diagnostics v_ada = row_count;
  if v_ada = 0 then
    raise exception 'Tidak tersimpan — kamu tidak punya wewenang di outlet nota ini.';
  end if;

  -- Kalau `p_items` NULL, hanya kepala notanya yang diubah (mis. menambahkan
  -- foto yang menyusul). Ini jalur yang paling sering dipakai.
  if p_items is null then return; end if;

  -- 1. Item yang disebut: dibuat atau disesuaikan.
  for it in select * from jsonb_array_elements(p_items) loop
    v_pid := (it->>'product_id')::uuid;
    v_qty := (it->>'qty')::numeric;
    if v_pid is null or v_qty is null or v_qty <= 0 then continue; end if;

    select qty into v_lama from goods_receipt_items where receipt_id = p_id and product_id = v_pid;
    v_selisih := v_qty - coalesce(v_lama, 0);

    if v_lama is null then
      insert into goods_receipt_items (receipt_id, product_id, qty, unit_cost, notes)
      values (p_id, v_pid, v_qty, nullif(it->>'unit_cost', '')::numeric, nullif(it->>'notes', ''));
    else
      update goods_receipt_items
      set qty = v_qty, unit_cost = nullif(it->>'unit_cost', '')::numeric, notes = nullif(it->>'notes', '')
      where receipt_id = p_id and product_id = v_pid;
    end if;

    if v_selisih <> 0 then
      insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by, receipt_id)
      values (v_bu, v_outlet, v_pid, 'receive', v_selisih,
              'Koreksi nota ' || v_code || ' (' || coalesce(v_lama, 0) || ' -> ' || v_qty || ')', v_uid, p_id);
    end if;
  end loop;

  -- 2. Item yang HILANG dari daftar baru: dianggap dibatalkan.
  for v_pid, v_lama in
    select product_id, qty from goods_receipt_items
    where receipt_id = p_id
      and product_id not in (
        select (x->>'product_id')::uuid from jsonb_array_elements(p_items) x where (x->>'product_id') is not null
      )
  loop
    insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by, receipt_id)
    values (v_bu, v_outlet, v_pid, 'receive', -v_lama, 'Batal dari nota ' || v_code, v_uid, p_id);
    delete from goods_receipt_items where receipt_id = p_id and product_id = v_pid;
  end loop;
end;
$$;

revoke all on function simpan_nota_terima(uuid, date, text, text, text, text, jsonb) from public;
grant execute on function simpan_nota_terima(uuid, date, text, text, text, text, jsonb) to authenticated;
revoke all on function ubah_nota_terima(uuid, date, text, text, text, text, jsonb) from public;
grant execute on function ubah_nota_terima(uuid, date, text, text, text, text, jsonb) to authenticated;
