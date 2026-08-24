import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { IGenericResponse, IPaginationOptions } from '../../../interfaces/common'
import paginationHelper from '../../helpers/paginationHelper'
import { normalizeBangladeshPhone } from '../../helpers/identity'
import { PrivacyConsentService } from '../privacy/privacyConsent.service'
import { PrivacyPolicyService } from '../privacy/privacyPolicy.service'
import { CrmService } from '../crm/crm.service'
import { crmMutationOwnerFilter, type CrmAccessContext } from '../crm/crmAccess'
import { CrmAssignableMemberService } from '../crm/crmAssignableMember.service'
import { DomainEventService } from '../domainEvent/domainEvent.service'
import { LeadService } from '../lead/lead.service'
import { LeadLifecycleService } from '../lead/leadLifecycle.service'
import { LEAD_STATUS } from '../lead/leadStatus.contract'
import { OperationsQueueService } from '../operationsQueue/operationsQueue.service'
import { Property } from '../property/property.model'
import { Organization } from '../organization/organization.model'
import { userRefPopulate } from '../user/userProfile.service'
import { IViewing, IViewingCalendarFilter, IViewingFilter, ViewingCalendarItem } from './viewing.interface'
import { Viewing } from './viewing.model'
import type { PublicViewingRequestInput } from './viewing.validation'
const normalizePhone=(value:string)=>{try{return normalizeBangladeshPhone(value)}catch(error){throw new ApiError(400,(error as Error).message)}}
const timeToMinutes=(time:string)=>{const[h,m]=time.split(':').map(Number);return h*60+m}
const checkConflict=async(organizationId:string,agentId:string,propertyId:string,date:string,startTime:string,endTime:string,excludeViewingId?:string)=>{const start=timeToMinutes(startTime),end=timeToMinutes(endTime);if(end<=start)return{hasConflict:true,reason:'End time must be after start time'};const query:any={organizationId,date,status:{$in:['Scheduled','Confirmed']}};if(excludeViewingId)query._id={$ne:excludeViewingId};const rows:any[]=await Viewing.find(query).select('agentId propertyId startTime endTime').lean();for(const v of rows){if(start<timeToMinutes(v.endTime)&&end>timeToMinutes(v.startTime)){if(String(v.agentId)===String(agentId))return{hasConflict:true,reason:`Agent is already booked (${v.startTime} - ${v.endTime})`};if(String(v.propertyId)===String(propertyId))return{hasConflict:true,reason:`Property already has a viewing (${v.startTime} - ${v.endTime})`}}}return{hasConflict:false}}
const scheduleReminder=async(viewing:any)=>{const config:any=await CrmService.getConfig(viewing.organizationId);const when=new Date(`${viewing.date}T${viewing.startTime}:00+06:00`);const runAt=new Date(when.getTime()-(config.reminders?.viewingMinutesBefore||0)*60_000);await OperationsQueueService.schedule({organizationId:viewing.organizationId,type:'viewing_reminder',entityId:viewing._id.toString(),runAt,payload:{agentId:viewing.agentId?.toString()}})}
const createViewing=async(organizationId:string,payload:Partial<IViewing>,actorId?:string,access?:CrmAccessContext):Promise<IViewing>=>{if(access&&!access.isManager&&String(payload.agentId||'')!==access.userId)throw new ApiError(403,'Team members can only schedule viewings assigned to themselves');await CrmAssignableMemberService.assertAssignableMember(organizationId,String(payload.agentId||''),'viewing');if(payload.leadId&&access)await LeadService.getLeadById(organizationId,String(payload.leadId),access);const conflict=await checkConflict(organizationId,String(payload.agentId),String(payload.propertyId),payload.date!,payload.startTime!,payload.endTime!);if(conflict.hasConflict)throw new ApiError(409,conflict.reason||'Viewing conflict');const result:any=await Viewing.create({...payload,organizationId,clientPhone:payload.clientPhone?normalizePhone(payload.clientPhone):payload.clientPhone});await scheduleReminder(result);if(payload.leadId)await LeadLifecycleService.changeStatus(organizationId,String(payload.leadId),LEAD_STATUS.VIEWING_SCHEDULED,{actorId:actorId||String(payload.agentId),access,reason:'Viewing scheduled'});await OperationsQueueService.schedule({organizationId,type:'calendar_sync',entityId:result._id.toString(),runAt:new Date(Date.now()+1_000)});await DomainEventService.emit({organizationId,aggregateType:'viewing',aggregateId:result._id.toString(),eventType:'viewing.scheduled',leadId:result.leadId?.toString(),propertyId:result.propertyId?.toString(),actorId:actorId||result.agentId?.toString(),payload:{summary:`Viewing scheduled for ${result.date} at ${result.startTime}`,clientName:result.clientName}});return result}
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
  const organization:any=await Organization.findOne({organizationId}).select('isBlocked websiteStatus').lean()
  if(!organization)throw new ApiError(404,'Agency not found')
  if(organization.isBlocked||organization.websiteStatus==='suspended')throw new ApiError(423,'This agency is currently suspended','','TENANT_SUSPENDED')
  if(organization.websiteStatus!=='published')throw new ApiError(409,'This agency website is not published yet')
  const prop:any=await Property.findOne({_id:propertyId,organizationId,status:'Available',quotaLocked:{ $ne:true }}).select('agentId').lean()
  if(!prop)throw new ApiError(404,'Property not found or is no longer available')
  if(!privacyConsent)throw new ApiError(400,'Privacy consent is required','','VALIDATION_ERROR',undefined,{privacyConsent:['Privacy consent is required']})
  await PrivacyPolicyService.assertCurrentPublicPolicy(policyVersion)
  const agentId=await resolvePublicViewingAgent(organizationId,prop.agentId?.toString())
  const normalizedPhone=normalizePhone(clientPhone)
  const lead:any=await LeadService.createLead(organizationId,{name:clientName,phone:normalizedPhone,email:clientEmail,source:'Website',leadStatus:LEAD_STATUS.NEW,assignedAgent:agentId,propertyInterest:[propertyId],notes:notes||'',attribution},undefined,undefined,{allowanceSource:'website'})
  await PrivacyConsentService.recordPublicPrivacyPolicy(organizationId,normalizedPhone,policyVersion,context)
  return createViewing(organizationId,{propertyId,agentId,leadId:lead._id,date,startTime,endTime,clientName,clientPhone:normalizedPhone,clientEmail,status:'Scheduled',notes},agentId)
}
const VIEWING_LIST_SORT_FIELDS = new Set(['createdAt', 'updatedAt', 'date', 'status', 'clientName'])

const getAllViewings = async (
  filters: IViewingFilter,
  paginationOptions: IPaginationOptions,
): Promise<IGenericResponse<IViewing[]>> => {
  const { searchTerm, organizationId, propertyId, agentId, leadId, status, date, startDate, endDate, viewMode = 'list' } = filters
  const conditions: any[] = []
  if (organizationId) conditions.push({ organizationId })
  if (propertyId) conditions.push({ propertyId })
  if (agentId) conditions.push({ agentId })
  if (leadId) conditions.push({ leadId })
  if (status) conditions.push({ status })
  if (date) conditions.push({ date })
  if (startDate || endDate) conditions.push({ date: { ...(startDate ? { $gte: startDate } : {}), ...(endDate ? { $lte: endDate } : {}) } })
  if (searchTerm) conditions.push({ $or: ['clientName', 'clientPhone', 'clientEmail', 'notes'].map((field) => ({ [field]: { $regex: searchTerm, $options: 'i' } })) })

  const where = conditions.length ? { $and: conditions } : {}
  const calendarMode = viewMode === 'calendar'
  const { page, limit, skip, sortBy, sortOrder } = paginationHelper.calculatePagination(
    paginationOptions,
    calendarMode ? { sortBy: 'date', sortOrder: 'asc' } : { sortBy: 'createdAt', sortOrder: 'desc' },
  )
  const sort = calendarMode
    ? paginationHelper.buildCalendarSort()
    : paginationHelper.buildAllowedStableSort(sortBy, sortOrder, VIEWING_LIST_SORT_FIELDS, 'createdAt')

  const [result, total] = await Promise.all([
    Viewing.find(where)
      .populate('propertyId', 'title price images address city')
      .populate(userRefPopulate('agentId', 'name email phoneNumber userRole'))
      .populate({ path: 'leadId', select: 'name phone email leadStatus', match: { isLocked: { $ne: true } } })
      .sort(sort)
      .skip(skip)
      .limit(limit),
    Viewing.countDocuments(where),
  ])
  return { meta: { page, limit, total }, data: result }
}
const getCalendarViewings = async (filters: IViewingCalendarFilter): Promise<ViewingCalendarItem[]> => {
  const { organizationId, startDate, endDate, status, propertyId, agentId } = filters
  const where: Record<string, unknown> = {
    organizationId,
    date: { $gte: startDate, $lte: endDate },
    ...(status ? { status } : {}),
    ...(propertyId ? { propertyId } : {}),
    ...(agentId ? { agentId } : {}),
  }

  const rows: any[] = await Viewing.find(where)
    .select('_id date startTime endTime status clientName propertyId agentId')
    .populate('propertyId', 'title city')
    .populate(userRefPopulate('agentId', 'name'))
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

const getViewingById=async(organizationId:string,id:string)=>{const result=await Viewing.findOne({_id:id,organizationId}).populate('propertyId','title price images address city propertyType bedrooms bathrooms').populate(userRefPopulate('agentId', 'name email phoneNumber userRole')).populate({ path: 'leadId', select: 'name phone email leadStatus', match: { isLocked: { $ne: true } } });if(!result)throw new ApiError(404,'Viewing not found');return result}
const updateViewing=async(organizationId:string,id:string,payload:Partial<IViewing>,actorId?:string,access?:CrmAccessContext)=>{const existing:any=await Viewing.findOne({_id:id,organizationId,...crmMutationOwnerFilter('agentId',access)});if(!existing)throw new ApiError(404,'Viewing not found');if(access&&!access.isManager&&payload.agentId!==undefined&&String(payload.agentId)!==access.userId)throw new ApiError(403,'Team members cannot reassign viewings to another member');const linkedLead=payload.leadId||existing.leadId;if(linkedLead&&access)await LeadService.getLeadById(organizationId,String(linkedLead),access);const date=payload.date||existing.date,startTime=payload.startTime||existing.startTime,endTime=payload.endTime||existing.endTime,agentId=String(payload.agentId||existing.agentId),propertyId=String(payload.propertyId||existing.propertyId);if(payload.agentId!==undefined)await CrmAssignableMemberService.assertAssignableMember(organizationId,agentId,'viewing');if(payload.date||payload.startTime||payload.endTime||payload.agentId||payload.propertyId){const conflict=await checkConflict(organizationId,agentId,propertyId,date,startTime,endTime,id);if(conflict.hasConflict)throw new ApiError(409,conflict.reason||'Viewing conflict')}if(payload.clientPhone)payload.clientPhone=normalizePhone(payload.clientPhone);const result:any=await Viewing.findOneAndUpdate({_id:id,organizationId},payload,{new:true}).populate('propertyId','title price images address city').populate(userRefPopulate('agentId', 'name email phoneNumber userRole')).populate({ path: 'leadId', select: 'name phone email leadStatus', match: { isLocked: { $ne: true } } });if(['Cancelled','Completed','NoShow'].includes(result.status))await OperationsQueueService.cancel(organizationId,'viewing_reminder',id);else if(payload.date||payload.startTime||payload.status==='Rescheduled')await scheduleReminder(result);if(payload.status==='Completed'&&linkedLead)await LeadLifecycleService.changeStatus(organizationId,String(linkedLead),LEAD_STATUS.VIEWING_COMPLETED,{actorId,access,reason:'Viewing completed'});if(payload.date||payload.startTime||payload.endTime||payload.status)await OperationsQueueService.schedule({organizationId,type:'calendar_sync',entityId:id,runAt:new Date(Date.now()+1_000)});await DomainEventService.emit({organizationId,aggregateType:'viewing',aggregateId:id,eventType:payload.status==='Completed'?'viewing.completed':'viewing.updated',leadId:result.leadId?.toString(),propertyId:propertyId,actorId:actorId||agentId,payload:{summary:`Viewing ${result.status} for ${result.date} at ${result.startTime}`,status:result.status}});return result}
const deleteViewing=async(organizationId:string,id:string,access?:CrmAccessContext)=>{const result:any=await Viewing.findOneAndDelete({_id:id,organizationId,...crmMutationOwnerFilter('agentId',access)});if(!result)throw new ApiError(httpStatus.NOT_FOUND,'Viewing not found');await OperationsQueueService.cancel(organizationId,'viewing_reminder',id);await DomainEventService.emit({organizationId,aggregateType:'viewing',aggregateId:id,eventType:'viewing.deleted',leadId:result.leadId?.toString(),propertyId:result.propertyId?.toString(),actorId:access?.userId||result.agentId?.toString(),payload:{summary:`Viewing deleted for ${result.date} at ${result.startTime}`,status:result.status}});return result}
export const ViewingService={checkConflict,createViewing,publicRequestViewing,getAllViewings,getCalendarViewings,getViewingById,updateViewing,deleteViewing}
