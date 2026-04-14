/**
 * LLM Provider — LangChain ChatModel abstraction
 *
 * Supports: OpenAI, Anthropic, Google Gemini, Ollama
 * Uses @langchain/* packages for unified interface across all providers.
 */

import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import type { LLMConfig } from '../types.js';
import { decryptIfNeeded, log } from '../utils.js';

// ─── Public Types ───

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage?: { input: number; output: number };
}

// ─── Model Cache ───
// Reuse model instances for same provider+model+key combo
const _modelCache = new Map<string, BaseChatModel>();

function getCacheKey(config: LLMConfig, apiKey: string): string {
  return `${config.provider}:${config.model ?? 'default'}:${apiKey.slice(-8)}:${config.baseUrl ?? ''}`;
}

// ─── Create LangChain ChatModel ───

async function createChatModel(config: LLMConfig, apiKey: string): Promise<BaseChatModel> {
  const cacheKey = getCacheKey(config, apiKey);
  const cached = _modelCache.get(cacheKey);
  if (cached) return cached;

  let model: BaseChatModel;

  switch (config.provider) {
    case 'openai': {
      const { ChatOpenAI } = await import('@langchain/openai');
      model = new ChatOpenAI({
        openAIApiKey: apiKey,
        modelName: config.model ?? 'gpt-4o',
        temperature: 0.3,
        maxTokens: 8192,
        configuration: config.baseUrl ? { baseURL: config.baseUrl } : undefined,
      });
      break;
    }

    case 'anthropic': {
      const { ChatAnthropic } = await import('@langchain/anthropic');
      model = new ChatAnthropic({
        anthropicApiKey: apiKey,
        modelName: config.model ?? 'claude-sonnet-4-20250514',
        temperature: 0.3,
        maxTokens: 8192,
      });
      break;
    }

    case 'gemini': {
      const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai');
      model = new ChatGoogleGenerativeAI({
        apiKey,
        model: config.model ?? 'gemini-2.5-flash',
        temperature: 0.3,
        maxOutputTokens: 8192,
      });
      break;
    }

    case 'ollama': {
      // Ollama uses OpenAI-compatible API
      const { ChatOpenAI } = await import('@langchain/openai');
      const baseUrl = config.baseUrl ?? 'http://localhost:11434';
      model = new ChatOpenAI({
        openAIApiKey: 'ollama', // Ollama doesn't require a key
        modelName: config.model ?? 'llama3',
        temperature: 0.3,
        configuration: { baseURL: `${baseUrl}/v1` },
      });
      break;
    }

    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }

  _modelCache.set(cacheKey, model);
  return model;
}

// ─── Convert messages to LangChain format ───

function toLangChainMessages(messages: LLMMessage[]) {
  return messages.map((m) => {
    switch (m.role) {
      case 'system':
        return new SystemMessage(m.content);
      case 'user':
        return new HumanMessage(m.content);
      case 'assistant':
        return new AIMessage(m.content);
    }
  });
}

// ─── Public API ───

/**
 * Call LLM with messages. Unified across OpenAI, Anthropic, Gemini, Ollama.
 */
export async function callLLM(
  config: LLMConfig,
  messages: LLMMessage[]
): Promise<LLMResponse> {
  const apiKey = decryptIfNeeded(config.apiKey);
  const model = await createChatModel(config, apiKey);
  const lcMessages = toLangChainMessages(messages);

  log.debug(`[LLM] ${config.provider}/${config.model ?? 'default'}, ${messages.length} messages`);

  const result = await model.invoke(lcMessages);

  const content = typeof result.content === 'string'
    ? result.content
    : JSON.stringify(result.content);

  return {
    content,
    model: config.model ?? config.provider,
    usage: result.usage_metadata
      ? {
          input: result.usage_metadata.input_tokens,
          output: result.usage_metadata.output_tokens,
        }
      : undefined,
  };
}

/**
 * Call LLM and parse JSON response.
 * Extracts JSON from markdown code blocks if present.
 */
export async function callLLMJson<T>(
  config: LLMConfig,
  messages: LLMMessage[]
): Promise<T> {
  const response = await callLLM(config, messages);
  const text = response.content.trim();

  // Extract JSON from markdown code blocks if present
  const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : text;

  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    throw new Error(`Failed to parse LLM response as JSON:\n${text.slice(0, 500)}`);
  }
}
