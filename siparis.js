'use strict';
/* Ceylan Ofis — Sipariş takibi: tekliften ya da müşteri sipariş belgesinden sipariş açılır, durumu adım adım izlenir. */
const SDURUM = {
  alindi: ['Sipariş alındı', 'p-blue'], tedarik: ['Tedarikte', 'p-amber'], hazir: ['Hazır', 'p-orange'],
  kismi: ['Kısmi sevk', 'p-orange'], sevk: ['Sevk edildi', 'p-blue'], teslim: ['Teslim edildi', 'p-green'], fatura: ['Faturalandı', 'p-green'], iptal: ['İptal', 'p-red'],
};
const SADIM = ['alindi', 'tedarik', 'hazir', 'sevk', 'teslim', 'fatura'];
const SACIK = ['alindi', 'tedarik', 'hazir', 'kismi', 'sevk'];
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

// Belgedeki "Satın alan / Alıcı / Müşteri" etiketinden firma adını çıkar (satıcı = biz olduğu için Ceylan atlanır)
const SP_YASAL = new Set(['san', 'tic', 've', 'ltd', 'sti', 'as', 'anonim', 'limited', 'sirketi', 'sanayi', 'ticaret', 'sanayii', 'ith', 'ihr', 'paz', 'ins']);
// "Satıcı" ve "Satın alan" sütunları OCR'da tek satıra birleşebilir: "CEYLAN ENDÜSTRİYEL VE OTOM.TİC ÇÖZÜM END.SOĞ..." → Ceylan bölümünü çıkar
function spCeylanAyikla(ad) {
  const k = ad.split(/\s+/), bit = /(?:t[iİıI]c\.?|ltd\.?|[sş]t[iİıI]\.?|a\.?[sş]\.?)$/i, ek = /^(?:ltd\.?|[sş]t[iİıI]\.?|ltd\.[sş]t[iİıI]\.?)$/i;
  const i = k.findIndex(x => /ceylan/i.test(x)); if (i < 0) return ad;
  let j = i; while (j < k.length - 1 && !bit.test(k[j])) j++;
  while (j + 1 < k.length && ek.test(k[j + 1])) j++;
  return k.slice(0, i).concat(k.slice(j + 1)).join(' ').trim();
}
function spAliciAdi(satir) {
  const etiket = /(?:sat[ıi]n\s*al[aâ]n(?:\s*firma)?|al[ıi]c[ıi](?:\s*firma)?|m[üu][şs]teri\s*(?:[üu]nvan[ıi]|unvan[ıi]|ad[ıi])?|sipari[şs]\s*veren\s*firma)\s*[:;\-–]\s*/i;
  for (let i = 0; i < satir.length; i++) {
    const m = etiket.exec(satir[i]); if (!m) continue;
    let ad = satir[i].slice(m.index + m[0].length).trim();
    if (!ad && satir[i + 1]) ad = satir[i + 1].trim();
    ad = spCeylanAyikla(ad.split(/\s+(?:tel|fax|faks|adres|vergi|v\.?d)\b/i)[0].replace(/[:;|_]+$/g, '').trim());
    if (ad.length >= 5 && /[a-zçğıöşü]{3}/i.test(ad) && !/ceylan/i.test(ad)) return ad;
  }
  return '';
}
function spCariEsle(ad) {   // kısaltmalı adı ("ÇÖZÜM END.SOĞ.SİST.İNŞ.SAN.VE TİC.A.Ş.") cari listesindeki firmayla eşleştir
  const parca = s => firmaKatla(s).split(/\s+/).filter(x => x.length >= 3 && !SP_YASAL.has(x));
  const a = parca(ad); if (!a.length) return null;
  let en = null, es = 0;
  for (const c of S.musteri) {
    const b = parca(c.firma || ''); if (!b.length || /ceylan/.test(nrmTR(c.firma))) continue;
    if (!(b[0].startsWith(a[0]) || a[0].startsWith(b[0]))) continue;   // ilk sözcük tutmalı
    const skor = a.filter(x => b.some(y => y.startsWith(x) || x.startsWith(y))).length;
    if (skor > es || (skor === es && en && (c.firma || '').length < (en.firma || '').length)) { en = c; es = skor; }
  }
  return es >= Math.min(2, a.length) ? en : null;
}

// Müşteri sipariş numarasını bul: firmalar "Sipariş No", "Sip.No", "Satınalma No", "P.O.", "PO No", "Order No"… diye yazıyor
const SP_PO_ETIKET = [
  /sat[ıi]n\s*al(?:ma|m[ae])(?:\s*sipari[şs])?\s*(?:no|numaras[ıi]|n[o°]|nr)(?![a-z0-9])/i,
  /sipari[şs]\s*(?:no|numaras[ıi]|n[o°]|nr)(?![a-z0-9])/i,
  /s[iı]p\.?\s*(?:no|nr|numaras[ıi])(?![a-z0-9])/i,
  /\bp\.?\s?o\.?\s*(?:no|number|numaras[ıi]|nr|#)?(?=\s*[:#.\-]?\s*[A-Z0-9])/i,
  /\bs\.?\s?a\.?\s*(?:no|nr)(?![a-z0-9])/i,
  /purchase\s*order(?:\s*(?:no|number|nr))?/i,
  /\border\s*(?:no|number|nr|#)/i,
  /(?:belge|fi[şs]|talep\s*sipari[şs])\s*(?:no|numaras[ıi])(?![a-z0-9])/i,
];
function spPoBul(satir) {
  const deger = s => { const m = /^[\s:#.\-–|]*([A-Z0-9][A-Z0-9\-\/.]{2,24})/i.exec(s || ''); if (!m) return ''; const d = m[1].replace(/[.,\-\/]+$/, '');
    return /\d/.test(d) && !/^\d{1,2}[./]\d{1,2}[./]\d{2,4}$/.test(d) ? d : ''; };
  for (const re of SP_PO_ETIKET) for (let i = 0; i < satir.length; i++) {
    const kucuk = nrmTR(satir[i]);   // İ/I harf farkı için küçük harfle ara (SİP.NO)
    const m = kucuk.length === satir[i].length ? re.exec(kucuk) : re.exec(satir[i]); if (!m) continue;
    const d = deger(satir[i].slice(m.index + m[0].length)) || (/^[\s:#.\-–|]*$/.test(satir[i].slice(m.index + m[0].length)) ? deger(satir[i + 1]) : '');
    if (d) return d;
  }
  return '';
}

// Sipariş formu kalem tablosu: "Sıra  Mlz.Kodu  Tanım  [Tes.Tarihi]  Miktar  Birim  Birim Fiyat  Toplam"
// Fotoğraf OCR'ında ondalık virgül düşebilir (4,00 → 400); miktar × fiyat = tutar kontrolüyle düzeltilir.
const SP_BIRIM = 'AD|ADT|ADET|AD\\.|MT|MTR|M|KG|GR|LT|TOP|PK|PKT|PAKET|SET|TK|TAKIM|KUTU|RULO|M2|M3|ÇİFT|CIFT|ST';
const spTR = s => { s = String(s); return Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : /^\d+\.\d{1,2}$/.test(s) ? s : s.replace(/\./g, '')) || 0; };   // 5.327,7000 → 5327.7
function spKalemTablo(satir) {
  const hi = satir.findIndex(l => /miktar/i.test(l) && /(fiyat|tutar|birim)/i.test(l));
  const para = hi >= 0 && /\(\s*eur|€/i.test(satir.slice(hi, hi + 3).join(' ')) ? '€' : hi >= 0 && /\(\s*usd|\$/i.test(satir.slice(hi, hi + 3).join(' ')) ? '$' : '₺';
  const re = new RegExp('^\\s*(?:(\\d{1,3})\\s+)?(\\S*\\d\\S*)\\s+(.+?)\\s+(?:(\\d{1,2}[./]\\d{1,2}[./]20\\d{2})\\s+)?(?:[—–|_\\-]\\s+)?(\\d+(?:[.,]\\d+)?)\\s+(' + SP_BIRIM + ')\\s+([\\d.,]+)\\s+([\\d.,]+)\\s*(?:TL|TRY|EUR|USD|€|\\$)?\\s*$', 'i');
  const out = [], kullan = new Set();   // açıklamaya katılan satırlar (iki kalemde tekrar kullanılmasın)
  for (let i = hi >= 0 ? hi + 1 : 0; i < satir.length; i++) {
    const l = satir[i]; if (hi >= 0 && /^(?:\s*(?:kdv|br[üu]t|net|toplam|genel)\b|.*toplam\s*(?:tutar|miktar))/i.test(l) && out.length) continue;
    const m = re.exec(l); if (!m) continue;
    const fiyat = spTR(m[7]), tutar = spTR(m[8]); let mik = spTR(m[5]);
    if (!(fiyat > 0) || !(mik > 0)) continue;
    for (const b of [1, 10, 100]) { if (tutar > 0 && Math.abs(mik / b * fiyat - tutar) <= Math.max(0.05, tutar * 0.005)) { mik = mik / b; break; } }
    const devam = s => s && (s.match(/[A-Za-zÇĞİÖŞÜçğıöşü]/g) || []).length >= 3 && !re.test(s) && !/(miktar|tutar|\(tl\)|\(eur\)|s[ıi]ra\b|toplam|kdv|br[üu]t|^\s*not\b|[sş]artlar|[öo]deme|ay[ıi]rma)/i.test(s) && (s.match(/\d/g) || []).length <= 6 && !/\d{1,3}(?:[.,]\d{3})*[.,]\d{2}\s*$/.test(s);
    const once = devam(satir[i - 1]) && i - 1 > hi && !kullan.has(i - 1) ? satir[i - 1].trim() : '', sonra = devam(satir[i + 1]) && (/^\s*[(\[]/.test(satir[i + 1]) || (!/\d/.test(satir[i + 1]) && satir[i + 1].trim().length <= 40 && !/[a-zçğıöşü]/.test(satir[i + 1]))) ? satir[i + 1].trim() : '';
    if (once) kullan.add(i - 1); if (sonra) kullan.add(i + 1);
    out.push({ref: m[2].replace(/[.,]+$/, ''), aciklama: [once, m[3], sonra].filter(Boolean).join(' ').replace(/[|_]+/g, ' ').replace(/\s+/g, ' ').trim(), marka: '', miktar: mik, birim: /^m(tr?)?$/i.test(m[6]) ? 'Mt' : /^kg$/i.test(m[6]) ? 'Kg' : 'Adet', fiyat, para, iskonto: 0, teslim: m[4] ? m[4].replace(/\//g, '.') : '', geldi: false});
  }
  const son = new Map(); out.forEach(k => son.set(k.ref, k));   // iki okuma geçişinde aynı satır tekrarlanır; sonraki (büyütülmüş) geçiş kazanır
  return [...son.values()];
}

// ÜRÜN KODU BAZ ALINIR: müşterinin yazdığı açıklama yanlış olabilir. Satırdaki kod benzeri her ifade (ref ya da açıklama içinde) stoktaki
// kod ya da model adıyla ("MPR-25S-22") eşleştirilir; bulunursa kod / açıklama / marka stoktan gelir. OCR karışıklıkları (S↔5, O↔0, I↔1) tolere edilir.
let spKodIdx = null, spKodIdxN = -1;
const spKodAnahtar = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/S/g, '5').replace(/I/g, '1');
const spKodAdaylar = s => (String(s || '').toUpperCase().match(/[A-Z0-9][A-Z0-9\-\/.]{3,}[A-Z0-9]/g) || []).filter(x => /\d/.test(x) && /[A-Z]/.test(x) && !/^\d{1,2}[./]\d{1,2}[./]\d{2,4}$/.test(x));
function spKodIndeks() {
  if (spKodIdx && spKodIdxN === S.stok.length) return spKodIdx;
  const m = new Map(), ekle = (k, u) => { if (k.length < 5) return; if (!m.has(k)) m.set(k, []); const a = m.get(k); if (a.length < 6 && !a.includes(u)) a.push(u); };
  S.stok.forEach(u => { ekle(spKodAnahtar(u.ref), u); spKodAdaylar(u.aciklama).forEach(c => ekle(spKodAnahtar(c), u)); });
  spKodIdx = m; spKodIdxN = S.stok.length; return m;
}
function spKodEsle(k) {
  const idx = spKodIndeks(), adaylar = [...spKodAdaylar(k.ref), ...spKodAdaylar(k.aciklama)];
  for (const c of adaylar) {
    const u = (idx.get(spKodAnahtar(c)) || []).filter(x => x.fiyat !== null)[0] || (idx.get(spKodAnahtar(c)) || [])[0];
    if (u) return {...k, ref: u.ref, aciklama: u.aciklama || k.aciklama, marka: u.marka || k.marka || '', birim: k.birim || u.birim || 'Adet', musteriKod: k.ref && k.ref !== u.ref ? k.ref : '', musteriAciklama: (k.aciklama || '') !== (u.aciklama || '') ? k.aciklama || '' : '', stokEsles: true};
  }
  // stokta yok: açıklamadaki model kodunu (MPR-25S-22) ürün kodu yap, müşterinin iç kodunu ayrı sakla
  const kod = adaylar.find(c => /[A-Z]/.test(c) && /\d/.test(c) && /[-]/.test(c) && c !== String(k.ref || '').toUpperCase());
  if (kod && !(String(k.ref || '').match(/[A-Za-z]/) && /-/.test(k.ref))) return {...k, ref: kod, musteriKod: k.ref || '', musteriAciklama: k.aciklama || ''};
  return k;
}

// DİA / ERP "İrsaliye" ekran görüntüsü: Cari Hesap Bilgileri (Ünvanı) + kalem satırı (Sıra Tür Kodu Açıklama Miktar Birim Birim Fiyat … Döviz)
function spIrsaliyeOku(satir) {
  const tum = satir.join('\n');
  if (!/[İIiı]rsaliye\s*No/i.test(tum) || !/(cari\s*hesap|[ÜU]nvan)/i.test(tum)) return null;
  const o = {irsaliye: true};
  let m; const nolar = [...tum.matchAll(/[İIiı]rsaliye\s*No\s*[|:]?\s*([A-Z0-9]{8,})/gi)].map(x => x[1].toUpperCase()).sort((a, b) => b.length - a.length); if (nolar.length) o.irsaliyeNo = nolar[0];   // iki okumadan eksiksiz olan (en uzun) alınır
  m = /\bTarih\s*[|:]?\s*(\d{1,2})[./](\d{1,2})[./](20\d{2})/i.exec(tum); if (m) o.tarih = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /[ÜU]nvan[ıiIİ]?\s*[|:]?\s*([A-ZÇĞİÖŞÜ0-9][A-ZÇĞİÖŞÜ0-9 .,&'’\-\/]{4,})/.exec(tum);   // büyük harfli ünvan; sondaki simge artıklarını (Q, =) at
  if (m) o.firma = m[1].replace(/\s{2,}.*$/, '').trim().replace(/\s+[A-ZÇĞİÖŞÜ]$/, '').trim();
  const re = /^\s*(\d{1,3})\s+(?:Malzeme|Hizmet|Demirba[şs]|Stok)\s+(\S+)\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s+(MT|M|AD|ADT|ADET|KG|LT|TK|ST|PK|SET|KUTU|RULO)\s+(\d+(?:[.,]\d+)?)\s*(?:Hari[çc]|Dahil)?\s*(TL|USD|EUR)?/i;
  const kal = []; let son = -1;
  satir.forEach((l, i) => { const k = re.exec(l); if (!k) return; const mik = spTR(k[4]), fiyat = spTR(k[6]); if (!(mik > 0)) return; son = i;
    kal.push({ref: k[2], aciklama: k[3].replace(/[|_]+/g, ' ').replace(/\s+/g, ' ').trim(), marka: '', miktar: mik, birim: /^m(tr?)?$/i.test(k[5]) ? 'Mt' : /^kg$/i.test(k[5]) ? 'Kg' : 'Adet', fiyat: fiyat > 0 ? fiyat : '', para: /usd/i.test(k[7] || l) ? '$' : /eur/i.test(k[7] || l) ? '€' : '₺', iskonto: 0, geldi: false}); });
  if (kal.length) o.kalemler = kal;
  m = /G\.?\s*Toplam\s*[|:]?\s*(\d{1,3}(?:[ .]\d{3})*,\d{2,4})/i.exec(tum); if (m) o.tutar = '₺ ' + spTR(m[1].replace(/ /g, '')).toLocaleString('tr-TR', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ' (KDV dahil)';
  // müşteri sipariş no (Açıklama kutusu): kalem satırından sonra gelen tek başına 8–12 haneli sayı; OCR'da rakam karışabilir → forma yeşil işaretli yazılır
  for (const l of satir.slice(son + 1)) { const p = /(?<![\d.,])(2\d{7,11})(?![\d.,])/.exec(l); if (p) { o.po = p[1]; break; } }
  return o;
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
  for (const f of files) { try { durum(f.name + ' okunuyor…'); satir.push(...(await hzMetin(f, durum, true))); } catch (e) { durum('⚠ ' + f.name + ': ' + e.message); } }
  satir = satir.map(x => String(x || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const tum = satir.join('\n'), o = {};
  const po = spPoBul(satir); if (po) o.po = po;
  else { const m = /\b(45\d{8})\b/.exec(tum); if (m) o.po = m[1]; }
  satir.forEach((l, i) => {   // başlık satırı "Tes.Tarihi / Teslim Tarihi" ise tarih tablonun alt satırlarında olur
    if (o.termin || !/tes\.?\s*tarih|teslim\s*tarih|termin/i.test(l) || spTarih(l)) return;
    for (const n of satir.slice(i + 1, i + 4)) { const m = /(?<![\d.\/])(\d{1,2})[./](\d{1,2})[./](20\d{2})(?!\d)/.exec(n); if (m) { o.termin = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; break; } }
  });
  for (const l of satir) {
    if (!o.termin && /termin|tes\.?\s*tarih|teslim\s*tarih|teslimat\s*tarih|delivery\s*date|istenen\s*teslim|sevk\s*tarih/i.test(l)) o.termin = spTarih(l.split(/termin|teslim\s*tarihi?|teslimat\s*tarihi?|delivery\s*date|istenen\s*teslim|sevk\s*tarihi?/i).pop()) || spTarih(l);
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
  const alici = spAliciAdi(satir);
  if (alici) { const c = spCariEsle(alici); o.musteri = c ? c.firma : alici; o.musteriYeni = !c; }
  else if (en) o.musteri = en.firma;
  const irs = spIrsaliyeOku(satir);
  if (irs) {
    if (irs.po) o.po = irs.po; if (irs.tarih) o.tarih = irs.tarih; if (irs.irsaliyeNo) o.irsaliyeNo = irs.irsaliyeNo; if (irs.tutar) o.tutar = irs.tutar;
    if (irs.firma) { const c = spCariEsle(irs.firma); o.musteri = c ? c.firma : irs.firma; o.musteriYeni = !c; }
    if (irs.kalemler) o.kalemler = irs.kalemler;
  }
  const tablo = irs && irs.kalemler ? [] : spKalemTablo(satir);
  if (tablo.length) o.kalemler = tablo;
  else if (!(irs && irs.kalemler)) try { const r = await hzOku(files, '', durum); o.kalemler = r.sonuc.filter(x => x.u || x.ref).map(x => ({ref: x.u ? x.u.ref : x.ref || '', aciklama: x.u ? x.u.aciklama || '' : x.aciklama || '', marka: x.u ? x.u.marka || '' : x.marka || '', miktar: Number(x.miktar) || 1, birim: x.birim || 'Adet', fiyat: x.u ? x.u.fiyat || '' : '', para: x.u ? x.u.para || '€' : '€', geldi: false})); } catch (e) { o.kalemler = []; }
  if (o.kalemler && o.kalemler.length) o.kalemler = o.kalemler.map(spKodEsle);
  if (o.musteri) {
    const kod = new Set((o.kalemler || []).map(k => refN(k.ref)).filter(Boolean)), ilk = nrmTR(o.musteri).split(' ')[0];
    let bt = null, bs = -1;
    S.teklifler.filter(t => nrmTR(t.musteri || '').split(' ')[0] === ilk).forEach(t => { const sk = (t.kalemler || []).filter(k => kod.has(refN(k.ref))).length; if (sk > bs || (sk === bs && bt && (t.tarih || '') > (bt.tarih || ''))) { bs = sk; bt = t; } });
    if (bt) o.teklif = bt;
  }
  return o;
}

// Tekliften kısmi sipariş: teklif kalemi başına şimdiye kadar siparişe geçen adet
function spTeklifSiparisli(t, haricId) {
  const n = (t.kalemler || []).map(() => 0); let eski = false;
  S.siparisler.filter(x => x.teklifId === t.id && x.id !== haricId && (x.durum || 'alindi') !== 'iptal').forEach(x => (x.kalemler || []).forEach(k => { if (k.tIdx == null) eski = true; else if (n[k.tIdx] != null) n[k.tIdx] += Number(k.miktar) || 1; }));
  return (t.kalemler || []).map((k, i) => eski ? (Number(k.miktar) || 1) : n[i]);   // tIdx'siz eski sipariş = teklifin tamamı geçmiş sayılır
}
function spKalSec(t, haricId) {
  const gec = spTeklifSiparisli(t, haricId);
  return `<div class="vu-h" style="padding-left:0">Siparişe geçecek kalemler <span>işaretsiz kalan ürünler siparişe geçmez</span></div><div class="rows">${(t.kalemler || []).map((k, i) => { const m = Number(k.miktar) || 1, kalan = Math.max(0, m - gec[i]);
    return `<div class="row hz-row" style="padding:8px 4px;gap:10px"><input type="checkbox" data-ks="${i}"${kalan > 0 ? ' checked' : ' disabled'}><div class="mid"><div class="t" style="white-space:normal">${esc(k.ref || k.aciklama || '—')}</div><div class="s">${esc(k.ref ? (k.aciklama || '') : '')} · teklif ${m} ${esc(k.birim || '')}${gec[i] ? ' · siparişte ' + gec[i] : ''}</div></div>${kalan > 0 ? `<input class="inp num" data-km="${i}" type="number" min="0" max="${kalan}" step="any" value="${kalan}" style="width:84px">` : '<span class="pill p-green">tamam</span>'}</div>`; }).join('')}</div>`;
}

// Siparişe elle kalem ekle: stoktan ara (kod / marka / açıklama) ya da serbest yaz
function spKalemEkle(tamam) {
  const sh = sheet('Ürün / kalem ekle', `<div class="fg">
    <div class="f"><label for="ke-ara">Stoktan ara</label><div class="search"><svg class="i"><use href="#i-search"/></svg><input class="inp" id="ke-ara" placeholder="Ürün kodu, marka ya da açıklama"></div><div class="rows picker" id="ke-list" style="max-height:200px;overflow:auto;margin-top:6px"></div></div>
    <div class="f"><label for="ke-ref">Ürün kodu</label><input class="inp" id="ke-ref" autocapitalize="characters"></div>
    <div class="f"><label for="ke-ac">Açıklama *</label><input class="inp" id="ke-ac" placeholder="Stoktan seçilmediyse yaz"></div>
    <div class="fg2"><div class="f"><label for="ke-mik">Miktar *</label><input class="inp num" id="ke-mik" type="number" inputmode="decimal" min="0" step="any" value="1"></div><div class="f"><label for="ke-bir">Birim</label><input class="inp" id="ke-bir" value="Adet"></div></div>
    <div class="fg2"><div class="f"><label for="ke-fiyat">Birim fiyat</label><input class="inp num" id="ke-fiyat" type="number" inputmode="decimal" min="0" step="any"></div><div class="f"><label for="ke-para">Para</label><select class="sel" id="ke-para"><option>₺</option><option>€</option><option>$</option></select></div></div></div>`,
    [{label: 'Vazgeç', onClick: () => {}}, {label: 'Ekle', cls: 'btn-p', onClick: ov => {
      const ac = v(ov, 'ke-ac'), ref = v(ov, 'ke-ref'), mik = Number(v(ov, 'ke-mik')); if (!(ac || ref) || !(mik > 0)) { toast('Ürün (kod ya da açıklama) ve miktar gerekli'); return false; }
      const f = v(ov, 'ke-fiyat'), u = ref ? urunBulMarka(ref, '') : null;
      tamam({ref: ref || (u ? u.ref : ''), aciklama: ac || (u ? u.aciklama : ''), marka: u ? u.marka || '' : '', miktar: mik, birim: v(ov, 'ke-bir') || 'Adet', fiyat: f === '' ? '' : Number(f), para: ov.querySelector('#ke-para').value, iskonto: 0, geldi: false});
    }}]);
  const ara = sh.el.querySelector('#ke-ara'), list = sh.el.querySelector('#ke-list');
  ara.oninput = () => {
    const q = ara.value.trim(); if (!q) { list.innerHTML = ''; return; }
    const l = urunAra(q, 8); list.innerHTML = l.length ? '' : '<div class="empty" style="padding:10px">Stokta bulunamadı, aşağıya elle yaz</div>';
    l.forEach(u => { const b = document.createElement('button'); b.type = 'button'; b.className = 'row';
      b.innerHTML = `<div class="mid"><div class="t">${esc(u.ref)}</div><div class="s">${esc(u.marka)} · ${esc(u.aciklama)}</div></div><div class="end">${stokRozet(u)}</div>`;
      b.onclick = () => { sh.el.querySelector('#ke-ref').value = u.ref || ''; sh.el.querySelector('#ke-ac').value = u.aciklama || ''; if (u.fiyat) sh.el.querySelector('#ke-fiyat').value = u.fiyat; sh.el.querySelector('#ke-para').value = u.para || '₺'; if (u.birim) sh.el.querySelector('#ke-bir').value = u.birim; list.innerHTML = ''; ara.value = ''; sh.el.querySelector('#ke-mik').focus(); };
      list.appendChild(b); });
  };
  return sh;
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
    <div id="sp-kalsec"></div>
    <div id="sp-elle"></div>
    <div class="f"><label for="sp-not">Not</label><textarea class="inp" id="sp-not" rows="2">${esc(s.not || '')}</textarea></div>
    <div class="fg2"><div class="f"><label for="sp-irs">İrsaliye no</label><input class="inp" id="sp-irs" value="${esc(s.irsaliyeNo || '')}"></div>
      <div class="f"><label for="sp-fat">Fatura no</label><input class="inp" id="sp-fat" value="${esc(s.faturaNo || '')}"></div></div>
    <div class="f"><label for="sp-kargo">Kargo / sevk takip</label><input class="inp" id="sp-kargo" value="${esc(s.kargo || '')}" placeholder="Kargo firması + takip no ya da araç plakası"></div>
  </div>`, [{label: 'Vazgeç', onClick: () => {}}, {label: 'Kaydet', cls: 'btn-p', onClick: async ov => {
    const mus = v(ov, 'sp-musteri'); if (!mus) { toast('Müşteri adı gerekli'); return false; }
    const id = s.id || newId(), tid = v(ov, 'sp-teklif'), t = S.teklifler.find(x => x.id === tid);
    const files = secili;
    let secKal = null;   // teklif kalemlerinden seçilenler (kısmi sipariş)
    if (yeni && t && !okunan.length && ov.querySelector('[data-ks]')) {
      secKal = []; ov.querySelectorAll('[data-ks]').forEach(cb => { if (!cb.checked) return; const i = +cb.dataset.ks, k = (t.kalemler || [])[i], m = Number(ov.querySelector(`[data-km="${i}"]`).value); if (k && m > 0) secKal.push({...k, miktar: m, tIdx: i, geldi: false}); });
      if (!secKal.length) { toast('Siparişe geçecek en az bir kalem seç'); return false; }
    }
    const dos = files.length ? await spDosyaYukle(id, files) : [];
    const o = {...s, id, no: s.no || sipNo(), musteri: mus, musteriSipNo: v(ov, 'sp-po'), tarih: v(ov, 'sp-tarih') || bugun(), termin: v(ov, 'sp-termin'), tutar: v(ov, 'sp-tutar') || (t && t.tutar) || '', not: v(ov, 'sp-not'),
      teklifId: tid || '', teklifNo: t ? t.no : '', durum: s.durum || 'alindi', dosyalar: [...(s.dosyalar || []), ...dos],
      irsaliyeNo: v(ov, 'sp-irs'), faturaNo: v(ov, 'sp-fat'), kargo: v(ov, 'sp-kargo'),
      kalemler: [...(secKal ? secKal : (s.kalemler && s.kalemler.length && !(yeni && t && !okunan.length)) ? s.kalemler : okunan.length ? okunan : (t && Array.isArray(t.kalemler) ? t.kalemler.map(k => ({...k, geldi: false})) : [])), ...elle],
      gecmis: s.gecmis || [{t: new Date().toISOString(), d: 'alindi', k: ME}]};
    const ok = await kaydet('siparisler', o);
    if (ok && t && !['onaylandi', 'tamamlandi'].includes(t.durum)) await kaydet('teklifler', {...t, durum: 'onaylandi'});
    if (ok) { toast('✅ Sipariş kaydedildi' + (dos.length ? ' · ' + dos.length + ' dosya' : '')); if (aktifSayfa !== 'siparisler') git('siparisler'); }
  }}]);
  let secili = [], okunan = [], elle = [];
  const kalCiz = () => { const sec = sh.el.querySelector('#sp-kalsec'), tid = (sh.el.querySelector('#sp-teklif') || {}).value, tk = S.teklifler.find(x => x.id === tid);
    sec.innerHTML = yeni && tk && !okunan.length && (tk.kalemler || []).length ? spKalSec(tk, s.id) : ''; };
  // Kalem / ürün ekleme: belgeden okunanlar + elle eklenenler listelenir, silinebilir; "+ Ürün / kalem ekle" ile stoktan ya da elle eklenir
  const elleCiz = () => {
    const box = sh.el.querySelector('#sp-elle'); if (!box) return;
    const sat = (k, kaynak, i) => `<div class="row" style="padding:8px 4px;gap:8px"><div class="mid"><div class="t" style="white-space:normal;font-size:13.5px">${esc(k.ref || k.aciklama || '—')}</div><div class="s">${esc(k.ref ? k.aciklama || '' : '')}${k.ref && k.aciklama ? ' · ' : ''}${esc(k.miktar)} ${esc(k.birim || '')}${k.fiyat ? ' · ' + esc(fmtF(k.fiyat) + ' ' + (k.para || '')) : ''}</div></div><button type="button" class="icon-btn" data-ksil="${kaynak}:${i}" aria-label="Kalemi çıkar">${ikon('x')}</button></div>`;
    const list = okunan.map((k, i) => sat(k, 'o', i)).concat(elle.map((k, i) => sat(k, 'e', i)));
    box.innerHTML = `<div class="vu-h" style="padding-left:0">Kalemler / ürünler <span>${list.length ? (okunan.length + elle.length) + ' kalem' : 'henüz yok'}</span></div>${list.length ? `<div class="rows">${list.join('')}</div>` : ''}<button type="button" class="btn btn-s btn-block" id="sp-kal-ekle" style="margin-top:6px">${ikon('plus')}Ürün / kalem ekle</button>`;
    box.querySelector('#sp-kal-ekle').onclick = () => spKalemEkle(k => { elle.push(k); elleCiz(); });
    box.querySelectorAll('[data-ksil]').forEach(b => b.onclick = () => { const [w, i] = b.dataset.ksil.split(':'); (w === 'o' ? okunan : elle).splice(+i, 1); elleCiz(); });
  };
  setTimeout(elleCiz, 0);
  setTimeout(kalCiz, 0); sh.el.querySelector('#sp-teklif').addEventListener('change', kalCiz);
  const el = sh.el, ou = el.querySelector('#sp-oku');
  el.querySelector('#sp-dosya').onchange = async e => {
    secili = [...secili, ...e.target.files]; e.target.value = '';
    const dosyaSat = () => secili.map((f, i) => `<div class="row" style="padding:6px 0"><div class="mid"><div class="t" style="font-size:13px">${/image/.test(f.type) ? '🖼' : '📄'} ${esc(f.name)}</div></div><div class="end" style="flex-direction:row;gap:6px"><button class="btn btn-s btn-sm" data-spon="${i}" type="button">Önizle</button><button class="btn btn-s btn-sm" data-spcik="${i}" type="button">✕</button></div></div>`).join('');
    const bagla = () => { ou.querySelectorAll('[data-spon]').forEach(b => b.onclick = () => belgeOnizle(secili[+b.dataset.spon], secili[+b.dataset.spon].name)); ou.querySelectorAll('[data-spcik]').forEach(b => b.onclick = () => { secili.splice(+b.dataset.spcik, 1); ou.querySelector('.sp-dl').innerHTML = dosyaSat(); bagla(); }); };
    ou.innerHTML = `<div class="sp-dl">${dosyaSat()}</div><div class="note" id="sp-okd">Belge okunuyor…</div>`; bagla();
    const d = await spBelgeOku(secili, t => { const x = ou.querySelector('#sp-okd'); if (x) x.textContent = t; });
    const set = (id, val) => { const i = el.querySelector('#' + id); if (i && val && !i.value.trim()) { i.value = val; i.classList.add('okundu'); } };
    set('sp-musteri', d.musteri); set('sp-po', d.po); set('sp-irs', d.irsaliyeNo); set('sp-tutar', d.tutar); set('sp-termin', d.termin);
    if (d.tarih && !s.id) { const i = el.querySelector('#sp-tarih'); i.value = d.tarih; i.classList.add('okundu'); }
    const sel = el.querySelector('#sp-teklif');
    if (d.teklif && !sel.value) { if (![...sel.options].some(o => o.value === d.teklif.id)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(d.teklif.id)}">${esc((d.teklif.no || '') + ' · ' + (d.teklif.musteri || '') + ' · ' + trT(d.teklif.tarih))}</option>`); sel.value = d.teklif.id; sel.classList.add('okundu'); }
    okunan = d.kalemler || []; kalCiz(); elleCiz();
    const bul = [d.irsaliyeNo && 'irsaliye no', d.musteri && (d.musteriYeni ? 'müşteri (cari listesinde yok, eklemeyi unutma)' : 'müşteri'), d.po && 'sipariş no', d.tarih && 'tarih', d.termin && 'termin', d.tutar && 'tutar', d.teklif && 'teklif', okunan.length && okunan.length + ' kalem'].filter(Boolean);
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
    ${k.length ? `<button class="btn btn-p btn-block" data-dpgit style="margin:12px 0 2px">${ikon('box')}Depo / sevkiyat${s.paketler && s.paketler.length ? ' · ' + s.paketler.filter(p => p.durum !== 'iptal').length + ' paket' : ''}</button>` : ''}
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
  const dg = sh.el.querySelector('[data-dpgit]'); if (dg) dg.onclick = () => { sh.kapat(); setTimeout(() => dpDetay(id), 0); };
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
