'use strict';
/* Ceylan Ofis — Excel'den toplu ürün aktarma (fiyat listeleri). Sadece yönetici.
   Sütunlar: Stok Kodu · Açıklama · Marka · Liste Fiyatı · Para Birimi (başlık adları esnek).
   Aynı marka + aynı kod zaten varsa o ürün güncellenir (stok adedi vb. korunur), yoksa yeni eklenir.
   Fiyatı olmayan ya da okunamayan satırlar atlanmaz: fiyatsız olarak eklenir ("fiyat sorunuz"). */
const SAK_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const sakPara = p => { p = String(p || '').trim().toUpperCase(); if (/^(€|EUR|EURO|AVRO)$/.test(p)) return '€'; if (/^(\$|USD|DOLAR)$/.test(p)) return '$'; if (/^(₺|TL|TRY|TÜRK LİRASI)$/.test(p)) return '₺'; return ''; };
const sakSayi = x => { if (typeof x === 'number') return x; let s = String(x ?? '').replace(/[^\d.,-]/g, ''); if (!s) return null; if (/,\d{1,3}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, ''); const n = Number(s); return isFinite(n) ? n : null; };
const sakAd = s => nrmTR(s).replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u').replace(/[^a-z0-9]/g, '');

async function sakLib() { if (window.XLSX) return; await new Promise((ok, no) => { const s = document.createElement('script'); s.src = SAK_LIB; s.onload = ok; s.onerror = () => no(new Error('Excel kütüphanesi yüklenemedi (internet?)')); document.head.appendChild(s); }); }

// Toplu yazma: 300'erli gruplar halinde tek istek (tek tek yazmaktan çok daha hızlı)
async function sakTopluYaz(col, objs, ilerle) {
  if (DEMO) {
    const now = new Date().toISOString();
    objs.forEach(o => { const t = {...o, by: o.by || ME, at: now}; const i = S[col].findIndex(x => x.id === o.id); if (i >= 0) S[col][i] = t; else S[col].push(t); });
    lsSet('co_' + col, S[col]); degisti(col); return objs.length;
  }
  let n = 0;
  for (let i = 0; i < objs.length; i += 300) {
    const part = objs.slice(i, i + 300).map(o => ({id: o.id, veri: bodyOf(o)}));
    const {data, error} = await sb.from(col).upsert(part).select();
    if (error) { hata(error); break; }
    data.forEach(r => { const o = rowToObj(r), j = S[col].findIndex(x => x.id === o.id); if (j >= 0) S[col][j] = o; else S[col].push(o); });
    n += part.length; if (ilerle) ilerle(n, objs.length);
  }
  degisti(col); return n;
}

function sakOku(wb) {
  const out = [], uyar = [];
  for (const ad of wb.SheetNames) {
    if (/kontrol|aktar[ıi]lmaz/i.test(ad)) { uyar.push(`"${ad}" sayfası atlandı (aktarılmaz)`); continue; }
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[ad], {header: 1, defval: '', raw: true});
    let h = rows.findIndex(r => r.some(c => /kod|ref/i.test(String(c))) && r.some(c => /fiyat|price/i.test(String(c))));
    if (h < 0) { if (rows.length > 1) uyar.push(`"${ad}" sayfasında "Stok Kodu" ve "Fiyat" başlıkları bulunamadı, atlandı`); continue; }
    const kol = {}, bas = rows[h].map(c => sakAd(c));
    bas.forEach((b, i) => {
      if (kol.ref == null && /^(stokkodu|urunkodu|kod|ref|referans|sipariskodu|kodu)$/.test(b)) kol.ref = i;
      else if (kol.ac == null && /^(aciklama|stokadi|urunadi|tanim|ad|urunaciklamasi)$/.test(b)) kol.ac = i;
      else if (kol.marka == null && /^(marka|uretici)$/.test(b)) kol.marka = i;
      else if (kol.fiyat == null && /^(listefiyati|fiyat|birimfiyati|birimfiyat|listefiyat|price)$/.test(b)) kol.fiyat = i;
      else if (kol.para == null && /^(parabirimi|para|doviz|dovizcinsi|birim)$/.test(b)) kol.para = i;
    });
    if (kol.ref == null) { uyar.push(`"${ad}" sayfasında kod sütunu bulunamadı`); continue; }
    for (const r of rows.slice(h + 1)) {
      const ref = String(r[kol.ref] ?? '').trim(); if (!ref) continue;
      const f = kol.fiyat != null ? sakSayi(r[kol.fiyat]) : null;
      let para = kol.para != null ? sakPara(r[kol.para]) : '';
      if (!para && kol.fiyat != null) para = sakPara(String(r[kol.fiyat]).replace(/[\d.,\s-]/g, ''));
      out.push({ref, aciklama: kol.ac != null ? String(r[kol.ac] ?? '').trim() : '', marka: kol.marka != null ? String(r[kol.marka] ?? '').trim() : '', fiyat: f, para: para || '€'});
    }
  }
  return {out, uyar};
}

function stokAktarForm() {
  if (!IS_OWNER) { toast('⛔ Sadece yönetici ürün aktarabilir'); return; }
  let liste = null, dosyaAdi = '';
  const sh = sheet('Excel\'den ürün aktar', `<div class="fg">
    <p class="note">Excel'de şu sütunlar olmalı: <b>Stok Kodu · Açıklama · Marka · Liste Fiyatı · Para Birimi</b> (€, ₺, $). Aynı marka + kod zaten stokta varsa <b>güncellenir</b> (stok adedi korunur), yoksa <b>eklenir</b>. Para birimleri aynen korunur.</p>
    <label class="hz-btn" style="cursor:pointer;margin:0">${ikon('down')}<span><b>Excel dosyası seç</b>.xlsx · .xls · .csv</span><input type="file" id="sak-dosya" accept=".xlsx,.xls,.csv" hidden></label>
    <div class="f"><label for="sak-marka">Marka (dosyada marka sütunu yoksa bu yazılır)</label><input class="inp" id="sak-marka" placeholder="ör. Çetinkaya Pano"></div>
    <div class="f"><label for="sak-kaynak">Kaynak notu</label><input class="inp" id="sak-kaynak" placeholder="ör. Çetinkaya Pano Eylül 2026 fiyat listesi"></div>
    <div id="sak-ozet" class="note" hidden></div></div>`,
  [{label: 'Vazgeç', onClick: () => {}}, {label: 'Stoğa aktar', cls: 'btn-p', onClick: async ov => {
    if (!liste || !liste.length) { toast('Önce bir Excel dosyası seç'); return false; }
    const marka = v(ov, 'sak-marka'), kaynak = v(ov, 'sak-kaynak') || ('Excel: ' + dosyaAdi);
    const kodAnahtar = r => String(r || '').toUpperCase().replace(/\s+/g, ' ').trim();   // nokta / tire korunur: 3SK400-1.5 ≠ 3SK400-15
    const idx = new Map(S.stok.map(u => [nrmTR(u.marka || '') + '|' + kodAnahtar(u.ref), u]));
    const gor = new Map(), objs = []; let yeni = 0, guncel = 0, ayni = 0;
    for (const x of liste) {
      const mk = x.marka || marka; if (!mk) { toast('Marka yaz (dosyada marka sütunu yok)'); return false; }
      const key = nrmTR(mk) + '|' + kodAnahtar(x.ref); if (gor.has(key)) continue; gor.set(key, 1);
      const var_ = idx.get(key);
      const veri = {ref: x.ref, aciklama: x.aciklama, marka: mk, fiyat: x.fiyat, para: x.para, kaynak};
      if (x.fiyat == null) { veri.fiyat = null; veri.fiyatSorunuz = true; }
      if (var_) {
        if (Number(var_.fiyat) === Number(x.fiyat) && var_.para === x.para && (var_.aciklama || '') === (x.aciklama || var_.aciklama || '')) { ayni++; continue; }
        const o = {...var_, ...veri, aciklama: x.aciklama || var_.aciklama}; delete o._ix; if (x.fiyat != null) delete o.fiyatSorunuz; objs.push(o); guncel++;
      } else { objs.push({id: newId(), ...veri}); yeni++; }
    }
    if (!objs.length) { toast('Değişen ürün yok — hepsi zaten güncel'); return true; }
    toast(`Aktarılıyor… ${objs.length.toLocaleString('tr-TR')} ürün`, 60000);
    const n = await sakTopluYaz('stok', objs, (a, b) => toast(`Aktarılıyor… ${a.toLocaleString('tr-TR')} / ${b.toLocaleString('tr-TR')}`, 60000));
    toast(`✅ ${n.toLocaleString('tr-TR')} ürün aktarıldı · ${yeni} yeni · ${guncel} güncellendi${ayni ? ' · ' + ayni + ' zaten güncel' : ''}`, 6000);
    return n === objs.length;
  }}]);
  sh.el.querySelector('#sak-dosya').onchange = async e => {
    const f = e.target.files[0]; if (!f) return; dosyaAdi = f.name;
    const oz = sh.el.querySelector('#sak-ozet'); oz.hidden = false; oz.textContent = 'Okunuyor…';
    try {
      await sakLib();
      const wb = XLSX.read(await f.arrayBuffer(), {type: 'array'}), r = sakOku(wb); liste = r.out;
      const pb = {}; liste.forEach(x => { pb[x.para] = (pb[x.para] || 0) + 1; });
      const fiyatsiz = liste.filter(x => x.fiyat == null).length, markalar = [...new Set(liste.map(x => x.marka).filter(Boolean))];
      oz.innerHTML = `<b>${esc(f.name)}</b><br>${liste.length.toLocaleString('tr-TR')} ürün satırı okundu · ` + Object.entries(pb).map(([p, n]) => `${n.toLocaleString('tr-TR')} adet ${esc(p)}`).join(' · ') +
        (fiyatsiz ? `<br>⚠ ${fiyatsiz} satırda fiyat yok ("fiyat sorunuz" olarak eklenir)` : '') + (markalar.length ? `<br>Marka: ${esc(markalar.slice(0, 4).join(', '))}${markalar.length > 4 ? '…' : ''}` : '<br>Dosyada marka sütunu yok — yukarıya marka yaz') +
        (r.uyar.length ? '<br>⚠ ' + r.uyar.map(esc).join('<br>⚠ ') : '') + `<br><span style="color:var(--fg3)">Örnek: ${esc((liste[0] || {}).ref || '')} · ${esc(((liste[0] || {}).aciklama || '').slice(0, 60))} · ${liste[0] && liste[0].fiyat != null ? esc(fmtF(liste[0].fiyat) + ' ' + liste[0].para) : ''}</span>`;
      if (markalar.length === 1 && !sh.el.querySelector('#sak-marka').value) sh.el.querySelector('#sak-marka').value = markalar[0];
    } catch (err) { liste = null; oz.textContent = '⚠ ' + (err.message || err); }
  };
}
document.addEventListener('click', e => { if (e.target.closest('[data-act="stok-aktar"]')) stokAktarForm(); });
