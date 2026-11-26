# Ceylan Ofis

Ceylan Endüstriyel Otomasyon ofis uygulaması — teklif, müşteri/borç, stok, takvim.

Uygulama: https://hasretceran.github.io/ceylan-ofis/

## Satınalma (sadece yönetici)
Tedarikçilere fiyat/stok sorma, gelen teklifleri karşılaştırma ve satın alma takibi. Tablolar: `tedarikciler`, `sa_talepler`, `sa_teklifler`, `sa_siparisler` (RLS: sadece `is_sahip()`).

Satınalma posta kutusu (satinalma@ceylanotomasyon.com.tr) bağlanınca çalışacak otomasyonun sözleşmesi:
- `sa_talepler.durum = 'gonderilecek'` olan talepler (yönetici "Gönderime onayla" demiştir) satınalma posta kutusundan her tedarikçiye gönderilir; mail metni uygulamadaki `saMail()` ile aynıdır (konu: `Fiyat ve stok talebi — TLP-YYYY-NNN`).
- Gönderilince `gonderim[tedarikciId] = {durum:'gonderildi', zaman, kanal:'otomatik', mailUrl}` yazılır.
- Gelen yanıtlardaki fiyat / stok / termin bilgisi `sa_teklifler`'e eklenir (`kaynak:'mail'`, `talepId`, `tedarikciId`, `ref`, `fiyat`, `para`, `stok: 'var'|'yok'`, `termin`).
- Yalnızca onaylanmış talepler gönderilir; fiyat uydurulmaz, belirsiz yanıtlar boş bırakılıp işaretlenir.
