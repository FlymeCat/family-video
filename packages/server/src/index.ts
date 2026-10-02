import { promises as fs } from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { loadConfig, saveConfig, WEB_DIST } from './config.js';
import { streamRange, streamTranscodedAudio } from './stream.js';
import { probeMedia } from './probe.js';
import { toVtt } from './subtitles.js';
import { store } from './store.js';
import { getThumbnailPath } from './thumbnails.js';
import { startLanServers } from './lan.js';
import {
  filterMovies,
  findMovie,
  getLibrary,
  lanAddresses,
  refreshInBackground,
  refreshThumbs,
  rescan,
} from './library.js';
import type { Progress } from './types.js';

const app = express();
app.set('trust proxy', true);
app.use(cors());
app.use(express.json());

// ---------- 媒体库 ----------
app.get('/api/movies', async (req, res) => {
  refreshInBackground();
  // 填充后台新生成的封面（仅文件存在性检查，毫秒级）
  await refreshThumbs();
  const movies = filterMovies({
    keyword: String(req.query.keyword ?? ''),
    category: String(req.query.category ?? ''),
  });
  res.json({ total: movies.length, movies });
});

app.get('/api/movies/:id', async (req, res) => {
  refreshInBackground();
  const movie = findMovie(req.params.id);
  if (!movie) return res.status(404).json({ error: '影片不存在' });
  res.json(movie);
});

app.post('/api/library/refresh', async (_req, res) => {
  await rescan(true);
  const lib = getLibrary();
  res.json({ total: lib.movies.length, scannedAt: lib.scannedAt });
});

// ---------- 流式播放 ----------
app.get('/api/media/:id/stream', async (req, res) => {
  const movie = findMovie(req.params.id);
  if (!movie) return res.status(404).json({ error: '影片不存在' });
  // 音频兼容模式：视频 copy、音轨转 AAC，供不支持 AC3/E-AC3/DTS 的设备（电视/手机）播放
  if (req.query.transcode === '1') {
    const start = Number(req.query.start ?? 0) || 0;
    return streamTranscodedAudio(req, res, movie.path, start);
  }
  await streamRange(req, res, movie.path, movie.mime);
});

// ---------- 媒体编码探测（前端据此判断是否需要音频兼容模式） ----------
app.get('/api/media/:id/probe', async (req, res) => {
  const movie = findMovie(req.params.id);
  if (!movie) return res.status(404).json({ error: '影片不存在' });
  res.json(await probeMedia(movie));
});

// ---------- 缩略图 ----------
app.get('/api/media/:id/thumbnail', async (req, res) => {
  const movie = findMovie(req.params.id);
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
  const movie = findMovie(req.params.id);
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
  const lib = getLibrary();
  res.json({
    mediaRoots: cfg.mediaRoots,
    port: cfg.port,
    lan: cfg.lan,
    publicBaseUrl: cfg.publicBaseUrl ?? null,
    lanUrls: lanAddresses(cfg.port),
    movieCount: lib.movies.length,
    lastScan: lib.scannedAt,
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
  res.json({ mediaRoots: valid, movieCount: getLibrary().movies.length });
});

// ---------- 健康检查 ----------
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, movies: getLibrary().movies.length });
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
  // 启动局域网 UDP 发现 + TCP 通信服务（供微信小程序免域名访问控制面）
  startLanServers(cfg, () => getLibrary().movies.length);
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
