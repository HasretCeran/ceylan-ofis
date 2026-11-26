'use strict';
/* Ceylan Ofis — uygulama mantığı */
const APP_VERSION = '1.10.0';
const CFG = window.CEYLAN_CONFIG || {};
const DEMO = !(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) || typeof supabase === 'undefined';

// ═══ YARDIMCILAR ═══
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => Number(n || 0).toLocaleString('tr-TR', {minimumFractionDigits:2, maximumFractionDigits:2});
const tl = n => '₺' + Number(n || 0).toLocaleString('tr-TR', {maximumFractionDigits:0});
const fmtF = n => Number(n || 0).toLocaleString('tr-TR', {minimumFractionDigits: 2, maximumFractionDigits: Math.abs(Number(n)) < 1 ? 5 : 2});
// Ürün arama: Türkçe küçük harf, kelimelerin hepsi geçmeli; kod boşluk/tire olmadan da bulunur
const nrmTR = s => String(s || '').toLocaleLowerCase('tr-TR');
const refN = s => String(s || '').toUpperCase().replace(/[\s\-./_]/g, '');
function urunAra(q, lim) {
  const tk = nrmTR(q).split(/\s+/).filter(Boolean), qn = refN(q).toLowerCase();
  const l = !tk.length ? S.stok.slice() : S.stok.filter(u => { if (!u._ix) u._ix = nrmTR([u.ref, refN(u.ref), u.marka, u.aciklama].join(' ')); return tk.every(t => u._ix.includes(t)) || (qn.length >= 3 && refN(u.ref).toLowerCase().startsWith(qn)); });
  if (qn) l.sort((a, b) => (refN(b.ref).toLowerCase() === qn) - (refN(a.ref).toLowerCase() === qn) || (refN(b.ref).toLowerCase().startsWith(qn)) - (refN(a.ref).toLowerCase().startsWith(qn)));
  return lim ? l.slice(0, lim) : l;
}
const urunBul = ref => { const n = refN(ref); return n ? S.stok.find(u => refN(u.ref) === n) : null; };
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
const COLS = ['stok', 'musteri', 'bakiye', 'hareket', 'gorevler', 'teklifler', 'siparisler', 'sayimlar', 'sayim_kalem'];
const S = {stok: [], musteri: [], hareket: [], gorevler: [], teklifler: [], siparisler: [], sayimlar: [], sayim_kalem: []};
let P = {};            // profiller: id → {ad, rol}
let ME = null;         // giriş yapan kullanıcı id
let IS_OWNER = false;
let IS_FIN = false; // bakiye görme yetkisi: yönetici + finans yetkisi verilenler
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
  async yukle() { COLS.forEach(c => { const a = lsGet('co_' + c, []); S[c] = Array.isArray(a) ? a : []; }); P = {demo: {ad: 'Hasret Can Ceran', rol: 'sahip', finans: true}}; const a = lsGet('co_ayarlar', {}); Object.keys(A).forEach(k => { if (a[k]) A[k] = {...A[k], ...a[k]}; }); },
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
    // Supabase her istekte en fazla 1000 satır verir: sayfa sayfa hepsini çek
    const hepsi = async c => {
      const {count, error: e0} = await sb.from(c).select('id', {count: 'exact', head: true});
      if (e0) throw e0;
      const sayfa = Math.max(1, Math.ceil((count || 0) / 1000) + 1), out = [];
      for (let i = 0; i < sayfa; i += 6) {   // 6'şar sayfa paralel
        const parca = await Promise.all(Array.from({length: Math.min(6, sayfa - i)}, (_, k) => sb.from(c).select('*').order('id').range((i + k) * 1000, (i + k) * 1000 + 999)));
        for (const {data, error} of parca) { if (error) throw error; out.push(...data); }
      }
      return out;
    };
    this._hepsi = hepsi;
    // Ürün listesi büyük: uygulamayı bekletmeden arkadan yüklenir
    const ana = COLS.filter(c => c !== 'stok');
    const sonuc = await Promise.all(ana.map(hepsi));
    sonuc.forEach((rows, i) => { S[ana[i]] = rows.map(rowToObj); });
    hepsi('stok').then(rows => { S.stok = rows.map(rowToObj); degisti('stok'); }).catch(e => console.warn('stok', e));
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
  // Telefon arka plana alınınca canlı bağlantı kopar: öne gelince verileri yeniden çek
  async tazele() {
    if (!this._hepsi) return;
    try {
      const ana = COLS.filter(c => c !== 'stok');
      const sonuc = await Promise.all(ana.map(c => this._hepsi(c)));
      sonuc.forEach((rows, i) => { S[ana[i]] = rows.map(rowToObj); degisti(ana[i]); });
      const ch = sb.getChannels()[0];
      if (!ch || ch.state !== 'joined') { if (ch) await sb.removeChannel(ch); this.dinle(); }
    } catch (e) { console.warn('tazele', e); }
  },
  dinle() {
    const ch = sb.channel('ceylan-ofis');
    COLS.filter(c => c !== 'stok').forEach(col => ch.on('postgres_changes', {event: '*', schema: 'public', table: col}, p => {
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
  const {data, error} = await sb.from('profiles').select('id,ad,rol,finans,aktif,kullanici');
  if (!error && data) { P = {}; data.forEach(p => { P[p.id] = {ad: p.ad, rol: p.rol, finans: !!p.finans, aktif: p.aktif !== false, kullanici: p.kullanici || ''}; }); }
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
  if (cols.includes('siparisler') && typeof siparislerCiz === 'function') siparislerCiz();
  if ((cols.includes('sayimlar') || cols.includes('sayim_kalem')) && typeof sayimCiz === 'function') sayimCiz();
  if (cols.includes('musteri') || cols.includes('bakiye')) cariKirli = true;
  if (cols.includes('musteri') || cols.includes('hareket') || cols.includes('bakiye')) { musteriCiz(); if (cols.includes('musteri')) firmaListesi(); }
  if (cols.includes('stok')) stokCiz();
  if (cols.includes('gorevler') || cols.includes('bakiye')) takvimCiz();
  dashboardCiz();
  if (aktifSayfa === 'finans') finansCiz();
}
function hepsiniCiz() { ciz(COLS); }

// ═══ NAVİGASYON ═══
const BASLIK = {dashboard: 'Genel Bakış', teklif: 'Teklif Oluştur', teklifler: 'Teklif Geçmişi', siparisler: 'Siparişler', sayim: 'Stok Sayımı', musteri: 'Cariler & Borç', stok: 'Stok / Ürünler', takvim: 'Takvim', finans: 'Finans Raporu', entegrasyon: 'Entegrasyonlar', ayarlar: 'Ayarlar'};
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
// Vadesi geçen tutar: DİA vade raporundan (vgec) ya da elle girilen vade tarihinden
const gecTutar = m => { if (m.durum === 'tahsil' || !Number(m.alacak)) return 0; if (m.vgec != null) return m.vyon && (m.vyon === 'alacak') !== (Number(m.alacak) > 0) ? 0 : Math.min(Number(m.vgec) || 0, Math.abs(Number(m.alacak))); return m.vade && m.vade < bugun() ? Math.abs(Number(m.alacak)) : 0; };
const vadeGecti = m => gecTutar(m) >= 1;
// Yaklaşan vade: DİA'da vadesi gelmeyen kısmın ortalama vade tarihi (vgelT), yoksa elle girilen vade
const yakVade = m => m.durum === 'tahsil' || Math.abs(Number(m.alacak)) < 1 || (m.vgel != null && Number(m.vgel) < 1 && !(m.vgec == null)) || (m.vyon && (m.vyon === 'alacak') !== (Number(m.alacak) > 0)) ? '' : m.vgelT || (m.vgec == null && m.vade >= bugun() ? m.vade : '');
// Ortalama vade: vadesi geçen ve gelmeyen kısımların tutar ağırlıklı ortalama tarihi
const tGun = t => new Date(t + 'T12:00:00').getTime() / 864e5;
const gunT = g => dstr(new Date(Math.round(g) * 864e5));
function ortVade(m) {
  if (m.durum === 'tahsil' || Math.abs(Number(m.alacak)) < 1) return null;
  if (m.vyon && (m.vyon === 'alacak') !== (Number(m.alacak) > 0)) return null;
  const p = [];
  if (Number(m.vgec) > 0 && m.vgecT) p.push([tGun(m.vgecT), Number(m.vgec)]);
  if (Number(m.vgel) > 0 && m.vgelT) p.push([tGun(m.vgelT), Number(m.vgel)]);
  if (!p.length && m.vgec == null && m.vade) p.push([tGun(m.vade), Math.abs(Number(m.alacak))]);
  const w = p.reduce((s, x) => s + x[1], 0); if (!w) return null;
  return {tarih: gunT(p.reduce((s, x) => s + x[0] * x[1], 0) / w), tutar: w};
}
function ortVadeToplam(yon) {
  let w = 0, g = 0;
  cariler().forEach(m => { if (yon === 'alacak' ? Number(m.alacak) <= 0 : Number(m.alacak) >= 0) return; const o = ortVade(m); if (o) { w += o.tutar; g += tGun(o.tarih) * o.tutar; } });
  return w ? {tarih: gunT(g / w), tutar: w} : null;
}
// Sıralama: ödemesi yaklaşanlar en üstte (en yakın vade önce), vadesi geçmişler altta (en yeni geçen önce)
const ovSira = m => { const g = gunFark(ortVade(m).tarih); return g >= 0 ? g : 100000 - g; };
const gunYazi = t => { const g = gunFark(t); return g === 0 ? 'bugün' : g < 0 ? Math.abs(g) + ' gün geçti' : g + ' gün kaldı'; };
const gunFark = t => Math.round((new Date(t + 'T12:00:00') - new Date(bugun() + 'T12:00:00')) / 864e5);
function alacakOzet() {
  const acik = cariler().filter(m => m.durum !== 'tahsil');
  const ay = bugun().slice(0, 7);
  return {
    toplam: acik.reduce((s, m) => s + Math.max(0, Number(m.alacak || 0)), 0),
    borc: acik.reduce((s, m) => s + Math.max(0, -Number(m.alacak || 0)), 0),
    gecmis: cariler().filter(m => Number(m.alacak) > 0).reduce((s, m) => s + gecTutar(m), 0),
    borcGecmis: cariler().filter(m => Number(m.alacak) < 0).reduce((s, m) => s + gecTutar(m), 0),
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
  if (IS_FIN) vadeUyariCiz($('#d-vadeler'), 4);
}
// Vade uyarıları: vadesi geçen alacak/borç + 14 gün içinde vadesi gelenler
function vadeUyari() {
  const c = cariler(), s = 14;
  const yak = c.filter(m => { const t = yakVade(m); return t && gunFark(t) <= s; }).sort((a, b) => yakVade(a).localeCompare(yakVade(b)));
  return {
    alacakGec: c.filter(m => Number(m.alacak) > 0 && vadeGecti(m)).sort((a, b) => gecTutar(b) - gecTutar(a)),
    borcGec: c.filter(m => Number(m.alacak) < 0 && vadeGecti(m)).sort((a, b) => gecTutar(b) - gecTutar(a)),
    alacakYak: yak.filter(m => Number(m.alacak) > 0), borcYak: yak.filter(m => Number(m.alacak) < 0),
    ...(() => { const ov = c.map(m => [m, ortVade(m)]).filter(([m, o]) => o && gunFark(o.tarih) >= 0 && gunFark(o.tarih) <= s).sort((a, b) => a[1].tarih.localeCompare(b[1].tarih)).map(x => x[0]);
      return {ortAlacak: ov.filter(m => Number(m.alacak) > 0), ortVerecek: ov.filter(m => Number(m.alacak) < 0)}; })(),
  };
}
function vadeSatir(m, tip) {
  const al = Number(m.alacak) > 0, ov = tip === 'ort' ? ortVade(m) : null, t = ov ? ov.tarih : tip === 'gec' ? m.vgecT || m.vade : yakVade(m), g = t ? gunFark(t) : 0;
  const tutar = ov ? ov.tutar : tip === 'gec' ? gecTutar(m) : (m.vgel != null ? Number(m.vgel) : Math.abs(Number(m.alacak)));
  const ne = ov ? 'Ort. vade ' + trT(t) + ' · ' + gunYazi(t) : tip === 'gec' ? (al ? 'Tahsil edilmeli' : 'Ödenmeli') + (t ? ' · ort. vade ' + trT(t) + ' (' + Math.abs(g) + ' gün geçti)' : '') : (al ? 'Tahsilat' : 'Ödeme') + ' · ' + trT(t) + (g === 0 ? ' · bugün' : g > 0 ? ' · ' + g + ' gün kaldı' : '');
  return `<button class="row" data-firma="${esc(m.id)}"><div class="ico" style="background:${tip === 'gec' ? 'var(--red-soft)' : tip === 'ort' ? 'var(--brand-soft)' : 'var(--amber-soft, var(--orange-soft))'};color:${tip === 'gec' ? 'var(--red)' : tip === 'ort' ? 'var(--brand)' : 'var(--orange)'}">${esc(bas(m.firma))}</div>
    <div class="mid"><div class="t">${esc(m.firma)}</div><div class="s">${esc(ne)}</div></div>
    <div class="end"><b class="num" style="color:${al ? 'var(--fg)' : 'var(--orange)'}">${tl(tutar)}</b><span class="pill ${tip === 'gec' ? 'p-red' : tip === 'ort' ? 'p-blue' : 'p-amber'}" style="margin-top:4px">${al ? 'Alacak' : 'Borcumuz'}</span></div></button>`;
}
function vadeUyariCiz(el, adet) {
  const u = vadeUyari(), top = a => a.reduce((s, m) => s + gecTutar(m), 0);
  const blok = (bas, list, tip, ozet) => list.length ? `<div class="vu-h">${bas} <span>${list.length} firma${ozet ? ' · ' + ozet : ''}</span></div>` + list.slice(0, adet).map(m => vadeSatir(m, tip)).join('') + (list.length > adet ? `<div class="vu-more">+${list.length - adet} firma daha</div>` : '') : '';
  const topO = a => a.reduce((s, m) => s + ortVade(m).tutar, 0);
  const h = blok('📅 Ort. vadesi yaklaşan alacaklar (14 gün)', u.ortAlacak, 'ort', kisa(topO(u.ortAlacak))) + blok('📅 Ort. vadesi yaklaşan verecekler (14 gün)', u.ortVerecek, 'ort', kisa(topO(u.ortVerecek))) + blok('⚠ Vadesi geçen alacaklar', u.alacakGec, 'gec', kisa(top(u.alacakGec))) + blok('⏰ 14 gün içinde tahsilat', u.alacakYak, 'yak') + blok('⚠ Vadesi geçen borçlarımız', u.borcGec, 'gec', kisa(top(u.borcGec))) + blok('⏰ 14 gün içinde ödeme', u.borcYak, 'yak');
  el.innerHTML = h || '<div class="empty">Vade uyarısı yok ✓</div>';
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
        <div class="f c4"><label>Birim fiyat</label><input class="inp num" data-k="fiyat" type="number" inputmode="decimal" min="0" step="any" value="${esc(k.fiyat)}" placeholder="0,00"></div>
        <div class="f c2"><label>Para</label><select class="sel" data-k="para">${opt(['€', '₺', '$'], k.para || '€')}</select></div>
      </div>`;
    const netYaz = () => { const n = kalemNet(k); el.querySelector('[data-net]').textContent = n > 0 ? (k.para || '€') + ' ' + fmt(n) : '—'; };
    netYaz();
    el.querySelectorAll('[data-k]').forEach(inp => inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', () => { k[inp.dataset.k] = inp.value; netYaz(); tfSakla(); }));
    // Kod yazılınca fiyat listesinden doldur (boş alanları)
    el.querySelector('[data-k="ref"]').addEventListener('change', () => {
      const u = urunBul(k.ref); if (!u) return;
      const set = (a, v) => { if (v !== undefined && v !== null && v !== '' && !k[a]) { k[a] = v; const i2 = el.querySelector(`[data-k="${a}"]`); if (i2) i2.value = v; } };
      set('marka', u.marka); set('aciklama', u.aciklama);
      if (u.fiyat && !Number(k.fiyat)) { k.fiyat = u.fiyat; k.para = u.para || k.para; el.querySelector('[data-k="fiyat"]').value = u.fiyat; el.querySelector('[data-k="para"]').value = k.para; }
      netYaz(); tfSakla(); toast('✓ ' + u.marka + ' listesinden dolduruldu');
    });
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
    const l = urunAra(sh.el.querySelector('#pk-ara').value, 80);
    const box = sh.el.querySelector('#pk-list'); box.innerHTML = l.length ? '' : '<div class="empty">Sonuç yok</div>';
    l.forEach(u => { const b = document.createElement('button'); b.className = 'row';
      b.innerHTML = `<div class="mid"><div class="t">${esc(u.ref)}</div><div class="s">${esc(u.marka)} · ${esc(u.aciklama)}</div></div><div class="end"><b>${u.fiyat ? esc(u.para || '€') + ' ' + fmtF(u.fiyat) : '—'}</b></div>`;
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
  const taslak = lsGet('co_tf_meta', {});
  [['odeme', d.odeme], ['teslimYeri', d.teslimYeri], ['teslimSure', d.teslimSure], ['gecerli', d.gecerli]].forEach(([k, val]) => {
    const e = $('#tf-' + k); if (!val || taslak[k]) return;
    if (e.tagName === 'SELECT') { if ([...e.options].some(o => o.value === val)) e.value = val; } else if (!e.value) e.value = val;
  });
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
const tamTeklif = t => ({...t, hazirlayan: t.hazirlayan || (t.by && P[t.by] && P[t.by].ad) || benimAdim(), tarih: t.tarih || bugun()});
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
      ...(S.siparisler.some(x => x.teklifId === id) ? [{label: 'Siparişi aç', onClick: () => { setTimeout(() => siparisDetay(S.siparisler.find(x => x.teklifId === id).id), 0); }}] : [{label: 'Siparişe dönüştür', onClick: () => { setTimeout(() => siparisForm({}, t), 0); }}]),
      {label: 'Kaydet', cls: 'btn-p', onClick: async ov => { const d = v(ov, 'td-durum'); if (d === t.durum) return; const ok = await kaydet('teklifler', {...t, durum: d}); if (ok) toast('✅ Durum güncellendi'); return ok; }},
    ]);
  sh.el.querySelectorAll('[data-td]').forEach(b => b.onclick = () => cikti(b.dataset.td, tamTeklif(t), false));
  const sil = sh.el.querySelector('#td-sil');
  if (sil) sil.onclick = () => { sh.kapat(); confirmSheet('Teklif silinsin mi?', (t.no || '') + ' ' + (t.musteri || '') + ' kalıcı olarak silinecek.', () => BE.sil('teklifler', id)); };
}


// ═══ EXCEL TEKLİFLERİNİ İÇE AKTAR (sürükle-bırak / dosya seç) ═══
async function teklifIceAl(dosyalar) {
  const liste = [...dosyalar].filter(f => /\.xlsx?$/i.test(f.name));
  if (!liste.length) { toast('Excel (.xlsx) dosyası bırak ya da seç'); return; }
  toast(liste.length + ' dosya okunuyor…');
  const sonuc = [];
  for (const f of liste) {
    try { sonuc.push({f, t: await TC.sablonOku(f)}); } catch (e) {
      // Ceylan şablonu değilse: başlıklı her Excel'i satır satır al (kodsuz kalemler dahil)
      let g = [];
      try { if (window.hzExcelKalemler) g = await hzExcelKalemler(f); } catch (e2) { g = []; }
      if (!g.length) { sonuc.push({f, hata: e.message || 'Okunamadı'}); continue; }
      const kal = g.map(r => r.u ? {ref: r.u.ref, aciklama: r.aciklama || r.u.aciklama, marka: r.marka || r.u.marka || '', miktar: r.miktar, birim: r.birim || 'Adet', fiyat: r.u.fiyat || '', para: r.u.para || '€', iskonto: 0} : {ref: r.ref || '', aciklama: r.aciklama || '', marka: r.marka || '', miktar: r.miktar, birim: r.birim || 'Adet', fiyat: '', para: '€', iskonto: 0});
      const mus = f.name.replace(/\.xlsx?$/i, '').replace(/^teklif[_\s-]*/i, '').split(/[_\s-]+/).filter(x => x && !/^\d+$/.test(x)).slice(0, 3).join(' ');
      sonuc.push({f, t: {musteri: mus || 'Müşteri', musteriTahmin: true, no: '', konu: f.name.replace(/\.xlsx?$/i, ''), tarih: bugun(), kalemler: kal, kalemSayisi: kal.length, kaynakDosya: f.name}});
    }
  }
  const ayni = t => S.teklifler.find(x => x.kaynakDosya && x.kaynakDosya === t.kaynakDosya) || (t.no && S.teklifler.find(x => x.no === t.no && (x.musteri || '').toLocaleLowerCase('tr-TR') === (t.musteri || '').toLocaleLowerCase('tr-TR')));
  const okSay = sonuc.filter(x => x.t).length;
  const sh = sheet('Excel\'den teklif aktar', `
    <div class="f" style="margin-bottom:12px"><label for="ice-durum">Durum (hepsi için)</label><select class="sel" id="ice-durum">${Object.entries(DURUM).map(([k, [l]]) => `<option value="${k}"${k === 'gonderildi' ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
    ${sonuc.map((x, i) => {
      if (x.hata) return `<div class="ice-row hata"><div class="mid"><div class="t" style="font-weight:600;font-size:13px;word-break:break-all">${esc(x.f.name)}</div><div class="s" style="color:var(--red)">${esc(x.hata)}</div></div></div>`;
      const t = x.t, var_ = ayni(t);
      return `<div class="ice-row"><input type="checkbox" data-i="${i}" ${var_ ? '' : 'checked'}>
        <div class="mid"><input class="inp" data-musteri="${i}" value="${esc(t.musteri)}" list="firma-list" placeholder="Müşteri adı">
        <div class="s">${t.no ? 'No ' + esc(t.no) + ' · ' : ''}${t.kalemSayisi} kalem · ${esc(toplamYazi(t.kalemler))}<br>${esc(t.konu || '')}${t.konu ? ' · ' : ''}${trT(t.tarih)}${t.hazirlayan ? ' · ' + esc(t.hazirlayan) : ''}</div>
        ${t.musteriTahmin ? '<div class="s" style="color:var(--amber)">Müşteri adı dosyada yok, dosya adından tahmin edildi — kontrol et</div>' : ''}
        ${var_ ? `<div class="s" style="color:var(--amber)">Bu teklif zaten kayıtlı (${esc(var_.no || '')}). İşaretlersen güncellenir.</div>` : ''}
        <div class="s" style="color:var(--fg3);word-break:break-all">${esc(x.f.name)}</div></div></div>`;
    }).join('')}`,
    okSay ? [{label: 'Vazgeç', onClick: () => {}}, {label: 'Kaydet', cls: 'btn-p', onClick: async ov => {
      const durum = v(ov, 'ice-durum');
      const secili = [...ov.querySelectorAll('[data-i]')].filter(c => c.checked).map(c => +c.dataset.i);
      if (!secili.length) { toast('Kaydedilecek dosya seçilmedi'); return false; }
      let n = 0;
      for (const i of secili) {
        const t = {...sonuc[i].t}; t.musteri = ov.querySelector(`[data-musteri="${i}"]`).value.trim() || t.musteri; delete t.musteriTahmin;
        const var_ = ayni(t);
        const obj = {...(var_ || {}), ...t, id: var_ ? var_.id : newId(), no: t.no || (var_ && var_.no) || otoNo(), durum, tutar: toplamYazi(t.kalemler), iceAktarim: bugun()};
        if (await kaydet('teklifler', obj)) n++;
      }
      toast(`✅ ${n} teklif kaydedildi`, 3500);
      git('teklifler');
    }}] : [{label: 'Kapat', onClick: () => {}}]);
  return sh;
}
$('#tk-dosya').onchange = e => { const f = e.target.files; if (f && f.length) teklifIceAl(f); e.target.value = ''; };
{
  let sayac = 0;
  const dosyaVar = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  const acik = () => !$('#app').hidden;
  document.addEventListener('dragenter', e => { if (!dosyaVar(e) || !acik()) return; e.preventDefault(); sayac++; $('#drop-ov').hidden = false; $('#tk-drop').classList.add('on'); });
  document.addEventListener('dragover', e => { if (dosyaVar(e) && acik()) e.preventDefault(); });
  document.addEventListener('dragleave', e => { if (!dosyaVar(e)) return; sayac = Math.max(0, sayac - 1); if (!sayac) { $('#drop-ov').hidden = true; $('#tk-drop').classList.remove('on'); } });
  document.addEventListener('drop', e => {
    if (!dosyaVar(e) || !acik()) return;
    e.preventDefault(); sayac = 0; $('#drop-ov').hidden = true; $('#tk-drop').classList.remove('on');
    if (e.dataTransfer.files.length) { if (aktifSayfa === 'teklif' && window.hizliTeklif) hizliTeklif([...e.dataTransfer.files]); else teklifIceAl(e.dataTransfer.files); }
  });
}

// ═══════════════════════════════════════════
// MÜŞTERİ / BORÇ
// ═══════════════════════════════════════════
// Cari kart + bakiye birleşimi (bakiye sadece yetkiliye gelir)
let CARI = [], cariKirli = true;
function cariler() {
  if (cariKirli) {
    const bm = new Map(S.bakiye.map(b => [b.id, b]));
    CARI = S.musteri.map(m => { const b = bm.get(m.id); return b ? {...m, alacak: b.alacak, vade: b.vade, durum: b.durum, ba: b.ba, bakiye: b.bakiye, bkaynak: b.kaynak, vgec: b.vgec, vgecT: b.vgecT, vgel: b.vgel, vgelT: b.vgelT, vkaynak: b.vkaynak} : m; });
    cariKirli = false;
  }
  return CARI;
}
const TUR = {musteri: 'Müşteri', tedarikci: 'Tedarikçi', diger: 'Diğer'};
let mFiltre = 'bakiyeli', mLimit = 100;
function firmaSatir(m) {
  const al = Number(m.alacak || 0), gec = vadeGecti(m), borc = al < 0;
  let l, c;
  if (!IS_FIN) [l, c] = [TUR[m.tur] || 'Firma', 'p-gray'];
  else if (m.durum === 'tahsil') [l, c] = ['Kapandı', 'p-green'];
  else if (mFiltre.startsWith('ort') && ortVade(m) && gunFark(ortVade(m).tarih) >= 0) [l, c] = [gunFark(ortVade(m).tarih) === 0 ? 'Bugün' : gunFark(ortVade(m).tarih) + ' gün kaldı', gunFark(ortVade(m).tarih) <= 7 ? 'p-amber' : 'p-blue'];
  else if (gec) [l, c] = [borc ? 'Ödemesi geçti' : 'Vadesi geçti', 'p-red'];
  else if (borc) [l, c] = ['Borcumuz', 'p-orange'];
  else if (al > 0) [l, c] = [yakVade(m) ? 'Vade ' + trKisa(yakVade(m)) : 'Alacak', 'p-blue'];
  else [l, c] = [TUR[m.tur] || 'Firma', 'p-gray'];
  const renk = gec ? ['var(--red-soft)', 'var(--red)'] : borc ? ['var(--orange-soft)', 'var(--orange)'] : ['var(--green-soft)', 'var(--green)'];
  const ov = IS_FIN && (mFiltre === 'ortAlacak' || mFiltre === 'ortVerecek') ? ortVade(m) : null;
  const alt = ov ? ['Ort. vade ' + trT(ov.tarih), gunYazi(ov.tarih), m.kod].filter(Boolean).join(' · ') : [m.kod, m.sehir, IS_FIN && gec ? 'Gecikmiş ' + kisa(gecTutar(m)) : '', IS_FIN && yakVade(m) ? 'Vade ' + trT(yakVade(m)) : '', !m.kod && m.ilgili ? m.ilgili : ''].filter(Boolean).join(' · ') || 'Cari kart';
  return `<button class="row" data-firma="${esc(m.id)}"><div class="ico" style="background:${renk[0]};color:${renk[1]}">${esc(bas(m.firma))}</div>
    <div class="mid"><div class="t">${esc(m.firma)}</div><div class="s">${esc(alt)}</div></div>
    <div class="end">${IS_FIN ? `<b class="num" style="color:${borc ? 'var(--orange)' : al > 0 ? 'var(--fg)' : 'var(--fg3)'}">${tl(Math.abs(al))}</b>` : ''}<span class="pill ${c}" style="margin-top:4px">${esc(l)}</span></div></button>`;
}
function musteriListe() {
  const q = $('#m-ara').value.toLocaleLowerCase('tr-TR').trim();
  return cariler().filter(m => {
    if (q && !((m.firma || '').toLocaleLowerCase('tr-TR').includes(q) || (m.kod || '').includes(q) || (m.vergiNo || '').includes(q))) return false;
    const al = Number(m.alacak || 0);
    if (mFiltre === 'bakiyeli') return IS_FIN ? al !== 0 && m.durum !== 'tahsil' : true;
    if (mFiltre === 'gecmis') return vadeGecti(m);
    if (mFiltre === 'ortAlacak') return al > 0 && !!ortVade(m);
    if (mFiltre === 'ortVerecek') return al < 0 && !!ortVade(m);
    if (mFiltre === 'alacak') return al > 0 && m.durum !== 'tahsil';
    if (mFiltre === 'borc') return al < 0;
    if (mFiltre === 'musteri' || mFiltre === 'tedarikci' || mFiltre === 'diger') return m.tur === mFiltre;
    return true;
  }).sort((a, b) => (mFiltre === 'ortAlacak' || mFiltre === 'ortVerecek' ? ovSira(a) - ovSira(b) : 0) || (mFiltre === 'gecmis' ? gecTutar(b) - gecTutar(a) : 0) || (vadeGecti(b) - vadeGecti(a)) || Math.abs(Number(b.alacak || 0)) - Math.abs(Number(a.alacak || 0)) || (a.firma || '').localeCompare(b.firma || '', 'tr'));
}
function musteriCiz() {
  cariKirli = true;
  const o = alacakOzet();
  $('#m-alacak').textContent = kisa(o.toplam); $('#m-gecmis').textContent = kisa(o.gecmis); $('#m-tahsil').textContent = kisa(o.buAy); $('#m-borc').textContent = kisa(o.borc);
  $('#m-firma').textContent = S.musteri.length.toLocaleString('tr-TR');
  [['alacak', 'm-ortal'], ['borc', 'm-ortbo']].forEach(([y, id]) => { const o = IS_FIN ? ortVadeToplam(y) : null; $('#' + id).textContent = o ? trT(o.tarih) : '—'; $('#' + id + '-h').textContent = o ? gunYazi(o.tarih) + ' · ' + kisa(o.tutar) : 'vade bilgisi yok'; });
  const chips = IS_FIN ? [['bakiyeli', 'Bakiyeli'], ['gecmis', 'Vadesi geçen'], ['ortAlacak', 'Ort. vade alacak'], ['ortVerecek', 'Ort. vade verecek'], ['alacak', 'Alacaklarımız'], ['borc', 'Borçlarımız'], ['musteri', 'Müşteriler'], ['tedarikci', 'Tedarikçiler'], ['hepsi', 'Tümü']] : [['hepsi', 'Tümü'], ['musteri', 'Müşteriler'], ['tedarikci', 'Tedarikçiler']];
  if (!chips.some(c => c[0] === mFiltre)) mFiltre = chips[0][0];
  $('#m-chips').innerHTML = chips.map(([k, l]) => `<button class="chip${mFiltre === k ? ' on' : ''}" data-mf="${k}">${l}</button>`).join('');
  const l = musteriListe();
  $('#m-say').textContent = l.length.toLocaleString('tr-TR') + ' firma';
  $('#m-list').innerHTML = l.length ? l.slice(0, mLimit).map(firmaSatir).join('') + (l.length > mLimit ? `<button class="row" id="m-daha" style="justify-content:center;color:var(--brand);font-weight:600">${(l.length - mLimit).toLocaleString('tr-TR')} firma daha · göster</button>` : '') : `<div class="empty">${S.musteri.length ? 'Sonuç yok' : 'Henüz firma yok · "+ Firma" ile ekle'}</div>`;
  const d = $('#m-daha'); if (d) d.onclick = () => { mLimit += 200; musteriCiz(); };
  const h = [...S.hareket].sort((a, b) => (b.tarih || '').localeCompare(a.tarih || '') || (b.at || '').localeCompare(a.at || '')).slice(0, 25);
  $('#h-list').innerHTML = h.length ? h.map(x => {
    const [lb, c, renk] = x.tur === 'tahsilat' ? ['Tahsilat', 'p-green', 'var(--green)'] : x.tur === 'borc' ? ['Borç / Fatura', 'p-red', 'var(--red)'] : ['Not', 'p-gray', 'var(--fg2)'];
    return `<div class="row"><div class="mid"><div class="t">${esc(x.firma)}</div><div class="s">${trT(x.tarih)} · ${esc(x.aciklama) || lb} · ${esc(adi(x.by))}</div></div><div class="end"><b style="color:${renk}">${x.tutar ? (x.tur === 'tahsilat' ? '+' : '') + tl(x.tutar) : '—'}</b><span class="pill ${c}" style="margin-top:4px">${lb}</span></div></div>`;
  }).join('') : '<div class="empty">Hareket kaydı yok</div>';
}
$('#m-ara').oninput = () => { mLimit = 100; musteriCiz(); };
$('#m-chips').onclick = e => { const c = e.target.closest('[data-mf]'); if (c) { mFiltre = c.dataset.mf; mLimit = 100; musteriCiz(); } };
$$('[data-mf-tile]').forEach(t => t.onclick = () => { mFiltre = t.dataset.mfTile; mLimit = 100; musteriCiz(); $('#m-chips').scrollIntoView({behavior: 'smooth', block: 'start'}); });
function firmaListesi() { $('#firma-list').innerHTML = [...new Set([...S.musteri.map(m => m.firma), ...S.teklifler.map(t => t.musteri)].filter(x => x && x !== '—'))].slice(0, 3000).map(f => `<option value="${esc(f)}">`).join(''); }
const KART_ALAN = ['firma', 'ilgili', 'tel', 'eposta', 'not', 'kod', 'tip', 'tur', 'sehir', 'vergiNo', 'efatura', 'kaynak'];
async function bakiyeYaz(id, patch) {
  const eski = S.bakiye.find(b => b.id === id) || {};
  const ok = await BE.yaz('bakiye', {...eski, ...patch, id});
  cariKirli = true; return ok;
}
function firmaForm(id) {
  const m = id ? cariler().find(x => x.id === id) : {tur: 'musteri'};
  if (id && !m) return;
  const al = Number(m.alacak || 0);
  const sh = sheet(id ? m.firma : 'Yeni firma', `<div class="fg">
    ${m.kod ? `<div class="note">DİA cari kodu <b style="color:var(--fg)">${esc(m.kod)}</b>${m.vergiNo ? ' · VKN ' + esc(m.vergiNo) : ''}${m.sehir ? ' · ' + esc(m.sehir) : ''}${m.efatura ? ' · e-Fatura: ' + esc(m.efatura) : ''}</div>` : ''}
    <div class="f"><label for="ff-firma">Firma adı *</label><input class="inp" id="ff-firma" value="${esc(m.firma)}"></div>
    <div class="fg2"><div class="f"><label for="ff-ilgili">İlgili kişi</label><input class="inp" id="ff-ilgili" value="${esc(m.ilgili)}"></div>
    <div class="f"><label for="ff-tel">Telefon</label><input class="inp" id="ff-tel" type="tel" value="${esc(m.tel)}"></div></div>
    <div class="fg2"><div class="f"><label for="ff-eposta">E-posta</label><input class="inp" id="ff-eposta" type="email" autocapitalize="none" value="${esc(m.eposta)}" placeholder="satinalma@firma.com"></div>
    <div class="f"><label for="ff-tur">Tür</label><select class="sel" id="ff-tur">${Object.entries(TUR).map(([k, l]) => `<option value="${k}"${(m.tur || 'musteri') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div></div>
    ${IS_FIN ? `<div class="fg2"><div class="f"><label for="ff-alacak">${al < 0 ? 'Borcumuz (₺)' : 'Alacak (₺)'}</label><input class="inp num" id="ff-alacak" type="number" inputmode="decimal" step="0.01" value="${m.alacak != null ? esc(Math.abs(al)) : ''}"></div>
    <div class="f"><label for="ff-vade">Vade</label><input class="inp" id="ff-vade" type="date" value="${esc(m.vade)}"></div></div>
    <div class="fg2"><div class="f"><label for="ff-yon">Yön</label><select class="sel" id="ff-yon"><option value="B"${al >= 0 ? ' selected' : ''}>Bize borçlu (alacak)</option><option value="A"${al < 0 ? ' selected' : ''}>Biz borçluyuz</option></select></div>
    <div class="f"><label for="ff-durum">Durum</label><select class="sel" id="ff-durum">${[['aktif', 'Aktif'], ['bekliyor', 'Ödeme bekliyor'], ['tahsil', 'Tahsil edildi / kapandı']].map(([k, l]) => `<option value="${k}"${(m.durum || 'aktif') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div></div>
    ${m.vkaynak ? `<div class="note"><b style="color:var(--fg)">Vade durumu</b><br>${Number(m.vgec) > 0 ? `Vadesi geçen: <b style="color:var(--red)">${tl(m.vgec)}</b>${m.vgecT ? ' · ort. vade ' + trT(m.vgecT) + ' (' + Math.abs(gunFark(m.vgecT)) + ' gün geçti)' : ''}<br>` : ''}${Number(m.vgel) > 0 ? `Vadesi gelmeyen: <b style="color:var(--fg)">${tl(m.vgel)}</b>${m.vgelT ? ' · vade ' + trT(m.vgelT) : ''}<br>` : ''}${!(Number(m.vgec) > 0) && !(Number(m.vgel) > 0) ? 'Açık vade yok<br>' : ''}<span style="font-size:11.5px;color:var(--fg3)">${esc(m.vkaynak)}</span></div>` : ''}
    ${m.bkaynak ? `<p style="font-size:11.5px;color:var(--fg3)">Bakiye kaynağı: ${esc(m.bkaynak)}</p>` : ''}` : ''}
    <div class="f"><label for="ff-not">Not</label><input class="inp" id="ff-not" value="${esc(m.not)}" placeholder="Açıklama"></div>
    ${id ? `<div style="display:flex;gap:8px;flex-wrap:wrap">${IS_FIN ? '<button class="btn btn-s btn-sm" id="ff-hareket">+ Tahsilat / borç gir</button>' : ''}${IS_OWNER ? `<button class="btn btn-d btn-sm" id="ff-sil">${ikon('trash')}Sil</button>` : ''}</div>` : ''}
  </div>`, [{label: 'Vazgeç', onClick: () => {}}, {label: 'Kaydet', cls: 'btn-p', onClick: async ov => {
    const firma = v(ov, 'ff-firma'); if (!firma) { toast('Firma adı gerekli'); ov.querySelector('#ff-firma').focus(); return false; }
    const kart = {}; KART_ALAN.forEach(k => { if (m[k] !== undefined) kart[k] = m[k]; });
    Object.assign(kart, {firma, ilgili: v(ov, 'ff-ilgili'), tel: v(ov, 'ff-tel'), eposta: v(ov, 'ff-eposta'), tur: v(ov, 'ff-tur'), not: v(ov, 'ff-not')});
    const kid = id || newId();
    let ok = await kaydet('musteri', {...kart, id: kid, by: m.by, at: m.at});
    if (ok && IS_FIN) {
      const tutar = Math.abs(Number(v(ov, 'ff-alacak') || 0)), yon = v(ov, 'ff-yon');
      if (tutar || v(ov, 'ff-vade') || S.bakiye.some(b => b.id === kid)) ok = await bakiyeYaz(kid, {alacak: yon === 'A' ? -tutar : tutar, bakiye: tutar, ba: yon, vade: v(ov, 'ff-vade'), durum: v(ov, 'ff-durum')});
    }
    if (ok) toast(id ? '✅ Firma güncellendi' : '✅ Firma eklendi'); return ok;
  }}]);
  const hb = sh.el.querySelector('#ff-hareket'); if (hb) hb.onclick = () => { sh.kapat(); hareketForm(m.firma); };
  const sb2 = sh.el.querySelector('#ff-sil'); if (sb2) sb2.onclick = () => { sh.kapat(); confirmSheet('Firma silinsin mi?', m.firma + ' kalıcı olarak silinecek. Hareket kayıtları kalır.', async () => { await BE.sil('musteri', id); if (S.bakiye.some(b => b.id === id)) await BE.sil('bakiye', id); }); };
}
function hareketForm(firma) {
  if (!IS_FIN) { toast('⛔ Bu işlem için finans yetkisi gerekli'); return; }
  if (!S.musteri.length) { toast('Önce bir firma ekle'); firmaForm(); return; }
  sheet('Hareket gir', `<div class="fg">
    <div class="f"><label for="hf-firma">Firma *</label><input class="inp" id="hf-firma" list="firma-list" value="${esc(firma || '')}" placeholder="Firma adı yaz, listeden seç"></div>
    <div class="f"><label>Tür</label><div class="fg3" id="hf-tur">${[['tahsilat', 'Tahsilat'], ['borc', 'Borç / Fatura'], ['not', 'Not']].map(([k, l], i) => `<button type="button" class="chip${i === 0 ? ' on' : ''}" data-tur="${k}" style="height:42px">${l}</button>`).join('')}</div></div>
    <div class="fg2"><div class="f"><label for="hf-tutar">Tutar (₺)</label><input class="inp num" id="hf-tutar" type="number" inputmode="decimal" step="0.01"></div>
    <div class="f"><label for="hf-tarih">Tarih</label><input class="inp" id="hf-tarih" type="date" value="${bugun()}"></div></div>
    <div class="f"><label for="hf-ac">Açıklama</label><input class="inp" id="hf-ac" placeholder="Fatura no, çek, havale…"></div>
    <label style="display:flex;gap:9px;align-items:center;font-size:13px;color:var(--fg2)"><input type="checkbox" id="hf-dus" checked style="width:18px;height:18px"> Firmanın bakiyesini otomatik güncelle</label>
  </div>`, [{label: 'Vazgeç', onClick: () => {}}, {label: 'Kaydet', cls: 'btn-p', onClick: async ov => {
    const f = v(ov, 'hf-firma'); const m = cariler().find(x => x.firma === f);
    if (!m) { toast('Listeden kayıtlı bir firma seç'); return false; }
    const tur = ov.querySelector('#hf-tur .on').dataset.tur, tutar = v(ov, 'hf-tutar');
    const ok = await kaydet('hareket', {firma: f, firmaId: m.id, tur, tutar, tarih: v(ov, 'hf-tarih'), aciklama: v(ov, 'hf-ac')});
    if (ok && ov.querySelector('#hf-dus').checked && Number(tutar) && tur !== 'not') {
      const yeni = Math.round((Number(m.alacak || 0) + (tur === 'tahsilat' ? -1 : 1) * Number(tutar)) * 100) / 100;
      await bakiyeYaz(m.id, {alacak: yeni, bakiye: Math.abs(yeni), ba: yeni < 0 ? 'A' : 'B', durum: yeni === 0 ? 'tahsil' : (m.durum === 'tahsil' ? 'aktif' : (m.durum || 'aktif'))});
    }
    if (ok) toast('✅ Hareket kaydedildi'); return ok;
  }}]);
  document.querySelector('#hf-tur').onclick = e => { const c = e.target.closest('[data-tur]'); if (c) { $$('#hf-tur .chip').forEach(x => x.classList.remove('on')); c.classList.add('on'); } };
}
// Cari listesi dışa aktarma (PDF / Excel) — görünen filtre ile
async function cariDisa(tur) {
  if (!IS_FIN) return;
  const l = musteriListe(), baslik = 'Cari Bakiye Listesi — ' + ($('#m-chips .on') || {}).textContent;
  const kol = ['Cari Kodu', 'Firma', 'Tür', 'Şehir', 'Telefon', 'Bakiye (₺)', 'B/A', 'Ort. vade', 'Gün', 'Durum'];
  const sat = l.map(m => { const al = Number(m.alacak || 0); return [m.kod || '', m.firma || '', TUR[m.tur] || '', m.sehir || '', m.tel || '', Math.abs(al), al < 0 ? 'A' : al > 0 ? 'B' : '', ...(o => o ? [trT(o.tarih), gunFark(o.tarih)] : [m.vade ? trT(m.vade) : '', ''])(ortVade(m)), vadeGecti(m) ? 'Vadesi geçti' : m.durum === 'tahsil' ? 'Kapandı' : al ? 'Açık' : '']; });
  try {
    toast((tur === 'pdf' ? 'PDF' : 'Excel') + ' hazırlanıyor…');
    const ad = 'Cari_Bakiye_' + bugun() + (tur === 'pdf' ? '.pdf' : '.xlsx');
    const blob = tur === 'pdf' ? await TC.listePdf(baslik, kol, sat, {sayiKolon: [5]}) : await TC.listeExcel(baslik, kol, sat, {sayiKolon: [5]});
    TC.indir(blob, ad); toast('⬇ ' + ad, 3200);
  } catch (e) { toast('⚠️ ' + (e.message || 'Dosya oluşturulamadı'), 4000); }
}
$('#m-pdf').onclick = () => cariDisa('pdf');
$('#m-xlsx').onclick = () => cariDisa('excel');

// ═══════════════════════════════════════════
// STOK
// ═══════════════════════════════════════════
let sMarka = '';
function stokCiz() {
  const markalar = [...new Set(S.stok.map(u => u.marka).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
  $('#s-chips').innerHTML = ['', ...markalar].map(m => `<button class="chip${sMarka === m ? ' on' : ''}" data-sm="${esc(m)}">${esc(m) || 'Tümü'}</button>`).join('');
  const q = $('#s-ara').value.trim(), d = $('#s-durum').value;
  let l = (q ? urunAra(q) : S.stok.slice()).filter(u => (!sMarka || u.marka === sMarka) && (!d || stokDurum(u) === d));
  if (!q) l.sort((a, b) => (a.marka || '').localeCompare(b.marka || '', 'tr') || (a.ref || '').localeCompare(b.ref || ''));
  const krit = S.stok.filter(u => ['kritik', 'yok'].includes(stokDurum(u))).length;
  $('#s-ozet').textContent = `${S.stok.length.toLocaleString('tr-TR')} ürün · ${markalar.length} marka${krit ? ' · ' + krit + ' kritik' : ''}${l.length > 300 ? ' · ilk 300 gösteriliyor, aramayla daralt' : ''}`;
  const pill = {yeterli: ['Yeterli', 'p-green'], kritik: ['Kritik', 'p-red'], yok: ['Yok', 'p-gray'], bilinmiyor: ['—', 'p-gray']};
  $('#s-list').innerHTML = l.length ? l.slice(0, 300).map(u => { const [pl, pc] = pill[stokDurum(u)];
    return `<button class="row" data-urun="${esc(u.id)}"><div class="mid"><div class="t">${esc(u.ref)}</div><div class="s">${esc(u.marka)}${u.aciklama ? ' · ' + esc(u.aciklama) : ''}</div></div><div class="end"><b>${u.fiyat ? esc(u.para || '€') + ' ' + fmtF(u.fiyat) : '<span style="color:var(--fg3)">fiyat sorunuz</span>'}</b><span class="pill ${pc}" style="margin-top:4px">${pl}${u.stok !== '' && u.stok != null ? ' · ' + esc(u.stok) : ''}</span></div></button>`; }).join('') : `<div class="empty">${S.stok.length ? 'Sonuç yok' : 'Henüz ürün yok. Fiyat listelerini Claude\'a gönder, toplu ekleyelim.'}</div>`;
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
  const vg = new Map(); if (IS_FIN) cariler().forEach(m => { const t = yakVade(m); if (t) { if (!vg.has(t)) vg.set(t, []); vg.get(t).push(m); } });
  let h = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map(d => `<div class="dn">${d}</div>`).join('');
  for (let i = 0; i < off; i++) h += `<button class="d o" disabled>${onc - off + 1 + i}</button>`;
  for (let d = 1; d <= n; d++) {
    const dt = new Date(calY, calM, d), ds = dstr(dt), we = dt.getDay() % 6 === 0;
    h += `<button class="d${ds === bugun() ? ' today' : ''}${ds === calSec ? ' sel' : ''}${we ? ' we' : ''}" data-gun="${ds}">${d}${dolu.has(ds) ? '<span class="dot"></span>' : ''}${vg.has(ds) ? '<span class="dot vdot"></span>' : ''}</button>`;
  }
  const kal = (7 - (off + n) % 7) % 7; for (let i = 1; i <= kal; i++) h += `<button class="d o" disabled>${i}</button>`;
  $('#cal').innerHTML = h;
  const sd = new Date(calSec + 'T12:00:00');
  $('#cal-gun').textContent = calSec === bugun() ? 'Bugün' : sd.toLocaleDateString('tr-TR', {weekday: 'long', day: 'numeric', month: 'long'});
  const gl = S.gorevler.filter(g => g.tarih === calSec).sort((a, b) => (a.saat || '').localeCompare(b.saat || ''));
  const gv = vg.get(calSec) || [];
  const box = $('#cal-gun-list'); box.innerHTML = gl.length || gv.length ? '' : '<div class="empty">Bu gün için görev yok</div>'; gl.forEach(g => box.appendChild(gorevEl(g, false)));
  if (gv.length) box.insertAdjacentHTML('beforeend', `<div class="vu-h">Vadesi gelen <span>${gv.length} firma</span></div>` + gv.sort((a, b) => Math.abs(b.vgel || b.alacak) - Math.abs(a.vgel || a.alacak)).slice(0, 4).map(m => vadeSatir(m, 'yak')).join('') + (gv.length > 4 ? `<div class="vu-more">+${gv.length - 4} firma · Finans → Vade uyarıları</div>` : ''));
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
  $('#f-alacak-sub').textContent = cariler().filter(m => m.durum !== 'tahsil' && Number(m.alacak) > 0).length.toLocaleString('tr-TR') + ' açık alacak · ' + cariler().filter(m => Number(m.alacak) > 0 && vadeGecti(m)).length + ' vadesi geçmiş · borcumuz ' + kisa(o.borc) + (o.borcGecmis ? ' (' + kisa(o.borcGecmis) + ' vadesi geçmiş)' : '');
  vadeUyariCiz($('#f-vade'), 10);
  $('#f-tahsil').textContent = kisa(o.buAy); $('#f-gecmis').textContent = kisa(o.gecmis);
  const onay = S.teklifler.filter(t => ['onaylandi', 'tamamlandi'].includes(t.durum)).length, red = S.teklifler.filter(t => t.durum === 'reddedildi').length;
  $('#f-donusum').textContent = onay + red ? '%' + Math.round(onay / (onay + red) * 100) : '—';
  $('#f-donusum-sub').textContent = onay + ' onay · ' + red + ' red';
  const sd = S.stok.filter(u => (u.para || '€') === '€' && Number(u.fiyat) && Number(u.stok) > 0).reduce((s, u) => s + Number(u.fiyat) * Number(u.stok), 0);
  $('#f-stok').textContent = sd ? '€' + Math.round(sd).toLocaleString('tr-TR') : '—';
  barlar($('#f-dagilim'), cariler().filter(m => m.durum !== 'tahsil' && Number(m.alacak) > 0).sort((a, b) => b.alacak - a.alacak).slice(0, 10).map(m => [m.firma, Number(m.alacak), kisa(m.alacak), vadeGecti(m) ? 'var(--red)' : '']));
  const say = {}; S.teklifler.forEach(t => { const k = t.by || '-'; say[k] = (say[k] || 0) + 1; });
  barlar($('#f-calisan'), Object.entries(say).sort((a, b) => b[1] - a[1]).map(([k, n]) => [k === '-' ? 'Uygulama öncesi' : adi(k), n, n + ' teklif']));
}

// ═══════════════════════════════════════════
// AYARLAR / ROL
// ═══════════════════════════════════════════
function rolUygula() {
  const p = P[ME] || {};
  IS_OWNER = DEMO || p.rol === 'sahip';
  IS_FIN = IS_OWNER || !!p.finans;
  $$('.fin-only').forEach(e => e.hidden = !IS_FIN);
  cariKirli = true;
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
  box.innerHTML = Object.entries(P).sort((a, b) => (a[1].ad || '').localeCompare(b[1].ad || '', 'tr')).map(([id, p]) => {
    const alt = [p.kullanici ? '@' + p.kullanici : '', p.rol === 'sahip' ? 'Yönetici' : p.finans ? 'Çalışan · bakiye yetkili' : 'Çalışan'].filter(Boolean).join(' · ');
    return `<button class="row" data-uye="${esc(id)}"><div class="avatar" style="${p.aktif === false ? 'background:var(--fg3)' : ''}">${esc(bas(p.ad))}</div><div class="mid"><div class="t">${esc(p.ad) || '—'}${id === ME ? ' (sen)' : ''}</div><div class="s">${esc(alt)}</div></div>${p.aktif === false ? '<span class="pill p-red">Erişim durduruldu</span>' : ikon('right')}</button>`;
  }).join('');
}
// Yönetici: sunucu fonksiyonu üzerinden hesap işlemleri (şifreler sadece yöneticide kalır)
async function kullaniciIslem(govde) {
  const {data, error} = await sb.functions.invoke('kullanici-yonet', {body: govde});
  if (error) {
    let mesaj = error.message;
    try { const j = await error.context.json(); if (j && j.hata) mesaj = j.hata; } catch (e) {}
    toast('⚠️ ' + mesaj, 4500); return null;
  }
  return data;
}
function sifreUret() {
  const harf = 'abcdefghjkmnpqrstuvwxyz', rakam = '23456789', a = new Uint32Array(10); crypto.getRandomValues(a);
  return 'Cy' + [...a].slice(0, 6).map(x => harf[x % harf.length]).join('') + [...a].slice(6, 10).map(x => rakam[x % rakam.length]).join('');
}
const kulAdi = s => s.toLocaleLowerCase('tr-TR').replace(/[çğıöşü]/g, c => ({'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u'}[c])).replace(/[^a-z0-9._-]+/g, '').slice(0, 30);
function bilgiGoster(baslik, kul, sifre) {
  const metin = `Ceylan Ofis girişin:\nhttps://hasretceran.github.io/ceylan-ofis/\nKullanıcı adı: ${kul}\nŞifre: ${sifre}\nGirince Ayarlar → Şifre değiştir'den kendi şifreni belirleyebilirsin.`;
  const sh = sheet(baslik, `<div class="note" style="font-size:14px;line-height:1.8">Kullanıcı adı: <b style="color:var(--fg)">${esc(kul)}</b><br>Şifre: <b style="color:var(--fg);font-family:monospace;font-size:16px">${esc(sifre)}</b></div>
    <p style="font-size:12.5px;color:var(--fg2);margin-top:10px">Bu şifre bir daha gösterilmez. Kopyalayıp çalışana <b>ayrı bir mesajla</b> ilet; girdikten sonra kendi şifresini belirleyebilir.</p>`,
    [{label: 'Kopyala', cls: 'btn-p', onClick: async () => { try { await navigator.clipboard.writeText(metin); toast('📋 Kopyalandı'); } catch (e) { toast('Kopyalanamadı — ekrandan yaz'); } return false; }}, {label: 'Tamam', onClick: () => {}}]);
  return sh;
}
$('#uye-ekle').onclick = () => {
  const sif = sifreUret();
  const sh = sheet('Çalışan ekle', `<div class="fg">
    <div class="f"><label for="ye-ad">Ad soyad *</label><input class="inp" id="ye-ad" placeholder="ör. Ahmet Yılmaz" autocomplete="off"></div>
    <div class="f"><label for="ye-kul">Kullanıcı adı *</label><input class="inp" id="ye-kul" autocapitalize="none" spellcheck="false" placeholder="ör. ahmet" autocomplete="off"></div>
    <div class="f"><label for="ye-sif">Geçici şifre *</label><div style="display:flex;gap:8px"><input class="inp" id="ye-sif" value="${sif}" autocomplete="new-password" style="font-family:monospace"><button class="btn btn-s" type="button" id="ye-yeni">Yeni</button></div></div>
    <label class="chk"><input type="checkbox" id="ye-fin"> Cari bakiyeleri ve tahsilatları görebilir</label>
  </div>`, [{label: 'Vazgeç', onClick: () => {}}, {label: 'Ekle', cls: 'btn-p', onClick: async ov => {
    const ad = v(ov, 'ye-ad'), kul = kulAdi(v(ov, 'ye-kul')), sifre = v(ov, 'ye-sif');
    if (!ad || !kul) { toast('Ad soyad ve kullanıcı adı gerekli'); return false; }
    if (sifre.length < 8) { toast('Şifre en az 8 karakter olmalı'); return false; }
    const r = await kullaniciIslem({islem: 'ekle', ad, kullanici: kul, sifre, finans: ov.querySelector('#ye-fin').checked});
    if (!r) return false;
    await profilYukle(); rolUygula(); toast('✅ ' + ad + ' eklendi');
    setTimeout(() => bilgiGoster('Giriş bilgileri', r.kullanici, sifre), 250);
  }}]);
  const ad = sh.el.querySelector('#ye-ad'), kul = sh.el.querySelector('#ye-kul');
  ad.oninput = () => { if (!kul.dataset.elle) kul.value = kulAdi(ad.value.split(' ')[0] || ''); };
  kul.oninput = () => { kul.dataset.elle = '1'; };
  sh.el.querySelector('#ye-yeni').onclick = () => { sh.el.querySelector('#ye-sif').value = sifreUret(); };
};
$('#ekip-list').onclick = e => {
  const r = e.target.closest('[data-uye]'); if (!r) return; const id = r.dataset.uye, p = P[id];
  const ben = id === ME;
  const sh = sheet('Ekip üyesi', `<div class="fg">${p.kullanici ? `<div class="note">Kullanıcı adı: <b style="color:var(--fg)">${esc(p.kullanici)}</b></div>` : ''}
    <div class="f"><label for="ue-ad">Görünen ad</label><input class="inp" id="ue-ad" value="${esc(p.ad)}"></div>
    <div class="f"><label for="ue-rol">Rol</label><select class="sel" id="ue-rol"${ben ? ' disabled' : ''}><option value="calisan"${p.rol !== 'sahip' ? ' selected' : ''}>Çalışan</option><option value="sahip"${p.rol === 'sahip' ? ' selected' : ''}>Yönetici (Finans görür, silebilir)</option></select></div>
    <label class="chk"><input type="checkbox" id="ue-fin"${p.finans || p.rol === 'sahip' ? ' checked' : ''}${p.rol === 'sahip' ? ' disabled' : ''}> Cari bakiyeleri ve tahsilatları görebilir</label>
    ${ben ? '' : `<div style="display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:12px">
      <button class="btn btn-s btn-sm" id="ue-sifre">Şifre sıfırla</button>
      ${p.aktif === false ? '<button class="btn btn-s btn-sm" id="ue-ac">Erişimi tekrar aç</button>' : '<button class="btn btn-d btn-sm" id="ue-durdur">Erişimi durdur</button>'}</div>`}</div>`,
    [{label: 'Vazgeç', onClick: () => {}}, {label: 'Kaydet', cls: 'btn-p', onClick: async ov => {
      const {error} = await sb.from('profiles').update({ad: v(ov, 'ue-ad'), rol: ben ? p.rol : v(ov, 'ue-rol'), finans: ov.querySelector('#ue-fin').checked}).eq('id', id);
      if (error) { hata(error); return false; } await profilYukle(); rolUygula(); hepsiniCiz(); toast('✅ Güncellendi');
    }}]);
  const sf = sh.el.querySelector('#ue-sifre');
  if (sf) sf.onclick = async () => { const yeni = sifreUret(); sf.disabled = true; const ok = await kullaniciIslem({islem: 'sifre', id, sifre: yeni}); sf.disabled = false; if (ok) { sh.kapat(); bilgiGoster('Yeni şifre', p.kullanici || p.ad, yeni); } };
  const du = sh.el.querySelector('#ue-durdur');
  if (du) du.onclick = () => { sh.kapat(); confirmSheet('Erişim durdurulsun mu?', (p.ad || 'Bu kişi') + ' uygulamaya giremeyecek. Verileri ve geçmişi silinmez; istediğinde tekrar açabilirsin.', async () => { if (await kullaniciIslem({islem: 'durdur', id})) { await profilYukle(); rolUygula(); toast('⛔ Erişim durduruldu'); } }); };
  const ac = sh.el.querySelector('#ue-ac');
  if (ac) ac.onclick = async () => { if (await kullaniciIslem({islem: 'ac', id})) { sh.kapat(); await profilYukle(); rolUygula(); toast('✅ Erişim açıldı'); } };
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
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); kurPrompt = e; $('#kur-btn').hidden = false; if (!lsGet('co_kur_kapat', false)) $('#kur-banner').hidden = false; });
window.addEventListener('appinstalled', () => { kurPrompt = null; $('#kur-btn').hidden = true; $('#kur-banner').hidden = true; toast('✅ Uygulama kuruldu — ana ekrandan açabilirsin', 4000); });
$('#kur-banner-btn').onclick = () => $('#kur-btn').click();
$('#kur-btn').onclick = async () => { if (!kurPrompt) return; kurPrompt.prompt(); const c = await kurPrompt.userChoice; kurPrompt = null; $('#kur-btn').hidden = true; $('#kur-banner').hidden = true; if (c && c.outcome === 'dismissed') lsSet('co_kur_kapat', true); };
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
  if (BE.tazele) {
    let gizli = 0;
    document.addEventListener('visibilitychange', () => { if (document.hidden) gizli = Date.now(); else if (gizli && Date.now() - gizli > 20000) BE.tazele(); });
    window.addEventListener('online', () => BE.tazele());
  }
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
