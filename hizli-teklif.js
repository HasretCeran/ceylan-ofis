'use strict';
/* Ceylan Ofis — Hızlı teklif: fotoğraf, PDF, Excel ya da yapıştırılan metinden kalem çıkarır.
   Ürün kodları fiyat listesindeki (stok) kodlarla eşleştirilir; çıktı yine Ceylan şablonunda üretilir. */
(function () {
  const LIB = {
    pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
    sheetjs: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  };
  const yuk = {};
  const script = src => yuk[src] || (yuk[src] = new Promise((ok, no) => {
    const s = document.createElement('script'); s.src = src; s.async = true; s.onload = ok;
    s.onerror = () => { delete yuk[src]; no(new Error('Kütüphane yüklenemedi (internet bağlantısını kontrol et)')); };
    document.head.appendChild(s);
  }));

  // ── Kod dizini: boşluk/tire/nokta olmadan; OCR'ın karıştırdığı O/0, I/1 de tolere edilir
  const kN = s => String(s || '').toUpperCase().replace(/[\s\-./_*]/g, '');
  const kO = s => kN(s).replace(/O/g, '0').replace(/[IL]/g, '1');
  let IDX = null, IDXO = null, IDXN = -1;
  function dizin() {
    if (IDX && IDXN === S.stok.length) return;
    IDX = new Map(); IDXO = new Map(); IDXN = S.stok.length;
    for (const u of S.stok) { const k = kN(u.ref); if (k.length < 3) continue; if (!IDX.has(k)) IDX.set(k, u); const o = kO(u.ref); if (!IDXO.has(o)) IDXO.set(o, u); }
  }
  const bul = s => { const k = kN(s); if (k.length < 3) return null; return IDX.get(k) || (k.length >= 5 ? IDXO.get(kO(s)) : null) || null; };

  const BIRIM = /^(adet|ad|ad\.|adt|pcs|pc|pce|ea|mt|m|metre|mtr|set|takım|kutu|top|rulo|kg|x)$/i;
  const SAYI = /^\d{1,6}(?:[.,]\d{1,3})?$/;
  const sayi = t => Number(String(t).replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));

  // ── Bir satırdan kalem(ler) çıkar
  function satirCoz(line) {
    const tk = line.replace(/[|;\t]/g, ' ').split(/\s+/).filter(Boolean);
    const kul = new Array(tk.length).fill(false), bulunan = [];
    for (let i = 0; i < tk.length; i++) {
      if (kul[i]) continue;
      for (let n = Math.min(6, tk.length - i); n >= 1; n--) {
        const parca = tk.slice(i, i + n).join(' ');
        if (n === 1 && (SAYI.test(parca) && parca.length < 5)) continue; // tek başına küçük sayı kod sayılmaz
        const u = bul(parca);
        if (u) { for (let j = i; j < i + n; j++) kul[j] = true; bulunan.push({u, i, son: i + n - 1}); break; }
      }
    }
    // miktar: birimin önündeki sayı > "x 5" / "5 x" > koddan sonraki ilk sayı
    const miktarBul = (bas, bit) => {
      for (let j = bas; j < bit; j++) if (!kul[j] && SAYI.test(tk[j]) && tk[j + 1] && BIRIM.test(tk[j + 1])) return sayi(tk[j]);
      for (let j = bas; j < bit; j++) if (!kul[j] && /^\d{1,6}(ad|adet|pcs|mt|m)$/i.test(tk[j])) return sayi(tk[j].match(/^\d+/)[0]);
      for (let j = bas; j < bit; j++) if (!kul[j] && /^x\d{1,5}$/i.test(tk[j])) return sayi(tk[j].slice(1));
      for (let j = bas; j < bit; j++) if (!kul[j] && SAYI.test(tk[j]) && !/[.,]\d{2}$/.test(tk[j])) { const v = sayi(tk[j]); if (v > 0 && v <= 100000) return v; }
      return null;
    };
    if (bulunan.length) {
      return bulunan.map((b, k) => {
        const bas = k === 0 ? 0 : bulunan[k - 1].son + 1, bit = k + 1 < bulunan.length ? bulunan[k + 1].i : tk.length;
        return {u: b.u, miktar: miktarBul(b.son + 1, bit) || miktarBul(bas, b.i) || 1, kaynak: line};
      });
    }
    // eşleşmeyen ama ürün satırına benzeyen satır
    const harf = (line.match(/[A-Za-zÇĞİÖŞÜçğıöşü]/g) || []).length;
    if (harf >= 3 && line.length >= 5 && line.length <= 160 && /\d/.test(line) && !/(tarih|tel|fax|faks|e-?posta|vergi|iban|sayfa|toplam|kdv|adres|www\.|@)/i.test(line)) {
      const ki = tk.findIndex(t => /[A-Za-z]/.test(t) && /\d/.test(t) && t.length >= 5 && !/^\d+x\d+|^\d+[.,]?\d*(ad|adet|ka|a|v|w|kw|mm|mt|m)\.?$|^no:|^tkf-|^\d{4}-\d/i.test(t));
      if (ki < 0) return harf >= 4 ? [{u: null, ref: '', aciklama: line.replace(/[|;\t]/g, ' ').replace(/\s+/g, ' ').trim(), miktar: miktarBul(0, tk.length) || 1, kaynak: line}] : [];
      kul[ki] = true;
      return [{u: null, ref: tk[ki].replace(/[,;:]$/, ''), aciklama: line.replace(/[|;\t]/g, ' ').replace(/\s+/g, ' ').trim(), miktar: miktarBul(ki + 1, tk.length) || miktarBul(0, ki) || 1, kaynak: line}];
    }
    return [];
  }

  // ── Dosyadan metin satırları
  async function pdfSatirlar(file) {
    await script(LIB.pdfjs);
    pdfjsLib.GlobalWorkerOptions.workerSrc = LIB.pdfWorker;
    const pdf = await pdfjsLib.getDocument({data: await file.arrayBuffer()}).promise;
    const out = [];
    for (let p = 1; p <= Math.min(pdf.numPages, 30); p++) {
      const tc = await (await pdf.getPage(p)).getTextContent();
      const satir = new Map();
      for (const it of tc.items) { if (!it.str.trim()) continue; const y = Math.round(it.transform[5] / 3); if (!satir.has(y)) satir.set(y, []); satir.get(y).push([it.transform[4], it.str]); }
      [...satir.entries()].sort((a, b) => b[0] - a[0]).forEach(([, l]) => out.push(l.sort((a, b) => a[0] - b[0]).map(x => x[1]).join('  ')));
    }
    if (out.join('').trim().length < 20) throw new Error('Bu PDF taranmış (resim) görünüyor — sayfanın fotoğrafını ya da ekran görüntüsünü yükle');
    return out;
  }
  // Küçük yazılı fotoğraf / ekran görüntülerinde 2. geçiş: büyütülmüş + kontrastı artırılmış kopya okunur (cift=true).
  // Yatay ekran görüntüleri (DİA fişi gibi form/tablo) için sayfa bölütleme "seyrek metin" (6) ile okunur.
  async function guclendir(file) {
    const bmp = await createImageBitmap(file); if (bmp.width >= 2400) return null;
    const k = Math.min(3, Math.max(2, 2600 / bmp.width)), cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    const cx = cv.getContext('2d'); cx.filter = 'grayscale(1) contrast(1.5)'; cx.drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise(ok => cv.toBlob(b => ok(b), 'image/png'));
    return {blob, yatay: bmp.width > bmp.height * 1.2};
  }
  async function resimSatirlar(file, ilerle, cift) {
    await script(LIB.tesseract);
    const oku = async (f, etiket) => (await Tesseract.recognize(f, 'tur+eng', {logger: m => { if (m.status === 'recognizing text') ilerle('Fotoğraf okunuyor' + etiket + '… %' + Math.round(m.progress * 100)); }})).data.text.split('\n');
    let satir = await oku(file, '');
    if (cift) {
      try {
        const g = await guclendir(file);
        if (g) {
          let ek;
          if (g.yatay) {
            const w = await Tesseract.createWorker('tur+eng', 1, {logger: m => { if (m.status === 'recognizing text') ilerle('Ekran görüntüsü okunuyor (ayrıntı)… %' + Math.round(m.progress * 100)); }});
            try { await w.setParameters({tessedit_pageseg_mode: '6'}); ek = (await w.recognize(g.blob)).data.text.split('\n'); } finally { await w.terminate(); }
          } else ek = await oku(g.blob, ' (ayrıntı)');
          satir = satir.concat(['\u0001'], ek);   // \u0001: iki okuma arasında ayraç (satır birleştirmeyi engeller)
        }
      } catch (e) { /* büyütme olmazsa ilk okuma yeter */ }
    }
    return satir;
  }
  // Excel'de başlık satırı (Kod / Açıklama / Miktar…) varsa her dolu satır bir kalem olur — kodsuzlar dahil
  async function excelKalemler(file) {
    await script(LIB.sheetjs);
    const wb = XLSX.read(await file.arrayBuffer(), {type: 'array'}), out = [];
    const RX = {kod: /^(ürün |malzeme |stok |parça )?(kod|kodu|code|ref|referans|part ?no|sipariş kodu|p\/n)/i, ac: /açıklama|aciklama|tanım|tanim|malzeme( adı)?$|ürün( adı)?$|description|cins|ürün tanımı|malzeme adı/i, mik: /miktar|adet|qty|quantity|sayı/i, bir: /^birim$|unit|ölçü/i, mar: /marka|brand|üretici/i};
    for (const n of wb.SheetNames.slice(0, 5)) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], {header: 1, raw: false, blankrows: false});
      const hi = rows.findIndex((r, i) => i < 30 && r.some(c => RX.mik.test(String(c || ''))) && r.some(c => RX.ac.test(String(c || '')) || RX.kod.test(String(c || ''))));
      if (hi < 0) continue;
      const h = rows[hi].map(c => String(c || '').trim()), col = k => h.findIndex(c => RX[k].test(c));
      const ck = col('kod'), ca = h.findIndex((c, i) => i !== ck && RX.ac.test(c)), cm = col('mik'), cb = col('bir'), cr = col('mar');
      for (const r of rows.slice(hi + 1)) {
        const v = i => i >= 0 && r[i] != null ? String(r[i]).trim() : '';
        const kod = v(ck), ac = v(ca);
        if (!kod && !ac) continue;
        if (/toplam|genel|kdv/i.test(ac) && !kod) continue;
        const u = (kod && bul(kod)) || null;
        out.push({u, ref: kod, aciklama: ac, marka: v(cr), birim: v(cb), miktar: sayi(v(cm)) || 1, kaynak: kod + ' ' + ac});
      }
    }
    return out;
  }
  async function excelSatirlar(file) {
    await script(LIB.sheetjs);
    const wb = XLSX.read(await file.arrayBuffer(), {type: 'array'});
    const out = [];
    wb.SheetNames.slice(0, 5).forEach(n => XLSX.utils.sheet_to_json(wb.Sheets[n], {header: 1, raw: false, blankrows: false}).forEach(r => out.push(r.filter(c => c != null && String(c).trim() !== '').join(' | '))));
    return out;
  }

  // ── Ana akış
  // Dosya / fotoğraf / metinden satırları oku (teklif ve stok sayımı ortak kullanır)
  async function oku(dosyalar, metin, durum = () => {}) {
    dizin();
    const sonuc = [], hatalar = [];
    let sablon = null;
    try {
      if (metin) metin.split(/\n/).forEach(l => sonuc.push(...satirCoz(l)));
      for (const f of dosyalar || []) {
        const ad = f.name || 'dosya', tur = (f.type || '') + ' ' + ad.toLowerCase();
        durum(ad + ' okunuyor…');
        try {
          let satirlar;
          if (/\.xlsx?$|\.xlsm$|spreadsheet|excel/.test(tur)) {
            if (/\.xlsx$/.test(ad.toLowerCase())) { try { sablon = await TC.sablonOku(f); } catch (e) { sablon = null; } }
            if (sablon) continue;
            const ek = await excelKalemler(f);
            if (ek.length) { sonuc.push(...ek); continue; }
            satirlar = await excelSatirlar(f);
          } else if (/\.csv$|\.txt$|text\//.test(tur)) satirlar = (await f.text()).split(/\r?\n/);
          else if (/\.pdf$|pdf/.test(tur)) satirlar = await pdfSatirlar(f);
          else if (/image\/|\.(jpe?g|png|webp|heic|bmp)$/.test(tur)) satirlar = await resimSatirlar(f, durum);
          else throw new Error('desteklenmeyen dosya türü');
          satirlar.forEach(l => sonuc.push(...satirCoz(l)));
        } catch (e) { hatalar.push(ad + ': ' + (e.message || e)); }
      }
    } catch (e) { hatalar.push(e.message || String(e)); }

    return {sonuc, hatalar, sablon};
  }

  // Stoktan ürün seç: yazdıkça ürün koduna, marka ya da açıklamaya göre sonuç çıkar; dokununca onSec(u) çağrılır
  function urunSec(onSec, baslik = 'Ürün seç', coklu = false) {
    const sh = sheet(baslik, `<div class="search" style="margin-bottom:10px"><svg class="i"><use href="#i-search"/></svg><input class="inp" id="us-ara" placeholder="Ürün kodu ya da açıklama yaz" autocomplete="off" autocapitalize="characters"></div><div class="rows picker" id="us-list"></div>`);
    const ara = sh.el.querySelector('#us-ara'), list = sh.el.querySelector('#us-list');
    const ciz = () => {
      const q = ara.value.trim(); if (!q) { list.innerHTML = '<div class="empty" style="padding:14px">Yazdıkça ürünler çıkar</div>'; return; }
      const l = urunAra(q, 30);
      list.innerHTML = l.length ? '' : '<div class="empty" style="padding:14px">Stokta bulunamadı</div>';
      l.forEach(u => { const b = document.createElement('button'); b.type = 'button'; b.className = 'row';
        b.innerHTML = `<div class="mid"><div class="t">${esc(u.ref)} <span style="color:var(--fg3);font-weight:500">· ${esc(u.marka)}</span></div><div class="s">${esc(u.aciklama)}</div></div><div class="end"><b>${u.fiyat ? esc(u.para || '€') + ' ' + fmtF(u.fiyat) : '<span style="color:var(--fg3)">fiyat sorunuz</span>'}</b><span style="margin-top:4px">${typeof stokRozet === 'function' ? stokRozet(u) : ''}</span></div>`;
        b.onclick = () => { onSec(u); if (coklu) { toast('✅ ' + (u.ref || 'Ürün') + ' eklendi'); ara.value = ''; ciz(); ara.focus(); } else sh.kapat(); };
        list.appendChild(b); });
    };
    ara.oninput = ciz; ciz(); setTimeout(() => ara.focus(), 50);
    return sh;
  }

  async function hizliTeklif(dosyalar, metin) {
    if (!S.stok.length) { toast('Ürün listesi henüz yüklenmedi, birkaç saniye sonra tekrar dene'); return; }
    dizin();
    const sh = sheet('Hızlı teklif', '<div id="hz-durum" class="note">Hazırlanıyor…</div><div id="hz-govde"></div>');
    const durum = s => { const e = sh.el.querySelector('#hz-durum'); if (e) e.textContent = s; };
    const {sonuc, hatalar, sablon} = await oku(dosyalar, metin, durum);

    // Ceylan şablonundaki Excel: olduğu gibi forma aktar
    if (sablon) {
      sh.kapat();
      const bos = !$('#tf-musteri').value.trim();
      if (bos) { ['musteri', 'ilgili', 'telefon', 'konu', 'odeme', 'gecerli', 'teslimYeri', 'kurUsd', 'kurEur'].forEach(k => { const el = $('#tf-' + k); if (el && sablon[k]) el.value = sablon[k]; }); }
      sablon.kalemler.forEach(k => kalemler.push(k)); kalemlerCiz();
      toast('✅ Şablondan ' + sablon.kalemler.length + ' kalem aktarıldı'); adim(bos && !sablon.musteri ? 1 : 2); return;
    }

    // Belge sırası korunur; aynı ürün tekrar ederse birleşir. Listede olmayan/kodsuz kalemler de eklenir (fiyatsız)
    const liste = [], gor = new Map();
    for (const r of sonuc) {
      const k = r.u ? 'u:' + r.u.id : 't:' + kN(r.ref) + '|' + (r.aciklama || '').toLowerCase();
      if (gor.has(k)) { const x = gor.get(k); x.miktar = Math.max(x.miktar, r.miktar); continue; }
      const x = {...r}; gor.set(k, x); liste.push(x);
    }
    const eslesen = liste.filter(r => r.u).length, eslesmeyen = liste.filter(r => !r.u);
    durum(liste.length ? `${liste.length} kalem okundu · ${eslesen} tanesi fiyat listesinde${eslesmeyen.length ? ` · ${eslesmeyen.length} tanesi listede yok/kodsuz (fiyatsız eklenir)` : ''}. İstemediklerinin işaretini kaldır.` : 'Okunabilen kalem bulunamadı');
    const g = sh.el.querySelector('#hz-govde');
    const fy = u => u.fiyat ? esc(u.para || '€') + ' ' + fmtF(u.fiyat) : 'fiyat sorunuz';
    const esitle = () => sh.el.querySelectorAll('[data-hz]').forEach(cb => { const r = liste[+cb.dataset.hz]; if (!r) return; r.kapali = !cb.checked; const m = sh.el.querySelector(`[data-hzm="${cb.dataset.hz}"]`); if (m) r.miktar = Number(m.value) || r.miktar; });
    const ciz = () => {
      g.innerHTML = (hatalar.length ? `<div class="note" style="color:var(--red)">${hatalar.map(esc).join('<br>')}</div>` : '') +
        (liste.length ? '<div class="rows">' + liste.slice(0, 200).map((r, i) => r.u
          ? `<label class="row hz-row"><input type="checkbox" data-hz="${i}"${r.kapali ? '' : ' checked'}><div class="mid"><div class="t">${esc(r.u.ref)} <span style="color:var(--fg3);font-weight:500">· ${esc(r.u.marka)}</span></div><div class="s">${esc(r.u.aciklama)}</div><button type="button" class="link-btn" data-hzdeg="${i}" style="padding:2px 0;font-size:12px">Başka ürün seç</button></div><div class="end"><input class="inp num hz-m" data-hzm="${i}" type="number" min="0" step="any" value="${esc(r.miktar)}" aria-label="Miktar"><span class="s">${fy(r.u)}</span></div></label>`
          : `<label class="row hz-row"><input type="checkbox" data-hz="${i}"${r.kapali ? '' : ' checked'}><div class="mid"><div class="t">${esc(r.ref || 'Kodsuz')} <span class="pill p-amber" style="margin-left:4px">listede yok</span></div><div class="s">${esc(r.aciklama)}</div><button type="button" class="btn btn-s btn-sm" data-hzdeg="${i}" style="margin-top:6px">Stoktan seç</button></div><div class="end"><input class="inp num hz-m" data-hzm="${i}" type="number" min="0" step="any" value="${esc(r.miktar)}" aria-label="Miktar"><span class="s">fiyatı sen gir</span></div></label>`).join('') + '</div>' : '') +
        `<button type="button" class="btn btn-s btn-block" id="hz-ekle" style="margin-top:10px">${ikon('plus')}Ürün ekle (koddan / açıklamadan ara)</button>` +
        (!liste.length ? '<div class="empty">Dosyadan okunabilen ürün satırı çıkmadı. Daha net bir fotoğraf ya da Excel/PDF dene; ya da yukarıdaki düğmeyle ürünü kendin seç.</div>' : '');
      g.querySelectorAll('[data-hzdeg]').forEach(bt => bt.onclick = e => { e.preventDefault(); e.stopPropagation(); esitle(); const i = +bt.dataset.hzdeg; urunSec(u => { liste[i].u = u; liste[i].kapali = false; ciz(); }, 'Ürünü stoktan seç'); });
      g.querySelector('#hz-ekle').onclick = () => { esitle(); urunSec(u => { liste.push({u, ref: u.ref, aciklama: u.aciklama, marka: u.marka, miktar: 1, birim: 'Adet'}); ciz(); }, 'Ürün ekle', true); };
    };
    ciz();
    const f = document.createElement('div'); f.className = 'sheet-f';
    f.innerHTML = '<button class="btn btn-s">Vazgeç</button><button class="btn btn-p">Teklife ekle</button>';
    sh.el.querySelector('.sheet').appendChild(f);
    f.firstChild.onclick = () => sh.kapat();
    f.lastChild.onclick = () => {
      let n = 0;
      sh.el.querySelectorAll('[data-hz]').forEach(cb => {
        if (!cb.checked) return;
        const id = cb.dataset.hz, m = Number(sh.el.querySelector(`[data-hzm="${id}"]`).value) || 1;
        const r = liste[+id], u = r.u;
        if (u) kalemler.push({ref: u.ref || '', aciklama: u.aciklama || r.aciklama || '', marka: u.marka || '', miktar: m, birim: r.birim || 'Adet', fiyat: u.fiyat || '', para: u.para || '€', iskonto: 0});
        else kalemler.push({ref: r.ref || '', aciklama: r.aciklama || '', marka: r.marka || '', miktar: m, birim: r.birim || 'Adet', fiyat: '', para: '€', iskonto: 0});
        n++;
      });
      if (!n) { toast('Eklenecek kalem seçilmedi'); return; }
      sh.kapat(); kalemlerCiz(); toast('✅ ' + n + ' kalem teklife eklendi');
      if (!$('#tf-musteri').value.trim()) { adim(1); toast('Kalemler eklendi — müşteri adını yazıp devam et', 3500); $('#tf-musteri').focus(); } else adim(2);
    };
  }

  // ── Arayüz
  // Yazarak ürün seç: aradıkça çıkan ürünlere dokunup listeye ekle, miktarı yaz, tek seferde teklife ekle
  function hizliSec() {
    dizin(); const sec = [];
    const sh = sheet('Ürün seç', `<div class="search" style="margin-bottom:10px"><svg class="i"><use href="#i-search"/></svg><input class="inp" id="hs-ara" placeholder="Ürün kodu ya da açıklama yaz" autocomplete="off" autocapitalize="characters"></div>
      <div class="rows picker" id="hs-list" style="max-height:34vh;overflow:auto"></div>
      <div class="vu-h" style="padding-left:0;margin-top:12px">Seçilenler <span id="hs-say">0</span></div><div class="rows" id="hs-sec"></div>`);
    const ara = sh.el.querySelector('#hs-ara'), list = sh.el.querySelector('#hs-list'), box = sh.el.querySelector('#hs-sec');
    const secCiz = () => {
      sh.el.querySelector('#hs-say').textContent = sec.length;
      box.innerHTML = sec.length ? sec.map((r, i) => `<div class="row hz-row"><div class="mid"><div class="t">${esc(r.u.ref)} <span style="color:var(--fg3);font-weight:500">· ${esc(r.u.marka)}</span></div><div class="s">${esc(r.u.aciklama)}</div></div><div class="end" style="flex-direction:row;gap:6px;align-items:center"><input class="inp num hz-m" data-hsm="${i}" type="number" min="0" step="any" value="${esc(r.miktar)}" aria-label="Miktar"><button type="button" class="icon-btn" data-hsx="${i}" aria-label="Çıkar">${ikon('x')}</button></div></div>`).join('') : '<div class="empty" style="padding:12px">Henüz ürün seçmedin</div>';
      box.querySelectorAll('[data-hsm]').forEach(inp => inp.oninput = () => { sec[+inp.dataset.hsm].miktar = Number(inp.value) || 1; });
      box.querySelectorAll('[data-hsx]').forEach(b => b.onclick = () => { sec.splice(+b.dataset.hsx, 1); secCiz(); });
    };
    const ciz = () => {
      const q = ara.value.trim(); if (!q) { list.innerHTML = '<div class="empty" style="padding:14px">Yazdıkça ürünler çıkar; dokunarak ekle</div>'; return; }
      const l = urunAra(q, 30); list.innerHTML = l.length ? '' : '<div class="empty" style="padding:14px">Stokta bulunamadı</div>';
      l.forEach(u => { const b = document.createElement('button'); b.type = 'button'; b.className = 'row';
        b.innerHTML = `<div class="mid"><div class="t">${esc(u.ref)} <span style="color:var(--fg3);font-weight:500">· ${esc(u.marka)}</span></div><div class="s">${esc(u.aciklama)}</div></div><div class="end"><b>${u.fiyat ? esc(u.para || '€') + ' ' + fmtF(u.fiyat) : '<span style="color:var(--fg3)">fiyat sorunuz</span>'}</b><span style="margin-top:4px">${typeof stokRozet === 'function' ? stokRozet(u) : ''}</span></div>`;
        b.onclick = () => { const var_ = sec.find(r => r.u.id === u.id); if (var_) var_.miktar++; else sec.push({u, miktar: 1}); secCiz(); ara.select(); };
        list.appendChild(b); });
    };
    ara.oninput = ciz; ciz(); secCiz(); setTimeout(() => ara.focus(), 50);
    const f = document.createElement('div'); f.className = 'sheet-f'; f.innerHTML = '<button class="btn btn-s">Vazgeç</button><button class="btn btn-p">Teklife ekle</button>';
    sh.el.querySelector('.sheet').appendChild(f);
    f.firstChild.onclick = () => sh.kapat();
    f.lastChild.onclick = () => {
      if (!sec.length) { toast('Önce ürün seç'); return; }
      sec.forEach(r => kalemler.push({ref: r.u.ref || '', aciklama: r.u.aciklama || '', marka: r.u.marka || '', miktar: r.miktar, birim: r.u.birim || 'Adet', fiyat: r.u.fiyat || '', para: r.u.para || '€', iskonto: 0}));
      sh.kapat(); kalemlerCiz(); toast('✅ ' + sec.length + ' kalem teklife eklendi');
      if (!$('#tf-musteri').value.trim()) { adim(1); toast('Kalemler eklendi — müşteri adını yazıp devam et', 3500); $('#tf-musteri').focus(); } else adim(2);
    };
  }
  function ac() {
    const sh = sheet('Hızlı teklif', `<div class="fg">
      <p class="note">Müşterinin gönderdiği <b>fotoğraf, ekran görüntüsü, PDF, Excel</b> ya da <b>WhatsApp/mail metni</b>nden ürün kodlarını okuyup fiyat listesindeki ürünlerle eşleştirir. Teklif yine Ceylan şablonunda çıkar.</p>
      <button type="button" class="btn btn-p btn-block" id="hz-ara-btn">${ikon('search')}Ürün kodu / açıklama yazarak seç</button>
      <label class="btn btn-s btn-block" style="cursor:pointer"><svg class="i"><use href="#i-bolt"/></svg>Dosya / fotoğraf seç<input type="file" id="hz-dosya" multiple accept="image/*,.pdf,.xlsx,.xls,.csv,.txt" hidden></label>
      <div class="f"><label for="hz-metin">…ya da metni yapıştır</label><textarea class="inp" id="hz-metin" rows="5" placeholder="ör.&#10;MTH10-1080B 12 adet&#10;001 046 078080 00 17 x 50"></textarea></div>
    </div>`, [{label: 'Vazgeç', onClick: () => {}}, {label: 'Metinden çıkar', cls: 'btn-p', onClick: ov => { const t = ov.querySelector('#hz-metin').value.trim(); if (!t) { toast('Metin boş'); return false; } setTimeout(() => hizliTeklif([], t), 0); }}]);
    sh.el.querySelector('#hz-ara-btn').onclick = () => { sh.kapat(); setTimeout(() => hizliSec(), 0); };
    sh.el.querySelector('#hz-dosya').onchange = e => { const fl = [...e.target.files]; if (!fl.length) return; sh.kapat(); hizliTeklif(fl); };
  }
  window.hizliTeklif = hizliTeklif;
  // Bir dosyanın düz metin satırları (sipariş formu okuma için)
  window.hzMetin = async (f, durum = () => {}, cift = false) => {
    const ad = (f.name || '').toLowerCase(), tur = (f.type || '') + ' ' + ad;
    if (/\.xlsx?$|\.xlsm$|spreadsheet|excel/.test(tur)) return excelSatirlar(f);
    if (/\.csv$|\.txt$|text\//.test(tur)) return (await f.text()).split(/\r?\n/);
    if (/\.pdf$|pdf/.test(tur)) return pdfSatirlar(f);
    if (/image\/|\.(jpe?g|png|webp|heic|bmp)$/.test(tur)) return resimSatirlar(f, durum, cift);
    return [];
  };
  // Sayım için: şablon Excel'i de kalem listesine çevirir
  window.hzOku = async (dosyalar, metin, durum) => {
    const r = await oku(dosyalar, metin, durum);
    if (r.sablon) r.sonuc.push(...r.sablon.kalemler.map(k => ({u: bul(k.ref) || null, ref: k.ref, aciklama: k.aciklama, marka: k.marka, birim: k.birim, miktar: Number(k.miktar) || 1})));
    return r;
  };
  window.hzExcelKalemler = async f => { dizin(); return excelKalemler(f); };
  document.querySelectorAll('[data-act="hizli-teklif"]').forEach(b => b.onclick = ac);
})();
