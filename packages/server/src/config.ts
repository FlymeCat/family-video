import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppConfig } from './types.js';

/** 项目根目录（config.ts 位于 packages/server/src 下往上四级） */
const PROJECT_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../..');

/** .data 目录（持久化配置 / 进度 / 收藏） */
export const DATA_DIR = path.resolve(
  process.env.FV_DATA_DIR || path.join(PROJECT_ROOT, '.data'),
);
/** 缩略图缓存目录 */
export const CACHE_DIR = path.join(DATA_DIR, 'cache');
export const THUMB_DIR = path.join(CACHE_DIR, 'thumbnails');

/** 生产模式下 web 构建产物目录 */
export const WEB_DIST = path.resolve(
  process.env.FV_WEB_DIST || path.join(PROJECT_ROOT, 'packages/web/dist'),
);

const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const DEFAULT_ROOT = path.resolve(process.env.FV_MEDIA_DIR || path.join(PROJECT_ROOT, 'media'));

const DEFAULT_CONFIG: AppConfig = {
  mediaRoots: [DEFAULT_ROOT],
  port: Number(process.env.PORT || 8080),
};

let cached: AppConfig | null = null;

async function ensureDirs(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(THUMB_DIR, { recursive: true });
}

/** 读取配置（带内存缓存 + 文件持久化） */
export async function loadConfig(): Promise<AppConfig> {
  if (cached) return cached;
  await ensureDirs();
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    cached = {
      mediaRoots:
        Array.isArray(parsed.mediaRoots) && parsed.mediaRoots.length > 0
          ? parsed.mediaRoots.map((r) => path.resolve(r))
          : DEFAULT_CONFIG.mediaRoots,
      port: typeof parsed.port === 'number' ? parsed.port : DEFAULT_CONFIG.port,
    };
  } catch {
    cached = { ...DEFAULT_CONFIG, mediaRoots: [...DEFAULT_CONFIG.mediaRoots] };
    await saveConfig(cached);
  }
  return cached;
}

/** 保存配置 */
export async function saveConfig(cfg: AppConfig): Promise<void> {
  await ensureDirs();
  cached = cfg;
  await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}
