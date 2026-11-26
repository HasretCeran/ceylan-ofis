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
  return `<button class="row" data-sp="${esc(s.id)}"><div class="ico" style="background:var(--brand-soft);color:var(--brand)">${esc(bas(s.musteri))}</div>
    <div class="mid"><div class="t">${esc(s.musteri || '—')}</div><div class="s">${esc(alt)}</div></div>
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
  onizle({url: data.signedUrl, tip}, f.ad, [{label: 'İndir / aç', cls: 'btn-p', onClick: () => window.open(data.signedUrl, '_blank')}]);
}

function siparisForm(s = {}, teklif = null) {
  const yeni = !s.id;
  if (teklif) s = {musteri: teklif.musteri, teklifId: teklif.id, teklifNo: teklif.no, tutar: teklif.tutar, kalemler: (teklif.kalemler || []).map(k => ({...k, geldi: false})), ...s};
  const tk = S.teklifler.filter(t => !s.musteri || (t.musteri || '').toLocaleLowerCase('tr-TR') === (s.musteri || '').toLocaleLowerCase('tr-TR')).slice(0, 60);
  const sh = sheet(yeni ? 'Yeni sipariş' : 'Siparişi düzenle', `<div class="fg">
    <div class="f"><label for="sp-musteri">Müşteri *</label><input class="inp" id="sp-musteri" list="firma-list" value="${esc(s.musteri || '')}"></div>
    <div class="fg2"><div class="f"><label for="sp-po">Müşteri sipariş no (PO)</label><input class="inp" id="sp-po" value="${esc(s.musteriSipNo || '')}"></div>
      <div class="f"><label for="sp-tarih">Sipariş tarihi</label><input class="inp" id="sp-tarih" type="date" value="${esc(s.tarih || bugun())}"></div></div>
    <div class="fg2"><div class="f"><label for="sp-termin">Termin (teslim)</label><input class="inp" id="sp-termin" type="date" value="${esc(s.termin || '')}"></div>
      <div class="f"><label for="sp-tutar">Tutar</label><input class="inp" id="sp-tutar" value="${esc(s.tutar || '')}" placeholder="ör. € 12.400"></div></div>
    <div class="f"><label for="sp-teklif">Bağlı teklif</label><select class="sel" id="sp-teklif"><option value="">— yok —</option>${tk.map(t => `<option value="${esc(t.id)}"${t.id === s.teklifId ? ' selected' : ''}>${esc((t.no || '') + ' · ' + (t.musteri || '') + ' · ' + trT(t.tarih))}</option>`).join('')}</select></div>
    <div class="f"><label for="sp-not">Not</label><textarea class="inp" id="sp-not" rows="2">${esc(s.not || '')}</textarea></div>
    <div class="f"><label>Sipariş formu / onay / fotoğraf</label><input class="inp" id="sp-dosya" type="file" multiple accept="image/*,.pdf,.xlsx,.xls,.doc,.docx"></div>
  </div>`, [{label: 'Vazgeç', onClick: () => {}}, {label: 'Kaydet', cls: 'btn-p', onClick: async ov => {
    const mus = v(ov, 'sp-musteri'); if (!mus) { toast('Müşteri adı gerekli'); return false; }
    const id = s.id || newId(), tid = v(ov, 'sp-teklif'), t = S.teklifler.find(x => x.id === tid);
    const files = [...ov.querySelector('#sp-dosya').files];
    const dos = files.length ? await spDosyaYukle(id, files) : [];
    const o = {...s, id, no: s.no || sipNo(), musteri: mus, musteriSipNo: v(ov, 'sp-po'), tarih: v(ov, 'sp-tarih') || bugun(), termin: v(ov, 'sp-termin'), tutar: v(ov, 'sp-tutar') || (t && t.tutar) || '', not: v(ov, 'sp-not'),
      teklifId: tid || '', teklifNo: t ? t.no : '', durum: s.durum || 'alindi', dosyalar: [...(s.dosyalar || []), ...dos],
      kalemler: (s.kalemler && s.kalemler.length) ? s.kalemler : (t && Array.isArray(t.kalemler) ? t.kalemler.map(k => ({...k, geldi: false})) : []),
      gecmis: s.gecmis || [{t: new Date().toISOString(), d: 'alindi', k: ME}]};
    const ok = await kaydet('siparisler', o);
    if (ok && t && !['onaylandi', 'tamamlandi'].includes(t.durum)) await kaydet('teklifler', {...t, durum: 'onaylandi'});
    if (ok) { toast('✅ Sipariş kaydedildi' + (dos.length ? ' · ' + dos.length + ' dosya' : '')); if (aktifSayfa !== 'siparisler') git('siparisler'); }
  }}]);
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
      ${s.not ? `<div class="row" style="padding:8px 4px"><div class="mid"><div class="s">Not</div><div class="t" style="white-space:normal">${esc(s.not)}</div></div></div>` : ''}
    </div>
    ${k.length ? `<div class="vu-h" style="padding-left:0">Kalemler <span>${k.filter(x => x.geldi).length}/${k.length} hazır — geldikçe işaretle</span></div><div class="rows sp-kal">${k.map((x, i) => `<label class="row hz-row" style="padding:8px 4px"><input type="checkbox" data-sk="${i}"${x.geldi ? ' checked' : ''}><div class="mid"><div class="t">${esc(x.ref || 'Kodsuz')} <span style="color:var(--fg3);font-weight:500">${esc(x.marka || '')}</span></div><div class="s">${esc(x.aciklama || '')}</div></div><div class="end"><b class="num">${esc(x.miktar || 1)}</b><span class="s">${esc(x.birim || 'Adet')}</span></div></label>`).join('')}</div>` : ''}
    <div class="vu-h" style="padding-left:0">Belgeler <span>${(s.dosyalar || []).length}</span></div>
    <div class="rows">${(s.dosyalar || []).map((f, i) => `<button class="row" style="padding:8px 4px" data-sdos="${i}"><div class="ico" style="background:var(--brand-soft);color:var(--brand)">${/image/.test(f.tip) ? '🖼' : '📄'}</div><div class="mid"><div class="t">${esc(f.ad)}</div><div class="s">${f.at ? trT(f.at.slice(0, 10)) : ''}</div></div><div class="end"><span class="s">Aç</span></div></button>`).join('') || '<div class="empty" style="padding:12px">Belge yok</div>'}</div>
    <label class="btn btn-s btn-block" style="margin-top:8px;cursor:pointer">${ikon('plus')}Belge / fotoğraf ekle<input type="file" id="sd-dosya" multiple accept="image/*,.pdf,.xlsx,.xls,.doc,.docx" hidden></label>
    <div class="fg2" style="margin-top:10px"><button class="btn btn-s btn-sm" data-sd="iptal">İptal et</button>${IS_OWNER ? `<button class="btn btn-d btn-sm" id="sd-sil">${ikon('trash')}Sil</button>` : '<span></span>'}</div>`,
    [{label: 'Düzenle', onClick: () => { siparisForm(S.siparisler.find(x => x.id === id)); }}, {label: 'Kapat', cls: 'btn-p', onClick: () => {}}]);
  const guncel = () => S.siparisler.find(x => x.id === id) || s;
  sh.el.querySelectorAll('[data-sd]').forEach(b => b.onclick = async () => {
    const yeni = b.dataset.sd, c = guncel(); if (yeni === c.durum) return;
    await kaydet('siparisler', {...c, durum: yeni, gecmis: [...(c.gecmis || []), {t: new Date().toISOString(), d: yeni, k: ME}]});
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
$('#sp-yeni').onclick = () => siparisForm();
siparislerCiz();
