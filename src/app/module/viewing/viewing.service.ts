import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { IGenericResponse, IPaginationOptions } from '../../../interfaces/common'
import paginationHelper from '../../helpers/paginationHelper'
import { normalizeBangladeshPhone } from '../../helpers/identity'
import { PrivacyConsentService } from '../privacy/privacyConsent.service'
import { PrivacyPolicyService } from '../privacy/privacyPolicy.service'
import { CrmService } from '../crm/crm.service'
import { DomainEventService } from '../domainEvent/domainEvent.service'
import { LeadService } from '../lead/lead.service'
import { OperationsQueueService } from '../operationsQueue/operationsQueue.service'
import { Property } from '../property/property.model'
import { Organization } from '../organization/organization.model'
import { User } from '../user/user.model'
import { userRefPopulate } from '../user/userProfile.service'
import { IViewing, IViewingFilter } from './viewing.interface'
import { Viewing } from './viewing.model'
import type { PublicViewingRequestInput } from './viewing.validation'
const normalizePhone=(value:string)=>{try{return normalizeBangladeshPhone(value)}catch(error){throw new ApiError(400,(error as Error).message)}}
const timeToMinutes=(time:string)=>{const[h,m]=time.split(':').map(Number);return h*60+m}
const checkConflict=async(organizationId:string,agentId:string,propertyId:string,date:string,startTime:string,endTime:string,excludeViewingId?:string)=>{const start=timeToMinutes(startTime),end=timeToMinutes(endTime);if(end<=start)return{hasConflict:true,reason:'End time must be after start time'};const query:any={organizationId,date,status:{$in:['Scheduled','Confirmed']}};if(excludeViewingId)query._id={$ne:excludeViewingId};const rows:any[]=await Viewing.find(query).select('agentId propertyId startTime endTime').lean();for(const v of rows){if(start<timeToMinutes(v.endTime)&&end>timeToMinutes(v.startTime)){if(String(v.agentId)===String(agentId))return{hasConflict:true,reason:`Agent is already booked (${v.startTime} - ${v.endTime})`};if(String(v.propertyId)===String(propertyId))return{hasConflict:true,reason:`Property already has a viewing (${v.startTime} - ${v.endTime})`}}}return{hasConflict:false}}
const scheduleReminder=async(viewing:any)=>{const config:any=await CrmService.getConfig(viewing.organizationId);const when=new Date(`${viewing.date}T${viewing.startTime}:00+06:00`);const runAt=new Date(when.getTime()-(config.reminders?.viewingMinutesBefore||0)*60_000);await OperationsQueueService.schedule({organizationId:viewing.organizationId,type:'viewing_reminder',entityId:viewing._id.toString(),runAt,payload:{agentId:viewing.agentId?.toString()}})}
const createViewing=async(organizationId:string,payload:Partial<IViewing>,actorId?:string):Promise<IViewing>=>{const conflict=await checkConflict(organizationId,String(payload.agentId),String(payload.propertyId),payload.date!,payload.startTime!,payload.endTime!);if(conflict.hasConflict)throw new ApiError(409,conflict.reason||'Viewing conflict');const result:any=await Viewing.create({...payload,organizationId,clientPhone:payload.clientPhone?normalizePhone(payload.clientPhone):payload.clientPhone});await scheduleReminder(result);if(payload.leadId)await LeadService.updateLeadStatus(organizationId,String(payload.leadId),'ViewingScheduled',undefined,actorId||String(payload.agentId));await OperationsQueueService.schedule({organizationId,type:'calendar_sync',entityId:result._id.toString(),runAt:new Date(Date.now()+1_000)});await DomainEventService.emit({organizationId,aggregateType:'viewing',aggregateId:result._id.toString(),eventType:'viewing.scheduled',leadId:result.leadId?.toString(),propertyId:result.propertyId?.toString(),actorId:actorId||result.agentId?.toString(),payload:{summary:`Viewing scheduled for ${result.date} at ${result.startTime}`,clientName:result.clientName}});return result}
const resolvePublicViewingAgent = async (organizationId:string, preferredAgentId?:string):Promise<string> => {
  if (preferredAgentId) {
    const preferred = await User.findOne({ _id: preferredAgentId, organizationId, status: 'active', userRole: { $in: ['agency_owner','agency_admin','agent'] } }).select('_id').lean()
    if (preferred?._id) return preferred._id.toString()
  }
  const organization:any = await Organization.findOne({ organizationId }).select('ownerId').lean()
  if (organization?.ownerId) {
    const owner = await User.findOne({ _id: organization.ownerId, organizationId, status: 'active', userRole: 'agency_owner' }).select('_id').lean()
    if (owner?._id) return owner._id.toString()
  }
  const fallback:any = await User.findOne({ organizationId, status: 'active', userRole: { $in: ['agency_owner','agency_admin','agent'] } }).sort({ createdAt: 1 }).select('_id').lean()
  if (!fallback?._id) throw new ApiError(503, 'This agency is not accepting viewing requests right now', '', 'VIEWING_AGENT_UNAVAILABLE')
  return fallback._id.toString()
}

const publicRequestViewing=async(payload:PublicViewingRequestInput,context:{ip?:string;requestId?:string}):Promise<IViewing>=>{
  const{organizationId,propertyId,date,startTime,endTime,clientName,clientPhone,clientEmail,notes,privacyConsent,policyVersion,attribution}=payload
  const organization:any=await Organization.findOne({organizationId}).select('isBlocked websiteStatus').lean()
  if(!organization)throw new ApiError(404,'Agency not found')
  if(organization.isBlocked||organization.websiteStatus==='suspended')throw new ApiError(423,'This agency is currently suspended','','TENANT_SUSPENDED')
  if(organization.websiteStatus!=='published')throw new ApiError(409,'This agency website is not published yet')
  const prop:any=await Property.findOne({_id:propertyId,organizationId,status:'Available'}).select('agentId').lean()
  if(!prop)throw new ApiError(404,'Property not found or is no longer available')
  if(!privacyConsent)throw new ApiError(400,'Privacy consent is required','','VALIDATION_ERROR',undefined,{privacyConsent:['Privacy consent is required']})
  await PrivacyPolicyService.assertCurrentPublicPolicy(policyVersion)
  const agentId=await resolvePublicViewingAgent(organizationId,prop.agentId?.toString())
  const normalizedPhone=normalizePhone(clientPhone)
  const lead:any=await LeadService.createLead(organizationId,{name:clientName,phone:normalizedPhone,email:clientEmail,source:'Website',leadStatus:'New',assignedAgent:agentId,propertyInterest:[propertyId],notes:notes||'',attribution})
  await PrivacyConsentService.recordPublicPrivacyPolicy(organizationId,normalizedPhone,policyVersion,context)
  return createViewing(organizationId,{propertyId,agentId,leadId:lead._id,date,startTime,endTime,clientName,clientPhone:normalizedPhone,clientEmail,status:'Scheduled',notes},agentId)
}
const getAllViewings=async(filters:IViewingFilter,paginationOptions:IPaginationOptions):Promise<IGenericResponse<IViewing[]>>=>{const{searchTerm,organizationId,propertyId,agentId,leadId,status,date,startDate,endDate}=filters;const c:any[]=[];if(organizationId)c.push({organizationId});if(propertyId)c.push({propertyId});if(agentId)c.push({agentId});if(leadId)c.push({leadId});if(status)c.push({status});if(date)c.push({date});if(startDate||endDate)c.push({date:{...(startDate?{$gte:startDate}:{}),...(endDate?{$lte:endDate}:{})}});if(searchTerm)c.push({$or:['clientName','clientPhone','clientEmail','notes'].map(f=>({[f]:{$regex:searchTerm,$options:'i'}}))});const where=c.length?{$and:c}:{};const{page,limit,skip,sortBy,sortOrder}=paginationHelper.calculatePagination(paginationOptions);const[result,total]=await Promise.all([Viewing.find(where).populate('propertyId','title price images address city').populate(userRefPopulate('agentId', 'name email phoneNumber userRole')).populate('leadId','name phone email leadStatus').sort({date:1,startTime:1,[sortBy]:sortOrder}).skip(skip).limit(limit),Viewing.countDocuments(where)]);return{meta:{page,limit,total},data:result}}
const getViewingById=async(organizationId:string,id:string)=>{const result=await Viewing.findOne({_id:id,organizationId}).populate('propertyId','title price images address city propertyType bedrooms bathrooms').populate(userRefPopulate('agentId', 'name email phoneNumber userRole')).populate('leadId','name phone email leadStatus');if(!result)throw new ApiError(404,'Viewing not found');return result}
const updateViewing=async(organizationId:string,id:string,payload:Partial<IViewing>,actorId?:string)=>{const existing:any=await Viewing.findOne({_id:id,organizationId});if(!existing)throw new ApiError(404,'Viewing not found');const date=payload.date||existing.date,startTime=payload.startTime||existing.startTime,endTime=payload.endTime||existing.endTime,agentId=String(payload.agentId||existing.agentId),propertyId=String(payload.propertyId||existing.propertyId);if(payload.date||payload.startTime||payload.endTime||payload.agentId||payload.propertyId){const conflict=await checkConflict(organizationId,agentId,propertyId,date,startTime,endTime,id);if(conflict.hasConflict)throw new ApiError(409,conflict.reason||'Viewing conflict')}if(payload.clientPhone)payload.clientPhone=normalizePhone(payload.clientPhone);const result:any=await Viewing.findOneAndUpdate({_id:id,organizationId},payload,{new:true}).populate('propertyId','title price images address city').populate(userRefPopulate('agentId', 'name email phoneNumber userRole')).populate('leadId','name phone email leadStatus');if(['Cancelled','Completed','NoShow'].includes(result.status))await OperationsQueueService.cancel(organizationId,'viewing_reminder',id);else if(payload.date||payload.startTime||payload.status==='Rescheduled')await scheduleReminder(result);if(payload.status==='Completed'&&existing.leadId)await LeadService.updateLeadStatus(organizationId,String(existing.leadId),'ViewingCompleted',undefined,actorId);if(payload.date||payload.startTime||payload.endTime||payload.status)await OperationsQueueService.schedule({organizationId,type:'calendar_sync',entityId:id,runAt:new Date(Date.now()+1_000)});await DomainEventService.emit({organizationId,aggregateType:'viewing',aggregateId:id,eventType:payload.status==='Completed'?'viewing.completed':'viewing.updated',leadId:existing.leadId?.toString(),propertyId:propertyId,actorId:actorId||agentId,payload:{summary:`Viewing ${result.status} for ${result.date} at ${result.startTime}`,status:result.status}});return result}
const deleteViewing=async(organizationId:string,id:string)=>{const result=await Viewing.findOneAndDelete({_id:id,organizationId});if(!result)throw new ApiError(httpStatus.NOT_FOUND,'Viewing not found');await OperationsQueueService.cancel(organizationId,'viewing_reminder',id);return result}
export const ViewingService={checkConflict,createViewing,publicRequestViewing,getAllViewings,getViewingById,updateViewing,deleteViewing}
