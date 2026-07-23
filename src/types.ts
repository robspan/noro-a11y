import type { Page } from 'playwright';

export const ENGINE_IDS = ['http', 'html-validate', 'axe', 'ibm'] as const;

export type EngineId = (typeof ENGINE_IDS)[number];
export type EngineSelection = 'all' | EngineId | readonly EngineId[];
export type CheckStatus = 'completed' | 'not_run' | 'failed';
export type FindingSeverity = 'info' | 'warning' | 'critical';
export type TranslationStatus = 'verified' | 'engine-locale' | 'fallback';
export type AutomatedCriterionOutcome = 'passed' | 'failed' | 'needs-review';

export interface FindingSource {
  engine: EngineId;
  ruleId: string;
  code: string;
  occurrenceCount: number;
}

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
  /** Tatsächliche Zahl betroffener Elemente für dieses Finding. */
  occurrenceCount: number;
  /** Alle Engine-Regeln, die nach der Deduplizierung zu diesem Befund beitragen. */
  sources: FindingSource[];
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

export interface AccessibilityCrawlOptions extends AccessibilityRunOptions {
  /** Anzahl der Link-Ebenen ab der Startseite. 0 prüft nur die Startseite. */
  depth?: number;
  /** Harte Obergrenze für geladene Ziele, unabhängig von der Link-Tiefe. */
  maxPages?: number;
  /** Lädt ein Ziel und stellt es den bestehenden Prüf-Engines bereit. */
  loadPage: (url: string, depth: number) => Promise<AccessibilityRunInput>;
  /** Liefert echte Crawl- und Befundereignisse, z. B. für SSE oder Live-UIs. */
  onProgress?: (event: AccessibilityCrawlProgressEvent) => void | Promise<void>;
}

export type AccessibilityCrawlProgressPhase =
  | 'loading'
  | 'loaded'
  | 'checking'
  | 'finding'
  | 'completed'
  | 'skipped'
  | 'failed'
  | 'crawl-completed';

export interface AccessibilityCrawlProgressEvent {
  phase: AccessibilityCrawlProgressPhase;
  url: string;
  depth: number;
  pageNumber: number;
  maxPages: number;
  message: string;
  finding?: NormalizedFinding;
  findingCount?: number;
}

export interface AccessibilityRunResult {
  url: string;
  locale: 'de';
  requestedEngines: EngineId[];
  startedAt: string;
  completedAt: string;
  results: EngineResult[];
  deduplication: {
    rawFindings: number;
    findings: number;
    collapsed: number;
  };
  findings: NormalizedFinding[];
}

export type AccessibilityCrawlPageStatus = 'completed' | 'skipped' | 'failed';

export interface AccessibilityCrawlPageResult {
  requestedUrl: string;
  url: string;
  depth: number;
  status: AccessibilityCrawlPageStatus;
  result?: AccessibilityRunResult;
  error?: string;
}

export interface AccessibilityCrawlFinding extends NormalizedFinding {
  url: string;
  depth: number;
}

export interface AccessibilityCrawlResult {
  url: string;
  locale: 'de';
  requestedEngines: EngineId[];
  depth: number;
  maxPages: number;
  startedAt: string;
  completedAt: string;
  truncated: boolean;
  pages: AccessibilityCrawlPageResult[];
  findings: AccessibilityCrawlFinding[];
}

export type ReportFormat = 'json' | 'sarif' | 'markdown' | 'html' | 'agent' | 'pdf';

export interface ReportOptions {
  title?: string;
  preparedFor?: string;
  includeOriginalMessages?: boolean;
}

export type AutomatedRiskBand = 'none' | 'low' | 'elevated' | 'high' | 'very-high';

export interface AutomatedRiskSummary {
  /** Verdichtet ausschließlich automatisch erzeugte Befunde; kein Konformitätswert. */
  index: number;
  band: AutomatedRiskBand;
  label: string;
  statement: string;
  counts: Record<FindingSeverity, number>;
  engines: {
    requested: number;
    completed: number;
    failed: number;
    notRun: number;
  };
}

export interface AgentTask {
  id: string;
  priority: 'P0' | 'P1' | 'P2';
  ruleId: string;
  engine: EngineId;
  sources: FindingSource[];
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
