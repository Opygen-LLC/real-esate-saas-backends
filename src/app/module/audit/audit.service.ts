import { ClientSession } from 'mongoose'
import { AuditEvent } from './audit.model'

export interface AuditInput { organizationId?: string; actorId?: string; actorRole?: string; action: string;
  entityType: string; entityId?: string; reason?: string; metadata?: Record<string, unknown>; requestId?: string; ip?: string }

export const writeAudit = async (input: AuditInput, session?: ClientSession): Promise<void> => {
  await AuditEvent.create([input], session ? { session } : undefined)
}
