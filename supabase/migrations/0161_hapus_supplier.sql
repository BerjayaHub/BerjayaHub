-- =========================================================
-- 0161 — SUPPLIER BISA DIHAPUS, TAPI HANYA YANG BELUM DIPAKAI
--
--   "supplier yang sudah ditambahkan bisa dihapus selain hanya aksi edit saja"
--
-- ============ KENAPA INI BUTUH RPC, BUKAN `delete` BIASA ============
--
-- Baris `suppliers` bisa saja dihapus langsung lewat PostgREST — RLS-nya sudah
-- membatasi ke Admin BU. Yang TIDAK bisa dilakukan `delete` biasa adalah
-- menolak penghapusan yang merusak, dan di sini ada dua jalur kerusakan yang
-- bentuknya berbeda:
--
--   `goods_receipts.supplier_id`  FK-nya `on delete set null` (0158). Jadi
--                                 menghapus supplier yang dipakai 42 nota TIDAK
--                                 menghasilkan galat apa pun: 42 nota diam-diam
--                                 kehilangan induknya, kolom teksnya tertinggal
--                                 sebagai nama yang tidak menunjuk apa-apa, dan
--                                 ekspor ESB menahannya berminggu-minggu
--                                 kemudian dengan alasan yang terlihat datang
--                                 entah dari mana.
--
--   `cash_entries.supplier`       TEKS, bukan FK (0149) — jadi database tidak
--                                 tahu hubungannya sama sekali. Menghapus
--                                 "Kas Operasional" tidak menyentuh satu pun
--                                 baris kas, tapi form kas keluar lalu menolak
--                                 nilai yang sudah tersimpan di sana, dan
--                                 membetulkan satu huruf di keterangan sebuah
--                                 entri lama jadi mustahil.
--
-- Keduanya kerusakan SUNYI, dan keduanya hanya bisa dicegah sebelum
-- penghapusannya terjadi. Maka penghapusannya lewat fungsi yang memeriksa
-- dulu, dan RLS `for all` yang sudah ada dipersempit supaya `delete` langsung
-- tidak bisa melewatinya.
--
-- ============ YANG DITAWARKAN SEBAGAI GANTINYA ============
--
-- Supplier yang masih dipakai TIDAK dihapus — ia digabungkan (`gabung_supplier`,
-- 0158), yang memindahkan notanya ke induk yang benar lebih dulu. Itu yang
-- sebenarnya diinginkan orang yang menekan Hapus pada supplier kembar; dan
-- untuk supplier yang memang sudah tidak dipakai lagi tapi notanya harus tetap
-- ada, jalannya menonaktifkan, bukan menghapus.
--
-- Kalimat penolakannya menyebut JUMLAHNYA dan menyebut jalan keluarnya. Pesan
-- yang cuma berbunyi "tidak bisa dihapus" meninggalkan orangnya di tempat yang
-- sama persis.
-- =========================================================

create or replace function hapus_supplier(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bu uuid;
  v_nama text;
  v_nota int;
  v_kas int;
begin
  select business_unit_id, nama into v_bu, v_nama from suppliers where id = p_id;
  if v_bu is null then
    raise exception 'Supplier tidak ditemukan.';
  end if;
  if not is_bu_admin(auth.uid(), v_bu) then
    raise exception 'Hanya Admin BU atau Super Admin yang bisa menghapus supplier.';
  end if;

  select count(*) into v_nota from goods_receipts where supplier_id = p_id;

  -- ============ KAS DICOCOKKAN LEWAT NAMA TERNORMALKAN ============
  --
  -- `cash_entries.supplier` adalah teks bebas (0149), jadi tidak ada FK yang
  -- bisa ditanyai. Dicocokkan dengan aturan yang SAMA dengan indeks unik
  -- `suppliers` — `normal_nama_supplier` — supaya entri kas yang ditulis
  -- "kas  operasional" ikut terhitung. Membandingkan dengan `=` biasa akan
  -- melewatkannya, dan penjaga ini lalu meloloskan penghapusan yang justru
  -- paling merusak: yang ejaannya berbeda tipis.
  select count(*) into v_kas
    from cash_entries c
   where coalesce(btrim(c.supplier), '') <> ''
     and normal_nama_supplier(c.supplier) = normal_nama_supplier(v_nama);

  if v_nota > 0 or v_kas > 0 then
    raise exception
      '"%" masih dipakai % nota dan % entri kas, jadi tidak bisa dihapus. Kalau ini nama kembar, pakai Gabungkan supaya dokumennya pindah ke induk yang benar. Kalau supplier ini memang sudah tidak dipakai lagi, nonaktifkan saja lewat Edit.',
      v_nama, v_nota, v_kas;
  end if;

  delete from suppliers where id = p_id;
end;
$$;

revoke all on function hapus_supplier(uuid) from public;
grant execute on function hapus_supplier(uuid) to authenticated;

comment on function hapus_supplier(uuid) is
  'Hapus satu supplier, HANYA kalau tidak dipakai nota maupun entri kas. Yang masih dipakai diarahkan ke gabung_supplier.';

-- ---------------------------------------------------------
-- PENJAGANYA TIDAK BOLEH BISA DILEWATI
--
-- Policy `suppliers_modify` dari 0158 adalah `for all`, yang MEMUAT `delete`.
-- Selama ia begitu, seluruh pemeriksaan di atas cuma saran: satu panggilan
-- PostgREST `DELETE /suppliers?id=eq.…` dari admin yang sama akan melewatinya
-- tanpa menyentuh fungsi ini sama sekali.
--
-- Jadi `for all` dipecah: insert/update/select tetap seperti semula, dan
-- `delete` TIDAK diberi policy sama sekali — artinya ditolak untuk semua orang,
-- dan satu-satunya jalan menghapus adalah lewat `hapus_supplier` yang
-- `security definer`.
--
-- Nama policy lamanya di-drop lebih dulu; `create policy` tidak punya
-- `if not exists`, jadi tanpa itu menjalankan berkas ini dua kali berhenti di
-- tengah dengan "policy already exists".
-- ---------------------------------------------------------
drop policy if exists suppliers_modify on suppliers;
drop policy if exists suppliers_insert on suppliers;
drop policy if exists suppliers_update on suppliers;

create policy suppliers_insert on suppliers
  for insert with check (is_bu_admin(auth.uid(), business_unit_id));

create policy suppliers_update on suppliers
  for update using (is_bu_admin(auth.uid(), business_unit_id))
  with check (is_bu_admin(auth.uid(), business_unit_id));

-- Sengaja TIDAK ada `for delete`. Lihat alasannya di atas.

notify pgrst, 'reload schema';
