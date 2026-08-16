import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { IGenericResponse, IPaginationOptions } from '../../../interfaces/common'
import paginationHelper from '../../helpers/paginationHelper'
import { normalizeBangladeshPhone, normalizeEmail } from '../../helpers/identity'
import { PrivacyConsentService } from '../privacy/privacyConsent.service'
import { PrivacyPolicyService } from '../privacy/privacyPolicy.service'
import { Contact } from '../contact/contact.model'
import { CrmService } from '../crm/crm.service'
import { DomainEventService } from '../domainEvent/domainEvent.service'
import { EntitlementService } from '../entitlement/entitlement.service'
import { Property } from '../property/property.model'
import { User } from '../user/user.model'
import { userRefPopulate } from '../user/userProfile.service'
import { Organization } from '../organization/organization.model'
import { ILead, ILeadFilter } from './lead.interface'
import { Lead } from './lead.model'
import type { PublicLeadCaptureInput } from './lead.validation'

const normalizePhone=(value:string)=>{try{return normalizeBangladeshPhone(value)}catch(error){throw new ApiError(400,(error as Error).message)}}
const normalizeOptionalEmail=(value?:string)=>value?.trim()?normalizeEmail(value):''
const uniqueStrings=(values:any[]=[])=>[...new Set(values.filter(Boolean).map(String))]
const scoreLead=(lead:Partial<ILead>)=>{let score=10;const reasons:string[]=['Base inquiry'];if(lead.email){score+=10;reasons.push('Email provided')}if(lead.propertyInterest?.length){score+=20;reasons.push('Property selected')}if((lead.budgetMax||0)>0){score+=15;reasons.push('Budget provided')}if(lead.locationPreference){score+=10;reasons.push('Location preference')}if(['Referral','WhatsApp','Phone'].includes(String(lead.source))){score+=15;reasons.push('High-intent source')}if(lead.nextFollowUp){score+=5;reasons.push('Follow-up scheduled')}return{score:Math.min(100,score),reasons}}

const ensureContact=async(organizationId:string,payload:Partial<ILead>)=>{
  let contact:any=payload.contactId?await Contact.findOne({_id:payload.contactId,organizationId}):null
  if(!contact&&payload.normalizedPhone)contact=await Contact.findOne({organizationId,phone:payload.normalizedPhone})
  if(!contact&&payload.normalizedEmail)contact=await Contact.findOne({organizationId,email:payload.normalizedEmail})
  if(!contact&&payload.name&&payload.normalizedPhone) contact=await Contact.create({organizationId,name:payload.name,email:payload.normalizedEmail||'',phone:payload.normalizedPhone,type:'Buyer'})
  else if(contact){if(payload.email&&!contact.email)contact.email=payload.normalizedEmail;if(payload.name&&(!contact.name||contact.name==='Unknown'))contact.name=payload.name;await contact.save()}
  return contact
}

const mergeInto=async(existing:any,payload:Partial<ILead>,context:{source:string;duplicateLeadId?:string;actorId?:string})=>{
  const changed:string[]=[]
  const set=(key:string,value:any)=>{if(value!==undefined&&value!==''&&JSON.stringify(existing.get(key))!==JSON.stringify(value)){existing.set(key,value);changed.push(key)}}
  ;['name','email','normalizedEmail','phone','normalizedPhone','locationPreference','propertyType','bedrooms','budgetMin','budgetMax','nextFollowUp'].forEach(k=>set(k,(payload as any)[k]))
  if(payload.notes?.trim()){existing.notes=[existing.notes,payload.notes.trim()].filter(Boolean).join('\n\n');changed.push('notes')}
  if(payload.propertyInterest?.length){existing.propertyInterest=uniqueStrings([...(existing.propertyInterest||[]),...payload.propertyInterest]);changed.push('propertyInterest')}
  if(payload.attribution){const first=existing.attribution?.firstTouchAt||payload.attribution.firstTouchAt||new Date();existing.attribution={...(existing.attribution?.toObject?.()||existing.attribution||{}),...payload.attribution,firstTouchAt:first,lastTouchAt:new Date()};changed.push('attribution')}
  const scored=scoreLead({...existing.toObject(),...payload});existing.leadScore=scored.score;existing.scoreReasons=scored.reasons
  existing.mergeHistory.push({mergedAt:new Date(),duplicateLeadId:context.duplicateLeadId,source:context.source,changedFields:uniqueStrings(changed)})
  await existing.save()
  await DomainEventService.emit({organizationId:existing.organizationId,aggregateType:'lead',aggregateId:existing._id.toString(),eventType:'lead.merged',leadId:existing._id.toString(),contactId:existing.contactId?.toString(),actorId:context.actorId,payload:{summary:`Duplicate inquiry merged from ${context.source}`,changedFields:uniqueStrings(changed),duplicateLeadId:context.duplicateLeadId||''}})
  return existing
}

const findDuplicates=async(organizationId:string,phone:string,email:string)=>Lead.find({organizationId,$or:[{normalizedPhone:phone},...(email?[{normalizedEmail:email}]:[])]}).sort({createdAt:1})

const createLead=async(organizationId:string,payload:Partial<ILead>,creatorAgentId?:string):Promise<ILead>=>{
  if(!payload.name||!payload.phone)throw new ApiError(400,'Lead name and phone are required')
  const normalizedPhone=normalizePhone(payload.phone);const normalizedEmail=normalizeOptionalEmail(payload.email)
  const prepared:any={...payload,phone:normalizedPhone,normalizedPhone,email:normalizedEmail||undefined,normalizedEmail,source:payload.source||'Website'}
  const duplicates:any[]=await findDuplicates(organizationId,normalizedPhone,normalizedEmail)
  if(duplicates.length){
    const target=duplicates[0]
    if(duplicates.length>1){for(const duplicate of duplicates.slice(1)){await Lead.deleteOne({_id:duplicate._id,organizationId});await mergeInto(target,duplicate.toObject(),{source:'identity-consolidation',duplicateLeadId:duplicate._id.toString(),actorId:creatorAgentId})}}
    return mergeInto(target,prepared,{source:String(prepared.source||'Unknown'),actorId:creatorAgentId})
  }
  await EntitlementService.assertLimit(organizationId,'leads')
  const config:any=await CrmService.getConfig(organizationId)
  if(prepared.assignedAgent){const validAgent=await User.exists({_id:prepared.assignedAgent,organizationId,status:'active',userRole:{$in:['agency_owner','agency_admin','agent']}});if(!validAgent)throw new ApiError(400,'Assigned agent must be an active member of this agency')}
  let propertyAgent:string|undefined
  if(prepared.propertyInterest?.[0]){const prop:any=await Property.findOne({_id:prepared.propertyInterest[0],organizationId}).select('agentId').lean();propertyAgent=prop?.agentId?.toString()}
  const assignment=prepared.assignedAgent?{agentId:String(prepared.assignedAgent),strategy:'manual',reason:'Agent selected during capture'}:await CrmService.chooseAgent(organizationId,prepared,propertyAgent)
  prepared.assignedAgent=assignment.agentId||undefined
  const contact:any=await ensureContact(organizationId,prepared);if(contact)prepared.contactId=contact._id
  const scored=scoreLead(prepared);const now=new Date();prepared.leadScore=scored.score;prepared.scoreReasons=scored.reasons;prepared.responseDueAt=new Date(now.getTime()+(config.responseSlaMinutes||30)*60_000);prepared.lastContact=undefined
  if(prepared.attribution)prepared.attribution={...prepared.attribution,firstTouchAt:now,lastTouchAt:now}
  try{
    const result:any=await Lead.create({...prepared,organizationId})
    if(result.assignedAgent)await CrmService.recordAssignment({organizationId,leadId:result._id.toString(),assignedAgentId:result.assignedAgent.toString(),strategy:assignment.strategy,reason:assignment.reason,actorId:creatorAgentId})
    await DomainEventService.emit({organizationId,aggregateType:'lead',aggregateId:result._id.toString(),eventType:'lead.created',leadId:result._id.toString(),contactId:result.contactId?.toString(),actorId:creatorAgentId,payload:{summary:`New lead created from ${result.source}`,leadScore:result.leadScore,responseDueAt:result.responseDueAt?.toISOString(),assignmentStrategy:assignment.strategy}})
    return result
  }catch(error:any){if(error?.code===11000){const after:any=(await findDuplicates(organizationId,normalizedPhone,normalizedEmail))[0];if(after)return mergeInto(after,prepared,{source:String(prepared.source||'Unknown'),actorId:creatorAgentId})}throw error}
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

const buildLeadWhere=(filters:ILeadFilter)=>{const{searchTerm,organizationId,leadStatus,source,assignedAgent,propertyType,minBudget,maxBudget,sla,minScore}=filters;const conditions:any[]=[];if(organizationId)conditions.push({organizationId});if(searchTerm){const escaped=String(searchTerm).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');conditions.push({$or:['name','email','phone','locationPreference','attribution.utmCampaign'].map(field=>({[field]:{$regex:escaped,$options:'i'}}))})}if(leadStatus)conditions.push({leadStatus});if(source)conditions.push({source});if(assignedAgent)conditions.push({assignedAgent});if(propertyType)conditions.push({propertyType});if(minBudget!==undefined&&minBudget!=='')conditions.push({budgetMax:{$gte:Number(minBudget)}});if(maxBudget!==undefined&&maxBudget!=='')conditions.push({budgetMin:{$lte:Number(maxBudget)}});if(minScore!==undefined&&minScore!=='')conditions.push({leadScore:{$gte:Number(minScore)}});if(sla==='breached')conditions.push({firstResponseAt:{$exists:false},responseDueAt:{$lt:new Date()}});if(sla==='due')conditions.push({firstResponseAt:{$exists:false},responseDueAt:{$gte:new Date()}});return conditions.length?{$and:conditions}:{} }
const getAllLeads=async(filters:ILeadFilter,paginationOptions:IPaginationOptions):Promise<IGenericResponse<ILead[]>>=>{const where=buildLeadWhere(filters);const{page,limit,skip,sortBy,sortOrder}=paginationHelper.calculatePagination(paginationOptions);const [result,total]=await Promise.all([Lead.find(where).populate(userRefPopulate('assignedAgent', 'name email phoneNumber userRole')).populate('propertyInterest','title price images city').populate('contactId','name email phone company').sort({[sortBy]:sortOrder}).skip(skip).limit(limit),Lead.countDocuments(where)]);return{meta:{page,limit,total},data:result}}

const getLeadById=async(organizationId:string,id:string)=>{const result=await Lead.findOne({_id:id,organizationId}).populate(userRefPopulate('assignedAgent', 'name email phoneNumber userRole')).populate('propertyInterest','title price images city propertyType bedrooms bathrooms').populate('contactId','name email phone address company notes tags');if(!result)throw new ApiError(404,'Lead not found');return result}
const updateLead=async(organizationId:string,id:string,payload:Partial<ILead>,actorId?:string)=>{const current:any=await Lead.findOne({_id:id,organizationId});if(!current)throw new ApiError(404,'Lead not found');if(payload.phone){payload.phone=normalizePhone(payload.phone);payload.normalizedPhone=payload.phone}if(payload.email!==undefined)payload.normalizedEmail=normalizeOptionalEmail(payload.email);const scored=scoreLead({...current.toObject(),...payload});payload.leadScore=scored.score;payload.scoreReasons=scored.reasons;const result=await Lead.findOneAndUpdate({_id:id,organizationId},payload,{new:true,runValidators:true}).populate(userRefPopulate('assignedAgent', 'name email phoneNumber userRole')).populate('propertyInterest','title price images city');await DomainEventService.emit({organizationId,aggregateType:'lead',aggregateId:id,eventType:'lead.updated',leadId:id,actorId,payload:{summary:'Lead profile fields updated',fields:Object.keys(payload)}});return result}
const updateLeadStatus=async(organizationId:string,id:string,leadStatus:string,lostReason?:string,agentId?:string)=>{const lead:any=await Lead.findOne({_id:id,organizationId});if(!lead)throw new ApiError(404,'Lead not found');const config:any=await CrmService.getConfig(organizationId);const stage=(config.pipelineStages||[]).find((s:any)=>s.key===leadStatus);if(!stage)throw new ApiError(400,'Pipeline stage is not configured for this agency');if(stage.lost&&(!lostReason||!(config.lostReasons||[]).includes(lostReason)))throw new ApiError(400,'A configured lost reason is required');const previous=lead.leadStatus;lead.leadStatus=leadStatus;lead.lostReason=stage.lost?lostReason||'':'';lead.lastContact=new Date();await lead.save();await DomainEventService.emit({organizationId,aggregateType:'lead',aggregateId:id,eventType:'lead.stage_changed',leadId:id,actorId:agentId||lead.assignedAgent?.toString(),payload:{summary:`Stage changed from ${previous} to ${leadStatus}${lostReason?` · ${lostReason}`:''}`,previousStatus:previous,leadStatus,lostReason:lostReason||''}});return lead}
const assignAgent=async(organizationId:string,id:string,assignedAgent:string,_agentName?:string,actorId?:string)=>{const [current,agent]:any[]=await Promise.all([Lead.findOne({_id:id,organizationId}),User.findOne({_id:assignedAgent,organizationId,status:'active',userRole:{$in:['agency_owner','agency_admin','agent']}})]);if(!current)throw new ApiError(404,'Lead not found');if(!agent)throw new ApiError(400,'Assigned agent must be an active member of this agency');const previous=current.assignedAgent?.toString();current.assignedAgent=assignedAgent;await current.save();await CrmService.recordAssignment({organizationId,leadId:id,previousAgentId:previous,assignedAgentId:assignedAgent,strategy:'manual',reason:'Manual override',actorId});await DomainEventService.emit({organizationId,aggregateType:'lead',aggregateId:id,eventType:'lead.assigned',leadId:id,actorId,payload:{summary:'Lead manually reassigned',previousAgentId:previous||'',assignedAgentId:assignedAgent}});return current.populate(userRefPopulate('assignedAgent', 'name email phoneNumber userRole'))}
const recordFirstResponse=async(organizationId:string,id:string,actorId?:string)=>{const now=new Date();const lead:any=await Lead.findOneAndUpdate({_id:id,organizationId,firstResponseAt:{$exists:false}},{$set:{firstResponseAt:now,lastContact:now},...( { } )},{new:true});if(lead){if(lead.responseDueAt&&lead.responseDueAt<now){lead.slaBreachedAt=now;await lead.save()}await DomainEventService.emit({organizationId,aggregateType:'lead',aggregateId:id,eventType:'lead.response_recorded',leadId:id,actorId,payload:{summary:'First human response recorded',withinSla:!lead.responseDueAt||lead.responseDueAt>=now}})}return lead}
const deleteLead=async(organizationId:string,id:string,actorId?:string)=>{const result:any=await Lead.findOneAndDelete({_id:id,organizationId});if(!result)throw new ApiError(404,'Lead not found');await DomainEventService.emit({organizationId,aggregateType:'lead',aggregateId:id,eventType:'lead.deleted',actorId,payload:{summary:`Lead deleted: ${result.name}`,leadName:result.name,source:result.source,leadStatus:result.leadStatus}});return result}

const parseCsv=(text:string)=>{const rows:string[][]=[];let row:string[]=[],field='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++}else quoted=!quoted}else if(c===','&&!quoted){row.push(field);field=''}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);field='';if(row.some(v=>v.trim()))rows.push(row);row=[]}else field+=c}row.push(field);if(row.some(v=>v.trim()))rows.push(row);return rows}
const csvPreview=(csv:string,mapping:Record<string,string>)=>{const rows=parseCsv(csv);if(rows.length<2)throw new ApiError(400,'CSV must include a header and at least one data row');const headers=rows[0].map(v=>v.trim());const idx=(target:string)=>headers.indexOf(mapping[target]||target);const errors:any[]=[];const preview=rows.slice(1,51).map((r,rowIndex)=>{const data:any={};for(const key of ['name','phone','email','source','budgetMin','budgetMax','locationPreference','propertyType','notes']){const i=idx(key);if(i>=0)data[key]=r[i]?.trim()||''}const rowErrors:string[]=[];if(!data.name)rowErrors.push('Name is required');try{data.phone=normalizePhone(data.phone)}catch{rowErrors.push('Valid Bangladesh phone is required')}if(data.email){try{data.email=normalizeEmail(data.email);if(!data.email.includes('@'))throw new Error()}catch{rowErrors.push('Email is invalid')}}if(data.budgetMin&&Number.isNaN(Number(data.budgetMin)))rowErrors.push('budgetMin must be numeric');if(data.budgetMax&&Number.isNaN(Number(data.budgetMax)))rowErrors.push('budgetMax must be numeric');if(rowErrors.length)errors.push({row:rowIndex+2,errors:rowErrors});return{row:rowIndex+2,data,errors:rowErrors}});return{headers,totalRows:rows.length-1,preview,errors}}
const importCsv=async(organizationId:string,csv:string,mapping:Record<string,string>,actorId?:string)=>{const rows=parseCsv(csv);const headers=rows[0]?.map(v=>v.trim())||[];const idx=(target:string)=>headers.indexOf(mapping[target]||target);const results:any[]=[];for(let n=1;n<rows.length;n++){const r=rows[n];if(!r.some(v=>v.trim()))continue;const data:any={};for(const key of ['name','phone','email','source','budgetMin','budgetMax','locationPreference','propertyType','notes']){const i=idx(key);if(i>=0)data[key]=r[i]?.trim()||undefined}if(data.budgetMin)data.budgetMin=Number(data.budgetMin);if(data.budgetMax)data.budgetMax=Number(data.budgetMax);try{const normalizedPhone=normalizePhone(data.phone);const normalizedEmail=normalizeOptionalEmail(data.email);const existed=Boolean((await findDuplicates(organizationId,normalizedPhone,normalizedEmail))[0]);const lead:any=await createLead(organizationId,data,actorId);results.push({row:n+1,status:existed?'merged':'created',leadId:lead._id})}catch(error){results.push({row:n+1,status:'error',error:error instanceof Error?error.message:'Import failed'})}}return{total:results.length,created:results.filter(r=>r.status==='created').length,merged:results.filter(r=>r.status==='merged').length,errors:results.filter(r=>r.status==='error'),rows:results}}
const escapeCsv=(v:any)=>{const s=v==null?'':String(v);return/[",\n\r]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
const exportCsv=async(organizationId:string,filters:ILeadFilter)=>{const where=buildLeadWhere({...filters,organizationId});const maxExportRows=50_000;const total=await Lead.countDocuments(where).limit(maxExportRows+1);if(total>maxExportRows)throw new ApiError(413,`Export contains more than ${maxExportRows.toLocaleString()} rows. Narrow the filters and retry.`);const data:any[]=await Lead.find(where).populate('assignedAgent','name').sort({createdAt:-1}).limit(maxExportRows).select('name phone email source leadStatus leadScore assignedAgent budgetMin budgetMax locationPreference propertyType attribution responseDueAt firstResponseAt createdAt').lean();const headers=['name','phone','email','source','leadStatus','leadScore','assignedAgent','budgetMin','budgetMax','locationPreference','propertyType','utmSource','utmCampaign','responseDueAt','firstResponseAt','createdAt'];return[headers.join(','),...data.map((lead:any)=>headers.map(h=>escapeCsv(h==='assignedAgent'?lead.assignedAgent?.name:h==='utmSource'?lead.attribution?.utmSource:h==='utmCampaign'?lead.attribution?.utmCampaign:lead[h])).join(','))].join('\n')}

export const LeadService={createLead,publicCaptureLead,getAllLeads,getLeadById,updateLead,updateLeadStatus,assignAgent,recordFirstResponse,deleteLead,csvPreview,importCsv,exportCsv}
