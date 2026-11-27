'use strict';
/* Ceylan Ofis — Cari Ekstre: firma adı yazınca bakiye, vadesi geçen / gelmeyen kısım,
   ortalama vade ve hareketler tek ekranda. Sadece finans yetkisi olanlar görür. */
(function () {
  const $e = id => document.getElementById(id);
  let seciliId = lsGet('co_ekstre', null);

  const katla = s => (typeof firmaKatla === 'function' ? firmaKatla(s) : nrmTR(s));
  function bul(q) {
    const tok = katla(q).split(' ').filter(Boolean);
    if (!tok.length) return [];
    const qk = String(q || '').trim();
    return cariler().map(m => [m, katla(m.firma)]).filter(([m, k]) => tok.every(t => k.includes(t)) || (qk && ((m.kod || '').includes(qk) || (m.vergiNo || '').includes(qk))))
      .sort((a, b) => (b[1].startsWith(tok[0]) - a[1].startsWith(tok[0])) || Math.abs(Number(b[0].alacak || 0)) - Math.abs(Number(a[0].alacak || 0)) || a[0].firma.length - b[0].firma.length)
      .slice(0, 10).map(x => x[0]);
  }
  const yonu = m => Number(m.alacak || 0) > 0 ? 'alacak' : Number(m.alacak || 0) < 0 ? 'borc' : '';
  // Vade bilgisi bakiye yönüyle uyuşuyor mu (DİA raporunda ters yönlü kayıtlar atlanır)
  const vadeUyumlu = m => !m.vyon || m.vyon === yonu(m);

  function oneriCiz() {
    const inp = $e('ce-ara'), kutu = $e('ce-oneri'), q = inp.value.trim();
    const l = q ? bul(q) : [];
    kutu.innerHTML = l.map(m => { const al = Number(m.alacak || 0);
      return `<button type="button" data-ce="${esc(m.id)}"><span class="ce-o-ad">${esc(m.firma)}</span><span class="ce-o-alt">${[m.kod, m.sehir].filter(Boolean).map(esc).join(' · ')}${al ? ` · <b style="color:${al < 0 ? 'var(--orange)' : vadeGecti(m) ? 'var(--red)' : 'var(--fg)'}">${al < 0 ? 'Borcumuz ' : ''}${tl(Math.abs(al))}</b>` : ''}</span></button>`; }).join('')
      || (q ? '<div class="ce-o-yok">Bu isimde cari bulunamadı</div>' : '');
    kutu.hidden = !kutu.innerHTML || document.activeElement !== inp;
  }

  function sec(id) {
    seciliId = id; lsSet('co_ekstre', id);
    const son = lsGet('co_ekstre_son', []).filter(x => x !== id); son.unshift(id); lsSet('co_ekstre_son', son.slice(0, 6));
    $e('ce-ara').value = ''; $e('ce-oneri').hidden = true; $e('ce-ara').blur();
    ekstreCiz();
  }

  const kutucuk = (lbl, renk, deger, alt, renkDeger) => `<div class="tile"><div class="lbl"><i style="background:${renk}"></i>${lbl}</div><div class="val num"${renkDeger ? ` style="color:${renkDeger}"` : ''}>${deger}</div><div class="hint">${alt || '&nbsp;'}</div></div>`;

  function detayHtml(m) {
    const al = Number(m.alacak || 0), borc = al < 0, uy = vadeUyumlu(m), kapali = m.durum === 'tahsil' || Math.abs(al) < 1;
    const gec = kapali ? 0 : gecTutar(m), gel = kapali || !uy ? 0 : (m.vgel != null ? Number(m.vgel) || 0 : (m.vade && m.vade >= bugun() ? Math.abs(al) : 0));
    const gecT = m.vgecT || (m.vgec == null ? m.vade : ''), gelT = m.vgelT || (m.vgec == null && m.vade >= bugun() ? m.vade : '');
    const ov = ortVade(m);
    const kim = borc ? 'Ödenmesi gereken' : 'Tahsil edilecek';
    // Durum cümlesi
    let durum, dRenk;
    if (kapali) { durum = al ? 'Hesap kapalı (tahsil edildi)' : 'Açık bakiye yok'; dRenk = 'var(--green)'; }
    else if (gec >= 1) { durum = `${tl(gec)} ${borc ? 'ödememizin' : 'alacağın'} vadesi geçti${gecT ? ' · ort. ' + Math.abs(gunFark(gecT)) + ' gün gecikme' : ''}`; dRenk = 'var(--red)'; }
    else if (gel >= 1 && gelT) { durum = `${borc ? 'Ödeme' : 'Tahsilat'} vadesi ${trT(gelT)} · ${gunYazi(gelT)}`; dRenk = gunFark(gelT) <= 7 ? 'var(--orange)' : 'var(--brand)'; }
    else { durum = borc ? 'Borcumuz var, vade bilgisi yok' : 'Alacak var, vade bilgisi yok'; dRenk = 'var(--fg2)'; }
    const oran = gec + gel > 0 ? Math.round(gec / (gec + gel) * 100) : 0;

    const hareket = S.hareket.filter(h => h.firmaId === m.id || (!h.firmaId && h.firma === m.firma))
      .sort((a, b) => (b.tarih || '').localeCompare(a.tarih || '') || (b.at || '').localeCompare(a.at || ''));
    const hRows = hareket.slice(0, 50).map(x => {
      const [lb, c, renk] = x.tur === 'tahsilat' ? ['Tahsilat', 'p-green', 'var(--green)'] : x.tur === 'borc' ? ['Borç / Fatura', 'p-red', 'var(--red)'] : ['Not', 'p-gray', 'var(--fg2)'];
      return `<div class="row"><div class="mid"><div class="t">${esc(x.aciklama) || lb}</div><div class="s">${trT(x.tarih)} · ${esc(adi(x.by))}</div></div><div class="end"><b class="num" style="color:${renk}">${x.tutar ? (x.tur === 'tahsilat' ? '+' : '') + tl(x.tutar) : '—'}</b><span class="pill ${c}" style="margin-top:4px">${lb}</span></div></div>`;
    }).join('');

    const tel = (m.tel || '').replace(/[^\d+]/g, '');
    return `<div class="card ce-bas"><div class="card-b">
        <div class="ce-firma"><div class="ico" style="background:${gec >= 1 ? 'var(--red-soft)' : borc ? 'var(--orange-soft)' : 'var(--green-soft)'};color:${gec >= 1 ? 'var(--red)' : borc ? 'var(--orange)' : 'var(--green)'}">${esc(bas(m.firma))}</div>
          <div style="min-width:0"><h2>${esc(m.firma)}</h2><p>${[m.kod ? 'Cari kodu ' + esc(m.kod) : '', m.vergiNo ? 'VKN ' + esc(m.vergiNo) : '', esc(m.sehir || ''), esc(TUR[m.tur] || '')].filter(Boolean).join(' · ')}</p></div></div>
        <div class="ce-durum" style="border-color:${dRenk};color:${dRenk}">${esc(durum)}</div>
      </div></div>
      <div class="tiles ce-tiles">
        ${kutucuk(borc ? 'Borcumuz' : 'Bakiye (alacak)', borc ? 'var(--orange)' : 'var(--green)', tl(Math.abs(al)), kapali ? 'Kapalı' : borc ? 'Biz borçluyuz' : al > 0 ? 'Firma bize borçlu' : '', borc ? 'var(--orange)' : '')}
        ${kutucuk('Vadesi geçen', 'var(--red)', tl(gec), gec >= 1 && gecT ? 'Ort. vade ' + trT(gecT) + ' · ' + Math.abs(gunFark(gecT)) + ' gün geçti' : 'Gecikme yok', gec >= 1 ? 'var(--red)' : '')}
        ${kutucuk('Vadesi gelmeyen', 'var(--brand)', tl(gel), gel >= 1 && gelT ? 'Vade ' + trT(gelT) + ' · ' + gunYazi(gelT) : '—')}
        ${kutucuk('Ortalama vade', 'var(--fg3)', ov ? trT(ov.tarih) : '—', ov ? gunYazi(ov.tarih) + ' · ' + kisa(ov.tutar) : 'Vade bilgisi yok', ov && gunFark(ov.tarih) < 0 ? 'var(--red)' : '')}
      </div>
      ${gec + gel >= 1 ? `<div class="card"><div class="card-b">
        <div class="ce-bar-h"><span>${kim}</span><b class="num">${tl(gec + gel)}</b></div>
        <div class="ce-bar"><i style="width:${oran}%;background:var(--red)"></i><i style="width:${100 - oran}%;background:var(--brand)"></i></div>
        <div class="ce-bar-l"><span><i style="background:var(--red)"></i>Vadesi geçen %${oran}</span><span><i style="background:var(--brand)"></i>Vadesi gelmeyen %${100 - oran}</span></div>
      </div></div>` : ''}
      ${!uy ? '<div class="note" style="margin-bottom:12px">DİA vade raporundaki yön bakiyeyle uyuşmuyor; vade tutarları gösterilmedi.</div>' : ''}
      <div class="ce-eylem">
        ${tel ? `<a class="btn btn-s btn-sm" href="tel:${esc(tel)}">${ikon('phone')}Ara · ${esc(m.tel)}</a>` : ''}
        <button class="btn btn-s btn-sm" id="ce-hareket">+ Tahsilat / borç gir</button>
        <button class="btn btn-g btn-sm" id="ce-kart">Cari kartı aç</button>
      </div>
      <div class="card"><div class="card-h"><h3>Hareketler</h3><span class="pill p-gray">${hareket.length}</span></div><div class="rows">${hRows || '<div class="empty">Bu firma için uygulamaya girilmiş hareket yok</div>'}</div></div>
      <p class="ce-kaynak">${[m.vkaynak ? 'Vade: ' + esc(m.vkaynak) : '', m.bkaynak ? 'Bakiye: ' + esc(m.bkaynak) : ''].filter(Boolean).join(' · ') || 'Kaynak: elle girilen bakiye'}</p>`;
  }

  function ekstreCiz() {
    const kok = $e('ce-sonuc'); if (!kok || !IS_FIN) return;
    const m = seciliId ? cariler().find(x => x.id === seciliId) : null;
    if (!m) {
      const son = lsGet('co_ekstre_son', []).map(id => cariler().find(x => x.id === id)).filter(Boolean);
      kok.innerHTML = `<div class="card"><div class="empty" style="padding:28px 16px">Yukarıya firma adı, cari kodu ya da vergi no yaz.<br>Bakiye, vadesi geçen / gelmeyen tutarlar ve ortalama vade burada açılır.</div>
        ${son.length ? `<div class="vu-h">Son bakılanlar</div><div class="rows">${son.map(firmaSatir).join('').replace(/data-firma=/g, 'data-ce-son=')}</div>` : ''}</div>`;
      return;
    }
    kok.innerHTML = detayHtml(m);
    $e('ce-hareket').onclick = () => hareketForm(m.firma);
    $e('ce-kart').onclick = () => firmaForm(m.id);
  }
  window.ekstreCiz = ekstreCiz;
  window.ekstreAc = id => { seciliId = id; lsSet('co_ekstre', id); git('ekstre'); };

  const inp = $e('ce-ara');
  inp.addEventListener('input', oneriCiz);
  inp.addEventListener('focus', oneriCiz);
  inp.addEventListener('blur', () => setTimeout(() => { $e('ce-oneri').hidden = true; }, 150));
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const b = $e('ce-oneri').querySelector('[data-ce]'); if (b) { e.preventDefault(); sec(b.dataset.ce); } }
    if (e.key === 'Escape') { inp.value = ''; $e('ce-oneri').hidden = true; }
  });
  $e('ce-oneri').addEventListener('pointerdown', e => { const b = e.target.closest('[data-ce]'); if (b) { e.preventDefault(); sec(b.dataset.ce); } });
  $e('ce-sonuc').addEventListener('click', e => { const b = e.target.closest('[data-ce-son]'); if (b) sec(b.dataset.ceSon); });
  $e('ce-temizle').onclick = () => { seciliId = null; lsSet('co_ekstre', null); ekstreCiz(); inp.focus(); };
  if (aktifSayfa === 'ekstre') ekstreCiz();
})();
