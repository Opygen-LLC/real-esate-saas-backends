import { Schema, model } from 'mongoose'
import { ILead, LeadModel } from './lead.interface'
import { LEAD_STATUS, LEAD_STATUS_VALUES, normalizeLeadStatus } from './leadStatus.contract'

const leadSchema = new Schema<ILead, LeadModel>({
  organizationId:{type:String,required:true,index:true},
  name:{type:String,required:true,trim:true},
  email:{type:String,trim:true,lowercase:true},
  normalizedEmail:{type:String,trim:true,lowercase:true,index:true},
  phone:{type:String,required:true,trim:true},
  normalizedPhone:{type:String,required:true,trim:true,index:true},
  source:{type:String,enum:['Website','WhatsApp','Facebook','Instagram','Google','Referral','WalkIn','Portal','Phone','Email','Ad','Other'],default:'Website'},
  budgetMin:{type:Number,default:0},
  budgetMax:{type:Number,default:0},
  currency:{type:String,enum:['BDT'],default:'BDT'},
  propertyInterest:[{type:Schema.Types.ObjectId,ref:'Property'}],
  locationPreference:{type:String,default:''},
  propertyType:{type:String,default:'Apartment'},
  bedrooms:{type:Number,default:1},
  leadStatus:{type:String,enum:LEAD_STATUS_VALUES,default:LEAD_STATUS.NEW,required:true,index:true},
  assignedAgent:{type:Schema.Types.ObjectId,ref:'User',index:true},
  leadAllowanceReservationId:{type:String,index:true},
  benefitPeriodId:{type:Schema.Types.ObjectId,ref:'SubscriptionBenefitPeriod',index:true},
  leadAllowanceConsumedAt:{type:Date,index:true},

  isLocked:{type:Boolean,default:false,required:true},
  lockReason:{type:String,enum:['subscription_limit'],default:null},
  lockedAt:{type:Date,default:null},
  lockedBy:{type:String,default:null},

  createdBy:{type:Schema.Types.ObjectId,ref:'User',index:true},
  updatedBy:{type:Schema.Types.ObjectId,ref:'User'},
  followUpDate:{type:Date,index:true},
  convertedAt:{type:Date,index:true},
  convertedBy:{type:Schema.Types.ObjectId,ref:'User'},
  convertedContactId:{type:Schema.Types.ObjectId,ref:'Contact',index:true},
  isConverted:{type:Boolean,default:false,required:true,index:true},
  firstContactedAt:{type:Date,index:true},

  // Legacy compatibility fields. Keep until the migration/deprecation phase is complete.
  contactId:{type:Schema.Types.ObjectId,ref:'Contact'},
  lastContact:{type:Date},
  nextFollowUp:{type:Date},
  notes:{type:String,default:''},
  lostReason:{type:String,default:''},

  leadScore:{type:Number,default:0,min:0,max:100,index:true},
  scoreReasons:[{type:String}],
  responseDueAt:{type:Date,index:true},
  firstResponseAt:{type:Date},
  slaBreachedAt:{type:Date,index:true},
  attribution:{utmSource:String,utmMedium:String,utmCampaign:String,utmTerm:String,utmContent:String,referrer:String,landingPage:String,firstTouchAt:Date,lastTouchAt:Date},
  mergeHistory:[{mergedAt:{type:Date,default:Date.now},duplicateLeadId:String,source:String,changedFields:[String]}],
},{timestamps:true})

leadSchema.pre('validate', function (this: ILead) {
  const normalized = normalizeLeadStatus(this.leadStatus)
  if (normalized) this.leadStatus = normalized
})

leadSchema.index({organizationId:1,normalizedPhone:1},{unique:true,partialFilterExpression:{normalizedPhone:{$type:'string'}}})
leadSchema.index({organizationId:1,normalizedEmail:1},{unique:true,partialFilterExpression:{normalizedEmail:{$type:'string',$gt:''}}})

leadSchema.index({organizationId:1,leadAllowanceReservationId:1},{name:'lead_tenant_allowance_reservation'})
leadSchema.index({organizationId:1,benefitPeriodId:1,createdAt:-1},{name:'lead_tenant_benefit_period_created'})
leadSchema.index({organizationId:1,isLocked:1,createdAt:-1,_id:-1},{name:'lead_tenant_lock_created'})

// Phase 1 canonical CRM access paths.
leadSchema.index({organizationId:1,isConverted:1,leadStatus:1},{name:'lead_tenant_converted_status'})
leadSchema.index({organizationId:1,assignedAgent:1,isConverted:1},{name:'lead_tenant_assignee_converted'})
leadSchema.index({organizationId:1,followUpDate:1,assignedAgent:1},{name:'lead_tenant_followup_assignee'})
leadSchema.index({organizationId:1,source:1},{name:'lead_tenant_source'})
leadSchema.index({organizationId:1,createdAt:-1},{name:'lead_tenant_created'})
leadSchema.index({organizationId:1,isConverted:1,createdAt:-1},{name:'lead_tenant_converted_created'})
leadSchema.index({organizationId:1,assignedAgent:1,isConverted:1,followUpDate:1},{name:'lead_tenant_assignee_converted_followup'})
leadSchema.index({organizationId:1,leadStatus:1,isConverted:1,createdAt:-1},{name:'lead_tenant_status_converted_created'})
leadSchema.index({organizationId:1,isConverted:1,source:1,createdAt:-1},{name:'lead_tenant_converted_source_created'})

// Existing query/SLA indexes kept for backward compatibility and current dashboards.
leadSchema.index({organizationId:1,leadStatus:1,assignedAgent:1})
leadSchema.index({organizationId:1,responseDueAt:1,firstResponseAt:1})
leadSchema.index({organizationId:1,assignedAgent:1,createdAt:-1})
leadSchema.index({organizationId:1,assignedAgent:1,leadStatus:1})
leadSchema.index({organizationId:1,leadStatus:1,updatedAt:-1})

export const Lead=model<ILead,LeadModel>('Lead',leadSchema)
