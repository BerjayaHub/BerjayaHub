-- =========================================================
-- 0066 — Menghapus kantong kas tanpa menghilangkan uangnya
--
-- MASALAHNYA APA
-- `cash_entries.account_id` memakai `on delete restrict`, jadi kantong yang
-- pernah dipakai transaksi TIDAK bisa dihapus sama sekali. Yang muncul di layar
-- adalah pesan Postgres mentah tentang foreign key — bukan penjelasan, dan
-- bukan jalan keluar. Praktiknya orang lalu meninggalkan kantong yang tidak
-- terpakai selamanya, dan jatah kantongnya habis oleh sampah.
--
-- KEPUTUSANNYA
-- Menghapus kantong = memindahkan seluruh isinya ke kantong lain (boleh ke
-- "Kas Utama", yaitu account_id NULL), baru barisnya dihapus. Saldo total orang
-- itu TIDAK berubah sepeser pun.
--
-- Kenapa entri-nya dipindahkan (account_id di-update), bukan dibuatkan sepasang
-- baris mutasi seperti `pindah_kas()`: kantong itu cuma LABEL untuk uang milik
-- sendiri. Transaksinya — tanggal, nominal, nota, outlet peruntukan — tidak
-- berubah sama sekali; yang hilang hanya nama laci tempat ia disimpan.
-- Menambahkan sepasang baris mutasi ke kantong yang sudah tidak ada justru
-- membuat riwayatnya lebih sulit dibaca, bukan lebih jujur.
--
-- Konsekuensi yang harus disadari: laporan periode lampau akan menampilkan
-- kantong yang BARU untuk transaksi lama. Itu memang sifat "kantong" — sama
-- seperti mengganti nama kantong, yang otomatis mengubah seluruh laporan karena
-- namanya dibaca langsung dari tabel, bukan disalin ke tiap baris.
-- =========================================================

create or replace function hapus_kantong_kas(p_account uuid, p_target uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_pindah integer;
begin
  if p_account is null then
    raise exception 'Kas Utama bukan kantong dan tidak bisa dihapus.';
  end if;
  if p_account is not distinct from p_target then
    raise exception 'Kantong tujuan tidak boleh sama dengan kantong yang dihapus.';
  end if;

  -- Kepemilikan diperiksa untuk KEDUANYA. Tanpa pemeriksaan tujuan, seseorang
  -- bisa membuang isi kantongnya ke kantong orang lain lewat RPC ini — transfer
  -- terselubung yang tidak tercatat sebagai transfer.
  if not exists (select 1 from cash_accounts where id = p_account and holder_id = v_uid) then
    raise exception 'Kantong yang mau dihapus bukan milikmu.';
  end if;
  if p_target is not null and not exists (select 1 from cash_accounts where id = p_target and holder_id = v_uid) then
    raise exception 'Kantong tujuan bukan milikmu.';
  end if;

  update cash_entries
  set account_id = p_target
  where holder_id = v_uid and account_id = p_account;
  get diagnostics v_pindah = row_count;

  -- Baris milik orang lain tidak mungkin ada (kantong ini miliknya sendiri),
  -- tapi kalau toh ada, DELETE di bawah akan gagal karena `on delete restrict`
  -- — dan itu memang yang benar: lebih baik gagal daripada menghapus penunjuk
  -- kantong dari entri yang tidak ikut dipindahkan.
  delete from cash_accounts where id = p_account and holder_id = v_uid;

  return v_pindah;
end;
$$;

comment on function hapus_kantong_kas(uuid, uuid) is
  'Hapus kantong kas: seluruh entri di dalamnya dipindahkan ke p_target (NULL = Kas Utama) lebih dulu, baru kantongnya dihapus. Saldo total pemegang tidak berubah.';

revoke all on function hapus_kantong_kas(uuid, uuid) from public;
grant execute on function hapus_kantong_kas(uuid, uuid) to authenticated;
