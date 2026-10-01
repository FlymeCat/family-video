import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Movie, Progress } from '../types';

export interface LibraryData {
  movies: Movie[];
  progressMap: Map<string, Progress>;
  favorites: Set<string>;
  loading: boolean;
  toggleFavorite: (id: string) => Promise<void>;
  /** 整组收藏切换：组内有未收藏的集就全部收藏，否则全部取消 */
  toggleGroupFavorite: (ids: string[]) => Promise<void>;
  reload: () => Promise<void>;
}

/** 加载全部影片 + 本设备进度 + 收藏，供各页面复用 */
export function useLibraryData(): LibraryData {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [progressMap, setProgressMap] = useState<Map<string, Progress>>(new Map());
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [ms, ps, fs_] = await Promise.all([api.getMovies(), api.getProgress(), api.getFavorites()]);
      setMovies(ms);
      setProgressMap(new Map(ps.map((p) => [p.movieId, p])));
      setFavorites(new Set(fs_));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const toggleFavorite = useCallback(async (id: string) => {
    const added = await api.toggleFavorite(id);
    setFavorites((prev) => {
      const next = new Set(prev);
      if (added) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggleGroupFavorite = useCallback(
    async (ids: string[]) => {
      const anyUnfav = ids.some((id) => !favorites.has(id));
      await api.setFavoritesBatch(ids, anyUnfav);
      setFavorites((prev) => {
        const next = new Set(prev);
        for (const id of ids) {
          if (anyUnfav) next.add(id);
          else next.delete(id);
        }
        return next;
      });
    },
    [favorites],
  );

  return { movies, progressMap, favorites, loading, toggleFavorite, toggleGroupFavorite, reload };
}

/** 进度百分比（看完 >97% 视为结束） */
export function progressPctOf(p?: Progress): number | undefined {
  if (!p || !p.duration || p.duration <= 0) return undefined;
  return Math.min(100, Math.round((p.position / p.duration) * 100));
}
