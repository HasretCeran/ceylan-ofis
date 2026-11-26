'use strict';
/* Ceylan Ofis — Uygulama içinde önizleme: teklif PDF'i, sipariş belgeleri (PDF / fotoğraf). */
(function () {
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFW = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  let pdfYuk = null;
  const pdfjsAl = () => pdfYuk || (pdfYuk = new Promise((ok, no) => {
    if (window.pdfjsLib) return ok(window.pdfjsLib);
    const s = document.createElement('script'); s.src = PDFJS; s.onload = () => { pdfjsLib.GlobalWorkerOptions.workerSrc = PDFW; ok(pdfjsLib); };
    s.onerror = () => { pdfYuk = null; no(new Error('Önizleme yüklenemedi (internet?)')); }; document.head.appendChild(s);
  }));

  // Tam ekran önizleme penceresi. kaynak: Blob | Promise<Blob> | {url, tip}
  async function onizle(kaynak, baslik, eylemler = []) {
    const ov = document.createElement('div'); ov.className = 'onz';
    ov.innerHTML = `<div class="onz-h"><b>${esc(baslik || 'Önizleme')}</b><button class="icon-btn" aria-label="Kapat">${ikon('x')}</button></div>
      <div class="onz-b"><div class="onz-y">Önizleme hazırlanıyor…</div></div>
      ${eylemler.length ? `<div class="onz-f">${eylemler.map((e, i) => `<button class="btn ${e.cls || 'btn-s'}" data-oe="${i}">${e.label}</button>`).join('')}</div>` : ''}`;
    document.body.appendChild(ov); document.body.style.overflow = 'hidden';
    const kapat = () => { ov.remove(); document.body.style.overflow = ''; };
    ov.querySelector('.onz-h button').onclick = kapat;
    ov.querySelectorAll('[data-oe]').forEach(b => b.onclick = () => eylemler[+b.dataset.oe].onClick(kapat));
    document.addEventListener('keydown', function esc_(e) { if (e.key === 'Escape') { kapat(); document.removeEventListener('keydown', esc_); } });
    const govde = ov.querySelector('.onz-b');
    try {
      let blob = null, url = null, tip = '';
      if (kaynak && kaynak.url) { url = kaynak.url; tip = kaynak.tip || ''; }
      else { blob = await kaynak; tip = blob.type || 'application/pdf'; }
      if (/image\//.test(tip) || (url && /\.(jpe?g|png|webp|gif|heic)(\?|$)/i.test(url))) {
        govde.innerHTML = `<img class="onz-img" alt="" src="${url ? esc(url) : URL.createObjectURL(blob)}">`; return;
      }
      if (!/pdf/.test(tip) && !(url && /\.pdf(\?|$)/i.test(url))) {
        govde.innerHTML = `<div class="onz-y">Bu dosya türü uygulamada önizlenemiyor.<br><br><a class="btn btn-p" href="${url ? esc(url) : URL.createObjectURL(blob)}" target="_blank" rel="noopener">Dosyayı aç</a></div>`; return;
      }
      const lib = await pdfjsAl();
      const veri = blob ? new Uint8Array(await blob.arrayBuffer()) : new Uint8Array(await (await fetch(url)).arrayBuffer());
      const pdf = await lib.getDocument({data: veri}).promise;
      govde.innerHTML = '';
      const gen = Math.min(govde.clientWidth - 16, 900), dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      for (let i = 1; i <= Math.min(pdf.numPages, 20); i++) {
        const sayfa = await pdf.getPage(i), v1 = sayfa.getViewport({scale: 1}), olc = gen / v1.width;
        const vp = sayfa.getViewport({scale: olc * dpr}), c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height; c.style.width = (vp.width / dpr) + 'px'; c.className = 'onz-s';
        govde.appendChild(c);
        await sayfa.render({canvasContext: c.getContext('2d'), viewport: vp}).promise;
      }
      if (pdf.numPages > 20) govde.insertAdjacentHTML('beforeend', `<div class="onz-y">+${pdf.numPages - 20} sayfa daha</div>`);
    } catch (e) { govde.innerHTML = `<div class="onz-y" style="color:var(--red)">⚠ ${esc(e.message || 'Önizleme açılamadı')}</div>`; }
  }

  // Teklif: gönderilecek PDF'in birebir aynısı
  function teklifOnizle(t, tf) {
    if (!t.kalemler || !t.kalemler.length) { toast('Önce kalem ekle'); return; }
    const tt = tamTeklif(t);
    onizle(pdfAl(tt, tf), (t.no ? t.no + ' · ' : '') + (t.musteri || 'Teklif'), [
      {label: ikon('down') + 'PDF', onClick: () => cikti('pdf', tt, tf)},
      {label: ikon('down') + 'Excel', onClick: () => cikti('excel', tt, tf)},
      {label: ikon('send') + 'Gönder', cls: 'btn-p', onClick: () => cikti('gonder', tt, tf)},
    ]);
  }
  window.onizle = onizle; window.teklifOnizle = teklifOnizle;
})();
