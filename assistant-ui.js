/* Daily assistant UI. All writes happen only after an explicit user submission. */
function commitState(next,message){const previous=state;state=next;if(!persist()){state=previous;return false}render();if(message)notice(message);return true}
function debtOverview(){
 const cards=state.debts.filter(d=>MoneyFinance.kind(d)==='card');
 const rows=cards.map(d=>({...MoneyFinance.debt(state,d.id,today()),initial:money(d.balance)}));
 const total=rows.reduce((n,d)=>n+d.balance,0),initial=rows.reduce((n,d)=>n+d.initial,0),verified=rows.length>0&&rows.every(d=>!d.needsReconciliation);
 return {total,verified,percent:verified&&initial>0?Math.max(0,Math.min(100,(initial-total)/initial*100)):null};
}
function dailyRecommendation(f){
 if(f.minimum<0)return `В плане не хватает ${fmt(-f.minimum)}. Сначала проверь ближайшие платежи; новые накопления и дополнительные погашения лучше уменьшить.`;
 if(f.budgetIncomplete)return 'Уточни ориентировочные расходы в «Моём бюджете». Пока бюджет неполон, остаток не подтверждён как безопасный для покупок.';
 const unchecked=state.debts.find(d=>MoneyFinance.kind(d)==='card'&&MoneyFinance.debt(state,d.id,today()).needsReconciliation);
 if(unchecked)return `Сверь остаток «${unchecked.name}» с банком при следующем платеже — так прогресс будет точнее.`;
 if(savedTotal()<=0)return `Начни с посильной суммы: сейчас план позволяет предложить в накопления ${fmt(MoneyPlanner.allocation(state,today()).savings)}.`;
 return `Уже защищено в накоплениях ${fmt(savedTotal())}. Сохрани их и проверь план перед дополнительным погашением.`;
}
function renderAssistantHome(){
 const f=MoneyPlanner.forecast(state,today()),d=debtOverview(),near=unpaidOccurrences(plusDays(today(),14)).slice(0,3),res=MoneyFinance.reserves(state,today());
 return `<div class="stack assistant-home"><section class="card hero"><div class="label">На карте · фактический остаток</div><div class="big number">${fmt(cashBalance())}</div><div class="divider"></div><div class="label">${f.budgetIncomplete?'Бюджет расходов требует уточнения':'Доступно для необязательных покупок'}</div><div class="mid number">${f.budgetIncomplete?'Не подтверждено':fmt(f.available)}</div>${f.budgetIncomplete?'<p class="tiny">Неизвестные расходы не равны нулю. Уточни их в «Моём бюджете».</p>':''}</section><div class="btnrow">${mainButton('Добавить расход','add-expense','pink')}${mainButton('Проверить покупку','purchase-check','secondary')}</div><div class="grid2"><section class="card"><div class="label">Мои накопления</div><div class="mid">${fmt(res.savings)}</div><button class="secondary-link" data-page="goals">Мои цели</button></section><section class="card"><div class="label">Кредитные карты · всего</div><div class="mid">${fmt(d.total)}</div><p class="tiny">${d.percent===null?'Прогресс после сверки с банком':`Погашено ${d.percent.toFixed(1)}% от начального долга`}</p><button class="secondary-link" data-page="debts">Мои долги</button></section></div><section class="hint ${f.minimum<0?'warn':'good'}"><b>Сегодня</b><p>${escapeHTML(dailyRecommendation(f))}</p></section><section class="card"><div class="card-title">Ближайшие платежи <button class="secondary-link" data-page="obligations">Все</button></div>${near.length?near.map(o=>`<div class="kv"><span>${escapeHTML(o.name)}<br><small>${dateLabel(o.due)}${o.status==='partial'?' · частично оплачено':''}</small></span><b>${fmt(o.amount)}</b></div>`).join(''):'<p class="small">На ближайшие 14 дней платежей нет.</p>'}</section><div class="btnrow">${mainButton('Мой бюджет','open-budget','green')}${mainButton('Распределить деньги','allocate','secondary')}</div><details class="card"><summary>Прогноз и подробности расчётов · 0.3</summary>${plannerCard()}<p class="tiny">Резервы крупных платежей: ${fmt(res.total-res.savings)}. Они внутри остатка карты.</p></details></div>`;
}
function renderMyBudget(){
 const m=monthFilter;
 return `<div class="stack"><div class="btnrow">${mainButton('Предложить бюджет','propose-budget','green')}${mainButton('Настроить вручную','settings','secondary')}</div><section class="card"><label for="month-filter">Месяц бюджета</label><input id="month-filter" type="month" value="${escapeHTML(m)}"><p class="small">Лимиты — допустимый максимум. Прогноз расходов показан отдельно.</p>${renderCategoryBudgets(m)}</section><details class="card"><summary>Статистика и детальные расчёты</summary>${renderLegacyInsights()}${plannerCard()}</details></div>`;
}
function renderLegacyInsights(){const m=monthFilter,tx=monthlyExpenses(m);return `<div class="kv"><span>Покупки и услуги</span><b>${fmt(tx.reduce((n,t)=>n+money(t.amount),0))}</b></div><div class="kv"><span>Маркетплейсы · канал</span><b>${fmt(tx.filter(t=>t.channel==='marketplace').reduce((n,t)=>n+money(t.amount),0))}</b></div><div class="kv"><span>Доставки · канал</span><b>${fmt(tx.filter(t=>t.channel==='delivery').reduce((n,t)=>n+money(t.amount),0))}</b></div>${afterPaydayAlert()}`}
function renderDebtScreen(){
 const all=debtOverview();
 return `<div class="stack"><section class="card"><div class="card-title">Кредитные карты · ${fmt(all.total)}</div><p class="small">${!state.debts.some(d=>MoneyFinance.kind(d)==='card')?'Кредитные карты пока не добавлены.':all.percent===null?'Остатки требуют сверки; прогресс не подтверждён.':`Подтверждённый прогресс: ${all.percent.toFixed(1)}% от начальной задолженности.`}</p></section>${state.debts.map(d=>{const info=MoneyFinance.debt(state,d.id,today()),split=MoneyFinance.kind(d)==='split';return `<section class="card"><div class="card-title">${escapeHTML(d.name)} <span class="pill">${split?'Сплит':'Кредитная карта'}</span></div><div class="mid">Осталось ${fmt(info.balance)}</div><p class="small">${info.needsReconciliation?'Остаток требует сверки':split?'Расчёт беспроцентной рассрочки':`Сверено с банком ${dateLabel(info.lastConfirmed)}`}</p>${info.progress!==null?progress(info.progress,100):''}<div class="btnrow">${mainButton('Внести платёж','pay-debt','green').replace('data-action="pay-debt"',`data-action="pay-debt" data-id="${escapeHTML(d.id)}"`)}<button class="btn secondary" data-action="edit-debt" data-id="${escapeHTML(d.id)}">Настроить</button></div></section>`}).join('')}<button class="btn secondary" data-action="add-debt">Добавить кредитную карту / Сплит</button></div>`;
}
function renderPaymentCalendar(){
 const rows=MoneyFinance.schedule(state,plusDays(today(),60),today()).filter(o=>o.due>=plusDays(today(),-45)||o.status!=='paid');
 return `<div class="stack"><div class="btnrow">${mainButton('Запланировать платёж','add-obligation','pink')}<button class="btn secondary" data-page="debts">Кредитные карты и Сплит</button></div><section class="card"><div class="card-title">Запланированные платежи · 60 дней</div>${rows.map(o=>`<div class="list-item"><div class="row"><div><b>${escapeHTML(o.name)}</b><p class="tiny">${dateLabel(o.due)} · ${o.status==='paid'?'Оплачено':o.status==='partial'?'Частично оплачено':'Ожидает оплаты'}</p></div><b>${fmt(o.total)}</b></div><p class="small">Внесено ${fmt(o.paid)} · осталось ${fmt(o.amount)}</p><div class="small-actions">${o.status!=='paid'?`<button data-action="pay-obligation" data-id="${escapeHTML(o.occId)}">${o.status==='partial'?'Доплатить':'Оплачено'}</button><button data-action="fund-payment" data-id="${escapeHTML(o.occId)}">Финансирование</button>`:`<button data-page="transactions">История операций</button>`}</div></div>`).join('')||'<p class="small">Добавь известные регулярные и разовые расходы.</p>'}</section><details class="card"><summary>Настроить расписания</summary>${state.obligations.map(o=>`<div class="kv"><span>${escapeHTML(o.name)}<br><small>${escapeHTML(freqName(o.frequency))} · ${dateLabel(o.firstDue)}</small></span><button class="secondary-link" data-action="edit-obligation" data-id="${escapeHTML(o.id)}">Изменить</button></div>`).join('')}</details></div>`;
}
function paymentChoices(debtId,existing){
 const copy=structuredClone(state);if(existing)copy.transactions=copy.transactions.filter(t=>t.id!==existing.id);
 return MoneyFinance.schedule(copy,plusDays(today(),180)).filter(o=>o.status!=='paid'&&(!debtId||o.debtId===debtId));
}
function showUnifiedPayment({occId='',debtId='',existing=null}={}){
 const fixed=existing?.obligationId?MoneyFinance.key(existing.obligationId,existing.forDue):occId;
 const [oid,due]=fixed.split('|'),o=state.obligations.find(o=>o.id===oid);debtId=existing?.debtId||o?.debtId||debtId;
 const choices=paymentChoices(debtId,existing);const selected=choices.find(x=>x.occId===fixed);
 if(fixed&&!selected&&!existing){notice('Этот платёж уже оплачен. Измени связанную запись в истории.');return}
 const amount=existing?.amount??selected?.amount??'';
 modalOpen(existing?'Изменить платёж':'Фактический платёж',`<form class="form" id="unified-payment-form" data-id="${escapeHTML(existing?.id||'')}" data-command="${escapeHTML(existing?.commandId||id())}">${debtSelect(debtId,'Кредитная карта / Сплит (для обычного счёта не выбирать)')}${field('amount','Фактически внесённая сумма, ₽','number',amount,'min="0.01" step="0.01" required')}${field('date','Дата платежа','date',existing?.date||today(),'required')}${select('occurrence','Связать с запланированным платежом',[['','Отдельный платёж без связи'],...choices.map(x=>[x.occId,`${x.name} · ${dateLabel(x.due)} · осталось ${fmt(x.amount)}`])],fixed)}<p class="tiny">Совпадение суммы или даты не создаёт связь. Выбери нужный платёж и дату повторения. Для неоднозначных совпадений выбирай вручную.</p>${field('bankBalance','Новый остаток задолженности по данным банка, ₽ (необязательно)','number',existing?.bankBalance??'','min="0" step="0.01"')}<p class="tiny">Для кредитки без остатка банка: «Остаток требует сверки». Проценты автоматически не рассчитываются. Для Сплита без комиссий сумма уменьшает долг.</p>${field('note','Комментарий','text',existing?.note||'')}<button class="btn block">Сохранить один платёж</button>${existing?`<button class="btn danger block" data-action="delete-transaction" data-id="${escapeHTML(existing.id)}" type="button">Удалить операцию</button>`:''}</form>`);
}
function submitUnifiedPayment(form,fd){
 try{
  const [obligationId,forDue]=String(fd.get('occurrence')||'').split('|');
  const result=MoneyFinance.savePayment(state,{id:form.dataset.id||undefined,newId:id(),commandId:form.dataset.command,obligationId:obligationId||'',forDue,debtId:String(fd.get('debtId')||''),amount:fd.get('amount'),date:String(fd.get('date')),bankBalance:fd.get('bankBalance'),note:String(fd.get('note')||'')});
  const prior=state,after=MoneyPlanner.forecast(result.state,today()),t=result.transaction,d=result.state.debts.find(d=>d.id===t.debtId);
  const item=obligationId?MoneyFinance.schedule(result.state,forDue).find(o=>o.id===obligationId&&o.due===forDue):null;
  const extra=d&&MoneyFinance.kind(d)==='card'?(item?Math.max(0,item.paid-item.total):money(d.minimumPayment)>0?Math.max(0,t.amount-money(d.minimumPayment)):0):0;
  const info=d?MoneyFinance.debt(result.state,d.id,today()):null;
  if(!commitState(result.state,'Платёж сохранён в истории'))return;modalClose();
  const messages=['Полная сумма один раз учтена в денежном балансе.'];
  if(extra>0){if(after.minimum>=0&&after.initialFree>=0)messages.push(`Ты внесла на ${fmt(extra)} больше обязательного платежа! Это превышение платежа, а не подтверждённое уменьшение основного долга.`);else messages.push(`Внесено сверх обязательного ${fmt(extra)}, но план показывает нехватку ${fmt(Math.max(0,-after.minimum))}. Не увеличивай досрочное погашение за счёт необходимых расходов или накоплений.`);}
  if(d&&MoneyFinance.kind(d)==='card'&&!item&&money(d.minimumPayment)<=0)messages.push('Обязательный минимум не задан; сравнение платежа с минимумом пока недоступно.');
  if(t.date>today())messages.push('Это будущая запись: фактический баланс изменится только в указанную дату.');
  if(info){messages.push(info.needsReconciliation?'Остаток требует сверки. Уточни его в банке.':`Осталось погасить ${fmt(info.balance)}.`);if(!info.needsReconciliation&&t.bankBalance!==undefined){const old=MoneyFinance.debt(prior,t.debtId,today());const decrease=Math.max(0,old.balance-info.balance);if(decrease>0)messages.push(`Подтверждено уменьшение долга на ${fmt(decrease)}. ${info.progress!==null?`Прогресс ${info.progress.toFixed(1)}% от начального долга.`:''}`);}}
  modalOpen('Платёж учтён',messages.map(m=>`<p class="small" style="margin:10px 0">${escapeHTML(m)}</p>`).join('')+`<p class="small">Кредитные карты всего: ${fmt(debtOverview().total)}.</p>`);
 }catch(e){notice(e.message)}
}
function showFunding(occId){
 try{
 const [oid,due]=occId.split('|'),f=MoneyFinance.funding(state,oid,due,today());
 modalOpen('Финансирование одного платежа',`<p><b>${escapeHTML(f.name)}</b> · оплатить ${dateLabel(due)}</p><div class="kv"><span>Необходимо всего</span><b>${fmt(f.total)}</b></div><div class="kv"><span>Уже оплачено</span><b>${fmt(f.paid)}</b></div><div class="kv"><span>Фактически зарезервировано</span><b>${fmt(f.reserved)}</b></div><div class="kv"><span>Ещё не профинансировано</span><b>${fmt(f.unfunded)}</b></div><form class="form" id="funding-reserve-form" data-occ="${escapeHTML(occId)}">${field('amount','Зарезервировать из фактических денег сейчас, ₽','number','','min="0.01" step="0.01" required')}<button class="btn green">Создать защищённый резерв</button></form><details open><summary>Пополнения из будущих поступлений</summary><p class="tiny">Это части финансирования одного платежа, не дополнительные расходы. Зарплаты остаются прогнозом.</p><form class="form" id="funding-plan-form" data-occ="${escapeHTML(occId)}"><div id="funding-parts">${(f.plan.length?f.plan:[{id:id(),date:nextPayday(),amount:''},{id:id(),date:'',amount:''}]).map((p,i)=>fundingPart(p,i)).join('')}</div><button class="btn secondary" type="button" data-action="add-funding-part">Ещё одно поступление</button><button class="btn">Сохранить план пополнений</button></form></details>${f.plan.map(p=>{const done=state.transactions.some(t=>t.fundingPlanId===p.id);return `<div class="kv"><span>${dateLabel(p.date)} · ${fmt(p.amount)} · ${done?'зарезервировано':'план'}</span>${!done?`<button class="secondary-link" data-action="execute-funding" data-occ="${escapeHTML(occId)}" data-id="${escapeHTML(p.id)}">Деньги получены — резервировать</button>`:''}</div>`}).join('')}`);
 }catch(e){notice(e.message)}
}
function fundingPart(p,i){return `<fieldset class="category-budget funding-part" data-id="${escapeHTML(p.id)}" data-index="${i}">${field('part-date-'+i,'Дата поступления','date',p.date||'')}${field('part-amount-'+i,'Часть резерва, ₽','number',p.amount??'','min="0" step="0.01"')}<p class="tiny">Для удаления части очисти оба поля. Созданные операции резерва сохраняются.</p></fieldset>`}
let budgetDraft={};
function showBudgetSetup(draft=budgetDraft){
 const knowledge=MoneyFinance.budgetKnowledge(state,today(),CATEGORIES,draft),proposal=MoneyFinance.proposeBudget(state,today(),CATEGORIES,draft);
 const primary=['Продукты','Транспорт','Здоровье','Кафе и рестораны','Красота','Другое'].filter(cat=>knowledge.missing.includes(cat));
 const other=knowledge.missing.filter(cat=>!primary.includes(cat));
 const inputs=cat=>{const i=CATEGORIES.indexOf(cat);return `<div class="budget-setup-row">${field('initial-'+i,cat+' · примерно в месяц, ₽','number','','min="0" step="0.01"')}<label class="small"><input type="checkbox" name="essential-${i}" ${knowledge.essential[cat]?'checked':''}> Необходимый расход</label></div>`};
 modalOpen('Уточним регулярные расходы',`<p>Доход ${fmt(proposal.income)}. Известные платежи по долгам ${fmt(proposal.fixedDebt)}, разовые расходы месяца ${fmt(proposal.oneOffTotal)}.</p><p class="small">Уже известные настройки и регулярные платежи учтены — повторно вводить их не нужно. Укажи ориентиры только для неизвестных категорий. Пусто означает «пока не знаю»; 0 — твой явный ответ «регулярных трат нет». Разовую операцию сюда не включай.</p><form class="form" id="budget-setup-form">${primary.map(inputs).join('')}${other.length?`<details><summary>Другие неизвестные категории (${other.length})</summary>${other.map(inputs).join('')}<label class="small"><input type="checkbox" name="no-other"> Подтверждаю: в остальных перечисленных категориях регулярных расходов нет</label></details>`:''}<button class="btn block">Рассчитать предварительный бюджет</button><button class="btn secondary block" type="button" data-action="budget-preview">Пока не знаю — посмотреть известную часть</button></form>`);
}
function captureBudgetSetup(fd){
 const knowledge=MoneyFinance.budgetKnowledge(state,today(),CATEGORIES,budgetDraft),other=knowledge.missing.filter(cat=>!['Продукты','Транспорт','Здоровье','Кафе и рестораны','Красота','Другое'].includes(cat)),next={...budgetDraft};
 for(const cat of knowledge.missing){const i=CATEGORIES.indexOf(cat),value=String(fd.get('initial-'+i)??'').trim();if(value!==''){const amount=Number(value);if(!Number.isFinite(amount)||amount<0)throw Error('Проверь ориентиры расходов');next[cat]={amount,essential:fd.get('essential-'+i)==='on'};}else if(other.includes(cat)&&fd.get('no-other')==='on')next[cat]={amount:0,essential:false};}
 return next;
}
function showBudgetProposal(draft=budgetDraft,skipSetup=false){
 budgetDraft=draft;const proposal=MoneyFinance.proposeBudget(state,today(),CATEGORIES,draft);
 if(proposal.missing.length&&!skipSetup){showBudgetSetup(draft);return}
 const preview=MoneyFinance.acceptBudget(state,proposal.limits,CATEGORIES,draft),timing=MoneyPlanner.forecast(preview,today());
 modalOpen('Предложить бюджет',`<div class="hint ${proposal.deficit>0?'warn':''}"><b>Доход ${fmt(proposal.income)}</b><p>${proposal.preliminary?'Предварительное распределение.':'Распределение по известным расходам.'} ${proposal.missing.length?'Часть бюджета неизвестна: остаток нельзя считать безопасным для покупок.':''}</p></div><div class="kv"><span>Обязательные платежи по долгам</span><b>${fmt(proposal.fixedDebt)}</b></div><div class="kv"><span>Необходимые расходы и учтённый факт</span><b>${fmt(proposal.necessary)}</b></div><div class="kv"><span>Необязательные регулярные расходы</span><b>${fmt(proposal.optional)}</b></div><div class="kv"><span>Разовые расходы этого месяца</span><b>${fmt(proposal.oneOffTotal)}</b></div><div class="kv"><span>Дополнительная дневная настройка</span><b>${fmt(proposal.daily)}</b></div><div class="kv"><span>Предложено в накопления · цель ${fmt(proposal.target)}</span><b>${fmt(proposal.savings)}</b></div><p class="small">${proposal.savings<proposal.target?'Цель сейчас полностью не помещается в известный бюджет. Необходимые расходы сохранены, предложена меньшая сумма.':'Общая цель накоплений автоматически не меняется.'} ${proposal.missing.length?'Сумма накоплений тоже предварительная, до уточнения неизвестных трат.':''}</p>${proposal.deficit>0?`<p class="negative">Дефицит необходимых расходов: ${fmt(proposal.deficit)}. Их нельзя обнулить ради цели накоплений.</p>`:''}${proposal.extraDebt>0?`<div class="kv"><span>Предложено дополнительное погашение</span><b>${fmt(proposal.extraDebt)}</b></div>`:''}<p class="small">Не распределено по известной части: ${fmt(proposal.unassigned)}${proposal.missing.length?' — это не безопасная сумма для покупок.':'. Это месячный план, доступность сейчас зависит от дат поступлений.'}</p>${deficitExplanation(timing)}<p class="tiny">Даты зарплат 5-го/20-го и запланированные платежи проверяются отдельно в денежном прогнозе. Разовые суммы ниже относятся только к текущему месяцу.</p><form class="form" id="budget-proposal-form"><details><summary>Раскрыть и изменить регулярные лимиты</summary>${CATEGORIES.map((cat,i)=>`${field('proposal-'+i,cat+' · регулярный лимит в месяц, ₽','number',proposal.limits[cat]??'','min="0" step="0.01"')}${proposal.oneOff[cat]>0?`<p class="tiny">Плюс разово в этом месяце: ${fmt(proposal.oneOff[cat])}; в постоянный лимит не входит.</p>`:''}`).join('')}</details>${proposal.missing.length?`<p class="small">Ещё неизвестно: ${escapeHTML(proposal.missing.join(', '))}. Пустые поля не станут нулевыми рекомендациями.</p><button class="btn secondary" type="button" data-action="budget-setup">Уточнить неизвестные расходы</button>`:''}<p class="tiny">Принятие сохраняет только введённые ориентиры и выбранные регулярные лимиты. Операции, долги, накопления и отдельные настройки прогноза не меняются. Категории можно отредактировать; итог после применения будет проверен повторно.</p><button class="btn block">Принять известную часть бюджета</button></form>`);
}
function acceptBudgetProposal(fd){
 const limits=Object.fromEntries(CATEGORIES.map((cat,i)=>[cat,String(fd.get('proposal-'+i)??'').trim()]));
 const next=MoneyFinance.acceptBudget(state,limits,CATEGORIES,budgetDraft),review=MoneyFinance.proposeBudget(next,today(),CATEGORIES),timing=MoneyPlanner.forecast(next,today());
 if(commitState(next,'Лимиты приняты')){budgetDraft={};modalOpen('Бюджет сохранён',`<p>Сохранены только подтверждённые регулярные лимиты. Разовые платежи остаются в своём месяце.</p>${review.missing.length?'<p class="negative">Бюджет ещё неполон. Остаток не подтверждён как безопасный для покупок.</p>':''}${review.deficit>0?`<p class="negative">Известный дефицит: ${fmt(review.deficit)}.</p>`:''}${deficitExplanation(timing)}`);}
}
function showAllocation(){
 const a=MoneyPlanner.allocation(state,today());
 modalOpen('Распределить деньги',`<p class="small">Фактические свободные средства: ${fmt(a.funds)}. Уже созданные накопления ${fmt(savedTotal())} и резервы платежей ${fmt(MoneyFinance.reserves(state,today()).total-savedTotal())} защищены отдельно.</p><div class="hint ${a.shortfall>0?'warn':''}">${a.shortfall>0?`Известный план не покрыт: ${fmt(a.shortfall)}. Дополнительные погашения и новые накопления уменьши.`:'Распределение ниже — предложение, ещё не создано ни одного резерва.'}</div>${a.forecast.budgetIncomplete?'<p class="negative">Распределение предварительное: неизвестные расходы ещё не учтены. Остаток не подтверждён как безопасный для необязательных покупок.</p>':''}<form class="form" id="allocation-form">${field('mandatory','1. Обязательные платежи · требуется '+fmt(a.mandatoryRequired),'number',a.mandatory,'min="0" step="0.01" required')}${field('living','2. Необходимые расходы · требуется '+fmt(a.livingRequired),'number',a.living,'min="0" step="0.01" required')}${field('futureReserve','3. Известные крупные расходы','number',a.futureReserve,'min="0" step="0.01" required')}${field('savings','4. Согласованные новые накопления','number',a.savings,'min="0" step="0.01" required')}${field('extraDebt','5. Дополнительные платежи по кредитам','number',0,'min="0" step="0.01" required')}${field('free','6. Необязательные покупки','number',a.unallocated,'min="0" step="0.01" required')}<p class="small">Месячная цель ${fmt(state.settings.savingsTarget??25000)} гибкая. Предложено ${fmt(a.savings)}. Непокрытые обязательства ${fmt(a.mandatoryUncovered)}, жизнь ${fmt(a.livingUncovered)}.</p><button class="btn block">Проверить моё распределение</button></form><details><summary>Формулы и исходный расчёт</summary>${forecastExplanation(a.forecast)}${deficitExplanation(a.forecast)}</details>`);
}
function submitAllocation(fd){
 const a=MoneyPlanner.allocation(state,today()),names=['mandatory','living','futureReserve','savings','extraDebt','free'],values=Object.fromEntries(names.map(n=>[n,Number(fd.get(n))]));
 if(names.some(n=>!Number.isFinite(values[n])||values[n]<0)){notice('Укажи неотрицательные суммы');return}
 const total=names.reduce((n,k)=>n+Math.round(values[k]*100),0);
 if(total>Math.round(a.funds*100)){notice('Распределение превышает фактические свободные деньги');return}
 const safe=values.mandatory>=a.mandatoryRequired&&values.living>=a.livingRequired&&values.futureReserve>=a.futureReserve&&a.forecast.minimum>=values.savings+values.extraDebt;
 if(values.extraDebt>0&&!safe){notice('Дополнительный платёж пока небезопасен: сначала покрой необходимые расходы и накопления');return}
 if(values.savings>Math.max(0,a.forecast.minimum)){notice('Новая сумма накоплений создаёт дефицит. Уменьши её');return}
 const next=structuredClone(state);next.settings.allocationProposal={date:today(),...values};const month=today().slice(0,7),net=state.transactions.filter(t=>!t.fundingKey&&t.date<=today()&&t.date.slice(0,7)===month).reduce((n,t)=>n+(t.type==='reserve'?money(t.amount):t.type==='release'?-money(t.amount):0),0);next.settings.savingsPlans={...next.settings.savingsPlans,[month]:{target:Math.max(0,net)+values.savings,agreedAt:today()}};
 if(!commitState(next,'Предложение сохранено'))return;
 modalOpen('Распределение согласовано',`<p>Предложения сохранены; списаний пока нет.</p><p class="small">Непокрытые платежи: ${fmt(Math.max(0,a.mandatoryRequired-values.mandatory))}; необходимые расходы: ${fmt(Math.max(0,a.livingRequired-values.living))}.</p><p>Новые накопления: ${fmt(values.savings)}. Дополнительное погашение: ${fmt(values.extraDebt)}.</p>${values.savings>0?`<button class="btn green block" data-action="confirm-allocation">Создать резерв накоплений</button>`:''}<button class="btn secondary block" data-page="debts">Перейти к кредитным картам</button><p class="tiny">Платёж по кредитке вносится после фактической оплаты. Предложение не разрешает использовать ранее созданные накопления.</p>`);
}
function confirmAllocation(){
 const a=state.settings.allocationProposal;if(!a||a.date!==today()||a.savings<=0)return;
 const f=MoneyPlanner.forecast(state,today());if(a.savings>Math.max(0,f.minimum)){notice('План изменился: проверь распределение заново');return}
 const next=structuredClone(state);next.transactions.push({id:id(),type:'reserve',amount:a.savings,date:today(),note:'Согласованное распределение',createdAt:Date.now()});next.settings.allocationProposal={...a,savings:0};
 const first=savedTotal()<=0;if(commitState(next,first?'Первые накопления созданы!':'Накопления пополнены')){modalClose();showSavingsAchievement(first)}
}
function showSavingsAchievement(first=false){
 const a=MoneyFinance.savingsAchievements(state,today());
 notice(`${first?'Первые накопления! ':''}Защищено ${fmt(a.total)}. Пополнения были в ${a.months} месяцах.${a.completed>0?` Выполнено согласованных месячных планов: ${a.completed}.`:''}`);
}
document.addEventListener('click',e=>{
 const el=e.target.closest('[data-action]');if(!el)return;const action=el.dataset.action;
 if(action==='open-budget'){page='budget';render()}
 if(action==='propose-budget'){budgetDraft={};showBudgetProposal()}
 if(action==='budget-setup')showBudgetSetup();
 if(action==='budget-preview'){try{budgetDraft=captureBudgetSetup(new FormData(document.getElementById('budget-setup-form')));showBudgetProposal(budgetDraft,true)}catch(err){notice(err.message)}}
 if(action==='fund-payment')showFunding(el.dataset.id);
 if(action==='add-funding-part'){const container=document.getElementById('funding-parts'),i=container.children.length;container.insertAdjacentHTML('beforeend',fundingPart({id:id()},i));}
 if(action==='execute-funding'){
  try{const [oid,due]=el.dataset.occ.split('|'),o=state.obligations.find(o=>o.id===oid),p=o.fundingPlan.find(p=>p.id===el.dataset.id);const next=MoneyFinance.reserveFunding(state,{obligationId:oid,forDue:due,amount:p.amount,planId:p.id,newId:id()},today());if(commitState(next,'Часть платежа зарезервирована'))showFunding(el.dataset.occ)}catch(err){notice(err.message)}
 }
});
document.addEventListener('change',e=>{
 if(e.target.name==='debtId'&&e.target.closest('#unified-payment-form')){
  const form=e.target.closest('form'),select=form.elements.occurrence;
  const choices=paymentChoices(e.target.value,form.dataset.id?state.transactions.find(t=>t.id===form.dataset.id):null);
  select.innerHTML='<option value="">Отдельный платёж без связи</option>'+choices.map(x=>`<option value="${escapeHTML(x.occId)}">${escapeHTML(x.name)} · ${dateLabel(x.due)} · ${fmt(x.amount)}</option>`).join('');
 }
});
document.addEventListener('submit',e=>{
 const form=e.target;if(!['unified-payment-form','funding-plan-form','funding-reserve-form','budget-proposal-form','budget-setup-form','allocation-form'].includes(form.id))return;e.preventDefault();const fd=new FormData(form);
 if(form.id==='unified-payment-form'){submitUnifiedPayment(form,fd);return}
 try{
  if(form.id==='funding-reserve-form'){const [oid,due]=form.dataset.occ.split('|');if(commitState(MoneyFinance.reserveFunding(state,{obligationId:oid,forDue:due,amount:fd.get('amount'),newId:id()},today()),'Резерв создан'))showFunding(form.dataset.occ)}
  if(form.id==='funding-plan-form'){const [oid,due]=form.dataset.occ.split('|'),parts=[...form.querySelectorAll('.funding-part')].map(el=>({id:el.dataset.id,date:String(fd.get('part-date-'+el.dataset.index)||''),amount:fd.get('part-amount-'+el.dataset.index)})).filter(p=>p.date||p.amount);if(commitState(MoneyFinance.setFundingPlan(state,oid,due,parts,today()),'План финансирования сохранён'))showFunding(form.dataset.occ)}
  if(form.id==='budget-setup-form'){budgetDraft=captureBudgetSetup(fd);showBudgetProposal(budgetDraft,true)}
  if(form.id==='budget-proposal-form')acceptBudgetProposal(fd);
  if(form.id==='allocation-form')submitAllocation(fd);
 }catch(err){notice(err.message)}
});
