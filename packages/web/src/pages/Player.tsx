import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dropdown, Slider, Spin, Tooltip, Typography, App } from 'antd';
import {
  ArrowLeftOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
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
import type { Movie } from '../types';
import { formatTime } from '../utils/format';

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
/** 进度上报间隔（毫秒） */
const REPORT_INTERVAL = 5000;

export default function Player() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastReportRef = useRef(0);

  const [movie, setMovie] = useState<Movie | null>(null);
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
  /** -1 关闭；0..n 字幕轨道索引 */
  const [subtitleTrack, setSubtitleTrack] = useState(-1);
  const [favorite, setFavorite] = useState(false);

  // ---------- 加载影片与断点 ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [m, favorites, progressList] = await Promise.all([
          api.getMovie(id),
          api.getFavorites(),
          api.getProgress(),
        ]);
        if (cancelled) return;
        setMovie(m);
        setFavorite(favorites.includes(m.id));
        const p = progressList.find((x) => x.movieId === m.id);
        // 断点续播：跳过开头，距结尾 30 秒内视为看完
        if (p && p.duration > 0 && p.position > 5 && p.position < p.duration - 30) {
          const v = videoRef.current;
          if (v) {
            const seek = (e: Event) => {
              (e.target as HTMLVideoElement).currentTime = p.position;
              v.removeEventListener('loadedmetadata', seek);
            };
            v.addEventListener('loadedmetadata', seek);
          }
        }
      } catch {
        if (!cancelled) setNotFound(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // ---------- 进度上报 ----------
  const reportProgress = useCallback(() => {
    const v = videoRef.current;
    if (!v || !movie || v.paused || !v.duration || Number.isNaN(v.duration)) return;
    const now = Date.now();
    if (now - lastReportRef.current < REPORT_INTERVAL) return;
    lastReportRef.current = now;
    void api.saveProgress(movie.id, v.currentTime, v.duration).catch(() => undefined);
  }, [movie]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      setCurrentTime(v.currentTime);
      reportProgress();
    };
    const onLoaded = () => {
      setDuration(v.duration || 0);
      void v.play().catch(() => setPlaying(false));
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => {
      setPlaying(false);
      // 暂停时立即上报一次
      const now = Date.now();
      if (movie && now - lastReportRef.current > 1000 && v.duration) {
        lastReportRef.current = now;
        void api.saveProgress(movie.id, v.currentTime, v.duration).catch(() => undefined);
      }
    };
    const onBuffer = () => {
      if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1));
    };
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('loadedmetadata', onLoaded);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('progress', onBuffer);
    const onEnded = () => {
      if (movie && v.duration) void api.saveProgress(movie.id, v.duration, v.duration).catch(() => undefined);
    };
    v.addEventListener('ended', onEnded);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('loadedmetadata', onLoaded);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('progress', onBuffer);
      v.removeEventListener('ended', onEnded);
    };
  }, [movie, reportProgress]);

  // ---------- 全屏 ----------
  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }, []);

  const seekBy = useCallback((delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.min(Math.max(0, v.currentTime + delta), v.duration || 0);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void containerRef.current?.requestFullscreen();
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

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

  if (notFound) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <Typography.Text style={{ color: '#fff' }}>影片不存在或已被删除</Typography.Text>
        <Button onClick={() => navigate('/library')}>返回媒体库</Button>
      </div>
    );
  }

  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;
  // 暂停时强制显示控制层，避免自动隐藏后点击穿透到视频误触发播放
  const controlsShown = controlsVisible || !playing;

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100vw', height: '100vh', background: '#000', overflow: 'hidden' }}
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
            src={api.streamUrl(movie.id)}
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
                value={currentTime}
                tooltip={{ formatter: (v) => formatTime(Number(v)) }}
                onChange={(v) => {
                  const el = videoRef.current;
                  if (el) {
                    el.currentTime = v;
                    setCurrentTime(v);
                  }
                }}
                style={{ position: 'relative' }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <Tooltip title="播放/暂停 (空格)">
                <Button type="text" style={{ color: '#fff', fontSize: 22 }} icon={playing ? <PauseCircleOutlined /> : <PlayCircleOutlined />} onClick={togglePlay} />
              </Tooltip>

              <Typography.Text style={{ color: '#fff', fontSize: 13, whiteSpace: 'nowrap' }}>
                {formatTime(currentTime)} / {formatTime(duration)}
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
                    selected: r === rate,
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
                      {
                        key: '-1',
                        label: '关闭字幕',
                        onClick: () => setSubtitleTrack(-1),
                      },
                      ...movie.subtitles.map((s, i) => ({
                        key: String(i),
                        label: s.lang ? `${s.label} (${s.lang})` : s.label,
                        onClick: () => setSubtitleTrack(i),
                      })),
                    ],
                  }}
                >
                  <Tooltip title="字幕">
                    <Button
                      type="text"
                      style={{ color: subtitleTrack >= 0 ? '#e50914' : '#fff' }}
                      icon={<ReadOutlined />}
                    />
                  </Tooltip>
                </Dropdown>
              )}

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
