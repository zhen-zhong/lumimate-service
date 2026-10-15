import { AgentIntentStatus, AgentRunStatus, MemoryStatus, PushDeliveryStatus } from '@prisma/client';

// Timeline states describe what has actually happened. They are intentionally
// independent from persistence enums so every companion capability exposes one
// user-facing lifecycle.
export const CompanionCommitmentState = {
  PROPOSED: 'PROPOSED',
  AWAITING_CONFIRMATION: 'AWAITING_CONFIRMATION',
  SCHEDULED: 'SCHEDULED',
  EXECUTING: 'EXECUTING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  QUEUED: 'QUEUED',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
} as const;

export type CompanionCommitmentState = (typeof CompanionCommitmentState)[keyof typeof CompanionCommitmentState];

export function commitmentStateForIntent(status: AgentIntentStatus): CompanionCommitmentState {
  switch (status) {
    case AgentIntentStatus.AWAITING_CONFIRMATION: return CompanionCommitmentState.AWAITING_CONFIRMATION;
    case AgentIntentStatus.SCHEDULED: return CompanionCommitmentState.SCHEDULED;
    case AgentIntentStatus.RUNNING: return CompanionCommitmentState.EXECUTING;
    case AgentIntentStatus.COMPLETED: return CompanionCommitmentState.COMPLETED;
    case AgentIntentStatus.FAILED: return CompanionCommitmentState.FAILED;
    case AgentIntentStatus.CANCELLED: return CompanionCommitmentState.CANCELLED;
    case AgentIntentStatus.EXPIRED: return CompanionCommitmentState.EXPIRED;
  }
}

export function commitmentStateForRun(status: AgentRunStatus): CompanionCommitmentState {
  switch (status) {
    case AgentRunStatus.AWAITING_CONFIRMATION: return CompanionCommitmentState.AWAITING_CONFIRMATION;
    case AgentRunStatus.RUNNING: return CompanionCommitmentState.EXECUTING;
    case AgentRunStatus.COMPLETED: return CompanionCommitmentState.COMPLETED;
    case AgentRunStatus.FAILED: return CompanionCommitmentState.FAILED;
    case AgentRunStatus.CANCELLED: return CompanionCommitmentState.CANCELLED;
  }
}

export function commitmentStateForMemory(status: MemoryStatus): CompanionCommitmentState {
  switch (status) {
    case MemoryStatus.CANDIDATE: return CompanionCommitmentState.AWAITING_CONFIRMATION;
    case MemoryStatus.CONFIRMED: return CompanionCommitmentState.COMPLETED;
    case MemoryStatus.ARCHIVED: return CompanionCommitmentState.EXPIRED;
    case MemoryStatus.DELETED: return CompanionCommitmentState.CANCELLED;
  }
}

export function commitmentStateForPush(status: PushDeliveryStatus): CompanionCommitmentState {
  switch (status) {
    case PushDeliveryStatus.QUEUED: return CompanionCommitmentState.QUEUED;
    case PushDeliveryStatus.SENT: return CompanionCommitmentState.SENT;
    case PushDeliveryStatus.DELIVERED: return CompanionCommitmentState.DELIVERED;
    case PushDeliveryStatus.FAILED: return CompanionCommitmentState.FAILED;
    case PushDeliveryStatus.CANCELLED: return CompanionCommitmentState.CANCELLED;
  }
}
