-- ============================================================
-- 0157 — KETERANGAN BARIS SURAT JALAN BISA DIKOSONGKAN LAGI.
--
--   "cek dibagian pengiriman sisi staff app, apakah barang yang sedang
--    disiapkan staff, yaitu yang sudah jadi draft, sudah ada keterangan
--    catatan atau belum?"
--
-- Jawabannya: kolomnya ada sejak `0132`, tapi kotaknya tidak pernah muncul di
-- layar DRAFT — hanya di layar "Siapkan" (saat draft dibuat) dan di layar
-- Terima. Begitu kotaknya dipasang di layar draft, satu penjaga lama di
-- `0132` berubah arti.
--
-- ============ PENJAGA YANG BENAR SAAT DITULIS ============
--
-- `0132` menyelamatkan keterangan yang TIDAK dikirim ulang klien:
--
--     coalesce(
--       nullif(btrim(coalesce(it->>'keterangan', '')), ''),
--       v_lama -> v_pid::text ->> 'k'
--     )
--
-- Alasannya sah dan masih berlaku: PWA lama di HP staff tidak mengenal kolom
-- itu sama sekali, dan tanpa penyelamatan ini satu kali "Simpan perubahan"
-- dari HP tersebut menghapus seluruh keterangan yang sudah diketik.
--
-- ============ YANG BERUBAH SESUDAH KOTAKNYA ADA ============
--
-- Ekspresi di atas tidak bisa membedakan dua hal yang artinya berlawanan:
--
--     kunci `keterangan` TIDAK ADA     -> "aku tidak tahu kolom ini"
--     kunci ADA tapi isinya kosong     -> "aku sengaja mengosongkannya"
--
-- Keduanya jatuh ke cabang yang sama, jadi staff yang menghapus keterangan
-- salah ketik akan melihatnya MUNCUL KEMBALI sesudah menyimpan. Tidak ada
-- galat; kotaknya cuma terisi lagi sendiri, dan percobaan kedua & ketiga
-- menghasilkan hal yang sama.
--
-- Itu bentuk kegagalan yang paling melelahkan: layarnya menerima perintah,
-- melaporkan sukses, lalu membatalkannya diam-diam.
--
-- ============ PEMBEDANYA: OPERATOR `?` ============
--
-- `it ? 'keterangan'` menjawab "kuncinya ada atau tidak" — pertanyaan yang
-- berbeda dari "isinya kosong atau tidak". Dengan itu, PWA lama tetap
-- terlindungi (kuncinya memang tidak pernah ada di sana) dan pengosongan yang
-- disengaja sampai ke database.
--
-- `ordered_qty` SENGAJA TIDAK ikut diubah: tidak ada satu pun layar yang
-- mengirimkannya saat menyunting draft, jadi cabang "sengaja dikosongkan"
-- untuk kolom itu tidak pernah terjadi. Mengubahnya sekalian berarti
-- menambah jalan yang tidak pernah dilewati — dan jalan seperti itu tidak
-- pernah ikut teruji.
-- ============================================================

create or replace function ubah_draft_kiriman(p_dispatch uuid, p_items jsonb, p_notes text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  it jsonb;
  v_pid uuid;
  v_qty numeric;
  v_jumlah int := 0;
  v_positif int := 0;
  v_lama jsonb;
  v_ket text;
begin
  if not boleh_kelola_draft(p_dispatch) then
    raise exception 'Draft ini tidak bisa kamu ubah — mungkin sudah dikirim, atau di luar outlet yang kamu kelola.';
  end if;

  -- Isi lamanya disalin ke jsonb sebelum dihapus (0132). Lihat alasan
  -- "variabel, bukan temp table" di sana.
  select coalesce(jsonb_object_agg(product_id::text, jsonb_build_object('k', keterangan, 'o', ordered_qty)), '{}'::jsonb)
    into v_lama
    from dispatch_items where dispatch_id = p_dispatch;

  delete from dispatch_items where dispatch_id = p_dispatch;

  for it in select * from jsonb_array_elements(p_items) loop
    v_pid := (it->>'product_id')::uuid;
    v_qty := (it->>'qty')::numeric;
    if v_pid is null or v_qty is null or v_qty < 0 then continue; end if;

    -- ============ DI SINILAH 0157 BERBEDA DARI 0132 ============
    --
    -- Kuncinya ADA  -> pakai yang dikirim, termasuk kalau itu kosong.
    -- Kuncinya TIDAK ADA -> pertahankan yang lama (PWA lama di HP staff).
    if it ? 'keterangan' then
      v_ket := nullif(btrim(coalesce(it->>'keterangan', '')), '');
    else
      v_ket := v_lama -> v_pid::text ->> 'k';
    end if;

    insert into dispatch_items(dispatch_id, product_id, sent_qty, keterangan, ordered_qty)
    values (p_dispatch, v_pid, v_qty, v_ket,
            coalesce(
              nullif(it->>'ordered_qty', '')::numeric,
              (v_lama -> v_pid::text ->> 'o')::numeric
            ));
    v_jumlah := v_jumlah + 1;
    if v_qty > 0 then v_positif := v_positif + 1; end if;
  end loop;

  if v_jumlah = 0 then
    -- Membatalkan seluruh transaksi, termasuk `delete` di atas. Draft yang
    -- dikosongkan akan tetap muncul di daftar sebagai nomor SJ tanpa isi.
    raise exception 'Draft tidak boleh kosong. Kalau memang batal, hapus draftnya.';
  end if;

  -- Kalimatnya DISALIN apa adanya dari 0132, bukan diperbaiki sambil lewat.
  -- Berkas ini mengubah satu hal; pesan galat yang ikut berubah tanpa diminta
  -- membuat orang berikutnya mengira ada keputusan baru di baliknya.
  if v_positif = 0 then
    raise exception 'Semua barang jumlah kirimnya 0. Kalau memang tidak ada yang bisa dikirim, hapus draftnya dan tolak ordernya beserta alasan.';
  end if;

  update dispatches set notes = p_notes where id = p_dispatch;
end;
$$;

revoke all on function ubah_draft_kiriman(uuid, jsonb, text) from public;
grant execute on function ubah_draft_kiriman(uuid, jsonb, text) to authenticated;

comment on function ubah_draft_kiriman(uuid, jsonb, text) is
  'Ganti seluruh isi draft surat jalan. Keterangan baris: kunci `keterangan` yang ADA dipakai apa adanya (termasuk kosong, artinya sengaja dihapus); kunci yang TIDAK ADA mempertahankan nilai lama — itu yang melindungi PWA lama yang belum mengenal kolom ini.';

notify pgrst, 'reload schema';
