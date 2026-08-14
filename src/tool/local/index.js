import { localClient } from './localClient.js';
import { toolList, toolMap } from './skill.js';

/**
 * 将 OpenAI function tool 定义注册到 localClient
 * @param {{ type?: string, function?: { name: string, description?: string, parameters?: object } }} item
 * @param {(args: Record<string, unknown>) => unknown} handler
 */
function registerFromOpenAiTool(item, handler) {
  const def = item?.function;
  if (!def?.name || typeof handler !== 'function') {
    return;
  }

  localClient.registerTool(
    def.name,
    {
      description: def.description,
      inputSchema: def.parameters,
    },
    handler,
  );
}

for (const item of toolList) {
  const name = item?.function?.name;
  registerFromOpenAiTool(item, toolMap[name]);
}

/**
 * 获取本地工具列表，以及工具名到 localClient 的映射
 * @returns {Promise<{
 *   localTools: { name: string, description: string, inputSchema: object }[],
 *   localMap: Record<string, typeof localClient>,
 * }>}
 */
export async function getLocalTool() {
  const { tools } = await localClient.listTools();
  const localTools = Array.isArray(tools) ? tools : [];

  /** @type {Record<string, typeof localClient>} */
  const localMap = {};
  for (const tool of localTools) {
    if (!tool?.name) continue;
    localMap[tool.name] = localClient;
  }

  return { localTools, localMap };
}

export { localClient };
export default localClient;
