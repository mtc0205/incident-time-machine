/**
 * UI resolvers — invoked from the panel via `invoke()` from @forge/bridge.
 */

import Resolver from '@forge/resolver';
import { getDemoMode, getDigest, postDigest, setDemoMode } from './service';

const resolver = new Resolver();

resolver.define('getPanelData', async ({ payload }) => {
  const issueKey = typeof payload?.issueKey === 'string' ? payload.issueKey : '';
  if (!issueKey) throw new Error('issueKey is required');
  const [digest, demoMode] = await Promise.all([getDigest(issueKey), getDemoMode()]);
  return { digest, demoMode };
});

resolver.define('postDigest', async ({ payload }) => {
  const issueKey = typeof payload?.issueKey === 'string' ? payload.issueKey : '';
  if (!issueKey) throw new Error('issueKey is required');
  const result = await postDigest(issueKey, { force: true });
  return { posted: result.posted, reason: result.reason ?? null };
});

resolver.define('setDemoMode', async ({ payload }) => {
  const enabled = payload?.enabled === true;
  await setDemoMode(enabled);
  return { demoMode: enabled };
});

resolver.define('getDemoMode', async () => {
  return { demoMode: await getDemoMode() };
});

export const handler = resolver.getDefinitions();
