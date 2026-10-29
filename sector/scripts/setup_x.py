"""TTY-only OAuth 1.0 user credentials. No secret goes to chat, argv or logs."""
import getpass,json,os,pathlib,subprocess,sys

def main():
    if not sys.stdin.isatty():raise SystemExit('Bu aracı Mac mini Terminal uygulamasında aç.')
    os.umask(0o077)
    print('X Developer Console → Keys & Tokens → OAuth 1.0 Keys. Bearer / OAuth 2.0 tokenını kullanma.')
    print('Consumer Key ve Secret ile Read and Write Access Token ve Secret değerlerini birer kez yapıştır. Girişler gizlidir.')
    keys={k:getpass.getpass(label+': ').strip() for k,label in [('consumer_key','Consumer Key'),('consumer_secret','Consumer Secret'),('access_token','Access Token'),('access_secret','Access Token Secret')]}
    app=pathlib.Path(__file__).resolve().parents[1]
    node=pathlib.Path.home()/'.local/bin/node'
    if not node.exists():node=pathlib.Path('/opt/homebrew/bin/node')
    result=subprocess.run([str(node),str(app/'node_modules/tsx/dist/cli.mjs'),str(app/'scripts/verify_x.ts')],input=json.dumps(keys),text=True,capture_output=True,timeout=45)
    if result.returncode:raise SystemExit('X hesabı doğrulanamadı. Read and Write izinli OAuth 1.0 anahtarlarını kontrol et. Güvenli sonuç: '+result.stdout.strip()[:120])
    root=pathlib.Path.home()/'Library/Application Support/sector-haber'
    path=root/'x-credentials.json';tmp=path.with_suffix('.next');tmp.write_text(json.dumps(keys));tmp.chmod(0o600);os.replace(tmp,path)
    print('Borsa Çakalı X bağlantısı doğrulandı ve kaydedildi. Yeni kartlarda Paylaş düğmesi açılacak. Uygulamada günlük paylaşım sınırı yok.')
if __name__=='__main__':
    try:main()
    except (EOFError,KeyboardInterrupt):raise SystemExit('Kurulum iptal edildi.')
    except subprocess.TimeoutExpired:raise SystemExit('X bağlantısı zaman aşımına uğradı. Yeniden deneyebilirsin.')
