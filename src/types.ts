import type { Page } from 'playwright';

export const ENGINE_IDS = ['http', 'html-validate', 'axe'] as const;

export type EngineId = (typeof ENGINE_IDS)[number];
export type EngineSelection = 'all' | EngineId | readonly EngineId[];
export type CheckStatus = 'completed' | 'not_run' | 'failed';
export type FindingSeverity = 'info' | 'warning' | 'critical';
export type TranslationStatus = 'verified' | 'engine-locale' | 'fallback';
export type AutomatedCriterionOutcome = 'passed' | 'failed' | 'needs-review';

export interface NormalizedFinding {
  code: string;
  engine: EngineId;
  ruleId: string;
  severity: FindingSeverity;
  message: string;
  translationStatus: TranslationStatus;
  originalMessage?: string;
  wcagCriteria?: string[];
  helpUrl?: string;
  selectors?: string[];
  location?: { line?: number; column?: number };
}

export interface AutomatedCriterionResult {
  criterion: string;
  outcome: AutomatedCriterionOutcome;
  source: string;
}

export interface EngineResult {
  engine: EngineId;
  status: CheckStatus;
  summary: string;
  findings: NormalizedFinding[];
  criterionResults?: AutomatedCriterionResult[];
  metadata?: Record<string, string | number | boolean | null>;
  limitations?: string[];
}

export interface AccessibilityRunInput {
  url: string;
  html: string;
  page?: Page;
  http?: {
    status: number;
    headers: Record<string, string>;
  };
}

export interface AccessibilityRunOptions {
  engines?: EngineSelection;
}

export interface AccessibilityRunResult {
  url: string;
  locale: 'de';
  requestedEngines: EngineId[];
  startedAt: string;
  completedAt: string;
  results: EngineResult[];
  findings: NormalizedFinding[];
}

export type ReportFormat = 'json' | 'sarif' | 'markdown' | 'html' | 'agent' | 'pdf';

export interface ReportOptions {
  title?: string;
  preparedFor?: string;
  includeOriginalMessages?: boolean;
}

export interface AgentTask {
  id: string;
  priority: 'P0' | 'P1' | 'P2';
  ruleId: string;
  engine: EngineId;
  problem: string;
  selectors: string[];
  wcagCriteria: string[];
  acceptanceCriteria: string[];
  helpUrl?: string;
}

export interface AgentReport {
  schemaVersion: '1.0';
  language: 'de';
  objective: string;
  source: { url: string; checkedAt: string; engines: EngineId[] };
  constraints: string[];
  tasks: AgentTask[];
}
