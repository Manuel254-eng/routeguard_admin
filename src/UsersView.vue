<script setup lang="ts">
import {computed,reactive,ref,watch} from 'vue'
import {useRoute,useRouter} from 'vue-router'
import {AlertTriangle,ArrowLeft,BadgeCheck,Clock,FlaskConical,Gift,Globe2,Info,LoaderCircle,Power,RefreshCw,Search,X} from 'lucide-vue-next'
import {ApiError,billingApi,ledgerApi,usersApi,type Plan,type SiteActivity,type TimeLedgerEntry,type UserDetail,type UserRow} from './api'

const emit=defineEmits<{unauthorized:[]}>()
const route=useRoute(),router=useRouter()
const userId=computed(()=>route.name==='user-detail'?Number(route.params.id):null)
const loading=ref(false),error=ref('')
const fail=(e:unknown)=>{if(e instanceof ApiError&&e.status===401){emit('unauthorized');return}error.value=e instanceof ApiError&&e.status===403?'This account does not have administrator access.':e instanceof Error?e.message:'Something went wrong.'}

// --- formatting ---
const dur=(s:number)=>{const m=Math.round(s/60);if(m<60)return `${m} min`;const h=Math.floor(m/60),r=m%60;return r?`${h} h ${r} min`:`${h} h`}
const size=(b:number)=>b<1024?`${b} B`:b<1048576?`${(b/1024).toFixed(0)} KB`:b<1073741824?`${(b/1048576).toFixed(1)} MB`:`${(b/1073741824).toFixed(2)} GB`
const ago=(v:string|null)=>{if(!v)return '—';const m=(Date.now()-new Date(v).getTime())/60000;return m<1?'just now':m<60?`${Math.floor(m)} min ago`:m<1440?`${Math.floor(m/60)} h ago`:new Intl.DateTimeFormat('en',{month:'short',day:'numeric'}).format(new Date(v))}
const date=(v:string|null)=>v?new Intl.DateTimeFormat('en',{month:'short',day:'numeric',year:'numeric'}).format(new Date(v)):'—'
const dateTime=(v:string|null)=>v?new Intl.DateTimeFormat('en',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(v)):'—'
const dayLabel=(d:string)=>new Intl.DateTimeFormat('en',{weekday:'short',day:'numeric',timeZone:'UTC'}).format(new Date(`${d}T00:00:00Z`))

// --- list ---
const users=ref<UserRow[]>([]),count=ref(0)
const q=computed(()=>({search:typeof route.query.search==='string'?route.query.search:'',role:typeof route.query.role==='string'?route.query.role:'',ordering:typeof route.query.ordering==='string'?route.query.ordering:'-lastSeenAt',page:Math.max(1,Number(route.query.page)||1)}))
const searchText=ref(q.value.search)
const pages=computed(()=>Math.max(1,Math.ceil(count.value/50)))
const setQuery=(patch:Record<string,string|number|undefined>)=>void router.replace({query:{...route.query,...patch}})
let searchTimer:number|undefined
watch(searchText,v=>{clearTimeout(searchTimer);searchTimer=window.setTimeout(()=>setQuery({search:v||undefined,page:undefined}),300)})
const roles:Array<[string,string]>=[['','Everyone'],['customer','Customers'],['partner','Partners'],['admin','Admins'],['test','Test accounts']]

// --- account actions: test accounts, deactivate / reactivate, free plans ---
const notice=ref(''),busy=ref(false),plans=ref<Plan[]>([])
async function loadPlans(){if(!plans.value.length){try{plans.value=(await billingApi.plans()).results.filter(p=>p.isActive)}catch(e){fail(e)}}}
const planLabel=(p:Plan)=>`${p.name} · ${p.durationDays>=360?'yearly':'monthly'}`
function randomPassword(){const c='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';const a=new Uint32Array(14);crypto.getRandomValues(a);return Array.from(a,n=>c[n%c.length]).join('')+'-1'}
const testForm=reactive({open:false,email:'',password:'',firstName:'Test',lastName:'Reviewer',planCode:''})
async function openTestForm(){await loadPlans();Object.assign(testForm,{open:true,email:'',password:randomPassword(),firstName:'Test',lastName:'Reviewer',planCode:plans.value.find(p=>p.code==='plus-yearly')?.code??plans.value[0]?.code??''})}
async function submitTestAccount(){busy.value=true;error.value='';try{const u=await usersApi.createTestAccount({email:testForm.email.trim(),password:testForm.password,firstName:testForm.firstName,lastName:testForm.lastName,planCode:testForm.planCode});notice.value=`Test account ${u.email} created. Password: ${testForm.password} — copy it now; it isn't shown again.`;testForm.open=false;void router.push(`/users/${u.id}`)}catch(e){fail(e)}finally{busy.value=false}}
async function toggleActive(){
  const u=user.value;if(!u)return
  if(u.isActive&&!confirm(`Deactivate ${u.email}? They are signed out everywhere and can't sign in or connect until reactivated.`))return
  busy.value=true;error.value=''
  try{const r=u.isActive?await usersApi.deactivate(u.id):await usersApi.reactivate(u.id);user.value={...u,isActive:r.isActive};notice.value=r.isActive?`${u.email} can sign in again.`:`${u.email} is deactivated.`}catch(e){fail(e)}finally{busy.value=false}
}
const grant=reactive({open:false,planCode:''})
async function openGrant(){await loadPlans();Object.assign(grant,{open:true,planCode:user.value?.status.subscription?.planCode??plans.value[0]?.code??''})}
async function submitGrant(){const u=user.value;if(!u)return;busy.value=true;error.value='';try{await usersApi.grantPlan(u.id,grant.planCode);grant.open=false;const id=u.id;user.value=null;await loadUser(id);notice.value='Plan granted free. If they already had a plan, it starts when the current one ends.'}catch(e){fail(e)}finally{busy.value=false}}
const sorts:Array<[string,string]>=[['-lastSeenAt','Recently active'],['-usedTodaySeconds','Most time today'],['-dateJoined','Newest'],['email','Email A–Z']]
async function loadList(){loading.value=true;error.value='';try{const r=await usersApi.list({...q.value,search:q.value.search||undefined,role:q.value.role||undefined});users.value=r.results;count.value=r.count}catch(e){fail(e)}finally{loading.value=false}}

// --- detail ---
const user=ref<UserDetail|null>(null),activity=ref<SiteActivity|null>(null),siteFilter=ref('')
const ranges:Array<[string,string]>=[['1','Today'],['7','7 days'],['30','30 days']]
const range=computed(()=>typeof route.query.date==='string'?'':typeof route.query.days==='string'?route.query.days:'7')
const selectedDate=computed(()=>typeof route.query.date==='string'?route.query.date:'')
const maxDay=computed(()=>Math.max(1,...(activity.value?.days??[]).map(d=>d.activeSeconds)))
const shownSites=computed(()=>{const f=siteFilter.value.trim().toLowerCase();const s=activity.value?.sites??[];return f?s.filter(x=>x.site.includes(f)):s})
const maxSite=computed(()=>Math.max(1,...(activity.value?.sites??[]).map(s=>s.activeSeconds)))
const timeLedger=ref<TimeLedgerEntry[]>([])
const signed=(s:number)=>`${s<0?'−':'+'}${dur(Math.abs(s))}`
async function loadUser(id:number){loading.value=true;error.value='';try{const [u,a,t]=await Promise.all([user.value?.id===id?Promise.resolve(user.value):usersApi.get(id),usersApi.sites(id,selectedDate.value?{date:selectedDate.value}:{days:Number(range.value)||7}),ledgerApi.time({user:id,hideUsage:true})]);user.value=u;activity.value=a;timeLedger.value=t.results}catch(e){fail(e)}finally{loading.value=false}}
const pickDay=(d:string)=>setQuery({date:selectedDate.value===d?undefined:d,days:selectedDate.value===d?range.value||'7':undefined})

function reload(){if(userId.value)void loadUser(userId.value);else void loadList()}
watch(()=>route.fullPath,()=>{if(route.name!=='users'&&route.name!=='user-detail')return;if(!userId.value){user.value=null;activity.value=null}reload()},{immediate:true})
defineExpose({reload})
</script>

<template>
<div class="page users">
  <div v-if="error" class="alert billing-alert"><AlertTriangle :size="17"/>{{error}}<button @click="error=''">×</button></div>
  <div v-if="notice" class="alert billing-alert ok"><BadgeCheck :size="17"/>{{notice}}<button @click="notice=''">×</button></div>

  <!-- List -->
  <section v-if="!userId" class="panel table-panel">
    <div class="tools users-tools">
      <label><Search :size="17"/><input v-model="searchText" placeholder="Search email or name"></label>
      <div class="chips"><button v-for="[v,l] in roles" :key="v" :class="{active:q.role===v}" @click="setQuery({role:v||undefined,page:undefined})">{{l}}</button></div>
      <select class="sort" :value="q.ordering" @change="setQuery({ordering:($event.target as HTMLSelectElement).value,page:undefined})"><option v-for="[v,l] in sorts" :key="v" :value="v">{{l}}</option></select>
      <button class="icon" title="Refresh" @click="reload"><RefreshCw :class="{spin:loading}" :size="17"/></button>
      <button class="primary add-test" @click="openTestForm"><FlaskConical :size="16"/>Add test account</button>
    </div>
    <div class="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Plan</th><th>Time today</th><th>Sites (7 days)</th><th>Last active</th><th>Joined</th></tr></thead><tbody>
      <tr v-for="u in users" :key="u.id" class="clickable" @click="router.push(`/users/${u.id}`)"><td><b>{{u.email}}</b><small>{{u.name||'—'}}<template v-if="!u.isActive"> · <span class="suspended">suspended</span></template></small></td><td><em :class="u.role">{{u.role.toUpperCase()}}</em><em v-if="u.isTestAccount" class="test">TEST</em><small v-if="u.partnerCode">via {{u.partnerCode}}</small></td><td><template v-if="u.activeUntil">Active<small>until {{date(u.activeUntil)}}</small></template><span v-else class="muted-cell">None</span></td><td>{{u.usedTodaySeconds?dur(u.usedTodaySeconds):'—'}}</td><td>{{u.sitesLast7Days||'—'}}</td><td>{{ago(u.lastSeenAt)}}</td><td>{{date(u.dateJoined)}}</td></tr>
      <tr v-if="!users.length&&!loading"><td colspan="7" class="empty">No users match.</td></tr>
    </tbody></table></div>
    <footer class="pager"><span>{{count}} users</span><template v-if="pages>1"><button :disabled="q.page<=1" @click="setQuery({page:q.page-1>1?q.page-1:undefined})">Previous</button><span>Page {{q.page}} of {{pages}}</span><button :disabled="q.page>=pages" @click="setQuery({page:q.page+1})">Next</button></template></footer>
  </section>

  <!-- Detail -->
  <template v-else>
    <button class="back" @click="router.push('/users')"><ArrowLeft :size="15"/>All users</button>
    <div v-if="!user" class="empty"><LoaderCircle class="spin" :size="20"/></div>
    <template v-else>
      <section class="panel profile">
        <div class="avatar">{{(user.email||'?')[0].toUpperCase()}}</div>
        <div class="who"><h2>{{user.email}}</h2><p>{{user.name||'No name'}} · <em :class="user.role">{{user.role.toUpperCase()}}</em><em v-if="user.isTestAccount" class="test">TEST</em><span v-if="!user.isActive" class="suspended"> · deactivated</span></p></div>
        <div v-if="user.role!=='admin'" class="user-actions">
          <button v-if="user.role==='customer'" class="row-action edit" :disabled="busy" @click="openGrant"><Gift :size="13"/>Grant plan</button>
          <button class="row-action" :class="user.isActive?'danger':'edit'" :disabled="busy" @click="toggleActive"><Power :size="13"/>{{user.isActive?'Deactivate':'Reactivate'}}</button>
        </div>
        <dl>
          <div><dt>Plan</dt><dd>{{user.status.subscription?.planName||'None'}}</dd><small v-if="user.status.subscription">until {{date(user.status.subscription.expiresAt)}}</small></div>
          <div><dt>Time today</dt><dd>{{dur(user.status.today.usedSeconds)}}</dd><small>of {{dur(user.status.today.allowanceSeconds)}}</small></div>
          <div><dt>Extra time</dt><dd>{{dur(user.status.purchasedSeconds)}}</dd></div>
          <div><dt>Partner</dt><dd>{{user.partner?.name||'—'}}</dd><small v-if="user.partner">{{user.partner.code}}</small></div>
          <div><dt>Joined</dt><dd>{{date(user.dateJoined)}}</dd><small>last sign-in {{ago(user.lastLogin)}}</small></div>
        </dl>
      </section>

      <section class="panel">
        <div class="panel-head"><p><strong>Sites visited</strong><small>{{activity?(activity.from===activity.to?dayLabel(activity.from):`${dayLabel(activity.from)} – ${dayLabel(activity.to)}`):''}} · UTC days</small></p>
          <div class="chips"><button v-for="[v,l] in ranges" :key="v" :class="{active:range===v&&!selectedDate}" @click="setQuery({days:v,date:undefined})">{{l}}</button><button class="icon small" title="Refresh" @click="reload"><RefreshCw :class="{spin:loading}" :size="14"/></button></div>
        </div>
        <div v-if="activity" class="activity">
          <div class="totals">
            <p><Globe2 :size="16"/><span><b>{{activity.totals.sites}}</b>sites</span></p>
            <p><Clock :size="16"/><span><b>{{dur(activity.totals.activeSeconds)}}</b>time online</span></p>
            <p><span><b>{{activity.totals.connections}}</b>connections</span></p>
            <p><span><b>{{size(activity.totals.bytes)}}</b>data</span></p>
          </div>
          <div v-if="activity.days.length>1" class="day-bars">
            <button v-for="d in activity.days" :key="d.date" :class="{on:selectedDate===d.date}" :title="`${d.date}: ${dur(d.activeSeconds)} online · ${d.sites} sites · ${size(d.bytes)}`" @click="pickDay(d.date)"><span><i :style="{height:`${d.activeSeconds/maxDay*100}%`}"></i></span><small>{{dayLabel(d.date)}}</small></button>
          </div>
          <p v-if="selectedDate" class="day-note">Showing {{dayLabel(selectedDate)}} only. <button class="link" @click="pickDay(selectedDate)">Show the whole range</button></p>
          <div class="tools"><label><Search :size="16"/><input v-model="siteFilter" placeholder="Filter sites"></label><small>{{shownSites.length}} sites</small></div>
          <div class="table-wrap"><table class="sites"><thead><tr><th>Site</th><th>Time</th><th>Connections</th><th>Data</th><th>Days</th><th>Last visit</th></tr></thead><tbody>
            <tr v-for="s in shownSites" :key="s.site"><td><b class="site">{{s.site}}</b><span class="bar"><i :style="{width:`${s.activeSeconds/maxSite*100}%`}"></i></span></td><td>{{s.activeSeconds?dur(s.activeSeconds):'< 1 min'}}</td><td>{{s.connections}}</td><td>{{size(s.bytes)}}</td><td>{{s.days}}</td><td>{{dateTime(s.lastSeenAt)}}<small>first {{dateTime(s.firstSeenAt)}}</small></td></tr>
            <tr v-if="!shownSites.length"><td colspan="6" class="empty">No activity recorded for this period.</td></tr>
          </tbody></table></div>
          <p class="privacy"><Info :size="13"/>Only site names are recorded — secure (HTTPS) connections hide individual pages and content. “Time online” counts each minute with any traffic once. A site’s time counts the minutes in which data moved to that site — one page loads several sites at once (fonts, ads, video servers), so site times add up to more than the time online. Records are kept {{activity.retentionDays}} days, and each view of this page is logged in Audit activity.</p>
        </div>
      </section>
      <section class="panel table-panel">
        <div class="panel-head"><p><strong>Extra time ledger</strong><small>Hours bought, granted and adjusted (minute-by-minute usage in Books → Time ledger)</small></p><button @click="router.push({path:'/books',query:{tab:'time',user:String(user.id)}})">Full ledger</button></div>
        <div class="table-wrap"><table class="compact"><thead><tr><th>When</th><th>What</th><th>Change</th><th>Balance after</th><th>By</th></tr></thead><tbody>
          <tr v-for="t in timeLedger" :key="t.id"><td>{{dateTime(t.createdAt)}}</td><td>{{t.kindLabel}}<small v-if="t.note">{{t.note}}</small></td><td :class="{neg:t.seconds<0}">{{signed(t.seconds)}}</td><td>{{dur(t.balanceAfter)}}</td><td>{{t.actor||'System'}}</td></tr>
          <tr v-if="!timeLedger.length"><td colspan="5" class="empty">No extra time bought or granted yet.</td></tr>
        </tbody></table></div>
      </section>
    </template>
  </template>

  <!-- Add test account -->
  <div v-if="testForm.open" class="modal-wrap" @click.self="testForm.open=false">
    <form class="modal" @submit.prevent="submitTestAccount">
      <header><p><small>TEST ACCOUNT</small><strong>Add a test account</strong><span>Signs in straight away (no email code) with a plan granted free. Use it for app-store reviewers or your own checks.</span></p><button type="button" @click="testForm.open=false"><X :size="18"/></button></header>
      <div class="form-grid">
        <label class="full">Email<input v-model="testForm.email" type="email" required placeholder="reviewer@finances.tools"></label>
        <label class="full">Password<div class="pw-row"><input v-model="testForm.password" required minlength="8" autocomplete="off" spellcheck="false"><button type="button" class="row-action" @click="testForm.password=randomPassword()">Generate</button></div><small class="hint-small">Shown once after creating — copy it for the reviewer notes.</small></label>
        <label>First name<input v-model="testForm.firstName" maxlength="150"></label>
        <label>Last name<input v-model="testForm.lastName" maxlength="150"></label>
        <label class="full">Plan<select v-model="testForm.planCode"><option value="">No plan</option><option v-for="p in plans" :key="p.code" :value="p.code">{{planLabel(p)}}</option></select></label>
      </div>
      <footer><button type="button" @click="testForm.open=false">Cancel</button><button class="primary" :disabled="busy"><LoaderCircle v-if="busy" class="spin" :size="16"/>Create test account</button></footer>
    </form>
  </div>

  <!-- Grant plan -->
  <div v-if="grant.open && user" class="modal-wrap" @click.self="grant.open=false">
    <form class="modal" @submit.prevent="submitGrant">
      <header><p><small>FREE PLAN</small><strong>Grant a plan</strong><span>{{user.email}} · no payment and nothing booked. If they already have a plan, this one starts when it ends.</span></p><button type="button" @click="grant.open=false"><X :size="18"/></button></header>
      <div class="form-grid"><label class="full">Plan<select v-model="grant.planCode" required><option v-for="p in plans" :key="p.code" :value="p.code">{{planLabel(p)}}</option></select></label></div>
      <footer><button type="button" @click="grant.open=false">Cancel</button><button class="primary" :disabled="busy||!grant.planCode"><LoaderCircle v-if="busy" class="spin" :size="16"/>Grant plan</button></footer>
    </form>
  </div>
</div>
</template>
