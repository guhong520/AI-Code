import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { getProjectRoot } from './projectFiles.js';

/** 打开页面默认超时 */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** 页面 load 后再等一会儿，给 SPA 渲染时间 */
export const DEFAULT_WAIT_MS = 1_000;

/** 默认视口，贴近常见设计稿宽度 */
export const DEFAULT_VIEWPORT = { width: 1440, height: 900 };

/** 视为控制台报错的 console 类型 */
const ERROR_CONSOLE_TYPES = new Set(['error', 'assert']);

/** 这些资源加载失败算页面错误 */
const CRITICAL_RESOURCE_TYPES = new Set(['document', 'script', 'stylesheet']);

/**
 * @typedef {{ type: string, text: string, source?: string, line?: number }} ConsoleEntry
 * @typedef {{
 *   url: string,
 *   hasError: boolean,
 *   errors: ConsoleEntry[],
 *   consoleEntries: ConsoleEntry[],
 *   screenshotPath: string | null,
 *   httpStatus: number | null,
 * }} DebugPageResult
 */

/**
 * 校验并规范化预览 URL，仅允许 http/https
 * @param {unknown} value
 * @returns {string}
 */
export function normalizePreviewUrl(value) {
  const url = String(value ?? '').trim();
  if (!url) {
    throw new Error('url 不能为空');
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`url 不是合法地址：${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`url 仅支持 http/https，收到：${parsed.protocol}`);
  }
  return parsed.href;
}

/**
 * 在常见安装位置查找本机 Chrome / Chromium / Edge
 * @returns {string | undefined}
 */
export function findSystemChrome() {
  const env = process.env;
  /** @type {string[]} */
  let candidates = [];

  if (process.platform === 'win32') {
    candidates = [
      env.PROGRAMFILES && join(env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
      env['PROGRAMFILES(X86)'] &&
        join(env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
      env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
      env.PROGRAMFILES && join(env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'),
      env['PROGRAMFILES(X86)'] &&
        join(env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
      env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Microsoft/Edge/Application/msedge.exe'),
    ].filter(Boolean);
  } else if (process.platform === 'darwin') {
    candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
  } else {
    candidates = [
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
      '/snap/bin/chromium',
    ];
  }

  return candidates.find((p) => existsSync(p));
}

/**
 * 动态加载 puppeteer，避免未安装时拖垮全部本地工具
 * @returns {Promise<import('puppeteer').default>}
 */
async function loadPuppeteer() {
  try {
    const mod = await import('puppeteer');
    return mod.default || mod;
  } catch {
    throw new Error(
      '未安装 puppeteer，无法启动 Chromium。请在项目根目录执行：npm install puppeteer',
    );
  }
}

/**
 * 启动无头 Chromium；优先用 puppeteer 自带浏览器，失败则回退本机 Chrome/Edge
 * @returns {Promise<import('puppeteer').Browser>}
 */
export async function launchChromium() {
  const puppeteer = await loadPuppeteer();
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--font-render-hinting=none',
  ];

  try {
    return await puppeteer.launch({
      headless: true,
      args,
    });
  } catch (firstErr) {
    const executablePath = findSystemChrome();
    if (!executablePath) {
      throw new Error(
        `无法启动 Chromium（${firstErr?.message || firstErr}），且未找到本机 Chrome/Edge`,
      );
    }
    return puppeteer.launch({
      headless: true,
      executablePath,
      args,
    });
  }
}

/**
 * 在 goto 之前挂上 console / 异常 / 关键资源失败监听
 * @param {import('puppeteer').Page} page
 * @returns {{
 *   waitPending: () => Promise<void>,
 *   getConsole: () => ConsoleEntry[],
 *   getErrors: () => ConsoleEntry[],
 * }}
 */
export function attachPageListeners(page) {
  /** @type {ConsoleEntry[]} */
  const consoleEntries = [];
  /** @type {ConsoleEntry[]} */
  const errors = [];
  /** @type {Promise<void>[]} */
  const pending = [];

  page.on('console', (msg) => {
    const loc = msg.location();
    /** @type {ConsoleEntry} */
    const entry = {
      type: msg.type(),
      text: String(msg.text() || ''),
      source: loc?.url || '',
      line: loc?.lineNumber,
    };
    consoleEntries.push(entry);
    if (ERROR_CONSOLE_TYPES.has(entry.type)) {
      errors.push(entry);
    }

    // 异步补全对象参数，失败则保留 msg.text()
    pending.push(
      (async () => {
        try {
          const args = await Promise.all(
            msg.args().map((handle) => handle.jsonValue().catch(() => null)),
          );
          const serialized = args
            .filter((v) => v != null)
            .map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
            .join(' ');
          if (serialized) entry.text = serialized;
        } catch {
          // 保留已写入的 text
        }
      })(),
    );
  });

  page.on('pageerror', (err) => {
    errors.push({
      type: 'pageerror',
      text: err?.stack || err?.message || String(err),
    });
  });

  page.on('requestfailed', (req) => {
    const resourceType = req.resourceType();
    if (!CRITICAL_RESOURCE_TYPES.has(resourceType)) {
      return;
    }
    const failure = req.failure();
    errors.push({
      type: 'requestfailed',
      text: `${resourceType} 加载失败：${req.url()}（${failure?.errorText || 'failed'}）`,
      source: req.url(),
    });
  });

  return {
    waitPending: async () => {
      let snapshot;
      do {
        snapshot = pending.length;
        await Promise.all(pending);
      } while (pending.length > snapshot);
    },
    getConsole: () => consoleEntries.slice(),
    getErrors: () => errors.slice(),
  };
}

/**
 * 打开 URL，等到 load 事件（页面加载完成）
 * @param {import('puppeteer').Page} page
 * @param {string} url
 * @param {{ timeoutMs?: number, waitMs?: number }} [options]
 * @returns {Promise<{ httpStatus: number | null, loadOk: boolean }>}
 */
export async function waitForPageLoad(page, url, options = {}) {
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const waitMs = Number.isFinite(Number(options.waitMs))
    ? Math.max(0, Number(options.waitMs))
    : DEFAULT_WAIT_MS;

  const response = await page.goto(url, {
    waitUntil: 'load',
    timeout: timeoutMs,
  });

  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const httpStatus = typeof response?.status === 'function' ? response.status() : null;
  return { httpStatus, loadOk: true };
}

/**
 * 截图保存到项目 .front/debug/
 * @param {import('puppeteer').Page} page
 * @param {{ fullPage?: boolean }} [options]
 * @returns {Promise<string>} 截图绝对路径
 */
export async function capturePageScreenshot(page, options = {}) {
  const root = await getProjectRoot();
  const dir = join(root, '.front', 'debug');
  await mkdir(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = join(dir, `page-${stamp}.png`);
  await page.screenshot({
    path: filePath,
    type: 'png',
    fullPage: Boolean(options.fullPage),
  });
  return filePath;
}

/**
 * 预览页面：无头 Chromium 打开 → 监听加载 → 采集 console
 * 有报错不截图；无报错则截图保存
 * @param {{
 *   url: string,
 *   waitMs?: number,
 *   timeoutMs?: number,
 *   width?: number,
 *   height?: number,
 *   fullPage?: boolean,
 * }} options
 * @returns {Promise<DebugPageResult>}
 */
export async function debugPage(options) {
  const url = normalizePreviewUrl(options?.url);
  const width =
    Number(options?.width) > 0 ? Math.trunc(Number(options.width)) : DEFAULT_VIEWPORT.width;
  const height =
    Number(options?.height) > 0 ? Math.trunc(Number(options.height)) : DEFAULT_VIEWPORT.height;
  const fullPage = Boolean(options?.fullPage);

  const browser = await launchChromium();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });

    const listeners = attachPageListeners(page);
    const { httpStatus } = await waitForPageLoad(page, url, {
      timeoutMs: options?.timeoutMs,
      waitMs: options?.waitMs,
    });
    await listeners.waitPending();

    const consoleEntries = listeners.getConsole();
    const errors = listeners.getErrors();

    if (httpStatus && httpStatus >= 400) {
      errors.unshift({
        type: 'http',
        text: `页面 HTTP ${httpStatus}：${url}`,
        source: url,
      });
    }

    if (errors.length > 0) {
      return {
        url,
        hasError: true,
        errors,
        consoleEntries,
        screenshotPath: null,
        httpStatus,
      };
    }

    const screenshotPath = await capturePageScreenshot(page, { fullPage });
    return {
      url,
      hasError: false,
      errors: [],
      consoleEntries,
      screenshotPath,
      httpStatus,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * 根据扩展名得到图片 MIME
 * @param {string} filePath
 * @returns {string | null}
 */
export function imageMimeFromPath(filePath) {
  const ext = extname(String(filePath || '')).toLowerCase();
  const map = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  return map[ext] || null;
}
