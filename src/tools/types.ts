import { z } from "zod";

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodType;
  execute(params: unknown): Promise<ToolResult>;
}

/** OpenAI-compatible function definition for tool calling */
export interface OpenAIFunctionDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Convert a zod schema to a JSON Schema-like object for OpenAI */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodType>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodFieldToJson(value);
      if (!(value instanceof z.ZodOptional)) {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }
  return { type: "object" };
}

function zodFieldToJson(field: z.ZodType): Record<string, unknown> {
  if (field instanceof z.ZodString) {
    return { type: "string", description: field.description };
  }
  if (field instanceof z.ZodNumber) {
    return { type: "number", description: field.description };
  }
  if (field instanceof z.ZodBoolean) {
    return { type: "boolean", description: field.description };
  }
  if (field instanceof z.ZodOptional) {
    return zodFieldToJson(field.unwrap());
  }
  if (field instanceof z.ZodArray) {
    return {
      type: "array",
      items: zodFieldToJson(field.element),
      description: field.description,
    };
  }
  return { type: "string" };
}

export function toolToOpenAI(tool: ToolDefinition): OpenAIFunctionDef {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.parameters),
    },
  };
}
