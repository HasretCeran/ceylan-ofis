'use strict';
/* Ceylan Ofis — Sipariş takibi: tekliften ya da müşteri sipariş belgesinden sipariş açılır, durumu adım adım izlenir. */
const SDURUM = {
  alindi: ['Sipariş alındı', 'p-blue'], tedarik: ['Tedarikte', 'p-amber'], hazir: ['Hazır', 'p-orange'],
  sevk: ['Sevk edildi', 'p-blue'], teslim: ['Teslim edildi', 'p-green'], fatura: ['Faturalandı', 'p-green'], iptal: ['İptal', 'p-red'],
};
const SADIM = ['alindi', 'tedarik', 'hazir', 'sevk', 'teslim', 'fatura'];
const SACIK = ['alindi', 'tedarik', 'hazir', 'sevk'];
let spFiltre = 'acik';

const spAcik = s => SACIK.includes(s.durum || 'alindi');
const spGecikti = s => spAcik(s) && s.termin && s.termin < bugun();
function sipNo() {
  const y = new Date().getFullYear(), re = new RegExp('^SIP-' + y + '-(\\d+)$');
  const max = S.siparisler.reduce((m, s) => { const x = re.exec(s.no || ''); return x ? Math.max(m, +x[1]) : m; }, 0);
  return 'SIP-' + y + '-' + String(max + 1).padStart(3, '0');
}
function spSatir(s) {
  const [l, c] = spGecikti(s) ? ['Termin geçti', 'p-red'] : (SDURUM[s.durum] || SDURUM.alindi);
  const k = Array.isArray(s.kalemler) ? s.kalemler : [], gel = k.filter(x => x.geldi).length;
  const alt = [s.no, s.musteriSipNo ? 'PO ' + s.musteriSipNo : '', s.termin ? 'Termin ' + trT(s.termin) : '', k.length ? `${gel}/${k.length} kalem hazır` : '', (s.dosyalar || []).length ? '📎' + s.dosyalar.length : ''].filter(Boolean).join(' · ');
  return `<button class="row" data-sp="${esc(s.id)}">${avatar(s.musteri)}
    <div class="mid"><div class="t">${s.mailUrl ? '📧 ' : ''}${esc(s.musteri || '—')}</div><div class="s">${esc(alt)}</div></div>
    <div class="end">${s.tutar ? `<b class="num" style="font-size:12.5px">${esc(s.tutar)}</b>` : ''}<span class="pill ${c}" style="margin-top:4px">${l}</span></div></button>`;
}
function siparislerCiz() {
  if (!$('#sp-list')) return;
  const q = ($('#sp-ara').value || '').toLocaleLowerCase('tr-TR');
  const chips = [['acik', 'Açık'], ['gecikti', 'Termin geçen'], ...Object.entries(SDURUM).map(([k, [l]]) => [k, l]), ['', 'Tümü']];
  $('#sp-chips').innerHTML = chips.map(([k, l]) => `<button class="chip${spFiltre === k ? ' on' : ''}" data-spf="${k}">${l}</button>`).join('');
  const l = S.siparisler.filter(s => (spFiltre === 'acik' ? spAcik(s) : spFiltre === 'gecikti' ? spGecikti(s) : !spFiltre || (s.durum || 'alindi') === spFiltre)
    && (!q || [s.musteri, s.no, s.musteriSipNo, s.teklifNo, s.not].join(' ').toLocaleLowerCase('tr-TR').includes(q)))
    .sort((a, b) => (spGecikti(b) - spGecikti(a)) || (a.termin || '9999').localeCompare(b.termin || '9999') || (b.tarih || '').localeCompare(a.tarih || ''));
  $('#sp-list').innerHTML = l.length ? l.map(spSatir).join('') : '<div class="empty">Sipariş yok</div>';
  const acik = S.siparisler.filter(spAcik).length, gec = S.siparisler.filter(spGecikti).length;
  $('#sp-ozet').textContent = `${acik} açık sipariş${gec ? ' · ' + gec + ' tanesinin termini geçti' : ''}`;
  $$('[data-sp-acik]').forEach(e => { e.textContent = acik; e.hidden = !acik; });
  // Ana sayfa: sipariş takibi kartı
  const dk = $('#d-sip');
  if (dk) {
    const ac = S.siparisler.filter(spAcik).sort((a, b) => (spGecikti(b) - spGecikti(a)) || (a.termin || '9999').localeCompare(b.termin || '9999'));
    dk.hidden = !ac.length;
    dk.innerHTML = ac.length ? `<div class="card" style="margin-bottom:14px"><div class="card-h"><h3>Sipariş takibi</h3><button class="link-btn" data-go="siparisler">Tümü →</button></div>
      <div class="chips" style="padding:12px 16px 4px;margin-bottom:0">${SACIK.map(d => { const n = ac.filter(x => (x.durum || 'alindi') === d).length; return n ? `<span class="chip">${SDURUM[d][0]} · ${n}</span>` : ''; }).join('')}${gec ? `<span class="chip" style="color:var(--red);border-color:var(--red)">Termin geçti · ${gec}</span>` : ''}</div>
      <div class="rows">${ac.slice(0, 4).map(spSatir).join('')}</div></div>` : '';
  }
}

// Dosyaları depoya yükle (sipariş formu, onay, irsaliye fotoğrafı…)
async function spDosyaYukle(id, files) {
  const out = [];
  if (DEMO) { toast('Demo modunda dosya saklanmaz'); return out; }
  for (const f of files) {
    const yol = `siparis/${id}/${Date.now()}-${f.name.replace(/[^\w.\-]+/g, '_')}`;
    const {error} = await sb.storage.from('belgeler').upload(yol, f, {contentType: f.type || undefined});
    if (error) { toast('⚠ ' + f.name + ' yüklenemedi: ' + error.message); continue; }
    out.push({ad: f.name, yol, tip: f.type || '', at: new Date().toISOString()});
  }
  return out;
}
async function spDosyaAc(f) {
  const {data, error} = await sb.storage.from('belgeler').createSignedUrl(f.yol, 900);
  if (error) { toast('⚠ Dosya açılamadı'); return; }
  const tip = f.tip || (/\.pdf$/i.test(f.ad) ? 'application/pdf' : /\.(jpe?g|png|webp|heic|gif)$/i.test(f.ad) ? 'image/jpeg' : '');
  belgeOnizle({url: data.signedUrl, tip}, f.ad, [{label: 'İndir / aç', cls: 'btn-p', onClick: () => window.open(data.signedUrl, '_blank')}]);
}

// ── Sipariş belgesini oku: PO no, tarih, termin, tutar, müşteri, kalemler
const TRAY = {ocak: 1, şubat: 2, subat: 2, mart: 3, nisan: 4, mayıs: 5, mayis: 5, haziran: 6, temmuz: 7, ağustos: 8, agustos: 8, eylül: 9, eylul: 9, ekim: 10, kasım: 11, kasim: 11, aralık: 12, aralik: 12};
function spTarih(t) {
  let m = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(t); if (m) { let y = +m[3]; if (y < 100) y += 2000; const ay = +m[2], g = +m[1]; if (ay >= 1 && ay <= 12 && g >= 1 && g <= 31) return `${y}-${String(ay).padStart(2, '0')}-${String(g).padStart(2, '0')}`; }
  m = /(\d{4})-(\d{2})-(\d{2})/.exec(t); if (m) return m[0];
  m = /(\d{1,2})\s+([a-zçğıöşü]+)\s+(\d{4})/i.exec(t); if (m && TRAY[nrmTR(m[2])]) return `${m[3]}-${String(TRAY[nrmTR(m[2])]).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`;
  return '';
}
const spSayi = x => { x = String(x).replace(/\s/g, ''); if (/,\d{1,2}$/.test(x)) x = x.replace(/\./g, '').replace(',', '.'); else if (/\.\d{1,2}$/.test(x)) x = x.replace(/,/g, ''); else x = x.replace(/[.,]/g, ''); return Number(x) || 0; };
async function spBelgeOku(files, durum = () => {}) {
  let satir = [];
  for (const f of files) { try { durum(f.name + ' okunuyor…'); satir.push(...(await hzMetin(f, durum))); } catch (e) { durum('⚠ ' + f.name + ': ' + e.message); } }
  satir = satir.map(x => String(x || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const tum = satir.join('\n'), o = {};
  let m = /(?:sipari[şs]\s*(?:no|numaras[ıi]|n[o°])|s[iı]p\.?\s*no|po\s*(?:no|number|#)|purchase\s*order(?:\s*no)?|order\s*(?:no|number)|belge\s*no|fi[şs]\s*no)\s*[:#.]?\s*([A-Z0-9][A-Z0-9\-\/.]{2,24})/i.exec(tum);
  if (m) o.po = m[1].replace(/[.,]$/, '');
  else if ((m = /\b(45\d{8})\b/.exec(tum))) o.po = m[1];
  for (const l of satir) {
    if (!o.termin && /termin|teslim\s*tarih|teslimat\s*tarih|delivery\s*date|istenen\s*teslim|sevk\s*tarih/i.test(l)) o.termin = spTarih(l.split(/termin|teslim\s*tarihi?|teslimat\s*tarihi?|delivery\s*date|istenen\s*teslim|sevk\s*tarihi?/i).pop()) || spTarih(l);
    if (!o.tarih && /sipari[şs]\s*tarih|belge\s*tarih|order\s*date|po\s*date|^tarih|\btarih\s*[:.]/i.test(l)) o.tarih = spTarih(l);
  }
  if (!o.tarih) { const t = spTarih(tum); if (t) o.tarih = t; }
  const tut = satir.filter(l => /genel\s*toplam|toplam\s*tutar|ödenecek|odenecek|grand\s*total|total\s*amount|net\s*toplam|toplam\s*\(?(tl|eur|usd)|^toplam/i.test(l));
  for (const l of tut.reverse()) {
    const n = [...l.matchAll(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})|\d+(?:[.,]\d{1,2})?)/g)].map(x => x[1]).pop();
    if (n && spSayi(n) > 0) { const pb = /€|eur/i.test(l) ? '€' : /\$|usd/i.test(l) ? '$' : '₺'; o.tutar = pb + ' ' + spSayi(n).toLocaleString('tr-TR', {minimumFractionDigits: 2, maximumFractionDigits: 2}); break; }
  }
  const nt = nrmTR(tum);
  let en = null, enL = 0;
  for (const c of S.musteri) {
    const ad = nrmTR(c.firma || ''); if (ad.length < 4 || /ceylan/.test(ad)) continue;
    const parca = ad.replace(/\b(san|tic|ve|ltd|şti|aş|anonim|limited|şirketi|sanayi|ticaret|sanayii|ith|ihr|paz|ins)\b\.?/g, ' ').replace(/[^a-zçğıöşü0-9 ]/g, ' ').trim().split(/\s+/).filter(w => w.length > 1).slice(0, 2).join(' ');
    if (parca.length >= 4 && nt.includes(parca) && parca.length > enL) { en = c; enL = parca.length; }
  }
  if (en) o.musteri = en.firma;
  try { const r = await hzOku(files, '', durum); o.kalemler = r.sonuc.filter(x => x.u || x.ref).map(x => ({ref: x.u ? x.u.ref : x.ref || '', aciklama: x.u ? x.u.aciklama || '' : x.aciklama || '', marka: x.u ? x.u.marka || '' : x.marka || '', miktar: Number(x.miktar) || 1, birim: x.birim || 'Adet', fiyat: x.u ? x.u.fiyat || '' : '', para: x.u ? x.u.para || '€' : '€', geldi: false})); } catch (e) { o.kalemler = []; }
  if (o.musteri) {
    const kod = new Set((o.kalemler || []).map(k => refN(k.ref)).filter(Boolean)), ilk = nrmTR(o.musteri).split(' ')[0];
    let bt = null, bs = -1;
    S.teklifler.filter(t => nrmTR(t.musteri || '').split(' ')[0] === ilk).forEach(t => { const sk = (t.kalemler || []).filter(k => kod.has(refN(k.ref))).length; if (sk > bs || (sk === bs && bt && (t.tarih || '') > (bt.tarih || ''))) { bs = sk; bt = t; } });
    if (bt) o.teklif = bt;
  }
  return o;
}

function siparisForm(s = {}, teklif = null) {
  const yeni = !s.id;
  if (teklif) s = {musteri: teklif.musteri, teklifId: teklif.id, teklifNo: teklif.no, tutar: teklif.tutar, kalemler: (teklif.kalemler || []).map(k => ({...k, geldi: false})), ...s};
  const tk = S.teklifler.filter(t => !s.musteri || (t.musteri || '').toLocaleLowerCase('tr-TR') === (s.musteri || '').toLocaleLowerCase('tr-TR')).slice(0, 60);
  const sh = sheet(yeni ? 'Yeni sipariş' : 'Siparişi düzenle', `<div class="fg">
    <label class="hz-btn" style="cursor:pointer;margin:0">${ikon('bolt')}<span><b>Sipariş belgesini yükle</b>Fotoğraf, PDF ya da Excel — sipariş no, tarih, tutar, müşteri ve kalemleri okur</span><input type="file" id="sp-dosya" multiple accept="image/*,.pdf,.xlsx,.xls,.csv,.txt" hidden></label>
    <div id="sp-oku"></div>
    <div class="f"><label for="sp-musteri">Müşteri *</label><input class="inp" id="sp-musteri" list="firma-list" value="${esc(s.musteri || '')}"></div>
    <div class="fg2"><div class="f"><label for="sp-po">Müşteri sipariş no (PO)</label><input class="inp" id="sp-po" value="${esc(s.musteriSipNo || '')}"></div>
      <div class="f"><label for="sp-tarih">Sipariş tarihi</label><input class="inp" id="sp-tarih" type="date" value="${esc(s.tarih || bugun())}"></div></div>
    <div class="fg2"><div class="f"><label for="sp-termin">Termin (teslim)</label><input class="inp" id="sp-termin" type="date" value="${esc(s.termin || '')}"></div>
      <div class="f"><label for="sp-tutar">Tutar</label><input class="inp" id="sp-tutar" value="${esc(s.tutar || '')}" placeholder="ör. € 12.400"></div></div>
    <div class="f"><label for="sp-teklif">Bağlı teklif</label><select class="sel" id="sp-teklif"><option value="">— yok —</option>${tk.map(t => `<option value="${esc(t.id)}"${t.id === s.teklifId ? ' selected' : ''}>${esc((t.no || '') + ' · ' + (t.musteri || '') + ' · ' + trT(t.tarih))}</option>`).join('')}</select></div>
    <div class="f"><label for="sp-not">Not</label><textarea class="inp" id="sp-not" rows="2">${esc(s.not || '')}</textarea></div>
    <div class="fg2"><div class="f"><label for="sp-irs">İrsaliye no</label><input class="inp" id="sp-irs" value="${esc(s.irsaliyeNo || '')}"></div>
      <div class="f"><label for="sp-fat">Fatura no</label><input class="inp" id="sp-fat" value="${esc(s.faturaNo || '')}"></div></div>
    <div class="f"><label for="sp-kargo">Kargo / sevk takip</label><input class="inp" id="sp-kargo" value="${esc(s.kargo || '')}" placeholder="Kargo firması + takip no ya da araç plakası"></div>
  </div>`, [{label: 'Vazgeç', onClick: () => {}}, {label: 'Kaydet', cls: 'btn-p', onClick: async ov => {
    const mus = v(ov, 'sp-musteri'); if (!mus) { toast('Müşteri adı gerekli'); return false; }
    const id = s.id || newId(), tid = v(ov, 'sp-teklif'), t = S.teklifler.find(x => x.id === tid);
    const files = secili;
    const dos = files.length ? await spDosyaYukle(id, files) : [];
    const o = {...s, id, no: s.no || sipNo(), musteri: mus, musteriSipNo: v(ov, 'sp-po'), tarih: v(ov, 'sp-tarih') || bugun(), termin: v(ov, 'sp-termin'), tutar: v(ov, 'sp-tutar') || (t && t.tutar) || '', not: v(ov, 'sp-not'),
      teklifId: tid || '', teklifNo: t ? t.no : '', durum: s.durum || 'alindi', dosyalar: [...(s.dosyalar || []), ...dos],
      irsaliyeNo: v(ov, 'sp-irs'), faturaNo: v(ov, 'sp-fat'), kargo: v(ov, 'sp-kargo'),
      kalemler: (s.kalemler && s.kalemler.length) ? s.kalemler : okunan.length ? okunan : (t && Array.isArray(t.kalemler) ? t.kalemler.map(k => ({...k, geldi: false})) : []),
      gecmis: s.gecmis || [{t: new Date().toISOString(), d: 'alindi', k: ME}]};
    const ok = await kaydet('siparisler', o);
    if (ok && t && !['onaylandi', 'tamamlandi'].includes(t.durum)) await kaydet('teklifler', {...t, durum: 'onaylandi'});
    if (ok) { toast('✅ Sipariş kaydedildi' + (dos.length ? ' · ' + dos.length + ' dosya' : '')); if (aktifSayfa !== 'siparisler') git('siparisler'); }
  }}]);
  let secili = [], okunan = [];
  const el = sh.el, ou = el.querySelector('#sp-oku');
  el.querySelector('#sp-dosya').onchange = async e => {
    secili = [...secili, ...e.target.files]; e.target.value = '';
    const dosyaSat = () => secili.map((f, i) => `<div class="row" style="padding:6px 0"><div class="mid"><div class="t" style="font-size:13px">${/image/.test(f.type) ? '🖼' : '📄'} ${esc(f.name)}</div></div><div class="end" style="flex-direction:row;gap:6px"><button class="btn btn-s btn-sm" data-spon="${i}" type="button">Önizle</button><button class="btn btn-s btn-sm" data-spcik="${i}" type="button">✕</button></div></div>`).join('');
    const bagla = () => { ou.querySelectorAll('[data-spon]').forEach(b => b.onclick = () => belgeOnizle(secili[+b.dataset.spon], secili[+b.dataset.spon].name)); ou.querySelectorAll('[data-spcik]').forEach(b => b.onclick = () => { secili.splice(+b.dataset.spcik, 1); ou.querySelector('.sp-dl').innerHTML = dosyaSat(); bagla(); }); };
    ou.innerHTML = `<div class="sp-dl">${dosyaSat()}</div><div class="note" id="sp-okd">Belge okunuyor…</div>`; bagla();
    const d = await spBelgeOku(secili, t => { const x = ou.querySelector('#sp-okd'); if (x) x.textContent = t; });
    const set = (id, val) => { const i = el.querySelector('#' + id); if (i && val && !i.value.trim()) { i.value = val; i.classList.add('okundu'); } };
    set('sp-musteri', d.musteri); set('sp-po', d.po); set('sp-tutar', d.tutar); set('sp-termin', d.termin);
    if (d.tarih && !s.id) { const i = el.querySelector('#sp-tarih'); i.value = d.tarih; i.classList.add('okundu'); }
    const sel = el.querySelector('#sp-teklif');
    if (d.teklif && !sel.value) { if (![...sel.options].some(o => o.value === d.teklif.id)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(d.teklif.id)}">${esc((d.teklif.no || '') + ' · ' + (d.teklif.musteri || '') + ' · ' + trT(d.teklif.tarih))}</option>`); sel.value = d.teklif.id; sel.classList.add('okundu'); }
    okunan = d.kalemler || [];
    const bul = [d.musteri && 'müşteri', d.po && 'sipariş no', d.tarih && 'tarih', d.termin && 'termin', d.tutar && 'tutar', d.teklif && 'teklif', okunan.length && okunan.length + ' kalem'].filter(Boolean);
    ou.querySelector('#sp-okd').innerHTML = bul.length ? `✓ Okundu: <b>${bul.join(', ')}</b> — yeşil alanları kontrol et` : 'Belgeden bilgi okunamadı, alanları elle doldur. Belge yine de siparişe eklenecek.';
  };
  return sh;
}

function siparisDetay(id) {
  const s = S.siparisler.find(x => x.id === id); if (!s) return;
  const k = Array.isArray(s.kalemler) ? s.kalemler : [], d = s.durum || 'alindi';
  const sh = sheet((s.no || 'Sipariş') + ' · ' + (s.musteri || ''), `
    <div class="sp-adim">${SADIM.map((x, i) => `<button class="sp-a${x === d ? ' on' : ''}${SADIM.indexOf(d) > i ? ' ok' : ''}" data-sd="${x}"><i></i><span>${SDURUM[x][0]}</span></button>`).join('')}</div>
    <div class="rows" style="margin:6px -4px 10px">
      <div class="row" style="padding:8px 4px"><div class="mid"><div class="s">Müşteri sipariş no</div><div class="t">${esc(s.musteriSipNo || '—')}</div></div><div class="end"><div class="s">Tarih</div><b>${trT(s.tarih)}</b></div></div>
      <div class="row" style="padding:8px 4px"><div class="mid"><div class="s">Termin</div><div class="t" style="${spGecikti(s) ? 'color:var(--red)' : ''}">${s.termin ? trT(s.termin) + (spAcik(s) ? ' · ' + gunYazi(s.termin) : '') : '—'}</div></div><div class="end"><div class="s">Tutar</div><b class="num">${esc(s.tutar || '—')}</b></div></div>
      ${s.teklifNo || s.teklifId ? `<div class="row" style="padding:8px 4px"><div class="mid"><div class="s">Bağlı teklif</div><div class="t">${esc(s.teklifNo || '—')}</div></div>${s.teklifId ? `<div class="end" style="flex-direction:row;gap:6px"><button class="btn btn-s btn-sm" data-spo>Önizle</button><button class="btn btn-s btn-sm" data-spt>Teklif</button></div>` : ''}</div>` : ''}
      ${mailSatir(s)}
      ${s.irsaliyeNo || s.faturaNo || s.kargo ? `<div class="row" style="padding:8px 4px"><div class="mid"><div class="s">Sevk / fatura</div><div class="t" style="white-space:normal">${esc([s.irsaliyeNo && 'İrsaliye ' + s.irsaliyeNo, s.faturaNo && 'Fatura ' + s.faturaNo, s.kargo && 'Kargo ' + s.kargo].filter(Boolean).join(' · '))}</div></div></div>` : ''}
      ${s.not ? `<div class="row" style="padding:8px 4px"><div class="mid"><div class="s">Not</div><div class="t" style="white-space:normal">${esc(s.not)}</div></div></div>` : ''}
    </div>
    ${k.length ? `<div class="vu-h" style="padding-left:0">Kalemler <span>${k.filter(x => x.geldi).length}/${k.length} hazır — geldikçe işaretle</span></div><div class="rows sp-kal">${k.map((x, i) => `<label class="row hz-row" style="padding:8px 4px"><input type="checkbox" data-sk="${i}"${x.geldi ? ' checked' : ''}><div class="mid"><div class="t">${esc(x.ref || 'Kodsuz')} <span style="color:var(--fg3);font-weight:500">${esc(x.marka || '')}</span></div><div class="s">${esc(x.aciklama || '')}</div></div><div class="end"><b class="num">${esc(x.miktar || 1)}</b><span class="s">${esc(x.birim || 'Adet')}</span></div></label>`).join('')}</div>` : ''}
    ${(s.gecmis || []).length ? `<div class="vu-h" style="padding-left:0">Takip geçmişi</div><div class="sp-tl">${(s.gecmis || []).slice().reverse().map(g => `<div><i></i><b>${esc((SDURUM[g.d] || [g.d])[0])}</b><small>${new Date(g.t).toLocaleString('tr-TR', {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'})} · ${esc(adi(g.k))}${g.n ? ' · ' + esc(g.n) : ''}</small></div>`).join('')}</div>` : ''}
    <div class="vu-h" style="padding-left:0">Belgeler <span>${(s.dosyalar || []).length}</span></div>
    <div class="rows">${(s.dosyalar || []).map((f, i) => `<button class="row" style="padding:8px 4px" data-sdos="${i}"><div class="ico" style="background:var(--brand-soft);color:var(--brand)">${/image/.test(f.tip) ? '🖼' : '📄'}</div><div class="mid"><div class="t">${esc(f.ad)}</div><div class="s">${f.at ? trT(f.at.slice(0, 10)) : ''}</div></div><div class="end"><span class="s">Aç</span></div></button>`).join('') || '<div class="empty" style="padding:12px">Belge yok</div>'}</div>
    <label class="btn btn-s btn-block" style="margin-top:8px;cursor:pointer">${ikon('plus')}Belge / fotoğraf ekle<input type="file" id="sd-dosya" multiple accept="image/*,.pdf,.xlsx,.xls,.doc,.docx" hidden></label>
    <div class="fg2" style="margin-top:10px"><button class="btn btn-s btn-sm" data-sd="iptal">İptal et</button>${IS_OWNER ? `<button class="btn btn-d btn-sm" id="sd-sil">${ikon('trash')}Sil</button>` : '<span></span>'}</div>`,
    [{label: 'Düzenle', onClick: () => { siparisForm(S.siparisler.find(x => x.id === id)); }}, {label: 'Kapat', cls: 'btn-p', onClick: () => {}}]);
  const guncel = () => S.siparisler.find(x => x.id === id) || s;
  sh.el.querySelectorAll('[data-sd]').forEach(b => b.onclick = async () => {
    const yeni = b.dataset.sd, c = guncel(); if (yeni === c.durum) return;
    let ek = {}, not = '';
    if (yeni === 'sevk' || yeni === 'fatura') {
      const alan = yeni === 'sevk' ? [['irsaliyeNo', 'İrsaliye no'], ['kargo', 'Kargo / takip no (isteğe bağlı)']] : [['faturaNo', 'Fatura no']];
      ek = await new Promise(res => sheet(SDURUM[yeni][0], `<div class="fg">${alan.map(([k, l]) => `<div class="f"><label>${l}</label><input class="inp" data-ek="${k}" value="${esc(c[k] || '')}"></div>`).join('')}</div>`,
        [{label: 'Atla', onClick: () => res({})}, {label: 'Kaydet', cls: 'btn-p', onClick: ov => { const o = {}; ov.querySelectorAll('[data-ek]').forEach(i => { if (i.value.trim()) o[i.dataset.ek] = i.value.trim(); }); res(o); }}]));
      not = Object.values(ek).join(' · ');
    }
    await kaydet('siparisler', {...c, ...ek, durum: yeni, gecmis: [...(c.gecmis || []), {t: new Date().toISOString(), d: yeni, k: ME, n: not}]});
    if (yeni === 'teslim' || yeni === 'fatura') { const t = S.teklifler.find(x => x.id === c.teklifId); if (t && t.durum !== 'tamamlandi') kaydet('teklifler', {...t, durum: 'tamamlandi'}); }
    toast('✅ ' + SDURUM[yeni][0]); sh.kapat(); siparisDetay(id);
  });
  sh.el.querySelectorAll('[data-sk]').forEach(cb => cb.onchange = () => {
    const c = guncel(), kk = (c.kalemler || []).map((x, i) => i === +cb.dataset.sk ? {...x, geldi: cb.checked} : x);
    const hepsi = kk.length && kk.every(x => x.geldi);
    kaydet('siparisler', {...c, kalemler: kk, ...(hepsi && ['alindi', 'tedarik'].includes(c.durum) ? {durum: 'hazir', gecmis: [...(c.gecmis || []), {t: new Date().toISOString(), d: 'hazir', k: ME}]} : {})});
    if (hepsi) toast('✅ Tüm kalemler hazır — durum "Hazır" yapıldı');
  });
  sh.el.querySelectorAll('[data-sdos]').forEach(b => b.onclick = () => spDosyaAc((guncel().dosyalar || [])[+b.dataset.sdos]));
  sh.el.querySelector('#sd-dosya').onchange = async e => {
    const fl = [...e.target.files]; if (!fl.length) return;
    toast('Yükleniyor…'); const dos = await spDosyaYukle(id, fl);
    if (dos.length) { const c = guncel(); await kaydet('siparisler', {...c, dosyalar: [...(c.dosyalar || []), ...dos]}); toast('✅ ' + dos.length + ' belge eklendi'); sh.kapat(); siparisDetay(id); }
  };
  const to = sh.el.querySelector('[data-spo]'); if (to) to.onclick = () => { const t = S.teklifler.find(x => x.id === s.teklifId); if (t) teklifOnizle(t, false); };
  const tb = sh.el.querySelector('[data-spt]'); if (tb) tb.onclick = () => { sh.kapat(); teklifDetay(s.teklifId); };
  const sil = sh.el.querySelector('#sd-sil');
  if (sil) sil.onclick = () => { sh.kapat(); confirmSheet('Sipariş silinsin mi?', (s.no || '') + ' ' + (s.musteri || '') + ' kalıcı olarak silinecek.', () => BE.sil('siparisler', id)); };
}

$('#sp-ara').oninput = siparislerCiz;
$('#sp-chips').onclick = e => { const c = e.target.closest('[data-spf]'); if (c) { spFiltre = c.dataset.spf; siparislerCiz(); } };
$('#sp-list').onclick = e => { const r = e.target.closest('[data-sp]'); if (r) siparisDetay(r.dataset.sp); };
document.addEventListener('click', e => { const r = e.target.closest('[data-sp]'); if (r && !r.closest('#sp-list')) siparisDetay(r.dataset.sp); });
$('#sp-yeni').onclick = () => siparisForm();
siparislerCiz();
