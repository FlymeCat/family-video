import net from 'node:net';
import dgram from 'node:dgram';
import { promises as fs } from 'node:fs';
import { store } from './store.js';
import { probeMedia } from './probe.js';
import { toVtt } from './subtitles.js';
import { getThumbnailPath } from './thumbnails.js';
import {
  filterMovies,
  findMovie,
  lanAddresses,
  refreshInBackground,
  refreshThumbs,
  rescan,
} from './library.js';
import type { AppConfig, Movie, Progress } from './types.js';

/**
 * 局域网通信层：为微信小程序提供「免域名」的控制面通道。
 * - UDP 发现（dgram）：小程序广播搜索，服务器回复自身地址与 TCP 端口。
 * - TCP JSON-RPC（net）：换行分帧，请求 {id,method,params} → 响应 {id,ok,result|error}。
 *
 * 视频画面不走此通道：微信发布版 <video> 只能吃已备案 HTTPS 域名（见集成文档）。
 */

/** 剥离服务器绝对路径，避免通过局域网泄露文件系统结构 */
function publicMovie(m: Movie): Omit<Movie, 'path' | 'root'> {
  const { path: _p, root: _r, ...rest } = m;
  return rest;
}

interface RpcRequest {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
}

type Handler = (params: Record<string, unknown>) => Promise<unknown>;

async function handle(method: string, params: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    case 'server.info': {
      return {
        service: 'family-video',
        movieCount: getMovieCount(),
        lanUrls: lanAddresses(HTTP_PORT_REF.value),
        tcpPort: LAN.tcpPort,
        udpPort: LAN.udpPort,
        publicBaseUrl: LAN.publicBaseUrl ?? null,
      };
    }

    case 'library.list': {
      refreshInBackground();
      await refreshThumbs();
      const all = filterMovies({
        keyword: String(params.keyword ?? ''),
        category: String(params.category ?? ''),
      });
      const total = all.length;
      const pageSize = Math.min(200, Math.max(1, Number(params.pageSize ?? 48) || 48));
      const page = Math.max(1, Number(params.page ?? 1) || 1);
      const start = (page - 1) * pageSize;
      const movies = all.slice(start, start + pageSize).map(publicMovie);
      return { total, page, pageSize, movies };
    }

    case 'library.refresh': {
      await rescan(true);
      return { total: getMovieCount(), scannedAt: Date.now() };
    }

    case 'movie.get': {
      refreshInBackground();
      const movie = findMovie(String(params.id ?? ''));
      if (!movie) throw new Error('影片不存在');
      return publicMovie(movie);
    }

    case 'favorites.list': {
      return store.getFavorites(String(params.deviceId ?? ''));
    }

    case 'favorites.toggle': {
      const added = await store.toggleFavorite(String(params.deviceId ?? ''), String(params.movieId ?? ''));
      return { favorite: added };
    }

    case 'favorites.batch': {
      const ids = params.movieIds;
      if (!Array.isArray(ids)) throw new Error('参数不完整');
      await store.setFavorites(
        String(params.deviceId ?? ''),
        ids.map(String),
        Boolean(params.favorite),
      );
      return { ok: true };
    }

    case 'progress.list': {
      return store.getProgress(String(params.deviceId ?? ''));
    }

    case 'progress.set': {
      const position = Number(params.position);
      if (!params.deviceId || !params.movieId || typeof position !== 'number') {
        throw new Error('参数不完整');
      }
      const p: Progress = {
        movieId: String(params.movieId),
        deviceId: String(params.deviceId),
        position,
        duration: typeof params.duration === 'number' ? params.duration : 0,
        updatedAt: Date.now(),
      };
      await store.setProgress(p);
      return { ok: true };
    }

    case 'progress.remove': {
      await store.removeProgress(String(params.deviceId ?? ''), String(params.movieId ?? ''));
      return { ok: true };
    }

    case 'media.probe': {
      const movie = findMovie(String(params.id ?? ''));
      if (!movie) throw new Error('影片不存在');
      return probeMedia(movie);
    }

    case 'media.subtitle': {
      const movie = findMovie(String(params.id ?? ''));
      if (!movie) throw new Error('影片不存在');
      const idx = Number(params.track ?? 0);
      const sub = movie.subtitles[idx];
      if (!sub) throw new Error('字幕不存在');
      return { vtt: await toVtt(sub.path) };
    }

    case 'media.thumbnail': {
      // 封面以 base64 回传：图片无需 HTTPS 域名即可在小程序 <image src="data:..."> 显示
      const movie = findMovie(String(params.id ?? ''));
      if (!movie || !movie.thumb) throw new Error('封面不存在');
      const file = await getThumbnailPath(movie);
      const buf = await fs.readFile(file);
      return { base64: buf.toString('base64'), mime: 'image/jpeg' };
    }

    default:
      throw new Error(`未知方法: ${method}`);
  }
}

/** 运行时注入的配置（startLanServers 时赋值） */
const LAN: { udpPort: number; tcpPort: number; publicBaseUrl?: string } = {
  udpPort: 9527,
  tcpPort: 9528,
};
const HTTP_PORT_REF = { value: 8080 };
let getMovieCount: () => number = () => 0;

/** 处理单条 TCP 连接：累积缓冲、按换行拆分请求 */
function attachConnection(socket: net.Socket): void {
  let buffer = '';
  socket.setNoDelay(true);

  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    // 防止异常客户端撑爆内存：单帧上限 4MB
    if (buffer.length > 4 * 1024 * 1024) {
      socket.end();
      return;
    }
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      void processLine(socket, line);
    }
  });

  socket.on('error', () => socket.destroy());
}

async function processLine(socket: net.Socket, line: string): Promise<void> {
  let req: RpcRequest;
  try {
    req = JSON.parse(line) as RpcRequest;
  } catch {
    writeResponse(socket, { id: null, ok: false, error: 'JSON 解析失败' });
    return;
  }
  try {
    const result = await handle(String(req.method ?? ''), req.params ?? {});
    writeResponse(socket, { id: req.id ?? null, ok: true, result });
  } catch (err) {
    writeResponse(socket, { id: req.id ?? null, ok: false, error: (err as Error).message });
  }
}

function writeResponse(socket: net.Socket, payload: unknown): void {
  if (socket.writable) socket.write(JSON.stringify(payload) + '\n');
}

/**
 * 启动局域网 UDP 发现服务与 TCP JSON-RPC 服务。
 * 与 Express 并行监听，进程内共享同一份内存影片库缓存。
 */
export function startLanServers(cfg: AppConfig, movieCount: () => number): void {
  LAN.udpPort = cfg.lan.udpPort;
  LAN.tcpPort = cfg.lan.tcpPort;
  LAN.publicBaseUrl = cfg.publicBaseUrl;
  HTTP_PORT_REF.value = cfg.port;
  getMovieCount = movieCount;

  // ---------- UDP 发现 ----------
  const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  udp.on('message', (_msg, rinfo) => {
    const reply = Buffer.from(
      JSON.stringify({
        service: 'family-video',
        tcpPort: LAN.tcpPort,
        udpPort: LAN.udpPort,
        publicBaseUrl: LAN.publicBaseUrl ?? null,
        lanUrls: lanAddresses(HTTP_PORT_REF.value),
      }),
    );
    udp.send(reply, rinfo.port, rinfo.address);
  });
  udp.on('error', (err) => console.warn('[lan] UDP 发现服务异常:', err.message));
  udp.bind(LAN.udpPort, '0.0.0.0', () => {
    udp.setBroadcast(true);
    console.log(`[lan] UDP 服务发现已启动 :${LAN.udpPort}`);
  });

  // ---------- TCP JSON-RPC ----------
  const tcp = net.createServer(attachConnection);
  tcp.on('error', (err) => console.warn('[lan] TCP 通信服务异常:', err.message));
  tcp.listen(LAN.tcpPort, '0.0.0.0', () => {
    console.log(`[lan] TCP 通信服务已启动 :${LAN.tcpPort}（微信小程序控制面通道）`);
  });
}
