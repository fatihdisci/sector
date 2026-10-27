import json,pathlib,tempfile,unittest
from unittest.mock import patch
from PIL import Image,ImageDraw,ImageFont
import sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'scripts'))
from read_image import market_passages,institutional_passages,decimal_value,lot_value,read_image,recover_labels,recover_numeric_cells

def block(text,x,y):return {'text':text,'x':x,'y':y,'width':.08,'height':.025,'confidence':1}
def table():
    out=[block('ASELS',.02,.02)]
    for y,who,percent,lot,price in [(.2,'Ak','%55.50','766.204','348.02'),(.6,'İş','%19.19','-264.966','348.24')]:
        out += [block(t,x,y) for t,x in zip(['KURUM','ORAN','NET LOT','MALİYET'],[.02,.35,.56,.83])]
        out += [block(t,x,y+.06) for t,x in zip([who,percent,lot,price],[.02,.32,.53,.86])]
    return out

class ImageReaderTests(unittest.TestCase):
    def institutional(self):
        out=[block('BANK OF АMERICA',.02,.02),block('Tarih: 22-10-2026',.02,.07)]
        for y,side,symbol,volume,lot,cost in [(.2,'Alış','CITAS','43.9Mn','468.161','93.81'),(.6,'Satış','THYAO','121.1Mn','455.219','266.09')]:
            out.append(block('T. '+side+' Hacmi: 353.4Mn',.01,y-.06))
            out += [block(t,x,y) for t,x in zip(['Hisse','N.Hacim','Net Adet','N.Maliyet','Adet','Maliyet'],[.09,.22,.385,.542,.738,.87])]
            out += [block(t,x,y+.06) for t,x in zip([symbol,volume,lot,cost,lot,cost],[.09,.22,.41,.59,.74,.89])]
        return out
    def test_institutional_columns_preserve_ranks_dates_and_unknown_currency_without_becoming_akd(self):
        meta,passages=institutional_passages(self.institutional())
        self.assertEqual(meta['kind'],'institutional');self.assertEqual(meta['broker'],'BANK OF AMERICA')
        self.assertEqual(meta['rows'],[{'side':'buy','symbol':'CITAS','volume':'43,9 milyon','rank':1},{'side':'sell','symbol':'THYAO','volume':'121,1 milyon','rank':1}])
        text='\n'.join(p['text'] for p in passages)
        self.assertIn('22.10.2026',text);self.assertIn('468.161 adet',text);self.assertIn('Net maliyet: 93,81',text)
        self.assertIn('Para birimi görselde belirtilmemiş',text);self.assertNotIn('43,9 milyon TL',text)
    def test_institutional_missing_header_cell_stock_or_side_cannot_mix_or_drop_rows(self):
        for field in ['CITAS','121.1Mn','T. Satış Hacmi: 353.4Mn']:
            with self.assertRaises(ValueError):institutional_passages([b for b in self.institutional() if b['text']!=field])
        with self.assertRaises(ValueError):institutional_passages([b for b in self.institutional() if not (b['text']=='Hisse' and b['y']>.5)])
        with self.assertRaises(ValueError):institutional_passages([b for b in self.institutional() if not (b['text']=='266.09' and b['x']>.8)])
        with self.assertRaises(ValueError):institutional_passages([b for b in self.institutional() if b['text']!='N.Maliyet'])
    def test_column_locale_sign_and_no_invented_date_or_currency(self):
        meta,passages=market_passages(table());self.assertEqual(meta,{'kind':'akd','ticker':'ASELS'})
        text='\n'.join(p['text'] for p in passages)
        self.assertIn('%55,50',text);self.assertIn('766.204 lot',text);self.assertIn('Maliyet: 348,02',text)
        self.assertIn('-264.966 lot',text);self.assertIn('Net satım miktarı: 264.966 lot',text)
        self.assertIn('tarihi ve saati belirtilmemiş',text);self.assertNotIn('348,02 TL',text)
    def test_missing_label_or_number_never_silently_drops_a_ranked_row(self):
        for field in ['İş','-264.966','348.24']:
            with self.assertRaisesRegex(ValueError,'image_market_table_incomplete'):market_passages([b for b in table() if b['text']!=field])
    def test_ambiguous_decimal_lot_and_incomplete_table_fail(self):
        self.assertEqual(lot_value('-264.966'),'-264.966 lot');self.assertEqual(decimal_value('%55.50',True),'%55,50')
        for value in ['264.96','264,966','26 4966']:
            with self.assertRaises(ValueError):lot_value(value)
        with self.assertRaises(ValueError):decimal_value('%155.50',True)
        with self.assertRaisesRegex(ValueError,'incomplete'):market_passages([b for b in table() if b['y']<.6])
    def test_image_parser_preserves_the_original_visual_and_every_row(self):
        with tempfile.TemporaryDirectory() as temp:
            root=pathlib.Path(temp);p=root/'source.png';Image.new('RGB',(900,1080),(10,10,10)).save(p)
            response=type('Result',(),{'stdout':json.dumps(table())})
            with patch('read_image.subprocess.run',return_value=response):result=read_image(p,root/'evidence',root/'ocr')
            self.assertEqual(result['market_data']['ticker'],'ASELS');self.assertTrue(result['coverage']['complete'])
            self.assertEqual(len(result['images']),1)
            with Image.open(result['images'][0]) as stored:self.assertEqual(stored.size,(900,1080))
            self.assertTrue(any(p['id']=='image_ocr_raw' for p in result['passages']))
    def test_empty_ocr_keeps_pixels_for_visual_analysis(self):
        with tempfile.TemporaryDirectory() as temp:
            root=pathlib.Path(temp);p=root/'source.png';Image.new('RGB',(900,1080),'white').save(p)
            response=type('Result',(),{'stdout':'[]'})
            with patch('read_image.subprocess.run',return_value=response):result=read_image(p,root/'evidence',root/'ocr')
            self.assertEqual(len(result['images']),1)
            self.assertNotIn('market_data',result)
            self.assertTrue(result['body'])

    def test_short_label_recovery_uses_source_pixels_and_never_guesses_when_the_retry_is_unreadable(self):
        with tempfile.TemporaryDirectory() as temp:
            p=pathlib.Path(temp)/'source.png';im=Image.new('RGB',(900,1080),(10,10,10));draw=ImageDraw.Draw(im)
            font=ImageFont.truetype(str(pathlib.Path(__file__).resolve().parents[1]/'assets/NotoSans-Bold.ttf'),26)
            draw.text((18,648),'KURUM',font=font,fill='white');draw.text((18,713),'İş',font=font,fill=(0,220,220));im.save(p)
            missing=[b for b in table() if b['text']!='İş']
            response=type('Result',(),{'stdout':json.dumps([{'text':'KURUMiş','confidence':1}])})
            with patch('read_image.subprocess.run',return_value=response):fixed=recover_labels(missing,p,pathlib.Path(temp)/'ocr')
            self.assertTrue(any(b['text']=='iş' and abs(b['y']-.66)<.01 for b in fixed));self.assertIsNotNone(market_passages(fixed))
            response.stdout=json.dumps([{'text':'KURUM','confidence':1}])
            with patch('read_image.subprocess.run',return_value=response):unread=recover_labels(missing,p,pathlib.Path(temp)/'ocr')
            with self.assertRaisesRegex(ValueError,'incomplete'):market_passages(unread)
    def test_numeric_recovery_requires_two_matching_pixel_reads_and_preserves_unresolved_errors(self):
        with tempfile.TemporaryDirectory() as temp:
            p=pathlib.Path(temp)/'source.png';Image.new('RGB',(900,1080),'black').save(p)
            bad=[{**b,'text':'-264.966ął'} if b['text']=='-264.966' else b for b in table()]
            def answer(v):return type('Result',(),{'stdout':json.dumps([block(v,.53,.2)])})
            with patch('read_image.subprocess.run',side_effect=[answer('-264.966'),answer('-264.966')]):fixed=recover_numeric_cells(bad,p,pathlib.Path(temp)/'ocr')
            self.assertIsNotNone(market_passages(fixed));self.assertTrue(any(b['text']=='-264.966ął' for b in bad))
            for replies in [[answer('-264.966'),answer('-264.965')],[answer('-264.966ął'),answer('-264.966')]]:
                with patch('read_image.subprocess.run',side_effect=replies):unresolved=recover_numeric_cells(bad,p,pathlib.Path(temp)/'ocr')
                with self.assertRaises(ValueError):market_passages(unresolved)
    def test_explicit_data_dates_are_preserved_without_using_the_machine_clock(self):
        _,passages=market_passages(table()+[block('21 Ekim 2026',.2,.1)])
        self.assertIn('21 Ekim 2026',passages[0]['text']);self.assertNotIn('tarihi ve saati belirtilmemiş',passages[0]['text'])

    def test_ocr_times_out_after_six_seconds_and_preserves_pixels_for_vision(self):
        import subprocess
        with tempfile.TemporaryDirectory() as temp:
            root=pathlib.Path(temp);p=root/'source.png';Image.new('RGB',(900,1080),'black').save(p)
            with patch('read_image.subprocess.run',side_effect=subprocess.TimeoutExpired('ocr',6)) as run:
                result=read_image(p,root/'evidence',root/'ocr')
            self.assertEqual(run.call_args.kwargs['timeout'],6)
            self.assertTrue(result['coverage']['complete']);self.assertTrue(pathlib.Path(result['images'][0]).exists())
            self.assertNotIn('market_data',result)
    def test_ocr_table_parse_failure_falls_back_to_original_visual(self):
        with tempfile.TemporaryDirectory() as temp:
            root=pathlib.Path(temp);p=root/'source.png';Image.new('RGB',(900,1080),'black').save(p)
            response=type('Result',(),{'stdout':'[]'})
            with patch('read_image.subprocess.run',return_value=response),patch('read_image.institutional_passages',side_effect=ValueError('image_market_table_incomplete')):
                result=read_image(p,root/'evidence',root/'ocr')
            self.assertNotIn('market_data',result);self.assertTrue(pathlib.Path(result['images'][0]).exists())

if __name__=='__main__':unittest.main()
