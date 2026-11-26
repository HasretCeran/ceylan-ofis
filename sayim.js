'use strict';
/* Ceylan Ofis — Stok sayımı: ekip telefondan sayar, aynı anda birden çok kişi girebilir.
   Her giriş ayrı satırdır (çakışma olmaz); toplamlar koda göre birleşir. Sonunda DİA'ya aktarım için Excel alınır. */
let sayimAktif = null, sySon = {konum: ''}, syFiltre = '';
const SYLIB = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const syKey = s => refN(s) || nrmTR(s).replace(/\s+/g, ' ').trim();

function syKalemler(id) { return S.sayim_kalem.filter(k => k.sayimId === id); }
function syGrupla(id) {
  const m = new Map();
  for (const k of syKalemler(id)) {
    const key = syKey(k.ref || k.aciklama);
    if (!m.has(key)) m.set(key, {ref: k.ref, aciklama: k.aciklama, marka: k.marka, birim: k.birim || 'Adet', toplam: 0, girisler: [], konumlar: new Set(), listede: !!k.stokId});
    const g = m.get(key); g.toplam += Number(k.miktar) || 0; g.girisler.push(k); if (k.konum) g.konumlar.add(k.konum);
    if (!g.aciklama && k.aciklama) g.aciklama = k.aciklama;
  }
  return [...m.values()].sort((a, b) => (a.marka || '').localeCompare(b.marka || '', 'tr') || (a.ref || '').localeCompare(b.ref || ''));
}

function sayimCiz() {
  const el = $('#p-sayim'); if (!el) return;
  if (sayimAktif && !S.sayimlar.find(s => s.id === sayimAktif)) sayimAktif = null;
  $('#sy-liste').hidden = !!sayimAktif; $('#sy-detay').hidden = !sayimAktif;
  if (!sayimAktif) {
    const l = S.sayimlar.slice().sort((a, b) => (b.tarih || '').localeCompare(a.tarih || ''));
    $('#sy-list').innerHTML = l.length ? l.map(s => {
      const k = syKalemler(s.id), kisi = new Set(k.map(x => x.by)).size, urun = new Set(k.map(x => syKey(x.ref || x.aciklama))).size;
      return `<button class="row" data-sy="${esc(s.id)}"><div class="ico" style="background:var(--brand-soft);color:var(--brand)">${ikon('box')}</div>
        <div class="mid"><div class="t">${esc(s.ad)}</div><div class="s">${esc([trT(s.tarih), s.depo, urun + ' ürün', k.length + ' giriş', kisi ? kisi + ' kişi' : ''].filter(Boolean).join(' · '))}</div></div>
        <div class="end"><span class="pill ${s.durum === 'kapali' ? 'p-green' : 'p-amber'}">${s.durum === 'kapali' ? 'Tamamlandı' : 'Sayılıyor'}</span></div></button>`;
    }).join('') : '<div class="empty">Henüz sayım yok — "Yeni sayım" ile başla</div>';
    return;
  }
  const s = S.sayimlar.find(x => x.id === sayimAktif), kapali = s.durum === 'kapali';
  const g = syGrupla(s.id), q = nrmTR(syFiltre);
  $('#sy-baslik').textContent = s.ad;
  $('#sy-alt').textContent = [trT(s.tarih), s.depo, g.length + ' ürün', syKalemler(s.id).length + ' giriş', kapali ? 'Tamamlandı' : 'Sayılıyor'].filter(Boolean).join(' · ');
  $('#sy-giris').hidden = kapali;
  $('#sy-kapat').hidden = kapali || !IS_OWNER; $('#sy-ac').hidden = !kapali || !IS_OWNER;
  const gl = g.filter(x => !q || nrmTR([x.ref, x.aciklama, x.marka, [...x.konumlar].join(' ')].join(' ')).includes(q));
  $('#sy-toplam').innerHTML = gl.length ? gl.map((x, i) => `<button class="row" data-syg="${esc(syKey(x.ref || x.aciklama))}">
      <div class="mid"><div class="t">${esc(x.ref || 'Kodsuz')} ${x.marka ? `<span style="color:var(--fg3);font-weight:500">· ${esc(x.marka)}</span>` : ''}${x.listede ? '' : ' <span class="pill p-amber" style="margin-left:4px">listede yok</span>'}</div>
      <div class="s">${esc(x.aciklama || '')}${x.konumlar.size ? ' · 📍' + esc([...x.konumlar].join(', ')) : ''}</div></div>
      <div class="end"><b class="num" style="font-size:16px">${fmtM(x.toplam)}</b><span class="s">${esc(x.birim)}${x.girisler.length > 1 ? ' · ' + x.girisler.length + ' giriş' : ''}</span></div></button>`).join('') : '<div class="empty">Henüz sayılan ürün yok</div>';
  const benim = syKalemler(s.id).filter(k => k.by === ME).sort((a, b) => (b.zaman || '').localeCompare(a.zaman || '')).slice(0, 5);
  $('#sy-son').innerHTML = benim.length ? '<div class="vu-h" style="padding-left:0">Son girişlerin</div>' + benim.map(k => `<div class="row" style="padding:6px 0"><div class="mid"><div class="t">${esc(k.ref || k.aciklama)}</div><div class="s">${esc(k.konum || '')}</div></div><div class="end"><b class="num">${fmtM(k.miktar)} ${esc(k.birim || '')}</b>${kapali ? '' : `<button class="btn btn-s btn-sm" data-sysil="${esc(k.id)}" style="margin-top:4px">Geri al</button>`}</div></div>`).join('') : '';
}
const fmtM = n => Number(n || 0).toLocaleString('tr-TR', {maximumFractionDigits: 3});

// ── Giriş: ürün seç, miktar yaz, Enter
let syUrun = null;
function syOneri() {
  const q = $('#sy-kod').value.trim(); syUrun = null; $('#sy-yeni').hidden = true;
  const box = $('#sy-oneri');
  if (q.length < 2) { box.hidden = true; return; }
  const l = urunAra(q, 8);
  box.innerHTML = l.map(u => `<button class="row" data-syu="${esc(u.id)}" style="padding:8px 10px"><div class="mid"><div class="t">${esc(u.ref)} <span style="color:var(--fg3);font-weight:500">· ${esc(u.marka || '')}</span></div><div class="s">${esc(u.aciklama || '')}</div></div>${u.stok !== '' && u.stok != null ? `<div class="end"><span class="s">kayıtlı: ${fmtM(u.stok)}</span></div>` : ''}</button>`).join('') + `<button class="row" data-syu="" style="padding:8px 10px"><div class="mid"><div class="t">➕ "${esc(q)}" listede yok — yeni olarak say</div></div></button>`;
  box.hidden = false;
}
function sySec(id) {
  $('#sy-oneri').hidden = true;
  if (id) { syUrun = S.stok.find(u => u.id === id); $('#sy-kod').value = syUrun.ref; $('#sy-secili').textContent = (syUrun.marka ? syUrun.marka + ' · ' : '') + (syUrun.aciklama || ''); $('#sy-yeni').hidden = true; }
  else { syUrun = null; $('#sy-secili').textContent = 'Listede olmayan ürün — açıklamasını yaz'; $('#sy-yeni').hidden = false; }
  $('#sy-miktar').focus(); $('#sy-miktar').select();
}
async function syEkle() {
  const kod = $('#sy-kod').value.trim(), m = Number(String($('#sy-miktar').value).replace(',', '.'));
  if (!kod) { toast('Ürün kodu ya da adı yaz'); $('#sy-kod').focus(); return; }
  if (!(m >= 0) || $('#sy-miktar').value === '') { toast('Miktar gir'); $('#sy-miktar').focus(); return; }
  const u = syUrun || urunBul(kod), konum = $('#sy-konum').value.trim();
  const k = {id: newId(), sayimId: sayimAktif, ref: u ? u.ref : kod, aciklama: u ? u.aciklama || '' : $('#sy-aciklama').value.trim(), marka: u ? u.marka || '' : $('#sy-marka').value.trim(),
    birim: $('#sy-birim').value || 'Adet', miktar: m, konum, stokId: u ? u.id : '', zaman: new Date().toISOString(), sayan: P[ME] ? P[ME].ad : ''};
  sySon.konum = konum;
  if (await kaydet('sayim_kalem', k)) {
    toast(`✓ ${k.ref} · ${fmtM(m)} ${k.birim}`);
    $('#sy-kod').value = ''; $('#sy-miktar').value = ''; $('#sy-aciklama').value = ''; $('#sy-marka').value = ''; $('#sy-secili').textContent = ''; $('#sy-yeni').hidden = true; syUrun = null;
    $('#sy-kod').focus();
  }
}

// ── Çıktılar
async function syXlsx() { if (!window.XLSX) await new Promise((ok, no) => { const s = document.createElement('script'); s.src = SYLIB; s.onload = ok; s.onerror = () => no(new Error('Excel kütüphanesi yüklenemedi')); document.head.appendChild(s); }); }
async function syDiaDosya(id) {
  const s = S.sayimlar.find(x => x.id === id), g = syGrupla(id);
  if (!g.length) { toast('Sayımda ürün yok'); return; }
  await syXlsx();
  // DİA sayım fişine aktarım için sade liste: başlık 1. satırda, birleştirilmiş hücre yok
  const rows = g.map(x => ({'Stok Kodu': x.ref || '', 'Stok Adı': x.aciklama || '', 'Marka': x.marka || '', 'Birim': x.birim || 'Adet', 'Sayılan Miktar': x.toplam, 'Depo': s.depo || '', 'Raf / Konum': [...x.konumlar].join(', '), 'Listede': x.listede ? 'Evet' : 'Hayır'}));
  const ws = XLSX.utils.json_to_sheet(rows); ws['!cols'] = [{wch: 22}, {wch: 50}, {wch: 14}, {wch: 8}, {wch: 14}, {wch: 14}, {wch: 18}, {wch: 8}];
  const ay = XLSX.utils.json_to_sheet(syKalemler(id).sort((a, b) => (a.zaman || '').localeCompare(b.zaman || '')).map(k => ({'Zaman': k.zaman ? new Date(k.zaman).toLocaleString('tr-TR') : '', 'Sayan': k.sayan || adi(k.by), 'Stok Kodu': k.ref, 'Stok Adı': k.aciklama, 'Miktar': Number(k.miktar) || 0, 'Birim': k.birim, 'Raf / Konum': k.konum || ''})));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'DIA_Aktarim'); XLSX.utils.book_append_sheet(wb, ay, 'Giris_Detay');
  const blob = new Blob([XLSX.write(wb, {bookType: 'xlsx', type: 'array'})], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  TC.indir(blob, `Sayim_${(s.ad || 'stok').replace(/[^\wçğıöşüÇĞİÖŞÜ-]+/g, '_')}_${s.tarih || bugun()}.xlsx`);
  toast('⬇ DİA aktarım dosyası indirildi');
}
// Sayımı kapat: sayılan miktarlar ürün kartlarına "stok" olarak yazılır, listede olmayanlar ürün olarak eklenir
async function syKapat(id) {
  const s = S.sayimlar.find(x => x.id === id), g = syGrupla(id);
  confirmSheet('Sayım tamamlansın mı?', `${g.length} ürünün sayılan miktarı uygulamadaki stok bilgisine yazılacak. Listede olmayan ${g.filter(x => !x.listede).length} ürün ürün listesine eklenecek. DİA'ya dokunulmaz.`, async () => {
    toast('Stoklar güncelleniyor…');
    let n = 0;
    for (const x of g) {
      const u = (x.girisler.find(k => k.stokId) && S.stok.find(z => z.id === x.girisler.find(k => k.stokId).stokId)) || urunBul(x.ref);
      const o = u ? {...u, stok: x.toplam, sayimTarih: s.tarih, sayimId: id} : {ref: x.ref, aciklama: x.aciklama, marka: x.marka, birim: x.birim, stok: x.toplam, fiyat: '', para: '₺', sayimTarih: s.tarih, sayimId: id, kaynak: 'Stok sayımı ' + trT(s.tarih)};
      delete o._ix;
      if (await kaydet('stok', o)) n++;
    }
    await kaydet('sayimlar', {...s, durum: 'kapali', kapanis: new Date().toISOString()});
    toast(`✅ Sayım tamamlandı · ${n} ürün güncellendi`);
  });
}

function sayimForm() {
  sheet('Yeni sayım', `<div class="fg">
    <div class="f"><label for="syf-ad">Sayım adı *</label><input class="inp" id="syf-ad" value="Stok sayımı ${new Date().toLocaleDateString('tr-TR', {month: 'long', year: 'numeric'})}"></div>
    <div class="fg2"><div class="f"><label for="syf-depo">Depo</label><input class="inp" id="syf-depo" value="Merkez depo"></div>
    <div class="f"><label for="syf-tarih">Tarih</label><input class="inp" id="syf-tarih" type="date" value="${bugun()}"></div></div>
    <p class="note">Sayımı açtıktan sonra ekipteki herkes kendi telefonundan aynı sayıma giriş yapabilir.</p></div>`,
  [{label: 'Vazgeç', onClick: () => {}}, {label: 'Sayımı başlat', cls: 'btn-p', onClick: async ov => {
    const ad = v(ov, 'syf-ad'); if (!ad) { toast('Sayım adı gerekli'); return false; }
    const o = {id: newId(), ad, depo: v(ov, 'syf-depo'), tarih: v(ov, 'syf-tarih') || bugun(), durum: 'acik'};
    if (await kaydet('sayimlar', o)) { sayimAktif = o.id; sayimCiz(); }
  }}]);
}

function syGrupDetay(key) {
  const x = syGrupla(sayimAktif).find(z => syKey(z.ref || z.aciklama) === key); if (!x) return;
  const kapali = (S.sayimlar.find(s => s.id === sayimAktif) || {}).durum === 'kapali';
  const sh = sheet(x.ref || 'Kodsuz ürün', `<p class="note">${esc(x.aciklama || '')} — toplam <b>${fmtM(x.toplam)} ${esc(x.birim)}</b></p>
    <div class="rows">${x.girisler.map(k => `<div class="row" style="padding:8px 0"><div class="mid"><div class="t">${fmtM(k.miktar)} ${esc(k.birim || '')}${k.konum ? ' · 📍' + esc(k.konum) : ''}</div><div class="s">${esc(k.sayan || adi(k.by))} · ${k.zaman ? new Date(k.zaman).toLocaleString('tr-TR', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) : ''}</div></div>${!kapali && (k.by === ME || IS_OWNER) ? `<div class="end"><button class="btn btn-s btn-sm" data-sysil="${esc(k.id)}">Sil</button></div>` : ''}</div>`).join('')}</div>`, [{label: 'Kapat', cls: 'btn-p', onClick: () => {}}]);
  sh.el.querySelectorAll('[data-sysil]').forEach(b => b.onclick = async () => { await BE.sil('sayim_kalem', b.dataset.sysil); sh.kapat(); toast('Giriş silindi'); });
}

// ── Olaylar
$('#sy-yeni-btn').onclick = sayimForm;
$('#sy-list').onclick = e => { const r = e.target.closest('[data-sy]'); if (r) { sayimAktif = r.dataset.sy; syFiltre = ''; $('#sy-ara').value = ''; sayimCiz(); window.scrollTo({top: 0}); } };
$('#sy-geri').onclick = () => { sayimAktif = null; sayimCiz(); };
$('#sy-kod').oninput = syOneri;
$('#sy-kod').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const f = $('#sy-oneri [data-syu]'); if (f && !$('#sy-oneri').hidden) sySec(f.dataset.syu); else $('#sy-miktar').focus(); } };
$('#sy-oneri').onclick = e => { const b = e.target.closest('[data-syu]'); if (b) sySec(b.dataset.syu); };
$('#sy-miktar').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); syEkle(); } };
$('#sy-ekle').onclick = syEkle;
$('#sy-ara').oninput = e => { syFiltre = e.target.value; sayimCiz(); };
$('#sy-toplam').onclick = e => { const r = e.target.closest('[data-syg]'); if (r) syGrupDetay(r.dataset.syg); };
$('#sy-son').onclick = async e => { const b = e.target.closest('[data-sysil]'); if (b) { await BE.sil('sayim_kalem', b.dataset.sysil); toast('Giriş geri alındı'); } };
$('#sy-dia').onclick = () => syDiaDosya(sayimAktif).catch(e => toast('⚠ ' + e.message));
$('#sy-kapat').onclick = () => syKapat(sayimAktif);
$('#sy-ac').onclick = async () => { const s = S.sayimlar.find(x => x.id === sayimAktif); await kaydet('sayimlar', {...s, durum: 'acik'}); toast('Sayım yeniden açıldı'); };
sayimCiz();
