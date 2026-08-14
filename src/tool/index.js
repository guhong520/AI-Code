import { getLocalTool } from './local/index.js';
import { loadMcpTools } from './mcp/index.js';

/**
 * @typedef {{ name: string, description?: string, inputSchema?: object, mcpName?: string, originalName?: string }} ToolDef
 * @typedef {{ toolList: ToolDef[], toolMap: Record<string, { callTool: Function }> }} MergedTools
 * @typedef {{ type: 'function', function: { name: string, description?: string, parameters?: object } }} OpenAiTool
 */

/** @type {Promise<MergedTools> | null} */
let loadPromise = null;

/**
 * 合并本地工具与 MCP 工具，返回统一列表与「工具名 → client」映射
 * @returns {Promise<MergedTools>}
 */
export async function loadTools() {
  if (!loadPromise) {
    loadPromise = (async () => {
      const [{ localTools, localMap }, { mcpToolList, mcpToolMap }] =
        await Promise.all([getLocalTool(), loadMcpTools()]);

      /** @type {ToolDef[]} */
      const toolList = [...(localTools || []), ...(mcpToolList || [])];

      /** @type {Record<string, { callTool: Function }> } */
      const toolMap = {
        ...(localMap || {}),
        ...(mcpToolMap || {}),
      };

      return { toolList, toolMap };
    })();
  }

  return loadPromise;
}

/**
 * 将内部 ToolDef 转为 OpenAI Chat Completions 的 tools 参数格式
 * @param {ToolDef[]} [toolList]
 * @returns {OpenAiTool[]}
 */
export function toOpenAiTools(toolList = []) {
  return (Array.isArray(toolList) ? toolList : [])
    .filter((t) => t?.name)
    .map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.inputSchema || {
          type: 'object',
          properties: {},
        },
      },
    }));
}

/**
 * 把工具执行结果转成可塞进 role=tool 的字符串
 * @param {unknown} result
 * @returns {string}
 */
export function toolResultToText(result) {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  if (typeof result === 'object' && Array.isArray(result.content)) {
    return result.content
      .map((part) => {
        if (part == null) return '';
        if (typeof part === 'string') return part;
        if (typeof part.text === 'string') return part.text;
        return JSON.stringify(part);
      })
      .filter(Boolean)
      .join('\n');
  }
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

/**
 * 解析模型返回的 function.arguments（通常是 JSON 字符串）
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
export function parseToolArguments(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return /** @type {Record<string, unknown>} */ (raw);
  }
  if (typeof raw !== 'string' || !raw.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

/**
 * 执行工具（本地或 MCP）
 * @param {string} name 工具名（MCP 工具为带前缀名，如 mcpName_toolName）
 * @param {Record<string, unknown>} [args] 工具参数
 * @returns {Promise<unknown>}
 */
export async function excuteTool(name, args = {}) {
  const toolName = String(name || '').trim();
  if (!toolName) {
    throw new Error('excuteTool：工具名不能为空');
  }

  const { toolList, toolMap } = await loadTools();
  const client = toolMap[toolName];
  if (!client || typeof client.callTool !== 'function') {
    throw new Error(`未找到工具：${toolName}`);
  }

  const meta = toolList.find((t) => t.name === toolName);
  // MCP 工具需用原始名调用；本地工具直接用注册名
  const callName = meta?.originalName || toolName;

  return client.callTool({
    name: callName,
    arguments: args && typeof args === 'object' ? args : {},
  });
}

export default {
  loadTools,
  toOpenAiTools,
  toolResultToText,
  parseToolArguments,
  excuteTool,
};
