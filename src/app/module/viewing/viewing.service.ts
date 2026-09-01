import httpStatus from 'http-status'
import mongoose, { type ClientSession } from 'mongoose'
import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import { IGenericResponse, IPaginationOptions } from '../../../interfaces/common'
import { logger } from '../../../shared/logger'
import { Metrics } from '../../../shared/metrics'
import { mongoSupportsTransactions } from '../../db/mongoCapabilities'
import paginationHelper from '../../helpers/paginationHelper'
import { createQueryProfile } from '../../helpers/queryPerformance'
import { safeRegexPattern } from '../../helpers/searchQuery'
import { normalizeBangladeshPhone } from '../../helpers/identity'
import { PrivacyConsentService } from '../privacy/privacyConsent.service'
import { PrivacyPolicyService } from '../privacy/privacyPolicy.service'
import { CrmService } from '../crm/crm.service'
import { canManageTeamCrm, crmMutationOwnerFilter, crmReadOwnerFilter, type CrmAccessContext } from '../crm/crmAccess'
import { CrmAssignableMemberService } from '../crm/crmAssignableMember.service'
import { DomainEventService, type DomainEventInput } from '../domainEvent/domainEvent.service'
import { LeadService } from '../lead/lead.service'
import { Lead } from '../lead/lead.model'
import { LeadLifecycleService, type LifecycleEffects } from '../lead/leadLifecycle.service'
import { LEAD_STATUS } from '../lead/leadStatus.contract'
import { OperationsQueueService } from '../operationsQueue/operationsQueue.service'
import { Property } from '../property/property.model'
import { VIEWING_REQUESTABLE_PROPERTY_STATUSES } from '../property/property.constants'
import { Organization } from '../organization/organization.model'
import { userRefPopulate } from '../user/userProfile.service'
import { IViewing, IViewingCalendarFilter, IViewingFilter, ViewingCalendarItem } from './viewing.interface'
import { Viewing } from './viewing.model'
import type { PublicViewingRequestInput } from './viewing.validation'
import { TenantPurgeBarrier } from '../compliance/tenantPurgeBarrier.service'
import { TenantAccessService } from '../tenantAccess/tenantAccess.service'
const normalizePhone=(value:string)=>{try{return normalizeBangladeshPhone(value)}catch(error){throw new ApiError(400,(error as Error).message)}}
const timeToMinutes=(time:string)=>{const[h,m]=time.split(':').map(Number);return h*60+m}
const viewingStartMs=(date:string,startTime:string)=>Date.parse(`${date}T${startTime}:00+06:00`)
const assertViewingWindowIsFuture=(date:string,startTime:string)=>{const start=viewingStartMs(date,startTime);if(!Number.isFinite(start)||start<=Date.now())throw new ApiError(400,'This time has already passed. Choose a future viewing time.','','VIEWING_TIME_PAST',undefined,{startTime:['Viewing time must be in the future']})}
const referenceId=(value:unknown):string|undefined=>{if(value===undefined||value===null||value==='')return undefined;if(typeof value==='object'&&value!==null&&'_id' in value)return String((value as {_id:unknown})._id);return String(value)}
const withSession=<T extends {session:(session:ClientSession)=>T}>(query:T,session?:ClientSession):T=>session?query.session(session):query
// status:'Available',quotaLocked:{ $ne:true }
const assertViewingRequestableProperty=async(organizationId:string,propertyId:string,session?:ClientSession)=>{const query=Property.findOne({_id:propertyId,organizationId,quotaLocked:{$ne:true}}).select('agentId status title').lean();const property:any=await withSession(query as any,session);if(!property)throw new ApiError(404,'Property not found');if(!VIEWING_REQUESTABLE_PROPERTY_STATUSES.includes(property.status))throw new ApiError(409,'This property is no longer accepting viewing requests.','','PROPERTY_VIEWING_UNAVAILABLE');return property}
const assertViewingLead=async(organizationId:string,leadId:string,access?:CrmAccessContext)=>{if(access){await LeadService.getLeadById(organizationId,leadId,access);return}const lead=await Lead.exists({_id:leadId,organizationId});if(!lead)throw new ApiError(400,'Linked lead must belong to this agency')}
const checkConflict=async(organizationId:string,agentId:string,propertyId:string,date:string,startTime:string,endTime:string,excludeViewingId?:string,session?:ClientSession)=>{const start=timeToMinutes(startTime),end=timeToMinutes(endTime);if(end<=start)return{hasConflict:true,reason:'End time must be after start time',code:'VIEWING_INVALID_WINDOW'};const query:any={organizationId,date,status:{$in:['Scheduled','Confirmed']},startTime:{$lt:endTime},endTime:{$gt:startTime},$or:[{agentId},{propertyId}]};if(excludeViewingId)query._id={$ne:excludeViewingId};let cursor:any=Viewing.findOne(query).select('agentId propertyId startTime endTime');if(session)cursor=cursor.session(session);const conflict:any=await cursor.lean();if(!conflict)return{hasConflict:false};if(String(conflict.agentId)===String(agentId))return{hasConflict:true,reason:`Agent is already booked (${conflict.startTime} - ${conflict.endTime})`,code:'VIEWING_AGENT_BUSY'};return{hasConflict:true,reason:`Property already has a viewing (${conflict.startTime} - ${conflict.endTime})`,code:'VIEWING_SLOT_UNAVAILABLE'}}
const scheduleReminder=async(viewing:any,options:{session?:ClientSession;viewingMinutesBefore?:number}={})=>{const viewingMinutesBefore=options.viewingMinutesBefore??Number((await CrmService.getConfig(viewing.organizationId)).reminders?.viewingMinutesBefore||0);const when=new Date(`${viewing.date}T${viewing.startTime}:00+06:00`);const runAt=new Date(when.getTime()-viewingMinutesBefore*60_000);await OperationsQueueService.schedule({organizationId:viewing.organizationId,type:'viewing_reminder',entityId:viewing._id.toString(),runAt,payload:{agentId:referenceId(viewing.agentId)}},{session:options.session})}
const createViewing=async(organizationId:string,payload:Partial<IViewing>,actorId?:string,access?:CrmAccessContext):Promise<IViewing>=>{if(access&&!canManageTeamCrm(access)&&String(payload.agentId||'')!==access.userId)throw new ApiError(403,'Team members can only schedule viewings assigned to themselves');await CrmAssignableMemberService.assertAssignableMember(organizationId,String(payload.agentId||''),'viewing');if(payload.leadId)await assertViewingLead(organizationId,String(payload.leadId),access);assertViewingWindowIsFuture(payload.date!,payload.startTime!);await assertViewingRequestableProperty(organizationId,String(payload.propertyId));const conflict=await checkConflict(organizationId,String(payload.agentId),String(payload.propertyId),payload.date!,payload.startTime!,payload.endTime!);if(conflict.hasConflict)throw new ApiError(409,conflict.reason||'Viewing conflict','',conflict.code||'VIEWING_SLOT_UNAVAILABLE');const result:any=await Viewing.create({...payload,organizationId,clientPhone:payload.clientPhone?normalizePhone(payload.clientPhone):payload.clientPhone});await scheduleReminder(result);if(payload.leadId)await LeadLifecycleService.changeStatus(organizationId,String(payload.leadId),LEAD_STATUS.VIEWING_SCHEDULED,{actorId:actorId||String(payload.agentId),access,reason:'Viewing scheduled'});await OperationsQueueService.schedule({organizationId,type:'calendar_sync',entityId:result._id.toString(),runAt:new Date(Date.now()+1_000)});await DomainEventService.emit({organizationId,aggregateType:'viewing',aggregateId:result._id.toString(),eventType:'viewing.scheduled',leadId:referenceId(result.leadId),propertyId:referenceId(result.propertyId),actorId:actorId||referenceId(result.agentId),payload:{summary:`Viewing scheduled for ${result.date} at ${result.startTime}`,clientName:result.clientName}});return result}
const resolvePublicViewingAgent = async (organizationId:string, preferredAgentId?:string):Promise<string> => {
  if (preferredAgentId) {
    const preferred = await CrmAssignableMemberService.getAssignableMemberForCapabilities(organizationId, preferredAgentId, ['viewing', 'lead'])
    if (preferred?._id) return preferred._id.toString()
  }
  const organization:any = await Organization.findOne({ organizationId }).select('ownerId').lean()
  if (organization?.ownerId) {
    const owner = await CrmAssignableMemberService.getAssignableMemberForCapabilities(organizationId, String(organization.ownerId), ['viewing', 'lead'])
    if (owner?._id) return owner._id.toString()
  }
  const fallback = await CrmAssignableMemberService.listAssignableMembersForCapabilities(organizationId, ['viewing', 'lead'])
  if (!fallback[0]?._id) throw new ApiError(503, 'This agency is not accepting viewing requests right now', '', 'VIEWING_AGENT_UNAVAILABLE')
  return fallback[0]._id.toString()
}

const publicRequestViewing=async(payload:PublicViewingRequestInput,context:{ip?:string;requestId?:string}):Promise<IViewing>=>{
  const{organizationId,propertyId,date,startTime,endTime,clientName,clientPhone,clientEmail,notes,privacyConsent,policyVersion,attribution}=payload
  await TenantAccessService.assertPublicWebsiteAccess(organizationId)
  await TenantPurgeBarrier.assertTenantWritable(organizationId)
  assertViewingWindowIsFuture(date,startTime)
  const prop:any=await assertViewingRequestableProperty(organizationId,propertyId)
  if(!privacyConsent)throw new ApiError(400,'Privacy consent is required','','VALIDATION_ERROR',undefined,{privacyConsent:['Privacy consent is required']})
  await PrivacyPolicyService.assertCurrentPublicPolicy(policyVersion)
  const agentId=await resolvePublicViewingAgent(organizationId,prop.agentId?.toString())
  const conflict=await checkConflict(organizationId,agentId,propertyId,date,startTime,endTime)
  if(conflict.hasConflict)throw new ApiError(409,conflict.reason||'Viewing conflict','',conflict.code||'VIEWING_SLOT_UNAVAILABLE')
  const normalizedPhone=normalizePhone(clientPhone)
  const lead:any=await LeadService.createLead(organizationId,{name:clientName,phone:normalizedPhone,email:clientEmail,source:'Website',leadStatus:LEAD_STATUS.NEW,assignedAgent:agentId,propertyInterest:[propertyId],notes:notes||'',attribution},undefined,undefined,{allowanceSource:'website'})
  await PrivacyConsentService.recordPublicPrivacyPolicy(organizationId,normalizedPhone,policyVersion,context)
  return createViewing(organizationId,{propertyId,agentId,leadId:lead._id,date,startTime,endTime,clientName,clientPhone:normalizedPhone,clientEmail,status:'Scheduled',notes},agentId)
}
const VIEWING_LIST_SORT_FIELDS = new Set(['createdAt', 'updatedAt', 'date', 'status', 'clientName'])

const getAllViewings = async (
  filters: IViewingFilter,
  paginationOptions: IPaginationOptions,
  access?: CrmAccessContext,
): Promise<IGenericResponse<IViewing[]>> => {
  const { searchTerm, organizationId, propertyId, agentId, leadId, status, date, startDate, endDate, viewMode = 'list' } = filters
  const conditions: any[] = []
  if (organizationId) conditions.push({ organizationId })
  const ownerScope = crmReadOwnerFilter('agentId', access)
  if (Object.keys(ownerScope).length) conditions.push(ownerScope)
  if (propertyId) conditions.push({ propertyId })
  if (agentId) conditions.push({ agentId })
  if (leadId) conditions.push({ leadId })
  if (status) conditions.push({ status })
  if (date) conditions.push({ date })
  if (startDate || endDate) conditions.push({ date: { ...(startDate ? { $gte: startDate } : {}), ...(endDate ? { $lte: endDate } : {}) } })
  if (searchTerm) {
    const raw = String(searchTerm).trim()
    const search = safeRegexPattern(raw)
    const prefix = { $regex: `^${search}`, $options: 'i' }
    if (raw.includes('@')) conditions.push({ clientEmail: { $regex: `^${search}$`, $options: 'i' } })
    else if (/^[+()\d\s-]{6,30}$/.test(raw)) conditions.push({ clientPhone: raw })
    else conditions.push({ $or: [{ clientName: prefix }, { notes: prefix }] })
  }

  const where = conditions.length ? { $and: conditions } : {}
  const calendarMode = viewMode === 'calendar'
  const { page, limit, skip, sortBy, sortOrder } = paginationHelper.calculatePagination(
    paginationOptions,
    calendarMode ? { sortBy: 'date', sortOrder: 'asc' } : { sortBy: 'createdAt', sortOrder: 'desc' },
  )
  const sort = calendarMode
    ? paginationHelper.buildCalendarSort()
    : paginationHelper.buildAllowedStableSort(sortBy, sortOrder, VIEWING_LIST_SORT_FIELDS, 'createdAt')

  const profile = createQueryProfile('/api/v1/viewing', String(organizationId || ''))
  const [result, total] = await profile.db(() => Promise.all([
    Viewing.find(where)
      .populate({ path: 'propertyId', select: 'title price images address city', match: { organizationId } })
      .populate(userRefPopulate('agentId', 'name email phoneNumber userRole', { organizationId }))
      .populate({ path: 'leadId', select: 'name phone email leadStatus', match: { organizationId, isLocked: { $ne: true } } })
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Viewing.countDocuments(where),
  ]), 2)
  profile.finish(result.length, { paginationMode: 'page', calendarMode })
  return { meta: { page, limit, total, paginationMode: 'page' }, data: result as IViewing[] }
}
const getCalendarViewings = async (filters: IViewingCalendarFilter, access?: CrmAccessContext): Promise<ViewingCalendarItem[]> => {
  const { organizationId, startDate, endDate, status, propertyId, agentId } = filters
  const where: Record<string, unknown> = {
    organizationId,
    ...crmReadOwnerFilter('agentId', access),
    date: { $gte: startDate, $lte: endDate },
    ...(status ? { status } : {}),
    ...(propertyId ? { propertyId } : {}),
    ...(agentId ? { agentId } : {}),
  }

  const rows: any[] = await Viewing.find(where)
    .select('_id date startTime endTime status clientName propertyId agentId')
    .populate({ path: 'propertyId', select: 'title city', match: { organizationId } })
    .populate(userRefPopulate('agentId', 'name', { organizationId }))
    .sort(paginationHelper.buildCalendarSort())
    .limit(2001)
    .lean()

  if (rows.length > 2000) {
    throw new ApiError(413, 'Too many viewings in this calendar range. Narrow the date range or filters.')
  }

  return rows.map((row) => ({
    _id: String(row._id),
    date: row.date,
    startTime: row.startTime,
    endTime: row.endTime,
    status: row.status,
    clientName: row.clientName,
    property: row.propertyId
      ? { _id: String(row.propertyId._id), title: row.propertyId.title || 'Property', city: row.propertyId.city }
      : null,
    agent: row.agentId
      ? { _id: String(row.agentId._id), name: row.agentId.name || 'Assigned broker' }
      : null,
  }))
}

const getViewingById=async(organizationId:string,id:string,access?:CrmAccessContext)=>{const result=await Viewing.findOne({_id:id,organizationId,...crmReadOwnerFilter('agentId',access)}).populate({path:'propertyId',select:'title price images address city propertyType bedrooms bathrooms',match:{organizationId}}).populate(userRefPopulate('agentId', 'name email phoneNumber userRole', { organizationId })).populate({ path: 'leadId', select: 'name phone email leadStatus', match: { organizationId, isLocked: { $ne: true } } });if(!result)throw new ApiError(404,'Viewing not found');return result}
const updateViewing=async(organizationId:string,id:string,payload:Partial<IViewing>,actorId?:string,access?:CrmAccessContext)=>{
  if(payload.clientPhone)payload.clientPhone=normalizePhone(payload.clientPhone)

  // Resolve reminder policy before starting the transaction. CrmService.getConfig can
  // create/canonicalize configuration, which should not become an unrelated write in
  // the viewing transaction itself.
  const crmConfig:any=await CrmService.getConfig(organizationId)
  const viewingMinutesBefore=Number(crmConfig.reminders?.viewingMinutesBefore||0)
  let viewingEvent:DomainEventInput|undefined
  let leadEffects:LifecycleEffects|undefined

  const mutate=async(session?:ClientSession)=>{
    let existingQuery:any=Viewing.findOne({_id:id,organizationId,...crmMutationOwnerFilter('agentId',access)})
    if(session)existingQuery=existingQuery.session(session)
    const existing:any=await existingQuery
    if(!existing)throw new ApiError(404,'Viewing not found')

    if(access&&!canManageTeamCrm(access)&&payload.agentId!==undefined&&String(payload.agentId)!==access.userId){
      throw new ApiError(403,'Team members cannot reassign viewings to another member')
    }

    const linkedLeadId=referenceId(payload.leadId??existing.leadId)
    // For ordinary edits retain the existing CRM visibility check. Completing a
    // viewing also re-checks the Lead inside this same transaction below.
    if(linkedLeadId&&payload.status!=='Completed')await assertViewingLead(organizationId,linkedLeadId,access)

    const date=String(payload.date??existing.date)
    const startTime=String(payload.startTime??existing.startTime)
    const endTime=String(payload.endTime??existing.endTime)
    const existingAgentId=referenceId(existing.agentId)||''
    const existingPropertyId=referenceId(existing.propertyId)||''
    const agentId=referenceId(payload.agentId??existing.agentId)||''
    const propertyId=referenceId(payload.propertyId??existing.propertyId)||''
    const scheduleChanged=Boolean(
      (payload.date!==undefined&&date!==String(existing.date))||
      (payload.startTime!==undefined&&startTime!==String(existing.startTime))||
      (payload.endTime!==undefined&&endTime!==String(existing.endTime))||
      (payload.agentId!==undefined&&agentId!==existingAgentId)||
      (payload.propertyId!==undefined&&propertyId!==existingPropertyId)||
      payload.status==='Rescheduled'
    )

    if(payload.agentId!==undefined)await CrmAssignableMemberService.assertAssignableMember(organizationId,agentId,'viewing',session)
    if(scheduleChanged){
      assertViewingWindowIsFuture(date,startTime)
      await assertViewingRequestableProperty(organizationId,propertyId,session)
      const conflict=await checkConflict(organizationId,agentId,propertyId,date,startTime,endTime,id,session)
      if(conflict.hasConflict)throw new ApiError(409,conflict.reason||'Viewing conflict','',conflict.code||'VIEWING_SLOT_UNAVAILABLE')
    }

    const result:any=await Viewing.findOneAndUpdate(
      {_id:id,organizationId,...crmMutationOwnerFilter('agentId',access)},
      payload,
      {new:true,runValidators:true,...(session?{session}:{})},
    )
    if(!result)throw new ApiError(404,'Viewing not found')

    if(['Cancelled','Completed','NoShow'].includes(result.status)){
      await OperationsQueueService.cancel(organizationId,'viewing_reminder',id,{session})
    }else if(scheduleChanged){
      await scheduleReminder(result,{session,viewingMinutesBefore})
    }

    if(payload.status==='Completed'&&linkedLeadId){
      if(session){
        const lifecycle=await LeadLifecycleService.changeStatusInTransaction(organizationId,linkedLeadId,LEAD_STATUS.VIEWING_COMPLETED,session,{actorId,access,reason:'Viewing completed'})
        leadEffects=lifecycle.effects
      }else{
        await LeadLifecycleService.changeStatus(organizationId,linkedLeadId,LEAD_STATUS.VIEWING_COMPLETED,{actorId,access,reason:'Viewing completed'})
      }
    }

    if(payload.date||payload.startTime||payload.endTime||payload.status){
      await OperationsQueueService.schedule({organizationId,type:'calendar_sync',entityId:id,runAt:new Date(Date.now()+1_000)}, {session})
    }

    const event:DomainEventInput={
      organizationId,
      aggregateType:'viewing',
      aggregateId:id,
      eventType:payload.status==='Completed'?'viewing.completed':'viewing.updated',
      // Never stringify a populated Lead document into leadId. linkedLeadId is a
      // canonical ObjectId string resolved before any populate is performed.
      leadId:linkedLeadId,
      propertyId,
      actorId:actorId||agentId,
      payload:{summary:`Viewing ${result.status} for ${result.date} at ${result.startTime}`,status:result.status},
    }
    await DomainEventService.emit(event,session?{session,deferPublish:true}:undefined)
    if(session)viewingEvent=event
    return result
  }

  if(await mongoSupportsTransactions()){
    const session=await mongoose.startSession()
    try{
      await session.withTransaction(async()=>{
        // withTransaction may retry; only publish effects from the successful attempt.
        viewingEvent=undefined
        leadEffects=undefined
        await mutate(session)
      })
    }catch(error){
      if(!(error instanceof ApiError)) Metrics.inc('viewing_update_internal_failures_total', { stage: 'transaction' })
      throw error
    }finally{
      await session.endSession()
    }

    if(leadEffects)await LeadLifecycleService.publishDeferredEffects(organizationId,leadEffects)
    if(viewingEvent){
      try{await DomainEventService.publish(viewingEvent)}catch(error){logger.warn('viewing_post_commit_publish_failed',{organizationId,viewingId:id,eventType:viewingEvent.eventType,error})}
    }
  }else{
    if(config.isProduction)throw new ApiError(503,'Viewing mutations require a MongoDB replica set or mongos in production')
    try{
      await mutate(undefined)
    }catch(error){
      if(!(error instanceof ApiError)) Metrics.inc('viewing_update_internal_failures_total', { stage: 'standalone' })
      throw error
    }
  }

  const result=await Viewing.findOne({_id:id,organizationId,...crmReadOwnerFilter('agentId',access)})
    .populate({path:'propertyId',select:'title price images address city',match:{organizationId}})
    .populate(userRefPopulate('agentId','name email phoneNumber userRole',{organizationId}))
    .populate({path:'leadId',select:'name phone email leadStatus',match:{organizationId,isLocked:{$ne:true}}})
  if(!result)throw new ApiError(404,'Viewing not found')
  return result
}
const deleteViewing=async(organizationId:string,id:string,access?:CrmAccessContext)=>{const result:any=await Viewing.findOneAndDelete({_id:id,organizationId,...crmMutationOwnerFilter('agentId',access)});if(!result)throw new ApiError(httpStatus.NOT_FOUND,'Viewing not found');await OperationsQueueService.cancel(organizationId,'viewing_reminder',id);await DomainEventService.emit({organizationId,aggregateType:'viewing',aggregateId:id,eventType:'viewing.deleted',leadId:referenceId(result.leadId),propertyId:referenceId(result.propertyId),actorId:access?.userId||referenceId(result.agentId),payload:{summary:`Viewing deleted for ${result.date} at ${result.startTime}`,status:result.status}});return result}
export const ViewingService={checkConflict,createViewing,publicRequestViewing,getAllViewings,getCalendarViewings,getViewingById,updateViewing,deleteViewing}
