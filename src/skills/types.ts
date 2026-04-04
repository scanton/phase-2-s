export interface Skill {
  name: string;
  description: string;
  triggerPhrases: string[];
  /** The prompt template that gets injected when the skill is invoked */
  promptTemplate: string;
  /** Original file path the skill was loaded from */
  sourcePath?: string;
  /** Model alias ("fast" | "smart") or literal model string to use for this skill */
  model?: string;
  /** Number of satori retries (enables satori mode when > 0) */
  retries?: number;
}
