import { IGenericResponse, IPaginationOptions } from '../../../interfaces/common'
import paginationHelper from '../../helpers/paginationHelper'
import { DomainEventService } from '../domainEvent/domainEvent.service'
import { LeadService } from '../lead/lead.service'
import { IActivity } from './activity.interface'
import { Activity } from './activity.model'
import { userRefPopulate } from '../user/userProfile.service'

const createActivity=async(organizationId:string,payload:Partial<IActivity>):Promise<IActivity>=>{
  if(!payload.leadId) throw new Error('leadId is required for CRM activity')
  const eventType=`activity.${payload.type||'note'}`
  const event:any=await DomainEventService.emit({organizationId,aggregateType:'lead',aggregateId:String(payload.leadId),eventType,leadId:String(payload.leadId),propertyId:payload.propertyId?String(payload.propertyId):undefined,contactId:payload.contactId?String(payload.contactId):undefined,actorId:payload.agentId?String(payload.agentId):undefined,payload:{summary:payload.content||payload.title||'CRM activity',title:payload.title||'',...(payload.metadata||{})}})
  if(['call','email','whatsapp','meeting'].includes(String(payload.type))) await LeadService.recordFirstResponse(organizationId,String(payload.leadId),payload.agentId?String(payload.agentId):undefined)
  const activity:any=await Activity.findOne({'metadata.domainEventId':event._id})
  if(!activity) throw new Error('CRM activity projection was not created')
  return activity
}
const getActivitiesByLead=async(organizationId:string,leadId:string,paginationOptions:IPaginationOptions):Promise<IGenericResponse<IActivity[]>>=>{const{page,limit,skip}=paginationHelper.calculatePagination(paginationOptions);const[result,total]=await Promise.all([Activity.find({organizationId,leadId}).populate(userRefPopulate('agentId', 'name email userRole')).sort({createdAt:-1}).skip(skip).limit(limit),Activity.countDocuments({organizationId,leadId})]);return{meta:{page,limit,total},data:result}}
export const ActivityService={createActivity,getActivitiesByLead}
