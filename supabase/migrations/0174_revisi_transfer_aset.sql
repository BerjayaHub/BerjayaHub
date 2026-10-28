-- =========================================================
-- 0174 — REVISI SURAT JALAN TRANSFER ASET
--
-- Surat jalan yang sudah terbit kadang salah: jumlahnya keliru, barangnya
-- kurang satu, atau outlet tujuannya salah pilih. Sebelum ini satu-satunya
-- jalan adalah Batalkan lalu kirim ulang — yang menghasilkan DUA surat jalan
-- untuk satu perjalanan, dan rekap "berapa yang pindah bulan ini" ikut
-- menggelembung.
--
-- ============ REVISI = BALIKKAN SELURUHNYA, LALU TERAPKAN YANG BARU ============
--
-- Bukan menambal selisih baris per baris. Menghitung delta terdengar lebih
-- hemat, tapi ia harus menangani: baris yang hilang, baris yang bertambah,
-- jumlah yang naik, jumlah yang turun, DAN outlet tujuan yang berpindah —
-- lima kasus yang saling bersilangan, masing-masing dengan penjaganya sendiri.
--
-- Membalikkan dulu lalu menerapkan ulang memakai dua jalur yang SUDAH ADA dan
-- sudah diuji (`batalkan_transfer_aset` dan `kirim_transfer_aset`). Satu-
-- satunya hal baru yang perlu dipercaya adalah urutannya.
--
-- ============ OUTLET TUJUAN BOLEH BERPINDAH ============
--
-- Diminta begitu. Akibatnya: barang ditarik dari outlet tujuan LAMA dan
-- didorong ke outlet tujuan BARU dalam satu langkah. Itu dua perpindahan
-- stok di bawah satu nomor surat jalan, dan riwayat tiga outlet jadi saling
-- terkait lewat satu dokumen.
--
-- Konsekuensinya diterima dengan sadar, dan ditutup dua hal: penjaga di bawah
-- MENOLAK revisi kalau outlet tujuan lama sudah tidak punya barangnya, dan
-- tiap revisi menaikkan `revisi_ke` supaya surat jalan versi lama yang sudah
-- beredar di WhatsApp bisa dikenali sebagai versi lama.
-- =========================================================

alter table asset_transfer add column if not exists revisi_ke int not null default 0;
alter table asset_transfer add column if not exists direvisi_at timestamptz;
alter table asset_transfer add column if not exists direvisi_by uuid references user_profiles(id) on delete set null;
alter table asset_transfer add column if not exists direvisi_by_nama text;
alter table asset_transfer add column if not exists alasan_revisi text;

comment on column asset_transfer.revisi_ke is
  'Naik tiap kali direvisi. Dicetak di surat jalan supaya versi lama yang sudah beredar di WhatsApp bisa dikenali sebagai versi lama.';

create or replace function ubah_transfer_aset(
  p_id uuid,
  p_to_outlet uuid,
  p_tujuan_lain text,
  p_pembawa text,
  p_items jsonb,
  p_alasan text,
  p_catatan text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_nama text;
  t record;
  r record;
  v_lain text := nullif(btrim(coalesce(p_tujuan_lain, '')), '');
  v_bu_tujuan uuid;
  v_ada numeric;
  it jsonb;
  v_item uuid;
  v_qty numeric;
  v_sisa numeric;
  v_kode_item text;
  v_nama_item text;
  v_kat text;
  v_size text;
  v_item_tujuan uuid;
  v_n int := 0;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if btrim(coalesce(p_alasan, '')) = '' then
    -- Surat jalan yang isinya berubah tanpa keterangan kenapa akan
    -- diperdebatkan nanti oleh dua outlet yang angkanya sama-sama bergeser.
    raise exception 'Alasan revisi wajib diisi.';
  end if;
  if btrim(coalesce(p_pembawa, '')) = '' then
    raise exception 'Nama pembawa barang wajib diisi.';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Belum ada barang yang dipilih. Kalau seluruh kirimannya batal, pakai Batalkan.';
  end if;

  select * into t from asset_transfer where id = p_id for update;
  if t.id is null then raise exception 'Surat jalan tidak ditemukan.'; end if;
  if t.dibatalkan_at is not null then raise exception 'Surat jalan ini sudah dibatalkan, tidak bisa direvisi.'; end if;
  if not is_bu_admin(v_uid, t.business_unit_id) then
    raise exception 'Hanya Admin BU pengirim yang boleh merevisi transfer.';
  end if;

  if p_to_outlet is not null and v_lain is not null then
    raise exception 'Pilih salah satu: outlet tujuan ATAU tujuan lain-lain.';
  end if;
  if p_to_outlet is null and v_lain is null then
    raise exception 'Tujuan wajib diisi.';
  end if;
  if p_to_outlet is not null then
    select business_unit_id into v_bu_tujuan from outlets where id = p_to_outlet;
    if v_bu_tujuan is null then raise exception 'Outlet tujuan tidak dikenal.'; end if;
    if p_to_outlet = t.from_outlet_id then raise exception 'Outlet asal dan tujuan tidak boleh sama.'; end if;
  end if;

  v_nama := nama_pengguna(v_uid);

  -- ============ 1. PERIKSA SELURUH PEMBALIKAN DULU ============
  --
  -- Kalau barang ketiga sudah terpakai di outlet tujuan, revisinya harus gagal
  -- UTUH. Membalikkan dua yang pertama lalu berhenti meninggalkan surat jalan
  -- yang isinya tidak cocok dengan stok mana pun.
  for r in select * from asset_transfer_item where transfer_id = p_id loop
    if r.item_tujuan_id is not null and t.to_outlet_id is not null then
      select qty into v_ada from asset_stock
       where asset_item_id = r.item_tujuan_id and outlet_id = t.to_outlet_id;
      if coalesce(v_ada, 0) < r.qty then
        raise exception 'Tidak bisa direvisi: "%" di outlet tujuan sekarang tinggal %, sedangkan surat jalan ini memindahkan %.',
          r.item_nama, coalesce(v_ada, 0), r.qty;
      end if;
    end if;
  end loop;

  -- ============ 2. BALIKKAN ============
  for r in select * from asset_transfer_item where transfer_id = p_id loop
    if r.asset_item_id is not null then
      update asset_stock set qty = qty + r.qty, updated_by = v_uid, updated_at = now()
       where asset_item_id = r.asset_item_id and outlet_id = t.from_outlet_id;
    end if;
    if r.item_tujuan_id is not null and t.to_outlet_id is not null then
      update asset_stock set qty = qty - r.qty, updated_by = v_uid, updated_at = now()
       where asset_item_id = r.item_tujuan_id and outlet_id = t.to_outlet_id;
    end if;
  end loop;
  delete from asset_transfer_item where transfer_id = p_id;

  -- ============ 3. TERAPKAN YANG BARU ============
  for it in select * from jsonb_array_elements(p_items) loop
    v_item := (it->>'item_id')::uuid;
    v_qty := nullif(it->>'qty', '')::numeric;
    if v_item is null or v_qty is null or v_qty <= 0 then continue; end if;

    select kode, name, category, size into v_kode_item, v_nama_item, v_kat, v_size
      from asset_items where id = v_item and business_unit_id = t.business_unit_id;
    if v_kode_item is null then raise exception 'Barang tidak ditemukan di BU ini.'; end if;

    select qty into v_sisa from asset_stock
     where asset_item_id = v_item and outlet_id = t.from_outlet_id
     for update;
    if v_sisa is null then
      raise exception '"%" belum didata di outlet asal.', v_nama_item;
    end if;
    if v_qty > v_sisa then
      raise exception 'Tercatat cuma % "%" di outlet asal, tidak bisa mengirim %.', v_sisa, v_nama_item, v_qty;
    end if;

    update asset_stock set qty = qty - v_qty, updated_by = v_uid, updated_at = now()
     where asset_item_id = v_item and outlet_id = t.from_outlet_id;

    v_item_tujuan := null;
    if p_to_outlet is not null then
      if v_bu_tujuan = t.business_unit_id then
        v_item_tujuan := v_item;
      else
        select id into v_item_tujuan from asset_items
         where business_unit_id = v_bu_tujuan and name = v_nama_item and category is not distinct from v_kat
         limit 1;
        if v_item_tujuan is null then
          insert into asset_items (business_unit_id, kode, name, category, size, created_by)
          values (v_bu_tujuan, kode_aset_berikutnya(v_bu_tujuan, v_kat), v_nama_item, v_kat, v_size, v_uid)
          returning id into v_item_tujuan;
        end if;
      end if;

      insert into asset_stock (asset_item_id, outlet_id, qty, created_by, updated_by)
      values (v_item_tujuan, p_to_outlet, v_qty, v_uid, v_uid)
      on conflict (asset_item_id, outlet_id) do update
        set qty = asset_stock.qty + excluded.qty, updated_by = v_uid, updated_at = now();
    end if;

    insert into asset_transfer_item (transfer_id, asset_item_id, item_kode, item_nama, qty, item_tujuan_id)
    values (p_id, v_item, v_kode_item, v_nama_item, v_qty, v_item_tujuan);
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then
    raise exception 'Tidak ada barang yang sah. Kalau seluruh kirimannya batal, pakai Batalkan.';
  end if;

  update asset_transfer
     set to_outlet_id = p_to_outlet,
         tujuan_lain = v_lain,
         pembawa = btrim(p_pembawa),
         catatan = nullif(btrim(coalesce(p_catatan, '')), ''),
         revisi_ke = revisi_ke + 1,
         direvisi_at = now(),
         direvisi_by = v_uid,
         direvisi_by_nama = v_nama,
         alasan_revisi = btrim(p_alasan)
   where id = p_id;

  insert into asset_log (asset_item_id, business_unit_id, outlet_id, aksi, kolom, sebelum, sesudah, catatan, oleh, oleh_nama)
  values (null, t.business_unit_id, t.from_outlet_id, 'revisi-transfer', t.kode,
          coalesce((select name from outlets where id = t.to_outlet_id), t.tujuan_lain),
          coalesce((select name from outlets where id = p_to_outlet), v_lain),
          btrim(p_alasan), v_uid, v_nama);

  return jsonb_build_object('kode', t.kode, 'revisi_ke', t.revisi_ke + 1, 'jumlah_barang', v_n);
end;
$$;

revoke all on function ubah_transfer_aset(uuid, uuid, text, text, jsonb, text, text) from public;
grant execute on function ubah_transfer_aset(uuid, uuid, text, text, jsonb, text, text) to authenticated;

notify pgrst, 'reload schema';
