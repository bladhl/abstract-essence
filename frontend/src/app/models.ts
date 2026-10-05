export interface SourcePage {
  number: number;
  text: string;
}
export interface ResearchDocument {
  id: string;
  title: string;
  filename: string;
  total_pages: number;
  created_at: string;
}
export interface Citation {
  page: number;
  quote: string;
}
export type Lens = 'problem' | 'method' | 'evidence' | 'argument';
export type ArgumentRole = 'problem' | 'contribution' | 'approach' | 'evidence' | 'limits';
export type AnnotationRole = ArgumentRole | Lens;
export const roleTitles: Record<AnnotationRole, string> = {
  problem: 'Problem',
  contribution: 'Contribution',
  approach: 'Approach',
  evidence: 'Evidence',
  limits: 'Limits',
  method: 'Question & method',
  argument: 'Argument',
};
export interface SourceAnnotation {
  role: AnnotationRole;
  title: string;
  citation: Citation;
  explanation: string;
  caveat: string;
  question: string;
}
export interface AnnotationView extends SourceAnnotation {
  id: string;
}
export interface ReadingMap {
  version: 'annotated-reading-v1';
  overview: string;
  annotations: SourceAnnotation[];
  gaps: { role: ArgumentRole; reason: string }[];
}
export const lensTitles: Record<Lens, string> = {
  problem: 'Problem & significance',
  method: 'Question & method',
  evidence: 'Evidence & conclusions',
  argument: 'Argument structure',
};
export interface Insight {
  lens: Lens;
  author_excerpt: Citation | null;
  interpretation: string;
  limitation: string;
}
export interface Analysis {
  id: string;
  document_id: string;
  provider: string;
  model: string;
  page_start: number;
  page_end: number;
  attempt: string;
  output: {
    insights: Insight[];
    learning_feedback: string;
    next_question: string;
    reading_map?: ReadingMap;
    request_settings?: RequestSettings;
  };
  created_at: string;
}
export interface SourceNote {
  id: string;
  document_id: string;
  kind: string;
  page: number;
  quote: string;
  text: string;
}
export interface DocumentDetail {
  document: ResearchDocument;
  pages: SourcePage[];
  analyses: Analysis[];
  notes: SourceNote[];
}
export interface ProviderChoice {
  provider: string;
  model: string;
  thinking_levels?: Thinking[];
}
export type Thinking = 'default' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export interface RequestSettings {
  thinking: Thinking;
}
export const thinkingTitles: Record<Thinking, string> = {
  default: 'Provider default',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
};
export interface Feedback {
  id: string;
  question: string;
  provider: string;
  model: string;
  output: {
    answer: string;
    citations: Citation[];
    limitation: string;
    request_context?: { role?: AnnotationRole | null; citation: Citation };
    request_settings?: RequestSettings;
  };
}
export interface Connection {
  id: string;
  source_id: string;
  target_id: string;
  relationship: string;
  evidence: string;
}
