import { z } from 'zod';

/** A guard schema fragment for destructive operations.
 *  Forces the LLM to set `confirm: true` AND acknowledge data loss, which
 *  makes the call surface visibly in the model's reasoning instead of being
 *  fired silently. Combined with backend `servers:destroy` scope enforcement
 *  this is three layers of defense for the worst case (terminating a VM). */
export const destructiveConfirm = {
  confirm: z
    .literal(true)
    .describe(
      'Must be exactly `true`. Confirms the user has been shown what is about to happen and explicitly approved it.',
    ),
  iAcknowledgeDataLoss: z
    .literal(true)
    .describe('Must be exactly `true`. The operation will permanently destroy data on the disk.'),
};

/** Tag for medium-risk operations (stop a VM, reboot, reset root password).
 *  Cheaper guard — single confirm flag, no data-loss acknowledgement. */
export const mediumConfirm = {
  confirm: z
    .literal(true)
    .describe(
      'Must be exactly `true`. This operation interrupts the running workload — confirm with the user first.',
    ),
};
