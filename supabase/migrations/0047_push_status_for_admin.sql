-- 0047_push_status_for_admin.sql
--
-- KENAPA ADA:
-- Staff yang belum pernah menekan "Aktifkan Notifikasi" TIDAK akan pernah
-- menerima reminder clock in. Sebelum ini kondisi tersebut tidak terlihat di
-- mana pun: `send-attendance-reminders` melewatinya diam-diam (`continue`
-- ketika langganan kosong), admin tidak punya cara tahu, dan staff-nya sendiri
-- merasa sudah beres. Satu-satunya cara mendeteksi adalah query manual ke
-- database — jelas bukan alur kerja yang wajar.
--
-- RLS `push_subscriptions` sengaja hanya mengizinkan pemilik membaca barisnya
-- sendiri (endpoint push itu rahasia — siapa pun yang memilikinya bisa
-- mengirim notifikasi ke device itu). Jadi admin TIDAK boleh diberi akses baca
-- ke tabelnya. Fungsi di bawah ini adalah jalan tengahnya: ia hanya
-- mengembalikan DAFTAR user_id yang punya langganan — tanpa endpoint, tanpa
-- kunci — sehingga admin cukup tahu "aktif / belum" dan tidak lebih.

create or replace function list_push_enabled_user_ids()
returns table (user_id uuid, subscription_count integer)
language sql
security definer
stable
set search_path = public
as $$
  select ps.user_id, count(*)::integer
  from push_subscriptions ps
  where exists (
    -- Pemanggil harus admin di suatu BU yang beririsan dengan scope user itu,
    -- atau super admin. Staff biasa mendapat hasil kosong.
    select 1
    from membership_scopes me
    where me.user_id = auth.uid()
      and (
        me.role = 'super_admin'
        or (
          me.role in ('bu_admin', 'outlet_admin')
          and exists (
            select 1 from membership_scopes target
            where target.user_id = ps.user_id
              and target.business_unit_id = me.business_unit_id
          )
        )
      )
  )
  group by ps.user_id;
$$;

revoke all on function list_push_enabled_user_ids() from public;
grant execute on function list_push_enabled_user_ids() to authenticated;

comment on function list_push_enabled_user_ids() is
  'Daftar user_id yang punya minimal satu langganan Web Push, untuk penanda di rekap presensi. Sengaja TIDAK mengembalikan endpoint/kunci.';
