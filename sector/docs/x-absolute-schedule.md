# Kesin tarih ve saatle X planlama

Mevcut hazır kartta **X’te paylaş → Tarih/saat seç** kullanılır. Hemen / 15 / 30 / 60 dakika seçenekleri korunur. Devre kesici kartının mevcut hızlı paylaşım davranışı değişmez.

Botun açtığı mesaja yanıt olarak `GG.AA.YYYY SS:DD` yazılır; örneğin `31.10.2026 14:00`. Tarih gerçek takvim günü olmalı ve Europe/Istanbul saatinde gelecekte bulunmalıdır. Sadece saat, başka saat dilimi, geçersiz gün ve geçmiş saat kabul edilmez. Bot, tam tarih ve Türkiye saatiyle ayrı bir teyit kartı gönderir. **Bu tarih ve saatte paylaş** düğmesi gerçek sahibi tarafından tıklanmadan X kuyruğuna kayıt girmez. Giriş ve teyit 15 dakika geçerlidir; hedef saat teyitten önce geçerse Hemen’e dönüşmez.

İstek sahibi, özel sohbet, asıl kart mesajı, yanıtlanan tarih istemi, teyit mesajı, taslak kimliği, revision, tam içerik, medya yolu ve bütün görsel hash’leri birbirine bağlıdır. İleti başka bir isteme yanıt verirse bu plan için kullanılamaz. Aynı onay tekrarlandığında veya eşzamanlı geldiğinde tek kalıcı kayıt oluşur. Kaynak `x_schedules.due_at` UTC epoch milisaniye, `x_posts.day` hedef İstanbul günüdür. Yeni endpoint veya oturum yoktur.

İleri gün için açıkça onaylanan planın **aynı** revision, tam metin ve medya yolu, hedef saat + mevcut 5 dakikalık gecikme toleransı boyunca taslağın normal TTL’sinden bağımsız değerlendirilebilir. `drafts.expires_at` genel olarak uzatılmaz. İptal, değiştirilmiş içerik/revision/medya veya gecikmiş hedef bu dar hakkı kaldırır; gerçek medya hash’leri gönderimden önce ve yükleme sonrasında tekrar denetlenir. Onaysız diğer taslakların eski süre koruması sürer.

Kalıcı planlar mevcut restart korumasını kullanır. Önceden `posting` olan belirsiz iş yeniden gönderilmez; `uncertain` işten yeni yayın oluşturulamaz. Tarih seçmek veya testler, gerçek paylaşım yetkisi değildir. Testler yalnız geçici SQLite, sahte Telegram ve sahte X transportu kullanır.
