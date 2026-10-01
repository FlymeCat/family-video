import { Progress, Tag, Tooltip } from 'antd';
import { PlayCircleFilled, StarFilled, StarOutlined } from '@ant-design/icons';
import type { Movie } from '../types';
import { formatSize, gradientFor } from '../utils/format';

export interface MovieCardProps {
  movie: Movie;
  /** 覆盖卡片显示的标题（剧集组传分组名，默认为文件名解析标题） */
  title?: string;
  /** 观看进度百分比 0-100，不传不显示 */
  progressPct?: number;
  favorite?: boolean;
  /** 右下角角标（如 "共12集"），覆盖默认的格式角标 */
  badge?: string;
  onClick: () => void;
  onToggleFavorite?: () => void;
}

/** 海报卡片：ffmpeg 有封面用封面图，否则渐变占位 + 首字母 */
export default function MovieCard({ movie, title, progressPct, favorite, badge, onClick, onToggleFavorite }: MovieCardProps) {
  const displayTitle = title ?? movie.title;
  const initial = displayTitle.slice(0, 1).toUpperCase();
  return (
    <div className="fv-card" style={{ borderRadius: 10, overflow: 'hidden', background: '#1f1f27' }} onClick={onClick}>
      <div style={{ position: 'relative', aspectRatio: '16 / 9' }}>
        {movie.thumb ? (
          <img
            src={movie.thumb}
            alt={movie.title}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              background: gradientFor(movie.id),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ fontSize: 56, fontWeight: 700, color: 'rgba(255,255,255,0.35)' }}>{initial}</span>
          </div>
        )}

        {/* 悬浮播放图标 */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.25)',
            opacity: 0,
            transition: 'opacity 0.2s',
          }}
          className="fv-card-mask"
        >
          <PlayCircleFilled style={{ fontSize: 48, color: '#fff' }} />
        </div>

        {/* 收藏按钮 */}
        {onToggleFavorite && (
          <span
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              cursor: 'pointer',
              fontSize: 18,
              color: favorite ? '#faad14' : '#fff',
              textShadow: '0 1px 3px rgba(0,0,0,0.6)',
              zIndex: 2,
            }}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite();
            }}
          >
            {favorite ? <StarFilled /> : <StarOutlined />}
          </span>
        )}

        {/* 格式/集数角标 */}
        <Tag
          style={{ position: 'absolute', left: 8, bottom: 8, margin: 0 }}
          color={badge ? '#e50914' : 'rgba(0,0,0,0.6)'}
        >
          {badge ?? movie.ext.toUpperCase()}
        </Tag>

        {/* 观看进度条 */}
        {typeof progressPct === 'number' && progressPct > 0 && (
          <Progress
            percent={progressPct}
            showInfo={false}
            size={['100%', 4]}
            strokeColor="#e50914"
            trailColor="rgba(255,255,255,0.25)"
            style={{ position: 'absolute', left: 0, right: 0, bottom: 4, margin: 0 }}
          />
        )}
      </div>

      <div style={{ padding: '10px 12px' }}>
        <Tooltip title={displayTitle}>
          <div
            style={{
              color: '#fff',
              fontSize: 14,
              fontWeight: 500,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {title
              ? title
              : movie.category === 'series' && movie.season != null && movie.episode != null
                ? `${movie.series ?? movie.title} S${String(movie.season).padStart(2, '0')}E${String(movie.episode).padStart(2, '0')}`
                : movie.title}
          </div>
        </Tooltip>
        <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, marginTop: 4 }}>
          {formatSize(movie.size)}
        </div>
      </div>
    </div>
  );
}
