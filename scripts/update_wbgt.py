#!/usr/bin/env python3
import csv,io,json,os,tempfile,urllib.request,urllib.error
from datetime import datetime,timezone,timedelta
from pathlib import Path
JST=timezone(timedelta(hours=9)); BASE='https://www.wbgt.env.go.jp'; POINT='46106'; OUT=Path(__file__).resolve().parents[1]/'data/current.json'; MAX=2_000_000
def fetch(path,encoding):
 if not(path==f'/prev15WG/dl/yohou_{POINT}.csv' or path.startswith(f'/est15WG/dl/wbgt_{POINT}_') or path.startswith('/alert/dl/')): raise ValueError('blocked path')
 req=urllib.request.Request(BASE+path,headers={'User-Agent':'tsurugamine-wbgt-signage/1.0','Accept':'text/csv,text/plain;q=0.9'})
 with urllib.request.urlopen(req,timeout=15) as r:
  ct=(r.headers.get('Content-Type') or '').lower(); raw=r.read(MAX+1)
  if r.status!=200 or len(raw)>MAX or (ct and not any(x in ct for x in ('text/csv','text/plain','application/octet-stream'))): raise RuntimeError('invalid response')
 text=raw.decode(encoding).lstrip('\ufeff')
 if not text.strip() or '<html' in text.lower(): raise RuntimeError('invalid body')
 return text
def rows(s): return list(csv.reader(io.StringIO(s)))
def main():
 n=datetime.now(JST); y=n.strftime('%Y'); ym=n.strftime('%Y%m'); ymd=n.strftime('%Y%m%d')
 f=fetch(f'/prev15WG/dl/yohou_{POINT}.csv','ascii'); fr=rows(f)
 if len(fr)<2 or not any(r and r[0].strip()==POINT for r in fr[1:]): raise RuntimeError('forecast format')
 a=fetch(f'/est15WG/dl/wbgt_{POINT}_{ym}.csv','ascii'); ar=rows(a)
 if not ar or ar[0][:2]!=['Date','Time'] or POINT not in ar[0]: raise RuntimeError('actual format')
 alerts=[]; warnings=[]
 for h in ('05','10','14','17'):
  try:
   s=fetch(f'/alert/dl/{y}/alert_{ymd}_{h}.csv','utf-8'); rr=rows(s)
   if not any(len(r)>=8 and (r[4].strip()=='神奈川県' or r[5].strip()=='14') for r in rr): raise RuntimeError('alert format')
   alerts.append(s)
  except Exception as e: warnings.append(f'{h}:{type(e).__name__}')
if not alerts:
    warnings.append('当日のアラートCSVはまだ生成されていません')
 p={'schemaVersion':1,'generatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),'sourceHost':'www.wbgt.env.go.jp','pointCode':POINT,'partialWarnings':warnings,'official':{'forecastCsv':f,'actualCsv':a,'alertCsvs':alerts}}
 OUT.parent.mkdir(exist_ok=True); fd,tmp=tempfile.mkstemp(dir=OUT.parent)
 with os.fdopen(fd,'w',encoding='utf-8') as x: json.dump(p,x,ensure_ascii=False,separators=(',',':')); x.write('\n')
 os.replace(tmp,OUT); print('updated',OUT,'alerts',len(alerts),'warnings',warnings)
if __name__=='__main__': main()
