<script setup lang="ts">
import {computed,onMounted,reactive,ref,watch} from 'vue'
import {useRoute,useRouter} from 'vue-router'
import {AlertTriangle,BadgeCheck,ChevronDown,ChevronRight,LoaderCircle,Plus,RefreshCw,Trash2,Undo2,X} from 'lucide-vue-next'
import {ApiError,ledgerApi,type ChartAccount,type IncomeStatement,type LedgerEntry,type Reconciliation,type TimeLedgerEntry,type TrialBalance} from './api'

const emit=defineEmits<{unauthorized:[]}>()
type Tab='overview'|'income'|'journal'|'record'|'time'
const tabs:Array<{id:Tab;label:string}>=[{id:'overview',label:'Balances'},{id:'income',label:'Income statement'},{id:'journal',label:'Journal'},{id:'record',label:'Record transaction'},{id:'time',label:'Time ledger'}]
const route=useRoute(),router=useRouter()
const tab=computed<Tab>(()=>tabs.some(t=>t.id===route.query.tab)?route.query.tab as Tab:'overview')
const setTab=(id:Tab,extra:Record<string,string|undefined>={})=>void router.replace({query:{tab:id,...extra}})
const setQuery=(patch:Record<string,string|number|undefined>)=>void router.replace({query:{...route.query,...patch}})
const qv=(k:string)=>typeof route.query[k]==='string'?route.query[k] as string:''

const loading=ref(false),busy=ref(false),error=ref(''),notice=ref('')
const fail=(e:unknown)=>{if(e instanceof ApiError&&e.status===401){emit('unauthorized');return}error.value=e instanceof ApiError&&e.status===403?'This account does not have administrator access.':e instanceof Error?e.message:'Something went wrong.'}

// --- formatting ---
const money=(minor:number,currency:string)=>{try{return new Intl.NumberFormat('en',{style:'currency',currency}).format(minor/100)}catch{return `${currency} ${(minor/100).toFixed(2)}`}}
const date=(v:string)=>new Intl.DateTimeFormat('en',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(`${v.slice(0,10)}T00:00:00Z`))
const dateTime=(v:string)=>new Intl.DateTimeFormat('en',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(v))
const hours=(s:number)=>{const m=Math.round(Math.abs(s)/60),h=Math.floor(m/60),r=m%60;return `${s<0?'−':s>0?'+':''}${h} h ${String(r).padStart(2,'0')} m`}
const balance=(s:number)=>{const m=Math.round(s/60);return `${Math.floor(m/60)} h ${String(m%60).padStart(2,'0')} m`}
const iso=(d:Date)=>d.toISOString().slice(0,10)
const toMinor=(major:number|string)=>Math.round(Number(major||0)*100)
const kinds:Array<[string,string]>=[['','All kinds'],['PAYMENT','Paystack payment'],['OFFLINE_SALE','Sale outside Paystack'],['REFUND','Refund'],['PARTNER_PAYOUT','Partner payout'],['SETTLEMENT','Paystack settlement'],['MANUAL','Manual entry'],['REVERSAL','Reversal']]
const reversible=new Set(['MANUAL','PARTNER_PAYOUT','SETTLEMENT','OFFLINE_SALE'])

// --- data ---
const tb=ref<TrialBalance|null>(null),rec=ref<Reconciliation|null>(null),chart=ref<ChartAccount[]>([])
const income=ref<IncomeStatement|null>(null)
const entries=ref<LedgerEntry[]>([]),entryCount=ref(0),open=ref<Set<number>>(new Set())
const times=ref<TimeLedgerEntry[]>([]),timeCount=ref(0)
const page=computed(()=>Math.max(1,Number(route.query.page)||1))
const pages=(n:number)=>Math.max(1,Math.ceil(n/50))
const groups:Array<[string,string]>=[['ASSET','Assets'],['LIABILITY','Liabilities'],['EQUITY','Equity'],['INCOME','Income'],['EXPENSE','Expenses']]
const accountsOf=(type:string)=>(tb.value?.accounts??[]).filter(a=>a.type===type)
const owed=computed(()=>(tb.value?.partnerPayables??[]).filter(p=>p.owedMinor!==0))

// income statement range
const today=new Date()
const presets=computed<Array<[string,string,string]>>(()=>{const y=today.getUTCFullYear(),m=today.getUTCMonth();return [
  ['This month',iso(new Date(Date.UTC(y,m,1))),iso(today)],
  ['Last month',iso(new Date(Date.UTC(y,m-1,1))),iso(new Date(Date.UTC(y,m,0)))],
  ['This year',iso(new Date(Date.UTC(y,0,1))),iso(today)],
]})
const incFrom=computed(()=>qv('from')||presets.value[0][1]),incTo=computed(()=>qv('to')||presets.value[0][2])

async function load(){
  loading.value=true;error.value=''
  try{
    if(tab.value==='overview'){const [a,r]=await Promise.all([ledgerApi.accounts(),ledgerApi.reconcile()]);tb.value=a;rec.value=r}
    else if(tab.value==='income'){income.value=await ledgerApi.income(incFrom.value,incTo.value)}
    else if(tab.value==='journal'){if(!chart.value.length)chart.value=await ledgerApi.chart();const r=await ledgerApi.entries({kind:qv('kind')||undefined,account:qv('account')||undefined,partner:qv('partner')||undefined,from:qv('from')||undefined,to:qv('to')||undefined,source:qv('source')||undefined,page:page.value});entries.value=r.results;entryCount.value=r.count}
    else if(tab.value==='record'){const [c,a]=await Promise.all([chart.value.length?Promise.resolve(chart.value):ledgerApi.chart(),ledgerApi.accounts()]);chart.value=c;tb.value=a}
    else if(tab.value==='time'){const r=await ledgerApi.time({user:qv('user')?Number(qv('user')):undefined,hideUsage:qv('usage')!=='show',page:page.value});times.value=r.results;timeCount.value=r.count}
  }catch(e){fail(e)}finally{loading.value=false}
}
watch(()=>route.fullPath,()=>{if(route.name==='books')void load()})
onMounted(load)
defineExpose({reload:load})
const toggle=(id:number)=>{const s=new Set(open.value);s.has(id)?s.delete(id):s.add(id);open.value=s}

async function reverse(e:LedgerEntry){
  const memo=prompt(`Reverse entry #${e.id} (${e.memo})?\nThis books its mirror image. Optional reason:`,'')
  if(memo===null)return
  busy.value=true;error.value=''
  try{const r=await ledgerApi.reverse(e.id,memo);notice.value=`Entry #${e.id} reversed by #${r.id}.`;await load()}catch(err){fail(err)}finally{busy.value=false}
}

// --- record forms ---
const settle=reactive({amount:'',currency:'KES',reference:'',date:iso(today),note:''})
const payout=reactive({partnerCode:'',amount:'',currency:'KES',reference:'',note:''})
type FormLine={account:string;debit:string;credit:string;partnerCode:string}
const manual=reactive({memo:'',currency:'KES',date:iso(today),reference:'',lines:[{account:'',debit:'',credit:'',partnerCode:''},{account:'',debit:'',credit:'',partnerCode:''}] as FormLine[]})
const manualTotals=computed(()=>({d:manual.lines.reduce((s,l)=>s+toMinor(l.debit),0),c:manual.lines.reduce((s,l)=>s+toMinor(l.credit),0)}))
const manualOk=computed(()=>manual.memo.trim()&&manualTotals.value.d>0&&manualTotals.value.d===manualTotals.value.c&&manual.lines.every(l=>!(toMinor(l.debit)||toMinor(l.credit))||(l.account&&!(toMinor(l.debit)&&toMinor(l.credit)))))
function payPartner(code:string,amountMinor:number,currency:string){Object.assign(payout,{partnerCode:code,amount:(amountMinor/100).toFixed(2),currency,reference:'',note:''});setTab('record')}
async function submit(kind:'settlement'|'payout'|'manual'){
  busy.value=true;error.value=''
  try{
    let r:LedgerEntry
    if(kind==='settlement'){r=await ledgerApi.settlement({amountMinor:toMinor(settle.amount),currency:settle.currency,reference:settle.reference,note:settle.note,date:settle.date});Object.assign(settle,{amount:'',reference:'',note:''})}
    else if(kind==='payout'){r=await ledgerApi.payout({partnerCode:payout.partnerCode,amountMinor:toMinor(payout.amount),currency:payout.currency,reference:payout.reference,note:payout.note});Object.assign(payout,{partnerCode:'',amount:'',reference:'',note:''})}
    else{r=await ledgerApi.manual({memo:manual.memo,currency:manual.currency,date:manual.date,reference:manual.reference,lines:manual.lines.filter(l=>toMinor(l.debit)||toMinor(l.credit)).map(l=>({account:l.account,debitMinor:toMinor(l.debit),creditMinor:toMinor(l.credit),...(l.partnerCode?{partnerCode:l.partnerCode}:{})}))});Object.assign(manual,{memo:'',reference:'',lines:[{account:'',debit:'',credit:'',partnerCode:''},{account:'',debit:'',credit:'',partnerCode:''}]})}
    notice.value=`Booked entry #${r.id}: ${r.memo} (${money(r.amountMinor,r.currency)}).`
    tb.value=await ledgerApi.accounts()
  }catch(e){fail(e)}finally{busy.value=false}
}
</script>

<template>
<div class="page billing books">
  <div v-if="error" class="alert billing-alert"><AlertTriangle :size="17"/>{{error}}<button @click="error=''">×</button></div>
  <div v-if="notice" class="alert billing-alert ok"><BadgeCheck :size="17"/>{{notice}}<button @click="notice=''">×</button></div>

  <nav class="billing-tabs">
    <button v-for="t in tabs" :key="t.id" :class="{active:tab===t.id}" @click="setTab(t.id)">{{t.label}}</button>
    <button class="icon" title="Refresh" @click="load"><RefreshCw :class="{spin:loading}" :size="17"/></button>
  </nav>

  <!-- Balances -->
  <template v-if="tab==='overview'">
    <section v-if="rec" class="recon" :class="{bad:!rec.ok}">
      <component :is="rec.ok?BadgeCheck:AlertTriangle" :size="18"/>
      <p><strong>{{rec.ok?'Books reconcile':'Reconciliation problems'}}</strong><small>{{rec.entries}} journal entries · {{rec.timeEntries}} time entries · checked {{dateTime(rec.checkedAt)}}</small></p>
      <span v-for="t in tb?.totals??[]" :key="t.currency" class="chip-ok" :class="{bad:!t.balanced}">{{t.currency}} {{t.balanced?'balanced':'NOT balanced'}}</span>
    </section>
    <ul v-if="rec&&!rec.ok" class="problems"><li v-for="(p,i) in rec.problems" :key="i"><b>{{p.check}}</b> {{p.detail}}</li></ul>
    <p class="hint">Cash basis: a sale is income when it is paid. Amounts are what was charged (Paystack payments in {{tb?.totals[0]?.currency||'KES'}}; sales confirmed outside Paystack in the plan's currency).</p>
    <div class="ledger-groups">
      <section v-for="[type,label] in groups" :key="type" class="panel">
        <div class="panel-head"><p><strong>{{label}}</strong></p></div>
        <table class="compact"><tbody>
          <tr v-for="a in accountsOf(type)" :key="a.key" class="clickable" @click="setTab('journal',{account:a.key})">
            <td><b>{{a.code}} {{a.name}}</b><small v-if="a.description">{{a.description}}</small></td>
            <td class="num"><template v-if="a.balances.length"><div v-for="b in a.balances" :key="b.currency" :class="{neg:b.balanceMinor<0}">{{money(b.balanceMinor,b.currency)}}</div></template><span v-else class="muted-cell">—</span></td>
          </tr>
        </tbody></table>
      </section>
    </div>
    <section class="panel table-panel">
      <div class="panel-head"><p><strong>Owed to partners</strong><small>Commission booked, less payouts and claw-backs. Negative = the partner owes you.</small></p></div>
      <div class="table-wrap"><table class="compact"><thead><tr><th>Partner</th><th class="num">Balance</th><th></th></tr></thead><tbody>
        <tr v-for="p in owed" :key="p.partnerId+p.currency"><td><b>{{p.partnerName}}</b><small>{{p.partnerCode}}</small></td><td class="num" :class="{neg:p.owedMinor<0}">{{money(p.owedMinor,p.currency)}}</td><td><div class="row-actions"><button class="row-action" @click="setTab('journal',{partner:p.partnerCode})">History</button><button v-if="p.owedMinor>0" class="row-action edit" @click="payPartner(p.partnerCode,p.owedMinor,p.currency)">Record payout</button></div></td></tr>
        <tr v-if="!owed.length"><td colspan="3" class="empty">Nothing owed to partners.</td></tr>
      </tbody></table></div>
    </section>
  </template>

  <!-- Income statement -->
  <template v-else-if="tab==='income'">
    <div class="range-bar"><div class="chips"><button v-for="[l,f,t] in presets" :key="l" :class="{active:incFrom===f&&incTo===t}" @click="setQuery({from:f,to:t})">{{l}}</button></div>
      <label>From <input type="date" :value="incFrom" @change="setQuery({from:($event.target as HTMLInputElement).value})"></label><label>To <input type="date" :value="incTo" @change="setQuery({to:($event.target as HTMLInputElement).value})"></label></div>
    <p v-if="income&&!income.currencies.length" class="panel empty">No income or expenses booked between {{date(income.from)}} and {{date(income.to)}}.</p>
    <section v-for="c in income?.currencies??[]" :key="c.currency" class="panel statement">
      <div class="panel-head"><p><strong>{{c.currency}} · {{date(income!.from)}} – {{date(income!.to)}}</strong></p></div>
      <table class="compact"><tbody>
        <tr class="head"><td>Income</td><td></td></tr>
        <tr v-for="l in c.income" :key="l.key"><td>{{l.code}} {{l.name}}</td><td class="num" :class="{neg:l.amountMinor<0}">{{money(l.amountMinor,c.currency)}}</td></tr>
        <tr class="sub"><td>Total income</td><td class="num">{{money(c.incomeMinor,c.currency)}}</td></tr>
        <tr class="head"><td>Expenses</td><td></td></tr>
        <tr v-for="l in c.expenses" :key="l.key"><td>{{l.code}} {{l.name}}</td><td class="num">{{money(l.amountMinor,c.currency)}}</td></tr>
        <tr v-if="!c.expenses.length"><td class="muted-cell">None</td><td></td></tr>
        <tr class="sub"><td>Total expenses</td><td class="num">{{money(c.expensesMinor,c.currency)}}</td></tr>
        <tr class="net"><td>Net {{c.netMinor>=0?'profit':'loss'}}</td><td class="num" :class="{neg:c.netMinor<0}">{{money(c.netMinor,c.currency)}}</td></tr>
      </tbody></table>
    </section>
  </template>

  <!-- Journal -->
  <section v-else-if="tab==='journal'" class="panel table-panel">
    <div class="tools journal-tools">
      <select :value="qv('kind')" @change="setQuery({kind:($event.target as HTMLSelectElement).value||undefined,page:undefined})"><option v-for="[v,l] in kinds" :key="v" :value="v">{{l}}</option></select>
      <select :value="qv('account')" @change="setQuery({account:($event.target as HTMLSelectElement).value||undefined,page:undefined})"><option value="">All accounts</option><option v-for="a in chart" :key="a.key" :value="a.key">{{a.code}} {{a.name}}</option></select>
      <label>From <input type="date" :value="qv('from')" @change="setQuery({from:($event.target as HTMLInputElement).value||undefined,page:undefined})"></label>
      <label>To <input type="date" :value="qv('to')" @change="setQuery({to:($event.target as HTMLInputElement).value||undefined,page:undefined})"></label>
      <span v-if="qv('partner')||qv('source')" class="filter-chip">{{qv('partner')?`Partner ${qv('partner')}`:qv('source')}}<button @click="setQuery({partner:undefined,source:undefined})"><X :size="12"/></button></span>
      <small>{{entryCount}} entries</small>
    </div>
    <div class="table-wrap"><table><thead><tr><th></th><th>#</th><th>Date</th><th>Kind</th><th>Description</th><th class="num">Amount</th><th>Reference</th><th></th></tr></thead>
      <tbody v-for="e in entries" :key="e.id">
        <tr class="clickable" @click="toggle(e.id)"><td><component :is="open.has(e.id)?ChevronDown:ChevronRight" :size="14"/></td><td>{{e.id}}</td><td>{{date(e.date)}}</td><td><em :class="e.kind.toLowerCase()">{{e.kindLabel}}</em></td><td>{{e.memo}}<small v-if="e.reversedById" class="flag">Reversed by #{{e.reversedById}}</small><small v-if="e.reversesId">Reverses #{{e.reversesId}}</small><small v-if="e.createdBy">by {{e.createdBy}}</small></td><td class="num">{{money(e.amountMinor,e.currency)}}</td><td><code v-if="e.reference">{{e.reference}}</code></td><td><button v-if="reversible.has(e.kind)&&!e.reversedById" class="row-action" :disabled="busy" @click.stop="reverse(e)"><Undo2 :size="12"/>Reverse</button></td></tr>
        <tr v-if="open.has(e.id)" class="lines"><td></td><td colspan="7"><table class="compact"><thead><tr><th>Account</th><th>For</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead><tbody>
          <tr v-for="(l,i) in e.lines" :key="i"><td>{{l.accountCode}} {{l.accountName}}<small v-if="l.memo">{{l.memo}}</small></td><td>{{l.partnerCode?`Partner ${l.partnerCode}`:''}}{{l.partnerCode&&l.customerEmail?' · ':''}}{{l.customerEmail||''}}</td><td class="num">{{l.debitMinor?money(l.debitMinor,e.currency):''}}</td><td class="num">{{l.creditMinor?money(l.creditMinor,e.currency):''}}</td></tr>
        </tbody></table></td></tr>
      </tbody>
      <tbody v-if="!entries.length"><tr><td colspan="8" class="empty">No entries match.</td></tr></tbody>
    </table></div>
    <footer v-if="pages(entryCount)>1" class="pager"><button :disabled="page<=1" @click="setQuery({page:page-1>1?page-1:undefined})">Previous</button><span>Page {{page}} of {{pages(entryCount)}}</span><button :disabled="page>=pages(entryCount)" @click="setQuery({page:page+1})">Next</button></footer>
  </section>

  <!-- Record -->
  <template v-else-if="tab==='record'">
    <p class="hint">Payments, refunds and sales confirmed in Billing are booked automatically. Record here what happens outside RouteGuard. Entries can't be edited or deleted; reverse a mistake from the Journal.</p>
    <div class="record-grid">
      <form class="panel record" @submit.prevent="submit('settlement')">
        <div class="panel-head"><p><strong>Paystack settlement</strong><small>Paystack paid your balance into the bank. Dr Bank · Cr Paystack balance</small></p></div>
        <div class="form-grid"><label>Amount<input v-model="settle.amount" type="number" min="0.01" step="0.01" required></label><label>Currency<input v-model="settle.currency" maxlength="3" minlength="3" required></label><label>Date<input v-model="settle.date" type="date" required></label><label>Settlement reference<input v-model="settle.reference" placeholder="From the Paystack dashboard"></label><label class="full">Note<input v-model="settle.note"></label></div>
        <footer class="editor-actions"><button class="primary" :disabled="busy"><LoaderCircle v-if="busy" class="spin" :size="15"/>Book settlement</button></footer>
      </form>
      <form class="panel record" @submit.prevent="submit('payout')">
        <div class="panel-head"><p><strong>Partner payout</strong><small>You paid a partner their commission. Dr Partner payable · Cr Bank</small></p></div>
        <div class="form-grid">
          <label class="full">Partner<select v-model="payout.partnerCode" required><option value="" disabled>Choose a partner</option><option v-for="p in tb?.partnerPayables??[]" :key="p.partnerId+p.currency" :value="p.partnerCode">{{p.partnerName}} — owed {{money(p.owedMinor,p.currency)}}</option></select></label>
          <label>Amount<input v-model="payout.amount" type="number" min="0.01" step="0.01" required></label><label>Currency<input v-model="payout.currency" maxlength="3" minlength="3" required></label>
          <label>Payment reference<input v-model="payout.reference" placeholder="M-Pesa / bank reference"></label><label>Note<input v-model="payout.note"></label>
        </div>
        <footer class="editor-actions"><button class="primary" :disabled="busy||!payout.partnerCode"><LoaderCircle v-if="busy" class="spin" :size="15"/>Book payout</button></footer>
      </form>
      <form class="panel record wide" @submit.prevent="submit('manual')">
        <div class="panel-head"><p><strong>Manual entry</strong><small>Anything else: provider bills, hosting, owner's capital, corrections. Debits must equal credits.</small></p></div>
        <div class="form-grid"><label class="full">Description<input v-model="manual.memo" required maxlength="300" placeholder="e.g. Bright Data invoice for November"></label><label>Date<input v-model="manual.date" type="date" required></label><label>Currency<input v-model="manual.currency" maxlength="3" minlength="3" required></label><label class="full">Reference<input v-model="manual.reference" placeholder="Invoice or receipt number"></label></div>
        <table class="compact entry-lines"><thead><tr><th>Account</th><th class="num">Debit</th><th class="num">Credit</th><th>Partner (optional)</th><th></th></tr></thead><tbody>
          <tr v-for="(l,i) in manual.lines" :key="i"><td><select v-model="l.account"><option value="">Choose…</option><option v-for="a in chart" :key="a.key" :value="a.key">{{a.code}} {{a.name}}</option></select></td><td><input v-model="l.debit" type="number" min="0" step="0.01"></td><td><input v-model="l.credit" type="number" min="0" step="0.01"></td><td><input v-model="l.partnerCode" placeholder="code"></td><td><button v-if="manual.lines.length>2" type="button" class="row-action danger" @click="manual.lines.splice(i,1)"><Trash2 :size="12"/></button></td></tr>
          <tr class="sub"><td><button type="button" class="row-action" @click="manual.lines.push({account:'',debit:'',credit:'',partnerCode:''})"><Plus :size="12"/>Line</button></td><td class="num">{{money(manualTotals.d,manual.currency||'KES')}}</td><td class="num">{{money(manualTotals.c,manual.currency||'KES')}}</td><td colspan="2"><span :class="manualTotals.d===manualTotals.c&&manualTotals.d>0?'ok-text':'neg'">{{manualTotals.d===manualTotals.c&&manualTotals.d>0?'Balanced':`Off by ${money(Math.abs(manualTotals.d-manualTotals.c),manual.currency||'KES')}`}}</span></td></tr>
        </tbody></table>
        <footer class="editor-actions"><button class="primary" :disabled="busy||!manualOk"><LoaderCircle v-if="busy" class="spin" :size="15"/>Book entry</button></footer>
      </form>
    </div>
  </template>

  <!-- Time ledger -->
  <section v-else class="panel table-panel">
    <div class="tools journal-tools">
      <label>Customer ID <input :value="qv('user')" type="number" min="1" placeholder="All" @change="setQuery({user:($event.target as HTMLInputElement).value||undefined,page:undefined})"></label>
      <label class="check"><input type="checkbox" :checked="qv('usage')==='show'" @change="setQuery({usage:($event.target as HTMLInputElement).checked?'show':undefined,page:undefined})">Show minute-by-minute usage</label>
      <small>{{timeCount}} entries</small>
    </div>
    <div class="table-wrap"><table><thead><tr><th>When</th><th>Customer</th><th>What</th><th class="num">Change</th><th class="num">Balance after</th><th>Reference</th><th>By</th></tr></thead><tbody>
      <tr v-for="t in times" :key="t.id"><td>{{dateTime(t.createdAt)}}</td><td><button class="link" @click="router.push(`/users/${t.userId}`)">{{t.userEmail}}</button></td><td><em :class="t.kind.toLowerCase()">{{t.kindLabel}}</em><small v-if="t.note">{{t.note}}</small></td><td class="num" :class="{neg:t.seconds<0}">{{hours(t.seconds)}}</td><td class="num">{{balance(t.balanceAfter)}}</td><td><code v-if="t.reference">{{t.reference}}</code></td><td>{{t.actor||'System'}}</td></tr>
      <tr v-if="!times.length"><td colspan="7" class="empty">No time entries.</td></tr>
    </tbody></table></div>
    <footer v-if="pages(timeCount)>1" class="pager"><button :disabled="page<=1" @click="setQuery({page:page-1>1?page-1:undefined})">Previous</button><span>Page {{page}} of {{pages(timeCount)}}</span><button :disabled="page>=pages(timeCount)" @click="setQuery({page:page+1})">Next</button></footer>
  </section>
</div>
</template>
