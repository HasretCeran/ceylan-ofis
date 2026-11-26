-- ═══════════════════════════════════════════════════════════════
-- Ceylan Ofis — Supabase veritabanı kurulumu
-- Supabase panelinde: SQL Editor → New query → bu dosyanın tamamını
-- yapıştır → Run. Bir kez çalıştırman yeterli.
-- ═══════════════════════════════════════════════════════════════

-- 1) Kullanıcı profilleri (ad + rol)
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  ad text,
  rol text not null default 'calisan' check (rol in ('sahip','calisan')),
  created_at timestamptz not null default now()
);

create or replace function public.is_sahip() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and rol = 'sahip');
$$;

-- Yeni kullanıcı eklenince otomatik profil açılır (ad = e-postanın @ öncesi)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, ad)
  values (new.id, coalesce(new.raw_user_meta_data->>'ad', initcap(split_part(new.email, '@', 1))))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
drop policy if exists "profil_oku" on public.profiles;
create policy "profil_oku" on public.profiles for select to authenticated using (true);
drop policy if exists "profil_sahip_duzenler" on public.profiles;
create policy "profil_sahip_duzenler" on public.profiles for update to authenticated
  using (public.is_sahip()) with check (public.is_sahip());

-- 2) Ortak veri tabloları (hepsi aynı yapıda: id + veri + kim + ne zaman)
do $$
declare t text;
begin
  foreach t in array array['stok','musteri','hareket','gorevler','teklifler'] loop
    execute format('create table if not exists public.%I (
      id text primary key,
      veri jsonb not null default ''{}''::jsonb,
      "by" uuid default auth.uid() references auth.users on delete set null,
      at timestamptz not null default now()
    )', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "oku" on public.%I', t);
    execute format('create policy "oku" on public.%I for select to authenticated using (true)', t);
    execute format('drop policy if exists "ekle" on public.%I', t);
    execute format('create policy "ekle" on public.%I for insert to authenticated with check (true)', t);
    execute format('drop policy if exists "duzenle" on public.%I', t);
    execute format('create policy "duzenle" on public.%I for update to authenticated using (true) with check (true)', t);
    execute format('drop policy if exists "sil" on public.%I', t);
    -- Silme: görevleri herkes silebilir, diğer kayıtları sadece sahip (Hasret)
    if t = 'gorevler' then
      execute format('create policy "sil" on public.%I for delete to authenticated using (true)', t);
    else
      execute format('create policy "sil" on public.%I for delete to authenticated using (public.is_sahip())', t);
    end if;
  end loop;
end $$;

-- 2b) Tablo izinleri: sadece giriş yapmış kullanıcılar (yeni projelerde varsayılan olarak kapalı)
revoke all on public.stok, public.musteri, public.hareket, public.gorevler, public.teklifler, public.profiles from anon;
grant select, insert, update, delete on public.stok, public.musteri, public.hareket, public.gorevler, public.teklifler to authenticated;
grant select, update on public.profiles to authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_sahip() from public, anon;
grant execute on function public.is_sahip() to authenticated;

-- 3) Canlı güncelleme (biri kayıt girince herkesin ekranına anında düşer)
do $$
declare t text;
begin
  foreach t in array array['stok','musteri','hareket','gorevler','teklifler','profiles'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- 4) Önceki teklifler
insert into public.teklifler (id, veri, "by", at) values
 ('eski-006', '{"no":"006","musteri":"Fineagles","konu":"FA-PUR-REQ-005","kalemSayisi":19,"tutar":"€/$","tarih":"2026-11-16","durum":"onaylandi"}', null, '2026-11-16T12:00:00Z'),
 ('eski-005', '{"no":"005","musteri":"CP Makina","konu":"Siemens Servo/V20 +7%","kalemSayisi":30,"tutar":"€","tarih":"2026-11-09","durum":"bekliyor"}', null, '2026-11-09T12:00:01Z'),
 ('eski-004', '{"no":"004","musteri":"ABB Proje","konu":"ABB (19 referans, fiyatsız)","kalemSayisi":19,"tutar":"","tarih":"2026-11-09","durum":"fiyat"}', null, '2026-11-09T12:00:00Z'),
 ('eski-003', '{"no":"003","musteri":"Fineagles","konu":"FA-PUR-REQ-005 geniş","kalemSayisi":68,"tutar":"₺/€/$","tarih":"","durum":"gonderildi"}', null, '2026-10-01T00:00:01Z'),
 ('eski-002', '{"no":"002","musteri":"—","konu":"Malzemeler 162 kalem","kalemSayisi":162,"tutar":"₺","tarih":"","durum":"tamamlandi"}', null, '2026-10-01T00:00:00Z')
on conflict (id) do nothing;

-- ═══════════════════════════════════════════════════════════════
-- 5) KENDİNİ SAHİP YAP — önce Authentication → Users'tan kendi
--    kullanıcını ekle, sonra aşağıdaki satırdaki e-postayı değiştirip
--    sadece bu satırı seçerek tekrar Run'a bas:
--
-- update public.profiles set rol = 'sahip', ad = 'Hasret'
--   where id = (select id from auth.users where email = 'hasret@ceylan.app');
-- ═══════════════════════════════════════════════════════════════

-- ═══ v1.3: cari bakiyeleri ve finans yetkisi ═══
alter table public.profiles add column if not exists finans boolean not null default false;
create or replace function public.is_finans() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and (rol = 'sahip' or finans)); $$;
revoke execute on function public.is_finans() from public, anon;
grant execute on function public.is_finans() to authenticated;
create table if not exists public.bakiye (id text primary key, veri jsonb not null default '{}'::jsonb,
  "by" uuid default auth.uid() references auth.users on delete set null, at timestamptz not null default now());
alter table public.bakiye enable row level security;
create policy "oku" on public.bakiye for select to authenticated using (public.is_finans());
create policy "ekle" on public.bakiye for insert to authenticated with check (public.is_finans());
create policy "duzenle" on public.bakiye for update to authenticated using (public.is_finans()) with check (public.is_finans());
create policy "sil" on public.bakiye for delete to authenticated using (public.is_sahip());
revoke all on public.bakiye from anon;
grant select, insert, update, delete on public.bakiye to authenticated;
drop policy if exists "oku" on public.hareket;
create policy "oku" on public.hareket for select to authenticated using (public.is_finans());
drop policy if exists "ekle" on public.hareket;
create policy "ekle" on public.hareket for insert to authenticated with check (public.is_finans());
drop policy if exists "duzenle" on public.hareket;
create policy "duzenle" on public.hareket for update to authenticated using (public.is_finans()) with check (public.is_finans());
alter publication supabase_realtime add table public.bakiye;

-- ═══ v1.21: Satınalma modülü (tedarikçiler, fiyat talepleri, gelen teklifler, satın alma siparişleri) — sadece yönetici ═══
do $$
declare t text;
begin
  foreach t in array array['tedarikciler','sa_talepler','sa_teklifler','sa_siparisler'] loop
    execute format('create table if not exists public.%I (id text primary key, veri jsonb not null default ''{}''::jsonb, "by" uuid default auth.uid() references auth.users on delete set null, at timestamptz not null default now())', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "oku" on public.%I', t);
    execute format('create policy "oku" on public.%I for select to authenticated using (public.is_sahip())', t);
    execute format('drop policy if exists "ekle" on public.%I', t);
    execute format('create policy "ekle" on public.%I for insert to authenticated with check (public.is_sahip())', t);
    execute format('drop policy if exists "duzenle" on public.%I', t);
    execute format('create policy "duzenle" on public.%I for update to authenticated using (public.is_sahip()) with check (public.is_sahip())', t);
    execute format('drop policy if exists "sil" on public.%I', t);
    execute format('create policy "sil" on public.%I for delete to authenticated using (public.is_sahip())', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    begin execute format('alter publication supabase_realtime add table public.%I', t); exception when duplicate_object then null; end;
  end loop;
end $$;
