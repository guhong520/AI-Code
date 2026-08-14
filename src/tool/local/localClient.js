/**
 * 本地工具客户端（调用方式对齐 MCP Client）
 * - listTools() → { tools: [{ name, description, inputSchema }] }
 * - callTool({ name, arguments }) → { content: [{ type, text }], isError? }
 * - registerTool(name, { description, inputSchema }, handler)
 */

/** @type {Map<string, { name: string, description: string, inputSchema: object, handler: Function }>} */
const tools = new Map();

/**
 * 将工具执行结果规范为 MCP content 结构
 * @param {unknown} result
 * @returns {{ content: { type: string, text: string }[], isError?: boolean }}
 */
function normalizeResult(result) {
  if (result && typeof result === 'object' && Array.isArray(result.content)) {
    return result;
  }
  const text = result == null ? '' : String(result);
  return {
    content: [{ type: 'text', text }],
  };
}

export const localClient = {
  /**
   * 注册本地工具
   * @param {string} name
   * @param {{ description?: string, inputSchema?: object }} [meta]
   * @param {(args: Record<string, unknown>) => unknown | Promise<unknown>} handler
   * @returns {typeof localClient}
   */
  registerTool(name, meta = {}, handler) {
    const toolName = String(name || '').trim();
    if (!toolName) {
      throw new Error('registerTool：name 不能为空');
    }
    if (typeof handler !== 'function') {
      throw new Error(`registerTool：工具 ${toolName} 缺少 handler`);
    }

    tools.set(toolName, {
      name: toolName,
      description: meta.description || '',
      inputSchema: meta.inputSchema || {
        type: 'object',
        properties: {},
      },
      handler,
    });

    return localClient;
  },

  /**
   * 列出已注册的本地工具（形态对齐 MCP listTools）
   * @returns {Promise<{ tools: { name: string, description: string, inputSchema: object }[] }>}
   */
  async listTools() {
    return {
      tools: [...tools.values()].map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      })),
    };
  },

  /**
   * 调用本地工具（形态对齐 MCP callTool）
   * @param {{ name: string, arguments?: Record<string, unknown> }} params
   * @returns {Promise<{ content: { type: string, text: string }[], isError?: boolean }>}
   */
  async callTool(params = {}) {
    const name = String(params.name || '').trim();
    const args = params.arguments && typeof params.arguments === 'object'
      ? params.arguments
      : {};

    const tool = tools.get(name);
    if (!tool) {
      throw new Error(`未找到本地工具：${name}`);
    }

    try {
      const result = await tool.handler(args);
      return normalizeResult(result);
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: err?.message || String(err),
          },
        ],
        isError: true,
      };
    }
  },
};
