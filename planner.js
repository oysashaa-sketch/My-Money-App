/* My Money 0.2: pure calculations; never writes user data. All money in kopecks. */
(function(root){
'use strict';
const cents=n=>Math.round((Number(n)||0)*100), rub=n=>n/100;
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const date=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d,12)};
const add=(s,n)=>{const d=date(s);d.setDate(d.getDate()+n);return iso(d)};
const shift=(s,n)=>{const d=date(s),t=new Date(d.getFullYear(),d.getMonth()+n,1,12);t.setDate(Math.min(d.getDate(),new Date(t.getFullYear(),t.getMonth()+1,0).getDate()));return iso(t)};
function paydays(from,to){const d=date(from),out=[];for(let m=-1;m<=4;m++){for(const day of [5,20]){const p=new Date(d.getFullYear(),d.getMonth()+m,day,12);if(p.getDay()===0)p.setDate(p.getDate()-2);else if(p.getDay()===6)p.setDate(p.getDate()-1);const s=iso(p);if(s>from&&s<=to)out.push(s)}}return out.sort()}
function effect(t){return t.type==='income'?cents(t.amount):t.type==='debt_payment'||t.type==='expense'&&t.method==='cash'?-cents(t.amount):0}
function reserve(t){return t.type==='reserve'?cents(t.amount):t.type==='release'?-cents(t.amount):0}
function taxi(t){return t.category==='Транспорт'&&(t.channel==='taxi'||/такси|яндекс go|yandex go/i.test(t.merchant||''))}
function bucket(t){return t.category==='Продукты'?'foodLimit':taxi(t)?'taxiLimit':null}
function occurrences(state,to){
 const paid=new Set(state.transactions.filter(t=>t.obligationId&&t.forDue).map(t=>`${t.obligationId}|${t.forDue}`)),out=[];
 for(const o of state.obligations){if(!/^\d{4}-\d{2}-\d{2}$/.test(o.firstDue||''))continue;
  for(let i=0;;i++){if(o.count&&i>=o.count)break;let due=i===0?o.firstDue:o.frequency==='weekly'?add(o.firstDue,i*7):o.frequency==='biweekly'?add(o.firstDue,i*14):o.frequency==='monthly'?shift(o.firstDue,i):o.frequency==='bimonthly'?shift(o.firstDue,i*2):null;
   if(!due||due>to)break;if(!paid.has(`${o.id}|${due}`))out.push({...o,due});
  }
 }return out;
}
function forecast(state,from,days=60,purchase=0){
 const to=add(from,days-1),s=state.settings,tx=state.transactions;
 let cash=cents(s.startingBalance)+tx.filter(t=>t.date<=from).reduce((a,t)=>a+effect(t),0),saved=tx.filter(t=>t.date<=from).reduce((a,t)=>a+reserve(t),0);
 cash-=cents(purchase);
 const initialCash=cash,initialFree=cash-saved,events=[],obs=occurrences(state,to);
 for(const o of obs)events.push({date:o.due<from?from:o.due,name:o.name+(o.due<from?' (просрочено)':''),kind:'obligation',delta:-cents(o.amount),reserveDelta:0,order:0});
 for(const t of tx.filter(t=>t.date>from&&t.date<=to))if(effect(t)||reserve(t))events.push({date:t.date,name:t.note||'Внесённая будущая операция',kind:'recorded',delta:effect(t),reserveDelta:reserve(t),order:effect(t)>0?3:1});
 // A manually scheduled income replaces the estimated salary on that date.
 for(const p of paydays(from,to))if(!tx.some(t=>t.type==='income'&&t.date===p))events.push({date:p,name:'Ожидаемая зарплата (только прогноз)',kind:'salary',delta:Number(p.slice(8))<=5?Math.floor(cents(s.salary)/2):cents(s.salary)-Math.floor(cents(s.salary)/2),reserveDelta:0,order:4});
 const monthly=new Map();
 for(let day=from;day<=to;day=add(day,1)){
  const month=day.slice(0,7);if(!monthly.has(month)){
   const start=month===from.slice(0,7)?from:month+'-01',d=date(day),last=iso(new Date(d.getFullYear(),d.getMonth()+1,0,12)),count=Math.round((date(last)-date(start))/86400000)+1;
   let total=0;
   for(const key of ['foodLimit','taxiLimit']){
    const spent=tx.filter(t=>t.type==='expense'&&t.date.slice(0,7)===month&&bucket(t)===key).reduce((a,t)=>a+cents(t.amount),0);
    const planned=obs.filter(o=>o.type!=='debt'&&o.due.slice(0,7)===month&&bucket(o)===key).reduce((a,o)=>a+cents(o.amount),0);
    total+=Math.max(0,cents(s[key])-spent-planned);
   }
   total+=cents(s.otherDaily)*count;
   monthly.set(month,{total,count,index:0});
  }
  const pool=monthly.get(month),n=pool.index++,daily=Math.floor(pool.total*(n+1)/pool.count)-Math.floor(pool.total*n/pool.count);
  if(daily)events.push({date:day,name:'Продукты, такси и другие траты на жизнь',kind:'living',delta:-daily,reserveDelta:0,order:2});
 }
 events.sort((a,b)=>a.date.localeCompare(b.date)||a.order-b.order);
 let minimum=initialFree,minDate=from;
 for(const e of events){cash+=e.delta;saved+=e.reserveDelta;e.cash=rub(cash);e.free=rub(cash-saved);e.amount=rub(e.delta);if(cash-saved<minimum){minimum=cash-saved;minDate=e.date}}
 const target=Math.max(0,cents(s.savingsTarget)-tx.filter(t=>t.date<=from&&t.date.slice(0,7)===from.slice(0,7)).reduce((a,t)=>a+reserve(t),0));
 return {from,to,events,initialCash:rub(initialCash),initialFree:rub(initialFree),minimum:rub(minimum),minDate,end:rub(cash-saved),savingsRemaining:rub(target),available:rub(Math.max(0,minimum-target)),missingBasics:!(Number(s.foodLimit)>0)||!(Number(s.taxiLimit)>0)};
}
function allocation(state,from){
 const f=forecast(state,from),next=paydays(from,add(from,40))[0];
 const required=(kind)=>-f.events.filter(e=>e.date<=next&&e.kind===kind&&e.amount<0).reduce((a,e)=>a+cents(e.amount),0);
 const mandatory=required('obligation')+required('recorded'),living=required('living');
 const funds=Math.max(0,cents(f.initialFree)),needs=mandatory+living,headroom=Math.max(0,cents(f.minimum));
 const futureReserve=Math.max(0,funds-needs-headroom),desired=cents(f.savingsRemaining);
 const savings=Math.min(desired,headroom,Math.max(0,funds-needs-futureReserve));
 let left=funds;const take=n=>{const v=Math.min(left,n);left-=v;return rub(v)};
 return {funds:rub(funds),mandatory:take(mandatory),living:take(living),futureReserve:take(futureReserve),savings:take(savings),unallocated:rub(left),desired:rub(desired),shortfall:rub(Math.max(0,-cents(f.minimum),needs-funds)),savingsGap:rub(Math.max(0,desired-savings)),next,forecast:f};
}
const api={forecast,allocation,paydays,occurrences,add};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MoneyPlanner=api;
})(globalThis);
