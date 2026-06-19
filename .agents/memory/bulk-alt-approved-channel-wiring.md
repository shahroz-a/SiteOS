---
name: Bulk alt approved-channel cross-tab wiring
description: The approved cross-tab sync channel has two independent halves; both must be wired through ReviewBody into useAltReview.
---
The bulk alt-text review (`artifacts/cms/src/components/bulk-alt-review-dialog.tsx` → `ReviewBody` → `useAltReview`) syncs across same-origin tabs via TWO independent localStorage channels in `src/lib/bulk-alt-progress.ts`: a SKIP channel (`onSkippedChange`/`initialSkipped`) and an APPROVED channel (`onApprovedChange`/`initialApproved`). They are wired separately.

**Rule:** when forwarding props into the `useAltReview({...})` call, the approved channel (`onApprovedChange` + `initialApproved`) and the skip channel must BOTH be passed. They are received as `ReviewBody` props and look wired, but the bug was the hook call omitting `onApprovedChange`/`initialApproved` — so `approve()`'s `onApprovedChange?.()` was a no-op and nothing was ever written to localStorage.

**Why:** the symptom is subtle — the approving tab's own UI shows "Saved" (local React state), so it looks fine; only OTHER tabs fail to reflect the approval (no localStorage write → no cross-tab `storage` event). Skip sync keeps working, masking the gap.

**How to apply:** only an end-to-end two-tab browser test catches this — unit tests mock the channel/`storage` event. The real `storage` event fires ONLY in other same-origin tabs, so test with two `context.newPage()` tabs sharing one Playwright BrowserContext (`artifacts/cms/e2e/media-alt-sync.spec.ts`). To verify a write actually happened, assert the acting tab's `localStorage` has the channel key, not just that its UI shows "Saved".
