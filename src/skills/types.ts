export interface SkillInput {
  /** Human-readable prompt shown to the user in REPL mode, and used as the
   *  MCP tool parameter description in MCP mode. */
  prompt: string;
  /**
   * Optional type for the input. Controls the JSON Schema type emitted for MCP
   * tool parameters. All values are stringified before template substitution.
   * Defaults to "string" when absent or unrecognized.
   */
  type?: "string" | "boolean" | "enum" | "number";
  /**
   * Valid enum values. Only used when type === "enum". If absent or empty when
   * type is "enum", the field falls back to type "string".
   */
  enum?: string[];
}

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
  /**
   * Named inputs the skill needs before running. Each key corresponds to a
   * {{key}} placeholder in promptTemplate. In REPL mode Phase2S prompts the
   * user for each. In MCP mode each becomes a typed tool parameter.
   *
   * Only {{key}} tokens declared here are substituted — unknown {{tokens}}
   * pass through unchanged.
   */
  inputs?: Record<string, SkillInput>;
}
