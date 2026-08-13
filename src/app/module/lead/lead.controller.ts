import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import pick from '../../../shared/pick'
import { requireTenant } from '../../middlewares/auth'
import { LeadService } from './lead.service'
const actor=(req:Request)=>req.user?._id||req.user?.id
const createLead=catchAsync(async(req,res)=>sendResponse(res,{statusCode:201,success:true,message:'Lead created or merged successfully',data:await LeadService.createLead(requireTenant(req),req.body,actor(req))}))
const publicCaptureLead=catchAsync(async(req,res)=>sendResponse(res,{statusCode:201,success:true,message:'Inquiry submitted successfully.',data:await LeadService.publicCaptureLead(req.body,{ip:req.ip,requestId:req.requestId})}))
const getAllLeads=catchAsync(async(req,res)=>{const filters=pick(req.query,['searchTerm','leadStatus','source','assignedAgent','propertyType','minBudget','maxBudget','sla','minScore']);filters.organizationId=requireTenant(req);const result=await LeadService.getAllLeads(filters,pick(req.query,['page','limit','sortBy','sortOrder']));sendResponse(res,{statusCode:200,success:true,message:'Leads fetched successfully',meta:result.meta,data:result.data})})
const getLeadById=catchAsync(async(req,res)=>sendResponse(res,{statusCode:200,success:true,message:'Lead fetched successfully',data:await LeadService.getLeadById(requireTenant(req),req.params.id)}))
const updateLead=catchAsync(async(req,res)=>sendResponse(res,{statusCode:200,success:true,message:'Lead updated successfully',data:await LeadService.updateLead(requireTenant(req),req.params.id,req.body,actor(req))}))
const updateLeadStatus=catchAsync(async(req,res)=>sendResponse(res,{statusCode:200,success:true,message:'Lead pipeline stage updated successfully',data:await LeadService.updateLeadStatus(requireTenant(req),req.params.id,req.body.leadStatus,req.body.lostReason,actor(req))}))
const assignAgent=catchAsync(async(req,res)=>sendResponse(res,{statusCode:200,success:true,message:'Agent assigned successfully',data:await LeadService.assignAgent(requireTenant(req),req.params.id,req.body.assignedAgent,req.body.agentName,actor(req))}))
const recordResponse=catchAsync(async(req,res)=>sendResponse(res,{statusCode:200,success:true,message:'Lead response SLA updated',data:await LeadService.recordFirstResponse(requireTenant(req),req.params.id,actor(req))}))
const deleteLead=catchAsync(async(req,res)=>sendResponse(res,{statusCode:200,success:true,message:'Lead deleted successfully',data:await LeadService.deleteLead(requireTenant(req),req.params.id,actor(req))}))
const previewCsv=catchAsync(async(req,res)=>sendResponse(res,{statusCode:200,success:true,message:'CSV validation preview generated',data:LeadService.csvPreview(req.body.csv,req.body.mapping||{})}))
const importCsv=catchAsync(async(req,res)=>sendResponse(res,{statusCode:200,success:true,message:'CSV import completed',data:await LeadService.importCsv(requireTenant(req),req.body.csv,req.body.mapping||{},actor(req))}))
const exportCsv=catchAsync(async(req:Request,res:Response)=>{const org=requireTenant(req);const filters:any=pick(req.query,['searchTerm','leadStatus','source','assignedAgent','propertyType','sla','minScore']);const csv=await LeadService.exportCsv(org,filters);res.status(httpStatus.OK).setHeader('content-type','text/csv; charset=utf-8');res.setHeader('content-disposition',`attachment; filename="leads-${new Date().toISOString().slice(0,10)}.csv"`);res.send(`\uFEFF${csv}`)})
export const LeadController={createLead,publicCaptureLead,getAllLeads,getLeadById,updateLead,updateLeadStatus,assignAgent,recordResponse,deleteLead,previewCsv,importCsv,exportCsv}
