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
 * @param {{ role: string, content: string }[]} messages
 * @returns {Promise<string>}
 */
export async function chatCompletion(messages) {
  const completion = await getClient().chat.completions.create({
    model: getModel(),
    messages,
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) {
    throw new Error('大模型未返回有效内容');
  }
  return text;
}

export { getModel };
