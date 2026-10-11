// Whether the screen is currently hidden, readable from outside React.
//
// The blur protects what is on the screen. It does nothing about the "Download CSV"
// button sitting next to it, which hands over the whole list - every customer, every
// phone, every balance - in one click. A lock that stops someone photographing a screen
// but not downloading the same data as a spreadsheet is not a lock.
//
// Every download in the app goes through lib/download.ts, and the bulk prints through
// lib/printTemplates.ts. Neither is a React component, so neither can read the privacy
// context. Hence this one tiny module: PrivacyProvider writes the flag, those two read
// it at the moment of the click.
//
// Read at click time, never during render, so there is no stale-value hazard: a memoised
// component cannot capture it and show yesterday's answer.

let locked = false

/** Set by PrivacyProvider. Nothing else should call this. */
export function setPrivacyLockedFlag(v: boolean): void { locked = v }

/** True while the numbers are hidden. */
export function isPrivacyLocked(): boolean { return locked }
