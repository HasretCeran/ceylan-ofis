'use strict';
/* Ceylan Ofis — Satınalma (sadece yönetici)
   1) Tedarikçiler  2) Fiyat/stok talepleri (mail metni hazırlanır; satınalma mailinden gönderilir)
   3) Gelen teklifler: süzgeç + karşılaştırma + en düşük fiyat   4) Satın alma siparişleri ve rapor
   Mail otomasyonu sözleşmesi: sa_talepler.durum 'gonderilecek' olanları satınalma posta kutusundan gönderen bir
   ajan, gonderim[tedarikciId] = {durum:'gonderildi', zaman, kanal:'otomatik', mailUrl} yazar; gelen yanıtlardaki
   fiyat/stok bilgisini sa_teklifler'e (kaynak:'mail') ekler. */
const SA_COLS = ['tedarikciler', 'sa_talepler', 'sa_teklifler', 'sa_siparisler'];
SA_COLS.forEach(c => { if (!S[c]) S[c] = []; });
const SA_TALEP = {taslak: ['Taslak', 'p-gray'], gonderilecek: ['Gönderilecek', 'p-amber'], gonderildi: ['Gönderildi', 'p-blue'], yanit: ['Yanıt geldi', 'p-green'], kapandi: ['Kapandı', 'p-gray']};
const SA_SIP = {verildi: ['Sipariş verildi', 'p-blue'], onay: ['Tedarikçi onayladı', 'p-blue'], yolda: ['Yolda', 'p-amber'], teslim: ['Teslim alındı', 'p-green'], fatura: ['Faturalandı', 'p-green'], iptal: ['İptal', 'p-red']};
const SA_ACIK = ['verildi', 'onay', 'yolda'];
const SA_SORU = [['fiyat', 'Birim fiyat'], ['stok', 'Stok durumu'], ['termin', 'Teslim süresi'], ['minimum', 'Minimum sipariş'], ['odeme', 'Ödeme koşulu']];
const SA_BIRIM = ['Adet', 'Mt', 'Kg', 'Paket', 'Kutu', 'Takım', 'Rulo'];
let saTab = lsGet('sa_tab', 'talepler'), saYuklendi = false, saSipFiltre = 'acik';
const saF = {q: '', ted: '', para: '', stok: '', donem: 0, enDusuk: false};
const saKur = () => { const k = lsGet('sa_kur', {}); return {'$': Number(k['$']) || 0, '€': Number(k['€']) || 0}; };
const saTed = id => S.tedarikciler.find(t => t.id === id);
const saTL = n => Number(n || 0).toLocaleString('tr-TR', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const saTutarYazi = list => { const t = {}; list.forEach(k => { const n = (Number(k.fiyat) || 0) * (Number(k.miktar) || 1); if (n > 0) t[k.para || '₺'] = (t[k.para || '₺'] || 0) + n; }); return Object.entries(t).map(([p, v]) => saTL(v) + ' ' + p).join(' + '); };
function saNo(onek, col) {
  const y = new Date().getFullYear(), re = new RegExp('^' + onek + '-' + y + '-(\\d+)$');
  return onek + '-' + y + '-' + String(S[col].reduce((m, x) => { const r = re.exec(x.no || ''); return r ? Math.max(m, +r[1]) : m; }, 0) + 1).padStart(3, '0');
}

// ── Yükleme (sadece yönetici; çalışanların uygulaması etkilenmez)
async function saYukle() {
  if (saYuklendi) return; saYuklendi = true;
  if (DEMO) { SA_COLS.forEach(c => { const a = lsGet('co_' + c, []); S[c] = Array.isArray(a) ? a : []; }); saCiz(); return; }
  try {
    for (const c of SA_COLS) S[c] = (await BE._hepsi(c)).map(rowToObj);
    saCiz();
    const ch = sb.channel('ceylan-satinalma');
    SA_COLS.forEach(col => ch.on('postgres_changes', {event: '*', schema: 'public', table: col}, p => {
      if (p.eventType === 'DELETE') S[col] = S[col].filter(x => x.id !== (p.old && p.old.id));
      else { const o = rowToObj(p.new), i = S[col].findIndex(x => x.id === o.id); if (i >= 0) S[col][i] = o; else S[col].push(o); }
      degisti(col);
    }));
    ch.subscribe();
  } catch (e) { console.warn('satınalma', e); saYuklendi = false; toast('⚠ Satınalma verileri yüklenemedi'); }
}

// ── Sayfa
function saCiz() {
  const body = $('#sa-body'); if (!body) return;
  const talepAcik = S.sa_talepler.filter(t => t.durum !== 'kapandi').length, sipAcik = S.sa_siparisler.filter(s => SA_ACIK.includes(s.durum || 'verildi')).length;
  const tabs = [['talepler', 'Talepler' + (talepAcik ? ' · ' + talepAcik : '')], ['analiz', 'Fiyat analizi · ' + S.sa_teklifler.length], ['siparisler', 'Satın alma' + (sipAcik ? ' · ' + sipAcik : '')], ['tedarikciler', 'Tedarikçiler · ' + S.tedarikciler.length]];
  $('#sa-tabs').innerHTML = tabs.map(([k, l]) => `<button class="chip${saTab === k ? ' on' : ''}" data-satab="${k}">${l}</button>`).join('');
  const btn = {talepler: ['+ Yeni talep', 'sa-yeni-talep'], analiz: ['+ Teklif ekle', 'sa-yeni-teklif'], siparisler: ['+ Sipariş', 'sa-yeni-sip'], tedarikciler: ['+ Tedarikçi', 'sa-yeni-ted']}[saTab];
  $('#sa-act').innerHTML = `${saTab === 'siparisler' ? '<button class="btn btn-s btn-sm" id="sa-rapor">Rapor</button>' : ''}${saTab === 'analiz' ? '<button class="btn btn-s btn-sm" id="sa-excel">Excel</button>' : ''}<button class="btn btn-p btn-sm" id="${btn[1]}">${btn[0]}</button>`;
  ({talepler: saTaleplerCiz, analiz: saAnalizCiz, siparisler: saSiparislerCiz, tedarikciler: saTedarikcilerCiz})[saTab](body);
}

// ═══ TEDARİKÇİLER ═══
function saTedarikcilerCiz(body) {
  const l = S.tedarikciler.slice().sort((a, b) => (a.ad || '').localeCompare(b.ad || '', 'tr'));
  body.innerHTML = `<div class="card"><div class="rows">${l.length ? l.map(t => `<button class="row" data-sated="${esc(t.id)}"><div class="ico" style="background:var(--brand-soft);color:var(--brand)">${esc(bas(t.ad))}</div><div class="mid"><div class="t">${esc(t.ad)}</div><div class="s">${esc([t.eposta, t.telefon, t.markalar].filter(Boolean).join(' · ') || 'iletişim bilgisi yok')}</div></div><div class="end"><span class="s">${S.sa_teklifler.filter(x => x.tedarikciId === t.id).length} teklif</span></div></button>`).join('') : '<div class="empty">Henüz tedarikçi yok — "+ Tedarikçi" ile ekle</div>'}</div></div>`;
}
function saTedForm(id) {
  const t = id ? saTed(id) : {}; if (id && !t) return;
  sheet(id ? t.ad : 'Yeni tedarikçi', `<div class="fg">
    <div class="f"><label for="stf-ad">Firma adı *</label><input class="inp" id="stf-ad" value="${esc(t.ad)}"></div>
    <div class="f"><label for="stf-ep">E-posta (fiyat talepleri buraya gider) *</label><input class="inp" id="stf-ep" type="email" autocapitalize="none" value="${esc(t.eposta)}" placeholder="satis@firma.com"></div>
    <div class="fg2"><div class="f"><label for="stf-kisi">İlgili kişi</label><input class="inp" id="stf-kisi" value="${esc(t.kisi)}"></div><div class="f"><label for="stf-tel">Telefon</label><input class="inp" id="stf-tel" type="tel" value="${esc(t.telefon)}"></div></div>
    <div class="f"><label for="stf-mk">Sattığı markalar / ürün grupları</label><input class="inp" id="stf-mk" value="${esc(t.markalar)}" placeholder="ör. ABB, Siemens, kablo"></div>
    <div class="f"><label for="stf-not">Not</label><input class="inp" id="stf-not" value="${esc(t.not)}" placeholder="ödeme koşulu, iskonto anlaşması…"></div>
    ${id && IS_OWNER ? `<button class="btn btn-d btn-sm" id="stf-sil" style="justify-self:start">${ikon('trash')}Tedarikçiyi sil</button>` : ''}</div>`,
  [{label: 'Vazgeç', onClick: () => {}}, {label: 'Kaydet', cls: 'btn-p', onClick: async ov => {
    const ad = v(ov, 'stf-ad'), ep = v(ov, 'stf-ep'); if (!ad) { toast('Firma adı gerekli'); return false; } if (!/^\S+@\S+\.\S+$/.test(ep)) { toast('Geçerli bir e-posta gir'); return false; }
    return kaydet('tedarikciler', {...t, ad, eposta: ep, kisi: v(ov, 'stf-kisi'), telefon: v(ov, 'stf-tel'), markalar: v(ov, 'stf-mk'), not: v(ov, 'stf-not')});
  }}]);
  const sil = $('#stf-sil'); if (sil) sil.onclick = () => confirmSheet('Tedarikçi silinsin mi?', 'Geçmiş teklifler ve siparişler kalır.', async () => { await BE.sil('tedarikciler', id); toast('Silindi'); });
}

// ═══ TALEPLER (fiyat / stok sorma) ═══
function saTaleplerCiz(body) {
  const l = S.sa_talepler.slice().sort((a, b) => (b.tarih || '').localeCompare(a.tarih || '') || (b.no || '').localeCompare(a.no || ''));
  body.innerHTML = `<p class="note" style="margin-bottom:12px">Ürünleri ve tedarikçileri seç; mail metni otomatik hazırlanır. Satınalma mailinden göndermek için her tedarikçide <b>✉ Mail uygulamasında aç</b>'a bas. Satınalma posta kutusu bağlanınca <b>Gönderilecek</b> talepler kendiliğinden gider, yanıtlardaki fiyatlar <b>Fiyat analizi</b>'ne düşer.</p>
  <div class="card"><div class="rows">${l.length ? l.map(t => {
    const [dl, dc] = SA_TALEP[t.durum] || SA_TALEP.taslak, tl = (t.tedarikciler || []).length, yan = new Set(S.sa_teklifler.filter(x => x.talepId === t.id).map(x => x.tedarikciId)).size;
    return `<button class="row" data-satalep="${esc(t.id)}"><div class="ico" style="background:var(--brand-soft);color:var(--brand)">${ikon('send')}</div><div class="mid"><div class="t">${esc(t.konu || (t.kalemler[0] && (t.kalemler[0].ref || t.kalemler[0].aciklama)) || t.no)}</div><div class="s">${esc([t.no, trT(t.tarih), (t.kalemler || []).length + ' kalem', tl + ' tedarikçi', yan ? yan + ' yanıt' : ''].filter(Boolean).join(' · '))}</div></div><div class="end"><span class="pill ${dc}">${dl}</span></div></button>`;
  }).join('') : '<div class="empty">Henüz talep yok — "+ Yeni talep" ile başla</div>'}</div></div>`;
}
function saKalemParse(txt) {
  return String(txt || '').split('\n').map(s => s.trim()).filter(Boolean).map(s => {
    const m = /^(.*?)(?:\s*[;|\t]\s*|\s+[xX×]\s*|\s+)(\d+(?:[.,]\d+)?)\s*(adet|ad|mt|metre|kg|takım|takim|paket|kutu|rulo)?\.?$/i.exec(s);
    let ad = m ? m[1].trim() : s; const miktar = m ? Number(m[2].replace(',', '.')) : 1, bir = m && m[3] ? m[3].toLowerCase() : '';
    const u = urunBul(ad); const birim = /^(mt|metre)$/.test(bir) ? 'Mt' : /^kg$/.test(bir) ? 'Kg' : /^(takım|takim)$/.test(bir) ? 'Takım' : /^paket$/.test(bir) ? 'Paket' : /^kutu$/.test(bir) ? 'Kutu' : /^rulo$/.test(bir) ? 'Rulo' : 'Adet';
    return u ? {ref: u.ref, aciklama: u.aciklama || '', marka: u.marka || '', miktar, birim} : {ref: /\s/.test(ad) || ad.length > 28 ? '' : ad, aciklama: /\s/.test(ad) || ad.length > 28 ? ad : '', marka: '', miktar, birim};
  });
}
const saKalemYazi = l => (l || []).map(k => (k.ref || k.aciklama) + ' ; ' + k.miktar + (k.birim && k.birim !== 'Adet' ? ' ' + k.birim.toLowerCase() : '')).join('\n');
function saTalepForm(id) {
  const t = id ? S.sa_talepler.find(x => x.id === id) : {}; if (id && !t) return;
  const sec = new Set(t.tedarikciler || []), sor = new Set(t.sorular || ['fiyat', 'stok', 'termin']), imza = t.imza || lsGet('sa_imza', 'Ceylan Endüstriyel Otomasyon — Satınalma');
  const teds = S.tedarikciler.slice().sort((a, b) => (a.ad || '').localeCompare(b.ad || '', 'tr'));
  sheet(id ? 'Talebi düzenle' : 'Yeni fiyat / stok talebi', `<div class="fg">
    <div class="f"><label for="stl-konu">Konu (isteğe bağlı)</label><input class="inp" id="stl-konu" value="${esc(t.konu)}" placeholder="ör. Fineagles panoları malzeme"></div>
    <div class="f"><label for="stl-kal">Ürünler — her satıra bir ürün: kod ya da ad ; miktar *</label><textarea class="inp" id="stl-kal" rows="6" placeholder="MS165-54 ; 3&#10;AF09-30-01 ; 23&#10;H07V-K 2,5mm NYAF mavi ; 1000 mt">${esc(saKalemYazi(t.kalemler))}</textarea></div>
    <div class="f"><label>Tedarikçiler *</label>${teds.length ? `<div class="rows" style="max-height:200px;overflow:auto;border:1px solid var(--line);border-radius:12px">${teds.map(x => `<label class="row hz-row" style="padding:8px 12px"><input type="checkbox" data-stt="${esc(x.id)}"${sec.has(x.id) ? ' checked' : ''}><div class="mid"><div class="t">${esc(x.ad)}</div><div class="s">${esc(x.markalar || x.eposta || '')}</div></div></label>`).join('')}</div>` : '<p class="note">Önce Tedarikçiler sekmesinden tedarikçi ekle.</p>'}</div>
    <div class="f"><label>Sorulacaklar</label><div style="display:flex;flex-wrap:wrap;gap:4px 14px">${SA_SORU.map(([k, l]) => `<label class="chk"><input type="checkbox" data-sts="${k}"${sor.has(k) ? ' checked' : ''}> ${l}</label>`).join('')}</div></div>
    <div class="f"><label for="stl-ek">Ek mesaj</label><input class="inp" id="stl-ek" value="${esc(t.ekMesaj)}" placeholder="ör. Yarın akşama kadar dönüş rica ederiz"></div>
    <div class="f"><label for="stl-imza">İmza</label><input class="inp" id="stl-imza" value="${esc(imza)}"></div></div>`,
  [{label: 'Vazgeç', onClick: () => {}}, {label: 'Kaydet', cls: 'btn-p', onClick: async ov => {
    const kal = saKalemParse(ov.querySelector('#stl-kal').value), ted = [...ov.querySelectorAll('[data-stt]:checked')].map(c => c.dataset.stt);
    if (!kal.length) { toast('En az bir ürün yaz'); return false; } if (!ted.length) { toast('En az bir tedarikçi seç'); return false; }
    const imz = v(ov, 'stl-imza'); lsSet('sa_imza', imz);
    const o = {...t, no: t.no || saNo('TLP', 'sa_talepler'), tarih: t.tarih || bugun(), durum: t.durum || 'taslak', konu: v(ov, 'stl-konu'), kalemler: kal, tedarikciler: ted, sorular: [...ov.querySelectorAll('[data-sts]:checked')].map(c => c.dataset.sts), ekMesaj: v(ov, 'stl-ek'), imza: imz, gonderim: t.gonderim || {}};
    const ok = await kaydet('sa_talepler', o); if (ok && !id) setTimeout(() => saTalepDetay(S.sa_talepler.find(x => x.no === o.no).id), 0); return ok;
  }}]);
}
function saMail(t, ted) {
  const sor = SA_SORU.filter(([k]) => (t.sorular || []).includes(k)).map(([, l]) => l.toLowerCase());
  const liste = (t.kalemler || []).map((k, i) => `${i + 1}) ${[k.ref, k.aciklama].filter(Boolean).join(' — ')}${k.marka ? ' (' + k.marka + ')' : ''} — ${k.miktar} ${k.birim || 'Adet'}`).join('\n');
  return {konu: `Fiyat ve stok talebi — ${t.no}`, govde: `Merhaba${ted && ted.kisi ? ' ' + ted.kisi : ''},\n\nAşağıdaki ürünler için ${sor.join(', ') || 'fiyat'} bilgisini rica ederiz:\n\n${liste}\n\n${t.ekMesaj ? t.ekMesaj + '\n\n' : ''}Lütfen yanıtınızda ürün kodunu belirtiniz. (Referans: ${t.no})\n\nİyi çalışmalar,\n${t.imza || ''}`};
}
function saTalepDurum(t) {
  const g = t.gonderim || {}, ted = t.tedarikciler || [];
  if (S.sa_teklifler.some(x => x.talepId === t.id)) return 'yanit';
  if (ted.length && ted.every(id => g[id] && g[id].durum === 'gonderildi')) return 'gonderildi';
  return t.durum === 'kapandi' ? 'kapandi' : (t.durum === 'gonderilecek' ? 'gonderilecek' : t.durum === 'yanit' || t.durum === 'gonderildi' ? 'gonderilecek' : 'taslak');
}
function saTalepDetay(id) {
  const t = S.sa_talepler.find(x => x.id === id); if (!t) return;
  const [dl, dc] = SA_TALEP[t.durum] || SA_TALEP.taslak, g = t.gonderim || {};
  const sh = sheet(t.no + (t.konu ? ' · ' + t.konu : ''), `<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><span class="pill ${dc}">${dl}</span><span class="s" style="color:var(--fg3);font-size:12px">${trT(t.tarih)} · ${esc((t.sorular || []).map(k => (SA_SORU.find(s => s[0] === k) || [])[1]).filter(Boolean).join(', '))}</span></div>
    <div class="vu-h" style="padding-left:0">Ürünler <span>${(t.kalemler || []).length}</span></div>
    <div class="rows">${(t.kalemler || []).map(k => `<div class="row" style="padding:6px 0"><div class="mid"><div class="t">${esc(k.ref || k.aciklama)}${k.marka ? ` <span style="color:var(--fg3);font-weight:500">${esc(k.marka)}</span>` : ''}</div>${k.ref && k.aciklama ? `<div class="s">${esc(k.aciklama)}</div>` : ''}</div><div class="end"><b class="num">${esc(k.miktar)}</b><span class="s">${esc(k.birim || 'Adet')}</span></div></div>`).join('')}</div>
    <div class="vu-h" style="padding-left:0">Tedarikçiler</div>
    <div class="rows">${(t.tedarikciler || []).map(tid => { const x = saTed(tid) || {ad: 'Silinmiş tedarikçi'}, gd = g[tid], yan = S.sa_teklifler.filter(q => q.talepId === t.id && q.tedarikciId === tid).length;
      return `<div class="row" style="padding:8px 0;flex-wrap:wrap"><div class="mid" style="min-width:150px"><div class="t">${esc(x.ad)}</div><div class="s">${esc(x.eposta || 'e-posta yok')}${gd && gd.durum === 'gonderildi' ? ' · ✓ gönderildi ' + trT(String(gd.zaman || '').slice(0, 10)) + (gd.kanal === 'otomatik' ? ' (otomatik)' : '') : ''}${yan ? ' · ' + yan + ' fiyat girildi' : ''}</div></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn btn-s btn-sm" data-samail="${esc(tid)}">✉ Mail uygulamasında aç</button><button class="btn btn-s btn-sm" data-sagon="${esc(tid)}">${gd && gd.durum === 'gonderildi' ? 'Gönderilmedi say' : 'Gönderildi say'}</button><button class="btn btn-p btn-sm" data-sayan="${esc(tid)}">Fiyat gir</button></div></div>`; }).join('')}</div>
    <p class="note" style="margin-top:10px">${t.durum === 'gonderilecek' ? '⏳ Satınalma posta kutusu bağlanınca otomatik gönderilecek.' : 'Posta kutusu bağlıysa "Gönderime onayla" talebi otomatik gönderime alır; yoksa her tedarikçiye "Mail uygulamasında aç" ile gönder.'}</p>`,
  [{label: 'Düzenle', onClick: () => { setTimeout(() => saTalepForm(id), 0); }}, ...(t.durum === 'taslak' ? [{label: 'Gönderime onayla', cls: 'btn-p', onClick: async () => kaydet('sa_talepler', {...t, durum: 'gonderilecek', onay: new Date().toISOString()})}] : [{label: 'Kapat', onClick: async () => kaydet('sa_talepler', {...t, durum: 'kapandi'})}])]);
  const sil = document.createElement('button'); sil.className = 'btn btn-d btn-sm'; sil.style.margin = '0 18px 12px'; sil.innerHTML = ikon('trash') + 'Talebi sil'; sil.onclick = () => confirmSheet('Talep silinsin mi?', 'Bu talebe girilen teklifler Fiyat analizi\'nde kalır.', async () => { await BE.sil('sa_talepler', id); sh.kapat(); toast('Silindi'); });
  if (IS_OWNER) sh.el.querySelector('.sheet').insertBefore(sil, sh.el.querySelector('.sheet-f'));
  const gunc = () => S.sa_talepler.find(x => x.id === id);
  sh.el.querySelectorAll('[data-samail]').forEach(b => b.onclick = () => {
    const x = saTed(b.dataset.samail); if (!x || !x.eposta) { toast('Tedarikçinin e-postası yok'); return; }
    const m = saMail(gunc(), x); let govde = m.govde; if (encodeURIComponent(govde).length > 1700) govde = govde.slice(0, 900) + '\n…\n(Liste uzun: tamamını uygulamadan kopyala)';
    location.href = 'mailto:' + encodeURIComponent(x.eposta) + '?subject=' + encodeURIComponent(m.konu) + '&body=' + encodeURIComponent(govde);
  });
  sh.el.querySelectorAll('[data-sagon]').forEach(b => b.onclick = async () => {
    const c = gunc(), tid = b.dataset.sagon, gg = {...(c.gonderim || {})}; if (gg[tid] && gg[tid].durum === 'gonderildi') delete gg[tid]; else gg[tid] = {durum: 'gonderildi', zaman: new Date().toISOString(), kanal: 'elle'};
    const n = {...c, gonderim: gg}; n.durum = saTalepDurum(n) === 'gonderildi' ? 'gonderildi' : (c.durum === 'taslak' ? 'taslak' : c.durum); await kaydet('sa_talepler', n); sh.kapat(); saTalepDetay(id);
  });
  sh.el.querySelectorAll('[data-sayan]').forEach(b => b.onclick = () => { sh.kapat(); saTeklifGir(id, b.dataset.sayan); });
}
// Tedarikçinin yanıtındaki fiyat / stok / termin bilgisini kalem kalem gir
function saTeklifGir(talepId, tid) {
  const t = S.sa_talepler.find(x => x.id === talepId), x = saTed(tid); if (!t || !x) return;
  const var_ = k => S.sa_teklifler.find(q => q.id === `tk-${talepId}-${tid}-${k}`);
  const sonPara = lsGet('sa_para_' + tid, '€');
  sheet('Yanıt gir — ' + x.ad, `<p class="note">Tedarikçinin cevabındaki bilgileri yaz. Boş bıraktığın kalem kaydedilmez. Aynı kalemi sonra tekrar girersen güncellenir.</p>
    <div class="rows">${(t.kalemler || []).map((k, i) => { const q = var_(i) || {}; return `<div style="padding:10px 0;border-bottom:1px solid var(--line)"><div class="t" style="font-weight:600;font-size:13.5px">${esc(k.ref || k.aciklama)} <span style="color:var(--fg3);font-weight:500">· ${esc(k.miktar)} ${esc(k.birim || 'Adet')}</span></div>
      <div class="fg3" style="margin-top:6px"><div class="f"><label>Birim fiyat</label><input class="inp num" data-tf="${i}" inputmode="decimal" value="${esc(q.fiyat != null ? String(q.fiyat).replace('.', ',') : '')}"></div>
      <div class="f"><label>Para</label><select class="sel" data-tp="${i}">${['€', '$', '₺'].map(p => `<option${(q.para || sonPara) === p ? ' selected' : ''}>${p}</option>`).join('')}</select></div>
      <div class="f"><label>Stok</label><select class="sel" data-ts="${i}">${[['', 'Belirtilmedi'], ['var', 'Stokta var'], ['yok', 'Stokta yok']].map(([a, b]) => `<option value="${a}"${(q.stok || '') === a ? ' selected' : ''}>${b}</option>`).join('')}</select></div></div>
      <div class="fg2" style="margin-top:6px"><div class="f"><label>Termin</label><input class="inp" data-tt="${i}" value="${esc(q.termin)}" placeholder="ör. 3 gün / stoktan"></div><div class="f"><label>Not</label><input class="inp" data-tn="${i}" value="${esc(q.not)}"></div></div></div>`; }).join('')}</div>`,
  [{label: 'Vazgeç', onClick: () => {}}, {label: 'Kaydet', cls: 'btn-p', onClick: async ov => {
    const para0 = ov.querySelector('[data-tp]') ? ov.querySelector('[data-tp]').value : sonPara; lsSet('sa_para_' + tid, para0);
    const objs = [];
    (t.kalemler || []).forEach((k, i) => {
      const f = Number(String(ov.querySelector(`[data-tf="${i}"]`).value).replace(',', '.')), stok = ov.querySelector(`[data-ts="${i}"]`).value;
      if (!(f > 0) && !stok) return;
      objs.push({id: `tk-${talepId}-${tid}-${i}`, talepId, tedarikciId: tid, tedarikci: x.ad, ref: k.ref || '', aciklama: k.aciklama || '', marka: k.marka || '', miktar: k.miktar, birim: k.birim || 'Adet', fiyat: f > 0 ? f : null, para: ov.querySelector(`[data-tp="${i}"]`).value, stok, termin: ov.querySelector(`[data-tt="${i}"]`).value.trim(), not: ov.querySelector(`[data-tn="${i}"]`).value.trim(), tarih: bugun(), kaynak: 'elle'});
    });
    if (!objs.length) { toast('Hiçbir kaleme fiyat ya da stok girilmedi'); return false; }
    for (const o of objs) await kaydet('sa_teklifler', o);
    if (t.durum !== 'yanit') await kaydet('sa_talepler', {...t, durum: 'yanit'});
    toast(`✅ ${objs.length} kalem kaydedildi`); saTab = 'analiz'; lsSet('sa_tab', saTab); setTimeout(saCiz, 50); return true;
  }}]);
}
// Talep dışı tek teklif ekle (telefonla / elden gelen fiyat)
function saTeklifForm() {
  const teds = S.tedarikciler.slice().sort((a, b) => (a.ad || '').localeCompare(b.ad || '', 'tr'));
  if (!teds.length) { toast('Önce Tedarikçiler sekmesinden tedarikçi ekle'); return; }
  sheet('Teklif ekle', `<div class="fg">
    <div class="f"><label for="stk-ted">Tedarikçi *</label><select class="sel" id="stk-ted">${teds.map(x => `<option value="${esc(x.id)}">${esc(x.ad)}</option>`).join('')}</select></div>
    <div class="f"><label for="stk-ref">Ürün kodu ya da adı *</label><input class="inp" id="stk-ref" autocapitalize="characters"></div>
    <div class="fg3"><div class="f"><label for="stk-f">Birim fiyat *</label><input class="inp num" id="stk-f" inputmode="decimal"></div><div class="f"><label for="stk-p">Para</label><select class="sel" id="stk-p">${['€', '$', '₺'].map(p => `<option>${p}</option>`).join('')}</select></div><div class="f"><label for="stk-m">Miktar</label><input class="inp num" id="stk-m" inputmode="decimal" value="1"></div></div>
    <div class="fg2"><div class="f"><label for="stk-s">Stok</label><select class="sel" id="stk-s"><option value="">Belirtilmedi</option><option value="var">Stokta var</option><option value="yok">Stokta yok</option></select></div><div class="f"><label for="stk-t">Termin</label><input class="inp" id="stk-t" placeholder="ör. 3 gün"></div></div>
    <div class="f"><label for="stk-n">Not</label><input class="inp" id="stk-n"></div></div>`,
  [{label: 'Vazgeç', onClick: () => {}}, {label: 'Kaydet', cls: 'btn-p', onClick: async ov => {
    const f = Number(v(ov, 'stk-f').replace(',', '.')), r = v(ov, 'stk-ref'); if (!r || !(f > 0)) { toast('Ürün ve fiyat gerekli'); return false; }
    const x = saTed(v(ov, 'stk-ted')), u = urunBul(r);
    return kaydet('sa_teklifler', {tedarikciId: x.id, tedarikci: x.ad, ref: u ? u.ref : (/\s/.test(r) ? '' : r), aciklama: u ? u.aciklama || '' : (/\s/.test(r) ? r : ''), marka: u ? u.marka || '' : '', miktar: Number(v(ov, 'stk-m').replace(',', '.')) || 1, birim: 'Adet', fiyat: f, para: v(ov, 'stk-p'), stok: v(ov, 'stk-s'), termin: v(ov, 'stk-t'), not: v(ov, 'stk-n'), tarih: bugun(), kaynak: 'elle'});
  }}]);
}

// ═══ FİYAT ANALİZİ ═══
function saGruplar() {
  const kur = saKur(), q = nrmTR(saF.q), lim = saF.donem ? Date.now() - saF.donem * 864e5 : 0;
  const l = S.sa_teklifler.filter(t => (!saF.ted || t.tedarikciId === saF.ted) && (!saF.para || t.para === saF.para) && (!saF.stok || t.stok === saF.stok) && (!lim || Date.parse(t.tarih || '') >= lim)
    && (!q || nrmTR([t.ref, t.aciklama, t.marka, t.tedarikci].join(' ')).includes(q)));
  const m = new Map();
  l.forEach(t => { const key = refN(t.ref) || nrmTR(t.aciklama).replace(/\s+/g, ' '); if (!m.has(key)) m.set(key, {key, ref: t.ref, aciklama: t.aciklama, q: []}); const g = m.get(key); g.q.push(t); if (!g.aciklama && t.aciklama) g.aciklama = t.aciklama; });
  const gr = [...m.values()];
  gr.forEach(g => {
    // aynı ürün + aynı tedarikçi: en güncel teklif geçerli
    const son = new Map(); g.q.sort((a, b) => (a.tarih || '').localeCompare(b.tarih || '')).forEach(t => son.set(t.tedarikciId + '|' + (t.miktar || ''), t)); g.q = [...son.values()];
    const paralar = new Set(g.q.filter(t => t.fiyat > 0).map(t => t.para)), tek = paralar.size === 1;
    g.q.forEach(t => { t._v = !(t.fiyat > 0) ? null : t.para === '₺' ? t.fiyat : kur[t.para] ? t.fiyat * kur[t.para] : (tek ? t.fiyat : null); t._tl = !(t.fiyat > 0) ? null : t.para === '₺' ? t.fiyat : kur[t.para] ? t.fiyat * kur[t.para] : null; });
    g.q.sort((a, b) => (a._v == null) - (b._v == null) || a._v - b._v);
    g.en = g.q.find(t => t._v != null) || null; g.liste = urunBul(g.ref);
  });
  return gr.sort((a, b) => (a.ref || a.aciklama || '').localeCompare(b.ref || b.aciklama || '', 'tr'));
}
function saAnalizCiz(body) {
  const kur = saKur(), gr = saGruplar(), teds = S.tedarikciler.slice().sort((a, b) => (a.ad || '').localeCompare(b.ad || '', 'tr'));
  const opt = (arr, cur) => arr.map(([k, l]) => `<option value="${esc(k)}"${String(cur) === String(k) ? ' selected' : ''}>${esc(l)}</option>`).join('');
  // tedarikçi özeti: kaç üründe en düşük, ortalama fark
  const oz = new Map();
  gr.filter(g => g.q.filter(t => t._v != null).length > 1).forEach(g => g.q.filter(t => t._v != null).forEach(t => { const o = oz.get(t.tedarikciId) || {ad: t.tedarikci, n: 0, en: 0, fark: 0}; o.n++; if (t === g.en) o.en++; o.fark += (t._v / g.en._v - 1) * 100; oz.set(t.tedarikciId, o); }));
  body.innerHTML = `<div class="card"><div class="card-b fg">
    <div class="search" style="min-width:0"><svg class="i"><use href="#i-search"/></svg><input class="inp" id="sa-ara" placeholder="Ürün kodu, açıklama, marka, tedarikçi" value="${esc(saF.q)}"></div>
    <div class="fg3"><select class="sel" id="sa-f-ted"><option value="">Tüm tedarikçiler</option>${opt(teds.map(t => [t.id, t.ad]), saF.ted)}</select>
      <select class="sel" id="sa-f-para">${opt([['', 'Tüm para birimleri'], ['₺', '₺'], ['€', '€'], ['$', '$']], saF.para)}</select>
      <select class="sel" id="sa-f-stok">${opt([['', 'Stok: hepsi'], ['var', 'Sadece stokta'], ['yok', 'Stokta yok']], saF.stok)}</select></div>
    <div class="fg3"><select class="sel" id="sa-f-donem">${opt([[0, 'Tüm zamanlar'], [30, 'Son 30 gün'], [90, 'Son 90 gün'], [365, 'Son 1 yıl']], saF.donem)}</select>
      <label class="chk" style="padding:0 4px"><input type="checkbox" id="sa-f-en"${saF.enDusuk ? ' checked' : ''}> Sadece en düşük</label><span></span></div>
    <div class="fg2"><div class="f"><label for="sa-kur-usd">Kur: 1 $ = ? ₺ (karşılaştırma)</label><input class="inp num" id="sa-kur-usd" inputmode="decimal" value="${kur['$'] ? String(kur['$']).replace('.', ',') : ''}" placeholder="boşsa $ ayrı karşılaştırılır"></div><div class="f"><label for="sa-kur-eur">Kur: 1 € = ? ₺</label><input class="inp num" id="sa-kur-eur" inputmode="decimal" value="${kur['€'] ? String(kur['€']).replace('.', ',') : ''}" placeholder="boşsa € ayrı karşılaştırılır"></div></div></div></div>
  ${oz.size ? `<div class="card"><div class="card-h"><h3>Tedarikçi karşılaştırması</h3><span class="pill p-gray">≥2 teklifli ürünler</span></div><div class="tscroll"><table class="prev-table"><thead><tr><th>Tedarikçi</th><th class="r">Teklif</th><th class="r">En düşük</th><th class="r">Ort. fark</th></tr></thead><tbody>${[...oz.values()].sort((a, b) => b.en - a.en).map(o => `<tr><td><b>${esc(o.ad)}</b></td><td class="r">${o.n}</td><td class="r">${o.en}</td><td class="r">${o.fark / o.n < 0.05 ? '—' : '+%' + (o.fark / o.n).toFixed(1).replace('.', ',')}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
  ${gr.length ? gr.map(g => { const l = saF.enDusuk ? g.q.filter(t => t === g.en) : g.q; if (!l.length) return '';
    return `<div class="card"><div class="card-h"><div style="min-width:0"><h3 style="white-space:normal">${esc(g.ref || g.aciklama)}</h3>${g.ref && g.aciklama ? `<div class="s" style="font-size:12px;color:var(--fg2)">${esc(g.aciklama)}</div>` : ''}</div>${g.liste && g.liste.fiyat ? `<span class="pill p-gray" title="Stok listesindeki liste fiyatı">Liste ${esc(fmtF(g.liste.fiyat))} ${esc(g.liste.para || '')}</span>` : ''}</div>
      <div class="tscroll"><table class="prev-table"><thead><tr><th>Tedarikçi</th><th class="r">Fiyat</th><th class="r">Fark</th><th>Stok</th><th>Termin</th><th>Tarih</th><th></th></tr></thead><tbody>${l.map(t => { const best = t === g.en, fark = t._v != null && g.en && g.en._v > 0 && !best ? '+%' + ((t._v / g.en._v - 1) * 100).toFixed(1).replace('.', ',') : '';
        return `<tr><td><b>${esc(t.tedarikci)}</b>${t.not ? `<div class="s" style="font-size:11.5px;color:var(--fg3)">${esc(t.not)}</div>` : ''}</td><td class="r">${t.fiyat > 0 ? `<b${best ? ' style="color:var(--green)"' : ''}>${esc(fmtF(t.fiyat))} ${esc(t.para)}</b>${t._tl != null && t.para !== '₺' ? `<div class="s" style="font-size:11px;color:var(--fg3)">≈ ${saTL(t._tl)} ₺</div>` : t._v == null ? '<div class="s" style="font-size:11px;color:var(--amber)">kur gir</div>' : ''}` : '—'}</td><td class="r">${best && g.q.filter(x => x._v != null).length > 1 ? '<span class="pill p-green">En düşük</span>' : fark}</td><td>${t.stok === 'var' ? '<span class="pill p-green">Stokta</span>' : t.stok === 'yok' ? '<span class="pill p-red">Yok</span>' : '<span style="color:var(--fg3)">—</span>'}</td><td>${esc(t.termin || '—')}</td><td style="white-space:nowrap">${trKisa(t.tarih)}</td><td style="white-space:nowrap">${t.fiyat > 0 ? `<button class="btn btn-s btn-sm" data-sasip="${esc(t.id)}">Sipariş ver</button> ` : ''}<button class="btn btn-s btn-sm" data-satsil="${esc(t.id)}" aria-label="Sil">${ikon('trash')}</button></td></tr>`; }).join('')}</tbody></table></div></div>`; }).join('')
    : `<div class="card"><div class="empty">${S.sa_teklifler.length ? 'Bu süzgeçle teklif yok' : 'Henüz teklif yok — talepte "Fiyat gir" ya da "+ Teklif ekle" ile başla'}</div></div>`}`;
}
async function saExcel() {
  const gr = saGruplar(); if (!gr.length) { toast('Aktarılacak teklif yok'); return; }
  await syXlsx(); const rows = [];
  gr.forEach(g => g.q.forEach(t => rows.push({'Ürün Kodu': g.ref || '', 'Açıklama': g.aciklama || '', 'Marka': t.marka || '', 'Tedarikçi': t.tedarikci, 'Birim Fiyat': t.fiyat || '', 'Para': t.para, 'TL Karşılığı': t._tl != null ? Math.round(t._tl * 100) / 100 : '', 'En Düşük': t === g.en && g.q.filter(x => x._v != null).length > 1 ? 'Evet' : '', 'Stok': t.stok === 'var' ? 'Var' : t.stok === 'yok' ? 'Yok' : '', 'Termin': t.termin || '', 'Tarih': t.tarih || '', 'Not': t.not || ''})));
  const ws = XLSX.utils.json_to_sheet(rows); ws['!cols'] = [{wch: 20}, {wch: 44}, {wch: 14}, {wch: 26}, {wch: 12}, {wch: 6}, {wch: 14}, {wch: 9}, {wch: 8}, {wch: 14}, {wch: 12}, {wch: 30}];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Fiyat_Analizi');
  TC.indir(new Blob([XLSX.write(wb, {bookType: 'xlsx', type: 'array'})], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}), `Satinalma_Fiyat_Analizi_${bugun()}.xlsx`); toast('⬇ Fiyat analizi indirildi');
}

// ═══ SATIN ALMA (sipariş takibi + rapor) ═══
const saSipAcik = s => SA_ACIK.includes(s.durum || 'verildi');
const saSipGec = s => saSipAcik(s) && s.termin && s.termin < bugun();
function saSiparislerCiz(body) {
  const ay = bugun().slice(0, 7), buAy = {}, acik = S.sa_siparisler.filter(saSipAcik), gec = S.sa_siparisler.filter(saSipGec);
  S.sa_siparisler.filter(s => (s.tarih || '').startsWith(ay) && s.durum !== 'iptal').forEach(s => (s.kalemler || []).forEach(k => { const n = (Number(k.fiyat) || 0) * (Number(k.miktar) || 1); if (n > 0) buAy[k.para || '₺'] = (buAy[k.para || '₺'] || 0) + n; }));
  const chips = [['acik', 'Açık'], ['gecikti', 'Termin geçen'], ...Object.entries(SA_SIP).map(([k, [l]]) => [k, l]), ['', 'Tümü']];
  const l = S.sa_siparisler.filter(s => saSipFiltre === 'acik' ? saSipAcik(s) : saSipFiltre === 'gecikti' ? saSipGec(s) : !saSipFiltre || (s.durum || 'verildi') === saSipFiltre)
    .sort((a, b) => (saSipGec(b) - saSipGec(a)) || (b.tarih || '').localeCompare(a.tarih || ''));
  body.innerHTML = `<div class="tiles" style="grid-template-columns:repeat(3,minmax(0,1fr))"><div class="tile"><div class="lbl"><i style="background:var(--brand)"></i>Açık sipariş</div><div class="val num">${acik.length}</div><div class="hint">teslim bekleyen</div></div>
    <div class="tile"><div class="lbl"><i style="background:var(--red)"></i>Termin geçen</div><div class="val num" style="color:${gec.length ? 'var(--red)' : 'inherit'}">${gec.length}</div><div class="hint">takip gerekli</div></div>
    <div class="tile"><div class="lbl"><i style="background:var(--green)"></i>Bu ay verilen</div><div class="val num" style="font-size:${Object.keys(buAy).length > 1 ? 15 : 20}px">${Object.entries(buAy).map(([p, n]) => saTL(n) + ' ' + p).join('<br>') || '—'}</div><div class="hint">sipariş tutarı</div></div></div>
  <div class="chips">${chips.map(([k, lb]) => `<button class="chip${saSipFiltre === k ? ' on' : ''}" data-sasf="${k}">${lb}</button>`).join('')}</div>
  <div class="card"><div class="rows">${l.length ? l.map(s => { const [dl, dc] = saSipGec(s) ? ['Termin geçti', 'p-red'] : (SA_SIP[s.durum] || SA_SIP.verildi), tut = saTutarYazi(s.kalemler || []);
    return `<button class="row" data-sasip-d="${esc(s.id)}"><div class="ico" style="background:var(--brand-soft);color:var(--brand)">${esc(bas(s.tedarikci))}</div><div class="mid"><div class="t">${esc(s.tedarikci || '—')}</div><div class="s">${esc([s.no, trT(s.tarih), s.termin ? 'Termin ' + trT(s.termin) : '', (s.kalemler || []).length + ' kalem'].filter(Boolean).join(' · '))}</div></div><div class="end">${tut ? `<b class="num" style="font-size:12.5px">${esc(tut)}</b>` : ''}<span class="pill ${dc}" style="margin-top:4px">${dl}</span></div></button>`; }).join('') : '<div class="empty">Sipariş yok</div>'}</div></div>`;
}
function saSipForm(on) {   // on: {tedarikciId, kalemler:[{ref,aciklama,marka,miktar,birim,fiyat,para}], teklifId}
  on = on || {}; const teds = S.tedarikciler.slice().sort((a, b) => (a.ad || '').localeCompare(b.ad || '', 'tr'));
  if (!teds.length) { toast('Önce Tedarikçiler sekmesinden tedarikçi ekle'); return; }
  const yaz = (on.kalemler || []).map(k => [k.ref || k.aciklama, k.miktar, k.fiyat || '', k.fiyat ? k.para : ''].join(' ; ')).join('\n');
  sheet('Satın alma siparişi', `<div class="fg">
    <div class="f"><label for="ssf-ted">Tedarikçi *</label><select class="sel" id="ssf-ted">${teds.map(x => `<option value="${esc(x.id)}"${x.id === on.tedarikciId ? ' selected' : ''}>${esc(x.ad)}</option>`).join('')}</select></div>
    <div class="f"><label for="ssf-kal">Kalemler — her satır: kod ya da ad ; miktar ; birim fiyat ; para *</label><textarea class="inp" id="ssf-kal" rows="5" placeholder="AF09-30-01 ; 23 ; 18,5 ; €">${esc(yaz)}</textarea></div>
    <div class="fg2"><div class="f"><label for="ssf-termin">Beklenen teslim</label><input class="inp" id="ssf-termin" type="date"></div><div class="f"><label for="ssf-sno">Tedarikçi sipariş / PO no</label><input class="inp" id="ssf-sno"></div></div>
    <div class="f"><label for="ssf-not">Not</label><input class="inp" id="ssf-not"></div></div>`,
  [{label: 'Vazgeç', onClick: () => {}}, {label: 'Siparişi kaydet', cls: 'btn-p', onClick: async ov => {
    const kal = String(ov.querySelector('#ssf-kal').value).split('\n').map(s => s.trim()).filter(Boolean).map(s => {
      const p = s.split(/\s*;\s*/), ad = p[0] || '', u = urunBul(ad), m = Number(String(p[1] || '1').replace(',', '.')) || 1, f = Number(String(p[2] || '').replace(',', '.')) || null, para = ['€', '$', '₺'].includes((p[3] || '').trim()) ? p[3].trim() : '€';
      return {ref: u ? u.ref : (/\s/.test(ad) ? '' : ad), aciklama: u ? u.aciklama || '' : (/\s/.test(ad) ? ad : ''), marka: u ? u.marka || '' : '', miktar: m, birim: 'Adet', fiyat: f, para, geldi: false};
    });
    if (!kal.length) { toast('En az bir kalem yaz'); return false; }
    const x = saTed(v(ov, 'ssf-ted'));
    return kaydet('sa_siparisler', {no: saNo('SAS', 'sa_siparisler'), tarih: bugun(), tedarikciId: x.id, tedarikci: x.ad, kalemler: kal, termin: v(ov, 'ssf-termin'), tedarikciSipNo: v(ov, 'ssf-sno'), not: v(ov, 'ssf-not'), durum: 'verildi', teklifId: on.teklifId || '', gecmis: [{t: new Date().toISOString(), d: 'verildi', k: ME}]});
  }}]);
}
function saSipDetay(id) {
  const s = S.sa_siparisler.find(x => x.id === id); if (!s) return;
  const guncel = () => S.sa_siparisler.find(x => x.id === id) || s, k = s.kalemler || [];
  const sh = sheet(s.tedarikci || 'Sipariş', `<div class="rows" style="margin:0 -4px 8px">
    <div class="row" style="padding:8px 4px"><div class="mid"><div class="s">Sipariş no</div><div class="t">${esc(s.no)}${s.tedarikciSipNo ? ' · PO ' + esc(s.tedarikciSipNo) : ''}</div></div><div class="end"><div class="s">Tarih</div><b>${trT(s.tarih)}</b></div></div>
    ${s.termin ? `<div class="row" style="padding:8px 4px"><div class="mid"><div class="s">Beklenen teslim</div><div class="t">${trT(s.termin)}</div></div></div>` : ''}
    ${saTutarYazi(k) ? `<div class="row" style="padding:8px 4px"><div class="mid"><div class="s">Tutar</div><div class="t num">${esc(saTutarYazi(k))}</div></div></div>` : ''}</div>
    <div class="f"><label for="ssd-d">Durum</label><select class="sel" id="ssd-d">${Object.entries(SA_SIP).map(([a, [b]]) => `<option value="${a}"${(s.durum || 'verildi') === a ? ' selected' : ''}>${b}</option>`).join('')}</select></div>
    <div class="fg2" style="margin-top:10px"><div class="f"><label for="ssd-irs">İrsaliye no</label><input class="inp" id="ssd-irs" value="${esc(s.irsaliyeNo)}"></div><div class="f"><label for="ssd-fat">Fatura no</label><input class="inp" id="ssd-fat" value="${esc(s.faturaNo)}"></div></div>
    <div class="vu-h" style="padding-left:0">Kalemler <span>${k.filter(x => x.geldi).length}/${k.length} geldi — geldikçe işaretle</span></div>
    <div class="rows">${k.map((x, i) => `<label class="row hz-row" style="padding:8px 4px"><input type="checkbox" data-ssk="${i}"${x.geldi ? ' checked' : ''}><div class="mid"><div class="t">${esc(x.ref || x.aciklama)}</div>${x.ref && x.aciklama ? `<div class="s">${esc(x.aciklama)}</div>` : ''}</div><div class="end"><b class="num">${esc(x.miktar)}</b><span class="s">${x.fiyat ? esc(fmtF(x.fiyat) + ' ' + x.para) : ''}</span></div></label>`).join('')}</div>
    ${(s.gecmis || []).length ? `<div class="vu-h" style="padding-left:0">Takip geçmişi</div><div class="sp-tl">${(s.gecmis || []).slice().reverse().map(g => `<div><i></i><b>${esc((SA_SIP[g.d] || [g.d])[0])}</b><small>${new Date(g.t).toLocaleString('tr-TR', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'})}</small></div>`).join('')}</div>` : ''}`,
  [{label: 'Sil', onClick: () => { setTimeout(() => confirmSheet('Sipariş silinsin mi?', 'Bu işlem geri alınamaz.', async () => { await BE.sil('sa_siparisler', id); toast('Silindi'); }), 0); }}, {label: 'Kaydet', cls: 'btn-p', onClick: async ov => {
    const c = guncel(), yeni = v(ov, 'ssd-d'), n = {...c, irsaliyeNo: v(ov, 'ssd-irs'), faturaNo: v(ov, 'ssd-fat')};
    if (yeni !== (c.durum || 'verildi')) { n.durum = yeni; n.gecmis = [...(c.gecmis || []), {t: new Date().toISOString(), d: yeni, k: ME}]; }
    return kaydet('sa_siparisler', n);
  }}]);
  sh.el.querySelectorAll('[data-ssk]').forEach(cb => cb.onchange = () => { const c = guncel(), kk = (c.kalemler || []).map((x, i) => i === +cb.dataset.ssk ? {...x, geldi: cb.checked} : x); kaydet('sa_siparisler', {...c, kalemler: kk}); });
}
function saRapor() {
  const sip = S.sa_siparisler.filter(s => s.durum !== 'iptal'), ted = new Map(), ay = new Map();
  sip.forEach(s => (s.kalemler || []).forEach(k => { const n = (Number(k.fiyat) || 0) * (Number(k.miktar) || 1); if (!(n > 0)) return; const p = k.para || '₺';
    const a = ted.get(s.tedarikci) || {}; a[p] = (a[p] || 0) + n; ted.set(s.tedarikci, a); const m = (s.tarih || '').slice(0, 7), b = ay.get(m) || {}; b[p] = (b[p] || 0) + n; ay.set(m, b); }));
  const yaz = o => Object.entries(o).map(([p, n]) => saTL(n) + ' ' + p).join(' · ');
  const sh = sheet('Satın alma raporu', `<p class="note">İptal edilenler hariç, fiyatı girilmiş kalemler. Para birimleri ayrı toplanır.</p>
    <div class="vu-h" style="padding-left:0">Tedarikçiye göre</div><div class="rows">${[...ted.entries()].sort((a, b) => Object.values(b[1]).reduce((x, y) => x + y, 0) - Object.values(a[1]).reduce((x, y) => x + y, 0)).map(([a, o]) => `<div class="row" style="padding:7px 0"><div class="mid"><div class="t">${esc(a)}</div><div class="s">${sip.filter(s => s.tedarikci === a).length} sipariş</div></div><div class="end"><b class="num" style="font-size:12.5px">${esc(yaz(o))}</b></div></div>`).join('') || '<div class="empty">Veri yok</div>'}</div>
    <div class="vu-h" style="padding-left:0">Aya göre</div><div class="rows">${[...ay.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([a, o]) => `<div class="row" style="padding:7px 0"><div class="mid"><div class="t">${esc(a)}</div></div><div class="end"><b class="num" style="font-size:12.5px">${esc(yaz(o))}</b></div></div>`).join('') || '<div class="empty">Veri yok</div>'}</div>`,
  [{label: 'Excel', onClick: async () => { await syXlsx(); const rows = []; sip.forEach(s => (s.kalemler || []).forEach(k => rows.push({'Sipariş No': s.no, 'Tarih': s.tarih, 'Tedarikçi': s.tedarikci, 'Durum': (SA_SIP[s.durum] || SA_SIP.verildi)[0], 'Ürün': k.ref || k.aciklama, 'Miktar': k.miktar, 'Birim Fiyat': k.fiyat || '', 'Para': k.para, 'Tutar': k.fiyat ? Math.round(k.fiyat * (k.miktar || 1) * 100) / 100 : '', 'Termin': s.termin || '', 'Geldi': k.geldi ? 'Evet' : '', 'Fatura No': s.faturaNo || ''})));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Satin_Alma'); TC.indir(new Blob([XLSX.write(wb, {bookType: 'xlsx', type: 'array'})], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}), `Satin_Alma_Raporu_${bugun()}.xlsx`); toast('⬇ Rapor indirildi'); return false; }}, {label: 'Kapat', cls: 'btn-p', onClick: () => {}}]);
}

// ═══ OLAYLAR ═══
document.addEventListener('click', e => {
  const t = e.target.closest('#p-satinalma [data-satab], #sa-yeni-talep, #sa-yeni-teklif, #sa-yeni-sip, #sa-yeni-ted, #sa-rapor, #sa-excel, [data-sated], [data-satalep], [data-sasip], [data-satsil], [data-sasip-d], [data-sasf]'); if (!t) return;
  if (t.dataset.satab) { saTab = t.dataset.satab; lsSet('sa_tab', saTab); saCiz(); }
  else if (t.id === 'sa-yeni-talep') saTalepForm(); else if (t.id === 'sa-yeni-teklif') saTeklifForm(); else if (t.id === 'sa-yeni-sip') saSipForm(); else if (t.id === 'sa-yeni-ted') saTedForm();
  else if (t.id === 'sa-rapor') saRapor(); else if (t.id === 'sa-excel') saExcel().catch(er => toast('⚠ ' + er.message));
  else if (t.dataset.sated) saTedForm(t.dataset.sated); else if (t.dataset.satalep) saTalepDetay(t.dataset.satalep);
  else if (t.dataset.sasipD) saSipDetay(t.dataset.sasipD); else if (t.dataset.sasf !== undefined) { saSipFiltre = t.dataset.sasf; saCiz(); }
  else if (t.dataset.satsil) confirmSheet('Teklif silinsin mi?', 'Bu fiyat bilgisi analizden kalkar.', async () => { await BE.sil('sa_teklifler', t.dataset.satsil); toast('Silindi'); });
  else if (t.dataset.sasip) { const q = S.sa_teklifler.find(x => x.id === t.dataset.sasip); if (q) saSipForm({tedarikciId: q.tedarikciId, teklifId: q.id, kalemler: [{ref: q.ref, aciklama: q.aciklama, miktar: q.miktar, fiyat: q.fiyat, para: q.para}]}); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'sa-ara') { saF.q = e.target.value; clearTimeout(saCiz.t); saCiz.t = setTimeout(() => { const p = e.target.selectionStart; saCiz(); const n = $('#sa-ara'); if (n) { n.focus(); n.setSelectionRange(p, p); } }, 250); }
  else if (e.target.id === 'sa-kur-usd' || e.target.id === 'sa-kur-eur') { clearTimeout(saCiz.k); saCiz.k = setTimeout(() => { const k = saKur(); k[e.target.id === 'sa-kur-usd' ? '$' : '€'] = Number(String(e.target.value).replace(',', '.')) || 0; lsSet('sa_kur', k); const id = e.target.id, p = e.target.selectionStart; saCiz(); const n = $('#' + id); if (n) { n.focus(); n.setSelectionRange(p, p); } }, 500); }
});
document.addEventListener('change', e => {
  const m = {'sa-f-ted': 'ted', 'sa-f-para': 'para', 'sa-f-stok': 'stok'}[e.target.id];
  if (m) { saF[m] = e.target.value; saCiz(); } else if (e.target.id === 'sa-f-donem') { saF.donem = Number(e.target.value) || 0; saCiz(); } else if (e.target.id === 'sa-f-en') { saF.enDusuk = e.target.checked; saCiz(); }
});
