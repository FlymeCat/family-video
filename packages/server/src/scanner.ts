import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Movie, SubtitleTrack } from './types.js';

/** 支持的视频扩展名 */
const VIDEO_EXTS = new Set(['mp4', 'mkv', 'mov', 'avi', 'webm', 'ts', 'm2ts', 'mpg', 'mpeg', 'flv', 'wmv']);
/** 支持的字幕扩展名 */
const SUB_EXTS = new Set(['srt', 'ass', 'ssa', 'vtt']);

const MIME_MAP: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  webm: 'video/webm',
  ts: 'video/mp2t',
  m2ts: 'video/mp2t',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  flv: 'video/x-flv',
  wmv: 'video/x-ms-wmv',
};

export function hashId(absolutePath: string): string {
  return crypto.createHash('md5').update(absolutePath).digest('hex').slice(0, 16);
}

/** 从文件名解析季/集：支持 S01E02 / 第x季第x集 / 1x02 等常见写法 */
const SERIES_PATTERNS: RegExp[] = [
  /(?:season|季)[\s._-]*(\d+)[\s._-]*(?:episode|集|话|篇)[\s._-]*(\d+)/i,
  /[Ss](\d{1,2})[\s._-]*[Ee](\d{1,3})/,
  /(\d{1,2})x(\d{2,3})/,
  /第(\d+)季\s*第(\d+)[集话篇]/,
];

/** 纯集数（无季）：EP08 / 第8集 / E08 */
const EPISODE_ONLY = /(?:^|[\s._-])(?:EP?|第)\s*(\d{1,3})\s*(?:集|话|篇|$|[.\s_-])/i;

interface ParsedName {
  title: string;
  series?: string;
  season?: number;
  episode?: number;
}

function parseFileName(fileName: string): ParsedName {
  const base = fileName.replace(/\.[^.]+$/, '').trim();
  for (const re of SERIES_PATTERNS) {
    const m = base.match(re);
    if (m) {
      const season = Number(m[1]);
      const episode = Number(m[2]);
      // 剧集名 = 匹配起点之前的部分
      const seriesName = base.slice(0, m.index).replace(/[._[\]-]+/g, ' ').trim();
      return {
        title: base.replace(/[._]+/g, ' ').trim(),
        series: seriesName || base,
        season,
        episode,
      };
    }
  }
  const em = base.match(EPISODE_ONLY);
  if (em && /\d/.test(em[1])) {
    const episode = Number(em[1]);
    const seriesName = base.slice(0, em.index).replace(/[._[\]-]+/g, ' ').trim();
    if (seriesName) {
      return { title: base.replace(/[._]+/g, ' ').trim(), series: seriesName, season: 1, episode };
    }
  }
  return { title: base.replace(/[._]+/g, ' ').trim() };
}

/** 从字幕文件名猜语言 */
function guessLang(fileName: string): string {
  const n = fileName.toLowerCase();
  if (/(chi|zhs|zht|chs|cht|中文|国配|简|繁)/.test(n)) return '中文';
  if (/(eng|英文|日语|jap)/.test(n)) return 'EN';
  if (/kor|韩语/.test(n)) return 'KO';
  return '';
}

async function statOrNull(p: string): Promise<import('node:fs').Stats | null> {
  try {
    return await fs.stat(p);
  } catch {
    return null;
  }
}

/** 从已读出的目录条目中查找同名字幕（避免对同一目录重复 readdir，慢盘上收益明显） */
function findSubtitlesFromEntries(dir: string, videoName: string, entries: import('node:fs').Dirent[]): SubtitleTrack[] {
  const vDot = videoName.lastIndexOf('.');
  const stem = vDot > 0 ? videoName.slice(0, vDot) : videoName;
  const tracks: SubtitleTrack[] = [];
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const name = ent.name;
    const dot = name.lastIndexOf('.');
    if (dot <= 0) continue;
    const ext = name.slice(dot + 1).toLowerCase();
    if (!SUB_EXTS.has(ext)) continue;
    const nameStem = name.slice(0, dot);
    // 同名 或 以视频名开头（如 movie.chs.srt）
    if (nameStem === stem || nameStem.startsWith(stem + '.')) {
      const label = nameStem.slice(stem.length).replace(/^[._-]+/, '').replace(/[._-]+/g, ' ') || '默认';
      tracks.push({ label, lang: guessLang(name), path: path.join(dir, name), ext });
    }
  }
  return tracks.sort((a, b) => a.label.localeCompare(b.label));
}

/** 限并发的遍历：慢盘（DrvFs/网络盘）上并发 stat 过高会零星失败导致丢文件 */
async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

/** 扫描单个目录：readdir 只读一次，文件限并发 stat，递归下子目录 */
async function scanDir(root: string, dir: string, out: Movie[]): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const subDirs: string[] = [];
  await mapLimit(entries, 8, async (ent) => {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!ent.name.startsWith('.')) subDirs.push(full);
      return;
    }
    if (!ent.isFile()) return;
    const ext = ent.name.slice(ent.name.lastIndexOf('.') + 1).toLowerCase();
    if (!VIDEO_EXTS.has(ext)) return;
    const st = await statOrNull(full);
    if (!st) return;
    // 过滤超小"视频"：下载站广告占位片、UI 动画素材等，不是真实影片
    if (st.size < 1_000_000) return;
    const parsed = parseFileName(ent.name);
    const subtitles = findSubtitlesFromEntries(dir, ent.name, entries);
    out.push({
      id: hashId(full),
      title: parsed.title,
      fileName: ent.name,
      path: full,
      relativePath: path.relative(root, full),
      root,
      ext,
      mime: MIME_MAP[ext] ?? 'application/octet-stream',
      size: st.size,
      mtime: st.mtimeMs,
      category: parsed.series ? 'series' : 'movie',
      series: parsed.series,
      season: parsed.season,
      episode: parsed.episode,
      subtitles,
      thumb: null, // 由 thumbnails 模块填充
    });
  });
  // 串行递归子目录，避免对慢盘并发度过高
  for (const sub of subDirs) {
    await scanDir(root, sub, out);
  }
}

export interface ScanResult {
  movies: Movie[];
  /** key=movieId, value=文件签名（size:mtime），用于增量刷新 */
  fingerprints: Record<string, string>;
}

/** 扫描所有媒体根目录 */
export async function scanAll(roots: string[]): Promise<ScanResult> {
  const movies: Movie[] = [];
  for (const root of roots) {
    const st = await statOrNull(root);
    if (!st || !st.isDirectory()) continue;
    await scanDir(root, root, movies);
  }
  movies.sort((a, b) => a.title.localeCompare(b.title, 'zh'));
  const fingerprints: Record<string, string> = {};
  // 只用 size 不用 mtime：Windows 挂载盘(DrvFs)/网络盘 mtime 读数不稳定，
  // 含 mtime 会导致每次扫描都被判定为"有变化"而全量重处理
  for (const m of movies) fingerprints[m.id] = String(m.size);
  return { movies, fingerprints };
}
