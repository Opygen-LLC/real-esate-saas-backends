import { Schema, model } from 'mongoose'
import { ILead, LeadModel } from './lead.interface'
const leadSchema = new Schema<ILead, LeadModel>({
  organizationId:{type:String,required:true,index:true}, name:{type:String,required:true,trim:true}, email:{type:String,trim:true,lowercase:true}, normalizedEmail:{type:String,trim:true,lowercase:true,index:true}, phone:{type:String,required:true,trim:true}, normalizedPhone:{type:String,required:true,trim:true,index:true},
  source:{type:String,enum:['Website','WhatsApp','Facebook','Instagram','Google','Referral','WalkIn','Portal','Phone','Email','Ad','Other'],default:'Website'}, budgetMin:{type:Number,default:0},budgetMax:{type:Number,default:0},currency:{type:String,enum:['BDT'],default:'BDT'},
  propertyInterest:[{type:Schema.Types.ObjectId,ref:'Property'}],locationPreference:{type:String,default:''},propertyType:{type:String,default:'Apartment'},bedrooms:{type:Number,default:1},leadStatus:{type:String,default:'New',required:true,index:true},
  assignedAgent:{type:Schema.Types.ObjectId,ref:'User',index:true},contactId:{type:Schema.Types.ObjectId,ref:'Contact'},lastContact:{type:Date},nextFollowUp:{type:Date},notes:{type:String,default:''},lostReason:{type:String,default:''},
  leadScore:{type:Number,default:0,min:0,max:100,index:true},scoreReasons:[{type:String}],responseDueAt:{type:Date,index:true},firstResponseAt:{type:Date},slaBreachedAt:{type:Date,index:true},
  attribution:{utmSource:String,utmMedium:String,utmCampaign:String,utmTerm:String,utmContent:String,referrer:String,landingPage:String,firstTouchAt:Date,lastTouchAt:Date},
  mergeHistory:[{mergedAt:{type:Date,default:Date.now},duplicateLeadId:String,source:String,changedFields:[String]}],
},{timestamps:true})
leadSchema.index({organizationId:1,normalizedPhone:1},{unique:true,partialFilterExpression:{normalizedPhone:{$type:'string'}}})
leadSchema.index({organizationId:1,normalizedEmail:1},{unique:true,partialFilterExpression:{normalizedEmail:{$type:'string',$gt:''}}})
leadSchema.index({organizationId:1,leadStatus:1,assignedAgent:1})
leadSchema.index({organizationId:1,responseDueAt:1,firstResponseAt:1})
export const Lead=model<ILead,LeadModel>('Lead',leadSchema)
