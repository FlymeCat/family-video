import { execFile } from 'node:child_process';
import type { Movie } from './types.js';

export interface MediaProbe {
  /** 总时长（秒），探测失败为 null */
  durationSec: number | null;
  /** 第一条音频流编码，如 aac / ac3 / eac3 / dts，无音轨为 null */
  audioCodec: string | null;
  /** 第一条视频流编码，如 h264 / hevc */
  videoCodec: string | null;
}

/** 缓存 key = 路径+大小（与封面签名同一策略，不依赖不稳定的 mtime） */
const cache = new Map<string, MediaProbe>();

/**
 * 用 ffmpeg -i 探测媒体流信息（环境无 ffprobe，-i 无输出文件时退出码为 1，
 * 但 stderr 会完整打印 Duration 与 Stream 信息，从中解析）。
 */
export async function probeMedia(movie: Movie): Promise<MediaProbe> {
  const key = `${movie.path}:${movie.size}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const probe: MediaProbe = await new Promise((resolve) => {
    execFile('ffmpeg', ['-i', movie.path], { timeout: 20000 }, (err, _stdout, stderr) => {
      if (err && !stderr) resolve({ durationSec: null, audioCodec: null, videoCodec: null });
      const dm = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(stderr);
      const durationSec = dm ? Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]) : null;
      // 行格式："Stream #0:1[0x2](kor): Audio: eac3, 48000 Hz, ..."，取第一个 Audio/Video 流编码
      const audio = /Audio:\s*([a-z0-9_]+)/.exec(stderr);
      const video = /Video:\s*([a-z0-9_]+)/.exec(stderr);
      resolve({
        durationSec,
        audioCodec: audio ? audio[1] : null,
        videoCodec: video ? video[1] : null,
      });
    });
  });

  cache.set(key, probe);
  return probe;
}
