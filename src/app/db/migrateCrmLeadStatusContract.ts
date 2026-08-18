import mongoose from 'mongoose'
import config from '../../config'
import {
  DEFAULT_LEAD_PIPELINE_STAGES,
  LEAD_STATUS,
  LEAD_STATUS_VALUES,
  normalizeLeadStatus,
} from '../module/lead/leadStatus.contract'

const canonicalStageDocuments = (stages: any[] = []) => {
  const byKey = new Map<string, any>()
  for (const stage of stages) {
    const normalized = normalizeLeadStatus(stage?.key)
    if (normalized && !byKey.has(normalized)) byKey.set(normalized, stage)
  }
  return DEFAULT_LEAD_PIPELINE_STAGES.map((canonical) => {
    const existing = byKey.get(canonical.key)
    return {
      ...canonical,
      color: existing?.color || '#64748b',
    }
  })
}

const run = async () => {
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const leads = db.collection('leads')
  const configs = db.collection('crmconfigs')
  const allowedBeforeMigration = [...LEAD_STATUS_VALUES, 'Qualified']
  const unknownStatuses = await leads.distinct('leadStatus', {
    leadStatus: { $exists: true, $nin: [...allowedBeforeMigration, null, ''] },
  })
  if (unknownStatuses.length) {
    throw new Error(
      `CRM status migration stopped because unsupported lead statuses exist: ${unknownStatuses.map(String).sort().join(', ')}. Map these records to a canonical Phase 0 status before retrying.`,
    )
  }

  const [qualifiedResult, missingStatusResult] = await Promise.all([
    leads.updateMany({ leadStatus: 'Qualified' }, { $set: { leadStatus: LEAD_STATUS.INTERESTED } }),
    leads.updateMany(
      { $or: [{ leadStatus: { $exists: false } }, { leadStatus: null }, { leadStatus: '' }] },
      { $set: { leadStatus: LEAD_STATUS.NEW } },
    ),
  ])

  let configsUpdated = 0
  for await (const crmConfig of configs.find({})) {
    const canonicalStages = canonicalStageDocuments(crmConfig.pipelineStages || [])
    await configs.updateOne({ _id: crmConfig._id }, { $set: { pipelineStages: canonicalStages } })
    configsUpdated += 1
  }

  console.log(
    `CRM Phase 0 status migration completed: ${qualifiedResult.modifiedCount} Qualified leads moved to Interested, ${missingStatusResult.modifiedCount} missing statuses set to New, ${configsUpdated} CRM pipeline configs canonicalized.`,
  )
  await mongoose.disconnect()
}

run().catch(async (error) => {
  console.error(error)
  await mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
