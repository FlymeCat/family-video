import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dropdown, Slider, Spin, Tooltip, Typography, App } from 'antd';
import {
  ArrowLeftOutlined,
  AudioOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  GlobalOutlined,
  LoadingOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  StarFilled,
  StarOutlined,
  ReadOutlined,
  MutedOutlined,
  SoundOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { MediaProbe, Movie } from '../types';
import { formatTime } from '../utils/format';

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
/** 进度上报间隔（毫秒） */
const REPORT_INTERVAL = 5000;
/** 浏览器普遍原生支持、无需转码的音频编码 */
const NATIVE_AUDIO = new Set(['aac', 'mp3']);

/** 进入全屏（兼容各内核前缀与 iOS 视频原生全屏） */
function requestFull(el: HTMLElement, video?: HTMLVideoElement | null): void {
  const anyEl = el as HTMLElement & {
    webkitRequestFullscreen?: () => void;
    msRequestFullscreen?: () => void;
  };
  if (el.requestFullscreen) void el.requestFullscreen().catch(() => useVideoFs(video));
  else if (anyEl.webkitRequestFullscreen) anyEl.webkitRequestFullscreen();
  else if (anyEl.msRequestFullscreen) void anyEl.msRequestFullscreen();
  else useVideoFs(video);
}
// iOS Safari 只支持视频元素自身全屏
function useVideoFs(video?: HTMLVideoElement | null): void {
  const v = video as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
  if (v?.webkitEnterFullscreen) v.webkitEnterFullscreen();
  else v?.requestFullscreen?.().catch(() => undefined);
}
function exitFull(): void {
  const d = document as Document & {
    webkitFullscreenElement?: Element;
    webkitExitFullscreen?: () => void;
  };
  if (d.fullscreenElement && d.exitFullscreen) void d.exitFullscreen();
  else if (d.webkitFullscreenElement && d.webkitExitFullscreen) d.webkitExitFullscreen();
  else {
    const v = document.querySelector('video') as (HTMLVideoElement & { webkitExitFullscreen?: () => void }) | null;
    v?.webkitExitFullscreen?.();
  }
}
function isFullscreen(): boolean {
  const d = document as Document & { webkitFullscreenElement?: Element };
  return Boolean(d.fullscreenElement || d.webkitFullscreenElement);
}

export default function Player() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastReportRef = useRef(0);
  /** 普通模式下待恢复的绝对播放位置（seek） */
  const pendingSeekRef = useRef<number | null>(null);
  /** 兼容模式：当前应自动续播 */
  const wantPlayRef = useRef(true);

  const [movie, setMovie] = useState<Movie | null>(null);
  const [probe, setProbe] = useState<MediaProbe | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [subtitleTrack, setSubtitleTrack] = useState(-1);
  const [favorite, setFavorite] = useState(false);
  /** 音频兼容模式：视频不转码、音轨转 AAC */
  const [audioCompat, setAudioCompat] = useState(false);
  /** 兼容模式流的起播偏移（秒），seek 靠带 start 重建流实现 */
  const [streamStart, setStreamStart] = useState(0);
  /** 拖动进度条时的预览位置（绝对秒） */
  const [previewTime, setPreviewTime] = useState<number | null>(null);

  // ---------- 加载影片、探测编码与断点 ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [m, favorites, progressList, pr] = await Promise.all([
          api.getMovie(id),
          api.getFavorites(),
          api.getProgress(),
          api.getProbe(id).catch(() => null),
        ]);
        if (cancelled) return;
        setMovie(m);
        setProbe(pr);
        setFavorite(favorites.includes(m.id));

        // 音轨编码浏览器不原生支持（AC3/E-AC3/DTS 等）→ 自动开启兼容模式（电视/手机有声）
        const needCompat = !!pr?.audioCodec && !NATIVE_AUDIO.has(pr.audioCodec);

        const p = progressList.find((x) => x.movieId === m.id);
        const resuming = p && p.duration > 0 && p.position > 5 && p.position < p.duration - 30;
        wantPlayRef.current = true;
        if (needCompat) {
          setAudioCompat(true);
          setStreamStart(resuming ? Math.floor(p!.position) : 0);
          message.info('该影片音轨格式兼容性较低，已开启音频兼容模式');
        } else if (resuming) {
          pendingSeekRef.current = p!.position;
        }
      } catch {
        if (!cancelled) setNotFound(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, message]);

  // ---------- 进度上报 ----------
  /** 当前绝对位置（秒）：兼容模式 = 流偏移 + 流内时间 */
  const absoluteTime = useCallback(
    (relTime: number) => (audioCompat ? streamStart + relTime : relTime),
    [audioCompat, streamStart],
  );

  const reportProgress = useCallback(() => {
    const v = videoRef.current;
    if (!v || !movie || v.paused) return;
    const total = audioCompat ? probe?.durationSec ?? 0 : v.duration || 0;
    if (!total) return;
    const now = Date.now();
    if (now - lastReportRef.current < REPORT_INTERVAL) return;
    lastReportRef.current = now;
    void api.saveProgress(movie.id, absoluteTime(v.currentTime), total).catch(() => undefined);
  }, [movie, audioCompat, probe, absoluteTime]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      setCurrentTime(v.currentTime);
      reportProgress();
    };
    const onLoaded = () => {
      setDuration(audioCompat ? probe?.durationSec ?? 0 : v.duration || 0);
      if (pendingSeekRef.current != null && !audioCompat) {
        v.currentTime = pendingSeekRef.current;
        pendingSeekRef.current = null;
      }
      if (wantPlayRef.current) void v.play().catch(() => setPlaying(false));
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => {
      setPlaying(false);
      const total = audioCompat ? probe?.durationSec ?? 0 : v.duration || 0;
      const now = Date.now();
      if (movie && total && now - lastReportRef.current > 1000) {
        lastReportRef.current = now;
        void api.saveProgress(movie.id, absoluteTime(v.currentTime), total).catch(() => undefined);
      }
    };
    const onBuffer = () => {
      if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1));
    };
    const onEnded = () => {
      const total = audioCompat ? probe?.durationSec ?? 0 : v.duration || 0;
      if (movie && total) void api.saveProgress(movie.id, total, total).catch(() => undefined);
    };
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('loadedmetadata', onLoaded);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('progress', onBuffer);
    v.addEventListener('ended', onEnded);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('loadedmetadata', onLoaded);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('progress', onBuffer);
      v.removeEventListener('ended', onEnded);
    };
  }, [movie, audioCompat, probe, absoluteTime, reportProgress]);

  // ---------- 全屏（含 webkit 前缀事件） ----------
  useEffect(() => {
    const onChange = () => setFullscreen(isFullscreen());
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange as EventListener);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange as EventListener);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    wantPlayRef.current = v.paused;
    if (v.paused) void v.play();
    else v.pause();
  }, []);

  const seekBy = useCallback(
    (delta: number) => {
      const v = videoRef.current;
      if (!v) return;
      const total = audioCompat ? probe?.durationSec ?? 0 : v.duration || 0;
      const target = Math.min(Math.max(0, absoluteTime(v.currentTime) + delta), total || absoluteTime(v.currentTime));
      if (audioCompat) setStreamStart(Math.floor(target));
      else v.currentTime = target;
    },
    [audioCompat, probe, absoluteTime],
  );

  const toggleFullscreen = useCallback(() => {
    if (isFullscreen()) exitFull();
    else if (containerRef.current) requestFull(containerRef.current, videoRef.current);
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  /** 手动切换音频兼容模式，尽量保持当前位置 */
  const toggleAudioCompat = useCallback(() => {
    const v = videoRef.current;
    const at = v ? absoluteTime(v.currentTime) : 0;
    const next = !audioCompat;
    wantPlayRef.current = true;
    if (next) {
      setStreamStart(Math.floor(at));
      setAudioCompat(true);
      message.success('已开启音频兼容模式（视频不转码，仅音轨转 AAC）');
    } else {
      pendingSeekRef.current = at;
      setAudioCompat(false);
      message.info('已切换回原始音轨（原生流式播放）');
    }
  }, [audioCompat, absoluteTime, message]);

  // ---------- 键盘快捷键：空格播放、左右 ±10s、上下音量、F 全屏、M 静音 ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const v = videoRef.current;
      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          seekBy(-10);
          break;
        case 'ArrowRight':
          seekBy(10);
          break;
        case 'ArrowUp':
          if (v) {
            v.volume = Math.min(1, v.volume + 0.05);
            setVolume(v.volume);
          }
          break;
        case 'ArrowDown':
          if (v) {
            v.volume = Math.max(0, v.volume - 0.05);
            setVolume(v.volume);
          }
          break;
        case 'f':
        case 'F':
          toggleFullscreen();
          break;
        case 'm':
        case 'M':
          toggleMute();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, seekBy, toggleFullscreen, toggleMute]);

  // ---------- 控制条自动隐藏 ----------
  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setControlsVisible(false);
    }, 3500);
  }, []);

  const toggleFavoriteNow = useCallback(async () => {
    if (!movie) return;
    const added = await api.toggleFavorite(movie.id);
    setFavorite(added);
    message.success(added ? '已收藏' : '已取消收藏');
  }, [movie, message]);

  const volumeIcon = useMemo(() => {
    if (muted || volume === 0) return <MutedOutlined />;
    return <SoundOutlined />;
  }, [muted, volume]);

  /** 进度条显示位置（绝对秒） */
  const displayTime = previewTime ?? absoluteTime(currentTime);
  const bufferedAbs = audioCompat ? streamStart + buffered : buffered;
  const bufferedPct = duration > 0 ? Math.min(100, (bufferedAbs / duration) * 100) : 0;
  // 暂停时强制显示控制层，避免自动隐藏后点击穿透到视频误触发播放
  const controlsShown = controlsVisible || !playing;

  const videoSrc = useMemo(() => {
    if (!movie) return undefined;
    return audioCompat ? api.transcodeStreamUrl(movie.id, streamStart) : api.streamUrl(movie.id);
  }, [movie, audioCompat, streamStart]);

  if (notFound) {
    return (
      <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <Typography.Text style={{ color: '#fff' }}>影片不存在或已被删除</Typography.Text>
        <Button onClick={() => navigate('/library')}>返回媒体库</Button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100vw', height: '100dvh', background: '#000', overflow: 'hidden' }}
      onMouseMove={showControls}
      onTouchStart={showControls}
    >
      {!movie ? (
        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spin indicator={<LoadingOutlined style={{ fontSize: 40 }} spin />} />
        </div>
      ) : (
        <>
          <video
            ref={videoRef}
            src={videoSrc}
            poster={movie.thumb ?? undefined}
            playsInline
            preload="metadata"
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            onClick={togglePlay}
            onDoubleClick={toggleFullscreen}
          >
            {subtitleTrack >= 0 && movie.subtitles[subtitleTrack] && (
              <track
                kind="subtitles"
                srcLang={movie.subtitles[subtitleTrack].lang || 'zh'}
                label={movie.subtitles[subtitleTrack].label}
                src={api.subtitleUrl(movie.id, subtitleTrack)}
                default
              />
            )}
          </video>

          {/* 顶部栏 */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              padding: '12px 20px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              background: 'linear-gradient(rgba(0,0,0,0.7), transparent)',
              opacity: controlsShown ? 1 : 0,
              transition: 'opacity 0.3s',
              pointerEvents: controlsShown ? 'auto' : 'none',
            }}
          >
            <Button type="text" icon={<ArrowLeftOutlined />} style={{ color: '#fff' }} onClick={() => navigate(-1)} />
            <Typography.Text ellipsis style={{ color: '#fff', fontSize: 16, maxWidth: '70vw' }}>
              {movie.title}
            </Typography.Text>
            <Button
              type="text"
              style={{ marginLeft: 'auto', color: favorite ? '#faad14' : '#fff' }}
              icon={favorite ? <StarFilled /> : <StarOutlined />}
              onClick={() => void toggleFavoriteNow()}
            />
          </div>

          {/* 中央播放/暂停大按钮（暂停时显示） */}
          {!playing && (
            <div
              style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}
            >
              <PlayCircleOutlined style={{ fontSize: 80, color: 'rgba(255,255,255,0.85)' }} />
            </div>
          )}

          {/* 底部控制条 */}
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              padding: '8px 20px 14px',
              background: 'linear-gradient(transparent, rgba(0,0,0,0.75))',
              opacity: controlsShown ? 1 : 0,
              transition: 'opacity 0.3s',
              pointerEvents: controlsShown ? 'auto' : 'none',
            }}
          >
            {/* 进度条（带缓冲背景） */}
            <div style={{ position: 'relative' }}>
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: '50%',
                  height: 4,
                  transform: 'translateY(-50%)',
                  borderRadius: 2,
                  background: 'rgba(255,255,255,0.2)',
                  pointerEvents: 'none',
                }}
              >
                <div style={{ width: `${bufferedPct}%`, height: '100%', background: 'rgba(255,255,255,0.35)', borderRadius: 2 }} />
              </div>
              <Slider
                className="fv-slider"
                min={0}
                max={duration || 0}
                step={0.1}
                value={Math.min(displayTime, duration || 0)}
                tooltip={{ formatter: (v) => formatTime(Number(v)) }}
                onChange={(v) => setPreviewTime(v)}
                onAfterChange={(v) => {
                  const el = videoRef.current;
                  if (audioCompat) setStreamStart(Math.floor(v));
                  else if (el) el.currentTime = v;
                  setPreviewTime(null);
                }}
                style={{ position: 'relative' }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <Tooltip title="播放/暂停 (空格)">
                <Button type="text" style={{ color: '#fff', fontSize: 22 }} icon={playing ? <PauseCircleOutlined /> : <PlayCircleOutlined />} onClick={togglePlay} />
              </Tooltip>

              <Typography.Text style={{ color: '#fff', fontSize: 13, whiteSpace: 'nowrap' }}>
                {formatTime(displayTime)} / {formatTime(duration)}
              </Typography.Text>

              <Tooltip title="静音 (M)">
                <Button type="text" style={{ color: '#fff' }} icon={volumeIcon} onClick={toggleMute} />
              </Tooltip>
              <Slider
                className="fv-slider"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(v) => {
                  const el = videoRef.current;
                  if (el) {
                    el.volume = v;
                    el.muted = v === 0;
                    setVolume(v);
                    setMuted(v === 0);
                  }
                }}
                style={{ width: 90 }}
              />

              {/* 倍速 */}
              <Dropdown
                menu={{
                  items: PLAYBACK_RATES.map((r) => ({
                    key: String(r),
                    label: `${r}x`,
                    onClick: () => {
                      const el = videoRef.current;
                      if (el) {
                        el.playbackRate = r;
                        setRate(r);
                      }
                    },
                  })),
                }}
              >
                <Button type="text" style={{ color: '#fff' }}>
                  {rate}x
                </Button>
              </Dropdown>

              {/* 字幕选择 */}
              {movie.subtitles.length > 0 && (
                <Dropdown
                  menu={{
                    items: [
                      { key: '-1', label: '关闭字幕', onClick: () => setSubtitleTrack(-1) },
                      ...movie.subtitles.map((s, i) => ({
                        key: String(i),
                        label: s.lang ? `${s.label} (${s.lang})` : s.label,
                        onClick: () => setSubtitleTrack(i),
                      })),
                    ],
                  }}
                >
                  <Tooltip title="字幕">
                    <Button type="text" style={{ color: subtitleTrack >= 0 ? '#e50914' : '#fff' }} icon={<ReadOutlined />} />
                  </Tooltip>
                </Dropdown>
              )}

              {/* 音频模式切换（音轨编码不兼容时尤其有用） */}
              <Tooltip title={audioCompat ? '当前：音频兼容模式（AAC）' : '当前：原始音轨直传'}>
                <Button
                  type="text"
                  style={{ color: audioCompat ? '#e50914' : '#fff' }}
                  icon={audioCompat ? <GlobalOutlined /> : <AudioOutlined />}
                  onClick={toggleAudioCompat}
                >
                  {audioCompat ? '兼容音' : '原音轨'}
                </Button>
              </Tooltip>

              <div style={{ flex: 1 }} />

              <Tooltip title="全屏 (F)">
                <Button
                  type="text"
                  style={{ color: '#fff', fontSize: 18 }}
                  icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                  onClick={toggleFullscreen}
                />
              </Tooltip>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
