// Ceylan Ofis — teklifleri uygulamanın kendi şablonuyla (Excel + PDF) dosyaya üretir.
// Kullanım: node tools/teklif-uret.js girdi.json cikti_klasoru
//   girdi.json: {"ayar": {...ayarlar.teklif}, "teklifler": [{...teklif veri, id}]}
// Gerekli paketler (aynı klasörde ya da NODE_PATH): playwright, exceljs, pdfmake, xlsx
const {chromium} = require('playwright'); const path = require('path'); const http = require('http'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const L = p => require.resolve(p);
const MIME = {'.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.xlsx': 'application/octet-stream'};
const [girdi, cikti] = process.argv.slice(2);
const G = JSON.parse(fs.readFileSync(girdi, 'utf8')); fs.mkdirSync(cikti, {recursive: true});
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  if (p === '/config.js') { r.writeHead(200, {'content-type': 'text/javascript'}); return r.end("window.CEYLAN_CONFIG={SUPABASE_URL:'',SUPABASE_ANON_KEY:''};"); }
  const f = ROOT + p; if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, {'content-type': MIME[path.extname(f)] || 'text/plain'}); fs.createReadStream(f).pipe(r); }).listen(8781);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({timezoneId: 'Europe/Istanbul'});
  await ctx.route(/fonts\./, r => r.abort());
  const map = [[/exceljs/, 'exceljs/dist/exceljs.min.js'], [/pdfmake\.min\.js/, 'pdfmake/build/pdfmake.min.js'], [/vfs_fonts\.js/, 'pdfmake/build/vfs_fonts.js'], [/xlsx\.full/, 'xlsx/dist/xlsx.full.min.js']];
  await ctx.route(/cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com/, r => { const u = r.request().url(); for (const [rx, f] of map) if (rx.test(u)) return r.fulfill({path: L(f), contentType: 'text/javascript'}); r.abort(); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8781/'); await p.waitForTimeout(1000);
  for (const t of G.teklifler) {
    try {
      const out = await p.evaluate(async ([t, ayar]) => { const b64 = async bl => { const a = new Uint8Array(await bl.arrayBuffer()); let s = ''; for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode(...a.subarray(i, i + 8192)); return btoa(s); };
        return {x: await b64(await TC.excelUret(t, ayar)), p: await b64(await TC.pdfUret(t, ayar)), ad: TC.dosyaAdi(t, 'pdf')}; }, [t, G.ayar || {}]);
      const ad = out.ad.replace(/\.pdf$/, '');
      fs.writeFileSync(path.join(cikti, ad + '.xlsx'), Buffer.from(out.x, 'base64')); fs.writeFileSync(path.join(cikti, ad + '.pdf'), Buffer.from(out.p, 'base64'));
      console.log('OK\t' + t.id + '\t' + ad);
    } catch (e) { console.log('HATA\t' + t.id + '\t' + e.message); }
  }
  if (errs.length) console.log('SAYFA HATALARI', errs.join(' | '));
  await b.close(); srv.close();
})();
