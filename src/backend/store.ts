/**
 * Persistence — @forge/kvs (the current Forge key-value store).
 * Keys are namespaced; every accessor degrades to a default on failure.
 */

import { kvs } from '@forge/kvs';

const KEY_DEMO_MODE = 'itm:demo-mode';
const KEY_POSTED_PREFIX = 'itm:posted:';

export async function getDemoMode(): Promise<boolean> {
  try {
    return (await kvs.get<boolean>(KEY_DEMO_MODE)) === true;
  } catch {
    return false;
  }
}

export async function setDemoMode(enabled: boolean): Promise<void> {
  await kvs.set(KEY_DEMO_MODE, enabled);
}

/** Dedupe guard so a trigger + a button race never double-posts a digest. */
export async function wasDigestPosted(issueKey: string): Promise<boolean> {
  try {
    return (await kvs.get<boolean>(KEY_POSTED_PREFIX + issueKey)) === true;
  } catch {
    return false;
  }
}

export async function markDigestPosted(issueKey: string): Promise<void> {
  await kvs.set(KEY_POSTED_PREFIX + issueKey, true);
}
