export const OUTBOX_QUEUE = 'outbox';
export const OUTBOX_TOPIC_INTENT_SCHEDULE = 'intent.schedule';
export const OUTBOX_TOPIC_MEMORY_EXTRACT = 'memory.extract';
export const OUTBOX_TOPIC_PUSH_SEND = 'push.send';
export const OUTBOX_TOPIC_PUSH_RECEIPT = 'push.receipt';

export type OutboxJob = { eventId: string };
