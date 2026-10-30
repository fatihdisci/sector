"""Deterministic source-protocol checks, not financial parsing or image OCR."""
import re,unicodedata

def folded(text):
    return ''.join(c for c in unicodedata.normalize('NFKD',text.casefold().replace('ı','i'))if not unicodedata.combining(c))

def is_placeholder(text):
    return bool(re.search(r'hazirlaniyor|yukleniyor|isleniyor|veri(?:ler)?\s+aliniyor',folded(text or '')))

def payload_matches(bot,command,text,media):
    s=folded(text or '');parts=command.split();verb=parts[0]
    if is_placeholder(text):return False
    ticker=parts[1]if len(parts)==2 and verb!='/kurum' else None
    if ticker and not re.search(r'(?<![a-z0-9])'+re.escape(ticker.lower())+r'(?![a-z0-9])',s):return False
    if bot=='b0pt_bot' and verb=='/kurum':
        broker=folded(command[len('/kurum '):]).strip()
        title=re.search(r'(?m)^[^\w\n]*([^\n]+?)\s+kurum analizi\s*$',s)
        sections=re.search(r'en cok alinan hisseler\s*:(.*?)en cok satilan hisseler\s*:(.*)',s,re.S)
        if not (media and broker and title and title.group(1).strip()==broker and sections):return False
        def rows(section):return re.findall(r'(?m)^\s*(\d{1,2})\.\s*([a-z][a-z0-9]{3,4})\s*:\s*\d+(?:[.,]\d+)?\s*(?:mn|mr|bin)\s*tl\b',section)
        buy,sell=rows(sections.group(1)),rows(sections.group(2))
        return all([len(side)==10 and [int(n) for n,_ in side]==list(range(1,11)) and len({code for _,code in side})==10 for side in (buy,sell)])
    if bot=='b0pt_bot'and verb=='/piyasayd':
        rows=re.findall(r'(?m)^\s*\d+\.\s+([A-Z][A-Z0-9]{3,4})\s+\d',text or '')
        return 'en cok yukselen hisseler'in s and 'en cok dusen hisseler'in s and len(rows)==20 and len(set(rows))==20
    if bot=='b0pt_bot'and verb=='/detay':return bool(media and ticker and 'detayli hisse bilgisi'in s)
    if bot=='b0pt_bot'and verb=='/doviz':return 'doviz kurlari'in s and all(re.search(r'\b'+asset+r'\b',s)for asset in ['usd','eur','altin','xu100','viop'])and bool(re.search(r'\b(?:btc|bitcoin)\b',s))and bool(re.search(r'\d',s))
    if bot!='ucretsizderinlikbot':return False
    if verb=='/derinlik':return bool(ticker and media and re.search(r'\b25\s*kademe\s+derinlik\b',s))
    if verb=='/akd':return bool(ticker and media and 'araci kurum dagilimi'in s)
    if verb=='/takas':return bool(ticker and all(h in s for h in ['son takas','toplam takas lotu','saklama kuruluslari'])and re.search(r'\d{4}-\d{2}-\d{2}',s)and re.search(r'\b'+re.escape(ticker.lower())+r'\s+takas\b',s))
    if verb=='/teorik':return bool(ticker and all(h in s for h in ['teorik eslesme','guncel','onceki kapanis','fiyat','miktar','alis','satis'])and re.search(r'\d',s))
    if verb=='/kurum'and not ticker:return all(h in s for h in ['borsa istanbul araci kurum verileri','net alis','net satis'])and bool(re.search(r'\d',s))
    return False
