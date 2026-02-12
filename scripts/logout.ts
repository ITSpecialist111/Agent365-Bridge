import { clearAuthRecord, getAuthRecordPath } from "../src/auth/auth-record-cache";

/**
 * Clears cached Agent 365 Bridge credentials.
 *
 * Usage: npm run logout
 */

console.log("Agent 365 Bridge — Sign Out\n");
clearAuthRecord();
console.log(`\n✅ Cached credentials removed from: ${getAuthRecordPath()}`);
console.log("   You will need to run 'npm run login' again to sign in.");
