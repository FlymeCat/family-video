import axios from 'axios';
import { getDeviceId } from '../device';
import type { Movie, Progress, ServerConfig } from '../types';

// 首次扫描大目录（如 Windows 挂载盘）可能较慢，超时放宽到 60s
const http = axios.create({ baseURL: '/api', timeout: 60000 });

export const api = {
  async getMovies(keyword?: string, category?: string): Promise<Movie[]> {
    const { data } = await http.get('/movies', { params: { keyword, category } });
    return data.movies as Movie[];
  },

  async getMovie(id: string): Promise<Movie> {
    const { data } = await http.get(`/movies/${id}`);
    return data as Movie;
  },

  async refreshLibrary(): Promise<number> {
    const { data } = await http.post('/library/refresh');
    return data.total as number;
  },

  async getProgress(): Promise<Progress[]> {
    const { data } = await http.get('/progress', { params: { deviceId: getDeviceId() } });
    return data as Progress[];
  },

  async saveProgress(movieId: string, position: number, duration: number): Promise<void> {
    await http.post('/progress', { deviceId: getDeviceId(), movieId, position, duration });
  },

  async getFavorites(): Promise<string[]> {
    const { data } = await http.get('/favorites', { params: { deviceId: getDeviceId() } });
    return data as string[];
  },

  async toggleFavorite(movieId: string): Promise<boolean> {
    const { data } = await http.post('/favorites', { deviceId: getDeviceId(), movieId });
    return data.favorite as boolean;
  },

  /** 批量收藏/取消（连续剧整组操作，一次请求） */
  async setFavoritesBatch(movieIds: string[], favorite: boolean): Promise<void> {
    await http.post('/favorites/batch', { deviceId: getDeviceId(), movieIds, favorite });
  },

  async getConfig(): Promise<ServerConfig> {
    const { data } = await http.get('/config');
    return data as ServerConfig;
  },

  async updateConfig(mediaRoots: string[]): Promise<void> {
    await http.put('/config', { mediaRoots });
  },

  streamUrl: (id: string) => `/api/media/${id}/stream`,
  subtitleUrl: (id: string, track: number) => `/api/media/${id}/subtitle?track=${track}`,
};
