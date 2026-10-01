import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { loadConfig, saveConfig, WEB_DIST } from './config.js';
import { scanAll } from './scanner.js';
import { streamRange } from './stream.js';
import { toVtt } from './subtitles.js';
import { store } from './store.js';
import { fillCachedThumbs, getThumbnailPath, queueThumbnailGeneration } from './thumbnails.js';
import type { Movie, Progress } from './types.js';

interface Library {
  movies: Movie[];
  byId: Map<string, Movie>;
  fingerprints: Record<string, string>;
  scannedAt: number;
}

/** 内存影片库缓存 */
let library: Library = { movies: [], byId: new Map(), fingerprints: {}, scannedAt: 0 };
let scanning: Promise<void> | null = null;

async function rescan(force = false): Promise<void> {
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
function refreshInBackground(): void {
  if (scanning) return;
  if (Date.now() - library.scannedAt < 30_000) return;
  void rescan();
}

function lanAddresses(port: number): string[] {
  return Object.entries(os.networkInterfaces())
    // 过滤 docker/网桥等虚拟网卡，只保留真实局域网接口
    .filter(([name]) => !/^(docker|br-|veth|virbr|lo)/.test(name))
    .flatMap(([, infos]) => infos ?? [])
    .filter((i): i is os.NetworkInterfaceInfo => Boolean(i))
    .filter((i) => i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i.address}:${port}`);
}

const app = express();
app.use(cors());
app.use(express.json());

// ---------- 媒体库 ----------
app.get('/api/movies', async (req, res) => {
  refreshInBackground();
  // 填充后台新生成的封面（仅文件存在性检查，毫秒级）
  await fillCachedThumbs(library.movies);
  const keyword = String(req.query.keyword ?? '').trim().toLowerCase();
  const category = String(req.query.category ?? '').trim();
  let movies = library.movies;
  if (category === 'movie' || category === 'series') {
    movies = movies.filter((m) => m.category === category);
  }
  if (keyword) {
    movies = movies.filter(
      (m) => m.title.toLowerCase().includes(keyword) || m.fileName.toLowerCase().includes(keyword),
    );
  }
  res.json({ total: movies.length, movies });
});

app.get('/api/movies/:id', async (req, res) => {
  refreshInBackground();
  const movie = library.byId.get(req.params.id);
  if (!movie) return res.status(404).json({ error: '影片不存在' });
  res.json(movie);
});

app.post('/api/library/refresh', async (_req, res) => {
  await rescan(true);
  res.json({ total: library.movies.length, scannedAt: library.scannedAt });
});

// ---------- 流式播放 ----------
app.get('/api/media/:id/stream', async (req, res) => {
  const movie = library.byId.get(req.params.id);
  if (!movie) return res.status(404).json({ error: '影片不存在' });
  await streamRange(req, res, movie.path, movie.mime);
});

// ---------- 缩略图 ----------
app.get('/api/media/:id/thumbnail', async (req, res) => {
  const movie = library.byId.get(req.params.id);
  if (!movie || !movie.thumb) return res.status(404).end();
  const file = await getThumbnailPath(movie);
  try {
    await fs.access(file);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.type('image/jpeg').sendFile(file);
  } catch {
    res.status(404).end();
  }
});

// ---------- 字幕（统一转 WebVTT） ----------
app.get('/api/media/:id/subtitle', async (req, res) => {
  const movie = library.byId.get(req.params.id);
  if (!movie) return res.status(404).json({ error: '影片不存在' });
  const idx = Number(req.query.track ?? 0);
  const sub = movie.subtitles[idx];
  if (!sub) return res.status(404).json({ error: '字幕不存在' });
  try {
    const vtt = await toVtt(sub.path);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.type('text/vtt').send(vtt);
  } catch {
    res.status(500).json({ error: '字幕转换失败' });
  }
});

// ---------- 观看进度 ----------
app.get('/api/progress', async (req, res) => {
  const deviceId = String(req.query.deviceId ?? '');
  if (!deviceId) return res.status(400).json({ error: '缺少 deviceId' });
  res.json(await store.getProgress(deviceId));
});

app.post('/api/progress', async (req, res) => {
  const { deviceId, movieId, position, duration } = req.body ?? {};
  if (!deviceId || !movieId || typeof position !== 'number') {
    return res.status(400).json({ error: '参数不完整' });
  }
  const p: Progress = {
    movieId: String(movieId),
    deviceId: String(deviceId),
    position,
    duration: typeof duration === 'number' ? duration : 0,
    updatedAt: Date.now(),
  };
  await store.setProgress(p);
  res.json({ ok: true });
});

app.delete('/api/progress', async (req, res) => {
  const deviceId = String(req.query.deviceId ?? '');
  const movieId = String(req.query.movieId ?? '');
  if (!deviceId || !movieId) return res.status(400).json({ error: '参数不完整' });
  await store.removeProgress(deviceId, movieId);
  res.json({ ok: true });
});

// ---------- 收藏 ----------
app.get('/api/favorites', async (req, res) => {
  const deviceId = String(req.query.deviceId ?? '');
  if (!deviceId) return res.status(400).json({ error: '缺少 deviceId' });
  res.json(await store.getFavorites(deviceId));
});

app.post('/api/favorites', async (req, res) => {
  const { deviceId, movieId } = req.body ?? {};
  if (!deviceId || !movieId) return res.status(400).json({ error: '参数不完整' });
  const added = await store.toggleFavorite(String(deviceId), String(movieId));
  res.json({ favorite: added });
});

// 批量收藏：连续剧整组收藏/取消，一次请求完成
app.post('/api/favorites/batch', async (req, res) => {
  const { deviceId, movieIds, favorite } = req.body ?? {};
  if (!deviceId || !Array.isArray(movieIds) || typeof favorite !== 'boolean') {
    return res.status(400).json({ error: '参数不完整' });
  }
  await store.setFavorites(String(deviceId), movieIds.map(String), favorite);
  res.json({ ok: true });
});

// ---------- 配置 ----------
app.get('/api/config', async (_req, res) => {
  const cfg = await loadConfig();
  res.json({
    mediaRoots: cfg.mediaRoots,
    port: cfg.port,
    lanUrls: lanAddresses(cfg.port),
    movieCount: library.movies.length,
    lastScan: library.scannedAt,
  });
});

app.put('/api/config', async (req, res) => {
  const cfg = await loadConfig();
  const roots = Array.isArray(req.body?.mediaRoots)
    ? (req.body.mediaRoots as string[]).map((r) => path.resolve(String(r))).filter(Boolean)
    : cfg.mediaRoots;
  // 校验目录存在
  const valid: string[] = [];
  for (const r of roots) {
    try {
      const st = await fs.stat(r);
      if (st.isDirectory()) valid.push(r);
    } catch {
      /* 忽略不存在的目录 */
    }
  }
  if (valid.length === 0) return res.status(400).json({ error: '没有有效的媒体目录' });
  const next = { ...cfg, mediaRoots: valid };
  await saveConfig(next);
  await rescan(true);
  res.json({ mediaRoots: valid, movieCount: library.movies.length });
});

// ---------- 健康检查 ----------
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, movies: library.movies.length });
});

// ---------- 首页：托管前端构建产物 ----------
// 只要 dist 存在就对外提供页面（开发/生产模式均可用 8080 访问）
app.use(express.static(WEB_DIST));
// SPA fallback：非 /api 请求返回 index.html；产物不存在时（未执行 pnpm build）给出指引页
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(WEB_DIST, 'index.html'), (err) => {
    if (!err) return;
    res.status(200).type('html').send(`<!doctype html><html lang="zh-CN"><body style="background:#17171d;color:#fff;font-family:sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0"><div style="max-width:520px;padding:24px"><h2 style="color:#e50914">家庭影院</h2><p>前端页面尚未构建，请在项目根目录执行：</p><pre style="background:#26262e;padding:12px;border-radius:8px">pnpm build</pre><p>或开发模式下访问首页：<a href="http://localhost:5173" style="color:#e50914">http://localhost:5173</a></p></div></body></html>`);
  });
});

async function main(): Promise<void> {
  const cfg = await loadConfig();
  // 默认媒体目录不存在时自动创建，方便直接放入视频
  for (const root of cfg.mediaRoots) {
    await fs.mkdir(root, { recursive: true }).catch(() => undefined);
  }
  await rescan(true);
  // 不指定 host：监听所有接口（IPv4+IPv6），局域网设备和本机 localhost（含 ::1）都能访问
  app.listen(cfg.port, () => {
    console.log(`[server] 家庭影院已启动（局域网可访问）：`);
    for (const url of lanAddresses(cfg.port)) console.log(`  ${url}`);
    console.log(`[server] 媒体目录：${cfg.mediaRoots.join(', ')}`);
  });
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
