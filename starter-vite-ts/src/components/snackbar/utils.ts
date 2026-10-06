import type { ProblemDetails } from 'src/api/httpClient';

import { toast } from 'sonner';

import { agentMode } from 'src/utils/agent-mode';
import { isConnectionProblem } from 'src/utils/connection-problem';

// ----------------------------------------------------------------------

export function showErrorToast(error: unknown, fallbackMessage: string = 'An unexpected error occurred.') {
  if (!error) {
    toast.error(fallbackMessage);
    return;
  }

  // Handle ProblemDetails object (from httpClient)
  if (typeof error === 'object' && error !== null) {
    const prob = error as Partial<ProblemDetails>;

    // On a branch agent a request the cloud did not answer is the Reconnecting bar's to tell
    // (cloud-status-bar.tsx), and a screen that sent it shows the problem's `detail` itself.
    if (agentMode && isConnectionProblem(prob.code)) return;

    if (prob.fieldErrors && Array.isArray(prob.fieldErrors) && prob.fieldErrors.length > 0) {
      const fieldMsg = prob.fieldErrors
        .map((fe) => fe.message || `${fe.field}: ${fe.code}`)
        .join(', ');
      toast.error(prob.detail || prob.title || 'Validation Error', {
        description: fieldMsg,
      });
      return;
    }

    if (prob.detail || prob.title) {
      toast.error(prob.detail || prob.title || fallbackMessage, {
        description: prob.detail && prob.title && prob.detail !== prob.title ? prob.title : undefined,
      });
      return;
    }
  }

  // Handle standard Error
  if (error instanceof Error) {
    toast.error(error.message || fallbackMessage);
    return;
  }

  // Handle string
  if (typeof error === 'string') {
    toast.error(error);
    return;
  }

  toast.error(fallbackMessage);
}
