'use strict';
/* Ceylan Ofis — Online Satış İçerik
   Her ürün için: ürün sayfası metni, kısa açıklama, teknik özellikler, anahtar kelimeler, satış fiyatı,
   ürün fotoğrafı + reklam görseli, durum (taslak → hazır → yayında) ve satış kanalları.
   Pazaryeri / web sitesi için Excel çıktısı; metin üretimi için "Claude'a hazırla" kopyalama. */
S.urun_icerik = S.urun_icerik || [];
let icYuklendi = false, icDurumF = '', icMarkaF = '', icAra = '';
const IC_DURUM = {taslak: ['Taslak', 'p-gray'], hazir: ['Hazır', 'p-blue'], yayinda: ['Yayında', 'p-green']};
const IC_KANAL = ['Web sitesi', 'Trendyol', 'Hepsiburada', 'n11', 'Amazon', 'Instagram'];
const IC_URL = new Map();   // görsel yolu → geçici bağlantı

async function icYukle() {
  if (icYuklendi) return; icYuklendi = true;
  if (DEMO) { S.urun_icerik = lsGet('co_urun_icerik', []); icCiz(); return; }
  try {
    S.urun_icerik = (await BE._hepsi('urun_icerik')).map(rowToObj); icCiz();
    sb.channel('ceylan-icerik').on('postgres_changes', {event: '*', schema: 'public', table: 'urun_icerik'}, p => {
      if (p.eventType === 'DELETE') S.urun_icerik = S.urun_icerik.filter(x => x.id !== (p.old && p.old.id));
      else { const o = rowToObj(p.new), i = S.urun_icerik.findIndex(x => x.id === o.id); if (i >= 0) S.urun_icerik[i] = o; else S.urun_icerik.push(o); }
      icCiz();
    }).subscribe();
  } catch (e) { console.warn('içerik', e); icYuklendi = false; toast('⚠ İçerikler yüklenemedi'); }
}
async function icGorsel(yol) {
  if (!yol) return '';
  if (/^(data:|https?:)/.test(yol)) return yol;
  if (IC_URL.has(yol)) return IC_URL.get(yol);
  const {data} = await sb.storage.from('belgeler').createSignedUrl(yol, 3600);
  const u = data ? data.signedUrl : ''; IC_URL.set(yol, u); return u;
}
async function icResimleriDoldur(kok) {
  for (const img of kok.querySelectorAll('img[data-yol]')) { const u = await icGorsel(img.dataset.yol); if (u) img.src = u; }
}
const icTamam = u => [u.ad, u.kisa, u.aciklama, (u.gorseller || []).some(g => g.tip === 'urun'), Number(u.fiyat) > 0].filter(Boolean).length;

function icCiz() {
  const el = $('#ic-list'); if (!el) return;
  const q = icAra.toLocaleLowerCase('tr-TR');
  const l = S.urun_icerik.filter(u => (!icDurumF || (u.durum || 'taslak') === icDurumF) && (!icMarkaF || u.marka === icMarkaF) && (!q || [u.kod, u.ad, u.marka, u.kategori].join(' ').toLocaleLowerCase('tr-TR').includes(q)))
    .sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  const say = k => S.urun_icerik.filter(u => (u.durum || 'taslak') === k).length;
  const markalar = [...new Set(S.urun_icerik.map(u => u.marka).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
  $('#ic-ozet').textContent = `${S.urun_icerik.length} ürün · ${say('yayinda')} yayında · ${say('hazir')} hazır · ${say('taslak')} taslak`;
  $('#ic-chips').innerHTML = [['', 'Tümü'], ...Object.entries(IC_DURUM).map(([k, [l]]) => [k, l])].map(([k, l]) => `<button class="chip${icDurumF === k ? ' on' : ''}" data-icd="${k}">${l}${k ? ' ' + say(k) : ''}</button>`).join('')
    + (markalar.length > 1 ? `<select class="sel" id="ic-marka" style="height:32px;width:auto"><option value="">Tüm markalar</option>${markalar.map(m => `<option${icMarkaF === m ? ' selected' : ''}>${esc(m)}</option>`).join('')}</select>` : '');
  el.innerHTML = l.length ? l.map(u => { const g = (u.gorseller || []).find(x => x.tip === 'urun') || (u.gorseller || [])[0], d = IC_DURUM[u.durum || 'taslak'];
    return `<button class="row" data-icerik="${esc(u.id)}">${g ? `<img data-yol="${esc(g.yol)}" alt="" style="width:44px;height:44px;border-radius:10px;object-fit:cover;background:var(--surface2);flex:none">` : avatar(u.marka || u.ad)}<div class="mid"><div class="t">${esc(u.ad || u.kod || 'İsimsiz ürün')}</div><div class="s">${esc([u.marka, u.kod, u.kategori].filter(Boolean).join(' · '))}${(u.kanallar || []).length ? ' · ' + esc(u.kanallar.join(', ')) : ''}</div></div><div class="end"><span class="pill ${d[1]}">${d[0]}</span><span class="s">${icTamam(u)}/5 hazır</span></div></button>`; }).join('')
    : `<div class="empty">${S.urun_icerik.length ? 'Filtreye uyan ürün yok' : 'Henüz ürün yok — "+ Ürün" ile ekle ya da stoktan seç'}</div>`;
  icResimleriDoldur(el);
}
document.addEventListener('click', e => {
  const d = e.target.closest('[data-icd]'); if (d) { icDurumF = d.dataset.icd; icCiz(); return; }
  const r = e.target.closest('[data-icerik]'); if (r) { icForm(r.dataset.icerik); return; }
  if (e.target.closest('#ic-yeni')) icForm();
  if (e.target.closest('#ic-excel')) icExcel();
});
document.addEventListener('change', e => { if (e.target.id === 'ic-marka') { icMarkaF = e.target.value; icCiz(); } });
document.addEventListener('input', e => { if (e.target.id === 'ic-ara') { icAra = e.target.value.trim(); icCiz(); } });

function icForm(id) {
  const u0 = id ? S.urun_icerik.find(x => x.id === id) : {durum: 'taslak', para: '₺', kanallar: [], gorseller: []};
  if (id && !u0) return;
  const u = JSON.parse(JSON.stringify(u0)); u.gorseller = u.gorseller || [];
  const sh = sheet(id ? (u.ad || u.kod) : 'Yeni ürün içeriği', `<div class="fg">
    ${id ? '' : `<div class="f"><label for="ic-stok">Stoktan seç (isteğe bağlı)</label><input class="inp" id="ic-stok" list="ic-stok-dl" placeholder="Kod veya ürün adı yaz…" autocomplete="off"><datalist id="ic-stok-dl"></datalist></div>`}
    <div class="fg2"><div class="f"><label for="ic-kod">Ürün kodu</label><input class="inp" id="ic-kod" value="${esc(u.kod)}"></div><div class="f"><label for="ic-mk">Marka</label><input class="inp" id="ic-mk" value="${esc(u.marka)}" placeholder="Mutlusan, Tork, Tügen…"></div></div>
    <div class="f"><label for="ic-ad">Ürün adı (başlık) *</label><input class="inp" id="ic-ad" value="${esc(u.ad)}" placeholder="ör. Mutlusan 16A Topraklı Priz Beyaz"></div>
    <div class="fg2"><div class="f"><label for="ic-kat">Kategori</label><input class="inp" id="ic-kat" value="${esc(u.kategori)}" placeholder="Priz / Anahtar, Sigorta, Kablo…"></div>
    <div class="f"><label for="ic-fy">Satış fiyatı (KDV dahil)</label><div style="display:flex;gap:6px"><input class="inp num" id="ic-fy" type="number" step="0.01" inputmode="decimal" value="${esc(u.fiyat)}"><select class="sel" id="ic-pb" style="width:70px">${['₺', '$', '€'].map(p => `<option${(u.para || '₺') === p ? ' selected' : ''}>${p}</option>`).join('')}</select></div></div></div>
    <div class="f"><label for="ic-kisa">Kısa açıklama (1–2 cümle)</label><textarea class="inp" id="ic-kisa" rows="2">${esc(u.kisa)}</textarea></div>
    <div class="f"><label for="ic-ac">Ürün sayfası metni</label><textarea class="inp" id="ic-ac" rows="6" placeholder="Ürünün ne işe yaradığı, avantajları, kullanım alanları…">${esc(u.aciklama)}</textarea></div>
    <div class="f"><label for="ic-oz">Teknik özellikler (her satıra bir özellik: Özellik: Değer)</label><textarea class="inp" id="ic-oz" rows="4" placeholder="Akım: 16A&#10;Gerilim: 250V&#10;Renk: Beyaz">${esc(u.ozellikler)}</textarea></div>
    <div class="f"><label for="ic-ak">Anahtar kelimeler (virgülle)</label><input class="inp" id="ic-ak" value="${esc(u.anahtar)}" placeholder="priz, topraklı priz, mutlusan"></div>
    <div class="f"><label>Görseller</label><div id="ic-gl" style="display:flex;gap:8px;flex-wrap:wrap"></div>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><label class="btn btn-s btn-sm">+ Ürün fotoğrafı<input type="file" accept="image/*" data-ictip="urun" hidden multiple></label><label class="btn btn-s btn-sm">+ Reklam görseli<input type="file" accept="image/*" data-ictip="reklam" hidden multiple></label></div></div>
    <div class="f"><label>Satış kanalları</label><div class="chips">${IC_KANAL.map(k => `<button type="button" class="chip${(u.kanallar || []).includes(k) ? ' on' : ''}" data-ickanal="${esc(k)}">${esc(k)}</button>`).join('')}</div></div>
    <div class="f"><label for="ic-dr">Durum</label><select class="sel" id="ic-dr">${Object.entries(IC_DURUM).map(([k, [l]]) => `<option value="${k}"${(u.durum || 'taslak') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn btn-s btn-sm" id="ic-claude">✨ Claude'a hazırla (kopyala)</button><button type="button" class="btn btn-s btn-sm" id="ic-kopya">📋 Sayfa metnini kopyala</button>${id && IS_OWNER ? `<button type="button" class="btn btn-d btn-sm" id="ic-sil">${ikon('trash')}Sil</button>` : ''}</div>
  </div>`, [{label: 'Vazgeç', onClick: () => {}}, {label: 'Kaydet', cls: 'btn-p', onClick: async ov => {
    const o = icOku(ov, u); if (!o.ad) { toast('Ürün adı gerekli'); return false; }
    if (DEMO) { const a = S.urun_icerik.filter(x => x.id !== o.id); a.push(o); S.urun_icerik = a; lsSet('co_urun_icerik', a); icCiz(); return true; }
    const ok = await BE.yaz('urun_icerik', o); if (ok) { toast('✅ Kaydedildi'); icCiz(); } return ok;
  }}]);
  const ov = sh.el; u.id = u.id || newId();
  const gCiz = () => { ov.querySelector('#ic-gl').innerHTML = u.gorseller.map((g, i) => `<div style="position:relative;width:76px"><img data-yol="${esc(g.yol)}" alt="" style="width:76px;height:76px;border-radius:10px;object-fit:cover;background:var(--surface2)"><div style="font-size:10.5px;color:var(--fg3);text-align:center">${g.tip === 'reklam' ? 'Reklam' : 'Ürün'}</div><button type="button" data-icgs="${i}" aria-label="Kaldır" style="position:absolute;top:2px;right:2px;background:var(--bg);border-radius:50%;width:20px;height:20px;line-height:18px;font-size:13px">×</button></div>`).join('') || '<span class="s" style="color:var(--fg3);font-size:12px">Görsel yok</span>'; icResimleriDoldur(ov); };
  gCiz();
  ov.addEventListener('click', e => {
    const k = e.target.closest('[data-ickanal]'); if (k) { k.classList.toggle('on'); return; }
    const gs = e.target.closest('[data-icgs]'); if (gs) { u.gorseller.splice(+gs.dataset.icgs, 1); gCiz(); return; }
    if (e.target.closest('#ic-kopya')) { const o = icOku(ov, u); icPano(icSayfaMetni(o), '📋 Sayfa metni kopyalandı'); }
    if (e.target.closest('#ic-claude')) { const o = icOku(ov, u); icPano(icClaudeIstem(o), '✨ Kopyalandı — Claude sohbetine yapıştır'); }
    if (e.target.closest('#ic-sil')) { sh.kapat(); confirmSheet('İçerik silinsin mi?', (u.ad || u.kod) + ' kalıcı olarak silinecek.', async () => { await BE.sil('urun_icerik', u.id); S.urun_icerik = S.urun_icerik.filter(x => x.id !== u.id); icCiz(); }); }
  });
  ov.addEventListener('change', async e => {
    const f = e.target.closest('[data-ictip]');
    if (f && f.files.length) {
      for (const fl of f.files) {
        if (DEMO) { const r = new FileReader(); await new Promise(ok => { r.onload = ok; r.readAsDataURL(fl); }); u.gorseller.push({yol: r.result, ad: fl.name, tip: f.dataset.ictip}); continue; }
        const yol = `icerik/${u.id}/${Date.now()}-${fl.name.replace(/[^\w.\-]+/g, '_')}`;
        const {error} = await sb.storage.from('belgeler').upload(yol, fl, {contentType: fl.type || undefined});
        if (error) toast('⚠ Yüklenemedi: ' + fl.name); else u.gorseller.push({yol, ad: fl.name, tip: f.dataset.ictip});
      }
      f.value = ''; gCiz(); return;
    }
    if (e.target.id === 'ic-stok') {
      const q = e.target.value.trim(), s = S.stok.find(x => x.ref === q.split(' — ')[0]); if (!s) return;
      const set = (i, v) => { const el = ov.querySelector('#' + i); if (el && !el.value && v) el.value = v; };
      set('ic-kod', s.ref); set('ic-mk', s.marka); set('ic-ad', s.aciklama); u.stokId = s.id;
    }
  });
  const st = ov.querySelector('#ic-stok');
  if (st) st.addEventListener('input', () => { const q = st.value.trim().toLocaleLowerCase('tr-TR'); if (q.length < 2) return;
    ov.querySelector('#ic-stok-dl').innerHTML = S.stok.filter(s => [s.ref, s.aciklama, s.marka].join(' ').toLocaleLowerCase('tr-TR').includes(q)).slice(0, 30).map(s => `<option value="${esc(s.ref + ' — ' + (s.aciklama || ''))}">`).join(''); });
}
function icOku(ov, u) {
  return {...u, kod: v(ov, 'ic-kod'), marka: v(ov, 'ic-mk'), ad: v(ov, 'ic-ad'), kategori: v(ov, 'ic-kat'), fiyat: v(ov, 'ic-fy'), para: v(ov, 'ic-pb'),
    kisa: v(ov, 'ic-kisa'), aciklama: ov.querySelector('#ic-ac').value.trim(), ozellikler: ov.querySelector('#ic-oz').value.trim(), anahtar: v(ov, 'ic-ak'), durum: v(ov, 'ic-dr'),
    kanallar: [...ov.querySelectorAll('[data-ickanal].on')].map(b => b.dataset.ickanal)};
}
const icSayfaMetni = o => [o.ad, o.kisa, o.aciklama, o.ozellikler ? 'Teknik Özellikler\n' + o.ozellikler : '', o.fiyat ? 'Fiyat: ' + o.fiyat + ' ' + (o.para || '₺') : ''].filter(Boolean).join('\n\n');
const icClaudeIstem = o => `Ceylan Otomasyon online satış için bu ürünün içeriğini hazırla:
- Ürün sayfası metni (SEO uyumlu, 120–180 kelime)
- 1–2 cümlelik kısa açıklama
- Teknik özellikler (Özellik: Değer)
- 10 anahtar kelime
- Reklam görseli: açık mavi bulutlu arka plan, ince + kalın bordo başlık, büyük ürün fotoğrafı, telefon/web satırı ve Ceylan logosu

Ürün: ${o.ad || '-'}
Marka: ${o.marka || '-'}
Kod: ${o.kod || '-'}
Kategori: ${o.kategori || '-'}
Fiyat: ${o.fiyat ? o.fiyat + ' ' + (o.para || '₺') : '-'}
Mevcut not/özellik: ${[o.kisa, o.ozellikler].filter(Boolean).join(' | ') || '-'}`;
async function icPano(txt, msj) {
  try { await navigator.clipboard.writeText(txt); toast(msj); }
  catch (e) { sheet('Kopyala', `<textarea class="inp" rows="12" style="width:100%">${esc(txt)}</textarea>`, [{label: 'Kapat', cls: 'btn-p', onClick: () => {}}]); }
}
async function icExcel() {
  await syXlsx();
  const rows = S.urun_icerik.filter(u => !icDurumF || (u.durum || 'taslak') === icDurumF).map(u => ({'Ürün Kodu': u.kod || '', 'Marka': u.marka || '', 'Ürün Adı': u.ad || '', 'Kategori': u.kategori || '', 'Satış Fiyatı': u.fiyat ? Number(u.fiyat) : '', 'Para': u.para || '₺', 'Kısa Açıklama': u.kisa || '', 'Ürün Açıklaması': u.aciklama || '', 'Teknik Özellikler': u.ozellikler || '', 'Anahtar Kelimeler': u.anahtar || '', 'Görsel Sayısı': (u.gorseller || []).length, 'Kanallar': (u.kanallar || []).join(', '), 'Durum': (IC_DURUM[u.durum || 'taslak'])[0]}));
  if (!rows.length) { toast('Aktarılacak ürün yok'); return; }
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Urunler');
  TC.indir(new Blob([XLSX.write(wb, {bookType: 'xlsx', type: 'array'})], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}), `Online_Satis_Urunleri_${bugun()}.xlsx`); toast('⬇ Excel indirildi');
}
