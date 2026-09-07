import { randomUUID } from 'crypto'
import type { ClientSession } from 'mongoose'
import { DomainEventService, type DomainEventInput } from './domainEvent.service'
import { OperationsJob } from '../operationsQueue/operationsJob.model'

/** Existing OperationsJob collection is the durable outbox; no network calls in a transaction. */
const queuePublish = async (event: DomainEventInput, session: ClientSession): Promise<void> => {
  await OperationsJob.create([{
    organizationId: event.organizationId, type: 'domain_event_publish', entityId: randomUUID(),
    runAt: new Date(), payload: { event }, maxAttempts: 10,
  }], { session })
}

const emit = async (event: DomainEventInput, session: ClientSession): Promise<void> => {
  await DomainEventService.emit(event, { session, deferPublish: true })
  await queuePublish(event, session)
}

export const TransactionalOutbox = { emit, queuePublish }
