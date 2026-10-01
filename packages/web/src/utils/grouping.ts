import type { Movie } from '../types';

/** 合并后的展示组：一部电影 或 一部连续剧 */
export interface MovieGroup {
  key: string;
  title: string;
  /** 多集合并的连续剧（含同名多格式） */
  isSeries: boolean;
  /** 已按集数升序 */
  items: Movie[];
  /** 选作封面的影片（优先有缩略图的） */
  cover: Movie;
}

interface Parsed {
  /** 从名称解析出的集序号，无法解析为 null */
  ep: number | null;
  /** 分组键：去掉集号后的基础名（小写归一） */
  baseKey: string;
  /** 展示用基础名（保留原文大小写） */
  baseTitle: string;
}

/**
 * 解析集数与基础名，支持：
 * - 后端已识别的 S01E02 / 第x季第x集
 * - 前缀序号："1-名侦探柯南"、"01. 心理罪"、"2 狂飙"
 * - 后缀序号："乡村爱情 01"、"狂飙第5集"
 */
function parseMovie(m: Movie): Parsed {
  const rawTitle = m.fileName.replace(/\.[^.]+$/, '').replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();
  if (m.series && m.episode != null) {
    const base = m.series.trim();
    return { ep: m.episode, baseKey: base.toLowerCase(), baseTitle: base };
  }
  let mt = /^\s*0*(\d{1,3})\s*[-—、)）.。]?\s+(.+)$/.exec(rawTitle);
  if (mt && mt[2]) {
    const base = mt[2].trim();
    return { ep: Number(mt[1]), baseKey: base.toLowerCase(), baseTitle: base };
  }
  mt = /^(.+?[^\s\d])\s*(?:第)?\s*0*(\d{1,3})\s*(?:集|话|ep)?$/i.exec(rawTitle);
  if (mt && mt[1].trim()) {
    const base = mt[1].trim();
    return { ep: Number(mt[2]), baseKey: base.toLowerCase(), baseTitle: base };
  }
  return { ep: null, baseKey: rawTitle.toLowerCase(), baseTitle: rawTitle };
}

const dirOf = (m: Movie): string => {
  const i = m.relativePath.lastIndexOf('/');
  return i > 0 ? m.relativePath.slice(0, i) : '';
};

/** 标题瘦身：去掉【】【】等修饰段；过长时优先取开头中文段，否则截断 */
function cleanTitle(t: string): string {
  const s = t
    .replace(/[【\[（(][^】\]）)]*[】\]）)]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length <= 30) return s || t;
  const cjk = /^[^\x00-\x7f]{2,}/.exec(s);
  if (cjk) return cjk[0];
  return `${s.slice(0, 30)}…`;
}

function makeGroup(key: string, title: string, isSeries: boolean, items: Movie[]): MovieGroup {
  const cover = items.find((it) => it.thumb) ?? items[0];
  return { key, title, isSeries, items, cover };
}

/**
 * 合并规则：
 * 1. 同一目录内，去掉集号前/后缀后同名的文件合并（"1-xx"、"2-xx" → 连续剧）
 * 2. 同一目录下视频文件 ≥3 个时，整个目录合并为一部连续剧（目录名作为剧名）
 * 3. 合并组内按集数升序（1-xxxx 顺序），无集号的按文件名自然序
 */
export function groupMovies(movies: Movie[]): MovieGroup[] {
  const parsed = new Map<string, Parsed>();
  for (const m of movies) parsed.set(m.id, parseMovie(m));

  const sortItems = (items: Movie[]): Movie[] =>
    [...items].sort((a, b) => {
      const ea = parsed.get(a.id)!.ep ?? Number.MAX_SAFE_INTEGER;
      const eb = parsed.get(b.id)!.ep ?? Number.MAX_SAFE_INTEGER;
      if (ea !== eb) return ea - eb;
      return a.fileName.localeCompare(b.fileName, 'zh', { numeric: true });
    });

  // 按目录划分（根目录下的散文件共用一个空目录键）
  const dirMovies = new Map<string, Movie[]>();
  for (const m of movies) {
    const d = dirOf(m);
    const list = dirMovies.get(d);
    if (list) list.push(m);
    else dirMovies.set(d, [m]);
  }

  const groups: MovieGroup[] = [];
  for (const [dir, list] of dirMovies) {
    // 目录内按基础名分组
    const byKey = new Map<string, Movie[]>();
    for (const m of list) {
      const k = parsed.get(m.id)!.baseKey;
      const arr = byKey.get(k);
      if (arr) arr.push(m);
      else byKey.set(k, [m]);
    }
    const hasEpisodeGroup = [...byKey.values()].some((v) => v.length >= 2);
    // 用户规则：一个目录里超过 2 个媒体文件 → 视为连续剧目录
    const mergeWholeDir = dir !== '' && (list.length >= 3 || hasEpisodeGroup);

    if (mergeWholeDir) {
      const all = sortItems(list);
      const keys = [...byKey.keys()];
      const dirName = dir.split('/').pop() ?? dir;
      const baseName = keys.length === 1 ? parsed.get(byKey.get(keys[0])![0].id)!.baseTitle : '';
      // 基础名是纯英文而目录名含中文（如中文名+英文文件名）时，优先用目录名
      const preferDir =
        baseName !== '' && /^[\x00-\x7f]+$/.test(baseName) && /[^\x00-\x7f]/.test(dirName);
      const raw = !baseName || preferDir ? dirName : baseName;
      groups.push(makeGroup(`dir::${dir}`, cleanTitle(raw), true, all));
    } else {
      for (const [key, items] of byKey) {
        const ordered = sortItems(items);
        const isSeries = items.length >= 2;
        groups.push(makeGroup(`${dir}|${key}`, cleanTitle(parsed.get(ordered[0].id)!.baseTitle), isSeries, ordered));
      }
    }
  }

  groups.sort((a, b) => a.title.localeCompare(b.title, 'zh'));
  return groups;
}
