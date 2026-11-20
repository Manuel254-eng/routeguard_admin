<script setup lang="ts">
import {computed,onMounted,reactive,ref,watch} from 'vue'
import {useRoute,useRouter} from 'vue-router'
import {AlertTriangle,BadgeCheck,Ban,Clock,CreditCard,Hourglass,LoaderCircle,Package,Pencil,Plus,RefreshCw,Trash2,Undo2,UserRound,X} from 'lucide-vue-next'
import {ApiError,billingApi,ledgerApi,type CustomerBilling,type Decision,type PaymentRow,type Plan,type SubscriptionRow,type TopUpPackage,type TopUpRow} from './api'

const emit=defineEmits<{unauthorized:[]}>()
type Tab='queue'|'subscriptions'|'topups'|'payments'|'catalogue'
const tabs:Array<{id:Tab;label:string}>=[{id:'queue',label:'Activation queue'},{id:'subscriptions',label:'Subscriptions'},{id:'topups',label:'Top-ups'},{id:'payments',label:'Payments'},{id:'catalogue',label:'Plans & packages'}]
const route=useRoute(),router=useRouter()
const tab=computed<Tab>(()=>tabs.some(t=>t.id===route.query.tab)?route.query.tab as Tab:'queue')
const setTab=(id:Tab)=>void router.replace({query:{...route.query,tab:id,status:undefined,page:undefined}})

const loading=ref(false),busy=ref<string|null>(null),error=ref(''),notice=ref('')
const fail=(e:unknown)=>{if(e instanceof ApiError&&e.status===401){emit('unauthorized');return}error.value=e instanceof ApiError&&e.status===403?'This account does not have administrator access.':e instanceof Error?e.message:'Something went wrong.'}

// --- summary counts ---
const counts=reactive({pendingSubs:0,pendingTopups:0,activeSubs:0,review:0,paid:0})
// --- lists ---
const pendingSubs=ref<SubscriptionRow[]>([]),pendingTopups=ref<TopUpRow[]>([])
const subs=ref<SubscriptionRow[]>([]),topups=ref<TopUpRow[]>([]),payments=ref<PaymentRow[]>([]),listCount=ref(0)
const plans=ref<Plan[]>([]),packages=ref<TopUpPackage[]>([])
const statusFilter=computed(()=>typeof route.query.status==='string'?route.query.status:'')
const page=computed(()=>Math.max(1,Number(route.query.page)||1))
const pages=computed(()=>Math.max(1,Math.ceil(listCount.value/50)))
const setFilter=(status:string)=>void router.replace({query:{...route.query,status:status||undefined,page:undefined}})
const setPage=(p:number)=>void router.replace({query:{...route.query,page:p>1?p:undefined}})
const filters:Record<string,Array<[string,string]>>={
  subscriptions:[['','All'],['ACTIVE','Active'],['PENDING','Pending'],['CANCELLED','Cancelled'],['REJECTED','Rejected']],
  topups:[['','All'],['CREDITED','Credited'],['PENDING','Pending'],['CANCELLED','Cancelled'],['REJECTED','Rejected']],
  payments:[['','All'],['review','Needs review'],['SUCCESS','Successful'],['PENDING','Pending'],['FAILED','Failed'],['ABANDONED','Abandoned']],
}

async function loadSummary(){
  const [ps,pt,as,rv,pd]=await Promise.all([billingApi.subscriptions({status:'PENDING'}),billingApi.topups({status:'PENDING'}),billingApi.subscriptions({status:'ACTIVE'}),billingApi.payments({needs_review:true}),billingApi.payments({status:'SUCCESS'})])
  pendingSubs.value=ps.results;pendingTopups.value=pt.results
  Object.assign(counts,{pendingSubs:ps.count,pendingTopups:pt.count,activeSubs:as.count,review:rv.count,paid:pd.count})
}
async function loadTab(){
  const p=page.value,s=statusFilter.value||undefined
  if(tab.value==='subscriptions'){const r=await billingApi.subscriptions({status:s,page:p});subs.value=r.results;listCount.value=r.count}
  else if(tab.value==='topups'){const r=await billingApi.topups({status:s,page:p});topups.value=r.results;listCount.value=r.count}
  else if(tab.value==='payments'){const r=await billingApi.payments(s==='review'?{needs_review:true,page:p}:{status:s,page:p});payments.value=r.results;listCount.value=r.count}
  else if(tab.value==='catalogue'){const [a,b]=await Promise.all([billingApi.plans(),billingApi.packages()]);plans.value=a.results;packages.value=b.results}
}
async function reload(){loading.value=true;error.value='';try{await Promise.all([loadSummary(),loadTab()])}catch(e){fail(e)}finally{loading.value=false}}
watch(()=>[tab.value,statusFilter.value,page.value],()=>{loading.value=true;loadTab().catch(fail).finally(()=>loading.value=false)})
onMounted(reload)
defineExpose({reload})

// --- formatting ---
const money=(minor:number,currency:string)=>{try{return new Intl.NumberFormat('en',{style:'currency',currency}).format(minor/100)}catch{return `${currency} ${(minor/100).toFixed(2)}`}}
const date=(v:string|null)=>v?new Intl.DateTimeFormat('en',{month:'short',day:'numeric',year:'numeric'}).format(new Date(v)):'—'
const dateTime=(v:string|null)=>v?new Intl.DateTimeFormat('en',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(v)):'—'
const hours=(seconds:number)=>{const m=Math.round(seconds/60),h=Math.floor(Math.abs(m)/60),r=Math.abs(m)%60;return `${m<0?'−':''}${h} h ${String(r).padStart(2,'0')} m`}
const daysLeft=(v:string|null)=>v?Math.max(0,Math.ceil((Date.parse(v)-Date.now())/86400000)):0
const isExpired=(s:SubscriptionRow)=>s.status==='ACTIVE'&&!!s.expiresAt&&Date.parse(s.expiresAt)<Date.now()
const paymentFor=(p:PaymentRow)=>p.subscriptionId?'Subscription':p.topupId?'Top-up':'—'
const reasonText:Record<string,string>={subscription_required:'No active subscription',time_exhausted:'Out of time for today',other_device:'Another device is active'}

// --- decisions (activate / reject / cancel) ---
type Target={kind:'subscription'|'topup';action:'activate'|'reject'|'cancel';id:string;title:string;email:string;price:string}
const decision=ref<Target|null>(null),decisionForm=reactive<Required<Decision>>({paymentReference:'',note:''})
function decide(kind:Target['kind'],action:Target['action'],row:SubscriptionRow|TopUpRow){
  decision.value={kind,action,id:row.id,email:row.userEmail,title:'planName' in row?row.planName:row.packageName,price:money(row.priceCents,row.currency)}
  Object.assign(decisionForm,{paymentReference:'',note:''})
}
async function submitDecision(){
  const d=decision.value;if(!d)return
  busy.value='decision';error.value=''
  const body:Decision={note:decisionForm.note.trim()};if(d.action==='activate')body.paymentReference=decisionForm.paymentReference.trim()
  try{
    if(d.kind==='subscription')await billingApi.subscriptionAction(d.id,d.action,body)
    else await billingApi.topupAction(d.id,d.action as 'activate'|'reject',body)
    notice.value=`${d.title} for ${d.email} ${d.action==='activate'?(d.kind==='topup'?'credited':'activated'):d.action==='reject'?'rejected':'cancelled'}.`
    decision.value=null;await reload()
    if(customer.value&&customerId.value)await openCustomer(customerId.value,customerEmail.value)
  }catch(e){fail(e)}finally{busy.value=null}
}
const decisionVerb=computed(()=>({activate:decision.value?.kind==='topup'?'Credit top-up':'Activate subscription',reject:'Reject request',cancel:'Cancel subscription'})[decision.value?.action??'activate'])

// --- customer drawer ---
const customer=ref<CustomerBilling|null>(null),customerId=ref<number|null>(null),customerEmail=ref(''),customerSubs=ref<SubscriptionRow[]>([]),customerTopups=ref<TopUpRow[]>([])
const adjust=reactive({hours:1,remove:false,note:''})
async function openCustomer(id:number,email:string){
  if(customerId.value!==id)customer.value=null
  customerId.value=id;customerEmail.value=email;busy.value='customer'
  try{const [c,s,t]=await Promise.all([billingApi.customer(id),billingApi.subscriptions({user:id}),billingApi.topups({user:id})]);customer.value=c;customerSubs.value=s.results;customerTopups.value=t.results}
  catch(e){fail(e);closeCustomer()}finally{busy.value=null}
}
function closeCustomer(){customer.value=null;customerId.value=null;Object.assign(adjust,{hours:1,remove:false,note:''})}
async function submitAdjust(){
  if(!customerId.value||!adjust.hours)return
  const minutes=Math.round(adjust.hours*60)*(adjust.remove?-1:1)
  busy.value='adjust';error.value=''
  try{await billingApi.adjustTime(customerId.value,minutes,adjust.note.trim());notice.value=`${adjust.remove?'Removed':'Added'} ${hours(Math.abs(minutes)*60)} ${adjust.remove?'from':'to'} ${customerEmail.value}.`;Object.assign(adjust,{hours:1,remove:false,note:''});await openCustomer(customerId.value,customerEmail.value)}
  catch(e){fail(e)}finally{busy.value=null}
}
const maxUsage=computed(()=>Math.max(1,...(customer.value?.dailyUsage??[]).map(u=>u.allowanceSecondsUsed+u.purchasedSecondsUsed)))

// --- catalogue editor ---
type Editing={kind:'plan'|'package';id:string|null}
const editing=ref<Editing|null>(null)

// --- refunds ---
const refunding=ref<PaymentRow|null>(null),refundForm=reactive({amount:'',reason:'',reverseCommission:true,recordOnly:false})
function openRefund(p:PaymentRow){refunding.value=p;Object.assign(refundForm,{amount:((p.amountMinor-p.refundedMinor)/100).toFixed(2),reason:'',reverseCommission:true,recordOnly:false})}
async function submitRefund(){
  const p=refunding.value;if(!p)return
  busy.value='refund';error.value=''
  try{const r=await ledgerApi.refund(p.id,{amountMinor:Math.round(Number(refundForm.amount)*100),reason:refundForm.reason.trim(),reverseCommission:refundForm.reverseCommission,recordOnly:refundForm.recordOnly});notice.value=`Refunded ${money(Math.round(Number(refundForm.amount)*100),p.currency)} of ${p.reference} — booked as entry #${r.ledgerEntryId}.`;refunding.value=null;await reload()}
  catch(e){fail(e)}finally{busy.value=null}
}
const catalogForm=reactive({code:'',name:'',description:'',price:0,currency:'USD',durationDays:30,dailyAllowanceHours:4,maxDevices:1,hours:1,isActive:true,isPopular:false,sortOrder:0})
function editPlan(p:Plan|null){editing.value={kind:'plan',id:p?.id??null};Object.assign(catalogForm,p?{code:p.code,name:p.name,description:p.description,price:p.priceCents/100,currency:p.currency,durationDays:p.durationDays,dailyAllowanceHours:p.dailyAllowanceMinutes/60,maxDevices:p.maxDevices,isActive:p.isActive,isPopular:p.isPopular,sortOrder:p.sortOrder}:{code:'',name:'',description:'',price:15,currency:'USD',durationDays:30,dailyAllowanceHours:4,maxDevices:1,isActive:true,isPopular:false,sortOrder:0})}
function editPackage(p:TopUpPackage|null){editing.value={kind:'package',id:p?.id??null};Object.assign(catalogForm,p?{code:p.code,name:p.name,price:p.priceCents/100,currency:p.currency,hours:p.minutes/60,isActive:p.isActive,sortOrder:p.sortOrder}:{code:'',name:'',price:1,currency:'USD',hours:1,isActive:true,sortOrder:0})}
async function saveCatalog(){
  const e=editing.value;if(!e)return
  busy.value='catalog';error.value=''
  const common={code:catalogForm.code.trim(),name:catalogForm.name.trim(),priceCents:Math.round(catalogForm.price*100),currency:catalogForm.currency.trim().toUpperCase(),isActive:catalogForm.isActive,sortOrder:catalogForm.sortOrder}
  try{
    if(e.kind==='plan')await billingApi.savePlan(e.id,{...common,description:catalogForm.description.trim(),durationDays:catalogForm.durationDays,dailyAllowanceMinutes:Math.round(catalogForm.dailyAllowanceHours*60),maxDevices:catalogForm.maxDevices,isPopular:catalogForm.isPopular})
    else await billingApi.savePackage(e.id,{...common,minutes:Math.round(catalogForm.hours*60)})
    notice.value=`${common.name} saved. Changes apply to new purchases only.`;editing.value=null;await loadTab()
  }catch(err){fail(err)}finally{busy.value=null}
}
async function toggleActive(kind:'plan'|'package',item:Plan|TopUpPackage){
  busy.value=item.id;error.value=''
  try{kind==='plan'?await billingApi.savePlan(item.id,{isActive:!item.isActive}):await billingApi.savePackage(item.id,{isActive:!item.isActive});await loadTab()}catch(e){fail(e)}finally{busy.value=null}
}
async function remove(kind:'plan'|'package',item:Plan|TopUpPackage){
  if(!confirm(`Delete “${item.name}”? Items that have already been sold can only be hidden.`))return
  busy.value=item.id;error.value=''
  try{kind==='plan'?await billingApi.deletePlan(item.id):await billingApi.deletePackage(item.id);notice.value=`${item.name} deleted.`;await loadTab()}catch(e){fail(e)}finally{busy.value=null}
}
</script>

<template>
<div class="page billing">
  <div v-if="error" class="alert billing-alert"><AlertTriangle :size="17"/>{{error}}<button @click="error=''">×</button></div>
  <div v-if="notice" class="alert billing-alert ok"><BadgeCheck :size="17"/>{{notice}}<button @click="notice=''">×</button></div>

  <section class="metrics">
    <article><span><Hourglass/></span><p>Awaiting activation<strong>{{counts.pendingSubs+counts.pendingTopups}}</strong><small>{{counts.pendingSubs}} plans · {{counts.pendingTopups}} top-ups</small></p></article>
    <article><span><BadgeCheck/></span><p>Active subscriptions<strong>{{counts.activeSubs}}</strong><small>including scheduled renewals</small></p></article>
    <article><span><CreditCard/></span><p>Successful payments<strong>{{counts.paid}}</strong><small>via Paystack</small></p></article>
    <article :class="{warn:counts.review}"><span><AlertTriangle/></span><p>Needs review<strong>{{counts.review}}</strong><small>paid but not applied</small></p></article>
  </section>

  <nav class="billing-tabs">
    <button v-for="t in tabs" :key="t.id" :class="{active:tab===t.id}" @click="setTab(t.id)">{{t.label}}<b v-if="t.id==='queue'&&counts.pendingSubs+counts.pendingTopups">{{counts.pendingSubs+counts.pendingTopups}}</b><b v-if="t.id==='payments'&&counts.review" class="warn">{{counts.review}}</b></button>
    <button class="icon" title="Refresh" @click="reload"><RefreshCw :class="{spin:loading}" :size="17"/></button>
  </nav>

  <!-- Activation queue -->
  <template v-if="tab==='queue'">
    <p class="hint">Paystack payments activate automatically. Requests here were not paid online (or the payment failed) — activate them once you have confirmed payment another way.</p>
    <section class="panel table-panel">
      <div class="panel-head"><p><strong>Subscription requests</strong><small>{{counts.pendingSubs}} waiting</small></p></div>
      <div class="table-wrap"><table><thead><tr><th>Customer</th><th>Plan</th><th>Price</th><th>Requested</th><th></th></tr></thead><tbody>
        <tr v-for="s in pendingSubs" :key="s.id"><td><button class="link" @click="openCustomer(s.userId,s.userEmail)">{{s.userEmail}}</button></td><td><b>{{s.planName}}</b><small>{{s.durationDays}} days · {{hours(s.dailyAllowanceMinutes*60)}}/day</small></td><td>{{money(s.priceCents,s.currency)}}</td><td>{{dateTime(s.requestedAt)}}</td><td><div class="row-actions"><button class="row-action edit" @click="decide('subscription','activate',s)"><BadgeCheck :size="12"/>Activate</button><button class="row-action" @click="decide('subscription','reject',s)"><Ban :size="12"/>Reject</button></div></td></tr>
        <tr v-if="!pendingSubs.length"><td colspan="5" class="empty">No subscription requests waiting.</td></tr>
      </tbody></table></div>
    </section>
    <section class="panel table-panel">
      <div class="panel-head"><p><strong>Top-up requests</strong><small>{{counts.pendingTopups}} waiting</small></p></div>
      <div class="table-wrap"><table><thead><tr><th>Customer</th><th>Package</th><th>Price</th><th>Requested</th><th></th></tr></thead><tbody>
        <tr v-for="t in pendingTopups" :key="t.id"><td><button class="link" @click="openCustomer(t.userId,t.userEmail)">{{t.userEmail}}</button></td><td><b>{{t.packageName}}</b><small>{{hours(t.minutes*60)}}</small></td><td>{{money(t.priceCents,t.currency)}}</td><td>{{dateTime(t.requestedAt)}}</td><td><div class="row-actions"><button class="row-action edit" @click="decide('topup','activate',t)"><BadgeCheck :size="12"/>Credit</button><button class="row-action" @click="decide('topup','reject',t)"><Ban :size="12"/>Reject</button></div></td></tr>
        <tr v-if="!pendingTopups.length"><td colspan="5" class="empty">No top-up requests waiting.</td></tr>
      </tbody></table></div>
    </section>
  </template>

  <!-- Lists -->
  <section v-else-if="tab!=='catalogue'" class="panel table-panel">
    <div class="tools"><div class="chips"><button v-for="[value,label] in filters[tab]" :key="value" :class="{active:statusFilter===value}" @click="setFilter(value)">{{label}}</button></div><small>{{listCount}} records</small></div>
    <div class="table-wrap">
      <table v-if="tab==='subscriptions'"><thead><tr><th>Customer</th><th>Plan</th><th>Status</th><th>Period</th><th>Price</th><th>Reference</th><th></th></tr></thead><tbody>
        <tr v-for="s in subs" :key="s.id"><td><button class="link" @click="openCustomer(s.userId,s.userEmail)">{{s.userEmail}}</button><small>requested {{date(s.requestedAt)}}</small></td><td><b>{{s.planName}}</b><small>{{hours(s.dailyAllowanceMinutes*60)}}/day · {{s.maxDevices}} device{{s.maxDevices===1?'':'s'}}</small></td><td><em :class="isExpired(s)?'expired':s.status.toLowerCase()">{{isExpired(s)?'EXPIRED':s.status}}</em></td><td><template v-if="s.startsAt">{{date(s.startsAt)}} → {{date(s.expiresAt)}}<small v-if="s.status==='ACTIVE'&&!isExpired(s)">{{daysLeft(s.expiresAt)}} days left</small></template><template v-else>—</template></td><td>{{money(s.priceCents,s.currency)}}</td><td><code v-if="s.paymentReference">{{s.paymentReference}}</code><small v-if="s.adminNote">{{s.adminNote}}</small></td><td><div class="row-actions"><template v-if="s.status==='PENDING'"><button class="row-action edit" @click="decide('subscription','activate',s)">Activate</button><button class="row-action" @click="decide('subscription','reject',s)">Reject</button></template><button v-else-if="s.status==='ACTIVE'&&!isExpired(s)" class="row-action" @click="decide('subscription','cancel',s)">Cancel</button></div></td></tr>
        <tr v-if="!subs.length"><td colspan="7" class="empty">No subscriptions match.</td></tr>
      </tbody></table>
      <table v-else-if="tab==='topups'"><thead><tr><th>Customer</th><th>Package</th><th>Status</th><th>Price</th><th>Requested</th><th>Reference</th><th></th></tr></thead><tbody>
        <tr v-for="t in topups" :key="t.id"><td><button class="link" @click="openCustomer(t.userId,t.userEmail)">{{t.userEmail}}</button></td><td><b>{{t.packageName}}</b><small>{{hours(t.minutes*60)}}</small></td><td><em :class="t.status.toLowerCase()">{{t.status}}</em></td><td>{{money(t.priceCents,t.currency)}}</td><td>{{dateTime(t.requestedAt)}}<small v-if="t.decidedAt">decided {{dateTime(t.decidedAt)}}</small></td><td><code v-if="t.paymentReference">{{t.paymentReference}}</code><small v-if="t.adminNote">{{t.adminNote}}</small></td><td><div v-if="t.status==='PENDING'" class="row-actions"><button class="row-action edit" @click="decide('topup','activate',t)">Credit</button><button class="row-action" @click="decide('topup','reject',t)">Reject</button></div></td></tr>
        <tr v-if="!topups.length"><td colspan="7" class="empty">No top-ups match.</td></tr>
      </tbody></table>
      <table v-else><thead><tr><th>Reference</th><th>Customer</th><th>For</th><th>Method</th><th>Charged</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>
        <tr v-for="p in payments" :key="p.id" :class="{review:p.needsReview}"><td><code>{{p.reference}}</code><small v-if="p.needsReview" class="flag"><AlertTriangle :size="11"/>Paid, but the request was no longer open — refund or credit manually</small></td><td><button class="link" @click="openCustomer(p.userId,p.userEmail)">{{p.userEmail}}</button></td><td>{{paymentFor(p)}}<small>{{money(p.priceCents,p.priceCurrency)}}</small></td><td>{{p.method==='mpesa'?'M-Pesa':'Card'}}<small v-if="p.phoneNumber">{{p.phoneNumber}}</small></td><td><b>{{money(p.amountMinor,p.currency)}}</b><small v-if="p.currency!==p.priceCurrency">rate {{Number(p.fxRate).toFixed(2)}}</small><small v-if="p.feeMinor!=null">fee {{money(p.feeMinor,p.currency)}}</small><small v-if="p.partnerCode">{{p.partnerCode}} {{money(p.partnerShareMinor,p.currency)}}{{p.splitApplied?' (split)':''}}</small></td><td><em :class="p.status.toLowerCase()">{{p.status}}</em><small v-if="p.refundedMinor" class="flag">refunded {{money(p.refundedMinor,p.currency)}}</small></td><td>{{dateTime(p.createdAt)}}<small v-if="p.paidAt">paid {{dateTime(p.paidAt)}}</small></td><td><div class="row-actions"><button class="row-action" @click="router.push({path:'/books',query:{tab:'journal',source:`payment:${p.id}`}})">Books</button><button v-if="p.status==='SUCCESS'&&p.refundedMinor<p.amountMinor" class="row-action danger" @click="openRefund(p)"><Undo2 :size="12"/>Refund</button></div></td></tr>
        <tr v-if="!payments.length"><td colspan="8" class="empty">No payments match.</td></tr>
      </tbody></table>
    </div>
    <footer v-if="pages>1" class="pager"><button :disabled="page<=1" @click="setPage(page-1)">Previous</button><span>Page {{page}} of {{pages}}</span><button :disabled="page>=pages" @click="setPage(page+1)">Next</button></footer>
  </section>

  <!-- Catalogue -->
  <template v-else>
    <p class="hint">Price and allowance changes apply to new purchases. Existing subscriptions keep the terms they were bought with.</p>
    <section class="panel table-panel">
      <div class="panel-head"><p><strong>Subscription plans</strong><small>What customers can subscribe to</small></p><button @click="editPlan(null)"><Plus :size="13"/> Add plan</button></div>
      <div class="table-wrap"><table><thead><tr><th>Plan</th><th>Price</th><th>Duration</th><th>Daily time</th><th>Devices</th><th>Visibility</th><th></th></tr></thead><tbody>
        <tr v-for="p in plans" :key="p.id"><td><b>{{p.name}}</b><small>{{p.code}}<template v-if="p.isPopular"> · Most Popular</template></small></td><td>{{money(p.priceCents,p.currency)}}</td><td>{{p.durationDays}} days</td><td>{{hours(p.dailyAllowanceMinutes*60)}}</td><td>{{p.maxDevices}}</td><td><em :class="p.isActive?'active':'disabled'">{{p.isActive?'ON SALE':'HIDDEN'}}</em></td><td><div class="row-actions"><button class="row-action edit" @click="editPlan(p)"><Pencil :size="12"/>Edit</button><button class="row-action" :disabled="busy===p.id" @click="toggleActive('plan',p)">{{p.isActive?'Hide':'Show'}}</button><button class="row-action danger" :disabled="busy===p.id" @click="remove('plan',p)"><Trash2 :size="12"/></button></div></td></tr>
        <tr v-if="!plans.length"><td colspan="7" class="empty">No plans yet.</td></tr>
      </tbody></table></div>
    </section>
    <section class="panel table-panel">
      <div class="panel-head"><p><strong>Top-up packages</strong><small>Extra hours that never expire</small></p><button @click="editPackage(null)"><Plus :size="13"/> Add package</button></div>
      <div class="table-wrap"><table><thead><tr><th>Package</th><th>Hours</th><th>Price</th><th>Per hour</th><th>Visibility</th><th></th></tr></thead><tbody>
        <tr v-for="p in packages" :key="p.id"><td><b>{{p.name}}</b><small>{{p.code}}</small></td><td>{{hours(p.minutes*60)}}</td><td>{{money(p.priceCents,p.currency)}}</td><td>{{money(Math.round(p.priceCents/(p.minutes/60)),p.currency)}}</td><td><em :class="p.isActive?'active':'disabled'">{{p.isActive?'ON SALE':'HIDDEN'}}</em></td><td><div class="row-actions"><button class="row-action edit" @click="editPackage(p)"><Pencil :size="12"/>Edit</button><button class="row-action" :disabled="busy===p.id" @click="toggleActive('package',p)">{{p.isActive?'Hide':'Show'}}</button><button class="row-action danger" :disabled="busy===p.id" @click="remove('package',p)"><Trash2 :size="12"/></button></div></td></tr>
        <tr v-if="!packages.length"><td colspan="6" class="empty">No packages yet.</td></tr>
      </tbody></table></div>
    </section>
  </template>

  <!-- Decision dialog -->
  <div v-if="decision" class="modal-wrap" @click.self="decision=null">
    <form class="modal" @submit.prevent="submitDecision">
      <header><p><small>{{decision.kind==='topup'?'TOP-UP':'SUBSCRIPTION'}}</small><strong>{{decisionVerb}}</strong><span>{{decision.title}} · {{decision.price}} · {{decision.email}}</span></p><button type="button" @click="decision=null"><X :size="18"/></button></header>
      <div class="form-grid">
        <p v-if="decision.action==='activate'" class="full note">{{decision.kind==='topup'?'The hours are added to the customer’s balance immediately.':'The subscription starts now, or when the current one ends if this is a renewal.'}} Only do this after confirming payment.<br><b>With a payment reference</b> the sale is booked in Books as money received outside Paystack (and any partner's commission as owed). <b>Leave it empty</b> for a free grant — nothing is booked.</p>
        <p v-else-if="decision.action==='cancel'" class="full note warn">The customer loses access immediately. Purchased extra hours stay on their balance.</p>
        <label v-if="decision.action==='activate'" class="full">Payment reference (books the sale)<input v-model="decisionForm.paymentReference" maxlength="200" placeholder="e.g. M-Pesa code or bank reference — empty for a free grant"></label>
        <label class="full">Note (internal)<input v-model="decisionForm.note" maxlength="2000" placeholder="Optional"></label>
      </div>
      <footer><button type="button" @click="decision=null">Back</button><button class="primary" :class="{danger:decision.action!=='activate'}" :disabled="busy==='decision'"><LoaderCircle v-if="busy==='decision'" class="spin" :size="16"/>{{decisionVerb}}</button></footer>
    </form>
  </div>

  <!-- Refund dialog -->
  <div v-if="refunding" class="modal-wrap" @click.self="refunding=null">
    <form class="modal" @submit.prevent="submitRefund">
      <header><p><small>REFUND</small><strong>Refund {{refunding.reference}}</strong><span>{{refunding.userEmail}} · paid {{money(refunding.amountMinor,refunding.currency)}}<template v-if="refunding.refundedMinor"> · already refunded {{money(refunding.refundedMinor,refunding.currency)}}</template></span></p><button type="button" @click="refunding=null"><X :size="18"/></button></header>
      <div class="form-grid">
        <p class="full note warn">{{refundForm.recordOnly?'Only books the refund — use this when you already refunded in the Paystack dashboard.':'Paystack sends the money back to the customer’s card or M-Pesa, then the refund is booked.'}} The customer keeps their plan or hours unless you cancel or adjust them separately.</p>
        <label>Amount ({{refunding.currency}})<input v-model="refundForm.amount" type="number" min="0.01" step="0.01" :max="(refunding.amountMinor-refunding.refundedMinor)/100" required></label>
        <label>Reason<input v-model="refundForm.reason" required maxlength="200" placeholder="e.g. Could not connect"></label>
        <label v-if="refunding.partnerCode" class="full check"><input v-model="refundForm.reverseCommission" type="checkbox">Claw back {{refunding.partnerCode}}'s commission on the refunded amount</label>
        <label class="full check"><input v-model="refundForm.recordOnly" type="checkbox">Already refunded in the Paystack dashboard (just record it)</label>
      </div>
      <footer><button type="button" @click="refunding=null">Back</button><button class="primary danger" :disabled="busy==='refund'"><LoaderCircle v-if="busy==='refund'" class="spin" :size="16"/>{{refundForm.recordOnly?'Record refund':'Refund via Paystack'}}</button></footer>
    </form>
  </div>

  <!-- Catalogue dialog -->
  <div v-if="editing" class="modal-wrap" @click.self="editing=null">
    <form class="modal" @submit.prevent="saveCatalog">
      <header><p><small>{{editing.kind==='plan'?'PLAN':'TOP-UP PACKAGE'}}</small><strong>{{editing.id?'Edit':'New'}} {{editing.kind==='plan'?'plan':'package'}}</strong><span>Changes apply to purchases made after saving.</span></p><button type="button" @click="editing=null"><X :size="18"/></button></header>
      <div class="form-grid">
        <label>Name<input v-model="catalogForm.name" required maxlength="100"></label>
        <label>Code<input v-model="catalogForm.code" required pattern="[a-z0-9_\-]+" title="Lowercase letters, numbers and dashes" :disabled="!!editing.id"></label>
        <label>Price<input v-model.number="catalogForm.price" type="number" min="0" step="0.01" required></label>
        <label>Currency<input v-model="catalogForm.currency" required maxlength="3" minlength="3"></label>
        <template v-if="editing.kind==='plan'">
          <label class="full">Description<input v-model="catalogForm.description" maxlength="500" placeholder="Optional"></label>
          <label>Duration (days)<input v-model.number="catalogForm.durationDays" type="number" min="1" required></label>
          <label>Daily time (hours)<input v-model.number="catalogForm.dailyAllowanceHours" type="number" min="0.25" step="0.25" required></label>
          <label>Devices<input v-model.number="catalogForm.maxDevices" type="number" min="1" required></label>
          <label class="full check"><input v-model="catalogForm.isPopular" type="checkbox">Show a "Most Popular" badge</label>
        </template>
        <label v-else>Hours<input v-model.number="catalogForm.hours" type="number" min="0.25" step="0.25" required></label>
        <label>Sort order<input v-model.number="catalogForm.sortOrder" type="number"></label>
        <label class="full check"><input v-model="catalogForm.isActive" type="checkbox">On sale (visible to customers)</label>
      </div>
      <footer><button type="button" @click="editing=null">Cancel</button><button class="primary" :disabled="busy==='catalog'"><LoaderCircle v-if="busy==='catalog'" class="spin" :size="16"/>Save</button></footer>
    </form>
  </div>

  <!-- Customer drawer -->
  <div v-if="customerId" class="drawer-wrap" @click.self="closeCustomer">
    <aside class="drawer">
      <header><span><UserRound :size="18"/></span><p><small>CUSTOMER</small><strong>{{customerEmail}}</strong><button class="link" @click="router.push(`/users/${customerId}`)">View activity →</button></p><button @click="closeCustomer"><X :size="18"/></button></header>
      <div v-if="!customer" class="empty"><LoaderCircle class="spin" :size="20"/></div>
      <template v-else>
        <section class="drawer-status" :class="{off:!customer.status.canConnect}"><i></i><p><strong>{{customer.status.canConnect?'Can connect':reasonText[customer.status.reason||'']||'Cannot connect'}}</strong><small>{{hours(customer.status.totalRemainingSeconds)}} available right now</small></p></section>
        <dl class="drawer-grid">
          <div><dt>Subscription</dt><dd>{{customer.status.subscription?.planName||'None'}}</dd><small v-if="customer.status.subscription">until {{date(customer.status.subscription.expiresAt)}}</small><small v-if="customer.status.upcomingSubscription">renewed to {{date(customer.status.upcomingSubscription.expiresAt)}}</small></div>
          <div><dt>Today</dt><dd>{{hours(customer.status.today.usedSeconds)}}</dd><small>of {{hours(customer.status.today.allowanceSeconds)}}</small></div>
          <div><dt>Extra time</dt><dd>{{hours(customer.status.purchasedSeconds)}}</dd><small>never expires</small></div>
          <div><dt>Pending</dt><dd>{{customer.status.pending.length}}</dd><small>requests</small></div>
        </dl>
        <form class="adjust" @submit.prevent="submitAdjust">
          <h3><Clock :size="15"/>Adjust extra time</h3>
          <div class="seg"><button type="button" :class="{active:!adjust.remove}" @click="adjust.remove=false">Add</button><button type="button" :class="{active:adjust.remove}" @click="adjust.remove=true">Remove</button></div>
          <label>Hours<input v-model.number="adjust.hours" type="number" min="0.25" step="0.25" required></label>
          <label>Reason<input v-model="adjust.note" maxlength="200" placeholder="e.g. Compensation for outage"></label>
          <button class="primary" :disabled="busy==='adjust'||!adjust.hours"><LoaderCircle v-if="busy==='adjust'" class="spin" :size="15"/>{{adjust.remove?'Remove':'Add'}} {{hours(Math.round((adjust.hours||0)*60)*60)}}</button>
        </form>
        <h3>Usage — last 30 days</h3>
        <div v-if="customer.dailyUsage.length" class="usage">
          <div v-for="u in customer.dailyUsage" :key="u.date" :title="`${u.date}: ${hours(u.allowanceSecondsUsed)} daily + ${hours(u.purchasedSecondsUsed)} extra`"><span><i class="allow" :style="{height:`${u.allowanceSecondsUsed/maxUsage*100}%`}"></i><i class="extra" :style="{height:`${u.purchasedSecondsUsed/maxUsage*100}%`}"></i></span><small>{{u.date.slice(8)}}</small></div>
        </div>
        <p v-else class="muted-line">No usage recorded yet.</p>
        <p class="legend"><i class="allow"></i>Daily allowance <i class="extra"></i>Extra time</p>
        <h3>History</h3>
        <ul class="history">
          <li v-for="s in customerSubs" :key="s.id"><BadgeCheck :size="14"/><p><strong>{{s.planName}}</strong><small>{{date(s.requestedAt)}} · {{money(s.priceCents,s.currency)}}</small></p><em :class="isExpired(s)?'expired':s.status.toLowerCase()">{{isExpired(s)?'EXPIRED':s.status}}</em></li>
          <li v-for="t in customerTopups" :key="t.id"><Package :size="14"/><p><strong>{{t.packageName}}</strong><small>{{date(t.requestedAt)}} · {{money(t.priceCents,t.currency)}}</small></p><em :class="t.status.toLowerCase()">{{t.status}}</em></li>
          <li v-if="!customerSubs.length&&!customerTopups.length" class="muted-line">No purchases yet.</li>
        </ul>
      </template>
    </aside>
  </div>
</div>
</template>
