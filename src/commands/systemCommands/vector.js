import chalk from 'chalk';
import ora from 'ora';
import {
  buildRagIndexes,
  getProjectDocDir,
  getProjectLanceDir,
  getUserDocDir,
  getUserLanceDir,
  listDocFiles,
} from '../../utils/ragHandle.js';
import { printSystem } from '../../utils/terminal.js';

/**
 * @param {string} label
 * @param {{ added: number, updated: number, skipped: number, removed: number, chunks: number }} stats
 */
function printStats(label, stats) {
  printSystem(
    chalk.cyan(label) +
      chalk.gray(
        ` 新增 ${stats.added} · 更新 ${stats.updated} · 跳过 ${stats.skipped} · 删除 ${stats.removed} · 写入块 ${stats.chunks}`,
      ),
  );
}

/** @type {import('../registry.js').CommandDef} */
export default {
  name: '/vector',
  description: '读取本地文档并增量写入向量库',
  aliases: ['/vec'],
  blocking: true,
  async run() {
    const userDoc = getUserDocDir();
    const userLance = getUserLanceDir();
    const projectDoc = await getProjectDocDir();
    const projectLance = await getProjectLanceDir();

    printSystem(chalk.gray(`用户文档：${userDoc}`));
    printSystem(chalk.gray(`用户向量库：${userLance}`));
    printSystem(chalk.gray(`项目文档：${projectDoc}`));
    printSystem(chalk.gray(`项目向量库：${projectLance}`));

    const userFiles = await listDocFiles(userDoc);
    const projectFiles = await listDocFiles(projectDoc);
    printSystem(
      chalk.gray(
        `可处理文档：用户 ${userFiles.length} 个 · 项目 ${projectFiles.length} 个（支持 .md/.txt/.docx 等文本）`,
      ),
    );

    if (userFiles.length === 0 && projectFiles.length === 0) {
      printSystem(
        chalk.yellow(
          '未找到可向量化的文档。请将文件放入上述 doc 目录（.docx 已支持；旧版 .doc / 图片等仍会跳过）',
        ),
      );
      return { type: 'blocking' };
    }

    const spinner = ora({
      text: chalk.gray('正在扫描文档并增量同步向量…'),
      discardStdin: false,
    }).start();

    try {
      const { userResult, projectResult } = await buildRagIndexes();
      spinner.succeed(chalk.green('向量同步完成（支持增量：未变更文件已跳过）'));
      printStats('用户', userResult.stats);
      printStats('项目', projectResult.stats);

      if (userResult.stats.chunks === 0 && projectResult.stats.chunks === 0) {
        const touched =
          userResult.stats.added +
          userResult.stats.updated +
          projectResult.stats.added +
          projectResult.stats.updated;
        if (touched === 0) {
          printSystem(chalk.gray('本次无新增向量块（文件未变更或内容为空）'));
        }
      }
    } catch (err) {
      spinner.fail(
        chalk.red(`向量同步失败：${err instanceof Error ? err.message : String(err)}`),
      );
    }

    return { type: 'blocking' };
  },
};
