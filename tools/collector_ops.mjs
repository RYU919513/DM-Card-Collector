#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COLLECTION_STATES, PIPELINE_STATES } from './collector_state.mjs';

const root = resolve(import.meta.dirname, '..');
const readJson = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const checkpoint = readJson('.collector/checkpoint.json');
const pkg = readJson('package.json');
const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
const identity = pkg.name === 'dm-card-collector' && /^# DM Card Collector$/m.test(readme) && readme.includes('without connecting to Firebase, Firestore, or a production card database');
const repositoryEvidence = (() => {
  try { return `${git('remote', '-v')}\n${readFileSync(resolve(root, '.git/FETCH_HEAD'), 'utf8')}`.includes('github.com/RYU919513/DM-Card-Collector'); } catch { return false; }
})();
const report = {
  application: 'DM Card Collector', repository: identity ? 'RYU919513/DM-Card-Collector' : 'UNCONFIRMED', repositoryRemoteVerified: repositoryEvidence,
  branch: git('branch', '--show-current'), head: git('rev-parse', 'HEAD'), workingTree: git('status', '--short') || 'clean',
  remotes: git('remote', '-v') || 'none configured (FETCH_HEAD identity evidence retained)', runtime: process.version,
  dependencies: 'dependency-free', previousHandoff: 'not recorded', checkpoint,
  sources: ['official', 'dmwiki', 'tcg_portal', 'picodoromeda', 'generic'], schemaVersion: checkpoint.schemaVersion,
  pendingCandidates: checkpoint.staging.candidates, validation: checkpoint.validationSummary, staging: checkpoint.staging,
  knownFailures: checkpoint.knownFailures, constraints: checkpoint.constraints
};

function verify() {
  const failures = [];
  if (!identity) failures.push('application identity not confirmed');
  if (checkpoint.checkpointVersion !== 1) failures.push('unsupported checkpoint version');
  if (checkpoint.staging.published > checkpoint.staging.approved) failures.push('published exceeds approved');
  if (!checkpoint.constraints.includes('human approval required')) failures.push('human approval boundary missing');
  if (COLLECTION_STATES.length !== 6 || PIPELINE_STATES.length !== 4) failures.push('state model incomplete');
  return failures;
}

const command = process.argv[2];
if (!['start', 'check', 'end'].includes(command)) {
  console.error('Usage: collector_ops.mjs <start|check|end>'); process.exit(2);
}
const failures = verify();
console.log(JSON.stringify({ phase: command.toUpperCase(), generatedAt: new Date().toISOString(), ...report,
  counts: { completed: checkpoint.completedRanges.length, pending: checkpoint.pendingRanges.length, failed: checkpoint.failedItems.length, retry: checkpoint.retryCandidates.length },
  safety: { remoteWrites: false, productionDatabase: false, humanApprovalRequired: true },
  nextAction: checkpoint.nextRecommendedAction, result: failures.length ? 'FAIL' : 'PASS', failures }, null, 2));
if (failures.length) process.exit(1);
