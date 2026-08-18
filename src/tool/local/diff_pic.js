import { readFile, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { chatCompletion } from '../../request/openai.js';
import { imageMimeFromPath } from '../../utils/debuggerUtils.js';

/** 单张图最大字节，避免 base64 撑爆请求 */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const DIFF_SYSTEM = `你是前端 UI 还原质检助手。用户会提供两张图：第一张是原始设计稿，第二张是当前页面截图。
请只根据图片里能看见的内容做视觉比对，判断页面 UI 是否还原设计稿。不要臆造看不见的问题。

重点检查：
1. 布局结构、对齐、间距、层级
2. 颜色、圆角、阴影、边框、背景
3. 字体大小、字重、行高、文案
4. 缺失、错位或多余的元素
5. 图片、图标、比例、按钮形态

输出要求（用中文）：
- 若整体高度还原：第一行写 MATCH: true，随后用几句话说明仍可接受的细微差别（若几乎一致也可写「无明显差异」）。
- 若存在需要修改的差异：第一行写 MATCH: false，然后分条列出。每条包含：位置（如顶部导航 / 主按钮 / 卡片标题）、设计稿表现、当前页面表现、建议改法。
不要输出无关开场白。`;

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {string}
 */
function requireAbsPath(value, label) {
  const target = String(value ?? '').trim();
  if (!target) {
    throw new Error(`${label} 不能为空`);
  }
  if (!isAbsolute(target)) {
    throw new Error(`${label} 必须是绝对路径，收到：${target}`);
  }
  return target;
}

/**
 * 读取本地图片为 data URL
 * @param {string} filePath
 * @param {string} label
 * @returns {Promise<{ mime: string, dataUrl: string, bytes: number }>}
 */
async function readImageDataUrl(filePath, label) {
  let info;
  try {
    info = await stat(filePath);
  } catch (err) {
    throw new Error(`无法访问${label} ${filePath}（${err?.message || err}）`);
  }
  if (!info.isFile()) {
    throw new Error(`${label} 不是文件：${filePath}`);
  }

  const mime = imageMimeFromPath(filePath);
  if (!mime) {
    throw new Error(`${label} 不是支持的图片格式（png/jpg/gif/webp）：${filePath}`);
  }
  if (info.size > MAX_IMAGE_BYTES) {
    throw new Error(
      `${label} 过大（${Math.round(info.size / 1024 / 1024)}MB），请控制在 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB 以内`,
    );
  }

  const buf = await readFile(filePath);
  return {
    mime,
    bytes: buf.length,
    dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
  };
}

/**
 * 读取设计图与页面截图，交给多模态模型做 UI 差异描述
 * @param {{ design_path?: string, screenshot_path?: string }} args
 * @returns {Promise<string>}
 */
async function runDiffPic({ design_path, screenshot_path } = {}) {
  let designPath;
  let shotPath;
  try {
    designPath = requireAbsPath(design_path, 'design_path');
    shotPath = requireAbsPath(screenshot_path, 'screenshot_path');
  } catch (err) {
    return `diff_pic 失败：${err?.message || err}`;
  }

  let designImg;
  let shotImg;
  try {
    designImg = await readImageDataUrl(designPath, '设计图');
    shotImg = await readImageDataUrl(shotPath, '页面截图');
  } catch (err) {
    return `diff_pic 失败：${err?.message || err}`;
  }

  let message;
  try {
    message = await chatCompletion([
      { role: 'system', content: DIFF_SYSTEM },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '请对比下面两张图，输出页面相对设计稿的 UI 差异。',
          },
          { type: 'text', text: '【原始设计图】' },
          { type: 'image_url', image_url: { url: designImg.dataUrl } },
          { type: 'text', text: '【当前页面截图】' },
          { type: 'image_url', image_url: { url: shotImg.dataUrl } },
        ],
      },
    ]);
  } catch (err) {
    return `diff_pic 失败：调用视觉模型出错（${err?.message || err}）`;
  }

  const diffText = String(message?.content || '').trim();
  if (!diffText) {
    return 'diff_pic 失败：视觉模型未返回有效内容';
  }

  return [
    'status: compared',
    `design_path: ${designPath}`,
    `screenshot_path: ${shotPath}`,
    `design_bytes: ${designImg.bytes}`,
    `screenshot_bytes: ${shotImg.bytes}`,
    '说明：以下为多模态模型识别出的 UI 差异。请据此酌情修改前端样式/结构，改完后可再次 debugger_page → diff_pic 迭代。',
    '---',
    diffText,
  ].join('\n');
}

export const toolList = [
  {
    type: 'function',
    function: {
      name: 'diff_pic',
      description:
        '视觉比对设计稿与页面截图：读取原始设计图、当前页面截图，传给多模态大模型识别 UI 差异，返回文字描述（哪里样式不对、建议怎么改）。在 debugger_page 返回 status: ok 且拿到 screenshot_path 后调用。design_path、screenshot_path 都必须是本地绝对路径。若当前对话没有设计图地址，先向用户索取，不要猜测路径。',
      parameters: {
        type: 'object',
        properties: {
          design_path: {
            type: 'string',
            description: '原始设计图的本地绝对路径（png/jpg/gif/webp），通常位于项目 .front/design/ 下',
          },
          screenshot_path: {
            type: 'string',
            description: 'debugger_page 返回的当前页面截图绝对路径',
          },
        },
        required: ['design_path', 'screenshot_path'],
      },
    },
  },
];

export const toolMap = {
  diff_pic: runDiffPic,
};
