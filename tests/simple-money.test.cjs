const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const F=require('../finance.js'),P=require('../planner.js');
const day='2026-10-21';
function sample(){return {version:1,settings:{startingBalance:56290,salary:0,savingsTarget:0,foodLimit:0,taxiLimit:0},transactions:[],obligations:[{id:'bill',name:'Synthetic payment',amount:20000,type:'bill',category:'Здоровье',frequency:'once',firstDue:day}],debts:[],goals:[],wishes:[]}}
const put=(s,x={})=>F.savePayment(s,{newId:'pay',commandId:'command',amount:15000,date:day,obligationId:'bill',forDue:day,finalPayment:true,...x}).state;
const fund=(s,n=20000)=>F.reserveFunding(s,{obligationId:'bill',forDue:day,amount:n,newId:'reserve'},day);
function screen(s){const raw=JSON.stringify(s),els=new Map(),events={};let writes=0,out;
 const el=id=>{if(!els.has(id))els.set(id,{innerHTML:'',textContent:'',dataset:{},classList:{add(){},remove(){},toggle(){}},addEventListener(){},showModal(){},close(){}});return els.get(id)};
 const ctx=vm.createContext({Date,Math,Set,Map,Number,String,JSON,structuredClone,setTimeout:()=>0,clearTimeout(){},localStorage:{getItem:()=>raw,setItem(){writes++}},document:{getElementById:el,querySelectorAll:()=>[],addEventListener:(name,fn)=>(events[name]??=[]).push(fn)},navigator:{},location:{protocol:'file:'},capture:v=>out=v,confirm:()=>true});
 for(const f of ['finance.js','planner.js','planner-ui.js','assistant-ui.js','app.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),ctx);vm.runInContext('today=()=>"2026-10-21"',ctx);
 return {ctx,el,events,run:code=>vm.runInContext(code,ctx),data:()=>JSON.parse(vm.runInContext('JSON.stringify(state)',ctx)),writes:()=>writes,export:()=>{vm.runInContext('downloadFile=(name,data)=>capture(data);exportJSON()',ctx);return out}};
}
test('free now equals card minus savings and real payment reserves, never future salary',()=>{
 let s=sample();s.obligations[0].amount=30000;s.settings.salary=500000;s=fund(s,24000);assert.equal(F.cash(s,day),56290);assert.equal(F.freeNow(s,day),32290);
 s.transactions.push({id:'save',type:'reserve',amount:1000,date:day});assert.equal(F.freeNow(s,day),31290);assert.equal(F.cash(s,day),56290);
});
test('final funded payment charges actual amount once and releases unused reserve with no fake income',()=>{
 let s=fund(sample());assert.equal(F.freeNow(s,day),36290);s=put(s);assert.equal(F.cash(s,day),41290);assert.equal(F.reserves(s,day).total,0);assert.equal(F.freeNow(s,day),41290);assert.equal(s.transactions.length,2);assert.equal(s.transactions.filter(t=>t.type==='income').length,0);assert.equal(s.transactions.find(t=>t.type==='expense').amount,15000);
});
test('historical 6000 -> 4220 closes without creating or modifying any transaction',()=>{
 const s=sample();s.obligations[0].amount=6000;s.transactions=[{id:'old',type:'expense',method:'cash',date:day,amount:4220,obligationId:'bill',forDue:day,custom:{keep:true}}];const original=JSON.stringify(s.transactions),balance=F.cash(s,day);
 const closed=F.setOccurrenceClosed(s,'bill',day,true,day),o=F.schedule(closed,day)[0];assert.equal(o.amount,0);assert.equal(o.status,'paid');assert.equal(o.paid,4220);assert.equal(o.savings,1780);assert.equal(JSON.stringify(closed.transactions),original);assert.equal(F.cash(closed,day),balance);assert.deepEqual(F.setOccurrenceClosed(closed,'bill',day,true,day),closed);
});
test('historical 10000 -> 6100 closes without another debit and leaves old partials open until confirmed',()=>{
 const s=sample();s.obligations[0].amount=10000;s.transactions=[{id:'old',type:'expense',method:'cash',date:day,amount:6100,obligationId:'bill',forDue:day}];assert.equal(F.schedule(s,day)[0].status,'partial');assert.equal(F.schedule(s,day)[0].amount,3900);
 const closed=F.setOccurrenceClosed(s,'bill',day,true,day);assert.equal(F.cash(closed,day),F.cash(s,day));assert.equal(closed.transactions.length,1);assert.equal(F.schedule(closed,day)[0].savings,3900);assert.equal(P.forecast(closed,day,3).events.filter(e=>e.kind==='obligation').length,0);
});
test('partial payment consumes only used reserve; later final payment releases the unused remainder',()=>{
 let s=fund(sample());s=put(s,{amount:5000,finalPayment:false});assert.equal(F.schedule(s,day)[0].status,'partial');assert.equal(F.schedule(s,day)[0].amount,15000);assert.equal(F.reserves(s,day).total,15000);assert.equal(F.freeNow(s,day),36290);
 s=put(s,{amount:10000,newId:'pay2',commandId:'cmd2',finalPayment:true});assert.equal(F.cash(s,day),41290);assert.equal(F.reserves(s,day).total,0);assert.equal(F.schedule(s,day)[0].paid,15000);assert.equal(F.schedule(s,day)[0].savings,5000);
});
test('final settlement closes only selected recurrence, not future weekly/monthly/split payments',()=>{
 for(const frequency of ['weekly','monthly','biweekly']){let s=sample();s.obligations[0].frequency=frequency;s=put(s);const rows=F.schedule(s,'2026-12-31');assert.equal(rows[0].status,'paid');assert.ok(rows.slice(1).every(o=>o.status==='unpaid'&&o.amount===20000));}
});
test('reopening mistaken final closure restores outstanding amount and unused protected reserve',()=>{
 let s=put(fund(sample()));s=F.setOccurrenceClosed(s,'bill',day,false,day);assert.equal(F.cash(s,day),41290);assert.equal(F.schedule(s,day)[0].amount,5000);assert.equal(F.reserves(s,day).total,5000);assert.equal(F.freeNow(s,day),36290);
});
test('editing and deleting final payment keeps IDs and derives closure/reserves from surviving records',()=>{
 let s=put(fund(sample()));s=put(s,{id:'pay',amount:12000,finalPayment:true,note:'edited'});assert.equal(s.transactions.length,2);assert.equal(s.transactions.find(t=>t.id==='pay').obligationId,'bill');assert.equal(F.cash(s,day),44290);assert.equal(F.reserves(s,day).total,0);assert.equal(F.schedule(s,day)[0].savings,8000);
 const removed=F.removePayment(s,'pay');assert.equal(F.cash(removed,day),56290);assert.equal(F.schedule(removed,day)[0].status,'unpaid');assert.equal(F.reserves(removed,day).total,20000);
});
test('final future payment releases its pool in forecast, no extra spend or false deficit',()=>{
 const s=sample();s.obligations[0].firstDue='2026-10-25';let next=F.reserveFunding(s,{obligationId:'bill',forDue:'2026-10-25',amount:20000,newId:'reserve'},day);next=put(next,{date:'2026-10-25',forDue:'2026-10-25'});const f=P.forecast(next,day,7);assert.equal(f.initialCash,56290);assert.equal(f.end,41290);assert.equal(f.events.filter(e=>e.kind==='recorded'&&e.amount<0).length,1);
});
test('closed recurring bill variance is not recreated as a forecast expense by a category limit',()=>{
 let s=sample();s.obligations[0].amount=6000;s.obligations[0].frequency='monthly';s.obligations[0].category='Жильё';s.settings.categoryBudgets={'Жильё':6000};s=put(s,{amount:4220});const f=P.forecast(s,day,11);assert.equal(f.events.filter(e=>e.kind==='living').length,0);assert.equal(f.end,52070);
});
test('category actuals work without limits, count channels once, and exclude reserves/repayments',()=>{
 const s=sample();s.transactions=[{type:'expense',amount:10,date:day,category:'Продукты',method:'cash',channel:'delivery'},{type:'expense',amount:20,date:day,category:'Красота',method:'debt',channel:'marketplace'},{type:'debt_payment',amount:15,date:day,category:'Красота'},{type:'reserve',amount:200,date:day},{type:'expense',amount:100,date:'2026-11-01',category:'Продукты'}];const sums=F.categoryActual(s,'2026-10',P.categories,day);assert.equal(sums['Продукты'],10);assert.equal(sums['Красота'],20);assert.equal(sums['Здоровье'],0);
});
test('home shows current free cash and only factual categories in a closed disclosure, no forecast warnings',()=>{
 const h=screen(fund(sample()));h.run('render()');const html=h.el('main').innerHTML;assert.ok(html.includes('Свободно сейчас'));assert.ok(html.includes('36 290')||html.includes('36 290'));assert.ok(html.includes('<details class="card" id="actual-categories" >'));assert.ok(!html.includes('Бюджет расходов требует'));assert.ok(!html.includes('Не подтверждено'));assert.ok(!html.includes('В плане не хватает'));assert.ok(!html.includes('Прогноз 30'));assert.equal(h.el('header-title').textContent,'My Money');assert.equal(h.writes(),0);
});
test('closed payment calendar is one subdued clickable row with actual sum and no extra captions/buttons',()=>{
 const h=screen(put(sample()));const html=h.run('renderPaymentCalendar()'),row=html.match(/<button class="settled-payment"[\s\S]*?<\/button>/)[0];assert.ok(row.includes('<s>Synthetic payment</s>'));assert.ok(row.includes('<s class="number">15'));assert.ok(!row.includes('Внесено'));assert.ok(!row.includes('Осталось'));assert.ok(!row.includes('Оплачено'));assert.ok(row.includes('closed-payment'));
});
test('history separates savings contributions from payment reserves and uses compact month arrows',()=>{
 const s=sample();s.transactions=[{id:'a',type:'reserve',amount:100,date:day},{id:'b',type:'reserve',amount:200,date:day,fundingKey:'bill|'+day}];const h=screen(s);h.run('monthFilter="2026-10"');const html=h.run('renderTransactions()');assert.ok(html.includes('month-prev'));assert.ok(html.includes('month-next'));assert.ok(html.includes('Накопления на цели'));assert.ok(html.includes('Создано резервов за месяц'));assert.ok(html.includes('Расходы'));assert.ok(!html.includes('Потребление'));
});
test('v0.3 partial records remain byte-identical at load; new optional closure data round-trips in JSON',()=>{
 const s=sample();s.transactions=[{id:'old',type:'expense',method:'cash',amount:6100,date:day,obligationId:'bill',forDue:day,custom:'keep'}];const h=screen(s);h.run('render();showClosedPayment("bill|2026-10-21")');assert.equal(h.writes(),0);assert.deepEqual(h.data(),s);
 const closed=F.setOccurrenceClosed(s,'bill',day,true,day),out=screen(closed).export(),restored=JSON.parse(out);assert.deepEqual(restored,closed);assert.equal(F.schedule(restored,day)[0].status,'paid');assert.equal(F.reserves(restored,day).total,F.reserves(closed,day).total);assert.equal(restored.version,1);
});
test('paid dates cannot be charged again and empty unpaid dates cannot be closed as a payment',()=>{
 const s=sample(),closed=put(s);assert.throws(()=>put(closed,{newId:'second',commandId:'second'}),/уже оплачен/);assert.throws(()=>F.setOccurrenceClosed(s,'bill',day,true,day),/Сначала внеси/);
});
test('editing any part of a manually closed multi-part payment keeps the occurrence selectable',()=>{
 let s=sample();s.obligations[0].amount=10000;s.transactions=[{id:'p1',type:'expense',method:'cash',amount:2000,date:day,obligationId:'bill',forDue:day},{id:'p2',type:'expense',method:'cash',amount:4000,date:day,obligationId:'bill',forDue:day}];s=F.setOccurrenceClosed(s,'bill',day,true,day);const h=screen(s);h.ctx.existing=s.transactions[0];h.run('showUnifiedPayment({existing})');assert.ok(h.el('modal-body').innerHTML.includes('value="bill|2026-10-21" selected'));
});
test('clearing the month selector keeps a valid current period instead of corrupting arrows',()=>{
 const h=screen(sample());h.run('monthFilter="2026-10"');const target={id:'month-filter',value:''};for(const handler of h.events.change)handler({target});assert.equal(h.run('monthFilter'),'2026-10');assert.equal(target.value,'2026-10');
});
test('active reserve history uses linked purpose, shows its remainder, and never writes financial records',()=>{
 const s=fund(sample()),before=JSON.stringify(s);s.obligations[0].name='Операция <тест>';
 const h=screen(s),details=JSON.parse(h.run('JSON.stringify(historyReserveDetails(state,today()))'));
 assert.deepEqual(details.reserve,{used:0,released:0,remaining:20000});
 const html=h.run('monthFilter="2026-10";renderTransactions()');assert.ok(html.includes('Резерв: Операция &lt;тест&gt;'));assert.ok(html.includes('Осталось в резерве '+h.run('fmt(20000)')));
 assert.equal(h.writes(),0);assert.deepEqual(h.data(),s);assert.equal(F.cash(s,day),56290);assert.equal(F.freeNow(s,day),36290);assert.equal(JSON.parse(before).transactions.length,s.transactions.length);
});
test('partial payments are attributed FIFO across contributions without repeating used money',()=>{
 let s=sample();s=fund(s,10000);s=F.reserveFunding(s,{obligationId:'bill',forDue:day,amount:10000,newId:'reserve2'},day);
 s=put(s,{amount:6000,finalPayment:false});s=put(s,{newId:'pay2',commandId:'cmd2',amount:4000,finalPayment:false});
 const h=screen(s),details=JSON.parse(h.run('JSON.stringify(historyReserveDetails(state,today()))'));
 assert.deepEqual(details.reserve,{used:10000,released:0,remaining:0});assert.deepEqual(details.reserve2,{used:0,released:0,remaining:10000});
 assert.equal(Object.values(details).reduce((n,x)=>n+x.used,0),Object.values(F.reserves(s,day).used).reduce((a,b)=>a+b,0));
 assert.ok(h.run('txnRow(state.transactions.find(t=>t.id==="reserve2"),historyReserveDetails(state,today()).reserve2)').includes('Осталось в резерве '+h.run('fmt(10000)')));
});
test('closed reserve history splits use and release once, with one actual debit and no new records',()=>{
 const s=put(fund(sample())),before=JSON.stringify(s),h=screen(s);
 const details=JSON.parse(h.run('JSON.stringify(historyReserveDetails(state,today()))'));assert.deepEqual(details.reserve,{used:15000,released:5000,remaining:0});
 const html=h.run('renderTransactions()');assert.ok(html.includes('Использовано '+h.run('fmt(15000)')+' · Освобождено '+h.run('fmt(5000)')));
 assert.equal(JSON.stringify(h.data()),before);assert.equal(h.writes(),0);assert.equal(F.cash(h.data(),day),41290);assert.equal(F.freeNow(h.data(),day),41290);assert.equal(h.data().transactions.length,2);
});
test('several reserve contributions and final partial settlement conserve created, used and released totals',()=>{
 let s=fund(sample(),10000);s=put(s,{amount:5000,finalPayment:false});s=F.reserveFunding(s,{obligationId:'bill',forDue:day,amount:10000,newId:'reserve2'},day);s=put(s,{newId:'p2',commandId:'c2',amount:10000});
 const h=screen(s),details=JSON.parse(h.run('JSON.stringify(historyReserveDetails(state,today()))'));
 assert.deepEqual(details.reserve,{used:10000,released:0,remaining:0});assert.deepEqual(details.reserve2,{used:5000,released:5000,remaining:0});
 assert.equal(Object.values(details).reduce((n,x)=>n+x.used+x.released+x.remaining,0),20000);
});
test('monthly created reserve total is gross contributions, not net releases or current remainder',()=>{
 const s=sample();s.transactions=[{id:'prior',type:'reserve',fundingKey:'bill|'+day,date:'2026-09-30',amount:3000},{id:'current',type:'reserve',fundingKey:'bill|'+day,date:day,amount:10000},{id:'release',type:'release',fundingKey:'bill|'+day,date:day,amount:5000},{id:'savings',type:'reserve',date:day,amount:777},{id:'future',type:'reserve',fundingKey:'bill|'+day,date:'2026-11-01',amount:2000}];
 const h=screen(s),html=h.run('monthFilter="2026-10";renderTransactions()');assert.ok(html.includes('Создано резервов за месяц</div><b class="mid number">'+h.run('fmt(10000)')));assert.equal(F.reserves(s,day).pools['bill|'+day],8000);
 const details=JSON.parse(h.run('JSON.stringify(historyReserveDetails(state,today()))'));assert.deepEqual(details.prior,{used:0,released:3000,remaining:0});assert.deepEqual(details.current,{used:0,released:2000,remaining:8000});assert.equal(details.future,undefined);
});
test('history reserve details follow reopen, edit and delete using current financial derivations',()=>{
 let s=put(fund(sample()));s=F.setOccurrenceClosed(s,'bill',day,false,day);
 let h=screen(s);assert.deepEqual(JSON.parse(h.run('JSON.stringify(historyReserveDetails(state,today()).reserve)')),{used:15000,released:0,remaining:5000});
 s=put(s,{id:'pay',amount:12000,finalPayment:false});h=screen(s);assert.deepEqual(JSON.parse(h.run('JSON.stringify(historyReserveDetails(state,today()).reserve)')),{used:12000,released:0,remaining:8000});
 s=F.removePayment(s,'pay');h=screen(s);assert.deepEqual(JSON.parse(h.run('JSON.stringify(historyReserveDetails(state,today()).reserve)')),{used:0,released:0,remaining:20000});
});
test('reserve attribution isolates recurring dates, missing obligations and legacy metadata',()=>{
 const s=sample();s.obligations[0].frequency='monthly';s.transactions=[{id:'old',type:'reserve',date:day,amount:10,fundingKey:'missing|'+day,note:'Legacy reserve',custom:{keep:true}},{id:'first',type:'reserve',date:day,amount:100,fundingKey:'bill|'+day},{id:'next',type:'reserve',date:day,amount:200,fundingKey:'bill|2026-11-21'}];
 const paid=put(s,{amount:50}),h=screen(paid),before=JSON.stringify(paid);h.run('renderTransactions()');
 const details=JSON.parse(h.run('JSON.stringify(historyReserveDetails(state,today()))'));assert.deepEqual(details.first,{used:50,released:50,remaining:0});assert.deepEqual(details.next,{used:0,released:0,remaining:200});assert.deepEqual(details.old,{used:0,released:0,remaining:10});assert.equal(JSON.stringify(h.data()),before);assert.equal(h.writes(),0);
});
