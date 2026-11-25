'use strict';
/* Ceylan Ofis — uygulama mantığı */
const APP_VERSION = '1.1.1';
const CFG = window.CEYLAN_CONFIG || {};
const DEMO = !(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) || typeof supabase === 'undefined';

// ═══ YARDIMCILAR ═══
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => Number(n || 0).toLocaleString('tr-TR', {minimumFractionDigits:2, maximumFractionDigits:2});
const tl = n => '₺' + Number(n || 0).toLocaleString('tr-TR', {maximumFractionDigits:0});
const kisa = n => { n = Number(n||0); return n >= 1e6 ? '₺' + (n/1e6).toLocaleString('tr-TR',{maximumFractionDigits:1}) + 'M' : n >= 1e4 ? '₺' + Math.round(n/1000).toLocaleString('tr-TR') + 'K' : tl(n); };
const dstr = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
const bugun = () => dstr(new Date());
const trT = s => { if (!s) return '—'; const d = new Date(s + 'T12:00:00'); return isNaN(d) ? '—' : d.toLocaleDateString('tr-TR'); };
const trKisa = s => { if (!s) return ''; const d = new Date(s + 'T12:00:00'); return isNaN(d) ? '' : d.toLocaleDateString('tr-TR', {day:'numeric', month:'short'}); };
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const ikon = id => `<svg class="i"><use href="#i-${id}"/></svg>`;
const bas = ad => (ad || '?').trim().charAt(0).toLocaleUpperCase('tr-TR') || '?';
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms); }

// ═══ DURUM ═══
const COLS = ['stok', 'musteri', 'hareket', 'gorevler', 'teklifler'];
const S = {stok: [], musteri: [], hareket: [], gorevler: [], teklifler: []};
let P = {};            // profiller: id → {ad, rol}
let ME = null;         // giriş yapan kullanıcı id
let IS_OWNER = false;
let sb = null;
// Ayarlar (yönetici düzenler): teklif varsayılanları, mail şablonu, DİA bilgileri
const A = {
  teklif: {odeme: '', teslimYeri: '', teslimSure: '', gecerli: '15 gün', sartlar: ['Fiyatlarımızda KDV hariçtir. Ayrıca ilave edilecektir.', 'Sipariş kabulü imzalı ve kaşeli olarak işleme alınır.', 'Aksi belirtilmediği sürece nakliye ücreti müşteriye aittir.', 'Döviz cinsinden verilen fiyatlar fatura tarihindeki TCMB satış kuru üzerinden TL olarak fiyatlandırılacaktır.']},
  mail: {konu: '{no} numaralı teklifimiz — Ceylan Otomasyon', govde: 'Sayın {ilgili},\n\n{konu} konulu teklifimiz ekte bilgilerinize sunulmuştur.\n\nSaygılarımızla,\n{hazirlayan}\nCeylan Endüstriyel Otomasyon\nTel: 0262 646 20 52'},
  dia: {sunucu: '', firmaKodu: '', donemKodu: '', kullanici: '', aktar: {cari: true, stok: true, hareket: false}},
};

// ═══ VERİ KATMANI ═══
const rowToObj = r => ({...(r.veri || {}), id: r.id, by: r.by || null, at: r.at || null});
const bodyOf = o => { const b = {}; Object.keys(o).forEach(k => { if (!['id','by','at'].includes(k) && o[k] !== undefined) b[k] = o[k]; }); return b; };

const BE = DEMO ? {
  async yukle() { COLS.forEach(c => { const a = lsGet('co_' + c, []); S[c] = Array.isArray(a) ? a : []; }); P = {demo: {ad: 'Hasret Can Ceran', rol: 'sahip'}}; const a = lsGet('co_ayarlar', {}); Object.keys(A).forEach(k => { if (a[k]) A[k] = {...A[k], ...a[k]}; }); },
  async ayarYaz(id, veri) { A[id] = veri; lsSet('co_ayarlar', A); ayarlarCiz(); return true; },
  async yaz(col, obj) {
    const i = S[col].findIndex(x => x.id === obj.id);
    const tam = {...obj, by: obj.by || ME, at: obj.at || new Date().toISOString()};
    if (i >= 0) S[col][i] = tam; else S[col].push(tam);
    lsSet('co_' + col, S[col]); degisti(col); return true;
  },
  async sil(col, id) { S[col] = S[col].filter(x => x.id !== id); lsSet('co_' + col, S[col]); degisti(col); return true; },
  dinle() { setSync('warn', 'Demo'); },
} : {
  async yukle() {
    const sonuc = await Promise.all(COLS.map(c => sb.from(c).select('*').limit(5000)));
    sonuc.forEach((r, i) => { if (r.error) throw r.error; S[COLS[i]] = r.data.map(rowToObj); });
    await profilYukle();
    await ayarYukle();
  },
  async ayarYaz(id, veri) {
    const {error} = await sb.from('ayarlar').upsert({id, veri, updated_at: new Date().toISOString()});
    if (error) { hata(error); return false; }
    A[id] = veri; ayarlarCiz(); return true;
  },
  async yaz(col, obj) {
    const satir = {id: obj.id, veri: bodyOf(obj)};
    const {data, error} = await sb.from(col).upsert(satir).select().single();
    if (error) { hata(error); return false; }
    const o = rowToObj(data); const i = S[col].findIndex(x => x.id === o.id);
    if (i >= 0) S[col][i] = o; else S[col].push(o);
    degisti(col); return true;
  },
  async sil(col, id) {
    const {data, error} = await sb.from(col).delete().eq('id', id).select();
    if (error) { hata(error); return false; }
    if (!data || !data.length) { toast('⛔ Silme yetkisi sadece yöneticide'); return false; }
    S[col] = S[col].filter(x => x.id !== id); degisti(col); return true;
  },
  dinle() {
    const ch = sb.channel('ceylan-ofis');
    COLS.forEach(col => ch.on('postgres_changes', {event: '*', schema: 'public', table: col}, p => {
      if (p.eventType === 'DELETE') { S[col] = S[col].filter(x => x.id !== (p.old && p.old.id)); }
      else { const o = rowToObj(p.new); const i = S[col].findIndex(x => x.id === o.id); if (i >= 0) S[col][i] = o; else S[col].push(o); }
      degisti(col);
    }));
    ch.on('postgres_changes', {event: '*', schema: 'public', table: 'profiles'}, () => profilYukle().then(() => { rolUygula(); hepsiniCiz(); }));
    ch.on('postgres_changes', {event: '*', schema: 'public', table: 'ayarlar'}, () => ayarYukle().then(ayarlarCiz));
    ch.subscribe(st => {
      if (st === 'SUBSCRIBED') setSync('ok', 'Canlı');
      else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') setSync('err', 'Bağlantı yok');
      else if (st === 'CLOSED') setSync('warn', 'Kapalı');
    });
  },
};

async function ayarYukle() {
  const {data, error} = await sb.from('ayarlar').select('id,veri');
  if (!error && data) data.forEach(r => { if (A[r.id]) A[r.id] = {...A[r.id], ...(r.veri || {})}; });
}
async function profilYukle() {
  const {data, error} = await sb.from('profiles').select('id,ad,rol');
  if (!error && data) { P = {}; data.forEach(p => { P[p.id] = {ad: p.ad, rol: p.rol}; }); }
}
function hata(e) {
  const m = (e && (e.message || e.code)) || '';
  if (/row-level security|permission|42501/i.test(m)) toast('⛔ Bu işlem için yetkin yok', 3500);
  else if (/fetch|network|Failed/i.test(m)) toast('⚠️ İnternet bağlantısı yok, tekrar dene', 3500);
  else toast('⚠️ Kaydedilemedi: ' + m.slice(0, 60), 3500);
}
async function kaydet(col, obj) { return BE.yaz(col, obj.id ? obj : {...obj, id: newId()}); }
const adi = id => !id ? '—' : id === ME ? 'Sen' : (P[id] && P[id].ad) || 'Ekip üyesi';

function setSync(cls, txt) { const s = $('#sync'); s.className = 'sync ' + cls; s.querySelector('span').textContent = txt; }

// ═══ DEĞİŞİKLİK → ÇİZİM ═══
let cizZaman = null;
const kirli = new Set();
function degisti(col) { kirli.add(col); clearTimeout(cizZaman); cizZaman = setTimeout(() => { const k = [...kirli]; kirli.clear(); ciz(k); }, 30); }
function ciz(cols) {
  if (cols.includes('teklifler')) { tekliflerCiz(); }
  if (cols.includes('musteri') || cols.includes('hareket')) { musteriCiz(); firmaListesi(); }
  if (cols.includes('stok')) stokCiz();
  if (cols.includes('gorevler')) takvimCiz();
  dashboardCiz();
  if (aktifSayfa === 'finans') finansCiz();
}
function hepsiniCiz() { ciz(COLS); }

// ═══ NAVİGASYON ═══
const BASLIK = {dashboard: 'Genel Bakış', teklif: 'Teklif Oluştur', teklifler: 'Teklif Geçmişi', musteri: 'Müşteri & Borç', stok: 'Stok / Ürünler', takvim: 'Takvim', finans: 'Finans Raporu', entegrasyon: 'Entegrasyonlar', ayarlar: 'Ayarlar'};
let aktifSayfa = 'dashboard';
function git(p) {
  if (!BASLIK[p]) p = 'dashboard';
  if ((p === 'finans' || p === 'entegrasyon') && !IS_OWNER) p = 'dashboard';
  aktifSayfa = p;
  $$('.page').forEach(x => x.classList.toggle('active', x.id === 'p-' + p));
  $$('[data-go]').forEach(x => x.classList.toggle('active', x.dataset.go === p));
  $('#page-title').textContent = BASLIK[p];
  if (p === 'finans') finansCiz();
  if (p === 'takvim') takvimCiz();
  if (p === 'teklif') firmaListesi();
  lsSet('co_page', p);
  window.scrollTo({top: 0});
}
document.addEventListener('click', e => {
  const g = e.target.closest('[data-go]'); if (g) { git(g.dataset.go); return; }
  const a = e.target.closest('[data-act]'); if (a) { aksiyon(a.dataset.act); return; }
  const st = e.target.closest('[data-step]'); if (st) { adim(+st.dataset.step); return; }
  const th = e.target.closest('[data-theme-set]'); if (th) tema(th.dataset.themeSet);
});
function aksiyon(a) {
  if (a === 'menu') menuAc();
  if (a === 'firma-ekle') firmaForm();
  if (a === 'hareket-ekle') hareketForm();
  if (a === 'urun-ekle') urunForm();
  if (a === 'gorev-ekle') gorevForm();
}

// ═══ TEMA ═══
function tema(t) { if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); lsSet('co_theme', t); }
$('#theme-btn').onclick = () => { const c = document.documentElement.getAttribute('data-theme'); const koyu = c ? c === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; tema(koyu ? 'light' : 'dark'); };
{ const t = lsGet('co_theme', null); if (t) tema(t); }

// ═══ ALT PENCERE (SHEET) ═══
function sheet(baslik, govde, butonlar = []) {
  const root = $('#sheet-root');
  const ov = document.createElement('div'); ov.className = 'overlay';
  ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div><div class="sheet-h"><h3></h3><button class="icon-btn" data-x aria-label="Kapat">${ikon('x')}</button></div><div class="sheet-b">${govde}</div>${butonlar.length ? '<div class="sheet-f"></div>' : ''}</div>`;
  ov.querySelector('h3').textContent = baslik;
  const kapat = () => { ov.remove(); document.removeEventListener('keydown', esk); };
  const esk = e => { if (e.key === 'Escape') kapat(); };
  document.addEventListener('keydown', esk);
  ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-x]')) kapat(); });
  const f = ov.querySelector('.sheet-f');
  butonlar.forEach(b => {
    const el = document.createElement('button'); el.className = 'btn ' + (b.cls || 'btn-s'); el.textContent = b.label;
    el.onclick = async () => { el.disabled = true; const r = await b.onClick(ov); el.disabled = false; if (r !== false) kapat(); };
    f.appendChild(el);
  });
  root.appendChild(ov);
  const ilk = ov.querySelector('input:not([type=hidden]),select'); if (ilk && matchMedia('(min-width:761px)').matches) ilk.focus();
  return {el: ov, kapat};
}
const v = (ov, id) => ov.querySelector('#' + id).value.trim();

function menuAc() {
  const r = (go, ic, t, s) => `<button class="row" data-go="${go}" data-x><div class="ico" style="background:var(--brand-soft);color:var(--brand)">${ikon(ic)}</div><div class="mid"><div class="t">${t}</div><div class="s">${s}</div></div>${ikon('right')}</button>`;
  sheet('Menü', `<div class="rows menu-list">
    ${r('teklifler', 'doc', 'Teklif Geçmişi', 'Ekibin tüm teklifleri')}
    ${r('stok', 'box', 'Stok / Ürünler', 'Ürün, fiyat ve stok')}
    ${IS_OWNER ? r('finans', 'chart', 'Finans Raporu 🔒', 'Sadece sen görürsün') : ''}
    ${IS_OWNER ? r('entegrasyon', 'plug', 'Entegrasyonlar 🔒', 'Mail ve DİA ERP') : ''}
    ${r('ayarlar', 'gear', 'Ayarlar', 'Hesap, şifre, görünüm')}
  </div>`);
}

// ═══════════════════════════════════════════
// GENEL BAKIŞ
// ═══════════════════════════════════════════
const DURUM = {bekliyor: ['Bekliyor', 'p-amber'], gonderildi: ['Gönderildi', 'p-blue'], fiyat: ['Fiyat bekleniyor', 'p-orange'], onaylandi: ['Onaylandı', 'p-green'], reddedildi: ['Reddedildi', 'p-red'], tamamlandi: ['Tamamlandı', 'p-green']};
const ACIK = ['bekliyor', 'gonderildi', 'fiyat'];
const tekSirali = () => [...S.teklifler].sort((a, b) => (b.tarih || '').localeCompare(a.tarih || '') || (b.at || '').localeCompare(a.at || ''));
const vadeGecti = m => m.vade && m.durum !== 'tahsil' && Number(m.alacak) > 0 && m.vade < bugun();
function alacakOzet() {
  const acik = S.musteri.filter(m => m.durum !== 'tahsil');
  const ay = bugun().slice(0, 7);
  return {
    toplam: acik.reduce((s, m) => s + Number(m.alacak || 0), 0),
    gecmis: S.musteri.filter(vadeGecti).reduce((s, m) => s + Number(m.alacak || 0), 0),
    buAy: S.hareket.filter(h => h.tur === 'tahsilat' && (h.tarih || '').slice(0, 7) === ay).reduce((s, h) => s + Number(h.tutar || 0), 0),
  };
}
function stokDurum(u) { if (u.stok === '' || u.stok == null) return 'bilinmiyor'; const a = Number(u.stok), m = Number(u.min) || 1; return a <= 0 ? 'yok' : a <= m ? 'kritik' : 'yeterli'; }

function teklifSatir(t, kisaMi) {
  const [l, c] = DURUM[t.durum] || DURUM.bekliyor;
  return `<button class="row" data-teklif="${esc(t.id)}">
    <div class="ico" style="background:var(--brand-soft);color:var(--brand)">${esc(bas(t.musteri))}</div>
    <div class="mid"><div class="t">${esc(t.musteri) || '—'}</div><div class="s">${esc(t.konu) || '—'}${kisaMi ? '' : ' · ' + esc(adi(t.by))}</div></div>
    <div class="end"><span class="pill ${c}">${l}</span><div class="s num" style="font-size:11.5px;color:var(--fg3);margin-top:4px">${esc(t.no || '')} ${trKisa(t.tarih)}</div></div></button>`;
}

function dashboardCiz() {
  const s = new Date(), saat = s.getHours();
  const selam = saat < 11 ? 'Günaydın' : saat < 18 ? 'İyi günler' : 'İyi akşamlar';
  const ad = (P[ME] && P[ME].ad) || '';
  $('#hero-hi').textContent = selam + (ad ? ', ' + ad.split(' ')[0] : '') + ' 👋';
  $('#hero-date').textContent = s.toLocaleDateString('tr-TR', {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'});
  const acik = S.teklifler.filter(t => ACIK.includes(t.durum || 'bekliyor')).length;
  $$('[data-acik-val]').forEach(e => e.textContent = acik);
  $$('[data-acik]').forEach(e => { e.textContent = acik; e.hidden = !acik; });
  const bg = S.gorevler.filter(g => g.tarih === bugun() && !g.tamam);
  $('#hero-gorev').textContent = bg.length;
  const o = alacakOzet();
  $('#d-alacak').textContent = o.toplam ? kisa(o.toplam) : '—';
  $('#d-gecmis').textContent = o.gecmis ? kisa(o.gecmis) : '—';
  $('#d-tahsil').textContent = o.buAy ? kisa(o.buAy) : '—';
  $('#d-kritik').textContent = S.stok.filter(u => ['kritik', 'yok'].includes(stokDurum(u))).length;
  // bugün
  const gl = S.gorevler.filter(g => g.tarih === bugun()).sort((a, b) => (a.saat || '').localeCompare(b.saat || ''));
  $('#d-gorevler').innerHTML = gl.length ? '' : '<div class="empty">Bugün için görev yok ✓</div>';
  gl.forEach(g => $('#d-gorevler').appendChild(gorevEl(g, false)));
  // teklifler
  const tl4 = tekSirali().slice(0, 4);
  $('#d-teklifler').innerHTML = tl4.length ? tl4.map(t => teklifSatir(t, true)).join('') : '<div class="empty">Henüz teklif yok</div>';
  // vadeler
  const vl = S.musteri.filter(m => m.vade && m.durum !== 'tahsil' && Number(m.alacak) > 0).sort((a, b) => a.vade.localeCompare(b.vade)).slice(0, 5);
  $('#d-vadeler').innerHTML = vl.length ? vl.map(firmaSatir).join('') : '<div class="empty">Vadeli alacak yok</div>';
}
document.addEventListener('click', e => { const t = e.target.closest('[data-teklif]'); if (t) teklifDetay(t.dataset.teklif); const f = e.target.closest('[data-firma]'); if (f) firmaForm(f.dataset.firma); const u = e.target.closest('[data-urun]'); if (u) urunForm(u.dataset.urun); });

// ═══════════════════════════════════════════
// TEKLİF SİHİRBAZI
// ═══════════════════════════════════════════
const TF = ['musteri', 'ilgili', 'telefon', 'eposta', 'no', 'konu', 'gecerli', 'not', 'odeme', 'teslimYeri', 'teslimSure', 'kurUsd', 'kurEur'];
let kalemler = lsGet('co_tf', []); if (!Array.isArray(kalemler)) kalemler = [];
let tfId = lsGet('co_tf_id', null);
{ const m = lsGet('co_tf_meta', {}); TF.forEach(a => { if (m[a]) $('#tf-' + a).value = m[a]; }); }
TF.forEach(a => $('#tf-' + a).addEventListener('input', () => lsSet('co_tf_meta', Object.fromEntries(TF.map(x => [x, $('#tf-' + x).value])))));

function adim(n) {
  if (n >= 2 && !$('#tf-musteri').value.trim()) { toast('Önce müşteri adını yaz'); $('#tf-musteri').focus(); n = 1; }
  if (n === 3) { onizle(); pdfOnHazirla(); }
  $$('.wp').forEach((w, i) => w.classList.toggle('active', i === n - 1));
  $$('.step').forEach((s, i) => { s.classList.toggle('on', i === n - 1); s.classList.toggle('done', i < n - 1); });
  window.scrollTo({top: 0, behavior: 'smooth'});
}
function kalemNet(k) { const f = Number(k.fiyat) || 0, m = Number(k.miktar) || 1, i = Number(k.iskonto) || 0; return f * m * (1 - i / 100); }
function toplamYazi(list = kalemler) {
  const t = {}; list.forEach(k => { const n = kalemNet(k); if (n > 0) t[k.para || '€'] = (t[k.para || '€'] || 0) + n; });
  return Object.entries(t).map(([p, v]) => p + ' ' + fmt(v)).join(' + ') || '—';
}
function kalemlerCiz() {
  const box = $('#kalemler'); box.innerHTML = '';
  if (!kalemler.length) box.innerHTML = '<div class="empty card" style="margin-bottom:10px">Henüz kalem yok. "Kalem ekle" ya da "Stoktan ürün seç" ile başla.</div>';
  kalemler.forEach((k, i) => {
    const el = document.createElement('div'); el.className = 'kalem';
    const opt = (arr, val) => arr.map(x => `<option${x === val ? ' selected' : ''}>${x}</option>`).join('');
    el.innerHTML = `<div class="kalem-h"><span class="no">#${i + 1}</span><span class="net">Net <b data-net></b></span><button class="del-x" aria-label="Kalemi sil">${ikon('trash')}</button></div>
      <div class="grid">
        <div class="f c3"><label>Referans / Part no</label><input class="inp" data-k="ref" value="${esc(k.ref)}" autocapitalize="characters" placeholder="6ES7214-…"></div>
        <div class="f c3"><label>Marka</label><input class="inp" data-k="marka" value="${esc(k.marka)}" list="marka-list" placeholder="Siemens"></div>
        <div class="f c6"><label>Açıklama</label><input class="inp" data-k="aciklama" value="${esc(k.aciklama)}" placeholder="Ürün açıklaması"></div>
        <div class="f c2"><label>Miktar</label><input class="inp num" data-k="miktar" type="number" inputmode="decimal" min="0" value="${esc(k.miktar || 1)}"></div>
        <div class="f c2"><label>Birim</label><select class="sel" data-k="birim">${opt(['Adet', 'Takım', 'Set', 'Metre', 'Kutu', 'kg'], k.birim || 'Adet')}</select></div>
        <div class="f c2"><label>İsk. %</label><input class="inp num" data-k="iskonto" type="number" inputmode="decimal" min="0" max="100" value="${esc(k.iskonto || 0)}"></div>
        <div class="f c4"><label>Birim fiyat</label><input class="inp num" data-k="fiyat" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(k.fiyat)}" placeholder="0,00"></div>
        <div class="f c2"><label>Para</label><select class="sel" data-k="para">${opt(['€', '₺', '$'], k.para || '€')}</select></div>
      </div>`;
    const netYaz = () => { const n = kalemNet(k); el.querySelector('[data-net]').textContent = n > 0 ? (k.para || '€') + ' ' + fmt(n) : '—'; };
    netYaz();
    el.querySelectorAll('[data-k]').forEach(inp => inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', () => { k[inp.dataset.k] = inp.value; netYaz(); tfSakla(); }));
    el.querySelector('.del-x').onclick = () => { kalemler.splice(i, 1); tfSakla(); kalemlerCiz(); };
    box.appendChild(el);
  });
  const ml = $('#marka-list') || Object.assign(document.createElement('datalist'), {id: 'marka-list'}); if (!ml.parentNode) document.body.appendChild(ml);
  ml.innerHTML = [...new Set(S.stok.map(u => u.marka).filter(Boolean))].map(m => `<option value="${esc(m)}">`).join('');
  tfSakla();
}
function tfSakla() { lsSet('co_tf', kalemler); $('#tf-tot2').textContent = toplamYazi(); $('#tf-tot3').textContent = toplamYazi(); }
$('#k-ekle').onclick = () => { kalemler.push({ref: '', aciklama: '', marka: '', miktar: 1, birim: 'Adet', fiyat: '', para: '€', iskonto: 0}); kalemlerCiz(); const s = $$('.kalem'); const son = s[s.length - 1]; if (son) { son.scrollIntoView({behavior: 'smooth', block: 'center'}); son.querySelector('input').focus({preventScroll: true}); } };
$('#k-stok').onclick = () => {
  if (!S.stok.length) { toast('Stok listesi boş'); return; }
  const sh = sheet('Stoktan ürün seç', `<div class="search" style="margin-bottom:10px"><svg class="i"><use href="#i-search"/></svg><input class="inp" id="pk-ara" placeholder="Ara"></div><div class="rows picker" id="pk-list"></div>`);
  const ciz = () => {
    const q = sh.el.querySelector('#pk-ara').value.toLowerCase();
    const l = S.stok.filter(u => !q || [u.ref, u.aciklama, u.marka].join(' ').toLowerCase().includes(q)).slice(0, 80);
    const box = sh.el.querySelector('#pk-list'); box.innerHTML = l.length ? '' : '<div class="empty">Sonuç yok</div>';
    l.forEach(u => { const b = document.createElement('button'); b.className = 'row';
      b.innerHTML = `<div class="mid"><div class="t">${esc(u.ref)}</div><div class="s">${esc(u.marka)} · ${esc(u.aciklama)}</div></div><div class="end"><b>${u.fiyat ? esc(u.para || '€') + ' ' + fmt(u.fiyat) : '—'}</b></div>`;
      b.onclick = () => { kalemler.push({ref: u.ref || '', aciklama: u.aciklama || '', marka: u.marka || '', miktar: 1, birim: 'Adet', fiyat: u.fiyat || '', para: u.para || '€', iskonto: 0}); kalemlerCiz(); toast('✅ ' + (u.ref || 'Ürün') + ' eklendi'); };
      box.appendChild(b); });
  };
  sh.el.querySelector('#pk-ara').oninput = ciz; ciz();
};
function otoNo() {
  const y = new Date().getFullYear(), re = new RegExp('^TKF-' + y + '-(\\d+)$');
  const max = S.teklifler.reduce((m, t) => { const x = re.exec(t.no || ''); return x ? Math.max(m, +x[1]) : m; }, 0);
  return 'TKF-' + y + '-' + String(max + 1).padStart(3, '0');
}
function tfMeta() {
  if (!$('#tf-no').value.trim()) { $('#tf-no').value = tfId ? ((S.teklifler.find(t => t.id === tfId) || {}).no || otoNo()) : otoNo(); lsSet('co_tf_meta', Object.fromEntries(TF.map(x => [x, $('#tf-' + x).value]))); }
  return Object.fromEntries(TF.map(a => [a, $('#tf-' + a).value.trim()]));
}
function onizle() {
  const m = tfMeta();
  $('#tf-onizleme').innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
      <div><div class="disp" style="font-size:18px;font-weight:700">${esc(m.musteri)}</div><div style="color:var(--fg2);font-size:13px">${esc(m.ilgili)}${m.konu ? ' · ' + esc(m.konu) : ''}</div></div>
      <div style="text-align:right;font-size:12.5px;color:var(--fg2)"><b style="color:var(--fg)">${esc(m.no)}</b><br>${new Date().toLocaleDateString('tr-TR')} · ${esc(m.gecerli)}</div>
    </div>
    <div class="tscroll"><table class="prev-table"><thead><tr><th>#</th><th>Referans</th><th>Açıklama</th><th>Marka</th><th class="r">Miktar</th><th class="r">Fiyat</th><th class="r">İsk.</th><th class="r">Net</th></tr></thead><tbody>
    ${kalemler.map((k, i) => `<tr><td>${i + 1}</td><td><b>${esc(k.ref) || '—'}</b></td><td>${esc(k.aciklama) || '—'}</td><td>${esc(k.marka) || '—'}</td><td class="r">${esc(k.miktar || 1)} ${esc(k.birim)}</td><td class="r">${k.fiyat ? esc(k.para) + ' ' + fmt(k.fiyat) : '—'}</td><td class="r">${Number(k.iskonto) ? esc(k.iskonto) + '%' : '—'}</td><td class="r"><b>${kalemNet(k) ? esc(k.para) + ' ' + fmt(kalemNet(k)) : '—'}</b></td></tr>`).join('') || '<tr><td colspan="8" class="empty">Kalem yok</td></tr>'}
    </tbody></table></div>
    ${m.not ? `<p style="margin-top:12px;font-size:12.5px;color:var(--fg2)">Not: ${esc(m.not)}</p>` : ''}`;
  tfSakla();
  $('#tf-durum').textContent = tfId ? 'Kayıtlı teklifi düzenliyorsun' : 'Yeni teklif';
}
async function tfKaydet(sessiz) {
  if (!kalemler.length) { toast('Önce kalem ekle'); return false; }
  const m = tfMeta();
  const eski = tfId && S.teklifler.find(t => t.id === tfId);
  const obj = {...(eski || {}), ...m, id: tfId || newId(), kalemler: kalemler.map(k => ({...k})), kalemSayisi: kalemler.length, tutar: toplamYazi(), tarih: (eski && eski.tarih) || bugun(), durum: (eski && eski.durum) || 'bekliyor', hazirlayan: (eski && eski.hazirlayan) || benimAdim()};
  const ok = await kaydet('teklifler', obj);
  if (ok) { tfId = obj.id; lsSet('co_tf_id', tfId); $('#tf-durum').textContent = 'Kayıtlı teklifi düzenliyorsun'; if (!sessiz) toast('✅ Teklif geçmişe kaydedildi'); }
  return ok;
}
function tfYeni() {
  kalemler = []; tfId = null; lsSet('co_tf_id', null); lsSet('co_tf_meta', {});
  TF.forEach(a => { const e = $('#tf-' + a); if (e.tagName === 'SELECT') e.selectedIndex = 0; else e.value = ''; });
  tfVarsayilan();
  kalemlerCiz(); adim(1); $('#tf-durum').textContent = 'Yeni teklif';
}
function tfVarsayilan() {
  const d = A.teklif;
  [['odeme', d.odeme], ['teslimYeri', d.teslimYeri], ['teslimSure', d.teslimSure], ['gecerli', d.gecerli]].forEach(([k, val]) => { const e = $('#tf-' + k); if (val && !e.value) e.value = val; });
}
const benimAdim = () => (P[ME] && P[ME].ad) || '';
// Müşteri seçilince firma kartındaki bilgileri doldur
$('#tf-musteri').addEventListener('change', () => {
  const m = S.musteri.find(x => (x.firma || '').toLocaleLowerCase('tr-TR') === $('#tf-musteri').value.trim().toLocaleLowerCase('tr-TR'));
  if (!m) return;
  [['ilgili', m.ilgili], ['telefon', m.tel], ['eposta', m.eposta]].forEach(([k, val]) => { const e = $('#tf-' + k); if (val && !e.value) e.value = val; });
  lsSet('co_tf_meta', Object.fromEntries(TF.map(x => [x, $('#tf-' + x).value])));
});
function tfAc(id) {
  const t = S.teklifler.find(x => x.id === id); if (!t) return;
  TF.forEach(a => { if (t[a] !== undefined) $('#tf-' + a).value = t[a]; });
  lsSet('co_tf_meta', Object.fromEntries(TF.map(x => [x, $('#tf-' + x).value])));
  kalemler = (t.kalemler || []).map(k => ({...k})); tfId = id; lsSet('co_tf_id', id);
  kalemlerCiz(); git('teklif'); adim(kalemler.length ? 3 : 1);
}
$('#tf-yeni').onclick = () => { if (kalemler.length && !tfId) { if (!confirmSheet('Taslak silinsin mi?', 'Kaydedilmemiş kalemler silinecek.', tfYeni)) return; } else tfYeni(); };
function confirmSheet(baslik, metin, evet) { sheet(baslik, `<p style="color:var(--fg2);font-size:14px">${esc(metin)}</p>`, [{label: 'Vazgeç', onClick: () => {}}, {label: 'Evet', cls: 'btn-d', onClick: evet}]); return false; }
$('#tf-kaydet').onclick = () => tfKaydet();
// ═══ ÇIKTILAR: Excel (Ceylan şablonu), PDF, Mail/WhatsApp ═══
const TC = window.TeklifCikti;
const tfVeri = () => ({...tfMeta(), kalemler: kalemler.map(k => ({...k})), hazirlayan: (tfId && (S.teklifler.find(t => t.id === tfId) || {}).hazirlayan) || benimAdim(), tarih: (tfId && (S.teklifler.find(t => t.id === tfId) || {}).tarih) || bugun()});
const tamTeklif = t => ({...t, hazirlayan: t.hazirlayan || (t.by ? adi(t.by) : benimAdim()), tarih: t.tarih || bugun()});
let pdfOnbellek = {anahtar: '', blob: null, is: null};
function pdfOnHazirla() {
  if (!kalemler.length || !TC) return;
  const t = tfVeri(), anahtar = JSON.stringify(t) + JSON.stringify(A.teklif);
  if (pdfOnbellek.anahtar === anahtar && (pdfOnbellek.blob || pdfOnbellek.is)) return;
  pdfOnbellek = {anahtar, blob: null, is: TC.pdfUret(t, A.teklif).then(b => { if (pdfOnbellek.anahtar === anahtar) pdfOnbellek.blob = b; return b; }).catch(() => null)};
}
async function pdfAl(t, tf) {
  if (tf) { pdfOnHazirla(); const b = pdfOnbellek.blob || await pdfOnbellek.is; if (b) return b; }
  return TC.pdfUret(t, A.teklif);
}
async function cikti(tur, t, tf) {
  if (!t.kalemler || !t.kalemler.length) { toast('Önce kalem ekle'); return; }
  const ad = TC.dosyaAdi(t, tur === 'excel' ? 'xlsx' : 'pdf');
  try {
    if (tur === 'excel') { toast('Excel hazırlanıyor…'); TC.indir(await TC.excelUret(t, A.teklif), ad); toast('⬇ ' + ad, 3200); }
    else if (tur === 'pdf') { toast('PDF hazırlanıyor…'); TC.indir(await pdfAl(t, tf), ad); toast('⬇ ' + ad, 3200); }
    else {
      const blob = await pdfAl(t, tf);
      const r = await TC.paylas(blob, ad, t, A.mail);
      if (r === 'mailto') toast('PDF indirildi, mail açılıyor — PDF\'i eke ekle', 4500);
    }
    if (tf) tfKaydet(true);
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    if (e && e.name === 'NotAllowedError') { toast('Paylaşım hazır — bir kez daha bas', 3500); return; }
    toast('⚠️ ' + (e && e.message || 'Dosya oluşturulamadı'), 4000);
  }
}
$('#tf-xlsx').onclick = () => cikti('excel', tfVeri(), true);
$('#tf-pdf').onclick = () => cikti('pdf', tfVeri(), true);
$('#tf-gonder').onclick = () => cikti('gonder', tfVeri(), true);

// ═══════════════════════════════════════════
// TEKLİF GEÇMİŞİ
// ═══════════════════════════════════════════
let tkFiltre = '';
function tekliflerCiz() {
  const q = $('#tk-ara').value.toLowerCase();
  const chips = [['', 'Tümü'], ['acik', 'Açık'], ...Object.entries(DURUM).map(([k, [l]]) => [k, l])];
  $('#tk-chips').innerHTML = chips.map(([k, l]) => `<button class="chip${tkFiltre === k ? ' on' : ''}" data-tkf="${k}">${l}</button>`).join('');
  const l = tekSirali().filter(t => (!tkFiltre || (tkFiltre === 'acik' ? ACIK.includes(t.durum || 'bekliyor') : t.durum === tkFiltre)) && (!q || [t.musteri, t.konu, t.no].join(' ').toLowerCase().includes(q)));
  $('#tk-list').innerHTML = l.length ? l.map(t => teklifSatir(t)).join('') : '<div class="empty">Teklif bulunamadı</div>';
}
$('#tk-ara').oninput = tekliflerCiz;
$('#tk-chips').onclick = e => { const c = e.target.closest('[data-tkf]'); if (c) { tkFiltre = c.dataset.tkf; tekliflerCiz(); } };
function teklifDetay(id) {
  const t = S.teklifler.find(x => x.id === id); if (!t) return;
  const opts = Object.entries(DURUM).map(([k, [l]]) => `<option value="${k}"${t.durum === k ? ' selected' : ''}>${l}</option>`).join('');
  const kal = Array.isArray(t.kalemler) && t.kalemler.length;
  const sh = sheet(t.musteri || 'Teklif', `
    <div class="rows" style="margin:0 -4px 12px">
      <div class="row" style="padding:8px 4px"><div class="mid"><div class="s">Teklif no</div><div class="t">${esc(t.no) || '—'}</div></div><div class="end"><div class="s">Tarih</div><b>${trT(t.tarih)}</b></div></div>
      <div class="row" style="padding:8px 4px"><div class="mid"><div class="s">Konu</div><div class="t" style="white-space:normal">${esc(t.konu) || '—'}</div></div></div>
      <div class="row" style="padding:8px 4px"><div class="mid"><div class="s">Tutar</div><div class="t num">${esc(t.tutar) || '—'}</div></div><div class="end"><div class="s">Kalem</div><b>${esc(t.kalemSayisi ?? '—')}</b></div></div>
      <div class="row" style="padding:8px 4px"><div class="mid"><div class="s">Hazırlayan</div><div class="t">${esc(adi(t.by))}</div></div></div>
    </div>
    <div class="f"><label for="td-durum">Durum</label><select class="sel" id="td-durum">${opts}</select></div>
    ${kal ? `<div class="fg3" style="margin-top:12px"><button class="btn btn-s btn-sm" data-td="pdf">${ikon('down')}PDF</button><button class="btn btn-s btn-sm" data-td="excel">${ikon('down')}Excel</button><button class="btn btn-p btn-sm" data-td="gonder">${ikon('send')}Gönder</button></div>` : '<p style="font-size:12px;color:var(--fg3);margin-top:10px">Bu teklif uygulama öncesinden; kalem detayı yok.</p>'}
    ${IS_OWNER ? `<button class="btn btn-d btn-sm" id="td-sil" style="margin-top:14px">${ikon('trash')}Teklifi sil</button>` : ''}`,
    [
      ...(kal ? [{label: 'Düzenle', onClick: () => tfAc(id)}] : []),
      {label: 'Kaydet', cls: 'btn-p', onClick: async ov => { const d = v(ov, 'td-durum'); if (d === t.durum) return; const ok = await kaydet('teklifler', {...t, durum: d}); if (ok) toast('✅ Durum güncellendi'); return ok; }},
    ]);
  sh.el.querySelectorAll('[data-td]').forEach(b => b.onclick = () => cikti(b.dataset.td, tamTeklif(t), false));
  const sil = sh.el.querySelector('#td-sil');
  if (sil) sil.onclick = () => { sh.kapat(); confirmSheet('Teklif silinsin mi?', (t.no || '') + ' ' + (t.musteri || '') + ' kalıcı olarak silinecek.', () => BE.sil('teklifler', id)); };
}

// ═══════════════════════════════════════════
// MÜŞTERİ / BORÇ
// ═══════════════════════════════════════════
function firmaSatir(m) {
  const gec = vadeGecti(m);
  const [l, c] = m.durum === 'tahsil' ? ['Tahsil edildi', 'p-green'] : gec ? ['Vadesi geçti', 'p-red'] : m.durum === 'bekliyor' ? ['Ödeme bekliyor', 'p-amber'] : ['Aktif', 'p-blue'];
  return `<button class="row" data-firma="${esc(m.id)}"><div class="ico" style="background:${gec ? 'var(--red-soft)' : 'var(--green-soft)'};color:${gec ? 'var(--red)' : 'var(--green)'}">${esc(bas(m.firma))}</div>
    <div class="mid"><div class="t">${esc(m.firma)}</div><div class="s">${m.vade ? 'Vade ' + trT(m.vade) : esc(m.ilgili) || 'Vade yok'}</div></div>
    <div class="end"><b style="color:${Number(m.alacak) > 0 ? 'var(--fg)' : 'var(--fg3)'}">${tl(m.alacak)}</b><span class="pill ${c}" style="margin-top:4px">${l}</span></div></button>`;
}
function musteriCiz() {
  const o = alacakOzet();
  $('#m-alacak').textContent = kisa(o.toplam); $('#m-gecmis').textContent = kisa(o.gecmis); $('#m-tahsil').textContent = kisa(o.buAy); $('#m-firma').textContent = S.musteri.length;
  const q = $('#m-ara').value.toLowerCase();
  const l = S.musteri.filter(m => !q || (m.firma || '').toLowerCase().includes(q)).sort((a, b) => (vadeGecti(b) - vadeGecti(a)) || Number(b.alacak || 0) - Number(a.alacak || 0) || (a.firma || '').localeCompare(b.firma || '', 'tr'));
  $('#m-list').innerHTML = l.length ? l.map(firmaSatir).join('') : `<div class="empty">${S.musteri.length ? 'Sonuç yok' : 'Henüz firma yok · "+ Firma" ile ekle'}</div>`;
  const h = [...S.hareket].sort((a, b) => (b.tarih || '').localeCompare(a.tarih || '') || (b.at || '').localeCompare(a.at || '')).slice(0, 25);
  $('#h-list').innerHTML = h.length ? h.map(x => {
    const [lb, c, renk] = x.tur === 'tahsilat' ? ['Tahsilat', 'p-green', 'var(--green)'] : x.tur === 'borc' ? ['Borç / Fatura', 'p-red', 'var(--red)'] : ['Not', 'p-gray', 'var(--fg2)'];
    return `<div class="row"><div class="mid"><div class="t">${esc(x.firma)}</div><div class="s">${trT(x.tarih)} · ${esc(x.aciklama) || lb} · ${esc(adi(x.by))}</div></div><div class="end"><b style="color:${renk}">${x.tutar ? (x.tur === 'tahsilat' ? '+' : '') + tl(x.tutar) : '—'}</b><span class="pill ${c}" style="margin-top:4px">${lb}</span></div></div>`;
  }).join('') : '<div class="empty">Hareket kaydı yok</div>';
}
$('#m-ara').oninput = musteriCiz;
function firmaListesi() { $('#firma-list').innerHTML = [...new Set([...S.musteri.map(m => m.firma), ...S.teklifler.map(t => t.musteri)].filter(x => x && x !== '—'))].map(f => `<option value="${esc(f)}">`).join(''); }
function firmaForm(id) {
  const m = id ? S.musteri.find(x => x.id === id) : {};
  if (id && !m) return;
  const sh = sheet(id ? m.firma : 'Yeni firma', `<div class="fg">
    <div class="f"><label for="ff-firma">Firma adı *</label><input class="inp" id="ff-firma" value="${esc(m.firma)}"></div>
    <div class="fg2"><div class="f"><label for="ff-ilgili">İlgili kişi</label><input class="inp" id="ff-ilgili" value="${esc(m.ilgili)}"></div>
    <div class="f"><label for="ff-tel">Telefon</label><input class="inp" id="ff-tel" type="tel" value="${esc(m.tel)}"></div></div>
    <div class="fg2"><div class="f"><label for="ff-alacak">Alacak (₺)</label><input class="inp num" id="ff-alacak" type="number" inputmode="decimal" step="0.01" value="${esc(m.alacak)}"></div>
    <div class="f"><label for="ff-vade">Vade</label><input class="inp" id="ff-vade" type="date" value="${esc(m.vade)}"></div></div>
    <div class="f"><label for="ff-durum">Durum</label><select class="sel" id="ff-durum">${[['aktif', 'Aktif'], ['bekliyor', 'Ödeme bekliyor'], ['tahsil', 'Tahsil edildi']].map(([k, l]) => `<option value="${k}"${(m.durum || 'aktif') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="f"><label for="ff-eposta">E-posta</label><input class="inp" id="ff-eposta" type="email" autocapitalize="none" value="${esc(m.eposta)}" placeholder="satinalma@firma.com"></div>
    <div class="f"><label for="ff-not">Not</label><input class="inp" id="ff-not" value="${esc(m.not)}" placeholder="Fatura no, açıklama"></div>
    ${id ? `<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-s btn-sm" id="ff-hareket">+ Tahsilat / borç gir</button>${IS_OWNER ? `<button class="btn btn-d btn-sm" id="ff-sil">${ikon('trash')}Sil</button>` : ''}</div>` : ''}
  </div>`, [{label: 'Vazgeç', onClick: () => {}}, {label: 'Kaydet', cls: 'btn-p', onClick: async ov => {
    const firma = v(ov, 'ff-firma'); if (!firma) { toast('Firma adı gerekli'); ov.querySelector('#ff-firma').focus(); return false; }
    const ok = await kaydet('musteri', {...m, firma, ilgili: v(ov, 'ff-ilgili'), tel: v(ov, 'ff-tel'), eposta: v(ov, 'ff-eposta'), alacak: v(ov, 'ff-alacak'), vade: v(ov, 'ff-vade'), durum: v(ov, 'ff-durum'), not: v(ov, 'ff-not')});
    if (ok) toast(id ? '✅ Firma güncellendi' : '✅ Firma eklendi'); return ok;
  }}]);
  const hb = sh.el.querySelector('#ff-hareket'); if (hb) hb.onclick = () => { sh.kapat(); hareketForm(m.firma); };
  const sb2 = sh.el.querySelector('#ff-sil'); if (sb2) sb2.onclick = () => { sh.kapat(); confirmSheet('Firma silinsin mi?', m.firma + ' kalıcı olarak silinecek. Hareket kayıtları kalır.', () => BE.sil('musteri', id)); };
}
function hareketForm(firma) {
  if (!S.musteri.length) { toast('Önce bir firma ekle'); firmaForm(); return; }
  const fl = [...S.musteri].sort((a, b) => (a.firma || '').localeCompare(b.firma || '', 'tr'));
  sheet('Hareket gir', `<div class="fg">
    <div class="f"><label for="hf-firma">Firma *</label><select class="sel" id="hf-firma"><option value="">Seç…</option>${fl.map(m => `<option${m.firma === firma ? ' selected' : ''}>${esc(m.firma)}</option>`).join('')}</select></div>
    <div class="f"><label>Tür</label><div class="fg3" id="hf-tur">${[['tahsilat', 'Tahsilat'], ['borc', 'Borç / Fatura'], ['not', 'Not']].map(([k, l], i) => `<button type="button" class="chip${i === 0 ? ' on' : ''}" data-tur="${k}" style="height:42px">${l}</button>`).join('')}</div></div>
    <div class="fg2"><div class="f"><label for="hf-tutar">Tutar (₺)</label><input class="inp num" id="hf-tutar" type="number" inputmode="decimal" step="0.01"></div>
    <div class="f"><label for="hf-tarih">Tarih</label><input class="inp" id="hf-tarih" type="date" value="${bugun()}"></div></div>
    <div class="f"><label for="hf-ac">Açıklama</label><input class="inp" id="hf-ac" placeholder="Fatura no, çek, havale…"></div>
    <label style="display:flex;gap:9px;align-items:center;font-size:13px;color:var(--fg2)"><input type="checkbox" id="hf-dus" checked style="width:18px;height:18px"> Firmanın alacak tutarını otomatik güncelle</label>
  </div>`, [{label: 'Vazgeç', onClick: () => {}}, {label: 'Kaydet', cls: 'btn-p', onClick: async ov => {
    const f = v(ov, 'hf-firma'); if (!f) { toast('Firma seç'); return false; }
    const tur = ov.querySelector('#hf-tur .on').dataset.tur, tutar = v(ov, 'hf-tutar');
    const ok = await kaydet('hareket', {firma: f, tur, tutar, tarih: v(ov, 'hf-tarih'), aciklama: v(ov, 'hf-ac')});
    if (ok && ov.querySelector('#hf-dus').checked && Number(tutar) && tur !== 'not') {
      const m = S.musteri.find(x => x.firma === f);
      if (m) { const yeni = Math.max(0, Number(m.alacak || 0) + (tur === 'tahsilat' ? -1 : 1) * Number(tutar)); await kaydet('musteri', {...m, alacak: String(Math.round(yeni * 100) / 100), durum: yeni === 0 ? 'tahsil' : (m.durum === 'tahsil' ? 'aktif' : m.durum)}); }
    }
    if (ok) toast('✅ Hareket kaydedildi'); return ok;
  }}]);
  document.querySelector('#hf-tur').onclick = e => { const c = e.target.closest('[data-tur]'); if (c) { $$('#hf-tur .chip').forEach(x => x.classList.remove('on')); c.classList.add('on'); } };
}

// ═══════════════════════════════════════════
// STOK
// ═══════════════════════════════════════════
let sMarka = '';
function stokCiz() {
  const markalar = [...new Set(S.stok.map(u => u.marka).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
  $('#s-chips').innerHTML = ['', ...markalar].map(m => `<button class="chip${sMarka === m ? ' on' : ''}" data-sm="${esc(m)}">${esc(m) || 'Tümü'}</button>`).join('');
  const q = $('#s-ara').value.toLowerCase(), d = $('#s-durum').value;
  const l = S.stok.filter(u => (!sMarka || u.marka === sMarka) && (!d || stokDurum(u) === d) && (!q || [u.ref, u.aciklama, u.marka].join(' ').toLowerCase().includes(q))).sort((a, b) => (a.ref || '').localeCompare(b.ref || ''));
  const krit = S.stok.filter(u => ['kritik', 'yok'].includes(stokDurum(u))).length;
  $('#s-ozet').textContent = `${S.stok.length} ürün · ${markalar.length} marka · ${krit} kritik`;
  const pill = {yeterli: ['Yeterli', 'p-green'], kritik: ['Kritik', 'p-red'], yok: ['Yok', 'p-gray'], bilinmiyor: ['—', 'p-gray']};
  $('#s-list').innerHTML = l.length ? l.slice(0, 300).map(u => { const [pl, pc] = pill[stokDurum(u)];
    return `<button class="row" data-urun="${esc(u.id)}"><div class="mid"><div class="t">${esc(u.ref)}</div><div class="s">${esc(u.marka)}${u.aciklama ? ' · ' + esc(u.aciklama) : ''}</div></div><div class="end"><b>${u.fiyat ? esc(u.para || '€') + ' ' + fmt(u.fiyat) : '<span style="color:var(--fg3)">fiyat yok</span>'}</b><span class="pill ${pc}" style="margin-top:4px">${pl}${u.stok !== '' && u.stok != null ? ' · ' + esc(u.stok) : ''}</span></div></button>`; }).join('') : `<div class="empty">${S.stok.length ? 'Sonuç yok' : 'Henüz ürün yok. Fiyat listelerini Claude\'a gönder, toplu ekleyelim.'}</div>`;
}
$('#s-ara').oninput = stokCiz; $('#s-durum').onchange = stokCiz;
$('#s-chips').onclick = e => { const c = e.target.closest('[data-sm]'); if (c) { sMarka = c.dataset.sm; stokCiz(); } };
function urunForm(id) {
  const u = id ? S.stok.find(x => x.id === id) : {}; if (id && !u) return;
  const sh = sheet(id ? u.ref : 'Yeni ürün', `<div class="fg">
    <div class="f"><label for="uf-ref">Referans *</label><input class="inp" id="uf-ref" value="${esc(u.ref)}" autocapitalize="characters"></div>
    <div class="f"><label for="uf-ac">Açıklama</label><input class="inp" id="uf-ac" value="${esc(u.aciklama)}"></div>
    <div class="fg2"><div class="f"><label for="uf-marka">Marka</label><input class="inp" id="uf-marka" value="${esc(u.marka)}"></div>
    <div class="f"><label for="uf-stok">Stok adedi</label><input class="inp num" id="uf-stok" type="number" inputmode="numeric" value="${esc(u.stok)}"></div></div>
    <div class="fg3"><div class="f"><label for="uf-fiyat">Liste fiyatı</label><input class="inp num" id="uf-fiyat" type="number" inputmode="decimal" step="0.01" value="${esc(u.fiyat)}"></div>
    <div class="f"><label for="uf-para">Para</label><select class="sel" id="uf-para">${['€', '₺', '$'].map(p => `<option${(u.para || '€') === p ? ' selected' : ''}>${p}</option>`).join('')}</select></div>
    <div class="f"><label for="uf-min">Min. stok</label><input class="inp num" id="uf-min" type="number" inputmode="numeric" value="${esc(u.min)}"></div></div>
    ${id && IS_OWNER ? `<button class="btn btn-d btn-sm" id="uf-sil" style="justify-self:start">${ikon('trash')}Ürünü sil</button>` : ''}
  </div>`, [{label: 'Vazgeç', onClick: () => {}}, {label: 'Kaydet', cls: 'btn-p', onClick: async ov => {
    const ref = v(ov, 'uf-ref'); if (!ref) { toast('Referans gerekli'); return false; }
    const ok = await kaydet('stok', {...u, ref, aciklama: v(ov, 'uf-ac'), marka: v(ov, 'uf-marka'), stok: v(ov, 'uf-stok'), fiyat: v(ov, 'uf-fiyat'), para: v(ov, 'uf-para'), min: v(ov, 'uf-min')});
    if (ok) toast(id ? '✅ Ürün güncellendi' : '✅ Ürün eklendi'); return ok;
  }}]);
  const s = sh.el.querySelector('#uf-sil'); if (s) s.onclick = () => { sh.kapat(); confirmSheet('Ürün silinsin mi?', u.ref + ' silinecek.', () => BE.sil('stok', id)); };
}

// ═══════════════════════════════════════════
// TAKVİM
// ═══════════════════════════════════════════
const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const KAT = {odeme: ['Ödeme / Tahsilat', 'var(--green)'], musteri: ['Müşteri araması', 'var(--brand)'], teklif: ['Teklif takibi', 'var(--amber)'], teslimat: ['Teslimat', 'var(--orange)'], toplanti: ['Toplantı', 'var(--red)'], diger: ['Diğer', 'var(--fg3)']};
let calY = new Date().getFullYear(), calM = new Date().getMonth(), calSec = bugun();
function gorevEl(g, tarihli) {
  const el = document.createElement('button'); el.className = 'task' + (g.tamam ? ' past' : ''); el.style.cssText = 'width:100%;border-left:0;border-right:0;border-top:0;background:none;text-align:left';
  const [kl, renk] = KAT[g.kat] || KAT.diger;
  el.innerHTML = `<span class="bar" style="background:${renk}"></span><div class="mid"><div class="t"></div><div class="s"></div></div>${g.tamam ? '<span class="pill p-green">✓</span>' : ''}`;
  el.querySelector('.t').textContent = g.baslik || 'Görev';
  el.querySelector('.s').textContent = [tarihli ? trKisa(g.tarih) : '', g.saat, kl, g.not].filter(Boolean).join(' · ');
  el.onclick = () => gorevForm(g.id);
  return el;
}
function takvimCiz() {
  $('#cal-ay').textContent = AYLAR[calM] + ' ' + calY;
  const off = (new Date(calY, calM, 1).getDay() + 6) % 7, n = new Date(calY, calM + 1, 0).getDate(), onc = new Date(calY, calM, 0).getDate();
  const dolu = new Set(S.gorevler.filter(g => !g.tamam).map(g => g.tarih));
  let h = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map(d => `<div class="dn">${d}</div>`).join('');
  for (let i = 0; i < off; i++) h += `<button class="d o" disabled>${onc - off + 1 + i}</button>`;
  for (let d = 1; d <= n; d++) {
    const dt = new Date(calY, calM, d), ds = dstr(dt), we = dt.getDay() % 6 === 0;
    h += `<button class="d${ds === bugun() ? ' today' : ''}${ds === calSec ? ' sel' : ''}${we ? ' we' : ''}" data-gun="${ds}">${d}${dolu.has(ds) ? '<span class="dot"></span>' : ''}</button>`;
  }
  const kal = (7 - (off + n) % 7) % 7; for (let i = 1; i <= kal; i++) h += `<button class="d o" disabled>${i}</button>`;
  $('#cal').innerHTML = h;
  const sd = new Date(calSec + 'T12:00:00');
  $('#cal-gun').textContent = calSec === bugun() ? 'Bugün' : sd.toLocaleDateString('tr-TR', {weekday: 'long', day: 'numeric', month: 'long'});
  const gl = S.gorevler.filter(g => g.tarih === calSec).sort((a, b) => (a.saat || '').localeCompare(b.saat || ''));
  const box = $('#cal-gun-list'); box.innerHTML = gl.length ? '' : '<div class="empty">Bu gün için görev yok</div>'; gl.forEach(g => box.appendChild(gorevEl(g, false)));
  const yak = S.gorevler.filter(g => g.tarih >= bugun() && !g.tamam).sort((a, b) => ((a.tarih || '') + (a.saat || '')).localeCompare((b.tarih || '') + (b.saat || ''))).slice(0, 15);
  const gecikmis = S.gorevler.filter(g => g.tarih < bugun() && !g.tamam);
  const b2 = $('#gorev-list'); b2.innerHTML = '';
  gecikmis.forEach(g => { const e = gorevEl(g, true); e.querySelector('.s').textContent = '⚠ Gecikti · ' + e.querySelector('.s').textContent; b2.appendChild(e); });
  yak.forEach(g => b2.appendChild(gorevEl(g, true)));
  if (!b2.children.length) b2.innerHTML = '<div class="empty">Yaklaşan görev yok</div>';
}
$('#cal').onclick = e => { const d = e.target.closest('[data-gun]'); if (d) { calSec = d.dataset.gun; takvimCiz(); } };
$('#cal-prev').onclick = () => { if (--calM < 0) { calM = 11; calY--; } takvimCiz(); };
$('#cal-next').onclick = () => { if (++calM > 11) { calM = 0; calY++; } takvimCiz(); };
function gorevForm(id) {
  const g = id ? S.gorevler.find(x => x.id === id) : {tarih: calSec, kat: 'diger'}; if (id && !g) return;
  const sh = sheet(id ? 'Görev' : 'Yeni görev', `<div class="fg">
    <div class="f"><label for="gf-b">Başlık *</label><input class="inp" id="gf-b" value="${esc(g.baslik)}" placeholder="ör. CP Makina'yı ara"></div>
    <div class="fg2"><div class="f"><label for="gf-t">Tarih</label><input class="inp" id="gf-t" type="date" value="${esc(g.tarih)}"></div>
    <div class="f"><label for="gf-s">Saat</label><input class="inp" id="gf-s" type="time" value="${esc(g.saat)}"></div></div>
    <div class="f"><label for="gf-k">Kategori</label><select class="sel" id="gf-k">${Object.entries(KAT).map(([k, [l]]) => `<option value="${k}"${g.kat === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="f"><label for="gf-n">Not</label><input class="inp" id="gf-n" value="${esc(g.not)}"></div>
    ${id ? `<label style="display:flex;gap:9px;align-items:center;font-size:14px"><input type="checkbox" id="gf-tm" ${g.tamam ? 'checked' : ''} style="width:20px;height:20px"> Tamamlandı</label>
    <button class="btn btn-d btn-sm" id="gf-sil" style="justify-self:start">${ikon('trash')}Sil</button>` : ''}
  </div>`, [{label: 'Vazgeç', onClick: () => {}}, {label: 'Kaydet', cls: 'btn-p', onClick: async ov => {
    const b = v(ov, 'gf-b'), t = v(ov, 'gf-t'); if (!b || !t) { toast('Başlık ve tarih gerekli'); return false; }
    const tm = ov.querySelector('#gf-tm');
    const ok = await kaydet('gorevler', {...g, baslik: b, tarih: t, saat: v(ov, 'gf-s'), kat: v(ov, 'gf-k'), not: v(ov, 'gf-n'), tamam: tm ? tm.checked : false});
    if (ok) { calSec = t; toast(id ? '✅ Görev güncellendi' : '✅ Görev eklendi'); } return ok;
  }}]);
  const s = sh.el.querySelector('#gf-sil'); if (s) s.onclick = async () => { sh.kapat(); if (await BE.sil('gorevler', id)) toast('🗑 Görev silindi'); };
}

// ═══════════════════════════════════════════
// FİNANS (sadece sahip)
// ═══════════════════════════════════════════
function barlar(el, items) {
  if (!items.length) { el.innerHTML = '<div class="empty" style="padding:12px 0">Veri yok</div>'; return; }
  const max = Math.max(...items.map(x => x[1])) || 1;
  el.innerHTML = items.map(([ad, val, txt, renk]) => `<div class="bar-row"><div class="nm">${esc(ad)}</div><div class="tr"><i style="width:${Math.max(3, val / max * 100)}%;${renk ? 'background:' + renk : ''}"></i></div><div class="v">${esc(txt)}</div></div>`).join('');
}
function finansCiz() {
  if (!IS_OWNER) return;
  const o = alacakOzet();
  $('#f-alacak').textContent = '₺' + fmt(o.toplam);
  $('#f-alacak-sub').textContent = S.musteri.filter(m => m.durum !== 'tahsil' && Number(m.alacak) > 0).length + ' açık hesap · ' + S.musteri.filter(vadeGecti).length + ' vadesi geçmiş';
  $('#f-tahsil').textContent = kisa(o.buAy); $('#f-gecmis').textContent = kisa(o.gecmis);
  const onay = S.teklifler.filter(t => ['onaylandi', 'tamamlandi'].includes(t.durum)).length, red = S.teklifler.filter(t => t.durum === 'reddedildi').length;
  $('#f-donusum').textContent = onay + red ? '%' + Math.round(onay / (onay + red) * 100) : '—';
  $('#f-donusum-sub').textContent = onay + ' onay · ' + red + ' red';
  const sd = S.stok.filter(u => (u.para || '€') === '€' && Number(u.fiyat) && Number(u.stok) > 0).reduce((s, u) => s + Number(u.fiyat) * Number(u.stok), 0);
  $('#f-stok').textContent = sd ? '€' + Math.round(sd).toLocaleString('tr-TR') : '—';
  barlar($('#f-dagilim'), S.musteri.filter(m => m.durum !== 'tahsil' && Number(m.alacak) > 0).sort((a, b) => b.alacak - a.alacak).slice(0, 10).map(m => [m.firma, Number(m.alacak), kisa(m.alacak), vadeGecti(m) ? 'var(--red)' : '']));
  const say = {}; S.teklifler.forEach(t => { const k = t.by || '-'; say[k] = (say[k] || 0) + 1; });
  barlar($('#f-calisan'), Object.entries(say).sort((a, b) => b[1] - a[1]).map(([k, n]) => [k === '-' ? 'Uygulama öncesi' : adi(k), n, n + ' teklif']));
}

// ═══════════════════════════════════════════
// AYARLAR / ROL
// ═══════════════════════════════════════════
function rolUygula() {
  const p = P[ME] || {};
  IS_OWNER = DEMO || p.rol === 'sahip';
  $$('.owner-only').forEach(e => e.hidden = !IS_OWNER);
  $$('[data-adim]').forEach(e => e.textContent = p.ad || 'Kullanıcı');
  $$('[data-rolum]').forEach(e => e.textContent = IS_OWNER ? 'Yönetici' : 'Çalışan');
  $$('[data-avatar]').forEach(e => e.textContent = bas(p.ad));
  if (!IS_OWNER && (aktifSayfa === 'finans' || aktifSayfa === 'entegrasyon')) git('dashboard');
  if (IS_OWNER) ekipCiz();
}

// ═══ AYARLAR FORMLARI: teklif şablonu, mail, DİA ═══
function alanlariDoldur(kok, veri) {
  kok.querySelectorAll('[data-a]').forEach(e => {
    const yol = e.dataset.a.split('.'); let val = veri; yol.forEach(k => { val = val == null ? val : val[k]; });
    if (e.type === 'checkbox') e.checked = !!val;
    else if (Array.isArray(val)) e.value = val.join('\n');
    else e.value = val ?? '';
  });
}
function alanlariOku(kok, temel) {
  const out = JSON.parse(JSON.stringify(temel || {}));
  kok.querySelectorAll('[data-a]').forEach(e => {
    const yol = e.dataset.a.split('.'); let hedef = out;
    yol.slice(0, -1).forEach(k => { hedef = hedef[k] = hedef[k] || {}; });
    const son = yol[yol.length - 1];
    hedef[son] = e.type === 'checkbox' ? e.checked : e.dataset.liste !== undefined ? e.value.split('\n').map(s => s.trim()).filter(Boolean) : e.value.trim();
  });
  return out;
}
function ayarlarCiz() {
  if (!IS_OWNER) return;
  alanlariDoldur($('#ayar-teklif'), A.teklif);
  alanlariDoldur($('#ayar-mail'), A.mail);
  alanlariDoldur($('#ayar-dia'), A.dia);
  const dia = A.dia, dolu = dia.sunucu && dia.firmaKodu && dia.kullanici;
  $('#dia-durum').className = 'pill ' + (dolu ? 'p-amber' : 'p-gray');
  $('#dia-durum').textContent = dolu ? 'Bilgiler kayıtlı · bağlantı kurulumu bekliyor' : 'Henüz ayarlanmadı';
}
[['ayar-teklif', 'teklif'], ['ayar-mail', 'mail'], ['ayar-dia', 'dia']].forEach(([kutu, id]) => {
  $('#' + kutu + ' [data-kaydet]').onclick = async e => {
    const b = e.currentTarget; b.disabled = true;
    const ok = await BE.ayarYaz(id, alanlariOku($('#' + kutu), A[id]));
    b.disabled = false; if (ok) toast('✅ Kaydedildi');
  };
});
function ekipCiz() {
  const box = $('#ekip-list');
  if (DEMO) { box.innerHTML = '<div class="empty">Demo modunda ekip yok</div>'; return; }
  box.innerHTML = Object.entries(P).sort((a, b) => (a[1].ad || '').localeCompare(b[1].ad || '', 'tr')).map(([id, p]) =>
    `<button class="row" data-uye="${esc(id)}"><div class="avatar">${esc(bas(p.ad))}</div><div class="mid"><div class="t">${esc(p.ad) || '—'}${id === ME ? ' (sen)' : ''}</div><div class="s">${p.rol === 'sahip' ? 'Yönetici' : 'Çalışan'}</div></div>${ikon('right')}</button>`).join('');
}
$('#ekip-list').onclick = e => {
  const r = e.target.closest('[data-uye]'); if (!r) return; const id = r.dataset.uye, p = P[id];
  sheet('Ekip üyesi', `<div class="fg"><div class="f"><label for="ue-ad">Görünen ad</label><input class="inp" id="ue-ad" value="${esc(p.ad)}"></div>
    <div class="f"><label for="ue-rol">Rol</label><select class="sel" id="ue-rol"${id === ME ? ' disabled' : ''}><option value="calisan"${p.rol !== 'sahip' ? ' selected' : ''}>Çalışan</option><option value="sahip"${p.rol === 'sahip' ? ' selected' : ''}>Yönetici (Finans görür, silebilir)</option></select></div></div>`,
    [{label: 'Vazgeç', onClick: () => {}}, {label: 'Kaydet', cls: 'btn-p', onClick: async ov => {
      const {error} = await sb.from('profiles').update({ad: v(ov, 'ue-ad'), rol: id === ME ? p.rol : v(ov, 'ue-rol')}).eq('id', id);
      if (error) { hata(error); return false; } await profilYukle(); rolUygula(); hepsiniCiz(); toast('✅ Güncellendi');
    }}]);
};
$('#cikis').onclick = async () => { if (sb) await sb.auth.signOut(); lsSet('co_page', 'dashboard'); location.reload(); };
$('#sifre-btn').onclick = async () => {
  const s = $('#yeni-sifre').value; if (s.length < 6) { toast('Şifre en az 6 karakter olmalı'); return; }
  if (DEMO) { toast('Demo modunda şifre yok'); return; }
  const {error} = await sb.auth.updateUser({password: s}); if (error) hata(error); else { $('#yeni-sifre').value = ''; toast('✅ Şifre güncellendi'); }
};
$('#surum').textContent = APP_VERSION;

// ═══════════════════════════════════════════
// PWA: kurulum + otomatik güncelleme
// ═══════════════════════════════════════════
let kurPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); kurPrompt = e; $('#kur-btn').hidden = false; });
$('#kur-btn').onclick = async () => { if (!kurPrompt) return; kurPrompt.prompt(); await kurPrompt.userChoice; kurPrompt = null; $('#kur-btn').hidden = true; };
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
async function surumKontrol() {
  try {
    const r = await fetch('version.json?t=' + Date.now(), {cache: 'no-store'}); if (!r.ok) return;
    const j = await r.json();
    if (j.v && j.v !== APP_VERSION) {
      // Uygulama yeni açıldıysa sessizce yenile; kullanım ortasındaysa sor
      // Her yeni sürüm için en fazla bir kez otomatik yenile (döngüye girmesin)
      let denendi = false; try { denendi = sessionStorage.getItem('co_yenile_' + j.v) === '1'; sessionStorage.setItem('co_yenile_' + j.v, '1'); } catch (e) { denendi = true; }
      if (!denendi && performance.now() < 8000 && !$('.overlay')) location.reload();
      else $('#upd-banner').hidden = false;
    }
  } catch (e) {}
}
$('#upd-btn').onclick = () => location.reload();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') surumKontrol(); });

// ═══════════════════════════════════════════
// BAŞLAT
// ═══════════════════════════════════════════
function kullaniciEmail(u) {
  u = u.trim().toLocaleLowerCase('tr-TR');
  if (u.includes('@')) return u;
  const tr = {'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u'};
  return u.replace(/[çğıöşü]/g, c => tr[c]).replace(/\s+/g, '') + '@' + (CFG.KULLANICI_DOMAIN || 'ceylan.app');
}
$('#login-form').onsubmit = async e => {
  e.preventDefault();
  const btn = $('#login-btn'), err = $('#login-err'); btn.disabled = true; btn.textContent = 'Giriş yapılıyor…'; err.hidden = true;
  const {error} = await sb.auth.signInWithPassword({email: kullaniciEmail($('#l-user').value), password: $('#l-pass').value});
  btn.disabled = false; btn.textContent = 'Giriş yap';
  if (error) { err.textContent = /invalid/i.test(error.message) ? 'Kullanıcı adı veya şifre hatalı.' : /fetch|network/i.test(error.message) ? 'İnternet bağlantısı yok.' : error.message; err.hidden = false; return; }
  uygulamayiAc();
};

async function uygulamayiAc() {
  $('#login').hidden = true;
  try {
    if (!DEMO) { const {data} = await sb.auth.getUser(); ME = data.user && data.user.id; }
    await BE.yukle();
  } catch (e) {
    $('#splash').hidden = true; $('#app').hidden = false; setSync('err', 'Bağlantı yok'); hata(e);
  }
  $('#splash').hidden = true; $('#app').hidden = false;
  rolUygula(); tfVarsayilan(); kalemlerCiz(); hepsiniCiz(); firmaListesi(); ayarlarCiz();
  git(lsGet('co_page', 'dashboard'));
  BE.dinle();
  setTimeout(surumKontrol, 1500);
}

(async () => {
  if (DEMO) { ME = 'demo'; $('#demo-banner').hidden = false; uygulamayiAc(); return; }
  sb = supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {auth: {persistSession: true, autoRefreshToken: true, storageKey: 'ceylan-ofis-auth'}});
  sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') location.reload(); });
  const {data} = await sb.auth.getSession();
  if (data.session) uygulamayiAc();
  else { $('#splash').hidden = true; $('#login').hidden = false; setTimeout(() => $('#l-user').focus(), 50); }
})();
