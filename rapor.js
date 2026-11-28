'use strict';
/* Ceylan Ofis — Satış & Teklif Raporu (herkes)
   Teklif sayısı/tutarı, siparişe dönüşüm, hazırlayan ve müşteri bazında dağılım, aylık seyir,
   takip edilmesi gereken (cevapsız) teklifler. Para birimleri ayrı toplanır; ₺ karşılığı girilen kurla hesaplanır. */
let rpDonem = lsGet('rp_donem', 'ay'), rpKisi = '';
const RP_DONEM = [['ay', 'Bu ay'], ['3ay', 'Son 3 ay'], ['yil', 'Bu yıl'], ['hepsi', 'Tümü']];
const rpKur = () => { const k = lsGet('rp_kur', null) || (typeof saKur === 'function' ? saKur() : {}); return {'₺': 1, '$': Number(k['$']) || 0, '€': Number(k['€']) || 0}; };
const rpPara = p => p === 'TL' || p === 'TRY' || !p ? '₺' : p === 'USD' ? '$' : p === 'EUR' ? '€' : p;
// Kalem listesinin para birimi bazında toplamı (iskonto düşülmüş)
function rpTop(kalemler) {
  const t = {};
  (kalemler || []).forEach(k => { const n = (Number(k.fiyat) || 0) * (Number(k.miktar) || 1) * (1 - (Number(k.iskonto) || 0) / 100); if (n > 0) { const p = rpPara(k.para); t[p] = (t[p] || 0) + n; } });
  return t;
}
const rpTopla = (a, b) => { Object.entries(b).forEach(([p, n]) => a[p] = (a[p] || 0) + n); return a; };
const rpTL = (t, kur) => Object.entries(t).reduce((s, [p, n]) => s + n * (kur[p] || 0), 0);
const rpYazi = t => Object.entries(t).sort((a, b) => b[1] - a[1]).map(([p, n]) => p + ' ' + Math.round(n).toLocaleString('tr-TR')).join(' + ') || '—';
function rpBas() {
  const d = new Date(), y = d.getFullYear(), m = d.getMonth();
  if (rpDonem === 'ay') return dstr(new Date(y, m, 1));
  if (rpDonem === '3ay') return dstr(new Date(y, m - 2, 1));
  if (rpDonem === 'yil') return y + '-01-01';
  return '0000';
}
// Teklif → sipariş eşleşmesi: siparişteki teklifId ya da teklif durumu onaylandı/tamamlandı
function rpVeri() {
  const bas = rpBas(), sipT = new Map();
  S.siparisler.filter(s => s.durum !== 'iptal').forEach(s => { if (s.teklifId) sipT.set(s.teklifId, s); });
  const tek = S.teklifler.filter(t => (t.tarih || '') >= bas && (!rpKisi || (t.by || '-') === rpKisi)).map(t => {
    const sip = sipT.get(t.id), dondu = !!sip || ['onaylandi', 'tamamlandi'].includes(t.durum);
    return {t, top: rpTop(t.kalemler), dondu, sip, red: t.durum === 'reddedildi'};
  });
  const sip = S.siparisler.filter(s => s.durum !== 'iptal' && (s.tarih || '') >= bas).map(s => ({s, top: rpTop(s.kalemler)}));
  return {tek, sip};
}
// ── Kârlılık (sadece yönetici): siparişe dönen tekliflerde satış net fiyatı ile alış fiyatı
// Alış: aynı ürünün en son satınalma siparişi fiyatı, yoksa tedarikçi tekliflerindeki en düşük fiyat (aynı para birimi)
const rpRef = r => String(r || '').toUpperCase().replace(/[\s\-./_,]/g, '');
function rpAlisHarita() {
  const h = new Map(), put = (k, o) => { const key = rpRef(k.ref); if (!key || !(Number(k.fiyat) > 0)) return; const p = rpPara(k.para), a = h.get(key + p);
    if (!a || (o.sip && (!a.sip || (o.tarih || '') > (a.tarih || ''))) || (!o.sip && !a.sip && Number(k.fiyat) < a.fiyat)) h.set(key + p, {fiyat: Number(k.fiyat), tarih: o.tarih, sip: o.sip, kaynak: o.kaynak}); };
  (S.sa_siparisler || []).filter(x => x.durum !== 'iptal').forEach(x => (x.kalemler || []).forEach(k => put(k, {sip: true, tarih: x.tarih, kaynak: x.tedarikci})));
  (S.sa_teklifler || []).forEach(x => put(x, {sip: false, tarih: x.tarih, kaynak: x.tedarikci}));
  return h;
}
function rpKarlilik(tek) {
  const h = rpAlisHarita(), sat = {}, al = {}, satirlar = []; let say = 0, top = 0;
  tek.filter(x => x.dondu).forEach(x => (x.t.kalemler || []).forEach(k => {
    const net = (Number(k.fiyat) || 0) * (1 - (Number(k.iskonto) || 0) / 100), mk = Number(k.miktar) || 1, p = rpPara(k.para); if (!(net > 0)) return; top++;
    const a = h.get(rpRef(k.ref) + p); if (!a) return; say++;
    sat[p] = (sat[p] || 0) + net * mk; al[p] = (al[p] || 0) + a.fiyat * mk;
    satirlar.push({ref: k.ref || k.aciklama, musteri: x.t.musteri, p, net, alis: a.fiyat, mk, marj: (net - a.fiyat) / net * 100, kaynak: a.kaynak});
  }));
  return {sat, al, satirlar, say, top};
}
function raporCiz() {
  const el = $('#rp-body'); if (!el) return;
  const kur = rpKur(), {tek, sip} = rpVeri();
  const tTop = tek.reduce((a, x) => rpTopla(a, x.top), {}), dTop = tek.filter(x => x.dondu).reduce((a, x) => rpTopla(a, x.top), {}), sTop = sip.reduce((a, x) => rpTopla(a, x.top), {});
  const dondu = tek.filter(x => x.dondu).length, red = tek.filter(x => x.red).length;
  const kurVar = kur['$'] > 0 && kur['€'] > 0, para = t => kurVar ? kisa(rpTL(t, kur)) : rpYazi(t);
  // Hazırlayan bazında
  const kisi = new Map();
  tek.forEach(x => { const k = x.t.by || '-', o = kisi.get(k) || {n: 0, d: 0, top: {}}; o.n++; if (x.dondu) o.d++; rpTopla(o.top, x.top); kisi.set(k, o); });
  // Müşteri bazında
  const mus = new Map();
  tek.forEach(x => { const k = (x.t.musteri || '—').trim().toLocaleUpperCase('tr-TR'), o = mus.get(k) || {ad: x.t.musteri || '—', n: 0, d: 0, top: {}}; o.n++; if (x.dondu) o.d++; rpTopla(o.top, x.top); mus.set(k, o); });
  // Aylık
  const ay = new Map();
  tek.forEach(x => { const k = (x.t.tarih || '').slice(0, 7); if (!k) return; const o = ay.get(k) || {n: 0, d: 0, top: {}}; o.n++; if (x.dondu) o.d++; rpTopla(o.top, x.top); ay.set(k, o); });
  // Takip: gönderilmiş, 5+ gün geçmiş, siparişe dönmemiş, reddedilmemiş
  const sinir = dstr(new Date(Date.now() - 5 * 864e5));
  const takip = tek.filter(x => !x.dondu && !x.red && ACIK.includes(x.t.durum || 'bekliyor') && (x.t.tarih || '') <= sinir).sort((a, b) => rpTL(b.top, kur.$ ? kur : {'₺': 1, '$': 40, '€': 45}) - rpTL(a.top, kur.$ ? kur : {'₺': 1, '$': 40, '€': 45})).slice(0, 15);
  const kisiOpts = [...new Set(S.teklifler.map(t => t.by || '-'))];
  el.innerHTML = `
    <div class="chips" style="margin-bottom:10px">${RP_DONEM.map(([k, l]) => `<button class="chip${rpDonem === k ? ' on' : ''}" data-rpd="${k}">${l}</button>`).join('')}
      <select class="sel" id="rp-kisi" style="height:32px;width:auto"><option value="">Herkes</option>${kisiOpts.map(k => `<option value="${esc(k)}"${rpKisi === k ? ' selected' : ''}>${esc(k === '-' ? 'Uygulama öncesi' : adi(k))}</option>`).join('')}</select></div>
    <div class="note" style="margin-bottom:12px">Kur (₺ karşılığı için): $ <input class="inp num" id="rp-usd" type="number" step="0.01" inputmode="decimal" value="${kur['$'] || ''}" style="width:80px;height:30px;display:inline-block"> € <input class="inp num" id="rp-eur" type="number" step="0.01" inputmode="decimal" value="${kur['€'] || ''}" style="width:80px;height:30px;display:inline-block">${kurVar ? '' : ' <span style="color:var(--amber)">Kur girilmezse tutarlar para birimine göre ayrı yazılır</span>'}</div>
    <div class="tiles">
      <div class="tile"><div class="lbl">Verilen teklif</div><div class="val num">${tek.length}</div><div class="hint">${esc(para(tTop))}</div></div>
      <div class="tile"><div class="lbl">Siparişe dönen</div><div class="val num" style="color:var(--green)">${dondu}</div><div class="hint">${esc(para(dTop))}</div></div>
      <div class="tile"><div class="lbl">Dönüşüm oranı</div><div class="val num">${tek.length ? '%' + Math.round(dondu / tek.length * 100) : '—'}</div><div class="hint">${red} red · ${tek.length - dondu - red} cevap bekliyor</div></div>
      <div class="tile"><div class="lbl">Gelen sipariş</div><div class="val num">${sip.length}</div><div class="hint">${esc(para(sTop))}</div></div>
    </div>
    <div class="grid2">
      <div class="card"><div class="card-h"><h3>Hazırlayana göre</h3></div><div class="rows">${[...kisi.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, o]) => `<div class="row" style="padding:8px 4px">${avatar(k === '-' ? '?' : adi(k))}<div class="mid"><div class="t">${esc(k === '-' ? 'Uygulama öncesi' : adi(k))}</div><div class="s">${o.n} teklif · ${o.d} sipariş · %${Math.round(o.d / o.n * 100)} dönüşüm</div></div><div class="end"><b class="num" style="font-size:12.5px">${esc(para(o.top))}</b></div></div>`).join('') || '<div class="empty">Veri yok</div>'}</div></div>
      <div class="card"><div class="card-h"><h3>Aylık teklif</h3></div><div class="card-b" id="rp-ay"></div></div>
      <div class="card"><div class="card-h"><h3>En çok teklif verilen müşteriler</h3></div><div class="rows">${[...mus.values()].sort((a, b) => (kurVar ? rpTL(b.top, kur) - rpTL(a.top, kur) : b.n - a.n)).slice(0, 12).map(o => `<div class="row" style="padding:8px 4px"><div class="mid"><div class="t">${esc(o.ad)}</div><div class="s">${o.n} teklif · ${o.d} sipariş</div></div><div class="end"><b class="num" style="font-size:12.5px">${esc(para(o.top))}</b></div></div>`).join('') || '<div class="empty">Veri yok</div>'}</div></div>
      ${IS_OWNER ? (() => { const k = rpKarlilik(tek), pl = Object.keys(k.sat);
        return `<div class="card"><div class="card-h"><h3>Kârlılık 🔒</h3><span class="s" style="font-size:11.5px;color:var(--fg3)">${k.say}/${k.top} kalemin alış fiyatı biliniyor</span></div><div class="card-b">${pl.length ? pl.map(p => { const m = (k.sat[p] - k.al[p]) / k.sat[p] * 100; return `<div style="display:flex;justify-content:space-between;padding:4px 0"><span>${p} satış ${Math.round(k.sat[p]).toLocaleString('tr-TR')} · alış ${Math.round(k.al[p]).toLocaleString('tr-TR')}</span><b style="color:${m < 10 ? 'var(--red)' : 'var(--green)'}">%${m.toFixed(1)} marj</b></div>`; }).join('') + `<div class="vu-h" style="padding-left:0">En düşük marjlı kalemler</div>` + k.satirlar.sort((a, b) => a.marj - b.marj).slice(0, 8).map(r => `<div class="row" style="padding:6px 0"><div class="mid"><div class="t">${esc(r.ref)}</div><div class="s">${esc(r.musteri || '')} · satış ${r.p}${r.net.toFixed(2)} · alış ${r.p}${r.alis.toFixed(2)} (${esc(r.kaynak || '')})</div></div><div class="end"><b style="color:${r.marj < 10 ? 'var(--red)' : 'var(--fg)'}">%${r.marj.toFixed(0)}</b></div></div>`).join('') : '<div class="empty" style="padding:10px 0">Alış fiyatı eşleşen kalem yok. Satınalma\'da tedarikçi fiyatı/alım girildikçe dolar.</div>'}</div></div>`; })() : ''}
      <div class="card"><div class="card-h"><h3>Takip edilecek teklifler</h3><span class="s" style="font-size:11.5px;color:var(--fg3)">5+ gün, cevap yok</span></div><div class="rows">${takip.map(x => `<button class="row" data-teklif="${esc(x.t.id)}" style="padding:8px 4px"><div class="mid"><div class="t">${esc(x.t.musteri || '—')}</div><div class="s">No ${esc(x.t.no || '—')} · ${trT(x.t.tarih)} · ${Math.round((Date.now() - new Date(x.t.tarih + 'T12:00:00')) / 864e5)} gün · ${esc(adi(x.t.by))}</div></div><div class="end"><b class="num" style="font-size:12.5px">${esc(rpYazi(x.top))}</b></div></button>`).join('') || '<div class="empty">Bekleyen teklif yok 👍</div>'}</div></div>
    </div>`;
  barlar($('#rp-ay'), [...ay.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12).map(([k, o]) => [k.slice(5) + '.' + k.slice(2, 4), kurVar ? rpTL(o.top, kur) : o.n, (kurVar ? kisa(rpTL(o.top, kur)) : o.n + ' teklif') + ' · ' + o.d + ' sip.']));
}
document.addEventListener('click', e => {
  const d = e.target.closest('[data-rpd]'); if (d) { rpDonem = d.dataset.rpd; lsSet('rp_donem', rpDonem); raporCiz(); }
  if (e.target.id === 'rp-excel') rpExcel();
});
document.addEventListener('change', e => {
  if (e.target.id === 'rp-kisi') { rpKisi = e.target.value; raporCiz(); }
  if (e.target.id === 'rp-usd' || e.target.id === 'rp-eur') { lsSet('rp_kur', {'$': Number($('#rp-usd').value) || 0, '€': Number($('#rp-eur').value) || 0}); raporCiz(); }
});
async function rpExcel() {
  await syXlsx();
  const kur = rpKur(), {tek} = rpVeri();
  const rows = tek.map(x => ({'Teklif No': x.t.no || '', 'Tarih': x.t.tarih || '', 'Müşteri': x.t.musteri || '', 'Hazırlayan': adi(x.t.by), 'Kalem': (x.t.kalemler || []).length, 'Tutar': rpYazi(x.top), '₺ Karşılığı': kur['$'] && kur['€'] ? Math.round(rpTL(x.top, kur)) : '', 'Durum': (DURUM[x.t.durum] || DURUM.bekliyor)[0], 'Siparişe döndü': x.dondu ? 'Evet' : '', 'Sipariş No': x.sip ? x.sip.no : ''}));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Teklifler');
  TC.indir(new Blob([XLSX.write(wb, {bookType: 'xlsx', type: 'array'})], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}), `Satis_Teklif_Raporu_${bugun()}.xlsx`); toast('⬇ Rapor indirildi');
}
