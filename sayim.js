'use strict';
/* Ceylan Ofis — Stok sayımı: ekip telefondan sayar, aynı anda birden çok kişi girebilir.
   Her giriş ayrı satırdır (çakışma olmaz); toplamlar koda göre birleşir. Sonunda DİA'ya aktarım için Excel alınır. */
let sayimAktif = null, sySon = {konum: ''}, syFiltre = '';
const SYLIB = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const syKey = s => refN(s) || nrmTR(s).replace(/\s+/g, ' ').trim();

// ── Çevrimdışı kuyruk: depoda internet koparsa girişler telefonda bekler, bağlantı gelince kendiliğinden gönderilir
const SYQ = 'sy_kuyruk';
let syKuyruk = (() => { try { const a = JSON.parse(localStorage.getItem(SYQ) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } })();
const syQYaz = () => { try { localStorage.setItem(SYQ, JSON.stringify(syKuyruk)); } catch (e) {} };
const syQSay = id => syKuyruk.filter(k => !id || k.sayimId === id).length;
function syKalemler(id) {
  const ids = new Set(S.sayim_kalem.map(k => k.id));
  return [...S.sayim_kalem, ...syKuyruk.filter(k => !ids.has(k.id))].filter(k => k.sayimId === id);
}
const syAgHatasi = e => /fetch|network|timeout|load failed|internet|offline/i.test(String(e && (e.message || e)));
function syIsle(data) { const o = rowToObj(data), i = S.sayim_kalem.findIndex(x => x.id === o.id); if (i >= 0) S.sayim_kalem[i] = o; else S.sayim_kalem.push(o); }
function syKuyruga(k) { syKuyruk.push({...k, by: ME, _q: 1}); syQYaz(); degisti('sayim_kalem'); return true; }
async function syYaz(k) {
  if (DEMO || !sb) return kaydet('sayim_kalem', k);
  if (!navigator.onLine) return syKuyruga(k);
  try {
    const r = await Promise.race([sb.from('sayim_kalem').upsert({id: k.id, veri: bodyOf(k)}).select().single(), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 9000))]);
    if (r.error) { if (syAgHatasi(r.error)) return syKuyruga(k); hata(r.error); return false; }
    syIsle(r.data); degisti('sayim_kalem'); return true;
  } catch (e) { return syKuyruga(k); }
}
let syQCalis = false;
async function syKuyrukGonder() {
  if (DEMO || !sb || syQCalis || !syKuyruk.length || !navigator.onLine) return;
  syQCalis = true; let n = 0;
  try {
    for (const k of syKuyruk.slice()) {
      const {_q, by, ...temiz} = k;
      const {data, error} = await sb.from('sayim_kalem').upsert({id: k.id, veri: bodyOf(temiz)}).select().single();
      if (error) break;
      syKuyruk = syKuyruk.filter(x => x.id !== k.id); syQYaz(); syIsle(data); n++;
    }
  } catch (e) {}
  syQCalis = false;
  if (n) { degisti('sayim_kalem'); toast(`✅ Bekleyen ${n} sayım girişi gönderildi`); }
}
async function sySil(id) {
  if (syKuyruk.some(k => k.id === id)) { syKuyruk = syKuyruk.filter(k => k.id !== id); syQYaz(); degisti('sayim_kalem'); return true; }
  return BE.sil('sayim_kalem', id);
}
window.addEventListener('online', syKuyrukGonder);
setInterval(syKuyrukGonder, 20000);
setTimeout(syKuyrukGonder, 4000);

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
  if (sm) { smUst(); smSon(); }
  const el = $('#p-sayim'); if (!el) return;
  syBanner();
  if (sayimAktif && !S.sayimlar.find(s => s.id === sayimAktif)) sayimAktif = null;
  $('#sy-liste').hidden = !!sayimAktif; $('#sy-detay').hidden = !sayimAktif;
  if (!sayimAktif) {
    const l = S.sayimlar.slice().sort((a, b) => (b.tarih || '').localeCompare(a.tarih || ''));
    $('#sy-list').innerHTML = l.length ? l.map(s => {
      const k = syKalemler(s.id), kisi = new Set(k.map(x => x.by)).size, urun = new Set(k.map(x => syKey(x.ref || x.aciklama))).size, q = syQSay(s.id);
      return `<button class="row" data-sy="${esc(s.id)}"><div class="ico" style="background:var(--brand-soft);color:var(--brand)">${ikon('box')}</div>
        <div class="mid"><div class="t">${esc(s.ad)}</div><div class="s">${esc([trT(s.tarih), s.depo, urun + ' ürün', k.length + ' giriş', kisi ? kisi + ' kişi' : '', q ? '⏳ ' + q + ' gönderilmeyi bekliyor' : ''].filter(Boolean).join(' · '))}</div></div>
        <div class="end"><span class="pill ${s.durum === 'kapali' ? 'p-green' : 'p-amber'}">${s.durum === 'kapali' ? 'Tamamlandı' : 'Sayılıyor'}</span></div></button>`;
    }).join('') : '<div class="empty">Henüz sayım yok — "Yeni sayım" ile başla</div>';
    return;
  }
  const s = S.sayimlar.find(x => x.id === sayimAktif), kapali = s.durum === 'kapali';
  const g = syGrupla(s.id), q = nrmTR(syFiltre);
  $('#sy-baslik').textContent = s.ad;
  const bq = syQSay(s.id);
  $('#sy-alt').textContent = [trT(s.tarih), s.depo, g.length + ' ürün', syKalemler(s.id).length + ' giriş', kapali ? 'Tamamlandı' : 'Sayılıyor', bq ? '⏳ ' + bq + ' giriş internet bekliyor' : ''].filter(Boolean).join(' · ');
  $('#sy-giris').hidden = kapali; $('#sy-dosya').hidden = kapali;
  const sd = s.dosyalar || []; $('#sy-belge').parentElement.hidden = !sd.length; $('#sy-belge').innerHTML = sd.length ? '<div class="vu-h" style="padding-left:0">Yüklenen belgeler <span>' + sd.length + '</span></div>' + sd.map((f, i) => `<button class="row" style="padding:8px 0" data-sybel="${i}"><div class="mid"><div class="t">${/image/.test(f.tip) ? '🖼' : '📄'} ${esc(f.ad)}</div><div class="s">${f.at ? new Date(f.at).toLocaleString('tr-TR') : ''}</div></div><div class="end"><span class="s">Aç</span></div></button>`).join('') : '';
  $('#sy-kapat').hidden = kapali || !IS_OWNER; $('#sy-ac').hidden = !kapali || !IS_OWNER;
  g.forEach(x => { const k = syKayitli(s, x); x.kayitli = k; x.fark = k === '' ? null : x.toplam - k; });
  const sayilmayan = sySayilmayan(s, g);
  const cips = [['', 'Tümü', g.length], ['fark', 'Fark var', g.filter(x => x.fark).length], ['yok', 'Listede yok', g.filter(x => !x.listede).length], ['sayilmadi', 'Sayılmayanlar', sayilmayan.length]];
  $('#sy-chips').innerHTML = cips.map(([k, l, n]) => `<button class="chip${syGor === k ? ' on' : ''}" data-sygor="${k}">${l} · ${n}</button>`).join('');
  $('#sy-toplam-h').textContent = syGor === 'sayilmadi' ? 'Kayıtlı stoğu olup sayılmayanlar' : syGor === 'fark' ? 'Sayılan ≠ kayıtlı stok' : syGor === 'yok' ? 'Ürün listesinde olmayanlar' : 'Sayılan ürünler';
  const ara = x => !q || nrmTR([x.ref, x.aciklama, x.marka, x.konumlar ? [...x.konumlar].join(' ') : ''].join(' ')).includes(q);
  if (syGor === 'sayilmadi') {
    const l = sayilmayan.filter(ara);
    $('#sy-toplam').innerHTML = l.length ? l.slice(0, 300).map(u => `<button class="row" data-sysay="${esc(u.id)}"><div class="mid"><div class="t">${esc(u.ref)} ${u.marka ? `<span style="color:var(--fg3);font-weight:500">· ${esc(u.marka)}</span>` : ''}</div><div class="s">${esc(u.aciklama || '')}</div></div><div class="end"><b class="num">${fmtM(u.stok)}</b><span class="s">kayıtlı${kapali ? '' : ' · say →'}</span></div></button>`).join('') + (l.length > 300 ? `<div class="empty">+${l.length - 300} ürün daha — aramayla daralt</div>` : '') : '<div class="empty">Kayıtlı stoğu olan tüm ürünler sayılmış 👍</div>';
  } else {
    const gl = g.filter(x => ara(x) && (syGor !== 'fark' || x.fark) && (syGor !== 'yok' || !x.listede));
    $('#sy-toplam').innerHTML = gl.length ? gl.map(x => `<button class="row" data-syg="${esc(syKey(x.ref || x.aciklama))}">
      <div class="mid"><div class="t">${esc(x.ref || 'Kodsuz')} ${x.marka ? `<span style="color:var(--fg3);font-weight:500">· ${esc(x.marka)}</span>` : ''}${x.listede ? '' : ' <span class="pill p-amber" style="margin-left:4px">listede yok</span>'}${x.girisler.some(k => k._q) ? ' <span class="pill p-gray" style="margin-left:4px">⏳ bekliyor</span>' : ''}</div>
      <div class="s">${esc(x.aciklama || '')}${x.konumlar.size ? ' · 📍' + esc([...x.konumlar].join(', ')) : ''}</div></div>
      <div class="end"><b class="num" style="font-size:16px">${fmtM(x.toplam)}</b><span class="s">${esc(x.birim)}${x.girisler.length > 1 ? ' · ' + x.girisler.length + ' giriş' : ''}</span>${x.fark ? `<span class="sy-fark ${x.fark > 0 ? 'art' : 'eks'}">kayıtlı ${fmtM(x.kayitli)} · ${x.fark > 0 ? '+' : ''}${fmtM(x.fark)}</span>` : ''}</div></button>`).join('') : `<div class="empty">${g.length ? 'Bu filtrede ürün yok' : 'Henüz sayılan ürün yok'}</div>`;
  }
  const benim = syKalemler(s.id).filter(k => k.by === ME).sort((a, b) => (b.zaman || '').localeCompare(a.zaman || '')).slice(0, 5);
  $('#sy-son').innerHTML = benim.length ? '<div class="vu-h" style="padding-left:0">Son girişlerin</div>' + benim.map(k => `<div class="row" style="padding:6px 0"><div class="mid"><div class="t">${esc(k.ref || k.aciklama)}${k._q ? ' <span class="pill p-gray">⏳ bekliyor</span>' : ''}</div><div class="s">${esc(k.konum || '')}</div></div><div class="end"><b class="num">${fmtM(k.miktar)} ${esc(k.birim || '')}</b>${kapali ? '' : `<div style="display:flex;gap:6px;margin-top:4px;justify-content:flex-end"><button class="btn btn-s btn-sm" data-syduz="${esc(k.id)}">✎ Düzelt</button><button class="btn btn-s btn-sm" data-sysil="${esc(k.id)}">Geri al</button></div>`}</div></div>`).join('') : '';
}
let syGor = '';
// Kayıtlı stok: sayım kapanınca ürün kartındaki stok sayılanla değişir, o yüzden önceki değer saklanır
function syUrunu(x) { const k = x.girisler.find(z => z.stokId); return (k && S.stok.find(u => u.id === k.stokId)) || urunBul(x.ref); }
function syKayitli(s, x) {
  const u = syUrunu(x); if (!u) return '';
  const v = u.sayimId === s.id && 'oncekiStok' in u ? u.oncekiStok : u.stok;
  return v === '' || v == null || isNaN(Number(v)) ? '' : Number(v);
}
function sySayilmayan(s, g) {
  const say = new Set(); g.forEach(x => { x.girisler.forEach(k => k.stokId && say.add(k.stokId)); if (x.ref) say.add('r:' + refN(x.ref)); });
  return S.stok.filter(u => Number(u.stok) > 0 && !(u.sayimId === s.id) && !say.has(u.id) && !say.has('r:' + refN(u.ref))).sort((a, b) => (a.marka || '').localeCompare(b.marka || '', 'tr') || (a.ref || '').localeCompare(b.ref || ''));
}
const fmtM = n => Number(n || 0).toLocaleString('tr-TR', {maximumFractionDigits: 3});

// ── Girişi sonradan düzelt: miktar, birim, raf ve ürün (kod / açıklama) değiştirilebilir; eski miktar kayıtta saklanır
async function syGuncelle(k) {
  const i = syKuyruk.findIndex(x => x.id === k.id);
  if (i >= 0) { syKuyruk[i] = {...k, by: syKuyruk[i].by, _q: 1}; syQYaz(); degisti('sayim_kalem'); return true; }
  const {_q, by, at, ...temiz} = k; return syYaz(temiz);
}
function syDuzeltForm(id) {
  const k = [...S.sayim_kalem, ...syKuyruk].find(x => x.id === id); if (!k) { toast('Giriş bulunamadı'); return; }
  const s = S.sayimlar.find(x => x.id === k.sayimId);
  if (!s || s.durum === 'kapali') { toast('Tamamlanmış sayım düzeltilemez — önce "Yeniden aç"'); return; }
  if (!(k.by === ME || IS_OWNER)) { toast('⛔ Sadece kendi girişini düzeltebilirsin'); return; }
  const birimler = [...new Set([k.birim || 'Adet', 'Adet', 'Mt', 'Kg', 'Paket', 'Kutu', 'Takım', 'Rulo'])];
  const zaman = k.zaman ? new Date(k.zaman).toLocaleString('tr-TR', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) : '';
  sheet('Girişi düzelt', `<div class="fg">
    <p class="note">${esc(k.sayan || adi(k.by))} · ${esc(zaman)}${k.duzeltildi ? ' · daha önce düzeltilmiş' : ''}<br>İlk girilen: <b>${fmtM(k.eskiMiktar != null ? k.eskiMiktar : k.miktar)} ${esc(k.birim || '')}</b></p>
    <div class="fg2"><div class="f"><label for="syd-m">Miktar *</label><input class="inp num" id="syd-m" inputmode="decimal" value="${esc(String(k.miktar).replace('.', ','))}"></div>
    <div class="f"><label for="syd-b">Birim</label><select class="sel" id="syd-b">${birimler.map(b => `<option${b === (k.birim || 'Adet') ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select></div></div>
    <div class="f"><label for="syd-k">Raf / konum</label><input class="inp" id="syd-k" value="${esc(k.konum || '')}"></div>
    <div class="f"><label for="syd-r">Ürün kodu</label><input class="inp" id="syd-r" value="${esc(k.ref || '')}" autocapitalize="characters"></div>
    <div class="f"><label for="syd-a">Açıklama</label><input class="inp" id="syd-a" value="${esc(k.aciklama || '')}"></div>
    <p class="note">Ürün kodunu değiştirirsen ve listede varsa açıklama/marka otomatik gelir.</p></div>`,
  [{label: 'Vazgeç', onClick: () => {}}, {label: 'Kaydet', cls: 'btn-p', onClick: async ov => {
    const m = Number(String(v(ov, 'syd-m')).replace(',', '.'));
    if (v(ov, 'syd-m') === '' || !(m >= 0)) { toast('Geçerli bir miktar gir'); return false; }
    const ref = v(ov, 'syd-r'); let ac = v(ov, 'syd-a'); if (!ref && !ac) { toast('Ürün kodu ya da açıklama gerekli'); return false; }
    const u = ref ? urunBul(ref) : null, kodDegisti = refN(ref) !== refN(k.ref);
    const yeni = {...k, miktar: m, birim: v(ov, 'syd-b') || 'Adet', konum: v(ov, 'syd-k'), ref: u ? u.ref : ref,
      aciklama: u && (kodDegisti || !ac) ? u.aciklama || ac : ac, marka: u ? u.marka || '' : k.marka || '', stokId: u ? u.id : (kodDegisti ? '' : k.stokId || ''),
      duzeltildi: true, duzeltmeZaman: new Date().toISOString(), duzelten: ME, eskiMiktar: k.eskiMiktar != null ? k.eskiMiktar : k.miktar};
    if (yeni.miktar === k.miktar && yeni.birim === k.birim && yeni.konum === (k.konum || '') && yeni.ref === k.ref && yeni.aciklama === (k.aciklama || '')) { toast('Değişiklik yok'); return true; }
    if (await syGuncelle(yeni)) { toast(`✎ Düzeltildi · ${yeni.ref || yeni.aciklama} · ${fmtM(m)} ${yeni.birim}`); return true; }
    return false;
  }}]);
}

// ── Giriş: ürün seç, miktar yaz, Enter
let syUrun = null;
function syOneri() {
  const q = $('#sy-kod').value.trim(); syUrun = null; $('#sy-yeni').hidden = true;
  const box = $('#sy-oneri');
  if (q.length < 2) { box.hidden = true; return; }
  const l = urunAra(q, 8);
  box.innerHTML = l.map(u => `<button class="row" data-syu="${esc(u.id)}" style="padding:8px 10px"><div class="mid"><div class="t">${esc(u.ref)} <span style="color:var(--fg3);font-weight:500">· ${esc(u.marka || '')}</span></div><div class="s">${esc(u.aciklama || '')}</div></div>${u.stok !== '' && u.stok != null ? `<div class="end"><span class="s">kayıtlı: ${fmtM(u.stok)}</span></div>` : ''}</button>`).join('') + `<button class="row" data-syu="" style="padding:8px 10px"><div class="mid"><div class="t">➕ "${esc(q)}" listede yok — yeni olarak say</div></div></button>`;
  box.hidden = false; syIsaret = 0; syIsaretCiz();
}
let syIsaret = 0;
function syIsaretCiz() { $$('#sy-oneri [data-syu]').forEach((b, i) => b.classList.toggle('on', i === syIsaret)); const o = $$('#sy-oneri [data-syu]')[syIsaret]; if (o) o.scrollIntoView({block: 'nearest'}); }
function sySec(id) {
  $('#sy-oneri').hidden = true;
  if (id) { syUrun = S.stok.find(u => u.id === id); $('#sy-kod').value = syUrun.ref; $('#sy-secili').textContent = (syUrun.marka ? syUrun.marka + ' · ' : '') + (syUrun.aciklama || ''); $('#sy-yeni').hidden = true; }
  else { syUrun = null; $('#sy-secili').textContent = 'Listede olmayan ürün — açıklamasını yaz'; $('#sy-yeni').hidden = false; }
  if (id) { $('#sy-miktar').focus(); $('#sy-miktar').select(); }
  else $('#sy-aciklama').focus();
}
async function syEkle() {
  const kod = $('#sy-kod').value.trim(), m = Number(String($('#sy-miktar').value).replace(',', '.'));
  if (!kod) { toast('Ürün kodu ya da adı yaz'); $('#sy-kod').focus(); return; }
  if (!(m >= 0) || $('#sy-miktar').value === '') { toast('Miktar gir'); $('#sy-miktar').focus(); return; }
  const u = syUrun || urunBul(kod), konum = $('#sy-konum').value.trim();
  const k = {id: newId(), sayimId: sayimAktif, ref: u ? u.ref : kod, aciklama: u ? u.aciklama || '' : $('#sy-aciklama').value.trim(), marka: u ? u.marka || '' : $('#sy-marka').value.trim(),
    birim: $('#sy-birim').value || 'Adet', miktar: m, konum, stokId: u ? u.id : '', zaman: new Date().toISOString(), sayan: P[ME] ? P[ME].ad : ''};
  sySon.konum = konum;
  if (await syYaz(k)) {
    toast(`✓ ${k.ref || k.aciklama} · ${fmtM(m)} ${k.birim}${navigator.onLine ? '' : ' · ⏳ internet gelince gönderilecek'}`);
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
  const fr = XLSX.utils.json_to_sheet([...g.map(x => { const k = syKayitli(s, x); return {'Stok Kodu': x.ref || '', 'Stok Adı': x.aciklama || '', 'Marka': x.marka || '', 'Kayıtlı Stok': k, 'Sayılan': x.toplam, 'Fark': k === '' ? '' : x.toplam - k}; }),
    ...sySayilmayan(s, g).map(u => ({'Stok Kodu': u.ref || '', 'Stok Adı': u.aciklama || '', 'Marka': u.marka || '', 'Kayıtlı Stok': Number(u.stok) || 0, 'Sayılan': 0, 'Fark': -(Number(u.stok) || 0), 'Not': 'Sayılmadı'}))]);
  fr['!cols'] = [{wch: 22}, {wch: 50}, {wch: 14}, {wch: 12}, {wch: 10}, {wch: 10}, {wch: 12}];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'DIA_Aktarim'); XLSX.utils.book_append_sheet(wb, ay, 'Giris_Detay'); XLSX.utils.book_append_sheet(wb, fr, 'Fark_Raporu');
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
      const o = u ? {...u, oncekiStok: u.sayimId === id && 'oncekiStok' in u ? u.oncekiStok : (u.stok ?? ''), stok: x.toplam, sayimTarih: s.tarih, sayimId: id} : {ref: x.ref, aciklama: x.aciklama, marka: x.marka, birim: x.birim, stok: x.toplam, fiyat: '', para: '₺', sayimTarih: s.tarih, sayimId: id, kaynak: 'Stok sayımı ' + trT(s.tarih)};
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
    <div class="rows">${x.girisler.map(k => `<div class="row" style="padding:8px 0"><div class="mid"><div class="t">${fmtM(k.miktar)} ${esc(k.birim || '')}${k.konum ? ' · 📍' + esc(k.konum) : ''}</div><div class="s">${esc(k.sayan || adi(k.by))} · ${k.zaman ? new Date(k.zaman).toLocaleString('tr-TR', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) : ''}${k.duzeltildi ? ' · ✎ düzeltildi' + (k.eskiMiktar != null ? ' (önceki ' + fmtM(k.eskiMiktar) + ')' : '') : ''}</div></div>${!kapali && (k.by === ME || IS_OWNER) ? `<div class="end" style="flex-direction:row;gap:6px"><button class="btn btn-s btn-sm" data-syduz="${esc(k.id)}">✎ Düzelt</button><button class="btn btn-s btn-sm" data-sysil="${esc(k.id)}">Sil</button></div>` : ''}</div>`).join('')}</div>`, [{label: 'Kapat', cls: 'btn-p', onClick: () => {}}]);
  sh.el.querySelectorAll('[data-syduz]').forEach(b => b.onclick = () => { sh.kapat(); syDuzeltForm(b.dataset.syduz); });
  sh.el.querySelectorAll('[data-sysil]').forEach(b => b.onclick = async () => { await sySil(b.dataset.sysil); sh.kapat(); toast('Giriş silindi'); });
}

// ── Olaylar
$('#sy-yeni-btn').onclick = sayimForm;
$('#sy-basla').onclick = () => sayimModu(sayimAktif);
// Açık sayım varsa ana sayfada büyük "Saymaya başla" kartı
function syBanner() {
  const a = S.sayimlar.filter(s => s.durum !== 'kapali'), el = $('#sy-banner'); if (!el) return;
  el.hidden = !a.length;
  el.innerHTML = a.map(s => `<button class="sy-ban" data-sbas="${esc(s.id)}"><span>📦</span><div><b>Stok sayımı devam ediyor</b><small>${esc(s.ad)} · ${syKalemler(s.id).length} giriş</small></div><em>Saymaya başla →</em></button>`).join('');
  el.querySelectorAll('[data-sbas]').forEach(b => b.onclick = () => sayimModu(b.dataset.sbas));
}
$('#sy-list').onclick = e => { const r = e.target.closest('[data-sy]'); if (r) { sayimAktif = r.dataset.sy; syFiltre = ''; $('#sy-ara').value = ''; sayimCiz(); window.scrollTo({top: 0}); } };
$('#sy-geri').onclick = () => { sayimAktif = null; sayimCiz(); };
$('#sy-kod').oninput = syOneri;
$('#sy-kod').onkeydown = e => {
  const l = $$('#sy-oneri [data-syu]'), acik = !$('#sy-oneri').hidden && l.length;
  if (acik && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); syIsaret = (syIsaret + (e.key === 'ArrowDown' ? 1 : -1) + l.length) % l.length; syIsaretCiz(); return; }
  if (e.key === 'Escape') { $('#sy-oneri').hidden = true; return; }
  if (e.key === 'Enter') { e.preventDefault(); if (acik) sySec(l[syIsaret].dataset.syu); else { const u = urunBul($('#sy-kod').value); if (u) sySec(u.id); else $('#sy-miktar').focus(); } }
};
$('#sy-kod').onblur = () => setTimeout(() => { if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#sy-oneri')) return; $('#sy-oneri').hidden = true; }, 150);
$('#sy-chips').onclick = e => { const c = e.target.closest('[data-sygor]'); if (c) { syGor = c.dataset.sygor; sayimCiz(); } };

$('#sy-oneri').onclick = e => { const b = e.target.closest('[data-syu]'); if (b) sySec(b.dataset.syu); };
$('#sy-miktar').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); syEkle(); } };
$('#sy-ekle').onclick = syEkle;
$('#sy-yok').onclick = () => { sySec(''); const a = $('#sy-aciklama'); if (!$('#sy-kod').value.trim()) $('#sy-kod').focus(); else a.focus(); };
$('#sy-ara').oninput = e => { syFiltre = e.target.value; sayimCiz(); };
$('#sy-toplam').onclick = e => {
  const r = e.target.closest('[data-syg]'); if (r) { syGrupDetay(r.dataset.syg); return; }
  const y = e.target.closest('[data-sysay]'); if (!y) return;
  const s = S.sayimlar.find(x => x.id === sayimAktif); if (!s || s.durum === 'kapali') return;
  if (matchMedia('(max-width:760px)').matches) { sayimModu(sayimAktif); smMiktar(S.stok.find(u => u.id === y.dataset.sysay)); }
  else { sySec(y.dataset.sysay); window.scrollTo({top: 0, behavior: 'smooth'}); }
};
$('#sy-son').onclick = async e => { const d = e.target.closest('[data-syduz]'); if (d) { syDuzeltForm(d.dataset.syduz); return; } const b = e.target.closest('[data-sysil]'); if (b) { await sySil(b.dataset.sysil); toast('Giriş geri alındı'); } };
$('#sy-belge').onclick = e => { const b = e.target.closest('[data-sybel]'); if (!b) return; const s = S.sayimlar.find(x => x.id === sayimAktif); spDosyaAc((s.dosyalar || [])[+b.dataset.sybel]); };
$('#sy-dia').onclick = () => syDiaDosya(sayimAktif).catch(e => toast('⚠ ' + e.message));
$('#sy-kapat').onclick = () => syKapat(sayimAktif);
$('#sy-ac').onclick = async () => { const s = S.sayimlar.find(x => x.id === sayimAktif); await kaydet('sayimlar', {...s, durum: 'acik'}); toast('Sayım yeniden açıldı'); };

// ═══ SAYIM MODU — telefonda tam ekran, büyük düğmeler; 5-10 kişi aynı anda sayar ═══
const SYB = ['Adet', 'Mt', 'Kg', 'Paket', 'Kutu', 'Takım', 'Rulo'];
let sm = null; // {id, urun, yeni, el}
const lsG = (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
const lsS = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

function sayimModu(id) {
  const s = S.sayimlar.find(x => x.id === id); if (!s) return;
  if (s.durum === 'kapali') { toast('Bu sayım tamamlanmış'); return; }
  if (sm && sm.el) sm.el.remove();
  const el = document.createElement('div'); el.className = 'smod';
  el.innerHTML = `<div class="smod-h"><div style="flex:1;min-width:0"><b>${esc(s.ad)}</b><div class="smod-st" id="smo-st"></div></div><button class="icon-btn" id="smo-x" aria-label="Kapat">${ikon('x')}</button></div>
    <button class="smod-raf" id="smo-raf"></button>
    <div class="smod-ekip" id="smo-ekip"></div>
    <div class="smod-b" id="smo-b"></div>`;
  document.body.appendChild(el); document.body.style.overflow = 'hidden';
  sm = {id, urun: null, yeni: false, el, konum: lsG('sy_konum_' + id, ''), birim: 'Adet'};
  el.querySelector('#smo-x').onclick = smKapat;
  el.querySelector('#smo-raf').onclick = smRafSec;
  smAra(); smUst();
  if (!sm.konum) smRafSec();
}
function smKapat() { if (sm && sm.el) sm.el.remove(); sm = null; document.body.style.overflow = ''; sayimCiz(); }
// Üst bilgi: benim / ekibin sayısı, kim hangi rafta
function smUst() {
  if (!sm) return;
  const k = syKalemler(sm.id), ben = k.filter(x => x.by === ME).length, urun = new Set(k.map(x => syKey(x.ref || x.aciklama))).size;
  const bq = syQSay(sm.id);
  sm.el.querySelector('#smo-st').textContent = `Sen ${ben} giriş · Ekip ${k.length} giriş · ${urun} ürün${bq ? ` · ⏳ ${bq} bekliyor` : ''}${navigator.onLine ? '' : ' · 📴 internet yok'}`;
  sm.el.querySelector('#smo-raf').innerHTML = `📍 Raf / bölge: <b>${esc(sm.konum || 'seçilmedi')}</b><span>değiştir</span>`;
  const son = new Map(), sinir = Date.now() - 20 * 60e3;
  k.forEach(x => { const t = Date.parse(x.zaman || 0); if (t > sinir && (!son.has(x.by) || son.get(x.by).t < t)) son.set(x.by, {t, konum: x.konum, ad: x.sayan || adi(x.by)}); });
  sm.el.querySelector('#smo-ekip').innerHTML = son.size ? '👥 ' + [...son.entries()].map(([by, v]) => `<span class="${by === ME ? 'ben' : ''}">${esc(by === ME ? 'Sen' : v.ad.split(' ')[0])}${v.konum ? ' · ' + esc(v.konum) : ''}</span>`).join('') : '';
}
function smRafSec() {
  const rafl = [...new Set(syKalemler(sm.id).map(x => x.konum).filter(Boolean))].slice(-12);
  const sh = sheet('Hangi raf / bölgeyi sayıyorsun?', `<div class="fg"><input class="inp smod-inp" id="smr-in" value="${esc(sm.konum)}" placeholder="ör. A-3, Depo arka, Vitrin" autocapitalize="characters">
    ${rafl.length ? `<div class="chips" style="flex-wrap:wrap">${rafl.map(r => `<button class="chip" data-raf="${esc(r)}">${esc(r)}</button>`).join('')}</div>` : ''}
    <p class="note">Ekip kimin nerede saydığını görür, aynı rafı iki kişi saymaz.</p></div>`,
    [{label: 'Tamam', cls: 'btn-p', onClick: ov => { sm.konum = v(ov, 'smr-in'); lsS('sy_konum_' + sm.id, sm.konum); smUst(); setTimeout(() => { const i = sm && sm.el.querySelector('#smo-q'); if (i) i.focus(); }, 50); }}]);
  sh.el.querySelectorAll('[data-raf]').forEach(b => b.onclick = () => { sh.el.querySelector('#smr-in').value = b.dataset.raf; });
}

// 1. adım: ürün ara
function smAra(q = '') {
  sm.urun = null; sm.yeni = false;
  const b = sm.el.querySelector('#smo-b');
  b.innerHTML = `<div class="smod-ara"><input class="inp smod-inp" id="smo-q" value="${esc(q)}" placeholder="Kod ya da ürün adı yaz" autocomplete="off" autocapitalize="characters" enterkeyhint="search">
      <button class="btn btn-s smod-yok" id="smo-yok">+ Listede yok</button></div>
    <button class="smod-foto" id="smo-foto">📷 Fotoğraf / dosyadan ekle <small>kağıda yazılan liste, Excel, PDF</small></button>
    <div class="smod-sonuc" id="smo-sonuc"></div><div id="smo-son"></div>`;
  const inp = b.querySelector('#smo-q');
  const ciz = () => {
    const t = inp.value.trim(), box = b.querySelector('#smo-sonuc');
    if (t.length < 2) { box.innerHTML = '<div class="smod-ipucu">Ürün kodunun bir kısmını ya da adını yaz.<br>Bulamazsan <b>+ Listede yok</b>.</div>'; return; }
    const l = urunAra(t, 12);
    box.innerHTML = l.map(u => { const g = syGrupla(sm.id).find(x => syKey(x.ref) === syKey(u.ref));
      return `<button class="smod-u" data-u="${esc(u.id)}"><b>${esc(u.ref)}</b><span>${esc(u.marka || '')}</span><small>${esc(u.aciklama || '')}</small>${g ? `<em>✓ sayıldı: ${fmtM(g.toplam)} ${esc(g.birim)}</em>` : ''}</button>`; }).join('')
      || `<div class="smod-ipucu">"${esc(t)}" listede yok.<br><button class="btn btn-p" id="smo-yok2" style="margin-top:10px">Listede yok — yine de say</button></div>`;
    const y2 = box.querySelector('#smo-yok2'); if (y2) y2.onclick = () => smMiktar(null, inp.value.trim());
  };
  inp.oninput = ciz;
  inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const f = b.querySelector('[data-u]'); if (f) smMiktar(S.stok.find(u => u.id === f.dataset.u)); } };
  b.querySelector('#smo-sonuc').onclick = e => { const x = e.target.closest('[data-u]'); if (x) smMiktar(S.stok.find(u => u.id === x.dataset.u)); };
  b.querySelector('#smo-yok').onclick = () => smMiktar(null, inp.value.trim());
  b.querySelector('#smo-foto').onclick = () => syDosyaSec(sm.id, sm.konum);
  ciz(); smSon();
  setTimeout(() => inp.focus(), 60);
}
function smSon() {
  const box = sm.el.querySelector('#smo-son'); if (!box) return;
  const l = syKalemler(sm.id).filter(k => k.by === ME).sort((a, b) => (b.zaman || '').localeCompare(a.zaman || '')).slice(0, 4);
  box.innerHTML = l.length ? '<div class="smod-alt">Son girişlerin</div>' + l.map(k => `<div class="smod-son"><div><b>${esc(k.ref || k.aciklama)}</b><small>${esc(k.konum || '')}${k._q ? ' · ⏳ gönderilecek' : ''}</small></div><b>${fmtM(k.miktar)} ${esc(k.birim || '')}</b><button class="btn btn-s btn-sm" data-duz="${esc(k.id)}">✎ Düzelt</button><button class="btn btn-s btn-sm" data-geri="${esc(k.id)}">Geri al</button></div>`).join('') : '';
  box.querySelectorAll('[data-duz]').forEach(x => x.onclick = () => syDuzeltForm(x.dataset.duz));
  box.querySelectorAll('[data-geri]').forEach(x => x.onclick = async () => { await sySil(x.dataset.geri); toast('Giriş geri alındı'); });
}

// 2. adım: miktar
function smMiktar(u, kod = '') {
  sm.urun = u || null; sm.yeni = !u;
  const key = syKey(u ? u.ref : kod), g = key ? syGrupla(sm.id).find(x => syKey(x.ref || x.aciklama) === key) : null;
  sm.birim = (g && g.birim) || (u && u.birim) || 'Adet';
  const b = sm.el.querySelector('#smo-b');
  b.innerHTML = `<div class="smod-kart">${u ? `<b>${esc(u.ref)}</b><span>${esc(u.marka || '')}</span><small>${esc(u.aciklama || '')}</small>`
      : `<div class="fg"><input class="inp smod-inp" id="smo-kod" value="${esc(kod)}" placeholder="Kod (yoksa boş bırak)" autocapitalize="characters"><input class="inp smod-inp" id="smo-ac" placeholder="Ürün adı / açıklama *"><input class="inp" id="smo-mr" placeholder="Marka (isteğe bağlı)"></div>`}</div>
    ${g ? `<div class="smod-uyari">⚠ Bu ürün zaten sayıldı: <b>${fmtM(g.toplam)} ${esc(g.birim)}</b><br>${g.girisler.map(k => `${esc((k.sayan || adi(k.by)).split(' ')[0])}${k.konum ? ' · ' + esc(k.konum) : ''}: ${fmtM(k.miktar)}`).join('<br>')}<br><small>Başka raftaysa yine ekle, toplanır.</small></div>` : ''}
    <div class="smod-m"><button class="smod-pm" data-d="-1">−</button><input class="smod-say" id="smo-m" inputmode="decimal" value="" placeholder="0"><button class="smod-pm" data-d="1">+</button></div>
    <div class="smod-hz">${[5, 10, 25, 50, 100].map(n => `<button data-d="${n}">+${n}</button>`).join('')}</div>
    <div class="chips smod-bir">${SYB.map(x => `<button class="chip${x === sm.birim ? ' on' : ''}" data-b="${x}">${x}</button>`).join('')}</div>
    <div class="smod-f"><button class="btn btn-s" id="smo-geri">Vazgeç</button><button class="btn smod-kaydet" id="smo-kay">Kaydet</button></div>`;
  const m = b.querySelector('#smo-m');
  b.querySelectorAll('[data-d]').forEach(x => x.onclick = () => { m.value = String(Math.max(0, (Number(String(m.value).replace(',', '.')) || 0) + Number(x.dataset.d))); });
  b.querySelectorAll('[data-b]').forEach(x => x.onclick = () => { sm.birim = x.dataset.b; b.querySelectorAll('[data-b]').forEach(y => y.classList.toggle('on', y === x)); });
  b.querySelector('#smo-geri').onclick = () => smAra();
  b.querySelector('#smo-kay').onclick = smKaydet;
  m.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); smKaydet(); } };
  setTimeout(() => (sm.yeni && !kod ? b.querySelector('#smo-kod') : sm.yeni ? b.querySelector('#smo-ac') : m).focus(), 60);
}
async function smKaydet() {
  const b = sm.el.querySelector('#smo-b'), m = Number(String(b.querySelector('#smo-m').value).replace(',', '.'));
  if (!(m > 0)) { toast('Miktar gir'); b.querySelector('#smo-m').focus(); return; }
  const u = sm.urun;
  let ref = u ? u.ref : b.querySelector('#smo-kod').value.trim(), ac = u ? u.aciklama || '' : b.querySelector('#smo-ac').value.trim();
  if (!u && !ac && !ref) { toast('Ürün adı ya da kodu yaz'); b.querySelector('#smo-ac').focus(); return; }
  if (!u && !ref) ref = '';
  const btn = b.querySelector('#smo-kay'); btn.disabled = true;
  const k = {id: newId(), sayimId: sm.id, ref, aciklama: ac, marka: u ? u.marka || '' : b.querySelector('#smo-mr').value.trim(), birim: sm.birim, miktar: m,
    konum: sm.konum, stokId: u ? u.id : '', zaman: new Date().toISOString(), sayan: P[ME] ? P[ME].ad : ''};
  if (await syYaz(k)) {
    try { navigator.vibrate && navigator.vibrate(40); } catch (e) {}
    toast(`✓ ${ref || ac} · ${fmtM(m)} ${sm.birim}${syKuyruk.some(z => z.id === k.id) ? ' · ⏳ internet gelince gönderilecek' : ''}`);
    smAra(); smUst();
  } else btn.disabled = false;
}
// ═══ Fotoğraf / dosyadan sayıma ekle (kağıda yazılan sayım listesi, Excel, PDF…) ═══
async function syDosyadan(id, files, konum = '') {
  files = [...files]; if (!files.length) return;
  const sh = sheet('Dosyadan sayıma ekle', '<div id="syd-d" class="note">Hazırlanıyor…</div><div id="syd-g"></div>');
  const durum = t => { const e = sh.el.querySelector('#syd-d'); if (e) e.textContent = t; };
  let r;
  try { r = await hzOku(files, '', durum); } catch (e) { durum('⚠ ' + (e.message || e)); return; }
  const m = new Map();
  for (const x of r.sonuc) { const k = syKey(x.u ? x.u.ref : (x.ref || x.aciklama)); if (!k) continue; if (m.has(k)) m.get(k).miktar += Number(x.miktar) || 0; else m.set(k, {...x, miktar: Number(x.miktar) || 1}); }
  const l = [...m.values()];
  durum(l.length ? `${l.length} ürün okundu — miktarları kontrol et, istemediklerinin işaretini kaldır` : 'Dosyadan ürün satırı okunamadı');
  sh.el.querySelector('#syd-g').innerHTML = (r.hatalar.length ? `<div class="note" style="color:var(--red)">${r.hatalar.map(esc).join('<br>')}</div>` : '') +
    `<div class="f" style="margin:6px 0 10px"><label for="syd-k">Raf / konum</label><input class="inp" id="syd-k" value="${esc(konum)}" placeholder="ör. A-3"></div>` +
    '<div class="rows">' + l.slice(0, 300).map((x, i) => `<label class="row hz-row"><input type="checkbox" data-sd="${i}" checked><div class="mid"><div class="t">${esc(x.u ? x.u.ref : (x.ref || 'Kodsuz'))}${x.u ? '' : ' <span class="pill p-amber" style="margin-left:4px">listede yok</span>'}</div><div class="s">${esc(x.u ? x.u.aciklama || '' : x.aciklama || '')}</div></div><div class="end"><input class="inp num hz-m" data-sdm="${i}" type="number" min="0" step="any" value="${esc(x.miktar)}" aria-label="Miktar"></div></label>`).join('') + '</div>';
  const f = document.createElement('div'); f.className = 'sheet-f';
  f.innerHTML = '<button class="btn btn-s">Vazgeç</button><button class="btn btn-p">Sayıma ekle</button>';
  sh.el.querySelector('.sheet').appendChild(f);
  f.firstChild.onclick = () => sh.kapat();
  f.lastChild.onclick = async () => {
    const kon = sh.el.querySelector('#syd-k').value.trim(), ad = files.map(x => x.name).join(', ');
    f.lastChild.disabled = true; let n = 0;
    for (const cb of sh.el.querySelectorAll('[data-sd]')) {
      if (!cb.checked) continue;
      const x = l[+cb.dataset.sd], mk = Number(sh.el.querySelector(`[data-sdm="${cb.dataset.sd}"]`).value) || 0; if (!(mk > 0)) continue;
      const k = {id: newId(), sayimId: id, ref: x.u ? x.u.ref : (x.ref || ''), aciklama: x.u ? x.u.aciklama || '' : x.aciklama || '', marka: x.u ? x.u.marka || '' : x.marka || '',
        birim: x.birim || 'Adet', miktar: mk, konum: kon, stokId: x.u ? x.u.id : '', zaman: new Date().toISOString(), sayan: P[ME] ? P[ME].ad : '', kaynak: 'Dosya: ' + ad};
      if (await syYaz(k)) n++;
    }
    // Orijinal dosyayı sayımın belgelerine sakla
    if (!DEMO) {
      const s = S.sayimlar.find(z => z.id === id), dos = [];
      for (const fl of files) { const yol = `sayim/${id}/${Date.now()}-${fl.name.replace(/[^\w.\-]+/g, '_')}`; const {error} = await sb.storage.from('belgeler').upload(yol, fl, {contentType: fl.type || undefined}); if (!error) dos.push({ad: fl.name, yol, tip: fl.type || '', at: new Date().toISOString(), by: ME}); }
      if (dos.length && s) await kaydet('sayimlar', {...s, dosyalar: [...(s.dosyalar || []), ...dos]});
    }
    sh.kapat(); toast(`✅ ${n} ürün sayıma eklendi`);
  };
}
const syDosyaSec = (id, konum) => { const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.accept = 'image/*,.pdf,.xlsx,.xls,.csv,.txt'; i.onchange = () => syDosyadan(id, i.files, konum); i.click(); };
$('#sy-dosya').onclick = () => syDosyaSec(sayimAktif, $('#sy-konum').value.trim());
sayimCiz();
