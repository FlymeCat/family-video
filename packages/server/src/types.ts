/** 共享类型定义 */

/** 一条影片记录（由扫描媒体目录生成） */
export interface Movie {
  /** 文件绝对路径的 hash，作为唯一 id */
  id: string;
  /** 展示标题（文件名去扩展名，尽力解析季/集） */
  title: string;
  /** 文件名（原始） */
  fileName: string;
  /** 绝对路径 */
  path: string;
  /** 相对媒体根目录的路径 */
  relativePath: string;
  /** 所属媒体根目录 */
  root: string;
  /** 扩展名（不含点），如 mp4 */
  ext: string;
  /** MIME 类型 */
  mime: string;
  /** 文件大小（字节） */
  size: number;
  /** 修改时间（毫秒） */
  mtime: number;
  /** 分类：movie / series */
  category: 'movie' | 'series';
  /** 剧集名（当能解析出季/集时） */
  series?: string;
  season?: number;
  episode?: number;
  /** 同名字幕文件列表 */
  subtitles: SubtitleTrack[];
  /** 封面缩略图 URL（ffmpeg 可用时），否则 null */
  thumb: string | null;
}

/** 字幕轨道 */
export interface SubtitleTrack {
  /** 相对影片的 lang/index 标识 */
  label: string;
  /** 语言提示（从文件名解析，如 chi/eng） */
  lang: string;
  /** 绝对路径 */
  path: string;
  /** 扩展名 srt / ass / ssa / vtt */
  ext: string;
}

/** 观看进度 */
export interface Progress {
  movieId: string;
  deviceId: string;
  /** 当前播放秒 */
  position: number;
  /** 总时长秒 */
  duration: number;
  updatedAt: number;
}

/** 收藏记录 */
export interface Favorite {
  movieId: string;
  deviceId: string;
  createdAt: number;
}

/** 局域网通信（微信小程序 TCP Socket 通道）配置 */
export interface LanConfig {
  /** UDP 服务发现端口 */
  udpPort: number;
  /** TCP JSON-RPC 通信端口 */
  tcpPort: number;
}

/** 服务端配置 */
export interface AppConfig {
  /** 媒体根目录（绝对路径）列表 */
  mediaRoots: string[];
  port: number;
  /** 局域网通信层端口配置 */
  lan: LanConfig;
  /**
   * 对外 HTTPS 基础地址（微信小程序 <video> 播放用，必须已备案域名）。
   * 留空时小程序无法在发布版播放视频，仅可浏览。
   */
  publicBaseUrl?: string;
}
