'use strict';
/* Ceylan Ofis — teklif çıktıları: Ceylan şablonunda Excel, PDF, paylaşım/mail */
(function () {
  const LIB = {
    exceljs: 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
    pdfmake: 'https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/pdfmake.min.js',
    vfs: 'https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/vfs_fonts.js',
    sheetjs: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  };
  const SABLON = 'sablon/teklif-sablonu.xlsx';
  const LOGO = 'icons/ceylan-logo.svg'; // vektörel, şeffaf
  const TURKUAZ = '#34B6A7';
  const SATIR_ILK = 20, SATIR_SON = 181; // şablondaki kalem satırları

  const yuklenen = {};
  function script(src) {
    if (!yuklenen[src]) yuklenen[src] = new Promise((ok, no) => {
      const s = document.createElement('script'); s.src = src; s.async = true;
      s.onload = ok; s.onerror = () => { delete yuklenen[src]; no(new Error('Kütüphane yüklenemedi (internet bağlantısını kontrol et)')); };
      document.head.appendChild(s);
    });
    return yuklenen[src];
  }
  const pdfHazirla = () => script(LIB.pdfmake).then(() => script(LIB.vfs));
  const excelHazirla = () => script(LIB.exceljs);

  let logoData = null;
  async function logoAl() {
    if (logoData) return logoData;
    logoData = await fetch(LOGO).then(r => { if (!r.ok) throw new Error('logo'); return r.text(); });
    return logoData;
  }

  const num = v => { const n = Number(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0; };
  const para = (n, d = 2) => Number(n || 0).toLocaleString('tr-TR', {minimumFractionDigits: d, maximumFractionDigits: d});
  const PB = {'₺': 'TL', '€': 'EUR', '$': 'USD'};
  // Kuruşun altındaki fiyatlar (kablo bağı vb.) 5 haneye kadar gösterilir
  const fiyatYaz = n => n && Math.abs(n) < 1 ? Number(n).toLocaleString('tr-TR', {minimumFractionDigits: 2, maximumFractionDigits: 5}) : para(n);
  // Büyük rakamlar sütuna sığsın diye harf küçülür (satır kaymasın)
  const rakamFont = n => { const l = para(n).length; return l > 13 ? 5.8 : l > 11 ? 6.4 : 7; };
  const birimNet = k => num(k.fiyat) * (1 - num(k.iskonto) / 100);
  const satirToplam = k => birimNet(k) * (num(k.miktar) || 1);

  function toplamlar(t) {
    const top = {'₺': 0, '$': 0, '€': 0};
    (t.kalemler || []).forEach(k => { top[k.para || '€'] = (top[k.para || '€'] || 0) + satirToplam(k); });
    const usd = num(t.kurUsd), eur = num(t.kurEur);
    const genel = top['₺'] + top['$'] * usd + top['€'] * eur;
    const kursuz = (top['$'] && !usd) || (top['€'] && !eur);
    return {top, usd, eur, genel, kursuz};
  }

  function dosyaAdi(t, ext) {
    const temiz = s => String(s || '').replace(/[^\wçğıöşüÇĞİÖŞÜ-]+/g, '_').replace(/^_+|_+$/g, '');
    return 'Teklif_' + (temiz(t.musteri) || 'Musteri') + (t.no ? '_' + temiz(t.no) : '') + '.' + ext;
  }

  // ═══ EXCEL (gerçek Ceylan şablonu) ═══
  async function excelUret(t, ayar) {
    await excelHazirla();
    const buf = await fetch(SABLON).then(r => { if (!r.ok) throw new Error('Şablon bulunamadı'); return r.arrayBuffer(); });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    const set = (a, v) => { ws.getCell(a).value = v; };
    set('F8', t.musteri || ''); set('F9', t.ilgili || ''); set('F10', t.telefon || '');
    set('F11', [t.konu, t.not].filter(Boolean).join(' — ')); set('F12', t.no || '');
    const hz = (t.hazirlayan || '').toLocaleUpperCase('tr-TR');
    if (hz) { set('D16', hz); }
    set('L17', t.tarih ? new Date(t.tarih + 'T12:00:00') : new Date());
    const kal = (t.kalemler || []).slice(0, SATIR_SON - SATIR_ILK + 1);
    for (let r = SATIR_ILK; r <= SATIR_SON; r++) {
      const k = kal[r - SATIR_ILK], row = ws.getRow(r);
      if (!k) { row.hidden = true; continue; }
      row.hidden = false;
      row.getCell('C').value = r - SATIR_ILK + 1;
      row.getCell('D').value = k.ref || '';
      row.getCell('E').value = k.aciklama || '';
      row.getCell('G').value = k.marka || '';
      row.getCell('H').value = num(k.miktar) || 1;
      row.getCell('I').value = k.birim || 'Adet';
      row.getCell('J').value = k.fiyat === '' || k.fiyat == null ? null : num(k.fiyat);
      row.getCell('K').value = k.para || '€';
      row.getCell('L').value = num(k.iskonto);
      row.getCell('P').value = k.teslim || t.teslimSure || '';
    }
    // Formül sonuçlarını da yaz: Excel dışı önizleyiciler (iPhone, WhatsApp) de doğru toplamı göstersin
    const sonuc = (a, res) => { const c = ws.getCell(a), v = c.value; if (v && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v)) c.value = {...v, result: res}; };
    for (let r = SATIR_ILK; r <= SATIR_SON; r++) {
      const k = kal[r - SATIR_ILK];
      sonuc('M' + r, k ? birimNet(k) : 0); sonuc('N' + r, k ? satirToplam(k) : 0); sonuc('O' + r, k ? (k.para || '€') : (ws.getCell('K' + r).value || '₺'));
    }
    const T = toplamlar(t);
    sonuc('O184', T.top['₺']); sonuc('N185', T.top['$']); sonuc('O185', T.top['$'] * T.usd);
    sonuc('N186', T.top['€']); sonuc('O186', T.top['€'] * T.eur); sonuc('O187', T.genel);
    set('E184', ': ' + (t.odeme || '')); set('E185', ': ' + (t.gecerli || '')); set('E186', ': ' + (t.teslimYeri || ''));
    set('E187', ': ' + hz);
    if (num(t.kurUsd)) { set('N191', num(t.kurUsd)); set('O191', num(t.kurUsd)); }
    if (num(t.kurEur)) { set('N192', num(t.kurEur)); set('O192', num(t.kurEur)); }
    const sartlar = (ayar && ayar.sartlar || []).filter(Boolean);
    sartlar.slice(0, 4).forEach((s, i) => set('D' + (196 + i), s));
    wb.calcProperties.fullCalcOnLoad = true;
    const out = await wb.xlsx.writeBuffer();
    if ((t.kalemler || []).length > kal.length) console.warn('Şablon en fazla ' + kal.length + ' kalem alıyor');
    return new Blob([out], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }

  // ═══ PDF (şablonla aynı düzen) ═══
  async function pdfUret(t, ayar) {
    await pdfHazirla();
    const logo = await logoAl().catch(() => null);
    const T = toplamlar(t);
    const kalemler = t.kalemler || [];
    const hz = t.hazirlayan || '';
    const tarih = (t.tarih ? new Date(t.tarih + 'T12:00:00') : new Date()).toLocaleDateString('tr-TR', {day: '2-digit', month: 'long', year: 'numeric'});
    const th = s => ({text: s, style: 'th'});
    const rows = kalemler.map((k, i) => [
      {text: String(i + 1), alignment: 'center'}, {text: k.ref || '', bold: true, fontSize: String(k.ref || '').length > 20 ? 6.2 : 6.9}, k.aciklama || '', {text: k.marka || '', fontSize: 6.6},
      {text: para(num(k.miktar) || 1, num(k.miktar) % 1 ? 2 : 0), alignment: 'right', noWrap: true}, {text: k.birim || 'Adet', fontSize: 6.6},
      {text: k.fiyat === '' || k.fiyat == null ? '—' : fiyatYaz(num(k.fiyat)), alignment: 'right', noWrap: true, fontSize: rakamFont(num(k.fiyat))}, {text: k.para || '€', alignment: 'center'},
      {text: num(k.iskonto) ? '%' + para(num(k.iskonto), num(k.iskonto) % 1 ? 1 : 0) : '', alignment: 'right', noWrap: true},
      {text: k.fiyat === '' || k.fiyat == null ? '' : fiyatYaz(birimNet(k)), alignment: 'right', noWrap: true, fontSize: rakamFont(birimNet(k))},
      {text: k.fiyat === '' || k.fiyat == null ? '' : para(satirToplam(k)), alignment: 'right', bold: true, noWrap: true, fontSize: rakamFont(satirToplam(k))},
      {text: k.teslim || t.teslimSure || '', alignment: 'center', fontSize: 6.6},
    ].map(c => typeof c === 'string' ? {text: c} : c));
    const bilgi = (l, v) => [{text: l, style: 'lbl'}, {text: v || '', bold: !!v}];
    const sartlar = (ayar && ayar.sartlar || []).filter(Boolean);
    const topSatir = [];
    if (T.top['₺'] || (!T.top['$'] && !T.top['€'])) topSatir.push(['Toplam TL', para(T.top['₺']) + ' ₺']);
    if (T.top['$']) topSatir.push(['Toplam USD', para(T.top['$']) + ' $' + (T.usd ? '  (kur ' + para(T.usd, 4) + ')' : '')]);
    if (T.top['€']) topSatir.push(['Toplam EURO', para(T.top['€']) + ' €' + (T.eur ? '  (kur ' + para(T.eur, 4) + ')' : '')]);
    if ((T.top['$'] || T.top['€']) && !T.kursuz) topSatir.push(['Genel Toplam (TL)', para(T.genel) + ' ₺']);
    const kutu = (baslik, body, widths) => ({
      table: {widths, body: [[{text: baslik, style: 'kutuBaslik', colSpan: widths.length}, ...Array(widths.length - 1).fill({})], ...body]},
      layout: {hLineColor: () => '#c9d3d1', vLineColor: () => '#c9d3d1', hLineWidth: () => .6, vLineWidth: () => .6, paddingTop: () => 3, paddingBottom: () => 3},
    });

    const doc = {
      pageSize: 'A4', pageMargins: [28, 28, 28, 40],
      info: {title: 'Teklif ' + (t.no || ''), author: 'Ceylan Endüstriyel Otomasyon', subject: t.konu || ''},
      defaultStyle: {font: 'Roboto', fontSize: 8, color: '#1f2933'},
      styles: {
        th: {bold: true, fontSize: 6.8, color: '#ffffff', fillColor: TURKUAZ, alignment: 'center', noWrap: true},
        lbl: {color: '#5b6475', fontSize: 7.5},
        kutuBaslik: {bold: true, color: '#ffffff', fillColor: TURKUAZ, alignment: 'center', fontSize: 8},
      },
      footer: (cur, cnt) => ({columns: [{width: '*', text: 'Ceylan Endüstriyel Otomasyon · www.ceylanotomasyon.com.tr · info@ceylanotomasyon.com.tr', fontSize: 6.5, color: '#98a1b2'}, {width: 40, text: cur + ' / ' + cnt, alignment: 'right', fontSize: 6.5, color: '#98a1b2'}], margin: [28, 10, 28, 0]}),
      content: [
        {columns: [
          logo ? {svg: logo, width: 150} : {text: 'CEYLAN', bold: true, fontSize: 20},
          {stack: [
            {text: 'Ceylan Endüstriyel ve Otomasyon Tic. Ltd. Şti.', bold: true, fontSize: 11},
            {text: (ayar && ayar.adres) || 'Gaziler Mah. İbrahim Ağa Cd. No:221/A Gebze / KOCAELİ', margin: [0, 3, 0, 0]},
            {text: (ayar && ayar.telefon) || 'Tel: 0262 646 20 52 · Fax: 0262 646 28 21'},
            {text: 'www.ceylanotomasyon.com.tr · info@ceylanotomasyon.com.tr', color: '#5b6475'},
          ], alignment: 'right', fontSize: 8, margin: [0, 8, 0, 0]},
        ]},
        {canvas: [{type: 'line', x1: 0, y1: 0, x2: 539, y2: 0, lineWidth: 1.2, lineColor: TURKUAZ}], margin: [0, 8, 0, 8]},
        {columns: [
          {width: '*', table: {widths: [62, '*'], body: [bilgi('FİRMA', t.musteri), bilgi('İLGİLİ', t.ilgili), bilgi('TELEFON', t.telefon), bilgi('AÇIKLAMA', [t.konu, t.not].filter(Boolean).join(' — '))]}, layout: 'noBorders'},
          {width: 190, table: {widths: [70, '*'], body: [bilgi('TEKLİF NO', t.no), bilgi('TARİH', tarih), bilgi('GEÇERLİLİK', t.gecerli), bilgi('HAZIRLAYAN', hz.toLocaleUpperCase('tr-TR'))]}, layout: 'noBorders'},
        ], columnGap: 16},
        {table: {widths: ['*'], body: [[{text: 'TEKLİF FORMU', alignment: 'center', bold: true, fontSize: 12, color: '#ffffff', fillColor: TURKUAZ, margin: [0, 2, 0, 2]}]]}, layout: 'noBorders', margin: [0, 10, 0, 0]},
        {table: {headerRows: 1, dontBreakRows: true,
          widths: [11, 80, '*', 40, 28, 22, 46, 10, 18, 46, 54, 30],
          body: [[th('No'), th('Ürün Kodu'), th('Açıklama'), th('Marka'), th('Miktar'), th('Birim'), th('Liste Fiyat'), th('PB'), th('İsk.'), th('Net Fiyat'), th('Toplam'), th('Teslim')], ...rows]},
          layout: {fillColor: (r) => r > 0 && r % 2 === 0 ? '#f2f8f7' : null, hLineColor: () => '#d6dedd', vLineColor: () => '#d6dedd', hLineWidth: () => .5, vLineWidth: () => .5, paddingTop: () => 3, paddingBottom: () => 3, paddingLeft: () => 2, paddingRight: () => 2},
          fontSize: 7, margin: [0, 0, 0, 10]},
        {columns: [
          kutu('ŞARTLAR', [['Ödeme Şekli', t.odeme || ''], ['Opsiyon', t.gecerli || ''], ['Teslim Yeri', t.teslimYeri || ''], ['Hazırlayan', hz.toLocaleUpperCase('tr-TR')]].map(([a, b]) => [{text: a, style: 'lbl'}, b]), [70, '*']),
          kutu('TOPLAMLAR', topSatir.map(([a, b], i) => [{text: a, bold: i === topSatir.length - 1}, {text: b, alignment: 'right', bold: i === topSatir.length - 1}]), ['*', 120]),
        ], columnGap: 14, unbreakable: true},
        T.kursuz ? {text: 'Döviz cinsinden kalemler fatura tarihindeki TCMB satış kuru üzerinden TL\'ye çevrilecektir.', fontSize: 7, color: '#5b6475', margin: [0, 4, 0, 0]} : '',
        sartlar.length ? {stack: [
          {text: 'SATIŞ VE TESLİMAT ŞARTLARI', bold: true, color: TURKUAZ, fontSize: 8.5, margin: [0, 12, 0, 4]},
          {ol: sartlar, fontSize: 7.5, color: '#3d4655'},
        ], unbreakable: true} : '',
        {columns: [
          kutu('TEKLİF ONAYINIZ', [['Ad Soyad', ''], ['Tarih', ''], ['İmza / Kaşe', {text: ' \n\n', fontSize: 10}]].map(([a, b]) => [{text: a, style: 'lbl'}, b]), [70, '*']),
          {text: ''},
        ], columnGap: 14, margin: [0, 14, 0, 0], unbreakable: true},
      ],
    };
    return new Promise((ok, no) => { try { pdfMake.createPdf(doc).getBlob(ok); } catch (e) { no(e); } });
  }

  // ═══ EXCEL'DEN TEKLİF OKUMA (Ceylan şablonu) ═══
  function hucre(c) {
    if (!c || c.v == null) return '';
    const v = c.v;
    if (v instanceof Date) return v;
    return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v;
  }
  const PARA = {'₺': '₺', 'TL': '₺', 'TRY': '₺', '€': '€', 'EUR': '€', 'EURO': '€', '$': '$', 'USD': '$'};
  const tarihStr = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const sart = s => String(s || '').replace(/^\s*:\s*/, '').trim();
  async function sablonOku(file) {
    if (!/\.xlsx$/i.test(file.name)) throw new Error('Sadece .xlsx dosyaları okunabilir (eski .xls ise Excel\'de "Farklı kaydet → .xlsx" yap)');
    await script(LIB.sheetjs);
    const wb = XLSX.read(await file.arrayBuffer(), {type: 'array', cellDates: true, cellFormula: false, cellStyles: false});
    const ws = wb.Sheets[wb.SheetNames[0]];
    const g = a => hucre(ws[a]);
    const baslik = String(g('E19') || '') + String(g('D19') || '');
    if (!/a[çc][ıi]klama|ürün kodu/i.test(baslik)) throw new Error('Ceylan teklif şablonu değil (19. satırda "Ürün Kodu / Açıklama" başlığı bulunamadı)');
    const kalemler = [];
    for (let r = SATIR_ILK; r <= SATIR_SON; r++) {
      const ref = g('D' + r), ac = g('E' + r);
      if (!ref && !ac) continue;
      const pb = String(g('K' + r) || '').toUpperCase().trim();
      const fiyat = g('J' + r);
      kalemler.push({
        ref: String(ref), aciklama: String(ac), marka: String(g('G' + r) || ''),
        miktar: num(g('H' + r)) || 1, birim: String(g('I' + r) || 'Adet'),
        fiyat: fiyat === '' ? '' : num(fiyat), para: PARA[pb] || '€', iskonto: num(g('L' + r)),
        teslim: String(g('P' + r) || ''),
      });
    }
    if (!kalemler.length) throw new Error('Dosyada kalem bulunamadı');
    const tarihH = g('L17');
    const kurU = num(g('O191')) || num(g('N191')), kurE = num(g('O192')) || num(g('N192'));
    const t = {
      musteri: String(g('F8') || ''), ilgili: String(g('F9') || ''), telefon: String(g('F10') || ''),
      konu: String(g('F11') || ''), no: String(g('F12') || ''),
      hazirlayan: String(g('D16') || sart(g('E187')) || ''),
      tarih: tarihH instanceof Date ? tarihStr(tarihH) : tarihStr(new Date(file.lastModified || Date.now())),
      odeme: sart(g('E184')), gecerli: sart(g('E185')), teslimYeri: sart(g('E186')),
      kurUsd: kurU ? String(kurU) : '', kurEur: kurE ? String(kurE) : '',
      kalemler, kalemSayisi: kalemler.length, kaynakDosya: file.name,
    };
    // hazırlayan büyük harfle yazılıysa düzgün yaz (HASRET CAN CERAN → Hasret Can Ceran)
    if (t.hazirlayan && t.hazirlayan === t.hazirlayan.toLocaleUpperCase('tr-TR')) t.hazirlayan = t.hazirlayan.toLocaleLowerCase('tr-TR').replace(/(^|\s)\S/g, s => s.toLocaleUpperCase('tr-TR'));
    // müşteri adı boşsa dosya adından tahmin et (Teklif_CP_Makina_... → CP Makina)
    if (!t.musteri) { const m = file.name.replace(/\.xlsx$/i, '').replace(/^teklif[_\s-]*/i, '').split(/[_\s-]+/).filter(x => x && !/^\d+$/.test(x) && !/kalem$/i.test(x)).slice(0, 3).join(' '); t.musteri = m || 'Müşteri'; t.musteriTahmin = true; }
    return t;
  }

  // ═══ GENEL LİSTE RAPORU (cari bakiye vb.): Excel + PDF ═══
  async function listeExcel(baslik, kolonlar, satirlar, opt = {}) {
    await excelHazirla();
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Rapor', {views: [{state: 'frozen', ySplit: 4}]});
    ws.addRow(['Ceylan Endüstriyel ve Otomasyon Tic. Ltd. Şti.']).font = {bold: true, size: 13};
    ws.addRow([baslik + ' · ' + new Date().toLocaleDateString('tr-TR')]).font = {size: 11, color: {argb: 'FF5B6475'}};
    ws.addRow([]);
    const h = ws.addRow(kolonlar);
    h.eachCell(c => { c.font = {bold: true, color: {argb: 'FFFFFFFF'}}; c.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: 'FF34B6A7'}}; c.alignment = {vertical: 'middle'}; });
    satirlar.forEach(r => ws.addRow(r));
    const sayi = opt.sayiKolon || [];
    ws.columns.forEach((col, i) => {
      let w = String(kolonlar[i] || '').length; col.eachCell({includeEmpty: false}, (c, rn) => { if (rn > 3) w = Math.max(w, String(c.value ?? '').length); });
      col.width = Math.min(60, Math.max(8, w + 2));
      if (sayi.includes(i)) col.numFmt = '#,##0.00';
    });
    const son = ws.rowCount;
    if (sayi.length) { const tr = ws.addRow(kolonlar.map((_, i) => i === 0 ? 'TOPLAM' : sayi.includes(i) ? {formula: `SUM(${ws.getColumn(i + 1).letter}5:${ws.getColumn(i + 1).letter}${son})`, result: satirlar.reduce((s, r) => s + (Number(r[i]) || 0), 0)} : '')); tr.font = {bold: true}; }
    ws.autoFilter = {from: {row: 4, column: 1}, to: {row: 4, column: kolonlar.length}};
    return new Blob([await wb.xlsx.writeBuffer()], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  async function listePdf(baslik, kolonlar, satirlar, opt = {}) {
    await pdfHazirla();
    const logo = await logoAl().catch(() => null);
    const sayi = opt.sayiKolon || [];
    const body = [kolonlar.map(k => ({text: k, style: 'th'})), ...satirlar.map(r => r.map((v, i) => sayi.includes(i) ? {text: v === '' || v == null ? '' : para(v), alignment: 'right'} : String(v ?? '')))];
    if (sayi.length) body.push(kolonlar.map((_, i) => i === 0 ? {text: 'TOPLAM', bold: true} : sayi.includes(i) ? {text: para(satirlar.reduce((s, r) => s + (Number(r[i]) || 0), 0)), alignment: 'right', bold: true} : ''));
    const doc = {
      pageSize: 'A4', pageOrientation: 'landscape', pageMargins: [24, 24, 24, 34],
      defaultStyle: {font: 'Roboto', fontSize: 7.5},
      styles: {th: {bold: true, color: '#ffffff', fillColor: TURKUAZ, fontSize: 7.5}},
      footer: (c, n) => ({text: c + ' / ' + n, alignment: 'right', fontSize: 7, color: '#98a1b2', margin: [24, 10, 24, 0]}),
      content: [
        {columns: [logo ? {svg: logo, width: 110} : {text: 'CEYLAN', bold: true}, {stack: [{text: baslik, bold: true, fontSize: 13}, {text: new Date().toLocaleDateString('tr-TR', {day: '2-digit', month: 'long', year: 'numeric'}) + ' · ' + satirlar.length + ' kayıt', color: '#5b6475'}], alignment: 'right', margin: [0, 10, 0, 0]}]},
        {table: {headerRows: 1, widths: kolonlar.map((_, i) => i === 1 ? '*' : 'auto'), body}, layout: {fillColor: r => r > 0 && r % 2 === 0 ? '#f2f8f7' : null, hLineColor: () => '#d6dedd', vLineColor: () => '#d6dedd', hLineWidth: () => .4, vLineWidth: () => .4}, margin: [0, 12, 0, 0]},
      ],
    };
    return new Promise((ok, no) => { try { pdfMake.createPdf(doc).getBlob(ok); } catch (e) { no(e); } });
  }

  function indir(blob, ad) {
    const u = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = u; a.download = ad; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 60000);
  }

  function sablonDoldur(s, t) {
    return String(s || '').replace(/\{(\w+)\}/g, (_, k) => t[k] ?? '');
  }

  async function paylas(blob, ad, t, mailAyar) {
    const konu = sablonDoldur(mailAyar && mailAyar.konu || '{no} numaralı teklifimiz', t);
    const govde = sablonDoldur(mailAyar && mailAyar.govde || '', t);
    const file = new File([blob], ad, {type: 'application/pdf'});
    if (navigator.canShare && navigator.canShare({files: [file]})) {
      await navigator.share({files: [file], title: konu, text: govde});
      return 'paylasildi';
    }
    indir(blob, ad);
    const to = encodeURIComponent(t.eposta || '');
    location.href = 'mailto:' + to + '?subject=' + encodeURIComponent(konu) + '&body=' + encodeURIComponent(govde + '\n\n(PDF teklif dosyası ekte — indirilenler klasöründen ekleyin)');
    return 'mailto';
  }

  window.TeklifCikti = {excelUret, pdfUret, sablonOku, listeExcel, listePdf, indir, paylas, dosyaAdi, toplamlar, pdfHazirla, excelHazirla};
})();
