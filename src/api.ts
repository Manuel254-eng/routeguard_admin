const BASE=(import.meta.env.VITE_API_BASE_URL||'http://127.0.0.1:8000/api/v1').replace(/\/$/,'')
const KEY='routeguard.admin.access'
export const session={get token(){return sessionStorage.getItem(KEY)},set token(v:string|null){v?sessionStorage.setItem(KEY,v):sessionStorage.removeItem(KEY)}}
export class ApiError extends Error{constructor(message:string,readonly status:number){super(message)}}
async function req<T>(path:string,options:RequestInit={}):Promise<T>{const headers=new Headers(options.headers);headers.set('Accept','application/json');if(options.body)headers.set('Content-Type','application/json');if(session.token)headers.set('Authorization',`Bearer ${session.token}`);const response=await fetch(`${BASE}${path}`,{...options,headers});const body=response.status===204?null:await response.json().catch(()=>null);if(!response.ok){const d=body?.error?.details;const field=d&&typeof d==='object'?(Object.values(d).flat().find(x=>typeof x==='string') as string|undefined):undefined;throw new ApiError(field||body?.error?.message||body?.detail||`Request failed (${response.status})`,response.status)}return body as T}
export interface Stats{proxies:{total:number;available:number;reserved:number;assigned:number;disabled:number;unhealthy:number};assignments:{active:number;failures:number};users:{total:number;active:number};routingEnabled:boolean}
export interface ProxyRow{id:string;label:string;provider:string;countryCode:string;countryName:string;host:string;port:number;protocol:string;username:string;hasPassword:boolean;allocationMode:string;maxAssignments:number|null;activeAssignmentCount:number;status:string;healthStatus:string;routingEnabled:boolean;updatedAt:string}
export interface LocationRow{countryCode:string;countryName:string;proxies:number;enabled:number;unhealthy:number;activeAssignments:number;providers:string[]}
export interface AuditEvent{id:string;eventType:string;actor:string;resourceType:string;resourceId:string;createdAt:string}
export interface CurrentUser{email:string;username:string;mustChangePassword:boolean}
export const api={async login(email:string,password:string){const x=await req<{access:string}>('/auth/login/',{method:'POST',body:JSON.stringify({email,password})});session.token=x.access},me:()=>req<CurrentUser>('/auth/me/'),changePassword:(currentPassword:string,newPassword:string,code='')=>req<{user:CurrentUser}>('/auth/change-password/',{method:'POST',body:JSON.stringify({currentPassword,newPassword,code})}),passwordCode:()=>req<{sent:boolean;email:string;codeTtlMinutes:number}>('/auth/change-password/code/',{method:'POST'}),dashboard:()=>req<Stats>('/admin/dashboard/'),proxies:()=>req<{count:number;results:ProxyRow[]}>('/admin/proxies/?ordering=-updated_at'),locations:()=>req<LocationRow[]>('/admin/locations/'),audit:()=>req<{count:number;results:AuditEvent[]}>('/admin/audit-events/?ordering=-created_at'),proxyAction:(id:string,action:'enable'|'disable')=>req<ProxyRow>(`/admin/proxies/${id}/${action}/`,{method:'POST'}),createProxy:(payload:Record<string,unknown>)=>req<ProxyRow>('/admin/proxies/',{method:'POST',body:JSON.stringify(payload)}),updateProxy:(id:string,payload:Record<string,unknown>)=>req<ProxyRow>(`/admin/proxies/${id}/`,{method:'PATCH',body:JSON.stringify(payload)})}

// --- billing ------------------------------------------------------------------------------------
export type Page<T>={count:number;results:T[]}
export interface Plan{id:string;code:string;name:string;description:string;priceCents:number;currency:string;durationDays:number;dailyAllowanceMinutes:number;maxDevices:number;isActive:boolean;isPopular:boolean;sortOrder:number}
export interface TopUpPackage{id:string;code:string;name:string;minutes:number;priceCents:number;currency:string;isActive:boolean;sortOrder:number}
export interface SubscriptionRow{id:string;userId:number;userEmail:string;planCode:string;planName:string;status:'PENDING'|'ACTIVE'|'REJECTED'|'CANCELLED';priceCents:number;currency:string;durationDays:number;dailyAllowanceMinutes:number;maxDevices:number;requestedAt:string;decidedAt:string|null;startsAt:string|null;expiresAt:string|null;paymentReference:string;adminNote:string}
export interface TopUpRow{id:string;userId:number;userEmail:string;packageCode:string;packageName:string;status:'PENDING'|'CREDITED'|'REJECTED'|'CANCELLED';minutes:number;priceCents:number;currency:string;requestedAt:string;decidedAt:string|null;paymentReference:string;adminNote:string}
export interface PaymentRow{id:string;reference:string;userId:number;userEmail:string;method:string;status:string;amountMinor:number;currency:string;priceCents:number;priceCurrency:string;fxRate:string;phoneNumber:string;needsReview:boolean;subscriptionId:string|null;topupId:string|null;createdAt:string;paidAt:string|null;partnerCode:string|null;partnerShareMinor:number;splitApplied:boolean;feeMinor:number|null;refundedMinor:number}
interface SubSummary{id:string;planCode:string;planName:string;startsAt:string;expiresAt:string;dailyAllowanceSeconds:number;maxDevices:number}
export interface CustomerBilling{status:{subscription:SubSummary|null;upcomingSubscription:SubSummary|null;today:{allowanceSeconds:number;usedSeconds:number;remainingSeconds:number};purchasedSeconds:number;totalRemainingSeconds:number;canConnect:boolean;reason:string|null;nextResetAt:string;pending:Array<{kind:string;id:string;code:string;name:string;priceCents:number;currency:string;requestedAt:string}>};dailyUsage:Array<{date:string;allowanceSecondsUsed:number;purchasedSecondsUsed:number}>}
export type Decision={paymentReference?:string;note?:string}
const qs=(params:Record<string,string|number|boolean|undefined>)=>{const q=new URLSearchParams();for(const [k,v] of Object.entries(params))if(v!==undefined&&v!=='')q.set(k,String(v));const s=q.toString();return s?`?${s}`:''}
const post=<T>(path:string,body:unknown={})=>req<T>(path,{method:'POST',body:JSON.stringify(body)})
export const billingApi={
  subscriptions:(params:{status?:string;user?:number;page?:number}={})=>req<Page<SubscriptionRow>>(`/admin/billing/subscriptions/${qs(params)}`),
  topups:(params:{status?:string;user?:number;page?:number}={})=>req<Page<TopUpRow>>(`/admin/billing/topups/${qs(params)}`),
  payments:(params:{status?:string;method?:string;needs_review?:boolean;user?:number;page?:number}={})=>req<Page<PaymentRow>>(`/admin/billing/payments/${qs(params)}`),
  subscriptionAction:(id:string,action:'activate'|'reject'|'cancel',body:Decision)=>post<SubscriptionRow>(`/admin/billing/subscriptions/${id}/${action}/`,body),
  topupAction:(id:string,action:'activate'|'reject',body:Decision)=>post<TopUpRow>(`/admin/billing/topups/${id}/${action}/`,body),
  plans:()=>req<Page<Plan>>('/admin/billing/plans/'),
  packages:()=>req<Page<TopUpPackage>>('/admin/billing/packages/'),
  savePlan:(id:string|null,body:Partial<Plan>)=>req<Plan>(id?`/admin/billing/plans/${id}/`:'/admin/billing/plans/',{method:id?'PATCH':'POST',body:JSON.stringify(body)}),
  savePackage:(id:string|null,body:Partial<TopUpPackage>)=>req<TopUpPackage>(id?`/admin/billing/packages/${id}/`:'/admin/billing/packages/',{method:id?'PATCH':'POST',body:JSON.stringify(body)}),
  deletePlan:(id:string)=>req<null>(`/admin/billing/plans/${id}/`,{method:'DELETE'}),
  deletePackage:(id:string)=>req<null>(`/admin/billing/packages/${id}/`,{method:'DELETE'}),
  customer:(userId:number)=>req<CustomerBilling>(`/admin/billing/users/${userId}/`),
  adjustTime:(userId:number,minutes:number,note:string)=>post<CustomerBilling['status']>(`/admin/billing/users/${userId}/`,{minutes,note}),
}

// --- users & activity ---------------------------------------------------------------------------
export interface UserRow{id:number;email:string;name:string;isActive:boolean;role:'admin'|'partner'|'customer';partnerCode:string|null;dateJoined:string;lastLogin:string|null;activeUntil:string|null;usedTodaySeconds:number;lastSeenAt:string|null;sitesLast7Days:number;isTestAccount:boolean}
export interface UserDetail extends UserRow, CustomerBilling{partner:{code:string;name:string}|null}
export interface SiteRow{site:string;activeSeconds:number;connections:number;bytes:number;firstSeenAt:string;lastSeenAt:string;days:number}
export interface SiteActivity{from:string;to:string;retentionDays:number;totals:{sites:number;connections:number;bytes:number;activeSeconds:number};days:Array<{date:string;activeSeconds:number;bytes:number;sites:number}>;sites:SiteRow[]}
export const usersApi={
  list:(params:{search?:string;role?:string;active?:string;ordering?:string;page?:number}={})=>req<Page<UserRow>>(`/admin/users/${qs(params)}`),
  get:(id:number)=>req<UserDetail>(`/admin/users/${id}/`),
  sites:(id:number,params:{days?:number;date?:string})=>req<SiteActivity>(`/admin/users/${id}/sites/${qs(params)}`),
  createTestAccount:(body:{email:string;password:string;firstName?:string;lastName?:string;planCode?:string})=>post<UserRow>('/admin/users/test-accounts/',body),
  deactivate:(id:number)=>post<UserRow>(`/admin/users/${id}/deactivate/`),
  reactivate:(id:number)=>post<UserRow>(`/admin/users/${id}/reactivate/`),
  grantPlan:(id:number,planCode:string,note='')=>post<UserRow>(`/admin/users/${id}/grant-plan/`,{planCode,note}),
}

// --- ledger -----------------------------------------------------------------------------------
export interface LedgerBalance{currency:string;debitMinor:number;creditMinor:number;balanceMinor:number}
export interface LedgerAccount{code:string;key:string;name:string;type:'ASSET'|'LIABILITY'|'EQUITY'|'INCOME'|'EXPENSE';contra:boolean;description:string;balances:LedgerBalance[]}
export interface PartnerPayable{partnerId:string;partnerCode:string;partnerName:string;currency:string;owedMinor:number}
export interface TrialBalance{asOf:string|null;accounts:LedgerAccount[];totals:Array<{currency:string;debitMinor:number;creditMinor:number;balanced:boolean}>;partnerPayables:PartnerPayable[]}
export interface StatementLine{code:string;key:string;name:string;amountMinor:number}
export interface IncomeStatement{from:string;to:string;currencies:Array<{currency:string;income:StatementLine[];expenses:StatementLine[];incomeMinor:number;expensesMinor:number;netMinor:number}>}
export interface LedgerLine{account:string;accountCode:string;accountName:string;debitMinor:number;creditMinor:number;partnerCode:string|null;customerEmail:string|null;customerId:number|null;memo:string}
export interface LedgerEntry{id:number;date:string;kind:string;kindLabel:string;memo:string;currency:string;reference:string;sourceType:string;sourceId:string;reversesId:number|null;reversedById:number|null;createdBy:string|null;createdAt:string;amountMinor:number;lines:LedgerLine[]}
export interface Reconciliation{ok:boolean;checkedAt:string;entries:number;timeEntries:number;problems:Array<{check:string;detail:string}>}
export interface TimeLedgerEntry{id:number;userId:number;userEmail:string;kind:string;kindLabel:string;seconds:number;balanceAfter:number;reference:string;note:string;actor:string|null;createdAt:string}
export interface ChartAccount{code:string;key:string;name:string;type:string}
export const ledgerApi={
  accounts:(asOf?:string)=>req<TrialBalance>(`/admin/ledger/accounts/${qs({asOf})}`),
  chart:()=>req<ChartAccount[]>('/admin/ledger/chart/'),
  income:(from:string,to:string)=>req<IncomeStatement>(`/admin/ledger/income-statement/${qs({from,to})}`),
  entries:(params:{kind?:string;account?:string;partner?:string;customer?:number;from?:string;to?:string;source?:string;page?:number}={})=>req<Page<LedgerEntry>>(`/admin/ledger/entries/${qs(params)}`),
  manual:(body:{memo:string;currency?:string;date?:string;reference?:string;lines:Array<{account:string;debitMinor:number;creditMinor:number;partnerCode?:string;memo?:string}>})=>post<LedgerEntry>('/admin/ledger/entries/',body),
  reverse:(id:number,memo='')=>post<LedgerEntry>(`/admin/ledger/entries/${id}/reverse/`,{memo}),
  payout:(body:{partnerCode:string;amountMinor:number;currency?:string;reference?:string;note?:string})=>post<LedgerEntry>('/admin/ledger/payouts/',body),
  settlement:(body:{amountMinor:number;currency?:string;reference?:string;note?:string;date?:string})=>post<LedgerEntry>('/admin/ledger/settlements/',body),
  reconcile:()=>req<Reconciliation>('/admin/ledger/reconcile/'),
  time:(params:{user?:number;kind?:string;hideUsage?:boolean;page?:number}={})=>req<Page<TimeLedgerEntry>>(`/admin/ledger/time/${qs(params)}`),
  refund:(paymentId:string,body:{amountMinor?:number;reason:string;reverseCommission:boolean;recordOnly:boolean})=>post<PaymentRow&{ledgerEntryId:number}>(`/admin/billing/payments/${paymentId}/refund/`,body),
}
