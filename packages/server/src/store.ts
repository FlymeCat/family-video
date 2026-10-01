import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import type { Favorite, Progress } from './types.js';

const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');
const FAVORITES_FILE = path.join(DATA_DIR, 'favorites.json');

/** 简易 JSON 持久化 store：内存缓存 + 异步落盘（防抖） */
function createJsonStore<T>(file: string, initial: T) {
  let data: T = initial;
  let loaded = false;
  let timer: NodeJS.Timeout | null = null;

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    await fs.mkdir(DATA_DIR, { recursive: true });
    try {
      data = JSON.parse(await fs.readFile(file, 'utf8')) as T;
    } catch {
      data = initial;
    }
    loaded = true;
  }

  function persist(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8').catch(() => undefined);
    }, 300);
  }

  return {
    async read(): Promise<T> {
      await ensureLoaded();
      return data;
    },
    async write(next: T): Promise<T> {
      await ensureLoaded();
      data = next;
      persist();
      return data;
    },
    async update(fn: (cur: T) => T): Promise<T> {
      await ensureLoaded();
      data = fn(data);
      persist();
      return data;
    },
  };
}

/** key = `${deviceId}:${movieId}` */
const progressStore = createJsonStore<Record<string, Progress>>(PROGRESS_FILE, {});
const favoriteStore = createJsonStore<Record<string, Favorite>>(FAVORITES_FILE, {});

export const store = {
  /** 获取某设备的全部进度 */
  async getProgress(deviceId: string): Promise<Progress[]> {
    const all = await progressStore.read();
    return Object.values(all).filter((p) => p.deviceId === deviceId);
  },
  async setProgress(p: Progress): Promise<void> {
    await progressStore.update((all) => {
      all[`${p.deviceId}:${p.movieId}`] = p;
      return all;
    });
  },
  async removeProgress(deviceId: string, movieId: string): Promise<void> {
    await progressStore.update((all) => {
      delete all[`${deviceId}:${movieId}`];
      return all;
    });
  },
  /** 获取某设备的收藏 movieId 列表 */
  async getFavorites(deviceId: string): Promise<string[]> {
    const all = await favoriteStore.read();
    return Object.values(all)
      .filter((f) => f.deviceId === deviceId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((f) => f.movieId);
  },
  async toggleFavorite(deviceId: string, movieId: string): Promise<boolean> {
    const key = `${deviceId}:${movieId}`;
    let added = false;
    await favoriteStore.update((all) => {
      if (all[key]) {
        delete all[key];
        added = false;
      } else {
        all[key] = { movieId, deviceId, createdAt: Date.now() };
        added = true;
      }
      return all;
    });
    return added;
  },
  /** 批量设置收藏（整组收藏/取消，一次落盘） */
  async setFavorites(deviceId: string, movieIds: string[], favorite: boolean): Promise<void> {
    await favoriteStore.update((all) => {
      for (const movieId of movieIds) {
        const key = `${deviceId}:${movieId}`;
        if (favorite) {
          if (!all[key]) all[key] = { movieId, deviceId, createdAt: Date.now() };
        } else {
          delete all[key];
        }
      }
      return all;
    });
  },
};
