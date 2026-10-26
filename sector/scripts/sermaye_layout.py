"""Recognize repeated panel roles; OCR is auxiliary, never numeric proof."""
import re,unicodedata

def fold(s):return ''.join(c for c in unicodedata.normalize('NFD',s.upper().replace('İ','I'))if not unicodedata.combining(c)).replace('ı','I')
def source_layout(blocks):
 text=' '.join(fold(b['text'])for b in blocks)
 kind='theoretical'if 'TEORIK ESLESME'in text else 'institution_summary'if 'KURUM AKD OZETI'in text else 'market_overview'if 'BIST 100'in text and 'ENDEKS ETKISI'in text and 'KURUMSAL DAGILIM'in text else None
 if not kind:return None
 symbol=lambda b:bool(re.fullmatch(r'[A-Z][A-Z0-9]{2,4}(?:\.F)?',b['text'].strip()))and b['text'].strip()not in['HISSE','HİSSE','KURUM','NET','BIST','ORAN']
 panels=[]
 if kind in('theoretical','institution_summary'):
  for side,x in [('buy',0),('sell',.48)]:
   lo=.15 if kind=='theoretical'else .48
   values=[b for b in blocks if x+.05<=b['x']<x+.20 and lo<b['y']<.94 and symbol(b)]
   panels.append({'name':side,'symbols':[b['text'].strip()for b in sorted(values,key=lambda b:b['y'])]})
 else:
  names=['ENDEKSI YUKSELTENLER','ENDEKSI DUSURENLER','EN COK YUKSELENLER','EN COK DUSENLER','HACIM LIDERLERI']
  headers=[b for b in blocks if any(n in fold(b['text'])for n in names)]
  major=[b['y']for b in blocks if fold(b['text']).strip()in('ONE CIKAN HISSELER','KURUMSAL DAGILIM')]
  for h in headers:
   end=min([1]+[y for y in major if y>h['y']+.02]+[b['y']for b in headers if b['y']>h['y']+.03 and abs(b['x']-h['x'])<.12])
   values=[b for b in blocks if abs(b['x']-h['x'])<.12 and h['y']+.015<b['y']<end and symbol(b)]
   panels.append({'name':next(n for n in names if n in fold(h['text'])),'symbols':[b['text'].strip()for b in sorted(values,key=lambda b:b['y'])]})
 return {'kind':kind,'panels':panels,'minimum_rows':sum(len(p['symbols'])for p in panels),'role_note':'OCR panel/satır adaylarıdır; sayı, birim ve tam kapsam piksellerden doğrulanmalıdır.'}
