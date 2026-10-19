const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const F=require('../finance.js'),P=require('../planner.js');
const day='2026-10-19';
function fixture(){return {version:1,settings:{startingBalance:2000,salary:2000,savingsTarget:0,foodLimit:0,taxiLimit:0},transactions:[],goals:[],wishes:[],debts:[{id:'card',name:'Synthetic card',balance:1000,kind:'card',minimumPayment:120}],obligations:[]}}
const bill=(extra={})=>({id:'o',name:'Synthetic scheduled payment',amount:100,firstDue:'2026-10-20',frequency:'monthly',type:'debt',debtId:'card',category:'Другое',...extra});
function pay(s,extra={}){return F.savePayment(s,{newId:'tx',commandId:'command',date:day,amount:150,debtId:'card',...extra})}
function ui(s){
 const raw=JSON.stringify(s),els=new Map(),listeners={};let writes=0,stored=null;
 const element=id=>{if(!els.has(id))els.set(id,{innerHTML:'',textContent:'',dataset:{},classList:{add(){},remove(){},toggle(){}},addEventListener(){},showModal(){},close(){}});return els.get(id)};
 const ctx=vm.createContext({structuredClone,console,Date,Math,Set,Map,JSON,Number,String,localStorage:{getItem:()=>raw,setItem:(key,value)=>{writes++;stored=value}},document:{getElementById:element,querySelectorAll:()=>[],addEventListener:(name,fn)=>(listeners[name]??=[]).push(fn)},navigator:{},location:{protocol:'file:'},setTimeout:()=>0,clearTimeout(){},confirm:()=>true});
 for(const file of ['finance.js','planner.js','planner-ui.js','assistant-ui.js','app.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx);
 vm.runInContext('today=()=>"2026-10-19"',ctx);
 return {ctx,element,listeners,writes:()=>writes,stored:()=>stored,run:code=>vm.runInContext(code,ctx),snapshot:()=>JSON.parse(vm.runInContext('JSON.stringify(state)',ctx))};
}
test('bank balance reconciles a single card payment without doubling existing interest',()=>{
 const s=fixture();s.transactions=[{id:'interest',type:'debt_interest',debtId:'card',amount:50,date:'2026-10-18'}];const original=JSON.stringify(s);
 const result=pay(s,{bankBalance:900});assert.equal(F.cash(result.state,day),1850);assert.equal(F.debt(result.state,'card',day).balance,900);assert.equal(F.debt(result.state,'card',day).needsReconciliation,false);assert.equal(F.debt(result.state,'card',day).progress,10);assert.equal(result.state.transactions.filter(t=>t.type==='debt_payment').length,1);assert.deepEqual(result.state.transactions[0],s.transactions[0]);assert.equal(JSON.stringify(s),original);
});
test('unreconciled card payment does not guess principal or interest',()=>{
 const s=fixture();const out=pay(s).state;assert.equal(F.cash(out,day),1850);assert.equal(F.debt(out,'card',day).balance,1000);assert.equal(F.debt(out,'card',day).needsReconciliation,true);assert.equal(F.debt(out,'card',day).progress,null);
 const h=ui(out);h.run('page="debts";render()');assert.ok(h.element('main').innerHTML.includes('Остаток требует сверки'));
});
test('legacy debt payments keep their calculation; new split payment remains interest-free',()=>{
 const s=fixture();s.transactions=[{id:'old',type:'debt_payment',date:'2026-10-18',debtId:'card',amount:100}];assert.equal(F.debt(s,'card',day).balance,900);
 s.debts[0].kind='split';const out=pay(s).state;assert.equal(F.debt(out,'card',day).balance,750);assert.equal(F.debt(out,'card',day).needsReconciliation,false);
});
test('extra payment motivation separates cash above minimum from confirmed debt reduction',()=>{
 const s=fixture(),h=ui(s);h.ctx.input={amount:150,date:day,debtId:'card',bankBalance:860};
 h.run('submitUnifiedPayment({dataset:{command:"fresh"}},{get:k=>input[k]??""})');const html=h.element('modal-body').innerHTML;
 assert.ok(html.includes('больше обязательного платежа'));assert.ok(html.includes('Это превышение платежа, а не подтверждённое уменьшение'));assert.ok(html.includes('Подтверждено уменьшение долга'));assert.equal(F.debt(h.snapshot(),'card',day).balance,860);assert.equal(F.cash(h.snapshot(),day),1850);
});
test('unsafe extra payment is recorded truthfully but never encouraged or funded from savings',()=>{
 const s=fixture();s.settings.startingBalance=180;s.transactions=[{id:'savings',type:'reserve',date:'2026-10-18',amount:50}];const h=ui(s);h.ctx.input={amount:150,date:day,debtId:'card'};
 h.run('submitUnifiedPayment({dataset:{command:"unsafe"}},{get:k=>input[k]??""})');const html=h.element('modal-body').innerHTML;
 assert.ok(html.includes('Не увеличивай досрочное погашение'));assert.ok(!html.includes('Ты внесла'));assert.equal(F.reserves(h.snapshot(),day).savings,50);assert.equal(F.cash(h.snapshot(),day),30);
});
test('calendar and card use same linked history payment, only one recurring date is covered',()=>{
 const s=fixture();s.obligations=[bill()];const out=pay(s,{obligationId:'o',forDue:'2026-10-20',amount:100}).state;
 const rows=F.schedule(out,'2026-11-20');assert.equal(rows[0].status,'paid');assert.equal(rows[1].status,'unpaid');assert.equal(out.transactions[0].obligationId,'o');assert.equal(out.transactions[0].forDue,'2026-10-20');assert.equal(F.cash(out,day),1900);
});
test('repeat submit is idempotent; reopening a covered date cannot charge it again',()=>{
 const s=fixture();s.obligations=[bill()];const input={obligationId:'o',forDue:'2026-10-20',amount:100};let out=pay(s,input).state;
 const repeat=pay(out,input);assert.equal(repeat.duplicate,true);assert.equal(repeat.state.transactions.length,1);
 assert.throws(()=>pay(out,{...input,newId:'another',commandId:'second'}),/уже оплачен/);assert.equal(F.cash(out,day),1900);
});
test('partial payments show amount left and forecast charges only the remaining amount',()=>{
 const s=fixture();s.obligations=[bill()];const a=pay(s,{obligationId:'o',forDue:'2026-10-20',amount:40}).state;
 const item=F.schedule(a,'2026-10-20')[0];assert.equal(item.status,'partial');assert.equal(item.paid,40);assert.equal(item.amount,60);
 assert.equal(P.forecast(a,day,2).events.find(e=>e.kind==='obligation').amount,-60);
 const b=pay(a,{newId:'second',commandId:'second',obligationId:'o',forDue:'2026-10-20',amount:60}).state;assert.equal(F.schedule(b,'2026-10-20')[0].status,'paid');assert.equal(F.cash(b,day),1900);
});
test('edit and delete replay cash, bank reconciliation and linked occurrence status',()=>{
 const s=fixture();s.obligations=[bill()];const a=pay(s,{obligationId:'o',forDue:'2026-10-20',amount:100,bankBalance:900}).state;
 const b=pay(a,{id:'tx',obligationId:'o',forDue:'2026-10-20',amount:40,bankBalance:950}).state;
 assert.equal(b.transactions.length,1);assert.equal(F.cash(b,day),1960);assert.equal(F.debt(b,'card',day).balance,950);assert.equal(F.schedule(b,'2026-10-20')[0].amount,60);
 const d=F.removePayment(b,'tx');assert.equal(F.cash(d,day),2000);assert.equal(F.debt(d,'card',day).balance,1000);assert.equal(F.schedule(d,'2026-10-20')[0].status,'unpaid');
});
test('bank snapshots replay chronologically, future snapshots do not affect today',()=>{
 let s=pay(fixture(),{bankBalance:900}).state;s=pay(s,{newId:'later',commandId:'later',date:'2026-10-21',bankBalance:800}).state;
 assert.equal(F.debt(s,'card',day).balance,900);assert.equal(F.debt(s,'card','2026-10-21').balance,800);
 s=F.removePayment(s,'tx');assert.equal(F.debt(s,'card','2026-10-21').balance,800);
});
test('matching amount/date never links separate payments; wrong card/date rejected',()=>{
 const s=fixture();s.obligations=[bill(),bill({id:'other'})];const a=pay(s,{amount:100}).state;assert.equal(a.transactions[0].obligationId,undefined);assert.equal(F.schedule(a,'2026-10-20').filter(o=>o.status==='unpaid').length,2);
 assert.throws(()=>pay(s,{obligationId:'o',forDue:'2026-10-21'}),/дату/);s.debts.push({id:'wrong',balance:100});assert.throws(()=>pay(s,{obligationId:'o',forDue:'2026-10-20',debtId:'wrong'}),/другой долг/);
});
test('existing scheduled debt without a linked card is still payable without changing its ID',()=>{
 const s=fixture();s.obligations=[bill({debtId:''})];const out=pay(s,{debtId:'',obligationId:'o',forDue:'2026-10-20',amount:100}).state;
 assert.equal(out.obligations[0].id,'o');assert.equal(F.cash(out,day),1900);assert.equal(F.schedule(out,'2026-10-20')[0].status,'paid');
});
test('large payment funding in two parts protects cash without two extra expenses',()=>{
 const s=fixture();s.settings.startingBalance=50000;s.settings.salary=0;s.obligations=[bill({amount:43000,type:'bill',debtId:'',firstDue:'2026-11-06',frequency:'once',category:'Здоровье'})];
 let out=F.setFundingPlan(s,'o','2026-11-06',[{id:'part1',date:'2026-10-20',amount:20000},{id:'part2',date:'2026-11-05',amount:23000}]);assert.equal(out.obligations.length,1);assert.equal(F.cash(out,day),50000);
 out=F.reserveFunding(out,{obligationId:'o',forDue:'2026-11-06',amount:20000,planId:'part1',newId:'r1'},'2026-10-20');assert.equal(F.cash(out,'2026-10-20'),50000);assert.equal(F.reserves(out,'2026-10-20').total,20000);assert.equal(F.funding(out,'o','2026-11-06','2026-10-20').unfunded,23000);
 out=F.reserveFunding(out,{obligationId:'o',forDue:'2026-11-06',amount:23000,planId:'part2',newId:'r2'},'2026-11-05');assert.equal(F.reserves(out,'2026-11-05').total,43000);
 out=pay(out,{date:'2026-11-06',amount:43000,debtId:'',obligationId:'o',forDue:'2026-11-06'}).state;assert.equal(F.cash(out,'2026-11-06'),7000);assert.equal(F.reserves(out,'2026-11-06').total,0);assert.equal(out.transactions.filter(t=>t.type==='expense').length,1);assert.equal(out.transactions.filter(t=>t.type==='reserve').length,2);
});
test('forecast planned financing is a reserve transfer, not additional card spending',()=>{
 const s=fixture();s.settings.startingBalance=50000;s.settings.salary=0;s.obligations=[bill({amount:43000,type:'bill',debtId:'',firstDue:'2026-11-06',frequency:'once',category:'Здоровье'})];
 const out=F.setFundingPlan(s,'o','2026-11-06',[{id:'p1',date:'2026-10-20',amount:20000},{id:'p2',date:'2026-11-05',amount:23000}]);const f=P.forecast(out,day,25);
 assert.equal(f.events.filter(e=>e.kind==='funding').length,2);assert.equal(f.events.find(e=>e.kind==='obligation').cash,7000);assert.equal(f.end,7000);assert.equal(f.minimum,7000);
});
test('funded payment editing/deleting restores its reserve and never consumes savings',()=>{
 let s=fixture();s.settings.startingBalance=1000;s.obligations=[bill({amount:400,type:'bill',debtId:'',frequency:'once'})];s.transactions=[{id:'safe',type:'reserve',date:day,amount:200}];
 s=F.reserveFunding(s,{obligationId:'o',forDue:'2026-10-20',amount:400,newId:'pool'},day);
 const paid=pay(s,{amount:400,debtId:'',obligationId:'o',forDue:'2026-10-20'}).state;assert.equal(F.reserves(paid,day).savings,200);assert.equal(F.reserves(paid,day).total,200);
 const edited=pay(paid,{id:'tx',amount:100,debtId:'',obligationId:'o',forDue:'2026-10-20'}).state;assert.equal(F.reserves(edited,day).pools['o|2026-10-20'],300);
 const removed=F.removePayment(paid,'tx');assert.equal(F.reserves(removed,day).pools['o|2026-10-20'],400);assert.equal(F.reserves(removed,day).savings,200);
});
test('funding cannot use protected savings or fund the same part twice',()=>{
 const s=fixture();s.settings.startingBalance=200;s.transactions=[{id:'safe',type:'reserve',date:day,amount:150}];s.obligations=[bill({amount:100,type:'bill',debtId:'',frequency:'once'})];
 assert.throws(()=>F.reserveFunding(s,{obligationId:'o',forDue:'2026-10-20',amount:100,newId:'reserve'},day),/накопления защищены/);
 const a=F.reserveFunding(s,{obligationId:'o',forDue:'2026-10-20',amount:30,newId:'r',planId:'p'},day);assert.throws(()=>F.reserveFunding(a,{obligationId:'o',forDue:'2026-10-20',amount:10,newId:'another',planId:'p'},day),/уже зарезервирована/);
});
test('funding plan rejects excessive amounts and post-payment financing dates',()=>{
 const s=fixture();s.obligations=[bill()];assert.throws(()=>F.setFundingPlan(s,'o','2026-10-20',[{id:'p',date:'2026-10-21',amount:20}]),/даты/);assert.throws(()=>F.setFundingPlan(s,'o','2026-10-20',[{id:'p',date:day,amount:101}]),/превышает/);
});
test('proposal is preliminary without history, uses known bills and changes limits only on acceptance',()=>{
 const s=fixture();s.settings.salary=1000;s.settings.savingsTarget=250;s.obligations=[bill({type:'bill',debtId:'',category:'Жильё',amount:300})];const raw=JSON.stringify(s),p=F.proposeBudget(s,day,P.categories);
 assert.equal(p.preliminary,true);assert.equal(p.limits['Жильё'],300);assert.equal(p.limits['Красота'],null);assert.ok(p.missing.includes('Красота'));assert.equal(JSON.stringify(s),raw);
 const out=F.acceptBudget(s,{...p.limits,'Красота':25},P.categories);assert.equal(out.settings.categoryBudgets['Красота'],25);assert.deepEqual(out.transactions,s.transactions);assert.deepEqual(out.obligations,s.obligations);assert.equal(out.settings.savingsTarget,250);
});
test('budget proposal uses observed history without counting channels twice and reduces optional categories',()=>{
 const s=fixture();s.settings.salary=1000;s.settings.savingsTarget=200;s.transactions=[{type:'expense',category:'Продукты',channel:'delivery',date:'2026-08-10',amount:300},{type:'expense',category:'Продукты',channel:'marketplace',date:'2026-09-10',amount:300},{type:'expense',category:'Красота',channel:'marketplace',date:'2026-08-15',amount:1000},{type:'expense',category:'Красота',channel:'marketplace',date:'2026-09-15',amount:1000}];
 const p=F.proposeBudget(s,day,P.categories);assert.equal(p.observedMonths,2);assert.equal(p.limits['Продукты'],300);assert.equal(p.limits['Красота'],500);assert.equal(p.savings,200);assert.ok(!Object.hasOwn(p.limits,'Доставка'));
});
test('budget cannot hide required monthly deficit or promise unaffordable savings',()=>{
 const s=fixture();s.settings.salary=100;s.settings.savingsTarget=250;s.obligations=[bill({amount:200,type:'bill',debtId:'',category:'Жильё'})];const p=F.proposeBudget(s,day,P.categories);assert.equal(p.deficit,100);assert.equal(p.savings,0);assert.equal(p.limits['Жильё'],200);
});
test('all simplified views preserve old v0.3 JSON byte-for-byte on load and include mobile navigation',()=>{
 const s=fixture();s.transactions=[{id:'legacy',type:'expense',method:'cash',date:day,amount:5,custom:'keep'}];s.goals=[{id:'goal',name:'Synthetic goal',target:50}];s.obligations=[bill({frequency:'weekly',custom:'keep'})];s.settings.custom={keep:true};const raw=JSON.stringify(s),h=ui(s);
 h.run('render();showUnifiedPayment({debtId:"card"});showFunding("o|2026-10-20");showBudgetProposal();showAllocation();renderMyBudget();renderDebtScreen()');assert.equal(h.writes(),0);assert.equal(JSON.stringify(h.snapshot()),raw);
 const home=h.run('renderAssistantHome()');assert.ok(!home.includes('class="budgetline"'));assert.ok(home.includes('Мой бюджет'));assert.ok(home.includes('Ближайшие платежи'));assert.ok(home.includes('<details'));assert.ok(home.includes('Проверить покупку'));
 const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),css=fs.readFileSync(path.join(__dirname,'..','style.css'),'utf8');assert.ok(html.includes('width=device-width'));assert.ok(html.includes('Запланированные<br>платежи'));assert.ok(html.includes('История<br>операций'));assert.ok(css.includes('safe-area-inset-bottom'));assert.ok(css.includes('@media(max-width:390px)'));assert.ok(css.includes('min-width:0'));
});
test('new payment persistence failure rolls back all changes and leaves records untouched',()=>{
 const s=fixture(),h=ui(s);h.run('localStorage.setItem=()=>{throw Error("full")};');h.ctx.input={amount:100,date:day,debtId:'card'};h.run('submitUnifiedPayment({dataset:{command:"fail"}},{get:k=>input[k]??""})');assert.deepEqual(h.snapshot(),s);
});
test('editable allocation rejects unsafe extra debt payments and excess total without altering savings',()=>{
 const s=fixture();s.settings.startingBalance=100;s.transactions=[{id:'saved',type:'reserve',date:day,amount:50}];s.obligations=[bill({amount:100})];const h=ui(s);h.ctx.input={mandatory:0,living:0,futureReserve:0,savings:0,extraDebt:50,free:0};h.run('submitAllocation({get:k=>input[k]})');assert.equal(h.writes(),0);assert.ok(h.element('toast').textContent.includes('небезопасен'));
 h.ctx.input.extraDebt=200;h.run('submitAllocation({get:k=>input[k]})');assert.equal(h.writes(),0);assert.equal(F.reserves(h.snapshot(),day).savings,50);
});
test('first savings and regular saving messages describe recorded achievements, not financial guarantees',()=>{
 const s=fixture();s.settings.savingsTarget=100;s.settings.allocationProposal={date:day,savings:50};const h=ui(s);h.run('confirmAllocation()');assert.equal(F.reserves(h.snapshot(),day).savings,50);assert.ok(h.element('toast').textContent.includes('Пополнения были в 1 месяцах'));h.run('confirmAllocation()');assert.equal(h.snapshot().transactions.length,1);
});
test('no extra-payment praise when mandatory minimum is unknown',()=>{
 const s=fixture();delete s.debts[0].minimumPayment;const h=ui(s);h.ctx.input={amount:150,date:day,debtId:'card'};h.run('submitUnifiedPayment({dataset:{command:"unknown-min"}},{get:k=>input[k]??""})');assert.ok(!h.element('modal-body').innerHTML.includes('Ты внесла'));assert.ok(h.element('modal-body').innerHTML.includes('минимум не задан'));
});
test('financing plan accounts for already reserved money instead of promising overfunding',()=>{
 let s=fixture();s.obligations=[bill({type:'bill',debtId:'',amount:100,frequency:'once'})];s=F.reserveFunding(s,{obligationId:'o',forDue:'2026-10-20',amount:40,newId:'reserve'},day);
 assert.throws(()=>F.setFundingPlan(s,'o','2026-10-20',[{id:'p',date:'2026-10-20',amount:100}],day),/превышает/);
 const out=F.setFundingPlan(s,'o','2026-10-20',[{id:'p',date:'2026-10-20',amount:60}],day);assert.equal(out.obligations[0].fundingPlan[0].amount,60);
});
test('saving-plan achievements use explicit agreed plans, exclude funding and account for releases',()=>{
 const s=fixture();s.settings.savingsPlans={'2026-09':{target:100},'2026-10':{target:100}};s.transactions=[{type:'reserve',date:'2026-09-01',amount:100},{type:'reserve',date:day,amount:120},{type:'release',date:day,amount:30},{type:'reserve',date:day,amount:100,fundingKey:'other|2026-11-01'}];
 const a=F.savingsAchievements(s,day);assert.equal(a.completed,1);assert.equal(a.months,2);assert.equal(a.total,190);
});
test('accepting edited limits leaves separate forecasts and all old fields unchanged',()=>{
 const s=fixture();s.settings.categoryForecasts={'Продукты':50};s.settings.categoryBudgets={'Historic custom category':77};const p=F.proposeBudget(s,day,P.categories),out=F.acceptBudget(s,p.limits,P.categories);
 assert.deepEqual(out.settings.categoryForecasts,{'Продукты':50});assert.equal(out.settings.categoryBudgets['Historic custom category'],77);assert.equal(out.version,1);assert.deepEqual(out.debts,s.debts);
});
test('PWA assistant assets share one cache and update never accesses financial storage',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8');assert.ok(source.includes('./finance.js'));assert.ok(source.includes('./assistant-ui.js'));assert.ok(!source.includes('localStorage'));assert.ok(!source.includes('indexedDB'));assert.ok(!source.includes('skipWaiting'));
});
test('real payment and protected funding affect disposable budget without touching existing savings',()=>{
 const s=fixture();s.settings.salary=0;s.transactions=[{id:'saved',type:'reserve',date:day,amount:200}];const before=P.forecast(s,day).available,out=pay(s,{amount:150}).state;
 assert.equal(P.forecast(out,day).available,before-150);assert.equal(F.reserves(out,day).savings,200);
});
test('editing a funded linked payment through shared UI updates status and keeps history IDs',()=>{
 let s=fixture();s.obligations=[bill({type:'bill',debtId:'',amount:100,frequency:'once'})];s=F.reserveFunding(s,{obligationId:'o',forDue:'2026-10-20',amount:100,newId:'pool'},day);s=pay(s,{amount:100,debtId:'',obligationId:'o',forDue:'2026-10-20'}).state;
 const h=ui(s);h.ctx.input={amount:40,date:day,debtId:'',occurrence:'o|2026-10-20'};h.run('submitUnifiedPayment({dataset:{id:"tx",command:"command"}},{get:k=>input[k]??""})');
 assert.equal(h.snapshot().transactions.find(t=>t.id==='tx').amount,40);assert.equal(F.schedule(h.snapshot(),'2026-10-20')[0].status,'partial');assert.equal(F.reserves(h.snapshot(),day).pools['o|2026-10-20'],60);
 h.run('deleteItem("transaction","tx")');assert.equal(F.schedule(h.snapshot(),'2026-10-20')[0].status,'unpaid');assert.equal(F.reserves(h.snapshot(),day).pools['o|2026-10-20'],100);
});
test('editing later unchecked payment preserves earlier snapshot and explicit interest without duplication',()=>{
 let s=pay(fixture(),{bankBalance:900}).state;s.transactions.push({id:'fee',type:'debt_interest',date:'2026-10-20',amount:10,debtId:'card'});s=pay(s,{newId:'later',commandId:'later',date:'2026-10-21',amount:100}).state;
 assert.equal(F.debt(s,'card','2026-10-21').balance,910);assert.equal(F.debt(s,'card','2026-10-21').needsReconciliation,true);
 s=pay(s,{id:'later',date:'2026-10-21',amount:100,bankBalance:820}).state;assert.equal(F.debt(s,'card','2026-10-21').balance,820);assert.equal(s.transactions.filter(t=>t.type==='debt_interest').length,1);
});
test('fully funded future payment does not reduce freely allocatable cash twice',()=>{
 let s=fixture();s.settings.salary=0;s.obligations=[bill({amount:500,type:'bill',debtId:'',frequency:'once'})];s=F.reserveFunding(s,{obligationId:'o',forDue:'2026-10-20',amount:500,newId:'reserve'},day);
 const f=P.forecast(s,day,3),a=P.allocation(s,day);assert.equal(f.initialFree,1500);assert.equal(f.end,1500);assert.equal(a.mandatoryRequired,0);assert.equal(a.funds,1500);
});
test('agreed realistic monthly savings target replaces only this month forecast target without changing global goal',()=>{
 let s=fixture();s.settings.startingBalance=1000;s.settings.salary=0;s.settings.savingsTarget=250;s.transactions=[{id:'saved',type:'reserve',date:day,amount:100}];s.settings.savingsPlans={'2026-10':{target:150}};
 assert.equal(P.forecast(s,day).savingsRemaining,50);assert.equal(P.forecast(s,day).available,850);s.transactions.push({id:'next',type:'reserve',date:day,amount:50});assert.equal(P.forecast(s,day).available,850);assert.equal(s.settings.savingsTarget,250);
});
test('failure to persist deletion of a linked payment keeps the original history and coverage',()=>{
 let s=fixture();s.obligations=[bill()];s=pay(s,{obligationId:'o',forDue:'2026-10-20',amount:100,bankBalance:900}).state;
 const h=ui(s);h.run('localStorage.setItem=()=>{throw Error("full")};deleteItem("transaction","tx")');assert.deepEqual(h.snapshot(),s);assert.equal(F.schedule(h.snapshot(),'2026-10-20')[0].status,'paid');
});
test('salary without history produces unknown categories, not recommended zero budgets or safe spending',()=>{
 const s=fixture();s.settings.salary=240000;s.settings.savingsTarget=25000;const p=F.proposeBudget(s,day,P.categories);
 assert.equal(p.limits['Продукты'],null);assert.equal(p.limits['Здоровье'],null);assert.equal(p.complete,false);assert.equal(p.extraDebt,0);assert.ok(p.missing.length>0);assert.equal(JSON.stringify(s),JSON.stringify(fixture()).replace('"salary":2000','"salary":240000').replace('"savingsTarget":0','"savingsTarget":25000'));
});
test('setup asks unknown spending only and preserves prefilled settings and recurring bills',()=>{
 const s=fixture();s.settings.foodLimit=30000;s.obligations=[bill({type:'bill',debtId:'',category:'Жильё',amount:50000})];const k=F.budgetKnowledge(s,day,P.categories);assert.ok(!k.missing.includes('Продукты'));assert.ok(!k.missing.includes('Жильё'));assert.ok(k.missing.includes('Здоровье'));
 const h=ui(s);h.run('showBudgetProposal()');const html=h.element('modal-body').innerHTML;assert.ok(html.includes('Укажи ориентиры только для неизвестных'));assert.ok(html.includes('initial-4'));assert.ok(!html.includes('name="initial-1"'));assert.ok(!html.includes('name="initial-0"'));assert.ok(html.includes('<details>'));assert.equal(h.writes(),0);
});
test('primary setup drafts yield a useful nonzero preliminary budget only after user estimates',()=>{
 const s=fixture();s.settings.salary=240000;s.settings.savingsTarget=25000;s.obligations=[bill({type:'bill',debtId:'',category:'Жильё',amount:50000})];const draft={'Продукты':{amount:30000,essential:true},'Транспорт':{amount:10000,essential:true},'Здоровье':{amount:5000,essential:true},'Кафе и рестораны':{amount:8000,essential:false},'Красота':{amount:7000,essential:false},'Другое':{amount:5000,essential:true}};
 const p=F.proposeBudget(s,day,P.categories,draft);assert.equal(p.limits['Продукты'],30000);assert.equal(p.limits['Жильё'],50000);assert.equal(p.limits['Здоровье'],5000);assert.equal(p.savings,25000);assert.equal(p.complete,false);assert.equal(s.settings.budgetEstimates,undefined);
 const out=F.acceptBudget(s,p.limits,P.categories,draft);assert.equal(out.settings.budgetEstimates['Здоровье'].amount,5000);assert.deepEqual(out.transactions,s.transactions);assert.deepEqual(out.debts,s.debts);assert.deepEqual(out.obligations,s.obligations);
});
test('one-time medical payment appears in its month only, never as permanent health budget',()=>{
 const s=fixture();s.settings.salary=240000;s.settings.savingsTarget=25000;s.settings.categoryBudgets={'Здоровье':5000};s.obligations=[bill({id:'medical',type:'bill',debtId:'',category:'Здоровье',amount:43000,firstDue:'2026-11-06',frequency:'once'})];
 const nov=F.proposeBudget(s,'2026-11-01',P.categories),dec=F.proposeBudget(s,'2026-12-01',P.categories);assert.equal(nov.oneOffTotal,43000);assert.equal(nov.limits['Здоровье'],5000);assert.equal(nov.monthlyLimits['Здоровье'],48000);assert.equal(dec.oneOffTotal,0);assert.equal(dec.limits['Здоровье'],5000);
 const out=F.acceptBudget(s,nov.limits,P.categories);assert.equal(out.settings.categoryBudgets['Здоровье'],5000);assert.equal(out.obligations.length,1);
});
test('one-time medical payment is forecast once in addition to regular health spending',()=>{
 const s=fixture();s.settings.startingBalance=100000;s.settings.salary=0;s.settings.categoryBudgets={'Здоровье':5000};s.obligations=[bill({type:'bill',debtId:'',category:'Здоровье',amount:43000,firstDue:'2026-11-06',frequency:'once'})];
 const f=P.forecast(s,'2026-11-01',30);assert.equal(f.events.filter(e=>e.kind==='obligation').length,1);assert.equal(f.end,52000);const row=P.budgetSummary(s,'2026-11','2026-11-01')[4];assert.equal(row.limit,48000);assert.equal(row.regularLimit,5000);assert.equal(row.oneOff,43000);
});
test('paid one-off bill is excluded from recurring history without hiding the real expense',()=>{
 let s=fixture();s.settings.startingBalance=100000;s.settings.salary=0;s.settings.categoryBudgets={'Здоровье':5000};s.obligations=[bill({type:'bill',debtId:'',category:'Здоровье',amount:43000,firstDue:'2026-11-06',frequency:'once'})];s=pay(s,{date:'2026-11-06',amount:43000,debtId:'',obligationId:'o',forDue:'2026-11-06'}).state;
 assert.equal(P.forecast(s,'2026-11-07',24).end,52000);assert.equal(F.proposeBudget(s,'2026-12-01',P.categories).limits['Здоровье'],5000);assert.equal(P.budgetSummary(s,'2026-11','2026-11-07')[4].actual,43000);assert.equal(F.cash(s,'2026-11-07'),57000);
 const b=P.purchaseContext(s,'2026-11-07',{category:'Здоровье',amount:1000}).budget;assert.equal(b.overage,0);
});
test('single unclassified historical expense is not extrapolated into a recurring monthly estimate',()=>{
 const s=fixture();s.transactions=[{type:'expense',category:'Здоровье',method:'cash',date:'2026-09-01',amount:43000}];const p=F.proposeBudget(s,day,P.categories);assert.equal(p.limits['Здоровье'],null);assert.ok(p.missing.includes('Здоровье'));
});
test('necessary user estimates are preserved even when savings must fall or deficit remains',()=>{
 const s=fixture();s.settings.salary=100000;s.settings.savingsTarget=25000;s.obligations=[bill({type:'bill',debtId:'',category:'Жильё',amount:50000})];let draft={'Продукты':{amount:40000,essential:true},'Транспорт':{amount:5000,essential:true}};
 let p=F.proposeBudget(s,day,P.categories,draft);assert.equal(p.savings,5000);assert.equal(p.limits['Продукты'],40000);assert.equal(p.limits['Транспорт'],5000);
 draft['Здоровье']={amount:20000,essential:true};p=F.proposeBudget(s,day,P.categories,draft);assert.equal(p.savings,0);assert.equal(p.deficit,15000);assert.equal(p.limits['Здоровье'],20000);assert.equal(s.settings.savingsTarget,25000);
});
test('unknown values stay absent on acceptance; explicit user zero is confirmed and remembered',()=>{
 const s=fixture();s.settings.categoryBudgets={'Красота':0};const p=F.proposeBudget(s,day,P.categories);assert.ok(p.missing.includes('Красота'));
 const out=F.acceptBudget(s,p.limits,P.categories);assert.ok(!Object.hasOwn(out.settings.categoryBudgets,'Продукты'));assert.equal(out.settings.categoryBudgets['Красота'],0);assert.ok(F.budgetKnowledge(out,day,P.categories).missing.includes('Красота'));
 const yes=F.acceptBudget(s,{'Красота':0},P.categories);assert.ok(!F.budgetKnowledge(yes,day,P.categories).missing.includes('Красота'));
});
test('incomplete budget hides safe-spending claims on home and purchase check',()=>{
 const s=fixture();s.settings.startingBalance=500000;s.settings.salary=240000;const h=ui(s);h.run('render();smartPurchaseResult({get:k=>({amount:10,category:"Красота",urgency:"canwait",delivery:"no"})[k]})');
 assert.ok(h.element('main').innerHTML.includes('Не подтверждено'));assert.ok(h.element('purchase-result').innerHTML.includes('безопасность покупки не подтверждена'));assert.ok(!h.element('purchase-result').innerHTML.includes('✓ Покупка укладывается'));assert.equal(h.writes(),0);
});
test('compact proposal starts with totals and has collapsed categories rather than an open zero form',()=>{
 const h=ui(fixture());h.run('showBudgetProposal({},true)');const html=h.element('modal-body').innerHTML;assert.ok(html.indexOf('Предложено в накопления')<html.indexOf('proposal-0'));assert.ok(html.includes('<details><summary>Раскрыть и изменить регулярные лимиты'));assert.ok(!html.includes('<details open>'));assert.ok(html.includes('это не безопасная сумма для покупок'));assert.equal(h.writes(),0);
});
test('cancelling onboarding or preview never changes existing records, goals, settings or loans',()=>{
 const s=fixture();s.transactions=[{id:'old',type:'expense',date:day,amount:5,method:'cash',category:'Красота'}];s.goals=[{id:'goal',name:'Synthetic',target:100}];s.obligations=[bill()];const h=ui(s);h.run('showBudgetSetup();showBudgetProposal({"Здоровье":{amount:5000,essential:true}},true);modalClose()');assert.deepEqual(h.snapshot(),s);assert.equal(h.writes(),0);
});
test('setup records explicit zero and essential choices in a draft without saving until acceptance',()=>{
 const s=fixture();const h=ui(s);h.ctx.answers={'initial-1':'30000','essential-1':'on','initial-3':'10000','essential-3':'on','initial-4':'0','essential-4':'on','no-other':'on'};
 const draft=h.run('captureBudgetSetup({get:k=>answers[k]??null})');assert.equal(draft['Продукты'].amount,30000);assert.equal(draft['Продукты'].essential,true);assert.equal(draft['Здоровье'].amount,0);assert.equal(draft['Здоровье'].essential,true);assert.ok(!Object.hasOwn(draft,'Красота'));assert.equal(h.writes(),0);assert.deepEqual(h.snapshot(),s);
 const out=F.acceptBudget(s,F.proposeBudget(s,day,P.categories,draft).limits,P.categories,draft);assert.equal(out.settings.budgetEstimates['Продукты'].amount,30000);assert.ok(!F.budgetKnowledge(out,day,P.categories).missing.includes('Здоровье'));
});
test('a fully answered preliminary budget still distinguishes monthly planning from spendable cash',()=>{
 const s=fixture();s.settings.salary=240000;s.settings.startingBalance=500;const draft=Object.fromEntries(P.categories.map(cat=>[cat,{amount:0,essential:false}]));draft['Продукты']={amount:30000,essential:true};
 const p=F.proposeBudget(s,day,P.categories,draft);assert.equal(p.preliminary,true);assert.equal(p.complete,true);assert.equal(p.missing.length,0);const accepted=F.acceptBudget(s,p.limits,P.categories,draft);const f=P.forecast(accepted,day);assert.equal(f.budgetIncomplete,false);assert.ok(f.available<=500);assert.equal(F.cash(accepted,day),500);
});
