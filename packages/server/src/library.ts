import os from 'node:os';
import { loadConfig } from './config.js';
import { scanAll } from './scanner.js';
import { fillCachedThumbs, queueThumbnailGeneration } from './thumbnails.js';
import type { Movie } from './types.js';

interface Library {
  movies: Movie[];
  byId: Map<string, Movie>;
  fingerprints: Record<string, string>;
  scannedAt: number;
}

/** 内存影片库缓存（HTTP 与局域网 LAN 服务共用同一份） */
let library: Library = { movies: [], byId: new Map(), fingerprints: {}, scannedAt: 0 };
let scanning: Promise<void> | null = null;

/** 只读访问当前内存库（列表 / byId 查询） */
export function getLibrary(): Library {
  return library;
}

export async function rescan(force = false): Promise<void> {
  // 并发合并：多个请求触发扫描时复用同一次扫描
  if (scanning) return scanning;
  scanning = (async () => {
    try {
      const cfg = await loadConfig();
      const { movies, fingerprints } = await scanAll(cfg.mediaRoots);
      const changed =
        force ||
        Object.keys(fingerprints).join() !== Object.keys(library.fingerprints).join() ||
        Object.entries(fingerprints).some(([k, v]) => library.fingerprints[k] !== v);
      if (changed) {
        // 封面：先填充已有缓存（快），缺少的进后台队列生成（不阻塞请求）
        const missing = await fillCachedThumbs(movies);
        queueThumbnailGeneration(missing);
        library = {
          movies,
          byId: new Map(movies.map((m) => [m.id, m])),
          fingerprints,
          scannedAt: Date.now(),
        };
        console.log(`[library] 扫描完成，共 ${movies.length} 部影片，待生成封面 ${missing.length} 张`);
      }
    } finally {
      scanning = null;
    }
  })();
  return scanning;
}

/**
 * 后台刷新：请求路径不等扫描（慢盘全量扫描可达十几秒），直接返回内存缓存；
 * 距上次扫描超过 30 秒时触发一次后台扫描，扫完自然对后续请求生效。
 */
export function refreshInBackground(): void {
  if (scanning) return;
  if (Date.now() - library.scannedAt < 30_000) return;
  void rescan();
}

/** 填充后台新生成的封面（仅文件存在性检查，毫秒级） */
export async function refreshThumbs(): Promise<void> {
  await fillCachedThumbs(library.movies);
}

/** 按 id 取影片 */
export function findMovie(id: string): Movie | undefined {
  return library.byId.get(id);
}

/** 列表过滤：分类 + 关键字（标题 / 文件名），LAN 与 HTTP 共用 */
export function filterMovies(opts: { keyword?: string; category?: string }): Movie[] {
  const keyword = (opts.keyword ?? '').trim().toLowerCase();
  const category = (opts.category ?? '').trim();
  let movies: Movie[] = library.movies;
  if (category === 'movie' || category === 'series') {
    movies = movies.filter((m) => m.category === category);
  }
  if (keyword) {
    movies = movies.filter(
      (m) => m.title.toLowerCase().includes(keyword) || m.fileName.toLowerCase().includes(keyword),
    );
  }
  return movies;
}

export function lanAddresses(port: number): string[] {
  return Object.entries(os.networkInterfaces())
    // 过滤 docker/网桥等虚拟网卡，只保留真实局域网接口
    .filter(([name]) => !/^(docker|br-|veth|virbr|lo)/.test(name))
    .flatMap(([, infos]) => infos ?? [])
    .filter((i): i is os.NetworkInterfaceInfo => Boolean(i))
    .filter((i) => i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i.address}:${port}`);
}

/** 供 UDP 发现返回：纯局域网 IPv4 地址列表（不含端口拼接） */
export function lanIps(): string[] {
  return lanAddresses(0).map((u) => new URL(u).hostname);
}
