import dotenv from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: join(rootDir, '.env'), quiet: true });

const DEFAULT_BASE_URL =
  '';

function getApiKey() {
  return process.env.OPENAI_API_KEY?.trim() || '';
}

function getBaseURL() {
  return process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL;
}

function getModel() {
  return process.env.OPENAI_MODEL || 'qwen3.7-plus';
}

function getEmbeddingModel() {
  return process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-v3';
}

/** @type {OpenAI | null} */
let client = null;

/** 是否已配置可用的 API Key */
export function hasApiKey() {
  return Boolean(getApiKey());
}

/** 获取（或懒创建）OpenAI 客户端 */
function getClient() {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('未配置 OPENAI_API_KEY，请在 .env 中设置后重试');
  }
  if (!client) {
    client = new OpenAI({ apiKey, baseURL: getBaseURL() });
  }
  return client;
}

/**
 * 调用大模型进行多轮对话补全
 * 支持传入 OpenAI function tools；返回完整 assistant message（可能含 tool_calls）
 * @param {{ role: string, content?: string | Array<{ type: string, text?: string, image_url?: { url: string } }> | null, tool_calls?: unknown[], tool_call_id?: string, name?: string }[]} messages
 * @param {{ tools?: { type: 'function', function: { name: string, description?: string, parameters?: object } }[] }} [options]
 * @returns {Promise<{ role: string, content: string | null, tool_calls?: any[] }>}
 */
export async function chatCompletion(messages, options = {}) {
  /** @type {Record<string, unknown>} */
  const body = {
    model: getModel(),
    messages,
  };

  if (Array.isArray(options.tools) && options.tools.length > 0) {
    body.tools = options.tools;
  }

  const completion = await getClient().chat.completions.create(body);
  const message = completion.choices[0]?.message;
  if (!message) {
    throw new Error('大模型未返回有效内容');
  }
  return message;
}

/**
 * 批量生成文本向量
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
export async function createEmbeddings(texts) {
  const input = (Array.isArray(texts) ? texts : []).map((t) => String(t ?? ''));
  if (input.length === 0) return [];

  const response = await getClient().embeddings.create({
    model: getEmbeddingModel(),
    input,
  });

  const sorted = [...(response.data || [])].sort((a, b) => a.index - b.index);
  if (sorted.length !== input.length) {
    throw new Error(`向量数量与文本数量不一致：期望 ${input.length}，实际 ${sorted.length}`);
  }
  return sorted.map((item) => item.embedding);
}

export { getModel, getEmbeddingModel };
