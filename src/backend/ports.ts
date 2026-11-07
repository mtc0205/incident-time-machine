/**
 * Forge implementation of the engine's ports. This is the ONLY place where
 * Atlassian APIs and the pure core meet.
 */

import type { EnginePorts } from '../core/engine';
import * as jira from './jira';
import * as graph from './graph';
import { getDemoMode } from './store';

export const forgePorts: EnginePorts = {
  getIssue: jira.getIssue,
  searchResolvedIncidents: () => jira.searchResolvedIncidents(),
  getGraphChanges: graph.getGraphChanges,
  getLinkedKnowledge: graph.getGraphKnowledgeLinks,
  isDemoMode: getDemoMode,
};
