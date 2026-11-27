'use strict';
/* Ceylan Ofis — Depo / Sevkiyat (tedarik zinciri).
   Siparişin kalemleri PAKETLERE bölünür (kısmi sevk): her paket sırayla
   hazırlanıyor → hazırlandı → onaylandı → fatura kesildi → sevk edildi adımlarından geçer.
   Her adımı kimin yaptığı ve ne zaman yaptığı kaydedilir; siparişi kimlerin gördüğü de tutulur.
   Veri, siparişin içinde: s.paketler = [{id, no, durum, kalem:[{i,m}], log:[{t,k,d,n}], faturaNo, irsaliyeNo, kargo}], s.gorenler = [{k,t}]. */
const DP = {
  hazirlaniyor: ['Hazırlanıyor', 'p-amber'], hazir: ['Hazırlandı · onay bekliyor', 'p-orange'], onayli: ['Onaylandı · fatura bekliyor', 'p-blue'],
  faturali: ['Faturalandı · sevke hazır', 'p-blue'], sevk: ['Sevk edildi', 'p-green'], iptal: ['İptal', 'p-red'],
};
const DP_ISLEM = {hazirlaniyor: 'paket açtı', hazir: 'hazırladı', onayli: 'onayladı', faturali: 'fatura kesildi', sevk: 'sevke verdi', iptal: 'iptal etti'};
const DP_SIRA = ['hazirlaniyor', 'hazir', 'onayli', 'faturali', 'sevk'];
let dpFiltre = 'acik';

const dpSay = x => Number(x) || 0;
const dpMik = k => dpSay(k.miktar) || 1;
const dpPaketler = s => (s.paketler || []).filter(p => p.durum !== 'iptal');
const dpYetki = () => IS_OWNER || IS_DEPO;
const dpZaman = t => new Date(t).toLocaleString('tr-TR', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'});

// Kalem bazında: sipariş / paketlenen / sevk edilen / kalan
function dpHesap(s) {
  const kal = Array.isArray(s.kalemler) ? s.kalemler : [];
  const r = kal.map(k => ({siparis: dpMik(k), paket: 0, sevk: 0}));
  dpPaketler(s).forEach(p => (p.kalem || []).forEach(x => { if (!r[x.i]) return; r[x.i].paket += dpSay(x.m); if (p.durum === 'sevk') r[x.i].sevk += dpSay(x.m); }));
  r.forEach(x => { x.kalan = Math.max(0, x.siparis - x.paket); });
  return r;
}
function dpOzet(s) {
  const h = dpHesap(s), top = h.reduce((a, x) => a + x.siparis, 0), pk = h.reduce((a, x) => a + Math.min(x.paket, x.siparis), 0), sv = h.reduce((a, x) => a + Math.min(x.sevk, x.siparis), 0);
  const ps = dpPaketler(s), n = d => ps.filter(p => p.durum === d).length;
  return {top, pk, sv, kalan: top - pk, tamSevk: top > 0 && sv >= top, hazirlaniyor: n('hazirlaniyor'), hazir: n('hazir'), onayli: n('onayli'), faturali: n('faturali'), sevk: n('sevk')};
}
// Sipariş durumunu paketlerle uyumlu tut (kısmi sevk / tam sevk / hazır)
function dpSenkron(s) {
  const h = dpHesap(s), o = dpOzet(s), d = s.durum || 'alindi', yeni = {...s};
  yeni.kalemler = (s.kalemler || []).map((k, i) => ({...k, geldi: !!h[i] && h[i].paket >= h[i].siparis}));
  let nd = d;
  if (o.tamSevk && ['alindi', 'tedarik', 'hazir', 'kismi'].includes(d)) nd = 'sevk';
  else if (o.sv > 0 && !o.tamSevk && ['alindi', 'tedarik', 'hazir'].includes(d)) nd = 'kismi';
  else if (o.top > 0 && o.kalan === 0 && ['alindi', 'tedarik'].includes(d)) nd = 'hazir';
  if (nd !== d) { yeni.durum = nd; yeni.gecmis = [...(s.gecmis || []), {t: new Date().toISOString(), d: nd, k: ME, n: 'Depo'}]; }
  return yeni;
}
const dpGorunur = s => !['iptal', 'teslim', 'fatura'].includes(s.durum || 'alindi');   // kalemi girilmemiş siparişler de görünür (taranmış belge vb.)
function dpAsama(s) {   // satırda gösterilecek baskın aşama
  const o = dpOzet(s);
  if (!o.top) return ['Kalem girilmedi', 'p-red'];
  if (o.tamSevk) return ['Tamamı sevk edildi', 'p-green'];
  if (o.faturali) return [DP.faturali[0] + (o.faturali > 1 ? ' ×' + o.faturali : ''), 'p-blue'];
  if (o.onayli) return [DP.onayli[0], 'p-blue'];
  if (o.hazir) return [DP.hazir[0], 'p-orange'];
  if (o.hazirlaniyor) return [DP.hazirlaniyor[0], 'p-amber'];
  if (o.sv) return ['Kısmi sevk · kalan bekliyor', 'p-orange'];
  return (s.gorenler || []).length ? ['Görüldü · hazırlanacak', 'p-gray'] : ['Yeni · görülmedi', 'p-red'];
}
const dpSiparisler = () => S.siparisler.filter(dpGorunur);
const dpSatirda = (s, f) => {
  const o = dpOzet(s);
  switch (f) {
    case 'hazirla': return o.kalan > 0;
    case 'onay': return o.hazir > 0 || o.hazirlaniyor > 0;
    case 'fatura': return o.onayli > 0;
    case 'sevke': return o.faturali > 0;
    case 'sevk': return o.sv > 0;
    case 'yeni': return !(s.gorenler || []).length;
    default: return !o.tamSevk;
  }
};

function dpSatir(s) {
  const [l, c] = dpAsama(s), o = dpOzet(s), yuzde = o.top ? Math.round(o.sv / o.top * 100) : 0;
  const gor = (s.gorenler || []).map(g => adi(g.k)).slice(0, 3).join(', ');
  const alt = [s.no, s.termin ? 'Termin ' + trT(s.termin) : '', `${o.pk}/${o.top} adet paketlendi`, o.sv ? `${o.sv} sevk` : '', gor ? '👁 ' + gor : ''].filter(Boolean).join(' · ');
  return `<button class="row" data-dps="${esc(s.id)}">${avatar(s.musteri)}
    <div class="mid"><div class="t">${esc(s.musteri || '—')}</div><div class="s">${esc(alt)}</div><div class="dp-bar" style="margin-top:6px"><i style="width:${yuzde}%"></i></div></div>
    <div class="end"><span class="pill ${c}">${esc(l)}</span></div></button>`;
}
function dpCiz() {
  const liste = $('#dp-list'); if (!liste) return;
  const q = ($('#dp-ara').value || '').toLocaleLowerCase('tr-TR'), tum = dpSiparisler();
  const chips = [['acik', 'Açık'], ['yeni', 'Yeni'], ['hazirla', 'Hazırlanacak'], ['onay', 'Onay bekleyen'], ['fatura', 'Fatura bekleyen'], ['sevke', 'Sevke hazır'], ['sevk', 'Sevk edilen']];
  $('#dp-chips').innerHTML = chips.map(([k, l]) => { const n = tum.filter(s => dpSatirda(s, k)).length; return `<button class="chip${dpFiltre === k ? ' on' : ''}" data-dpf="${k}">${l}${n ? ' · ' + n : ''}</button>`; }).join('');
  const l = tum.filter(s => dpSatirda(s, dpFiltre) && (!q || [s.musteri, s.no, s.musteriSipNo].join(' ').toLocaleLowerCase('tr-TR').includes(q)))
    .sort((a, b) => (a.termin || '9999').localeCompare(b.termin || '9999') || (b.tarih || '').localeCompare(a.tarih || ''));
  liste.innerHTML = l.length ? l.map(dpSatir).join('') : '<div class="empty">Bu aşamada sipariş yok</div>';
  const bek = tum.filter(s => dpSatirda(s, 'acik')).length;
  $('#dp-ozet').textContent = `${bek} sipariş depoda · ${tum.filter(s => dpSatirda(s, 'yeni')).length} yeni`;
  $$('[data-dp-say]').forEach(e => { e.textContent = bek; e.hidden = !bek || !dpYetki(); });
}

async function dpKaydet(s) { return kaydet('siparisler', dpSenkron(s)); }
const dpLog = (p, d, n) => { p.log = [...(p.log || []), {t: new Date().toISOString(), k: ME, d, n: n || ''}]; return p; };

function dpDetay(id) {
  let s = S.siparisler.find(x => x.id === id); if (!s) return;
  const yetki = dpYetki();
  // Siparişi gören kişiyi kaydet (depo yetkilileri açınca)
  if (yetki && ME && !(s.gorenler || []).some(g => g.k === ME)) dpKaydet({...s, gorenler: [...(s.gorenler || []), {k: ME, t: new Date().toISOString()}]});
  const guncel = () => S.siparisler.find(x => x.id === id) || s;
  s = guncel();
  const kal = s.kalemler || [], h = dpHesap(s), o = dpOzet(s), ps = (s.paketler || []);
  const kalemSatir = (k, i) => `<tr${yetki ? ` data-dpk="${i}" style="cursor:pointer"` : ''}><td><b>${esc(k.ref || k.aciklama || '—')}</b>${k.ref && k.aciklama ? `<small>${esc(k.aciklama)}</small>` : ''}${k.musteriKod || k.musteriAciklama ? `<small style="color:var(--fg3)">Müşteri yazımı: ${esc([k.musteriKod, k.musteriAciklama].filter(Boolean).join(' · '))}</small>` : ''}</td><td class="r">${h[i].siparis}</td><td class="r">${h[i].paket}</td><td class="r">${h[i].sevk}</td><td class="r"${h[i].kalan ? ' style="color:var(--orange);font-weight:700"' : ''}>${h[i].kalan}</td></tr>`;
  const paketKart = p => {
    const [l, c] = DP[p.durum] || DP.hazirlaniyor, son = p.durum !== 'iptal' && p.durum !== 'sevk';
    const ek = [p.faturaNo && 'Fatura ' + p.faturaNo, p.irsaliyeNo && 'İrsaliye ' + p.irsaliyeNo, p.kargo].filter(Boolean).join(' · ');
    const dugme = {hazirlaniyor: 'Hazırlandı', hazir: 'Onayla', onayli: 'Fatura kesildi', faturali: 'Sevke ver'}[p.durum];
    return `<div class="dp-pk${p.durum === 'iptal' ? ' iptal' : ''}"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b>Paket ${esc(p.no)}</b><span class="pill ${c}">${esc(l)}</span></div>
      <div class="s" style="margin-top:6px;font-size:13px">${(p.kalem || []).map(x => `${esc((kal[x.i] || {}).ref || (kal[x.i] || {}).aciklama || '?')} × ${esc(x.m)}`).join(' · ')}</div>
      ${ek ? `<div class="s" style="margin-top:4px;font-size:12.5px;color:var(--fg2)">${esc(ek)}</div>` : ''}
      <div class="dp-log">${(p.log || []).map(g => `<div>${esc(dpZaman(g.t))} · <b>${esc(adi(g.k))}</b> ${esc(DP_ISLEM[g.d] || g.d)}${g.n ? ' · ' + esc(g.n) : ''}</div>`).join('')}</div>
      ${yetki && son ? `<div style="display:flex;gap:8px;margin-top:10px">${dugme ? `<button class="btn btn-p btn-sm" data-dpadim="${esc(p.id)}" style="flex:1">${dugme}</button>` : ''}<button class="btn btn-s btn-sm" data-dpiptal="${esc(p.id)}">Paketi iptal et</button></div>` : ''}</div>`;
  };
  const sh = sheet('Depo · ' + (s.no || '') + ' · ' + (s.musteri || ''), `
    <div class="s" style="margin-bottom:8px;font-size:12.5px;color:var(--fg2)">${s.termin ? 'Termin <b>' + trT(s.termin) + '</b> · ' : ''}${o.pk}/${o.top} adet paketlendi · ${o.sv} adet sevk edildi${s.musteriSipNo ? ' · PO ' + esc(s.musteriSipNo) : ''}</div>
    <div class="s" style="margin-bottom:10px;font-size:12.5px;color:var(--fg2)">👁 Gören: ${(s.gorenler || []).length ? (s.gorenler || []).map(g => `<b>${esc(adi(g.k))}</b> (${esc(dpZaman(g.t))})`).join(', ') : '<span style="color:var(--red)">henüz kimse görmedi</span>'}</div>
    <div class="tscroll"><table class="kmat" style="width:100%"><thead><tr><th>Ürün</th><th class="r">Sipariş</th><th class="r">Paket</th><th class="r">Sevk</th><th class="r">Kalan</th></tr></thead><tbody>${kal.map(kalemSatir).join('')}</tbody></table></div>
    ${yetki ? `<button class="btn btn-s btn-block" id="dp-kalem" style="margin:${kal.length ? '0 0 4px' : '12px 0 4px'}">${ikon('plus')}Kalem ekle${kal.length ? '' : ' (siparişte henüz kalem yok)'}</button>` : ''}
    ${yetki && o.kalan > 0 ? `<button class="btn btn-p btn-block" id="dp-yeni" style="margin:12px 0 4px">${ikon('plus')}Yeni paket hazırla (kısmi sevk)</button>` : ''}
    ${!yetki ? '<p class="note" style="margin-top:10px">Bu siparişi görüntülüyorsun. Paket hazırlama, onay ve sevk için depo yetkisi gerekir (yönetici verir).</p>' : ''}
    <div class="vu-h" style="padding-left:0;margin-top:12px">Paketler <span>${ps.filter(p => p.durum !== 'iptal').length}</span></div>
    ${ps.length ? ps.map(paketKart).join('') : '<div class="empty" style="padding:14px">Henüz paket yok</div>'}`,
    [{label: 'Siparişi aç', onClick: () => { setTimeout(() => siparisDetay(id), 0); }}, {label: 'Kapat', cls: 'btn-p', onClick: () => {}}]);
  const yenile = () => { sh.kapat(); setTimeout(() => dpDetay(id), 0); };
  sh.el.querySelectorAll('[data-dpk]').forEach(tr => tr.onclick = () => { sh.kapat(); dpKalemForm(id, +tr.dataset.dpk); });
  const kb = sh.el.querySelector('#dp-kalem'); if (kb) kb.onclick = () => { sh.kapat(); dpKalemForm(id); };
  const yeni = sh.el.querySelector('#dp-yeni'); if (yeni) yeni.onclick = () => { sh.kapat(); dpPaketForm(id); };
  sh.el.querySelectorAll('[data-dpadim]').forEach(b => b.onclick = async () => {
    const c = guncel(), p = (c.paketler || []).find(x => x.id === b.dataset.dpadim); if (!p) return;
    const sonraki = DP_SIRA[DP_SIRA.indexOf(p.durum) + 1];
    const yaz = async ek => { const ps2 = (c.paketler || []).map(x => x.id === p.id ? dpLog({...x, ...ek, durum: sonraki}, sonraki, Object.values(ek).filter(Boolean).join(' · ')) : x); if (await dpKaydet({...c, paketler: ps2})) { toast('✅ ' + DP[sonraki][0]); yenile(); } };
    if (sonraki === 'faturali' || sonraki === 'sevk') {
      const alan = sonraki === 'faturali' ? [['faturaNo', 'Fatura no']] : [['irsaliyeNo', 'İrsaliye no'], ['kargo', 'Kargo / araç (isteğe bağlı)']];
      sh.kapat();
      sheet(DP[sonraki][0], `<div class="fg">${alan.map(([k, l]) => `<div class="f"><label>${l}</label><input class="inp" data-ek="${k}" value="${esc(p[k] || '')}"></div>`).join('')}</div>`,
        [{label: 'Vazgeç', onClick: () => { setTimeout(() => dpDetay(id), 0); }}, {label: 'Kaydet', cls: 'btn-p', onClick: ov => { const ek = {}; ov.querySelectorAll('[data-ek]').forEach(i => { ek[i.dataset.ek] = i.value.trim(); }); yaz(ek); }}]);
    } else yaz({});
  });
  sh.el.querySelectorAll('[data-dpiptal]').forEach(b => b.onclick = () => {
    sh.kapat();
    confirmSheet('Paket iptal edilsin mi?', 'Paketteki adetler tekrar "kalan"a döner.', async () => {
      const c = guncel(); await dpKaydet({...c, paketler: (c.paketler || []).map(x => x.id === b.dataset.dpiptal ? dpLog({...x, durum: 'iptal'}, 'iptal') : x)}); toast('Paket iptal edildi'); setTimeout(() => dpDetay(id), 0);
    });
  });
}

// Taranmış / okunamayan sipariş belgeleri için elle kalem ekleme
function dpKalemForm(id, idx) {
  const s = S.siparisler.find(x => x.id === id); if (!s) return;
  const k0 = idx != null ? (s.kalemler || [])[idx] : null, d = k0 || {birim: 'Adet', para: '₺', miktar: 1};
  const sh = sheet((k0 ? 'Kalemi düzenle · ' : 'Kalem ekle · ') + (s.no || ''), `<div class="fg">
    <div class="f"><label for="dk-ac">Ürün açıklaması *</label><input class="inp" id="dk-ac" value="${esc(d.aciklama || '')}" placeholder="ör. Florasan ampul 36W"></div>
    <div class="f"><label for="dk-ref">Ürün kodu (varsa)</label><input class="inp" id="dk-ref" value="${esc(d.ref || '')}"></div>
    <div class="fg2"><div class="f"><label for="dk-mik">Miktar *</label><input class="inp num" id="dk-mik" type="number" inputmode="decimal" min="0" step="any" value="${esc(d.miktar)}"></div>
      <div class="f"><label for="dk-bir">Birim</label><input class="inp" id="dk-bir" value="${esc(d.birim || 'Adet')}"></div></div>
    <div class="fg2"><div class="f"><label for="dk-fiyat">Birim fiyat</label><input class="inp num" id="dk-fiyat" type="number" inputmode="decimal" min="0" step="any" value="${esc(d.fiyat ?? '')}"></div>
      <div class="f"><label for="dk-para">Para</label><select class="sel" id="dk-para">${['₺', '€', '$'].map(p => `<option${p === (d.para || '₺') ? ' selected' : ''}>${p}</option>`).join('')}</select></div></div>
    ${k0 ? '<button class="btn btn-d btn-sm" id="dk-sil" style="justify-self:start">Kalemi sil</button>' : ''}</div>`,
    [{label: 'Vazgeç', onClick: () => { setTimeout(() => dpDetay(id), 0); }}, {label: k0 ? 'Kaydet' : 'Ekle', cls: 'btn-p', onClick: async ov => {
      const ac = v(ov, 'dk-ac'), mik = dpSay(v(ov, 'dk-mik')); if (!ac || mik <= 0) { toast('Açıklama ve miktar gerekli'); return false; }
      const c = S.siparisler.find(x => x.id === id) || s, f = v(ov, 'dk-fiyat');
      const k = {...(k0 || {}), ref: v(ov, 'dk-ref'), aciklama: ac, marka: (k0 || {}).marka || '', miktar: mik, birim: v(ov, 'dk-bir') || 'Adet', fiyat: f === '' ? '' : Number(f), para: ov.querySelector('#dk-para').value, iskonto: (k0 || {}).iskonto || 0, geldi: !!(k0 || {}).geldi};
      const kal = k0 ? (c.kalemler || []).map((x, i) => i === idx ? k : x) : [...(c.kalemler || []), k];
      if (await dpKaydet({...c, kalemler: kal})) { toast(k0 ? '✅ Kalem güncellendi' : '✅ Kalem eklendi'); setTimeout(() => dpDetay(id), 0); } else return false;
    }}]);
  const sil = sh.el.querySelector('#dk-sil');
  if (sil) sil.onclick = () => {
    const c = S.siparisler.find(x => x.id === id) || s;
    if (dpPaketler(c).length) { toast('Paketi olan siparişte kalem silinemez; önce paketleri iptal et'); return; }
    sh.kapat(); confirmSheet('Kalem silinsin mi?', (k0.aciklama || k0.ref || '') + ' siparişten çıkarılır.', async () => { await dpKaydet({...c, kalemler: (c.kalemler || []).filter((x, i) => i !== idx)}); toast('Kalem silindi'); setTimeout(() => dpDetay(id), 0); });
  };
}

function dpPaketForm(id) {
  const s = S.siparisler.find(x => x.id === id); if (!s) return;
  const kal = s.kalemler || [], h = dpHesap(s);
  const sh = sheet('Yeni paket · ' + (s.no || ''), `<p class="note">Bu pakette sevk edilecek kalemleri ve adetleri seç. Kalan adetler sonraki paketlerde hazırlanır.</p>
    <div class="rows">${kal.map((k, i) => h[i].kalan > 0 ? `<div class="row hz-row" style="padding:8px 4px;gap:10px"><input type="checkbox" data-pk="${i}" checked><div class="mid"><div class="t" style="white-space:normal">${esc(k.ref || k.aciklama)}</div><div class="s">${esc(k.ref ? k.aciklama || '' : '')} · kalan ${h[i].kalan} ${esc(k.birim || '')}</div></div><input class="inp num" data-pm="${i}" type="number" min="0" max="${h[i].kalan}" step="any" value="${h[i].kalan}" style="width:84px"></div>` : '').join('')}</div>`,
    [{label: 'Vazgeç', onClick: () => { setTimeout(() => dpDetay(id), 0); }}, {label: 'Paketi aç', cls: 'btn-p', onClick: async ov => {
      const c = S.siparisler.find(x => x.id === id) || s, hh = dpHesap(c), sec = [];
      ov.querySelectorAll('[data-pk]').forEach(cb => { if (!cb.checked) return; const i = +cb.dataset.pk, m = Math.min(dpSay(ov.querySelector(`[data-pm="${i}"]`).value), hh[i].kalan); if (m > 0) sec.push({i, m}); });
      if (!sec.length) { toast('En az bir kalem ve adet seç'); return false; }
      const no = String(Math.max(0, ...(c.paketler || []).map(p => +p.no || 0)) + 1);
      const p = dpLog({id: newId(), no, durum: 'hazirlaniyor', kalem: sec}, 'hazirlaniyor');
      if (await dpKaydet({...c, paketler: [...(c.paketler || []), p]})) { toast('✅ Paket ' + no + ' açıldı'); setTimeout(() => dpDetay(id), 0); } else return false;
    }}]);
  return sh;
}

$('#dp-ara').oninput = dpCiz;
$('#dp-chips').onclick = e => { const c = e.target.closest('[data-dpf]'); if (c) { dpFiltre = c.dataset.dpf; dpCiz(); } };
$('#dp-list').onclick = e => { const r = e.target.closest('[data-dps]'); if (r) dpDetay(r.dataset.dps); };
dpCiz();
