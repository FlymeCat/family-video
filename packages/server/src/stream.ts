import { createReadStream, promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import type { Request, Response } from 'express';

/**
 * 支持 HTTP Range 的流式响应。
 * 浏览器拖动进度条 / 电视播放器seek 都依赖 206 分段响应。
 */
export async function streamRange(req: Request, res: Response, filePath: string, mime: string): Promise<void> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    res.status(404).json({ error: '文件不存在' });
    return;
  }
  const size = stat.size;
  const range = req.headers.range;

  res.setHeader('Content-Type', mime);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-cache');

  if (!range) {
    res.setHeader('Content-Length', String(size));
    res.status(200);
    createReadStream(filePath).pipe(res);
    return;
  }

  // 解析 Range: bytes=start-end（支持后缀范围 bytes=-N）
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  let start = m && m[1] ? parseInt(m[1], 10) : 0;
  let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
  if (m && !m[1] && m[2]) {
    // bytes=-N -> 最后 N 字节
    start = Math.max(0, size - parseInt(m[2], 10));
    end = size - 1;
  }
  if (Number.isNaN(start) || start < 0) start = 0;
  if (Number.isNaN(end) || end >= size) end = size - 1;

  if (start > end || start >= size) {
    res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
    return;
  }

  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  res.setHeader('Content-Length', String(end - start + 1));

  const stream = createReadStream(filePath, { start, end });
  // 客户端断开（切页/关电视）时销毁读流，防止 fd 泄漏
  req.on('close', () => stream.destroy());
  stream.pipe(res);
}

/**
 * 音频兼容模式流：电视/手机浏览器大多不支持 AC3/E-AC3/DTS 音轨（画面正常但无声）。
 * 用 ffmpeg 把音轨实时转成 AAC，**视频轨 copy 不转码**（几乎不耗 CPU，画质不变），
 * 输出 fragmented MP4 直播式流；seek 由 start 参数重建流实现。
 */
export function streamTranscodedAudio(
  req: Request,
  res: Response,
  filePath: string,
  start: number,
): void {
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Cache-Control', 'no-cache');

  const args = [
    // -ss 放在 -i 前：输入侧关键帧 seek，秒级定位
    '-ss', String(Math.max(0, start)),
    '-i', filePath,
    '-map', '0:v:0',
    '-map', '0:a:0?', // 无音轨时不报错
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k', '-ac', '2',
    '-avoid_negative_ts', 'make_zero',
    '-f', 'mp4',
    // empty_moov + 分片：免 moov 前置，流式立即可播
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    'pipe:1',
  ];
  const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'ignore'] });
  ff.stdout.pipe(res);
  ff.on('error', () => res.status(500).end());
  // 客户端断开时杀掉 ffmpeg，避免进程泄漏
  req.on('close', () => ff.kill('SIGKILL'));
  ff.on('close', (code) => {
    if (code !== 0 && code !== null && !res.headersSent) res.status(502).end();
    if (!res.writableEnded) res.end();
  });
}
