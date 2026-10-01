import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Col, Empty, Input, Pagination, Row, Segmented, Spin, Tag, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useLibraryData } from '../hooks/useLibraryData';
import { api } from '../api/client';
import MovieCard from '../components/MovieCard';
import EpisodeDrawer from '../components/EpisodeDrawer';
import { groupMovies, type MovieGroup } from '../utils/grouping';
import type { Progress } from '../types';

const REFRESHABLE = 6000;

type CategoryFilter = 'all' | 'movie' | 'series';

/** 组内进度最高的那一集的进度作为整组进度 */
function groupProgress(g: MovieGroup, progressMap: Map<string, Progress>): number | undefined {
  let best: number | undefined;
  for (const m of g.items) {
    const p = progressMap.get(m.id);
    if (p && p.duration) {
      const pct = (p.position / p.duration) * 100;
      if (best === undefined || pct > best) best = pct;
    }
  }
  return best;
}

export default function MediaLibrary() {
  const navigate = useNavigate();
  const { movies, progressMap, favorites, loading, toggleFavorite, toggleGroupFavorite, reload } = useLibraryData();
  const [keyword, setKeyword] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);
  const [drawerGroup, setDrawerGroup] = useState<MovieGroup | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(keyword.trim().toLowerCase()), 300);
    return () => clearTimeout(t);
  }, [keyword]);

  // 同名/同目录合并成剧集组
  const groups = useMemo(() => groupMovies(movies), [movies]);

  const filteredGroups = useMemo(
    () =>
      groups.filter((g) => {
        if (category === 'movie' && g.isSeries) return false;
        if (category === 'series' && !g.isSeries) return false;
        if (!debounced) return true;
        return g.title.toLowerCase().includes(debounced) || g.items.some((m) => m.fileName.toLowerCase().includes(debounced));
      }),
    [groups, category, debounced],
  );

  // 数据或筛选变化时回到第一页
  useEffect(() => {
    setPage(1);
  }, [category, debounced, groups.length]);

  const pageGroups = filteredGroups.slice((page - 1) * pageSize, page * pageSize);

  /** 收藏操作以"整组"为单位：有未收藏的集就全收，否则全取消 */
  const toggleGroupFav = (g: MovieGroup) => toggleGroupFavorite(g.items.map((m) => m.id));

  const cardClick = (g: MovieGroup) => {
    if (g.isSeries) setDrawerGroup(g);
    else navigate(`/play/${g.items[0].id}`);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await api.refreshLibrary();
      await reload();
      message.success('媒体库已重新扫描');
    } finally {
      setRefreshing(false);
    }
  };

  const continueWatching = useMemo(
    () =>
      [...progressMap.values()]
        .filter((p) => p.duration - p.position > REFRESHABLE)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 6)
        .map((p) => ({ movie: movies.find((m) => m.id === p.movieId), progress: p }))
        .filter((x) => x.movie),
    [progressMap, movies],
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <Typography.Title level={3} style={{ margin: 0, color: '#fff' }}>媒体库</Typography.Title>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Segmented
            value={category}
            onChange={(v) => setCategory(v as CategoryFilter)}
            options={[
              { label: '全部', value: 'all' },
              { label: '电影', value: 'movie' },
              { label: '剧集', value: 'series' },
            ]}
          />
          <Input.Search
            placeholder="搜索影片"
            allowClear
            style={{ width: 220 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Button icon={<ReloadOutlined />} loading={refreshing} onClick={handleRefresh}>
            重新扫描
          </Button>
        </div>
      </div>

      {continueWatching.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <Typography.Title level={4} style={{ color: '#fff' }}>继续观看</Typography.Title>
          <Row gutter={[20, 20]}>
            {continueWatching.map(({ movie, progress }) => (
              <Col key={movie!.id} xs={12} sm={8} md={6} lg={4}>
                <MovieCard
                  movie={movie!}
                  progressPct={(progress.position / progress.duration) * 100}
                  favorite={favorites.has(movie!.id)}
                  onClick={() => navigate(`/play/${movie!.id}`)}
                  onToggleFavorite={() => toggleFavorite(movie!.id)}
                />
              </Col>
            ))}
          </Row>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}>
          <Spin size="large" />
        </div>
      ) : pageGroups.length === 0 ? (
        <Empty
          description={
            movies.length === 0
              ? '还没有扫描到视频，请在设置中添加媒体目录'
              : '没有符合条件的影片'
          }
          style={{ padding: 60 }}
        >
          {movies.length === 0 && <Button onClick={() => navigate('/settings')}>去设置</Button>}
        </Empty>
      ) : (
        <>
          <Row gutter={[20, 20]}>
            {pageGroups.map((g) => (
              <Col key={g.key} xs={12} sm={8} md={6} lg={4} xl={4}>
                <MovieCard
                  movie={g.cover}
                  title={g.title}
                  badge={g.isSeries ? `共 ${g.items.length} 集` : undefined}
                  progressPct={groupProgress(g, progressMap)}
                  favorite={g.items.some((m) => favorites.has(m.id))}
                  onClick={() => cardClick(g)}
                  onToggleFavorite={() => toggleGroupFav(g)}
                />
              </Col>
            ))}
          </Row>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 32 }}>
            <Pagination
              current={page}
              pageSize={pageSize}
              total={filteredGroups.length}
              showSizeChanger
              pageSizeOptions={[12, 24, 48, 96]}
              showTotal={(t) => (
                <Typography.Text type="secondary">
                  共 {t} 部 <Tag style={{ marginInlineStart: 8 }}>{filteredGroups.filter((x) => x.isSeries).length} 部剧集</Tag>
                </Typography.Text>
              )}
              onChange={(p, ps) => {
                setPage(p);
                setPageSize(ps);
              }}
            />
          </div>
        </>
      )}

      <EpisodeDrawer
        group={drawerGroup}
        progressMap={progressMap}
        onClose={() => setDrawerGroup(null)}
        onPlay={(id) => {
          setDrawerGroup(null);
          navigate(`/play/${id}`);
        }}
      />
    </div>
  );
}
