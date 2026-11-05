import { ChatGroq } from "@langchain/groq";
import { env } from "../../config/env";

let model: ChatGroq | null = null;

export const MODEL_NAME: string = env.GROQ_MODEL;

export function getChatModel(): ChatGroq {
  model ??= new ChatGroq({
    apiKey: env.GROQ_API_KEY,
    model: env.GROQ_MODEL,
    temperature: 0.2,
    maxTokens: 8192,
  });
  return model;
}