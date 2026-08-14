import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { getProjectRoot } from '../../utils/projectFiles.js';
import { getUserHomeDir } from '../../utils/pathUtils.js';

/**
 * 推断 MCP 连接类型
 * @param {Record<string, unknown>} conf
 * @returns {'stdio' | 'sse' | 'http'}
 */
function resolveMcpType(conf = {}) {
  const raw = String(conf.type || conf.transport || '').toLowerCase();
  if (raw === 'stdio' || raw === 'sse' || raw === 'http' || raw === 'streamablehttp') {
    return raw === 'streamablehttp' ? 'http' : raw;
  }
  if (conf.command) return 'stdio';
  if (conf.url) return 'http';
  throw new Error('无法识别 MCP 类型：请配置 type，或提供 command / url');
}

/**
 * 读取用户目录与项目目录下的 MCP 配置并合并
 * - ~/.front/mcp.json
 * - <projectRoot>/.front/mcp.json（同名覆盖用户配置）
 * @returns {Promise<Record<string, Record<string, unknown>>>}
 */
async function loadMcpServerConfig() {
  const paths = [
    join(getUserHomeDir(), '.front', 'mcp.json'),
    join(await getProjectRoot(), '.front', 'mcp.json'),
  ];

  /** @type {Record<string, Record<string, unknown>>} */
  const servers = {};

  for (const filePath of paths) {
    try {
      const raw = await readFile(filePath, 'utf8');
      const json = JSON.parse(raw);
      const block =
        json?.mcpServers && typeof json.mcpServers === 'object'
          ? json.mcpServers
          : json;
      if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
      Object.assign(servers, block);
    } catch {
      // 配置不存在或解析失败则跳过
    }
  }

  return servers;
}

/**
 * 按类型创建并连接第三方 MCP Client
 * @param {string} mcpName
 * @param {Record<string, unknown>} conf
 * @returns {Promise<import('@modelcontextprotocol/sdk/client/index.js').Client>}
 */
async function connectMcpClient(mcpName, conf) {
  const type = resolveMcpType(conf);
  const client = new Client(
    { name: `frontcode-${mcpName}`, version: '1.0.0' },
    { capabilities: {} },
  );

  let transport;
  if (type === 'stdio') {
    const command = String(conf.command || '').trim();
    if (!command) {
      throw new Error(`MCP ${mcpName}（stdio）缺少 command`);
    }
    transport = new StdioClientTransport({
      command,
      args: Array.isArray(conf.args) ? conf.args.map(String) : [],
      env: {
        ...process.env,
        ...(conf.env && typeof conf.env === 'object' ? conf.env : {}),
      },
      cwd: conf.cwd ? String(conf.cwd) : undefined,
      stderr: 'pipe',
    });
  } else if (type === 'sse') {
    const url = String(conf.url || '').trim();
    if (!url) {
      throw new Error(`MCP ${mcpName}（sse）缺少 url`);
    }
    const headers =
      conf.headers && typeof conf.headers === 'object' ? conf.headers : undefined;
    transport = new SSEClientTransport(
      new URL(url),
      headers ? { requestInit: { headers } } : undefined,
    );
  } else {
    // http / streamableHttp
    const url = String(conf.url || '').trim();
    if (!url) {
      throw new Error(`MCP ${mcpName}（http）缺少 url`);
    }
    const headers =
      conf.headers && typeof conf.headers === 'object' ? conf.headers : undefined;
    transport = new StreamableHTTPClientTransport(
      new URL(url),
      headers ? { requestInit: { headers } } : undefined,
    );
  }

  await client.connect(transport);
  return client;
}

/**
 * 为工具名拼接 MCP 名称前缀，避免多 MCP 工具重名
 * @param {string} mcpName
 * @param {string} toolName
 * @returns {string}
 */
export function prefixMcpToolName(mcpName, toolName) {
  return `${mcpName}_${toolName}`;
}

/**
 * 从带前缀的工具名还原原始工具名
 * @param {string} mcpName
 * @param {string} prefixedName
 * @returns {string}
 */
export function stripMcpToolPrefix(mcpName, prefixedName) {
  const prefix = `${mcpName}_`;
  return String(prefixedName).startsWith(prefix)
    ? String(prefixedName).slice(prefix.length)
    : String(prefixedName);
}

/**
 * 读取第三方 MCP 配置，按类型连接，聚合全部工具
 * @returns {Promise<{
 *   mcpToolList: { name: string, description?: string, inputSchema?: object, mcpName: string, originalName: string }[],
 *   mcpToolMap: Record<string, import('@modelcontextprotocol/sdk/client/index.js').Client>,
 *   mcpClients: Record<string, import('@modelcontextprotocol/sdk/client/index.js').Client>,
 * }>}
 */
export async function loadMcpTools() {
  const serverConfig = await loadMcpServerConfig();

  /** @type {{ name: string, description?: string, inputSchema?: object, mcpName: string, originalName: string }[]} */
  const mcpToolList = [];
  /** @type {Record<string, import('@modelcontextprotocol/sdk/client/index.js').Client>} */
  const mcpToolMap = {};
  /** @type {Record<string, import('@modelcontextprotocol/sdk/client/index.js').Client>} */
  const mcpClients = {};

  for (const [mcpName, conf] of Object.entries(serverConfig)) {
    if (!conf || typeof conf !== 'object' || Array.isArray(conf)) continue;
    if (conf.disabled === true || conf.enabled === false) continue;

    let client;
    try {
      client = await connectMcpClient(mcpName, conf);
    } catch (err) {
      console.error(`[mcp] 连接失败 ${mcpName}:`, err?.message || err);
      continue;
    }

    mcpClients[mcpName] = client;

    let tools = [];
    try {
      const listed = await client.listTools();
      tools = Array.isArray(listed?.tools) ? listed.tools : [];
    } catch (err) {
      console.error(`[mcp] listTools 失败 ${mcpName}:`, err?.message || err);
      continue;
    }

    for (const tool of tools) {
      if (!tool?.name) continue;
      const fullName = prefixMcpToolName(mcpName, tool.name);
      mcpToolList.push({
        name: fullName,
        description: tool.description || '',
        inputSchema: tool.inputSchema || {
          type: 'object',
          properties: {},
        },
        mcpName,
        originalName: tool.name,
      });
      // 工具名 → 对应已连接的 mcpClient
      mcpToolMap[fullName] = client;
    }
  }

  return { mcpToolList, mcpToolMap, mcpClients };
}

/**
 * 通过聚合后的工具名调用对应 MCP 工具
 * @param {string} toolName 带 MCP 前缀的工具名
 * @param {Record<string, unknown>} [args]
 * @param {{
 *   mcpToolMap?: Record<string, import('@modelcontextprotocol/sdk/client/index.js').Client>,
 *   mcpToolList?: { name: string, mcpName?: string, originalName?: string }[],
 * }} [ctx]
 */
export async function callMcpTool(toolName, args = {}, ctx = {}) {
  const map = ctx.mcpToolMap || {};
  const list = ctx.mcpToolList || [];
  const client = map[toolName];
  if (!client) {
    throw new Error(`未找到 MCP 工具对应的 client：${toolName}`);
  }

  const meta = list.find((t) => t.name === toolName);
  const originalName = meta?.originalName
    || (meta?.mcpName ? stripMcpToolPrefix(meta.mcpName, toolName) : toolName);

  return client.callTool({
    name: originalName,
    arguments: args && typeof args === 'object' ? args : {},
  });
}
