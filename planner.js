/* My Money 0.3: pure calculations; never writes user data. All money in kopecks. */
(function(root){
'use strict';
const F=root.MoneyFinance||(typeof require==='function'?require('./finance.js'):null);
const cents=n=>Math.round((Number(n)||0)*100), rub=n=>n/100;
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const date=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d,12)};
const add=(s,n)=>{const d=date(s);d.setDate(d.getDate()+n);return iso(d)};
const shift=(s,n)=>{const d=date(s),t=new Date(d.getFullYear(),d.getMonth()+n,1,12);t.setDate(Math.min(d.getDate(),new Date(t.getFullYear(),t.getMonth()+1,0).getDate()));return iso(t)};
function paydays(from,to){const d=date(from),out=[];for(let m=-1;m<=4;m++){for(const day of [5,20]){const p=new Date(d.getFullYear(),d.getMonth()+m,day,12);if(p.getDay()===0)p.setDate(p.getDate()-2);else if(p.getDay()===6)p.setDate(p.getDate()-1);const s=iso(p);if(s>from&&s<=to)out.push(s)}}return out.sort()}
function effect(t){return t.type==='income'?cents(t.amount):t.type==='debt_payment'||t.type==='expense'&&t.method==='cash'?-cents(t.amount):0}
function reserve(t){return t.type==='reserve'?cents(t.amount):t.type==='release'?-cents(t.amount):0}
function taxi(t){return t.category==='Транспорт'&&(t.channel==='taxi'||/такси|яндекс go|yandex go/i.test(t.merchant||''))}
const categories=['Жильё','Продукты','Кафе и рестораны','Транспорт','Здоровье','Спорт','Красота','Одежда и обувь','Дом и быт','Подписки и связь','Образование','Подарки','Развлечения','Путешествия','Другое'];
const nonnegative=n=>Math.max(0,cents(n));
function budgetConfig(settings,category){
 const explicit=Object.hasOwn(settings.categoryBudgets||{},category);
 const legacyTaxi=category==='Транспорт'&&!explicit;
 const limit=explicit?settings.categoryBudgets[category]:category==='Продукты'?settings.foodLimit:legacyTaxi?settings.taxiLimit:0;
 const custom=Object.hasOwn(settings.categoryForecasts||{},category);
 return {category,limit:nonnegative(limit),estimate:nonnegative(custom?settings.categoryForecasts[category]:limit),conservative:!custom,legacyTaxi,taxiOnly:legacyTaxi&&!custom};
}
function matches(item,config){return item.category===config.category&&(!config.taxiOnly||taxi(item))}
function budgetSummary(state,month,asOf){
 return categories.map(category=>{
  const c=budgetConfig(state.settings,category);
  const purchases=state.transactions.filter(t=>t.type==='expense'&&t.date.slice(0,7)===month&&(!asOf||t.date<=asOf)&&t.category===category);
  const actual=purchases.reduce((n,t)=>n+cents(t.amount),0),limit=c.legacyTaxi?0:c.limit;
  const taxiActual=purchases.filter(taxi).reduce((n,t)=>n+cents(t.amount),0);
  return {...c,limit:rub(limit),estimate:rub(c.estimate),actual:rub(actual),remaining:rub(limit-actual),percent:limit>0?actual/limit*100:null,legacyTaxiBudget:c.legacyTaxi?{limit:rub(c.limit),actual:rub(taxiActual),remaining:rub(c.limit-taxiActual),percent:c.limit>0?taxiActual/c.limit*100:null}:null};
 });
}
function occurrences(state,to){return F.schedule(state,to).filter(o=>o.status!=='paid')}
function forecast(state,from,days=60,purchase=0){
 const to=add(from,days-1),s=state.settings,tx=state.transactions;
 let cash=cents(s.startingBalance)+tx.filter(t=>t.date<=from).reduce((a,t)=>a+effect(t),0),saved=cents(F.reserves(state,from).total);
 cash-=cents(purchase);
 const pools=Object.fromEntries(Object.entries(F.reserves(state,from).pools).map(([k,v])=>[k,cents(v)]));
 const initialCash=cash,initialFree=cash-saved,events=[],endDate=date(to),monthEnd=iso(new Date(endDate.getFullYear(),endDate.getMonth()+1,0,12)),obs=occurrences(state,monthEnd);
 for(const o of obs.filter(o=>o.due<=to))events.push({date:o.due<from?from:o.due,name:o.name+(o.due<from?' (просрочено)':''),kind:'obligation',delta:-cents(o.amount),reserveDelta:0,consumePool:F.key(o.id,o.due),order:0});
 for(const t of tx.filter(t=>t.date>from&&t.date<=to))if(effect(t)||reserve(t))events.push({date:t.date,name:t.note||'Внесённая будущая операция',kind:'recorded',delta:effect(t),reserveDelta:reserve(t),poolKey:t.fundingKey,poolDelta:t.fundingKey?reserve(t):0,consumePool:t.useFunding&&t.obligationId?F.key(t.obligationId,t.forDue):null,order:effect(t)>0?3:1});
 for(const o of state.obligations)for(const p of o.fundingPlan||[]){
  if(p.date>from&&p.date<=to&&!tx.some(t=>t.fundingPlanId===p.id)&&occurrences(state,p.forDue).some(x=>x.id===o.id&&x.due===p.forDue))
   events.push({date:p.date,name:`План резерва: ${o.name} (не расход)`,kind:'funding',delta:0,reserveDelta:cents(p.amount),poolKey:F.key(o.id,p.forDue),poolDelta:cents(p.amount),order:5});
 }
 // A manually scheduled income replaces the estimated salary on that date.
 for(const p of paydays(from,to))if(!tx.some(t=>t.type==='income'&&t.date===p))events.push({date:p,name:'Ожидаемая зарплата (только прогноз)',kind:'salary',delta:Number(p.slice(8))<=5?Math.floor(cents(s.salary)/2):cents(s.salary)-Math.floor(cents(s.salary)/2),reserveDelta:0,order:4});
 const monthly=new Map();
 for(let day=from;day<=to;day=add(day,1)){
  const month=day.slice(0,7);if(!monthly.has(month)){
   const start=month===from.slice(0,7)?from:month+'-01',d=date(day),last=iso(new Date(d.getFullYear(),d.getMonth()+1,0,12)),count=Math.round((date(last)-date(start))/86400000)+1;
   let total=0;
   for(const category of categories){
    const config=budgetConfig(s,category);
    const spent=tx.filter(t=>t.type==='expense'&&t.date.slice(0,7)===month&&matches(t,config)).reduce((a,t)=>a+cents(t.amount),0);
    const planned=obs.filter(o=>o.type!=='debt'&&o.due.slice(0,7)===month&&matches(o,config)).reduce((a,o)=>a+cents(o.amount),0);
    total+=Math.max(0,config.estimate-spent-planned);
   }
   total+=cents(s.otherDaily)*count;
   monthly.set(month,{total,count,index:0});
  }
  const pool=monthly.get(month),n=pool.index++,daily=Math.floor(pool.total*(n+1)/pool.count)-Math.floor(pool.total*n/pool.count);
  if(daily)events.push({date:day,name:'Расходы по бюджетам категорий и дневной настройке',kind:'living',delta:-daily,reserveDelta:0,order:2});
 }
 events.sort((a,b)=>a.date.localeCompare(b.date)||a.order-b.order);
 let minimum=initialFree,minDate=from,firstDeficitDate=initialFree<0?from:null;
 for(const e of events){if(e.consumePool){const use=Math.min(Math.max(0,pools[e.consumePool]||0),Math.max(0,-e.delta));e.reserveDelta-=use;pools[e.consumePool]=(pools[e.consumePool]||0)-use;}if(e.poolKey)pools[e.poolKey]=(pools[e.poolKey]||0)+(e.poolDelta||0);cash+=e.delta;saved+=e.reserveDelta;e.cash=rub(cash);e.free=rub(cash-saved);e.amount=rub(e.delta);if(cash-saved<0&&!firstDeficitDate)firstDeficitDate=e.date;if(cash-saved<minimum){minimum=cash-saved;minDate=e.date}}
 const target=Math.max(0,cents(s.savingsPlans?.[from.slice(0,7)]?.target??s.savingsTarget)-tx.filter(t=>!t.fundingKey&&t.date<=from&&t.date.slice(0,7)===from.slice(0,7)).reduce((a,t)=>a+reserve(t),0));
 return {from,to,events,firstDeficitDate,maxDeficitDate:minimum<0?minDate:null,conservative:categories.some(c=>{const b=budgetConfig(s,c);return b.conservative&&b.estimate>0}),initialCash:rub(initialCash),initialFree:rub(initialFree),minimum:rub(minimum),minDate,end:rub(cash-saved),savingsRemaining:rub(target),available:rub(Math.max(0,minimum-target)),missingBasics:categories.some(c=>budgetConfig(s,c).estimate===0)};
}
function allocation(state,from){
 const f=forecast(state,from),next=paydays(from,add(from,40))[0];
 const required=(kind)=>-f.events.filter(e=>e.date<=next&&e.kind===kind&&e.amount<0).reduce((a,e)=>a+cents(e.amount)-Math.min(0,e.reserveDelta||0),0);
 const mandatory=required('obligation')+required('recorded')+f.events.filter(e=>e.kind==='funding'&&e.date<=next).reduce((n,e)=>n+e.reserveDelta,0),living=required('living');
 const funds=Math.max(0,cents(f.initialFree)),needs=mandatory+living,headroom=Math.max(0,cents(f.minimum));
 const futureReserve=Math.max(0,funds-needs-headroom),desired=cents(f.savingsRemaining);
 const savings=Math.min(desired,headroom,Math.max(0,funds-needs-futureReserve));
 let left=funds;const take=n=>{const v=Math.min(left,n);left-=v;return rub(v)};
 const mandatoryFunded=take(mandatory),livingFunded=take(living),futureFunded=take(futureReserve),savingsFunded=take(savings);
 return {funds:rub(funds),alreadyReserved:f.initialCash-f.initialFree,mandatoryRequired:rub(mandatory),mandatoryUncovered:rub(mandatory-cents(mandatoryFunded)),livingRequired:rub(living),livingUncovered:rub(living-cents(livingFunded)),mandatory:mandatoryFunded,living:livingFunded,futureReserve:futureFunded,savings:savingsFunded,unallocated:rub(left),desired:rub(desired),shortfall:rub(Math.max(0,-cents(f.minimum),needs-funds)),savingsGap:rub(Math.max(0,desired-savings)),next,forecast:f};
}
// Only explicitly marked grocery deliveries are counted; merchant names are not evidence.
function deliveryHistory(state,from){
 const orders=state.transactions.filter(t=>t.type==='expense'&&t.category==='Продукты'&&t.channel==='delivery'&&t.date<=from);
 const window=days=>{const rows=orders.filter(t=>t.date>=add(from,1-days));return {count:rows.length,total:rub(rows.reduce((n,t)=>n+cents(t.amount),0))}};
 return {days7:window(7),days30:window(30),emptyHistory:!state.transactions.some(t=>t.date<=from)};
}
function purchaseContext(state,from,input){
 const urgency=['need','canwait','impulse'].includes(input.urgency)?input.urgency:'canwait';
 const recommendations=[];
 if(urgency==='impulse')recommendations.push('Это импульсивная покупка: сделай паузу 48 часов перед решением.');
 if(input.delivery==='yes'&&input.category==='Продукты'&&urgency!=='need')recommendations.push('Перед необязательной доставкой проверь, есть ли дома продукты. Можно отложить заказ или объединить несколько покупок в один заказ.');
 if(urgency==='need')recommendations.push('Покупка отмечена как необходимая. Ниже показаны её финансовые последствия; решение остаётся за тобой, автоматического запрета нет.');
 else if(urgency==='canwait')recommendations.push('Покупку можно отложить: сравни её стоимость с доступной суммой и оставшимся бюджетом.');
 const config=budgetConfig(state.settings,input.category),item={category:input.category,merchant:input.merchant||''};
 const configured=Object.hasOwn(state.settings.categoryBudgets||{},input.category)||config.limit>0;
 const applicable=configured&&(!config.legacyTaxi||taxi(item)),budgetScope={...config,taxiOnly:config.legacyTaxi};
 const actual=state.transactions.filter(t=>t.type==='expense'&&t.date<=from&&t.date.slice(0,7)===from.slice(0,7)&&matches(t,budgetScope)).reduce((n,t)=>n+cents(t.amount),0);
 const after=actual+nonnegative(input.amount),over=applicable?Math.max(0,after-config.limit):0;
 return {urgency,recommendations,deliveries:deliveryHistory(state,from),budget:{configured:applicable,taxiOnly:config.legacyTaxi,limit:rub(config.limit),actual:rub(actual),after:rub(after),overage:rub(over),additionalOverage:rub(Math.max(0,over-Math.max(0,actual-config.limit)))}};
}
const api={forecast,allocation,paydays,occurrences,add,categories,budgetConfig,budgetSummary,deliveryHistory,purchaseContext};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MoneyPlanner=api;
})(globalThis);
