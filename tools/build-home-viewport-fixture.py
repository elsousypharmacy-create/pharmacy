from pathlib import Path
import re,html
root=Path(__file__).resolve().parent.parent
source=(root/'index.html').read_text()
legacy=''.join(re.findall(r'<style>([\s\S]*?)</style>',source))
fit=source[source.index('function homeFlashViewportBounds('):source.index("if(typeof window!=='undefined' && window.addEventListener){window.addEventListener('resize',staffFlashFit)")]
(root/'tools/fixtures/home-legacy.css').write_text(legacy)
font=''.join(re.findall(r'<link[^>]+fonts.googleapis.com[^>]*>',source))
nav=re.search(r'<nav class="secnav" id="secnav">[\s\S]*?</nav>',source).group()
nav=re.sub(r' onclick="[^"]*"','',nav)
mini=lambda label,value:f'<div class="h-mini"><small>{label}</small><b>{value}</b><u>بيانات تجريبية</u></div>'
stats=''.join(mini(k,v) for k,v in [('الفواتير','36'),('ربح البيع','240'),('متوسط الفاتورة','125'),('المرتجعات','20')])
main='<div class="h-main"><svg class="h-ring" viewBox="0 0 110 110"><circle cx="55" cy="55" r="46" fill="none" stroke="#58b2e6" stroke-width="9"/><text x="55" y="62" text-anchor="middle" fill="white" font-size="24">45%</text></svg><div class="h-num"><small>صافي المبيعات</small><b>4,500</b><u>فاضل 5,500 على 10,000</u></div></div>'
insights='<div class="home-insight-grid">'+''.join(f'<div class="home-insight-slot"><button class="home-insight-card {kind}-card"><span class="insight-heading">{label} ⌄</span><b class="insight-value">{value}</b><small class="insight-updated">آخر تحديث: ٣ نوفمبر، ١٢:٣٠ م</small></button></div>' for kind,label,value in [('expense','المصروفات','17 جنيه'),('camera','الكاميرات','85 / 100')])+'</div>'
today='<article class="card h-hero h-slide home-flash-page home-flash-today" data-flash-key="overview"><div class="h-top"><h2>اليوم</h2><button class="ctl-more">⋯</button></div>'+main+'<div class="h-minis" style="grid-template-columns:repeat(2,minmax(0,1fr))">'+stats+'</div>'+insights+'</article>'
period='<article id="heroMonth" class="card h-hero h-slide home-flash-page" data-flash-key="period"><div class="period-card"><div class="home-period-controls"><div class="period-tabs"><button>أمس</button><button class="on">نوفمبر</button><button>أكتوبر</button></div><button class="ctl-more">⋯</button></div>'+main+'<div class="h-minis" style="grid-template-columns:repeat(2,minmax(0,1fr))">'+stats+'</div><div class="h-expense"><div><small>المصروفات المفصّلة</small></div><b>17 جنيه</b></div><small class="expense-updated">آخر تحديث: ٣ نوفمبر ١٢:٣٠ م</small><button class="btn btn-quiet">تفاصيل الفترة</button></div></article>'
presence='<article class="staff-flash-card home-presence-page" data-flash-key="presence"><div class="staff-flash-head"><div><h3>الموجودون الآن</h3><small>3 من الفريق</small></div></div><div class="home-presence-list">'+''.join(f'<button class="home-presence-person"><span><b>موظف تجريبي {n}</b><small>دخول 08:30 ص</small></span><span><b>1,500</b><small>صافي مبيعات اليوم</small></span></button>' for n in 'أبت')+'</div><div class="staff-flash-footer"><button class="btn btn-quiet">صفحة الفريق ←</button></div></article>'
frames=[]
for width,height,gap in [(375,667,10),(390,720,44),(430,844,44),(375,600,44)]:
 doc=f'''<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">{font}<link rel="stylesheet" href="home-legacy.css"><link rel="stylesheet" href="../../dashboard-ui.css"><style>header.top{{height:72px}}.secnav{{bottom:{gap}px}}</style></head><body class="home-flash-mode"><header class="top"><div class="brand"><div><h1>اختبار المقاسات</h1><p>بيانات تجريبية</p></div></div></header><section class="screen on" id="sc-sales"><div class="wrap" id="p-home"><div class="home-flash-deck staff-flash-deck">{today}{period}{presence}</div></div></section>{nav}<script>{fit}\naddEventListener('resize',staffFlashFit);staffFlashFit();</script></body></html>'''
 frames.append(f'<section><h2>{width} × {height} · bottom gap {gap}</h2><iframe title="viewport-{width}-{height}" width="{width}" height="{height}" srcdoc="{html.escape(doc,quote=True)}"></iframe></section>')
(root/'tools/fixtures/home-viewport.html').write_text('<!doctype html><html><meta charset="utf-8"><title>Home viewport regression fixture</title><style>body{background:#ddd;font:14px system-ui;display:grid;grid-template-columns:repeat(2,max-content);gap:24px}iframe{border:1px solid #888}h2{font-size:14px}</style><h1 style="grid-column:1/-1">Layout fixture — synthetic data only</h1>'+''.join(frames)+'</html>')
print('Built 4 synthetic viewport fixtures')
