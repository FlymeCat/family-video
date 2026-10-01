import { createReadStream, promises as fs } from 'node:fs';
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
