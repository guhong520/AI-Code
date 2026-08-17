import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import * as lancedb from '@lancedb/lancedb';
import { createEmbeddings } from '../request/openai.js';
import { findProjectRoot } from './fsHandle.js';
import { getCwd, getUserHomeDir } from './pathUtils.js';

const TABLE_NAME = 'doc_chunks';
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 120;
const EMBED_BATCH_SIZE = 32;

/** 明确视为二进制、直接跳过的扩展名 */
const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.ico',
  '.pdf',
  '.zip',
  '.gz',
  '.7z',
  '.rar',
  '.tar',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.wasm',
  '.mp3',
  '.mp4',
  '.avi',
  '.mov',
  '.wav',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.class',
  '.jar',
  '.pyc',
  '.node',
]);

/**
 * @typedef {{ id: string, path: string, text: string, vector: number[], chunkIndex: number, fileHash: string, mtimeMs: number }} RagChunkRecord
 * @typedef {{ path: string, absolutePath: string, mtimeMs: number, size: number }} DocFileInfo
 * @typedef {{ added: number, updated: number, skipped: number, removed: number, chunks: number }} SyncStats
 */

/**
 * 用户文档目录：~/.front/doc
 * @returns {string}
 */
export function getUserDocDir() {
  return join(getUserHomeDir(), '.front', 'doc');
}

/**
 * 用户 LanceDB 目录：~/.front/lance-data
 * @returns {string}
 */
export function getUserLanceDir() {
  return join(getUserHomeDir(), '.front', 'lance-data');
}

/**
 * 项目文档目录：<project>/.front/doc
 * @param {string} [projectRoot]
 * @returns {Promise<string>}
 */
export async function getProjectDocDir(projectRoot) {
  const root = projectRoot || (await findProjectRoot(getCwd()));
  return join(root, '.front', 'doc');
}

/**
 * 项目 LanceDB 目录：<project>/.front/lance-data
 * @param {string} [projectRoot]
 * @returns {Promise<string>}
 */
export async function getProjectLanceDir(projectRoot) {
  const root = projectRoot || (await findProjectRoot(getCwd()));
  return join(root, '.front', 'lance-data');
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeSqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * @param {string} filePath
 * @param {Buffer} [buf]
 * @returns {boolean}
 */
function isBinaryFile(filePath, buf) {
  const ext = extname(filePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return true;
  if (!buf) return false;
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  return sample.includes(0);
}

/**
 * @param {string} dir
 * @param {string} root
 * @param {DocFileInfo[]} out
 */
async function walkFiles(dir, root, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(full, root, out);
      continue;
    }
    if (!entry.isFile()) continue;

    const st = await stat(full);
    out.push({
      path: relative(root, full).split(sep).join('/'),
      absolutePath: full,
      mtimeMs: st.mtimeMs,
      size: st.size,
    });
  }
}

/**
 * 列出文档目录中的文本文件（过滤二进制）
 * @param {string} docDir
 * @returns {Promise<DocFileInfo[]>}
 */
export async function listDocFiles(docDir) {
  try {
    await access(docDir);
  } catch {
    return [];
  }

  /** @type {DocFileInfo[]} */
  const files = [];
  await walkFiles(docDir, docDir, files);

  /** @type {DocFileInfo[]} */
  const textFiles = [];
  for (const file of files) {
    if (BINARY_EXTENSIONS.has(extname(file.absolutePath).toLowerCase())) {
      continue;
    }
    const head = await readFileHead(file.absolutePath, 8192);
    if (isBinaryFile(file.absolutePath, head)) continue;
    textFiles.push(file);
  }

  textFiles.sort((a, b) => a.path.localeCompare(b.path));
  return textFiles;
}

/**
 * @param {string} filePath
 * @param {number} bytes
 * @returns {Promise<Buffer>}
 */
function readFileHead(filePath, bytes) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    const stream = createReadStream(filePath, { start: 0, end: bytes - 1 });
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('close', () => resolve(Buffer.concat(chunks)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

/**
 * 按字符窗口切块（带重叠）
 * @param {string} text
 * @param {{ chunkSize?: number, overlap?: number }} [options]
 * @returns {string[]}
 */
export function chunkText(text, options = {}) {
  const chunkSize = options.chunkSize ?? CHUNK_SIZE;
  const overlap = options.overlap ?? CHUNK_OVERLAP;
  const content = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!content) return [];
  if (content.length <= chunkSize) return [content];

  const step = Math.max(1, chunkSize - overlap);
  /** @type {string[]} */
  const chunks = [];
  for (let start = 0; start < content.length; start += step) {
    const end = Math.min(content.length, start + chunkSize);
    const piece = content.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= content.length) break;
  }
  return chunks;
}

/**
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function hashFile(filePath) {
  const buf = await readFile(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * @param {string} filePath
 * @param {number} chunkIndex
 * @returns {string}
 */
function makeChunkId(filePath, chunkIndex) {
  return createHash('sha1').update(`${filePath}::${chunkIndex}`).digest('hex');
}

/**
 * @param {{ path: string, text: string, chunkIndex: number, fileHash: string, mtimeMs: number }[]} pieces
 * @returns {Promise<RagChunkRecord[]>}
 */
async function embedPieces(pieces) {
  /** @type {RagChunkRecord[]} */
  const records = [];
  for (let i = 0; i < pieces.length; i += EMBED_BATCH_SIZE) {
    const batch = pieces.slice(i, i + EMBED_BATCH_SIZE);
    const vectors = await createEmbeddings(batch.map((p) => p.text));
    for (let j = 0; j < batch.length; j++) {
      const item = batch[j];
      records.push({
        id: makeChunkId(item.path, item.chunkIndex),
        path: item.path,
        text: item.text,
        vector: vectors[j],
        chunkIndex: item.chunkIndex,
        fileHash: item.fileHash,
        mtimeMs: item.mtimeMs,
      });
    }
  }
  return records;
}

/**
 * @param {string} lanceDir
 * @returns {Promise<import('@lancedb/lancedb').Connection>}
 */
async function connectLance(lanceDir) {
  await mkdir(lanceDir, { recursive: true });
  return lancedb.connect(lanceDir);
}

/**
 * @param {import('@lancedb/lancedb').Table} table
 * @returns {Promise<Map<string, string>>}
 */
async function loadExistingFileHashes(table) {
  /** @type {Map<string, string>} */
  const map = new Map();
  const rows = await table.query().select(['path', 'fileHash']).toArray();
  for (const row of rows) {
    const path = String(row.path ?? '');
    if (!path) continue;
    if (!map.has(path)) map.set(path, String(row.fileHash ?? ''));
  }
  return map;
}

/**
 * @param {import('@lancedb/lancedb').Table} table
 * @returns {Promise<number | null>}
 */
async function getVectorDim(table) {
  try {
    const schema = await table.schema();
    const vectorField = schema.fields.find((f) => f.name === 'vector');
    const type = vectorField?.type;
    const listSize = type?.listSize ?? type?.length;
    return typeof listSize === 'number' ? listSize : null;
  } catch {
    return null;
  }
}

/**
 * @param {import('@lancedb/lancedb').Table} table
 * @param {string[]} paths
 */
async function deleteByPaths(table, paths) {
  if (paths.length === 0) return;
  const batchSize = 40;
  for (let i = 0; i < paths.length; i += batchSize) {
    const batch = paths.slice(i, i + batchSize);
    const cond = batch.map((p) => `path = ${escapeSqlString(p)}`).join(' OR ');
    await table.delete(cond);
  }
}

/**
 * 读取并切块单个文件
 * @param {DocFileInfo} file
 * @param {string} fileHash
 * @returns {Promise<{ path: string, text: string, chunkIndex: number, fileHash: string, mtimeMs: number }[]>}
 */
async function fileToPieces(file, fileHash) {
  const raw = await readFile(file.absolutePath);
  if (isBinaryFile(file.absolutePath, raw)) return [];
  const chunks = chunkText(raw.toString('utf8'));
  return chunks.map((text, chunkIndex) => ({
    path: file.path,
    text,
    chunkIndex,
    fileHash,
    mtimeMs: file.mtimeMs,
  }));
}

/**
 * 将文档目录增量同步到 LanceDB
 * @param {string} docDir
 * @param {string} lanceDir
 * @returns {Promise<{ records: RagChunkRecord[], stats: SyncStats }>}
 */
export async function syncDocsToLance(docDir, lanceDir) {
  const files = await listDocFiles(docDir);
  const db = await connectLance(lanceDir);
  const tableNames = await db.tableNames();
  const hasTable = tableNames.includes(TABLE_NAME);

  /** @type {Map<string, string>} */
  let existing = new Map();
  /** @type {import('@lancedb/lancedb').Table | null} */
  let table = null;

  if (hasTable) {
    table = await db.openTable(TABLE_NAME);
    existing = await loadExistingFileHashes(table);
  }

  /** @type {Map<string, string>} */
  const fileHashes = new Map();
  for (const file of files) {
    fileHashes.set(file.path, await hashFile(file.absolutePath));
  }

  const currentPaths = new Set(files.map((f) => f.path));
  const removedPaths = [...existing.keys()].filter((p) => !currentPaths.has(p));

  /** @type {DocFileInfo[]} */
  let changedFiles = [];
  let skipped = 0;
  for (const file of files) {
    const hash = fileHashes.get(file.path) || '';
    const prev = existing.get(file.path);
    if (prev && prev === hash) {
      skipped += 1;
    } else {
      changedFiles.push(file);
    }
  }

  /** @type {{ path: string, text: string, chunkIndex: number, fileHash: string, mtimeMs: number }[]} */
  let pieces = [];
  for (const file of changedFiles) {
    const hash = fileHashes.get(file.path) || '';
    pieces.push(...(await fileToPieces(file, hash)));
  }

  let records = await embedPieces(pieces);

  // 向量维度变化（换 embedding 模型）时全量重建，避免只写入变更文件导致旧数据丢失
  if (table && records.length > 0) {
    const dim = await getVectorDim(table);
    if (dim != null && dim !== records[0].vector.length) {
      await db.dropTable(TABLE_NAME);
      table = null;
      existing = new Map();
      skipped = 0;
      changedFiles = files;
      removedPaths.length = 0;
      pieces = [];
      for (const file of changedFiles) {
        const hash = fileHashes.get(file.path) || '';
        pieces.push(...(await fileToPieces(file, hash)));
      }
      records = await embedPieces(pieces);
    }
  }

  if (table) {
    if (removedPaths.length > 0) await deleteByPaths(table, removedPaths);
    if (changedFiles.length > 0) {
      await deleteByPaths(
        table,
        changedFiles.map((f) => f.path),
      );
    }
    if (records.length > 0) await table.add(records);
  } else if (records.length > 0) {
    table = await db.createTable(TABLE_NAME, records);
  }

  /** @type {SyncStats} */
  const stats = {
    added: changedFiles.filter((f) => !existing.has(f.path)).length,
    updated: changedFiles.filter((f) => existing.has(f.path)).length,
    skipped,
    removed: removedPaths.length,
    chunks: records.length,
  };

  return { records, stats };
}

/**
 * 同步用户文档 → ~/.front/lance-data
 * @returns {Promise<{ records: RagChunkRecord[], stats: SyncStats }>}
 */
export async function syncUserDocs() {
  return syncDocsToLance(getUserDocDir(), getUserLanceDir());
}

/**
 * 同步项目文档 → <project>/.front/lance-data
 * @returns {Promise<{ records: RagChunkRecord[], stats: SyncStats }>}
 */
export async function syncProjectDocs() {
  const projectRoot = await findProjectRoot(getCwd());
  return syncDocsToLance(
    await getProjectDocDir(projectRoot),
    await getProjectLanceDir(projectRoot),
  );
}

/**
 * 完整流程：用户/项目分别切块、向量化，写入各自 LanceDB
 * @returns {Promise<{
 *   userResult: { records: RagChunkRecord[], stats: SyncStats },
 *   projectResult: { records: RagChunkRecord[], stats: SyncStats },
 * }>}
 */
export async function buildRagIndexes() {
  const userResult = await syncUserDocs();
  const projectResult = await syncProjectDocs();
  return { userResult, projectResult };
}
