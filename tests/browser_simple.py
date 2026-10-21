"""Optional local QA: Python Playwright + installed Chromium, no production server/data."""
import functools, http.server, io, json, shutil, subprocess, tarfile, tempfile, threading, time
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
ARTIFACTS=ROOT.parent/'work'/'simple-money-qa'
ARTIFACTS.mkdir(parents=True,exist_ok=True)
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
    def end_headers(self):
        self.send_header('Cache-Control','no-store')
        super().end_headers()
def serve(directory):
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(directory)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    return server,f'http://127.0.0.1:{server.server_port}'
def fixture(day):
    return dict(version=1,settings=dict(startingBalance=50000,salary=0,savingsTarget=0,foodLimit=0,taxiLimit=0,startDate=day),
      debts=[dict(id='card',name='Synthetic card',balance=30000,kind='card')],goals=[],wishes=[],
      obligations=[dict(id='bill',name='Synthetic long scheduled payment with a deliberately lengthy title',amount=20000,type='bill',category='Здоровье',firstDue=day,frequency='once'),dict(id='repeat',name='Synthetic monthly appointment',amount=6000,type='bill',category='Здоровье',firstDue=day,frequency='monthly')],
      transactions=[dict(id='pool',type='reserve',amount=20000,date=day,fundingKey='bill|'+day),dict(id='savings',type='reserve',amount=1000,date=day),dict(id='expense',type='expense',method='cash',category='Красота',amount=10,date=day,note='Synthetic purchase',merchant='Synthetic store',channel='marketplace',custom=dict(keep=True))])
def fits(page):
    assert page.evaluate('document.documentElement.scrollWidth')<=page.viewport_size['width']+1, ('page overflow',page.evaluate('document.documentElement.scrollWidth'),page.viewport_size)
    if page.locator('dialog[open]').count():
        assert page.locator('dialog[open]').evaluate('(e)=>e.scrollWidth<=e.clientWidth'), 'dialog overflow'
        assert page.locator('dialog[open]').bounding_box()['width']<=page.viewport_size['width']+1, ('wide dialog',page.locator('dialog[open]').bounding_box(),page.viewport_size)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    server,url=serve(ROOT)
    try:
        for width,height in [(320,720),(375,812),(390,844),(430,932),(844,390)]:
            context=browser.new_context(viewport=dict(width=width,height=height),is_mobile=True,has_touch=True,locale='ru-RU',timezone_id='Europe/Moscow',accept_downloads=True)
            page=context.new_page();errors=[];page.on('pageerror',lambda err:errors.append(str(err)))
            page.goto(url);page.wait_for_function('typeof MoneyFinance!=="undefined"');day=page.evaluate('today()');seed=fixture(day)
            page.evaluate('(s)=>{state=s;persist();render()}',seed)
            assert page.locator('#header-title').inner_text()=='My Money'
            assert page.evaluate('MoneyFinance.freeNow(state,today())')==28990
            text=page.locator('main').inner_text()
            for unwanted in ['Не подтверждено','В плане не хватает','Бюджет требует уточнения']:
                assert unwanted not in text
            assert not page.locator('#actual-categories').evaluate('(e)=>e.open')
            fits(page)
            page.locator('#actual-categories summary').click()
            selected=page.locator('#month-filter').input_value()
            page.locator('[data-action="month-next"]').click()
            assert page.locator('#actual-categories').evaluate('(e)=>e.open')
            page.locator('[data-action="month-prev"]').click()
            assert page.locator('#month-filter').input_value()==selected
            page.locator('#actual-categories summary').click()
            if width==390:page.screenshot(path=str(ARTIFACTS/'home-390.png'),full_page=True)
            page.locator('[data-action="show-reserves"]').click();assert 'Synthetic long' in page.locator('#modal-body').inner_text();fits(page);page.locator('#close-modal').click()
            page.locator('.tab[data-page="transactions"]').click();old=page.locator('#month-filter').input_value();page.locator('[data-action="month-next"]').click();assert page.locator('#month-filter').input_value()!=old;page.locator('[data-action="month-prev"]').click();assert page.locator('#month-filter').input_value()==old
            page.locator('[data-action="edit-transaction"][data-id="expense"]').click()
            assert not page.locator('#transaction-form details').evaluate('(e)=>e.open')
            assert page.locator('#f-amount').is_visible() and page.locator('#f-note').is_visible()
            assert not page.locator('#f-date').is_visible()
            page.locator('#f-amount').fill('12');page.locator('#f-note').fill('Edited synthetic purchase');fits(page);page.locator('#transaction-form button[type="submit"]').click()
            assert page.evaluate('state.transactions.find(t=>t.id==="expense").custom.keep')
            page.locator('.tab[data-page="obligations"]').click();fits(page)
            page.locator('[data-action="pay-obligation"]').first.click();page.locator('#f-amount').fill('15000');page.locator('#f-finalPayment').select_option('yes');fits(page);page.locator('#unified-payment-form button').filter(has_text='Сохранить').click()
            assert page.locator('#modal-title').inner_text()=='Платёж закрыт';page.locator('#close-modal').click()
            assert page.evaluate('MoneyFinance.cash(state,today())')==34988
            assert page.evaluate('MoneyFinance.reserves(state,today()).pools["bill|"+today()]')==0
            closed=page.locator('.settled-payment').first
            assert closed.locator('s').count()==2
            assert closed.locator('small,p,button').count()==0
            fits(page)
            closed.click();page.locator('[data-action="reopen-occurrence"]').click()
            assert page.evaluate('MoneyFinance.schedule(state,today()).find(o=>o.id==="bill").amount')==5000
            assert page.evaluate('MoneyFinance.reserves(state,today()).pools["bill|"+today()]')==5000
            count=page.evaluate('state.transactions.length');page.locator('[data-action="close-occurrence"]').click();page.locator('[data-action="apply-close"]').click();assert page.evaluate('state.transactions.length')==count
            if width==390:
                page.screenshot(path=str(ARTIFACTS/'payments-390.png'),full_page=True)
                page.locator('#open-settings').click()
                with page.expect_download() as download:page.locator('[data-action="export-json"]').click()
                data=Path(download.value.path()).read_text();expected=json.loads(data)
                page.on('dialog',lambda dialog:dialog.accept())
                page.locator('#import-json').set_input_files(dict(name='synthetic-backup.json',mimeType='application/json',buffer=data.encode()))
                page.wait_for_function('page==="home"')
                assert page.evaluate('state.paymentClosures')==expected['paymentClosures']
                assert page.evaluate('state.transactions.length')==len(expected['transactions'])
            if width==390:
                revised=fixture(day);revised['obligations'][0]['amount']=10000
                revised['transactions']=[dict(id='part1',type='expense',method='cash',amount=2000,date=day,obligationId='bill',forDue=day),dict(id='part2',type='expense',method='cash',amount=4000,date=day,obligationId='bill',forDue=day)]
                revised['paymentClosures']={'bill|'+day:dict(closed=True,date=day)}
                page.evaluate('(s)=>{state=s;page="obligations";render()}',revised)
                page.locator('.settled-payment').first.click();page.locator('[data-action="edit-transaction"][data-id="part1"]').click()
                assert page.locator('#f-occurrence').input_value()=='bill|'+day
                page.locator('#f-amount').fill('1000');page.locator('#unified-payment-form button').filter(has_text='Сохранить').click()
                assert page.evaluate('state.transactions.find(t=>t.id==="part1").obligationId')=='bill'
                assert page.evaluate('state.transactions.length')==2
            assert not errors,errors
            context.close();print(f'PASS mobile/landscape {width}x{height}')
        # Real Service Worker update: isolated synthetic v0.3 installation -> working tree -> offline.
        with tempfile.TemporaryDirectory(prefix='simple-pwa-') as folder:
            staged=Path(folder)
            archive=subprocess.check_output(['git','archive','67f2d2431e3ec7228206007a8c756b2fe3eb239c'],cwd=ROOT)
            with tarfile.open(fileobj=io.BytesIO(archive)) as t:t.extractall(staged,filter='data')
            old_server,origin=serve(staged)
            profile=Path(tempfile.mkdtemp(prefix='simple-browser-profile-'));context=p.chromium.launch_persistent_context(str(profile),executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'],locale='ru-RU',timezone_id='Europe/Moscow')
            try:
                page=context.new_page();page.goto(origin);page.evaluate('navigator.serviceWorker.ready.then(()=>true)');page.reload();page.wait_for_function('navigator.serviceWorker.controller!==null')
                seed=fixture(page.evaluate('today()'));page.evaluate('(s)=>{state=s;persist();render()}',seed);raw=page.evaluate('localStorage.getItem(STORAGE_KEY)')
                for name in ['index.html','style.css','app.js','assistant-ui.js','finance.js','planner.js','planner-ui.js','sw.js','manifest.webmanifest']:
                    shutil.copy2(ROOT/name,staged/name)
                page.evaluate('navigator.serviceWorker.getRegistration().then(r=>r.update())')
                page.wait_for_function('navigator.serviceWorker.getRegistration().then(r=>!!r.waiting)',timeout=20000)
                # Close every client, and wait for activation before creating a new one.
                # Navigating too early can attach the new page to the old worker again.
                for client in context.pages:client.close()
                activated=False
                for attempt in range(100):
                    for worker in context.service_workers:
                        try:
                            if worker.evaluate('typeof CACHE!=="undefined" && CACHE.startsWith("my-money-v04") && self.registration.waiting===null && self.registration.active?.state==="activated"'):
                                activated=True;break
                        except Exception:pass
                    if activated:break
                    time.sleep(.1)
                assert activated, 'new worker did not activate after closing all clients'
                page=context.new_page();page.goto(origin);page.wait_for_function('document.title.includes("0.4")',timeout=20000)
                assert page.evaluate('localStorage.getItem(STORAGE_KEY)')==raw
                context.set_offline(True);page.reload();page.wait_for_function('document.title.includes("0.4")');assert page.evaluate('localStorage.getItem(STORAGE_KEY)')==raw
                assert 'Свободно сейчас' in page.locator('main').inner_text()
                print('PASS real PWA v0.3 -> v0.4 update, unchanged storage, offline reload')
            finally:context.close();old_server.shutdown();shutil.rmtree(profile,ignore_errors=True)
    finally:browser.close();server.shutdown()
