/* Local financial records: pure derivations and explicit, atomic user commands. */
(function(root){
'use strict';
const c=n=>Math.round((Number(n)||0)*100),r=n=>n/100;
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const date=s=>{const [y,m,d]=String(s).split('-').map(Number);return new Date(y,m-1,d,12)};
const add=(s,n)=>{const d=date(s);d.setDate(d.getDate()+n);return iso(d)};
const shift=(s,n)=>{const d=date(s),t=new Date(d.getFullYear(),d.getMonth()+n,1,12);t.setDate(Math.min(d.getDate(),new Date(t.getFullYear(),t.getMonth()+1,0).getDate()));return iso(t)};
const key=(id,due)=>`${id}|${due}`;
const ordered=s=>s.transactions.map((t,i)=>({...t,_i:i})).sort((a,b)=>a.date.localeCompare(b.date)||(a.createdAt||0)-(b.createdAt||0)||a._i-b._i);
const isCash=t=>t.type==='debt_payment'||t.type==='expense'&&t.method==='cash';
function cash(s,asOf){return r(c(s.settings.startingBalance)+s.transactions.filter(t=>t.date<=asOf).reduce((a,t)=>a+(t.type==='income'?c(t.amount):isCash(t)?-c(t.amount):0),0))}
function kind(d){return d?.kind||(/сплит|split/i.test(d?.name||'')?'split':'card')}
function debt(s,id,asOf='9999-12-31'){
 const d=s.debts.find(d=>d.id===id);if(!d)return {balance:0,needsReconciliation:false,progress:null,reduction:0};
 let value=c(d.balance),needs=kind(d)==='card',lastConfirmed=null,reduction=0;
 for(const t of ordered(s).filter(t=>t.debtId===id&&t.date<=asOf)){
  if(t.type==='expense'&&t.method==='debt'||t.type==='debt_interest')value+=c(t.amount);
  if(t.type==='debt_payment'){
   if(t.paymentModel==='bank-v1'&&kind(d)==='card'){
    if(t.bankBalance!==undefined&&t.bankBalance!==null&&t.bankBalance!==''){
     // A bank snapshot replaces the calculated balance, including previously recorded interest.
     reduction=Math.max(0,value-c(t.bankBalance));value=c(t.bankBalance);needs=false;lastConfirmed=t.date;
    }else needs=true;
   }else {value-=c(t.amount);if(kind(d)==='card')needs=true;}
  }
 }
 const baseline=Math.max(0,c(d.balance));return {balance:r(Math.max(0,value)),needsReconciliation:needs,lastConfirmed,reduction:r(reduction),progress:!needs&&baseline>0?Math.max(0,Math.min(100,(baseline-value)/baseline*100)):kind(d)==='split'&&baseline>0?Math.max(0,Math.min(100,(baseline-value)/baseline*100)):null};
}
function schedule(s,until,asOf='9999-12-31'){
 const out=[];
 for(const o of s.obligations){if(!/^\d{4}-\d{2}-\d{2}$/.test(o.firstDue||''))continue;
  for(let i=0;;i++){
   if(o.count&&i>=o.count)break;
   const due=i===0?o.firstDue:o.frequency==='weekly'?add(o.firstDue,i*7):o.frequency==='biweekly'?add(o.firstDue,i*14):o.frequency==='monthly'?shift(o.firstDue,i):o.frequency==='bimonthly'?shift(o.firstDue,i*2):null;
   if(!due||due>until)break;
   const payments=s.transactions.filter(t=>t.obligationId===o.id&&t.forDue===due&&isCash(t)&&t.date<=asOf);
   const paid=payments.reduce((n,t)=>n+c(t.amount),0),closure=s.paymentClosures?.[key(o.id,due)],final=paid>0&&(closure&&(!closure.transactionId||payments.some(t=>t.id===closure.transactionId))?closure.closed===true&&closure.date<=asOf:payments.some(t=>t.finalPayment===true)),remaining=final?0:Math.max(0,c(o.amount)-paid);
   out.push({...o,due,occId:key(o.id,due),total:Number(o.amount),paid:r(paid),final,savings:final?r(Math.max(0,c(o.amount)-paid)):0,amount:r(remaining),status:remaining===0?'paid':paid>0?'partial':'unpaid'});
  }
 }return out.sort((a,b)=>a.due.localeCompare(b.due));
}
function reserves(s,asOf){
 let savings=0;const pools={},used={};
 for(const t of ordered(s).filter(t=>t.date<=asOf)){
  if(t.type==='reserve'||t.type==='release'){
   const delta=(t.type==='reserve'?1:-1)*c(t.amount);
   if(t.fundingKey)pools[t.fundingKey]=(pools[t.fundingKey]||0)+delta;else savings+=delta;
  }else if(isCash(t)&&t.useFunding&&t.obligationId&&t.forDue){
   const k=key(t.obligationId,t.forDue),use=Math.min(Math.max(0,pools[k]||0),c(t.amount));pools[k]=(pools[k]||0)-use;used[t.id]=r(use);
  }
 }
 for(const k of Object.keys(pools)){const [id,due]=k.split('|');const item=schedule(s,due,asOf).find(o=>o.id===id&&o.due===due);if(item?.status==='paid')pools[k]=0;}
 return {savings:r(savings),pools:Object.fromEntries(Object.entries(pools).map(([k,v])=>[k,r(Math.max(0,v))])),used,total:r(savings+Object.values(pools).reduce((n,v)=>n+Math.max(0,v),0))};
}
function funding(s,id,due,asOf){
 const o=s.obligations.find(o=>o.id===id);if(!o)throw Error('Запланированный платёж не найден');
 const item=schedule(s,due,asOf).find(o=>o.id===id&&o.due===due);if(!item)throw Error('Дата не входит в расписание');
 const reserved=reserves(s,asOf).pools[key(id,due)]||0;
 return {...item,reserved,unfunded:Math.max(0,r(c(item.amount)-c(reserved))),plan:(o.fundingPlan||[]).filter(p=>p.forDue===due)};
}
function savePayment(s,input){
 const next=structuredClone(s),existing=input.id?next.transactions.find(t=>t.id===input.id):null;
 if(input.id&&!existing)throw Error('Операция не найдена');
 if(!input.id&&input.commandId){const old=next.transactions.find(t=>t.commandId===input.commandId);if(old)return {state:next,transaction:old,duplicate:true};}
 const amount=Number(input.amount);if(!Number.isFinite(amount)||amount<=0||!/^\d{4}-\d{2}-\d{2}$/.test(input.date||''))throw Error('Укажи сумму и дату');
 const o=input.obligationId?next.obligations.find(o=>o.id===input.obligationId):null;
 if(input.obligationId&&!o)throw Error('Запланированный платёж не найден');
 const check=structuredClone(next);if(existing)check.transactions=check.transactions.filter(t=>t.id!==existing.id);
 let occurrence;
 if(o){occurrence=schedule(check,input.forDue).find(x=>x.id===o.id&&x.due===input.forDue);if(!occurrence)throw Error('Выбери дату из расписания');if(!existing&&occurrence.status==='paid')throw Error('Этот платёж уже оплачен');}
 const debtId=o?.debtId||input.debtId||'';
 if(o?.debtId&&input.debtId&&input.debtId!==o.debtId)throw Error('Выбран другой долг');
 const d=next.debts.find(d=>d.id===debtId);
 const type=o?.type==='debt'||!o&&debtId?'debt_payment':'expense';
 if(type==='debt_payment'&&!d&&!o)throw Error('Выбери кредитную карту или Сплит');
 const tx={...existing,id:existing?.id||input.newId,commandId:existing?.commandId||input.commandId,type,method:'cash',amount:r(c(amount)),date:input.date,debtId,category:o?.category||existing?.category||'Другое',note:input.note!==undefined?String(input.note):o?.name||'Платёж по долгу',createdAt:existing?.createdAt||input.createdAt||Date.now(),paymentModel:'bank-v1',useFunding:!!o};
 if(!tx.id)throw Error('Нет идентификатора операции');
 if(o){tx.obligationId=o.id;tx.forDue=input.forDue}else {delete tx.obligationId;delete tx.forDue;}
 if(input.bankBalance!==undefined&&input.bankBalance!==null&&input.bankBalance!==''){
  if(!d)throw Error('Для сверки выбери кредитную карту');const bank=Number(input.bankBalance);if(!Number.isFinite(bank)||bank<0)throw Error('Остаток банка должен быть неотрицательным');tx.bankBalance=r(c(bank));
 }else delete tx.bankBalance;
 if(input.finalPayment!==undefined&&o){tx.finalPayment=input.finalPayment===true;next.paymentClosures={...next.paymentClosures,[key(o.id,input.forDue)]:{closed:tx.finalPayment,date:tx.date,transactionId:tx.id}};}
 if(existing)next.transactions[next.transactions.findIndex(t=>t.id===existing.id)]=tx;else next.transactions.push(tx);
 return {state:next,transaction:tx,duplicate:false};
}
function setOccurrenceClosed(s,id,due,closed,asOf){
 const next=structuredClone(s),item=schedule(s,due,asOf).find(o=>o.id===id&&o.due===due);
 if(!item||item.paid<=0)throw Error('Сначала внеси фактическую оплату');
 const k=key(id,due);if(next.paymentClosures?.[k]?.closed===closed)return next;
 next.paymentClosures={...next.paymentClosures,[k]:{closed:!!closed,date:asOf}};return next;
}
function freeNow(s,asOf){return r(c(cash(s,asOf))-c(reserves(s,asOf).total))}
function categoryActual(s,month,categories,asOf='9999-12-31'){
 const sums=Object.fromEntries(categories.map(cat=>[cat,0]));for(const t of s.transactions.filter(t=>(t.type==='expense'||t.type==='debt_interest')&&t.date.slice(0,7)===month&&t.date<=asOf)){const cat=Object.hasOwn(sums,t.category)?t.category:'Другое';sums[cat]+=c(t.amount);}return Object.fromEntries(Object.entries(sums).map(([cat,sum])=>[cat,r(sum)]));
}
function removePayment(s,id){const next=structuredClone(s);next.transactions=next.transactions.filter(t=>t.id!==id);return next}
function reserveFunding(s,input,asOf){
 const next=structuredClone(s),item=funding(next,input.obligationId,input.forDue,asOf),amount=Number(input.amount);
 if(!Number.isFinite(amount)||amount<=0||c(amount)>c(item.unfunded))throw Error('Сумма превышает недофинансированную часть');
 if(c(amount)>c(cash(next,asOf))-c(reserves(next,asOf).total))throw Error('Не хватает свободных денег; накопления защищены');
 if(input.planId&&next.transactions.some(t=>t.fundingPlanId===input.planId))throw Error('Эта часть уже зарезервирована');
 next.transactions.push({id:input.newId,type:'reserve',amount:r(c(amount)),date:asOf,fundingKey:key(input.obligationId,input.forDue),goalId:item.goalId||'',fundingPlanId:input.planId||'',note:'Резерв запланированного платежа',createdAt:Date.now()});return next;
}
function setFundingPlan(s,id,due,parts,asOf=due){
 const next=structuredClone(s),o=next.obligations.find(o=>o.id===id);if(!o)throw Error('Платёж не найден');
 if(!schedule(next,due).some(x=>x.id===id&&x.due===due))throw Error('Дата не входит в расписание');
 if(new Set(parts.map(p=>p.id)).size!==parts.length)throw Error('Части финансирования должны иметь разные ID');
 for(const p of parts)if(!p.id||!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||p.date>due||!Number.isFinite(Number(p.amount))||Number(p.amount)<=0)throw Error('Проверь даты и суммы финансирования');
 const total=parts.reduce((n,p)=>n+c(p.amount),0),current=funding(s,id,due,asOf),outstanding=parts.filter(p=>!s.transactions.some(t=>t.fundingPlanId===p.id)).reduce((n,p)=>n+c(p.amount),0);if(total>c(o.amount)||c(current.reserved)+outstanding>c(current.amount))throw Error('План превышает стоимость платежа или его недофинансированный остаток');
 o.fundingPlan=[...(o.fundingPlan||[]).filter(p=>p.forDue!==due),...parts.map(p=>({...p,forDue:due,amount:r(c(p.amount))}))];return next;
}
function isOneOff(s,item){
 if(item.spendingPattern==='once'||item.frequency==='once')return true;
 return !!item.obligationId&&s.obligations.some(o=>o.id===item.obligationId&&o.frequency==='once');
}
function oneOffCosts(s,month,categories){
 const end=iso(new Date(date(month+'-01').getFullYear(),date(month+'-01').getMonth()+1,0,12));
 const out=Object.fromEntries(categories.map(cat=>[cat,0]));
 for(const o of schedule(s,end).filter(o=>o.type!=='debt'&&o.due.slice(0,7)===month&&isOneOff(s,o)))if(Object.hasOwn(out,o.category))out[o.category]+=c(o.amount);
 for(const t of s.transactions.filter(t=>t.type==='expense'&&t.date.slice(0,7)===month&&isOneOff(s,t)))if(Object.hasOwn(out,t.category))out[t.category]+=c(t.amount);
 return Object.fromEntries(Object.entries(out).map(([cat,v])=>[cat,r(v)]));
}
function budgetKnowledge(s,from,categories,draft={}){
 const month=from.slice(0,7),end=iso(new Date(date(from).getFullYear(),date(from).getMonth()+1,0,12));
 const recurring=schedule(s,end).filter(o=>o.type!=='debt'&&!isOneOff(s,o)&&o.due.slice(0,7)===month);
 const historical=s.transactions.filter(t=>t.type==='expense'&&!isOneOff(s,t)&&t.date>=add(from,-90)&&t.date<month+'-01');
 const sources={},missing=[],estimates={},essential={};
 for(const cat of categories){
  const input=Object.hasOwn(draft,cat)?draft[cat]:s.settings.budgetEstimates?.[cat];
  const due=recurring.filter(o=>o.category===cat).reduce((n,o)=>n+c(o.total),0);
  const entries=historical.filter(t=>t.category===cat),months=[...new Set(entries.map(t=>t.date.slice(0,7)))];
  const existing=Object.hasOwn(s.settings.categoryForecasts||{},cat)?c(s.settings.categoryForecasts[cat]):Object.hasOwn(s.settings.categoryBudgets||{},cat)?c(s.settings.categoryBudgets[cat]):cat==='Продукты'?c(s.settings.foodLimit):cat==='Транспорт'?c(s.settings.taxiLimit):0;
  let amount=null,source='unknown';
  if(input!==undefined){const value=Number(typeof input==='object'?input.amount:input);if(!Number.isFinite(value)||value<0)throw Error('Ориентиры расходов должны быть неотрицательными');amount=Math.max(due,c(value));source='user';}
  else if(existing>0||s.settings.categoryBudgetConfirmed?.[cat]){amount=Math.max(due,existing);source='settings';}
  else if(due>0){amount=due;source='schedule';}
  else if(months.length>=2||entries.some(t=>t.spendingPattern==='regular')){amount=Math.round(entries.reduce((n,t)=>n+c(t.amount),0)/Math.max(1,months.length));source='history';}
  if(amount===null)missing.push(cat);
  estimates[cat]=amount===null?null:r(amount);sources[cat]=source;
  essential[cat]=input&&typeof input==='object'&&input.essential!==undefined?!!input.essential:['Жильё','Продукты','Транспорт','Здоровье','Подписки и связь'].includes(cat);
 }
 return {missing,estimates,sources,essential,observedMonths:new Set(historical.map(t=>t.date.slice(0,7))).size};
}
function proposeBudget(s,from,categories,draft={}){
 const month=from.slice(0,7),end=iso(new Date(date(from).getFullYear(),date(from).getMonth()+1,0,12)),known=schedule(s,end).filter(o=>o.due.slice(0,7)===month);
 const info=budgetKnowledge(s,from,categories,draft),oneOff=oneOffCosts(s,month,categories),limits={},bases={};
 for(const cat of categories){
  const due=known.filter(o=>o.type!=='debt'&&!isOneOff(s,o)&&o.category===cat).reduce((n,o)=>n+c(o.total),0);
  const current=s.transactions.filter(t=>t.type==='expense'&&!isOneOff(s,t)&&t.date.slice(0,7)===month&&t.date<=from&&t.category===cat).reduce((n,t)=>n+c(t.amount),0);
  limits[cat]=info.estimates[cat]===null?null:r(Math.max(due,current,c(info.estimates[cat])));
  bases[cat]=Math.max(due,current,info.essential[cat]?c(info.estimates[cat]):0);
 }
 const fixedDebt=known.filter(o=>o.type==='debt').reduce((n,o)=>n+c(o.total),0),once=Object.values(oneOff).reduce((n,v)=>n+c(v),0);
 const income=c(s.settings.salary),daily=c(s.settings.otherDaily)*date(end).getDate(),target=c(s.settings.savingsTarget??25000);
 const base=Object.values(bases).reduce((n,v)=>n+v,0),savings=Math.max(0,Math.min(target,income-fixedDebt-once-base-daily));
 const flexible=categories.reduce((n,cat)=>n+Math.max(0,c(limits[cat])-bases[cat]),0),room=Math.max(0,income-fixedDebt-once-base-daily-savings);
 let allocated=0;
 for(const cat of categories){const extra=Math.max(0,c(limits[cat])-bases[cat]),part=flexible>0?Math.min(extra,Math.floor(room*extra/flexible)):0;if(limits[cat]!==null)limits[cat]=r(bases[cat]+part);allocated+=bases[cat]+part;}
 const remaining=Math.max(0,income-fixedDebt-once-allocated-daily-savings),extraDebt=info.missing.length?0:Math.min(Math.max(0,c(s.settings.allocationProposal?.extraDebt)),remaining);
 return {limits,monthlyLimits:Object.fromEntries(categories.map(cat=>[cat,limits[cat]===null?null:r(c(limits[cat])+c(oneOff[cat]))])),oneOff,oneOffTotal:r(once),income:r(income),fixedDebt:r(fixedDebt),daily:r(daily),necessary:r(base),optional:r(allocated-base),savings:r(savings),target:r(target),extraDebt:r(extraDebt),unassigned:r(remaining-extraDebt),complete:info.missing.length===0,deficit:r(Math.max(0,base+fixedDebt+once+daily-income)),preliminary:info.observedMonths<2||info.missing.length>0,missing:info.missing,observedMonths:info.observedMonths,sources:info.sources};
}
function acceptBudget(s,limits,categories,estimates={}){
 const next=structuredClone(s);next.settings.categoryBudgets={...next.settings.categoryBudgets};next.settings.categoryBudgetConfirmed={...next.settings.categoryBudgetConfirmed};
 for(const cat of categories){if(limits[cat]===null||limits[cat]===undefined||limits[cat]==='')continue;const n=Number(limits[cat]);if(!Number.isFinite(n)||n<0)throw Error('Лимиты должны быть неотрицательными');next.settings.categoryBudgets[cat]=r(c(n));next.settings.categoryBudgetConfirmed[cat]=true;}
 if(Object.keys(estimates).length){next.settings.budgetEstimates={...next.settings.budgetEstimates};for(const cat of categories)if(Object.hasOwn(estimates,cat)){const value=estimates[cat],n=Number(typeof value==='object'?value.amount:value);if(!Number.isFinite(n)||n<0)throw Error('Проверь ориентиры');next.settings.budgetEstimates[cat]={amount:r(c(n)),essential:typeof value==='object'?!!value.essential:['Жильё','Продукты','Транспорт','Здоровье','Подписки и связь'].includes(cat)};}}
 return next;
}
function savingsAchievements(s,asOf){
 const monthly={};for(const t of s.transactions.filter(t=>!t.fundingKey&&t.date<=asOf&&(t.type==='reserve'||t.type==='release'))){const month=t.date.slice(0,7);monthly[month]=(monthly[month]||0)+(t.type==='reserve'?1:-1)*c(t.amount);}
 const months=Object.values(monthly).filter(v=>v>0).length;
 const completed=Object.entries(s.settings.savingsPlans||{}).filter(([month,plan])=>month<=asOf.slice(0,7)&&c(plan.target)>0&&(monthly[month]||0)>=c(plan.target)).length;
 return {months,completed,total:reserves(s,asOf).savings};
}
const api={cash,freeNow,categoryActual,kind,debt,schedule,reserves,setOccurrenceClosed,funding,savePayment,removePayment,reserveFunding,setFundingPlan,proposeBudget,acceptBudget,budgetKnowledge,isOneOff,oneOffCosts,savingsAchievements,key};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MoneyFinance=api;
})(globalThis);
