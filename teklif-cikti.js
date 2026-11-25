'use strict';
/* Ceylan Ofis — teklif çıktıları: Ceylan şablonunda Excel, PDF, paylaşım/mail */
(function () {
  const LIB = {
    exceljs: 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
    pdfmake: 'https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/pdfmake.min.js',
    vfs: 'https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/vfs_fonts.js',
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
      {text: String(i + 1), alignment: 'center'}, {text: k.ref || '', bold: true}, k.aciklama || '', k.marka || '',
      {text: para(num(k.miktar) || 1, 0), alignment: 'right'}, k.birim || 'Adet',
      {text: k.fiyat === '' || k.fiyat == null ? '—' : para(num(k.fiyat)), alignment: 'right'}, {text: k.para || '€', alignment: 'center'},
      {text: num(k.iskonto) ? '%' + para(num(k.iskonto), 0) : '', alignment: 'right'},
      {text: k.fiyat === '' || k.fiyat == null ? '' : para(birimNet(k)), alignment: 'right'},
      {text: k.fiyat === '' || k.fiyat == null ? '' : para(satirToplam(k)), alignment: 'right', bold: true},
      {text: k.teslim || t.teslimSure || '', alignment: 'center'},
    ]);
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
        th: {bold: true, fontSize: 7.2, color: '#ffffff', fillColor: TURKUAZ, alignment: 'center'},
        lbl: {color: '#5b6475', fontSize: 7.5},
        kutuBaslik: {bold: true, color: '#ffffff', fillColor: TURKUAZ, alignment: 'center', fontSize: 8},
      },
      footer: (cur, cnt) => ({columns: [{text: 'Ceylan Endüstriyel Otomasyon · www.ceylanotomasyon.com.tr · info@ceylanotomasyon.com.tr', fontSize: 6.5, color: '#98a1b2'}, {text: cur + ' / ' + cnt, alignment: 'right', fontSize: 6.5, color: '#98a1b2'}], margin: [28, 10, 28, 0]}),
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
          widths: [12, 66, '*', 38, 24, 22, 40, 12, 18, 40, 46, 30],
          body: [[th('No'), th('Ürün Kodu'), th('Açıklama'), th('Marka'), th('Miktar'), th('Birim'), th('Liste Fiyat'), th('PB'), th('İsk.'), th('Birim Net'), th('Toplam'), th('Teslim')], ...rows]},
          layout: {fillColor: (r) => r > 0 && r % 2 === 0 ? '#f2f8f7' : null, hLineColor: () => '#d6dedd', vLineColor: () => '#d6dedd', hLineWidth: () => .5, vLineWidth: () => .5, paddingTop: () => 3, paddingBottom: () => 3, paddingLeft: () => 2.5, paddingRight: () => 2.5},
          fontSize: 7.2, margin: [0, 0, 0, 10]},
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

  window.TeklifCikti = {excelUret, pdfUret, indir, paylas, dosyaAdi, toplamlar, pdfHazirla, excelHazirla};
})();
