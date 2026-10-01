import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { THUMB_DIR } from './config.js';
import type { Movie } from './types.js';

/** ffmpeg 是否可用（进程生命周期内探测一次） */
let ffmpegAvailable: boolean | null = null;
/** 抽帧失败原因只首次记录一次 */
let loggedSpawnError = false;

async function probeFfmpeg(): Promise<boolean> {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  ffmpegAvailable = await new Promise<boolean>((resolve) => {
    execFile('ffmpeg', ['-version'], { timeout: 5000 }, (err) => resolve(!err));
  });
  return ffmpegAvailable;
}

/**
 * 封面缓存路径。签名只用 path+size，不含 mtime——
 * DrvFs/网络挂载的 mtime 读数不稳定，含 mtime 会导致缓存永远 miss、全量重跑 ffmpeg。
 */
function thumbPath(movie: Movie): string {
  const sig = createHash('md5').update(`${movie.path}:${movie.size}`).digest('hex');
  return path.join(THUMB_DIR, `${sig}.jpg`);
}

/** 执行一次 ffmpeg 抽帧，返回是否成功且输出了非空文件（seek 超出时长时 ffmpeg 退出码为 0 但不产生文件） */
async function tryExtract(movie: Movie, output: string, at: number): Promise<boolean> {
  const ok = await new Promise<boolean>((resolve) => {
    execFile(
      'ffmpeg',
      [
        '-ss', String(at),
        '-i', movie.path,
        '-frames:v', '1',
        '-vf', 'scale=480:-2',
        '-q:v', '4',
        '-y', output,
      ],
      { timeout: 20000 },
      (err) => {
        if (err) {
          // 首次失败时记录原因（ENOENT=找不到ffmpeg；其他多为文件问题）
          if (!loggedSpawnError) {
            loggedSpawnError = true;
            console.warn(`[thumb] ffmpeg 抽帧失败(${movie.path} @${at}s): ${(err as NodeJS.ErrnoException).code ?? err.message}`);
          }
          resolve(false);
        } else {
          resolve(true);
        }
      },
    );
  });
  if (!ok) return false;
  try {
    const st = await fs.stat(output);
    return st.size > 0;
  } catch {
    return false;
  }
}

async function extractFrame(movie: Movie, output: string): Promise<boolean> {
  // 依次尝试 30s / 5s / 1s，适配不同时长的视频
  for (const at of [30, 5, 1]) {
    if (await tryExtract(movie, output, at)) return true;
  }
  return false;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** 快速填充已有缓存封面（只做文件存在性检查，毫秒级），返回仍缺封面的影片 */
export async function fillCachedThumbs(movies: Movie[]): Promise<Movie[]> {
  const missing: Movie[] = [];
  await Promise.all(
    movies.map(async (movie) => {
      if (movie.thumb) return;
      if (await exists(thumbPath(movie))) {
        movie.thumb = `/api/media/${movie.id}/thumbnail`;
      } else {
        missing.push(movie);
      }
    }),
  );
  return missing;
}

/** 封面生成完成计数（用于日志） */
let generatedCount = 0;

/** 后台生成队列：限制并发，避免上百个 ffmpeg 同时跑拖垮机器 */
const QUEUE_LIMIT = 2;
const queued = new Set<string>();
/** 生成失败的影片（如损坏文件/浏览器不支持的编码），本进程内不再重复入队 */
const failed = new Set<string>();
let running = 0;
const pending: Movie[] = [];

async function drainQueue(): Promise<void> {
  while (running < QUEUE_LIMIT && pending.length > 0) {
    const movie = pending.shift()!;
    running++;
    try {
      const out = thumbPath(movie);
      await fs.mkdir(THUMB_DIR, { recursive: true });
      // 先写临时文件再改名，避免生成中途被请求读到半截 jpg。
      // 临时名必须以 .jpg 结尾：ffmpeg 靠扩展名推断输出格式，.tmp 后缀会报 exit 234
      const tmp = `${out}.tmp.jpg`;
      if (await extractFrame(movie, tmp)) {
        await fs.rename(tmp, out);
        generatedCount++;
        if (generatedCount === 1 || generatedCount % 20 === 0) {
          console.log(`[thumb] 封面已生成 ${generatedCount} 张`);
        }
      } else {
        failed.add(movie.id);
        await fs.rm(tmp, { force: true }).catch(() => undefined);
      }
    } catch {
      /* 单部失败不影响队列 */
    } finally {
      queued.delete(movie.id);
      running--;
      void drainQueue();
    }
  }
}

/** 将缺封面的影片加入后台生成队列（不阻塞当前请求） */
export function queueThumbnailGeneration(movies: Movie[]): void {
  void probeFfmpeg().then((ok) => {
    if (!ok) {
      console.warn('[thumb] 未检测到 ffmpeg，跳过封面生成（前端使用占位图）');
      return;
    }
    for (const movie of movies) {
      if (queued.has(movie.id) || failed.has(movie.id)) continue;
      queued.add(movie.id);
      pending.push(movie);
    }
    void drainQueue();
  });
}

export async function getThumbnailPath(movie: Movie): Promise<string> {
  return thumbPath(movie);
}
