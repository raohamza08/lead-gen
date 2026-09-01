import { EmailMessageStatus } from "@prisma/client";

/**
 * The explicit state machine for the sending half of an EmailMessage's
 * lifecycle (Part: Preparation Pipeline / Sending Queue, 2026-09-01) —
 * requirement #9: PREPARING (DRAFT/QUEUED/PENDING_APPROVAL — anything before
 * a required agent has succeeded) must never reach SENT, and neither must a
 * terminally-FAILED preparation. Every status this module is allowed to
 * write is named here once; SendingQueueService, SendingWorker and
 * SendingSweepWorker all reference these constants instead of repeating the
 * same status-list literals, so "what can become X" has exactly one source
 * of truth instead of three that could quietly drift apart.
 *
 * DRAFT, PENDING_APPROVAL and CANCELLED aren't listed as "from" states — this
 * module never transitions a message out of them; LeadsService owns those
 * (drafting, human approval/rejection) directly.
 */
export const SENDING_TRANSITIONS: Partial<Record<EmailMessageStatus, EmailMessageStatus[]>> = {
  [EmailMessageStatus.QUEUED]: [EmailMessageStatus.WAITING_FOR_SCHEDULE, EmailMessageStatus.READY_TO_SEND],
  [EmailMessageStatus.WAITING_FOR_SCHEDULE]: [EmailMessageStatus.READY_TO_SEND],
  [EmailMessageStatus.READY_TO_SEND]: [EmailMessageStatus.SENDING],
  [EmailMessageStatus.RETRY_SCHEDULED]: [EmailMessageStatus.SENDING],
  // A crashed worker's abandoned claim is reclaimed by the sweep, not "sent
  // anyway" — see SendingSweepWorker.
  [EmailMessageStatus.SENDING]: [EmailMessageStatus.SENT, EmailMessageStatus.FAILED, EmailMessageStatus.RETRY_SCHEDULED],
};

/** States SendingWorker's atomic claim may pick up and advance to SENDING —
 *  the single place "what's claimable" is defined, derived from the table
 *  above rather than duplicated as a literal in the worker/sweep/queue. */
export const CLAIMABLE_FOR_SENDING = Object.entries(SENDING_TRANSITIONS)
  .filter(([, to]) => to.includes(EmailMessageStatus.SENDING))
  .map(([from]) => from as EmailMessageStatus);

export function isValidSendingTransition(from: EmailMessageStatus, to: EmailMessageStatus): boolean {
  return SENDING_TRANSITIONS[from]?.includes(to) ?? false;
}
