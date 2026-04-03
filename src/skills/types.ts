export interface Skill {
  name: string;
  description: string;
  triggerPhrases: string[];
  /** The prompt template that gets injected when the skill is invoked */
  promptTemplate: string;
  /** Original file path the skill was loaded from */
  sourcePath?: string;
}
