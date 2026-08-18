import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { IGenericResponse, IPaginationOptions } from '../../../interfaces/common'
import paginationHelper from '../../helpers/paginationHelper'
import { normalizeBangladeshPhone, normalizeEmail } from '../../helpers/identity'
import { PrivacyConsentService } from '../privacy/privacyConsent.service'
import { ActivityService } from '../activity/activity.service'
import { ActivityExportService } from '../activity/activityExport.service'
import { PrivacyPolicyService } from '../privacy/privacyPolicy.service'
import { CrmService } from '../crm/crm.service'
import { buildCrmCsv, buildCrmXlsx, type CrmExportColumn, type CrmExportRow } from '../crm/crmExport.service'
import { canAssignLeadTo, crmMutationOwnerFilter, crmReadOwnerFilter, type CrmAccessContext } from '../crm/crmAccess'
import { DomainEventService } from '../domainEvent/domainEvent.service'
import { EntitlementService } from '../entitlement/entitlement.service'
import { Property } from '../property/property.model'
import { User } from '../user/user.model'
import { userRefPopulate } from '../user/userProfile.service'
import { Organization } from '../organization/organization.model'
import { ILead, ILeadFilter } from './lead.interface'
import { CRM_FOLLOW_UP_TIME_ZONE, getDayBoundsInTimeZone, getWeekBoundsInTimeZone } from './leadFollowUpTime'
import { Lead } from './lead.model'
import { LeadLifecycleService } from './leadLifecycle.service'
import type { PublicLeadCaptureInput } from './lead.validation'
import {
  LEAD_STATUS,
  LEAD_STATUS_LABELS,
  leadStatusFilterValues,
  normalizeLeadStatus,
} from './leadStatus.contract'

const normalizePhone=(value:string)=>{try{return normalizeBangladeshPhone(value)}catch(error){throw new ApiError(400,(error as Error).message)}}
const normalizeOptionalEmail=(value?:string)=>value?.trim()?normalizeEmail(value):''
const uniqueStrings=(values:any[]=[])=>[...new Set(values.filter(Boolean).map(String))]
const requireLeadStatus=(value:unknown)=>{const status=normalizeLeadStatus(value);if(!status)throw new ApiError(400,`Unsupported lead status: ${String(value||'')}`);return status}
const scoreLead=(lead:Partial<ILead>)=>{let score=10;const reasons:string[]=['Base inquiry'];if(lead.email){score+=10;reasons.push('Email provided')}if(lead.propertyInterest?.length){score+=20;reasons.push('Property selected')}if((lead.budgetMax||0)>0){score+=15;reasons.push('Budget provided')}if(lead.locationPreference){score+=10;reasons.push('Location preference')}if(['Referral','WhatsApp','Phone'].includes(String(lead.source))){score+=15;reasons.push('High-intent source')}if(lead.followUpDate||lead.nextFollowUp){score+=5;reasons.push('Follow-up scheduled')}return{score:Math.min(100,score),reasons}}

const prepareLeadMutationPayload=(payload:Partial<ILead>,actorId?:string)=>{
  const prepared:any={...payload}
  // Server-owned lifecycle/audit fields are never accepted from callers.
  for(const field of ['createdBy','updatedBy','convertedAt','convertedBy','convertedContactId','isConverted','firstContactedAt','contactId']) delete prepared[field]
  if(prepared.followUpDate!==undefined){const value=new Date(prepared.followUpDate);if(Number.isNaN(value.getTime()))throw new ApiError(400,'Invalid follow-up date');prepared.followUpDate=value}
  else if(prepared.nextFollowUp!==undefined){const value=new Date(prepared.nextFollowUp);if(Number.isNaN(value.getTime()))throw new ApiError(400,'Invalid follow-up date');prepared.followUpDate=value}
  // Keep the legacy schema field readable, but stop writing new canonical state into it.
  delete prepared.nextFollowUp
  if(actorId)prepared.updatedBy=actorId
  return prepared
}

const assertGenericLeadPatchFields=(payload:Partial<ILead>)=>{
  const protectedFields=['leadStatus','assignedAgent','followUpDate','nextFollowUp','createdBy','updatedBy','convertedAt','convertedBy','convertedContactId','isConverted','firstContactedAt','contactId','lostReason','notes']
  const supplied=protectedFields.filter((field)=>Object.prototype.hasOwnProperty.call(payload,field))
  if(supplied.length)throw new ApiError(400,`Protected lead fields must use dedicated lifecycle endpoints: ${supplied.join(', ')}`)
}

const mergeInto=async(existing:any,payload:Partial<ILead>,context:{source:string;duplicateLeadId?:string;actorId?:string})=>{
  const changed:string[]=[]
  const set=(key:string,value:any)=>{if(value!==undefined&&value!==''&&JSON.stringify(existing.get(key))!==JSON.stringify(value)){existing.set(key,value);changed.push(key)}}
  ;['name','email','normalizedEmail','phone','normalizedPhone','locationPreference','propertyType','bedrooms','budgetMin','budgetMax','followUpDate'].forEach(k=>set(k,(payload as any)[k]))
  if(payload.propertyInterest?.length){existing.propertyInterest=uniqueStrings([...(existing.propertyInterest||[]),...payload.propertyInterest]);changed.push('propertyInterest')}
  if(payload.attribution){const first=existing.attribution?.firstTouchAt||payload.attribution.firstTouchAt||new Date();existing.attribution={...(existing.attribution?.toObject?.()||existing.attribution||{}),...payload.attribution,firstTouchAt:first,lastTouchAt:new Date()};changed.push('attribution')}
  const scored=scoreLead({...existing.toObject(),...payload});existing.leadScore=scored.score;existing.scoreReasons=scored.reasons
  if(context.actorId)existing.updatedBy=context.actorId
  existing.mergeHistory.push({mergedAt:new Date(),duplicateLeadId:context.duplicateLeadId,source:context.source,changedFields:uniqueStrings(changed)})
  await existing.save()
  await DomainEventService.emit({organizationId:existing.organizationId,aggregateType:'lead',aggregateId:existing._id.toString(),eventType:'lead.merged',leadId:existing._id.toString(),contactId:existing.contactId?.toString(),actorId:context.actorId,payload:{summary:`Duplicate inquiry merged from ${context.source}`,changedFields:uniqueStrings(changed),duplicateLeadId:context.duplicateLeadId||''}})
  return existing
}

const findDuplicates=async(organizationId:string,phone:string,email:string)=>Lead.find({organizationId,$or:[{normalizedPhone:phone},...(email?[{normalizedEmail:email}]:[])]}).sort({createdAt:1})

export type CreateLeadOptions = { duplicatePolicy?: 'merge' | 'reject' }

const createLead=async(organizationId:string,payload:Partial<ILead>,creatorAgentId?:string,access?:CrmAccessContext,options:CreateLeadOptions={}):Promise<ILead>=>{
  if(!payload.name||!payload.phone)throw new ApiError(400,'Lead name and phone are required')
  const initialNote=typeof payload.notes==='string'?payload.notes.trim():''
  const normalizedPhone=normalizePhone(payload.phone)
  const normalizedEmail=normalizeOptionalEmail(payload.email)
  const mutable=prepareLeadMutationPayload(payload,creatorAgentId)
  // Lead.notes is legacy-only. New notes are append-only Activity records.
  delete mutable.notes
  const requestedStatus=mutable.leadStatus!==undefined?requireLeadStatus(mutable.leadStatus):undefined
  const requestedLostReason=typeof mutable.lostReason==='string'?mutable.lostReason:undefined
  const requestedFollowUp=mutable.followUpDate?new Date(mutable.followUpDate):undefined
  // Initial lifecycle state is always canonical New. Any explicit initial stage/follow-up
  // is applied through LeadLifecycleService after the record exists.
  delete mutable.followUpDate
  delete mutable.leadStatus
  delete mutable.lostReason
  const prepared:any={
    ...mutable,
    phone:normalizedPhone,
    normalizedPhone,
    email:normalizedEmail||undefined,
    normalizedEmail,
    source:mutable.source||'Website',
    leadStatus:LEAD_STATUS.NEW,
    createdBy:creatorAgentId||undefined,
    updatedBy:creatorAgentId||undefined,
    isConverted:false,
  }
  if(access&&prepared.assignedAgent&&!canAssignLeadTo(access,String(prepared.assignedAgent)))throw new ApiError(403,'Assigning a lead to another team member requires leads.assign')
  if(access&&!access.isManager&&!access.permissions.includes('leads.assign')&&!prepared.assignedAgent)prepared.assignedAgent=access.userId

  const finalizeLifecycle=async(lead:any,isNewRecord:boolean):Promise<ILead>=>{
    let current:any=lead
    // FollowUpScheduled is the one stage that requires the canonical date to already
    // exist. Persist/sync that date first; scheduling itself never changes pipeline stage.
    if(requestedFollowUp&&requestedStatus===LEAD_STATUS.FOLLOW_UP_SCHEDULED&&!current.isConverted){
      current=(await LeadLifecycleService.scheduleFollowUp(organizationId,String(current._id),requestedFollowUp,{
        actorId:creatorAgentId,
        access,
        reason:'Initial follow-up scheduled during Lead creation',
      })).lead
    }
    if(isNewRecord&&requestedStatus&&requestedStatus!==LEAD_STATUS.NEW){
      current=(await LeadLifecycleService.changeStatus(organizationId,String(current._id),requestedStatus,{
        lostReason:requestedLostReason,
        reason:'Initial pipeline status selected during Lead creation',
        actorId:creatorAgentId,
        access,
      })).lead
    }
    if(requestedFollowUp&&requestedStatus!==LEAD_STATUS.FOLLOW_UP_SCHEDULED&&!current.isConverted){
      current=(await LeadLifecycleService.scheduleFollowUp(organizationId,String(current._id),requestedFollowUp,{
        actorId:creatorAgentId,
        access,
        reason:'Initial follow-up scheduled during Lead creation',
      })).lead
    }
    return current
  }

  const appendInitialNote = async (lead: any) => {
    if (!initialNote) return
    if (creatorAgentId) {
      await ActivityService.createLeadNote(organizationId, String(lead._id), initialNote, creatorAgentId, access)
    } else {
      await ActivityService.createLeadSystemNote(organizationId, String(lead._id), initialNote, 'Public enquiry')
    }
  }

  const duplicates:any[]=await findDuplicates(organizationId,normalizedPhone,normalizedEmail)
  if(access&&!access.isManager&&duplicates.some((lead:any)=>String(lead.assignedAgent||'')!==access.userId)){
    throw new ApiError(409,'A matching lead already exists under another team member. Ask an owner/admin to review the duplicate.')
  }
  if(duplicates.length){
    if(options.duplicatePolicy==='reject')throw new ApiError(409,'A lead with the same phone or email already exists in this agency')
    const target=duplicates[0]
    if(duplicates.length>1){
      for(const duplicate of duplicates.slice(1)){
        await Lead.deleteOne({_id:duplicate._id,organizationId})
        await mergeInto(target,duplicate.toObject(),{source:'identity-consolidation',duplicateLeadId:duplicate._id.toString(),actorId:creatorAgentId})
      }
    }
    const merged=await mergeInto(target,prepared,{source:String(prepared.source||'Unknown'),actorId:creatorAgentId})
    await appendInitialNote(merged)
    return finalizeLifecycle(merged,false)
  }

  await EntitlementService.assertLimit(organizationId,'leads')
  const config:any=await CrmService.getConfig(organizationId)
  if(prepared.assignedAgent){
    const validAgent=await User.exists({_id:prepared.assignedAgent,organizationId,status:'active',userRole:{$in:['agency_owner','agency_admin','agent']}})
    if(!validAgent)throw new ApiError(400,'Assigned agent must be an active member of this agency')
  }
  let propertyAgent:string|undefined
  if(prepared.propertyInterest?.[0]){
    const prop:any=await Property.findOne({_id:prepared.propertyInterest[0],organizationId}).select('agentId').lean()
    propertyAgent=prop?.agentId?.toString()
  }
  const assignment=prepared.assignedAgent
    ?{agentId:String(prepared.assignedAgent),strategy:'manual',reason:'Agent selected during capture'}
    :await CrmService.chooseAgent(organizationId,prepared,propertyAgent)
  prepared.assignedAgent=assignment.agentId||undefined
  if(requestedFollowUp&&!prepared.assignedAgent)throw new ApiError(400,'Assign the Lead before scheduling an initial follow-up')
  const scored=scoreLead({...prepared,followUpDate:requestedFollowUp})
  const now=new Date()
  prepared.leadScore=scored.score
  prepared.scoreReasons=scored.reasons
  prepared.responseDueAt=new Date(now.getTime()+(config.responseSlaMinutes||30)*60_000)
  prepared.lastContact=undefined
  if(prepared.attribution)prepared.attribution={...prepared.attribution,firstTouchAt:now,lastTouchAt:now}
  try{
    const result:any=await Lead.create({...prepared,organizationId})
    if(result.assignedAgent)await CrmService.recordAssignment({organizationId,leadId:result._id.toString(),assignedAgentId:result.assignedAgent.toString(),strategy:assignment.strategy,reason:assignment.reason,actorId:creatorAgentId})
    await DomainEventService.emit({organizationId,aggregateType:'lead',aggregateId:result._id.toString(),eventType:'lead.created',leadId:result._id.toString(),actorId:creatorAgentId,payload:{summary:`New lead created from ${result.source}`,leadScore:result.leadScore,responseDueAt:result.responseDueAt?.toISOString(),assignmentStrategy:assignment.strategy}})
    if(result.assignedAgent)await DomainEventService.emit({organizationId,aggregateType:'lead',aggregateId:result._id.toString(),eventType:'lead.assigned',leadId:result._id.toString(),actorId:creatorAgentId,payload:{summary:`Lead assigned during capture (${assignment.strategy})`,previousAgentId:'',assignedAgentId:result.assignedAgent.toString(),strategy:assignment.strategy,reason:assignment.reason}})
    await appendInitialNote(result)
    return finalizeLifecycle(result,true)
  }catch(error:any){
    if(error?.code===11000){
      if(options.duplicatePolicy==='reject')throw new ApiError(409,'A lead with the same phone or email already exists in this agency')
      const after:any=(await findDuplicates(organizationId,normalizedPhone,normalizedEmail))[0]
      if(after){
        const merged=await mergeInto(after,prepared,{source:String(prepared.source||'Unknown'),actorId:creatorAgentId})
        await appendInitialNote(merged)
        return finalizeLifecycle(merged,false)
      }
    }
    throw error
  }
}

const publicCaptureLead=async(payload:PublicLeadCaptureInput,context:{ip?:string;requestId?:string}):Promise<ILead>=>{
  const {organizationId,name,phone,email,propertyInterest,message,privacyConsent,policyVersion,attribution,...rest}=payload
  if(!organizationId||!name||!phone)throw new ApiError(400,'Organization, client name, and phone are required')
  const organization:any=await Organization.findOne({organizationId}).select('isBlocked websiteStatus').lean()
  if(!organization)throw new ApiError(404,'Agency not found')
  if(organization.isBlocked||organization.websiteStatus==='suspended')throw new ApiError(423,'This agency is currently suspended','', 'TENANT_SUSPENDED')
  if(organization.websiteStatus!=='published')throw new ApiError(409,'This agency website is not published yet')
  if(!privacyConsent) throw new ApiError(400,'Privacy consent is required','','VALIDATION_ERROR',undefined,{privacyConsent:['Privacy consent is required']})
  await PrivacyPolicyService.assertCurrentPublicPolicy(policyVersion)
  const normalizedPhone=normalizePhone(phone)
  const lead:any=await createLead(organizationId,{...rest,name,phone:normalizedPhone,email,source:'Website',propertyInterest:propertyInterest?[propertyInterest]:[],notes:message||'',attribution},undefined)
  await PrivacyConsentService.recordPublicPrivacyPolicy(organizationId, normalizedPhone, policyVersion, context)
  return lead
}

const parseFollowUpBoundary = (value: string | undefined, field: string) => {
  if (!value) return undefined
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new ApiError(400, `Invalid ${field}`)
  return parsed
}

const buildLeadWhere=(filters:ILeadFilter,access?:CrmAccessContext)=>{
  const {
    searchTerm, organizationId, leadStatus, source, assignedAgent, propertyType,
    minBudget, maxBudget, sla, minScore, isConverted, followUpPreset, followUpFrom, followUpTo,
  }=filters
  // Lead Pipeline is intentionally unconverted-only. Even a crafted query cannot expose
  // converted Leads through this collection endpoint.
  if(isConverted!==undefined && String(isConverted)!=='false')throw new ApiError(400,'Lead Pipeline only supports isConverted=false')
  const conditions:any[]=[{isConverted:{$ne:true}}]
  if(organizationId)conditions.push({organizationId})
  const ownerScope=crmReadOwnerFilter('assignedAgent',access)
  if(Object.keys(ownerScope).length)conditions.push(ownerScope)
  if(searchTerm){
    const escaped=String(searchTerm).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
    conditions.push({$or:['name','email','phone','locationPreference','attribution.utmCampaign'].map(field=>({[field]:{$regex:escaped,$options:'i'}}))})
  }
  if(leadStatus){
    const statusValues=leadStatusFilterValues(leadStatus)
    if(!statusValues.length)throw new ApiError(400,`Unsupported lead status: ${String(leadStatus)}`)
    conditions.push(statusValues.length===1?{leadStatus:statusValues[0]}:{leadStatus:{$in:statusValues}})
  }
  if(source)conditions.push({source})
  if(assignedAgent)conditions.push({assignedAgent})
  if(propertyType)conditions.push({propertyType})
  if(minBudget!==undefined&&minBudget!=='')conditions.push({budgetMax:{$gte:Number(minBudget)}})
  if(maxBudget!==undefined&&maxBudget!=='')conditions.push({budgetMin:{$lte:Number(maxBudget)}})
  if(minScore!==undefined&&minScore!=='')conditions.push({leadScore:{$gte:Number(minScore)}})
  if(sla==='breached')conditions.push({firstResponseAt:{$exists:false},responseDueAt:{$lt:new Date()}})
  if(sla==='due')conditions.push({firstResponseAt:{$exists:false},responseDueAt:{$gte:new Date()}})

  const from=parseFollowUpBoundary(followUpFrom,'followUpFrom')
  const to=parseFollowUpBoundary(followUpTo,'followUpTo')
  if(from&&to&&from>=to)throw new ApiError(400,'followUpTo must be later than followUpFrom')
  if(from||to)conditions.push({followUpDate:{...(from?{$gte:from}:{}),...(to?{$lt:to}:{})}})

  if(followUpPreset){
    if(followUpFrom||followUpTo)throw new ApiError(400,'Use either followUpPreset or a custom follow-up range, not both')
    const preset=String(followUpPreset)
    const day=getDayBoundsInTimeZone(new Date(),CRM_FOLLOW_UP_TIME_ZONE)
    if(preset==='scheduled')conditions.push({followUpDate:{$type:'date'}})
    else if(preset==='today')conditions.push({followUpDate:{$gte:day.start,$lt:day.endExclusive}})
    else if(preset==='thisWeek'){
      const week=getWeekBoundsInTimeZone(new Date(),CRM_FOLLOW_UP_TIME_ZONE)
      conditions.push({followUpDate:{$gte:week.start,$lt:week.endExclusive}})
    }
    else if(preset==='overdue')conditions.push({followUpDate:{$type:'date',$lt:day.start}})
    else if(preset==='none')conditions.push({$or:[{followUpDate:{$exists:false}},{followUpDate:null}]})
    else throw new ApiError(400,`Unsupported follow-up filter: ${preset}`)
  }
  return conditions.length?{$and:conditions}:{}
}

const getAllLeads=async(filters:ILeadFilter,paginationOptions:IPaginationOptions,access?:CrmAccessContext):Promise<IGenericResponse<ILead[]>>=>{
  const where=buildLeadWhere(filters,access)
  const{page,limit,skip,sortBy,sortOrder}=paginationHelper.calculatePagination(paginationOptions)
  const[result,total]=await Promise.all([
    Lead.find(where)
      .populate(userRefPopulate('assignedAgent','name email phoneNumber userRole profileImgURL'))
      .populate(userRefPopulate('createdBy','name email userRole profileImgURL'))
      .populate(userRefPopulate('updatedBy','name email userRole profileImgURL'))
      .populate('propertyInterest','title price images city propertyType')
      .populate('contactId','name email phone company')
      .sort({[sortBy]:sortOrder})
      .skip(skip)
      .limit(limit),
    Lead.countDocuments(where),
  ])
  return{meta:{page,limit,total},data:result}
}


const getTodayFollowUps=async(
  organizationId:string,
  paginationOptions:IPaginationOptions,
  access?:CrmAccessContext,
  referenceDate:Date=new Date(),
)=>{
  const bounds=getDayBoundsInTimeZone(referenceDate,CRM_FOLLOW_UP_TIME_ZONE)
  const{page,limit,skip}=paginationHelper.calculatePagination({
    ...paginationOptions,
    sortBy:'followUpDate',
    sortOrder:'asc',
  })
  const where={
    organizationId,
    isConverted:{$ne:true},
    followUpDate:{$gte:bounds.start,$lt:bounds.endExclusive},
    ...crmReadOwnerFilter('assignedAgent',access),
  }
  const[result,total]=await Promise.all([
    Lead.find(where)
      .populate(userRefPopulate('assignedAgent','name email phoneNumber userRole'))
      .populate('propertyInterest','title price images city')
      .sort({followUpDate:1,createdAt:1})
      .skip(skip)
      .limit(limit),
    Lead.countDocuments(where),
  ])
  return{
    meta:{page,limit,total},
    data:result,
    day:{
      timeZone:bounds.timeZone,
      localDate:bounds.localDate,
      start:bounds.start.toISOString(),
      end:bounds.endInclusive.toISOString(),
    },
  }
}

const getLeadById=async(organizationId:string,id:string,access?:CrmAccessContext)=>{const result=await Lead.findOne({_id:id,organizationId,...crmReadOwnerFilter('assignedAgent',access)}).populate(userRefPopulate('assignedAgent','name email phoneNumber userRole profileImgURL')).populate(userRefPopulate('createdBy','name email userRole profileImgURL')).populate(userRefPopulate('updatedBy','name email userRole profileImgURL')).populate('propertyInterest','title price images city propertyType bedrooms bathrooms').populate('contactId','name email phone address company tags');if(!result)throw new ApiError(404,'Lead not found');return result}
const updateLead=async(organizationId:string,id:string,payload:Partial<ILead>,actorId?:string,access?:CrmAccessContext)=>{assertGenericLeadPatchFields(payload);const ownerFilter=crmMutationOwnerFilter('assignedAgent',access);const current:any=await Lead.findOne({_id:id,organizationId,...ownerFilter});if(!current)throw new ApiError(404,'Lead not found');const prepared:any=prepareLeadMutationPayload(payload,actorId);if(prepared.phone){prepared.phone=normalizePhone(prepared.phone);prepared.normalizedPhone=prepared.phone}if(prepared.email!==undefined)prepared.normalizedEmail=normalizeOptionalEmail(prepared.email);const scored=scoreLead({...current.toObject(),...prepared});prepared.leadScore=scored.score;prepared.scoreReasons=scored.reasons;const result=await Lead.findOneAndUpdate({_id:id,organizationId,...ownerFilter},prepared,{new:true,runValidators:true}).populate(userRefPopulate('assignedAgent', 'name email phoneNumber userRole')).populate('propertyInterest','title price images city');await DomainEventService.emit({organizationId,aggregateType:'lead',aggregateId:id,eventType:'lead.updated',leadId:id,actorId,payload:{summary:'Lead profile fields updated',fields:Object.keys(prepared)}});return result}
const updateLeadStatus=async(organizationId:string,id:string,leadStatus:string,lostReason?:string,agentId?:string,access?:CrmAccessContext,reason?:string)=>LeadLifecycleService.changeStatus(organizationId,id,leadStatus,{lostReason,reason,actorId:agentId,access})
const assignAgent=async(organizationId:string,id:string,assignedAgent:string,_agentName?:string,actorId?:string,access?:CrmAccessContext)=>LeadLifecycleService.assignLead(organizationId,id,assignedAgent,{actorId,access,reason:'Manual override'})
const scheduleFollowUp=async(organizationId:string,id:string,followUpDate:string|Date,actorId?:string,access?:CrmAccessContext,reason?:string,title?:string,priority?:'low'|'medium'|'high'|'urgent')=>LeadLifecycleService.scheduleFollowUp(organizationId,id,followUpDate,{actorId,access,reason,title,priority})
const recordFirstResponse=async(organizationId:string,id:string,actorId?:string,access?:CrmAccessContext)=>LeadLifecycleService.recordContact(organizationId,id,{actorId,access,channel:'manual'})
const reengage=async(organizationId:string,id:string,actorId?:string,access?:CrmAccessContext,reason?:string)=>LeadLifecycleService.reengage(organizationId,id,{actorId,access,reason})
const deleteLead=async(organizationId:string,id:string,actorId?:string,access?:CrmAccessContext)=>{const result:any=await Lead.findOneAndDelete({_id:id,organizationId,...crmMutationOwnerFilter('assignedAgent',access)});if(!result)throw new ApiError(404,'Lead not found');await DomainEventService.emit({organizationId,aggregateType:'lead',aggregateId:id,eventType:'lead.deleted',actorId,payload:{summary:`Lead deleted: ${result.name}`,leadName:result.name,source:result.source,leadStatus:result.leadStatus}});return result}

const MAX_EXPORT_ROWS = 50_000
const LEAD_EXPORT_COLUMNS: CrmExportColumn[] = [
  { header: 'Name', key: 'name', width: 24 },
  { header: 'Phone', key: 'phone', width: 18 },
  { header: 'Email', key: 'email', width: 28 },
  { header: 'Source', key: 'source', width: 16 },
  { header: 'Status', key: 'status', width: 22 },
  { header: 'Assignee', key: 'assignee', width: 24 },
  { header: 'Follow-up Date', key: 'followUpDate', width: 24 },
  { header: 'Property Interest', key: 'propertyInterest', width: 38 },
  { header: 'Budget', key: 'budget', width: 28 },
  { header: 'Location', key: 'location', width: 24 },
  { header: 'Created By', key: 'createdBy', width: 24 },
  { header: 'Created At', key: 'createdAt', width: 24 },
  { header: 'Latest Note', key: 'latestNote', width: 50 },
  { header: 'Latest Note At', key: 'latestNoteAt', width: 24 },
  { header: 'Latest Interaction', key: 'latestInteraction', width: 50 },
  { header: 'Latest Interaction At', key: 'latestInteractionAt', width: 24 },
]

const formatBudgetForExport = (lead: any): string => {
  const min = Number(lead.budgetMin || 0)
  const max = Number(lead.budgetMax || 0)
  if (!min && !max) return ''
  const currency = String(lead.currency || 'BDT')
  const format = (value: number) => new Intl.NumberFormat('en-BD', { maximumFractionDigits: 0 }).format(value)
  if (min && max && min !== max) return `${currency} ${format(min)} - ${format(max)}`
  return `${currency} ${format(max || min)}`
}

const formatExportActivity = (activity?: { title?: string; content?: string; type?: string }): string => {
  if (!activity) return ''
  const label = String(activity.title || activity.type || 'CRM interaction').trim()
  const content = String(activity.content || '').trim()
  return content && content !== label ? `${label} — ${content}` : label
}

const getLeadExportRows = async (
  organizationId: string,
  filters: ILeadFilter,
  access?: CrmAccessContext,
): Promise<CrmExportRow[]> => {
  // buildLeadWhere is the exact same server-side filter + workspace scope used by
  // GET /lead, so an export cannot widen the records visible in the Lead Pipeline.
  const where = buildLeadWhere({ ...filters, organizationId }, access)
  const total = await Lead.countDocuments(where)
  if (total > MAX_EXPORT_ROWS) throw new ApiError(413, `Export contains more than ${MAX_EXPORT_ROWS.toLocaleString()} rows. Narrow the filters and retry.`)

  const leads: any[] = await Lead.find(where)
    .populate(userRefPopulate('assignedAgent', 'name email userRole'))
    .populate(userRefPopulate('createdBy', 'name email userRole'))
    .populate('propertyInterest', 'title')
    .sort({ createdAt: -1, _id: -1 })
    .limit(MAX_EXPORT_ROWS)
    .select('name phone email source leadStatus assignedAgent followUpDate propertyInterest budgetMin budgetMax currency locationPreference createdBy createdAt')
    .lean()

  const activity = await ActivityExportService.getLeadExportActivityProjection(organizationId, leads)
  return leads.map((lead: any) => {
    const status = normalizeLeadStatus(lead.leadStatus)
    const timeline = activity.get(String(lead._id))
    return {
      name: lead.name,
      phone: lead.phone,
      email: lead.email || '',
      source: lead.source || '',
      status: status ? LEAD_STATUS_LABELS[status] : String(lead.leadStatus || ''),
      assignee: lead.assignedAgent?.name || '',
      followUpDate: lead.followUpDate || '',
      propertyInterest: (lead.propertyInterest || []).map((property: any) => property?.title || '').filter(Boolean).join('; '),
      budget: formatBudgetForExport(lead),
      location: lead.locationPreference || '',
      createdBy: lead.createdBy?.name || '',
      createdAt: lead.createdAt || '',
      latestNote: timeline?.latestNote?.content || timeline?.latestNote?.title || '',
      latestNoteAt: timeline?.latestNote?.occurredAt || '',
      latestInteraction: formatExportActivity(timeline?.latestInteraction),
      latestInteractionAt: timeline?.latestInteraction?.occurredAt || '',
    }
  })
}

const exportCsv = async (organizationId: string, filters: ILeadFilter, access?: CrmAccessContext) =>
  buildCrmCsv(LEAD_EXPORT_COLUMNS, await getLeadExportRows(organizationId, filters, access))

const exportXlsx = async (organizationId: string, filters: ILeadFilter, access?: CrmAccessContext) =>
  buildCrmXlsx('Leads', LEAD_EXPORT_COLUMNS, await getLeadExportRows(organizationId, filters, access))

export const LeadService={createLead,publicCaptureLead,getAllLeads,getTodayFollowUps,getLeadById,updateLead,updateLeadStatus,assignAgent,scheduleFollowUp,recordFirstResponse,reengage,deleteLead,exportCsv,exportXlsx}
