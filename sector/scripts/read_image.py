"""Read owner-forwarded images without treating OCR or a bot as an official feed."""
import hashlib,json,pathlib,re,subprocess,sys,time
from decimal import Decimal
from PIL import Image,ImageOps,ImageChops,ImageStat
from read_pdf import ocr_text
from sermaye_layout import source_layout

def rows(blocks):
    out=[]
    for b in sorted(blocks,key=lambda b:b['y']):
        row=next((r for r in out if abs(r[0]-b['y'])<.012),None)
        if row is None:row=[b['y'],[]];out.append(row)
        row[1].append(b)
    return [(y,sorted(cells,key=lambda b:b['x'])) for y,cells in sorted(out)]

def decimal_value(raw,percent=False):
    raw=raw.strip().replace('%','').replace('−','-')
    if not re.fullmatch(r'[-+]?\d+(?:[.,]\d{1,2})?',raw):raise ValueError('image_market_number_ambiguous')
    value=raw.replace('.',',')
    if percent and not 0<=Decimal(value.replace(',','.'))<=100:raise ValueError('image_market_number_ambiguous')
    return ('%' if percent else '')+value

def lot_value(raw):
    raw=raw.strip().replace('−','-')
    if not re.fullmatch(r'[-+]?(?:\d{1,3}(?:\.\d{3})+|\d+)',raw):raise ValueError('image_market_number_ambiguous')
    return raw+' lot'

def recover_labels(blocks,image,ocr,deadline=None):
    """Retry unread short cells using their real header pixels as OCR context.

    This adds no dictionary guesses. The original whole image remains the
    evidence shown to both model passes, and an unread cell still fails closed.
    """
    current=None;recovered=[];attempts=0
    for y,cells in rows(blocks):
        h={c['text'].upper().replace('İ','I'):c for c in cells}
        if all(k in h for k in ['KURUM','ORAN','NET LOT','MALIYET']):current=h;continue
        if not current:continue
        x=[current[k]['x'] for k in ['KURUM','ORAN','NET LOT','MALIYET']]
        if x!=sorted(x):raise ValueError('image_market_table_incomplete')
        cuts=[(x[i]+x[i+1])/2 for i in range(3)]
        cols=[[] for _ in range(4)]
        for c in cells:cols[sum(c['x']>=v for v in cuts)].append(c)
        if cols[0] or not all(cols[1:]):continue
        if attempts>=5:raise ValueError('image_market_table_incomplete')
        attempts+=1
        with Image.open(image) as original:
            w,hi=original.size;header=current['KURUM'];parts=[]
            for top,bottom in [(header['y']-.002,header['y']+header['height']+.006),(y-.005,y+max(c['height'] for c in cells)+.012)]:
                part=original.crop((int(w*max(0,x[0]-.003)),int(hi*max(0,top)),int(w*(cuts[0]-.005)),int(hi*min(1,bottom)))).convert('RGB')
                gray=ImageOps.grayscale(part);bg=int(ImageStat.Stat(gray).median[0]);mask=ImageChops.difference(gray,Image.new('L',gray.size,bg)).point(lambda v:255 if v>60 else 0)
                box=mask.getbbox()
                if not box:break
                part=part.crop(box);parts.append(part.resize((max(1,round(part.width*80/part.height)),80)))
            if len(parts)!=2:continue
            strip=Image.new('RGB',(sum(p.width for p in parts)+32,100),original.getpixel((0,0))[:3]);left=8
            for part in parts:strip.paste(part,(left,10));left+=part.width+8
            path=image.parent/f'label-{len(recovered)}.png';strip.save(path);path.chmod(0o600)
        remaining=10 if deadline is None else deadline-time.monotonic()
        if remaining<=0:break
        retry=subprocess.run([str(ocr),str(path)],capture_output=True,text=True,timeout=min(10,remaining),check=True)
        result=json.loads(retry.stdout);text=' '.join(b['text'] for b in result).strip()
        if text.upper().startswith('KURUM'):
            name=text[5:].strip()
            if re.fullmatch(r'[^\W\d_][\w .&’\'-]{0,59}',name):recovered.append({'text':name,'x':x[0],'y':y,'width':cuts[0]-x[0],'height':max(c['height'] for c in cells),'confidence':min(b['confidence'] for b in result)})
    return blocks+recovered

def recover_numeric_cells(blocks,image,ocr,deadline=None):
    """Re-read malformed AKD numeric cells from pixels, never strip OCR letters.

    Two enlarged crops must independently agree. Valid original values are not
    replaced, and disagreement retains the original error for the parser.
    """
    result=list(blocks);header=None;attempts=0
    for y,cells in rows(blocks):
        h={c['text'].upper().replace('İ','I'):c for c in cells}
        if all(k in h for k in ['KURUM','ORAN','NET LOT','MALIYET']):header=h;continue
        if not header:continue
        xs=[header[k]['x'] for k in ['KURUM','ORAN','NET LOT','MALIYET']]
        if xs!=sorted(xs):raise ValueError('image_market_table_incomplete')
        cuts=[(xs[i]+xs[i+1])/2 for i in range(3)];columns=[[] for _ in range(4)]
        for c in cells:columns[sum(c['x']>=v for v in cuts)].append(c)
        if not all(columns):continue
        for col in range(1,4):
            validate=(lambda v:decimal_value(v,True)) if col==1 else lot_value if col==2 else decimal_value
            raw=' '.join(c['text'] for c in columns[col])
            try:validate(raw);continue
            except ValueError:pass
            attempts+=1
            if attempts>6:raise ValueError('image_market_table_incomplete')
            candidates=[]
            with Image.open(image) as original:
                w,hi=original.size;bottom=max(c['y']+c['height'] for c in cells)
                crop=original.crop((0,int(hi*max(0,y-.008)),w,int(hi*min(1,y+.036)))).convert('RGB')
                for scale in (3,4):
                    path=image.parent/f'numeric-{attempts}-{scale}.png';crop.resize((crop.width*scale,crop.height*scale),Image.Resampling.LANCZOS).save(path);path.chmod(0o600)
                    remaining=10 if deadline is None else deadline-time.monotonic()
                    if remaining<=0:return result
                    retry=subprocess.run([str(ocr),str(path)],capture_output=True,text=True,timeout=min(10,remaining),check=True)
                    output=json.loads(retry.stdout);value=' '.join(b['text'] for b in sorted(output,key=lambda b:b.get('x',0)) if sum(b.get('x',0)>=v for v in cuts)==col).strip()
                    try:validate(value);candidates.append(value)
                    except ValueError:pass
            if len(candidates)==2 and candidates[0]==candidates[1]:
                result=[b for b in result if b not in columns[col]]
                result.append({**columns[col][0],'text':candidates[0]})
    return result

def market_passages(blocks):
    grid=rows(blocks);tables=[]
    for i,(y,cells) in enumerate(grid):
        headers={re.sub(r'\s+',' ',c['text'].upper()).replace('İ','I'):c['x'] for c in cells}
        if all(h in headers for h in ['KURUM','ORAN','NET LOT','MALIYET']):tables.append((i,headers))
    if not tables:return None
    if len(tables)!=2:raise ValueError('image_market_table_incomplete')
    tickers={b['text'].strip() for b in blocks if b['y']<grid[tables[0][0]][0] and re.fullmatch(r'[A-Z][A-Z0-9]{3,4}',b['text'].strip())}
    if len(tickers)!=1:raise ValueError('image_market_ticker_ambiguous')
    ticker=tickers.pop();passages=[];sides=set()
    for n,(start,h) in enumerate(tables):
        columns=[h[k] for k in ['KURUM','ORAN','NET LOT','MALIYET']]
        if columns!=sorted(columns):raise ValueError('image_market_table_incomplete')
        boundaries=[(columns[j]+columns[j+1])/2 for j in range(3)]
        end=tables[n+1][0] if n+1<len(tables) else len(grid)
        parsed=[]
        for _,cells in grid[start+1:end]:
            parts=[[],[],[],[]]
            for c in cells:
                col=sum(c['x']>=x for x in boundaries);parts[col].append(c['text'])
            if not all(parts):
                if sum(bool(p) for p in parts[1:])>=2:raise ValueError('image_market_table_incomplete')
                continue
            name,ratio,lot,cost=[' '.join(p).strip() for p in parts]
            if len(name)>60:raise ValueError('image_market_table_incomplete')
            ratio=decimal_value(ratio,True);lot=lot_value(lot);cost=decimal_value(cost)
            side='satım' if lot.startswith('-') else 'alım'
            absolute=' | Net satım miktarı: '+lot[1:] if side=='satım' else ''
            parsed.append((side,f'Hisse kodu: {ticker} | Net {side} yapan kurum: {name} | Oran: {ratio} | Net lot: {lot}{absolute} | Maliyet: {cost} (para birimi görselde belirtilmemiş)'))
        if not 1<=len(parsed)<=20 or len({side for side,_ in parsed})!=1:raise ValueError('image_market_table_incomplete')
        sides.add(parsed[0][0])
        for j,(_,text) in enumerate(parsed):passages.append({'id':f'image_table{n+1}row{j+1}','text':text})
    if sides!={'alım','satım'}:raise ValueError('image_market_table_incomplete')
    dates=set(re.findall(r'\b(?:\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4}|\d{1,2}\s+(?:Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık)\s+20\d{2})\b',ocr_text(blocks),re.I))
    period='Görselde geçen tarih ifadeleri: '+', '.join(sorted(dates))+'. Veri dönemi yalnız ilgili başlıkla açıkça ilişkilendirilebiliyorsa kullanılır.' if dates else 'Kaynak görselde veri tarihi ve saati belirtilmemiş; bu nedenle güncel tarih veya anlık piyasa iddiası eklenemez.'
    metadata={'id':'image_metadata','text':f'Hisse kodu: {ticker}. Aracı kurum dağılımı. {period} Oran ve maliyet sütunundaki ondalık noktalar Türkçe virgüle dönüştürüldü; net lot sütunundaki binlik noktalar korundu. Maliyet için para birimi tahmin edilmez.'}
    return {'kind':'akd','ticker':ticker},[metadata,*passages]

def institutional_passages(blocks):
    grid=rows(blocks);tables=[]
    norm=lambda s:re.sub(r'\s+','',s.upper().replace('İ','I').replace('Ş','S'))
    keys=['HISSE','N.HACIM','NETADET','N.MALIYET','ADET','MALIYET']
    for i,(_,cells) in enumerate(grid):
        h={norm(c['text']):c['x'] for c in cells}
        if all(k in h for k in keys):tables.append((i,h))
    if not tables:
        if any(norm(b['text'])=='HISSE' for b in blocks) and any(re.match(r'^T\.?\s*(?:Alış|Satış)',b['text'],re.I) for b in blocks):raise ValueError('image_market_table_incomplete')
        return None
    if len(tables)>2:raise ValueError('image_market_table_incomplete')
    section_labels=[b for b in blocks if re.match(r'^T\.?\s*(?:Alış|Satış)',b['text'],re.I)]
    if len(section_labels)!=len(tables):raise ValueError('image_market_table_incomplete')
    first_y=grid[tables[0][0]][0]
    titles=[b['text'].strip() for b in sorted(blocks,key=lambda b:b['y']) if b['y']<first_y and b['x']<.55 and not re.match(r'^(?:Tarih|T\.|T\s)',b['text'],re.I)]
    if not titles:raise ValueError('image_market_broker_missing')
    # OCR sometimes substitutes visually identical Cyrillic capitals. Preserve
    # raw OCR and the image; normalize only those letter shapes in the heading.
    broker=titles[0].translate(str.maketrans('АВЕКМНОРСТХ','ABEKMHOPCTX'))
    if not 2<=len(broker)<=80:raise ValueError('image_market_broker_missing')
    passages=[];facts=[];seen_sides=set()
    for n,(start,h) in enumerate(tables):
        labels=[b['text'] for b in blocks if b['y']<grid[start][0] and re.match(r'^T\.?\s*(?:Alış|Satış)',b['text'],re.I)]
        if not labels:raise ValueError('image_market_side_ambiguous')
        last=max((b for b in blocks if b['text'] in labels),key=lambda b:b['y'])['text']
        side='buy' if re.match(r'^T\.?\s*Alış',last,re.I) else 'sell'
        if side in seen_sides:raise ValueError('image_market_side_ambiguous')
        seen_sides.add(side);word='alım' if side=='buy' else 'satım'
        xs=[h[k] for k in keys]
        if xs!=sorted(xs):raise ValueError('image_market_table_incomplete')
        cuts=[(xs[j]+xs[j+1])/2 for j in range(5)];end=tables[n+1][0] if n+1<len(tables) else len(grid);count=0
        for _,cells in grid[start+1:end]:
            parts=[[] for _ in keys]
            for c in cells:
                if c['x']<xs[0]-.04:continue
                parts[sum(c['x']>=cut for cut in cuts)].append(c['text'])
            values=[' '.join(p).strip() for p in parts]
            numeric=sum(bool(re.match(r'^[-+]?\d',v)) for v in values[1:])
            if not re.fullmatch(r'[A-Z][A-Z0-9]{3,4}',values[0]):
                if numeric>=2:raise ValueError('image_market_table_incomplete')
                continue
            if not all(values):raise ValueError('image_market_table_incomplete')
            symbol,volume,net_lot,net_cost,total_lot,cost=values
            amount=re.fullmatch(r'(\d+(?:[.,]\d{1,2})?)\s*(Mn|Mr)(?:\s*(TL|₺))?',volume,re.I)
            if not amount:raise ValueError('image_market_number_ambiguous')
            volume=decimal_value(amount[1])+(' milyon' if amount[2].lower()=='mn' else ' milyar')+(' TL' if amount[3] else '')
            net_lot=lot_value(net_lot).replace(' lot',' adet');total_lot=lot_value(total_lot).replace(' lot',' adet');net_cost=decimal_value(net_cost);cost=decimal_value(cost);count+=1
            fact=f'Kurum: {broker} | {word} listesi sıra: {count} | Hisse kodu: {symbol} | Listelenen net hacim: {volume} | Net adet: {net_lot} | Net maliyet: {net_cost} | Adet: {total_lot} | Maliyet: {cost}. Para birimi '+('hacim sütununda TL olarak belirtilmiş; maliyet sütununda belirtilmemiş.' if amount[3] else 'görselde belirtilmemiş; TL veya farklı para birimi tahmin edilmez.')
            passages.append({'id':f'image_institutional_{side}_{count}','text':fact});facts.append({'side':side,'symbol':symbol,'volume':volume,'rank':count})
        if not 1<=count<=20:raise ValueError('image_market_table_incomplete')
    dates=re.findall(r'\b(\d{2})-(\d{2})-(20\d{2})\b',ocr_text(blocks));period='Görselde veri tarihi: '+', '.join('.'.join(d) for d in dates)+'.' if dates else 'Kaynakta veri tarihi belirtilmemiş; anlık veya bugün iddiası eklenemez.'
    passages.insert(0,{'id':'image_institutional_metadata','text':f'Kurum: {broker}. Kurum üzerinden en çok alınan/satılan hisseler. {period} Görseldeki kurum başlığında aynı görünümlü OCR harfleri Latin alfabesine normalleştirildi. Kurumun kendi portföy işlemi olduğu çıkarılamaz.'})
    return {'kind':'institutional','broker':broker,'tickers':list(dict.fromkeys(r['symbol'] for r in facts)),'rows':facts},passages

def read_image(path,root,ocr):
    data=path.read_bytes()
    if len(data)>20_000_000:raise ValueError('image_size_limit')
    with Image.open(path) as probe:
        if probe.format not in ('PNG','JPEG','WEBP'):raise ValueError('image_format_unsupported')
        if not 100<=probe.width<=12000 or not 100<=probe.height<=12000 or probe.width*probe.height>25_000_000:raise ValueError('image_dimension_limit')
        probe.verify()
    folder=root/('image-'+hashlib.sha256(data).hexdigest());folder.mkdir(parents=True,exist_ok=True,mode=0o700)
    image=folder/'source.png'
    with Image.open(path) as original:original.convert('RGB').save(image)
    image.chmod(0o600)
    if image.stat().st_size>8_000_000:raise ValueError('image_size_limit')
    deadline=time.monotonic()+6
    try:
        raw=subprocess.run([str(ocr),str(image)],capture_output=True,text=True,timeout=6,check=True)
        blocks=json.loads(raw.stdout)
    except (subprocess.SubprocessError, OSError, ValueError):
        blocks=[] # Pixel analysis can still read an image when OCR is unavailable.
    raw_text=ocr_text(blocks)
    layout=source_layout(blocks)
    try:
        blocks=recover_labels(blocks,image,ocr,deadline)
        blocks=recover_numeric_cells(blocks,image,ocr,deadline)
    except (subprocess.SubprocessError,OSError,ValueError):
        pass # OCR repair is optional; pixel extraction still has the original.
    text=ocr_text(blocks)
    if len(text)>100_000:raise ValueError('image_text_limit')
    try:parsed=institutional_passages(blocks) or market_passages(blocks)
    except ValueError:parsed=None # Never let an OCR parse error veto visual reading.
    original={'id':'image_ocr_raw','text':'Yardımcı OCR metni; görseldeki konum ve etiket ilişkileri doğrudan görüntüden doğrulanmalıdır:\n'+raw_text}
    market,passages=parsed if parsed else (None,[original])
    body='\n\n'.join(p['text'] for p in passages)
    images=[str(image)]
    if layout and layout['kind']=='theoretical':
        # Keep the original plus readable evidence crops. Never infer missing
        # cells; every crop retains that panel's real header pixels.
        with Image.open(image) as original:
            w,h=original.size
            for side in range(2):
                for part,(top,bottom) in enumerate(((.155,.55),(.545,.95))):
                    x0=int(w*side/2);x1=int(w*(side+1)/2)
                    header=original.crop((x0,0,x1,int(h*.155)))
                    body_crop=original.crop((x0,int(h*top),x1,int(h*bottom)))
                    tile=Image.new('RGB',(x1-x0,header.height+body_crop.height));tile.paste(header,(0,0));tile.paste(body_crop,(0,header.height))
                    path=folder/f'theoretical-{side}-{part}.png';tile.save(path);path.chmod(0o600);images.append(str(path))
    return {**({'source_layout':layout}if layout else {}),'body':body,'passages':[original,*passages] if parsed else passages,'images':images,
      **({'market_data':market} if market else {}),'coverage':{'complete':True,'page_count':1,'pages':[{'page':1,'mode':'image_ocr_visual','characters':len(text),'tables':len({r['side'] for r in market['rows']}) if market and market['kind']=='institutional' else 2 if parsed else 0}]}}

if __name__=='__main__':
    try:print(json.dumps(read_image(pathlib.Path(sys.argv[1]),pathlib.Path(sys.argv[2]),pathlib.Path(sys.argv[3])),ensure_ascii=False))
    except Exception as e:
        reason=str(e) if isinstance(e,ValueError) and re.fullmatch('image_[a-z_]+',str(e)) else 'image_extraction_failed'
        print(json.dumps({'error':reason}),file=sys.stderr);sys.exit(1)
