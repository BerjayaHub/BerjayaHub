-- =========================================================
-- 0081 — "Outlet yang bisa kulihat" ≠ "outlet yang bisa kuatur"
--
-- GEJALANYA: admin outlet membuka Jadwal Shift, memilih shift di sebuah sel,
-- dan mendapat *"new row violates row-level security policy"*. Tidak ada yang
-- bisa dia lakukan dengan pesan itu.
--
-- SEBABNYA: dropdown outlet di layar ADMIN diisi `listMyOutlets()`, yang
-- menjawab pertanyaan "outlet mana yang boleh kulihat". Aturannya (my-outlets.js)
-- membuka SELURUH outlet BU untuk siapa pun yang punya scope tanpa outlet_id —
-- termasuk seseorang berperan `outlet_admin` yang scope-nya terlanjur dibuat di
-- level BU, dan termasuk admin outlet yang punya scope tambahan level BU.
--
-- Sementara yang menentukan boleh-tidaknya MENULIS adalah `is_admin_of_outlet()`,
-- yang untuk `outlet_admin` mensyaratkan `ms.outlet_id = outlet yang dituju`.
--
-- Jadi orangnya melihat outlet yang tidak pernah boleh dia sentuh, dan baru tahu
-- setelah menekan sesuatu. Yang salah bukan izinnya — izinnya justru bekerja
-- persis seperti seharusnya. Yang salah adalah layar yang menawarkan pilihan
-- yang pasti ditolak.
--
-- PERBAIKANNYA: satu RPC yang menjawab pertanyaan yang BENAR untuk layar admin,
-- dengan memanggil `is_admin_of_outlet()` yang sama persis dipakai RLS. Dua
-- sumber jawaban yang berbeda untuk satu pertanyaan pasti akan menyimpang;
-- yang ini tidak bisa menyimpang karena sumbernya memang satu.
--
-- WEWENANGNYA TIDAK DIUBAH SEDIKIT PUN. Menambal ini dengan melonggarkan
-- `is_admin_of_outlet()` (mis. "outlet_admin tanpa outlet_id = admin seluruh BU")
-- akan diam-diam memberi wewenang baru di SELURUH modul yang memakainya — kas,
-- presensi, reservasi, aktivitas harian — hanya untuk memperbaiki satu dropdown.
-- =========================================================

create or replace function outlets_saya_kelola(p_bu uuid default null)
returns table (
  id uuid,
  name text,
  business_unit_id uuid,
  business_unit_name text,
  shift_enabled boolean,
  reservation_mode text
)
language sql
security definer
stable
set search_path = public
as $$
  select o.id, o.name, o.business_unit_id, bu.name, o.shift_enabled, o.reservation_mode
  from outlets o
  join business_units bu on bu.id = o.business_unit_id
  where o.is_active
    and (p_bu is null or o.business_unit_id = p_bu)
    and is_admin_of_outlet(auth.uid(), o.id)
  order by bu.name, o.name;
$$;

comment on function outlets_saya_kelola(uuid) is
  'Outlet yang benar-benar boleh DIATUR akun ini — memakai is_admin_of_outlet(), fungsi yang sama dengan RLS. Untuk layar admin. Untuk sekadar MELIHAT, pakai listMyOutlets() di sisi aplikasi.';

revoke all on function outlets_saya_kelola(uuid) from public;
grant execute on function outlets_saya_kelola(uuid) to authenticated;
