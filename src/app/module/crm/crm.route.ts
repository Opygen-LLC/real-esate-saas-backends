import express from 'express'
import { z } from 'zod'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { LEAD_STATUS_VALUES, normalizeLeadStatus } from '../lead/leadStatus.contract'
import { CrmController } from './crm.controller'

const router = express.Router()
const leadStatusKey = z.preprocess((value: unknown) => normalizeLeadStatus(value) ?? value, z.enum(LEAD_STATUS_VALUES))
const stage = z.object({ key: leadStatusKey, label: z.string().trim().min(1).max(80), color: z.string().trim().max(30).optional(), order: z.number().int().min(0), terminal: z.boolean().optional(), won: z.boolean().optional(), lost: z.boolean().optional() })
const territory = z.object({ name: z.string().trim().min(1).max(100), locations: z.array(z.string().trim().min(1).max(120)).max(64), agentIds: z.array(z.string()).max(100), priority: z.number().int().min(-1000).max(1000).optional() })
const updateSchema = z.object({ body: z.object({ pipelineStages: z.array(stage).min(2).max(30).optional(), lostReasons: z.array(z.string().trim().min(1).max(120)).max(50).optional(), responseSlaMinutes: z.number().int().min(1).max(10080).optional(), assignment: z.object({ mode: z.enum(['round_robin', 'territory', 'workload', 'manual']).optional(), eligibleAgentIds: z.array(z.string()).max(500).optional(), workloadCap: z.number().int().min(1).max(10000).optional(), territoryRules: z.array(territory).max(100).optional() }).optional(), reminders: z.object({ taskMinutesBefore: z.number().int().min(0).max(10080).optional(), viewingMinutesBefore: z.number().int().min(0).max(10080).optional() }).optional() }).strict() })

router.get('/config', authMiddlewares.requirePermission('leads.read'), CrmController.getConfig)
router.patch('/config', authMiddlewares.requirePermission('crm.configure'), validateRequest(updateSchema), CrmController.updateConfig)
router.get('/assignment-history/:leadId', authMiddlewares.requirePermission('leads.read'), CrmController.assignmentHistory)
export const CrmRoute = router
