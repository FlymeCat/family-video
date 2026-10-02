/** 与后端共享的前端类型（与 packages/server/src/types.ts 对应） */

export interface SubtitleTrack {
  label: string;
  lang: string;
  ext: string;
}

export interface Movie {
  id: string;
  title: string;
  fileName: string;
  relativePath: string;
  ext: string;
  mime: string;
  size: number;
  mtime: number;
  category: 'movie' | 'series';
  series?: string;
  season?: number;
  episode?: number;
  subtitles: SubtitleTrack[];
  thumb: string | null;
}

export interface Progress {
  movieId: string;
  deviceId: string;
  position: number;
  duration: number;
  updatedAt: number;
}

/** 后端 ffmpeg 探测结果 */
export interface MediaProbe {
  durationSec: number | null;
  audioCodec: string | null;
  videoCodec: string | null;
}

export interface ServerConfig {
  mediaRoots: string[];
  port: number;
  lanUrls: string[];
  movieCount: number;
  lastScan: number;
}
