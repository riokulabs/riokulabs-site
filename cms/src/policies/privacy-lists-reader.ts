/**
 * Who may read GET /api/privacy-lists: an API token that is not a visibility-guard bypass token (the preview token
 * runs on the preview Worker and never needs the lists). The token still needs the Privacy-lists find permission,
 * and the Public and Authenticated roles have no permissions at all (src/index.ts), so no other caller gets here.
 */
import { shouldBypass, TOKEN_STRATEGIES } from '../middlewares/visibility-guard';

export function isPrivacyListsReader(auth: any): boolean {
  return TOKEN_STRATEGIES.includes(auth?.strategy?.name) && !shouldBypass(auth);
}

export default (policyContext: any) => isPrivacyListsReader(policyContext?.state?.auth);
