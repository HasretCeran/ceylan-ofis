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
      if (ki < 0) return [];
      kul[ki] = true;
      return [{u: null, ref: tk[ki].replace(/[,;:]$/, ''), aciklama: line.replace(/\s+/g, ' ').trim(), miktar: miktarBul(ki + 1, tk.length) || miktarBul(0, ki) || 1, kaynak: line}];
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
  async function resimSatirlar(file, ilerle) {
    await script(LIB.tesseract);
    const r = await Tesseract.recognize(file, 'tur+eng', {logger: m => { if (m.status === 'recognizing text') ilerle('Fotoğraf okunuyor… %' + Math.round(m.progress * 100)); }});
    return r.data.text.split('\n');
  }
  async function excelSatirlar(file) {
    await script(LIB.sheetjs);
    const wb = XLSX.read(await file.arrayBuffer(), {type: 'array'});
    const out = [];
    wb.SheetNames.slice(0, 5).forEach(n => XLSX.utils.sheet_to_json(wb.Sheets[n], {header: 1, raw: false, blankrows: false}).forEach(r => out.push(r.filter(c => c != null && String(c).trim() !== '').join(' | '))));
    return out;
  }

  // ── Ana akış
  async function hizliTeklif(dosyalar, metin) {
    if (!S.stok.length) { toast('Ürün listesi henüz yüklenmedi, birkaç saniye sonra tekrar dene'); return; }
    dizin();
    const sh = sheet('Hızlı teklif', '<div id="hz-durum" class="note">Hazırlanıyor…</div><div id="hz-govde"></div>');
    const durum = s => { const e = sh.el.querySelector('#hz-durum'); if (e) e.textContent = s; };
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
            satirlar = await excelSatirlar(f);
          } else if (/\.csv$|\.txt$|text\//.test(tur)) satirlar = (await f.text()).split(/\r?\n/);
          else if (/\.pdf$|pdf/.test(tur)) satirlar = await pdfSatirlar(f);
          else if (/image\/|\.(jpe?g|png|webp|heic|bmp)$/.test(tur)) satirlar = await resimSatirlar(f, durum);
          else throw new Error('desteklenmeyen dosya türü');
          satirlar.forEach(l => sonuc.push(...satirCoz(l)));
        } catch (e) { hatalar.push(ad + ': ' + (e.message || e)); }
      }
    } catch (e) { hatalar.push(e.message || String(e)); }

    // Ceylan şablonundaki Excel: olduğu gibi forma aktar
    if (sablon) {
      sh.kapat();
      const bos = !$('#tf-musteri').value.trim();
      if (bos) { ['musteri', 'ilgili', 'telefon', 'konu', 'odeme', 'gecerli', 'teslimYeri', 'kurUsd', 'kurEur'].forEach(k => { const el = $('#tf-' + k); if (el && sablon[k]) el.value = sablon[k]; }); }
      sablon.kalemler.forEach(k => kalemler.push(k)); kalemlerCiz();
      toast('✅ Şablondan ' + sablon.kalemler.length + ' kalem aktarıldı'); adim(bos && !sablon.musteri ? 1 : 2); return;
    }

    // Aynı ürün birden çok satırda geçtiyse birleştir
    const es = new Map(), eslesmeyen = [];
    for (const r of sonuc) {
      if (r.u) { const k = r.u.id; if (es.has(k)) es.get(k).miktar = Math.max(es.get(k).miktar, r.miktar); else es.set(k, {...r}); }
      else if (!eslesmeyen.some(x => x.aciklama === r.aciklama)) eslesmeyen.push(r);
    }
    const liste = [...es.values()];
    durum(liste.length ? `${liste.length} ürün fiyat listesiyle eşleşti${eslesmeyen.length ? ` · ${eslesmeyen.length} satır eşleşmedi (istersen işaretleyip ekle)` : ''}` : 'Fiyat listesinde eşleşen ürün kodu bulunamadı' + (eslesmeyen.length ? ' — okunan satırlar aşağıda, işaretleyip ekleyebilirsin' : ''));
    const g = sh.el.querySelector('#hz-govde');
    const fy = u => u.fiyat ? esc(u.para || '€') + ' ' + fmtF(u.fiyat) : 'fiyat sorunuz';
    g.innerHTML = (hatalar.length ? `<div class="note" style="color:var(--red)">${hatalar.map(esc).join('<br>')}</div>` : '') +
      (liste.length ? `<div class="vu-h">Eşleşen ürünler <span>${liste.length}</span></div><div class="rows">` + liste.map((r, i) => `<label class="row hz-row"><input type="checkbox" data-hz="e${i}" checked><div class="mid"><div class="t">${esc(r.u.ref)} <span style="color:var(--fg3);font-weight:500">· ${esc(r.u.marka)}</span></div><div class="s">${esc(r.u.aciklama)}</div></div><div class="end"><input class="inp num hz-m" data-hzm="e${i}" type="number" min="0" step="any" value="${esc(r.miktar)}" aria-label="Miktar"><span class="s">${fy(r.u)}</span></div></label>`).join('') + '</div>' : '') +
      (eslesmeyen.length ? `<div class="vu-h">Eşleşmeyen satırlar <span>${eslesmeyen.length}</span></div><div class="rows">` + eslesmeyen.slice(0, 60).map((r, i) => `<label class="row hz-row"><input type="checkbox" data-hz="u${i}"><div class="mid"><div class="t">${esc(r.ref || '—')}</div><div class="s">${esc(r.aciklama)}</div></div><div class="end"><input class="inp num hz-m" data-hzm="u${i}" type="number" min="0" step="any" value="${esc(r.miktar)}" aria-label="Miktar"></div></label>`).join('') + '</div>' : '');
    if (!liste.length && !eslesmeyen.length) { g.insertAdjacentHTML('beforeend', '<div class="empty">Dosyadan okunabilen ürün satırı çıkmadı. Daha net bir fotoğraf ya da Excel/PDF dene.</div>'); }
    const f = document.createElement('div'); f.className = 'sheet-f';
    f.innerHTML = '<button class="btn btn-s">Vazgeç</button><button class="btn btn-p">Teklife ekle</button>';
    sh.el.querySelector('.sheet').appendChild(f);
    f.firstChild.onclick = () => sh.kapat();
    f.lastChild.onclick = () => {
      let n = 0;
      sh.el.querySelectorAll('[data-hz]').forEach(cb => {
        if (!cb.checked) return;
        const id = cb.dataset.hz, m = Number(sh.el.querySelector(`[data-hzm="${id}"]`).value) || 1;
        if (id[0] === 'e') { const u = liste[+id.slice(1)].u; kalemler.push({ref: u.ref || '', aciklama: u.aciklama || '', marka: u.marka || '', miktar: m, birim: 'Adet', fiyat: u.fiyat || '', para: u.para || '€', iskonto: 0}); }
        else { const r = eslesmeyen[+id.slice(1)]; kalemler.push({ref: r.ref || '', aciklama: r.aciklama || '', marka: '', miktar: m, birim: 'Adet', fiyat: '', para: '€', iskonto: 0}); }
        n++;
      });
      if (!n) { toast('Eklenecek kalem seçilmedi'); return; }
      sh.kapat(); kalemlerCiz(); toast('✅ ' + n + ' kalem teklife eklendi');
      if (!$('#tf-musteri').value.trim()) { adim(1); toast('Kalemler eklendi — müşteri adını yazıp devam et', 3500); $('#tf-musteri').focus(); } else adim(2);
    };
  }

  // ── Arayüz
  function ac() {
    const sh = sheet('Hızlı teklif', `<div class="fg">
      <p class="note">Müşterinin gönderdiği <b>fotoğraf, ekran görüntüsü, PDF, Excel</b> ya da <b>WhatsApp/mail metni</b>nden ürün kodlarını okuyup fiyat listesindeki ürünlerle eşleştirir. Teklif yine Ceylan şablonunda çıkar.</p>
      <label class="btn btn-p btn-block" style="cursor:pointer"><svg class="i"><use href="#i-bolt"/></svg>Dosya / fotoğraf seç<input type="file" id="hz-dosya" multiple accept="image/*,.pdf,.xlsx,.xls,.csv,.txt" hidden></label>
      <div class="f"><label for="hz-metin">…ya da metni yapıştır</label><textarea class="inp" id="hz-metin" rows="5" placeholder="ör.&#10;MTH10-1080B 12 adet&#10;001 046 078080 00 17 x 50"></textarea></div>
    </div>`, [{label: 'Vazgeç', onClick: () => {}}, {label: 'Metinden çıkar', cls: 'btn-p', onClick: ov => { const t = ov.querySelector('#hz-metin').value.trim(); if (!t) { toast('Metin boş'); return false; } setTimeout(() => hizliTeklif([], t), 0); }}]);
    sh.el.querySelector('#hz-dosya').onchange = e => { const fl = [...e.target.files]; if (!fl.length) return; sh.kapat(); hizliTeklif(fl); };
  }
  window.hizliTeklif = hizliTeklif;
  document.querySelectorAll('[data-act="hizli-teklif"]').forEach(b => b.onclick = ac);
})();
