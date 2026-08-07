import { homedir } from 'node:os';

/**
 * 获取当前用户电脑的 user（家目录）路径
 * Windows 一般为 C:\Users\<用户名>，macOS/Linux 为 /Users/<用户名> 或 /home/<用户名>
 * @returns {string}
 */
export function getUserHomeDir() {
  return homedir();
}

/**
 * 获取用户当前终端所在目录（进程工作目录）
 * @returns {string}
 */
export function getCwd() {
  return process.cwd();
}
