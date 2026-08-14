import { localClient } from './localClient.js';
import { toolList as skillToolList, toolMap as skillToolMap } from './skill.js';
import { toolList as bashToolList, toolMap as bashToolMap } from './bash.js';
import { toolList as readFileToolList, toolMap as readFileToolMap } from './read_file.js';
import { toolList as writeFileToolList, toolMap as writeFileToolMap } from './write_file.js';
import { toolList as confirmToolList, toolMap as confirmToolMap } from './confirm.js';
import { toolList as selectToolList, toolMap as selectToolMap } from './select.js';
import { toolList as globToolList, toolMap as globToolMap } from './glob.js';
import { toolList as grepToolList, toolMap as grepToolMap } from './grep.js';

const toolList = [
  ...skillToolList,
  ...bashToolList,
  ...readFileToolList,
  ...writeFileToolList,
  ...confirmToolList,
  ...selectToolList,
  ...globToolList,
  ...grepToolList,
];
const toolMap = {
  ...skillToolMap,
  ...bashToolMap,
  ...readFileToolMap,
  ...writeFileToolMap,
  ...confirmToolMap,
  ...selectToolMap,
  ...globToolMap,
  ...grepToolMap,
};

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
