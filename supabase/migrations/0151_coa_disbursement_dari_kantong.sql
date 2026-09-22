-- ============================================================
-- 0151 — COA Disbursement datang dari KANTONG KAS, bukan kategori biaya.
--
-- ============ KESALAHAN YANG DIPERBAIKI ============
--
-- 0149 memetakan kolom `Account` berkas Disbursement dari **kategori biaya**
-- entri kasnya (Bahan, Beban Biaya, Transportasi). Itu salah baca terhadap
-- templatenya sendiri: keempat baris contoh di
-- `ESB_FNB_DISBURSEMENT_TEMPLATE_INDEX.xlsx` berisi
--
--     Account = '1 1 02 01'   Account Detail = '1 1 02 01'
--     Account = '1 1 02 02'   Account Detail = '1 1 02 01'
--
-- `1 1 …` adalah akun HARTA — kas/bank. Bukan akun biaya. Yang diminta ESB di
-- kolom itu adalah **dari mana uangnya keluar**, bukan untuk apa dibelanjakan.
--
-- Pemetaan COANo yang sudah ada sejak lama mengatakan hal yang sama, dan
-- kelihatan di layar: `kas → 1 1 01 01`, `pusat → 1 1 02 00`,
-- `tempo → 1 1 02 00`. Ketiganya CARA BAYAR — sumber dana. Kategori biaya
-- ditempelkan ke daftar yang sama di 0149 dan tidak pernah cocok dengan
-- isinya.
--
-- Salahnya tidak bisa terlihat dari Berjaya Hub: berkasnya terunduh dengan
-- rapi, ESB menerimanya, dan pengeluarannya mendarat di akun yang salah. Yang
-- menemukannya adalah orang yang membaca laporan ESB berminggu-minggu
-- kemudian.
--
-- ============ SUMBER YANG BENAR: OUTLET MILIK KANTONGNYA ============
--
-- Uang kas Berjaya Hub tinggal di KANTONG (`cash_accounts`, 0063), dan sejak
-- 0120 sebuah kantong bisa ditempeli OUTLET — "kantong kas outlet". Outlet
-- itulah yang punya akun kas di ESB.
--
-- Perhatikan bahwa ini BUKAN `cash_entries.outlet_id`. Yang itu adalah outlet
-- PERUNTUKAN ("uang ini dibelanjakan untuk outlet mana") dan sudah jadi kolom
-- `Branch`. Keduanya sering sama dan kadang tidak: staff AB Gading Serpong
-- boleh membelanjakan uang untuk outlet lain, dan uangnya tetap keluar dari
-- kantong AB Gading Serpong. Memakai satu untuk keduanya akan benar di
-- sebagian besar baris — dan diam-diam salah persis di baris yang paling perlu
-- diperiksa.
--
-- ============ YANG TIDAK PUNYA KANTONG TERTAHAN, BUKAN DITEBAK ============
--
-- Pemegang yang jatah kantongnya 1 tidak punya baris `cash_accounts` sama
-- sekali — uangnya hidup sebagai `account_id IS NULL`, yang di layar bernama
-- "Kas Utama" (lihat catatan panjang di 0121). Entri seperti itu tidak punya
-- outlet kantong untuk dibaca.
--
-- Jalan yang mudah adalah jatuh kembali ke outlet peruntukannya. Jalan itu
-- TIDAK diambil: ia menghasilkan nomor akun yang terlihat benar untuk entri
-- yang sebenarnya tidak diketahui sumber dananya, dan tidak ada satu pun layar
-- yang bisa menunjukkan mana yang ditebak. Entri tanpa kantong berooutlet
-- TERTAHAN, dan alasannya menyebut layar tempat memperbaikinya
-- (Admin Portal → Kas → Kantong Kas).
-- ============================================================

-- ---------------------------------------------------------
-- (1) Kas keluar untuk diekspor — kini membawa kantongnya.
--
-- `drop` dulu: menambah kolom pada `returns table` mengubah tipe kembaliannya,
-- dan `create or replace` menolaknya dengan "cannot change return type of
-- existing function". Tanda tangan argumennya TIDAK berubah, jadi tidak ada
-- risiko overload kembar seperti pada `ubah_kas`.
-- ---------------------------------------------------------
drop function if exists kas_untuk_esb(uuid, date, date, uuid, boolean);

create function kas_untuk_esb(
  p_bu uuid,
  p_from date,
  p_to date,
  p_outlet uuid default null,
  p_termasuk_sudah_ekspor boolean default false
)
returns table (
  id uuid,
  entry_date date,
  amount numeric,
  notes text,
  supplier text,
  outlet_id uuid,
  outlet_nama text,
  kategori_nama text,
  kantong_nama text,
  kantong_outlet_nama text,
  esb_exported_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    ce.id,
    ce.entry_date,
    ce.amount,
    ce.notes,
    ce.supplier,
    ce.outlet_id,
    o.name,
    cc.name,
    -- Kantong yang TIDAK ADA barisnya bukan kantong bernama kosong: ia "Kas
    -- Utama", nama yang dipakai seluruh layar kas sejak 0063. Menuliskannya di
    -- sini membuat alasan tertahannya terbaca sama dengan yang dilihat orang
    -- di Staff App.
    coalesce(ca.name, 'Kas Utama'),
    ko.name,
    ce.esb_exported_at
  from cash_entries ce
  join outlets o on o.id = ce.outlet_id
  left join cash_categories cc on cc.id = ce.category_id
  -- KEDUANYA `left join`, dan itu disengaja.
  --
  -- `join` biasa akan MENGHILANGKAN entri yang kantongnya tidak punya outlet —
  -- dan hilang dari daftar berarti hilang dari daftar tertahan juga. Yang
  -- membacanya akan melihat "12 siap, 0 tertahan" untuk 20 entri, dan delapan
  -- sisanya tidak punya satu pun tempat untuk muncul. Itu bentuk kegagalan
  -- yang paling mahal di repo ini: angka yang benar sendiri-sendiri, dan tidak
  -- ada yang menjumlahkannya.
  left join cash_accounts ca on ca.id = ce.account_id
  left join outlets ko on ko.id = ca.outlet_id
  where ce.entry_type = 'out'
    -- HANYA PENGELUARAN SELAIN BAHAN. Keduanya dijaga constraint trigger
    -- (0122/0131), jadi flag-nya tidak bisa dikarang dari klien.
    and ce.untuk_nota = false
    and ce.penyesuaian_nota is null
    and ce.dicoret_at is null
    and o.business_unit_id = p_bu
    and (p_outlet is null or ce.outlet_id = p_outlet)
    and ce.entry_date between p_from and p_to
    and (p_termasuk_sudah_ekspor or ce.esb_exported_at is null)
    -- Wewenangnya lewat outlet, sama dengan `tandai_kas_esb`.
    and is_admin_of_outlet(auth.uid(), ce.outlet_id)
  order by ce.entry_date, ce.id;
$$;

revoke all on function kas_untuk_esb(uuid, date, date, uuid, boolean) from public;
grant execute on function kas_untuk_esb(uuid, date, date, uuid, boolean) to authenticated;

comment on function kas_untuk_esb(uuid, date, date, uuid, boolean) is
  'Kas keluar SELAIN pembelian bahan, untuk berkas ESB Disbursement. Membawa outlet MILIK KANTONGNYA (cash_accounts.outlet_id) — itulah sumber kolom Account, bukan kategori biayanya.';

-- ---------------------------------------------------------
-- (2) Nama outlet kantong yang PERLU dipetakan ke COA.
--
-- ============ KENAPA BUKAN SEKADAR DAFTAR OUTLET BU INI ============
--
-- Kas melekat pada ORANG, bukan BU (0040), dan kantongnya boleh menunjuk outlet
-- di BU mana pun. Jadi sebuah pengeluaran yang peruntukannya di BU ini bisa
-- keluar dari kantong milik outlet BU lain.
--
-- Kalau layar pemetaan hanya menawarkan outlet BU ini, nama seperti itu akan
-- muncul sebagai alasan tertahan — "COANo: Grand Galaxy belum dipetakan" —
-- tanpa satu pun baris untuk memetakannya. Kemampuannya ada, jalannya tidak
-- ada di layar; pola yang sudah berulang kali muncul di proyek ini dan selalu
-- berakhir di SQL Editor.
--
-- Fungsi ini menjawab pertanyaan yang sesungguhnya: "nama outlet kantong apa
-- saja yang PERNAH muncul di kas keluar BU ini". Layarnya menggabungkannya
-- dengan daftar outlet BU supaya outlet yang belum pernah dipakai pun sudah
-- siap dipetakan sebelum pengeluaran pertamanya.
-- ---------------------------------------------------------
create or replace function outlet_kantong_kas_esb(p_bu uuid)
returns table (nama text)
language sql
security definer
stable
set search_path = public
as $$
  select distinct ko.name
  from cash_entries ce
  join outlets o on o.id = ce.outlet_id
  join cash_accounts ca on ca.id = ce.account_id
  join outlets ko on ko.id = ca.outlet_id
  where ce.entry_type = 'out'
    and ce.untuk_nota = false
    and ce.penyesuaian_nota is null
    and ce.dicoret_at is null
    and o.business_unit_id = p_bu
    and is_admin_of_outlet(auth.uid(), ce.outlet_id)
  order by 1;
$$;

revoke all on function outlet_kantong_kas_esb(uuid) from public;
grant execute on function outlet_kantong_kas_esb(uuid) to authenticated;

comment on function outlet_kantong_kas_esb(uuid) is
  'Nama outlet MILIK KANTONG yang pernah dipakai kas keluar BU ini — supaya tiap nama yang bisa menahan sebuah entri punya baris untuk dipetakan ke COA.';

notify pgrst, 'reload schema';
