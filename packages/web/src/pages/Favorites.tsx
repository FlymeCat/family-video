import { useMemo, useState } from 'react';
import { Col, Empty, Row, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import MovieCard from '../components/MovieCard';
import EpisodeDrawer from '../components/EpisodeDrawer';
import { useLibraryData, progressPctOf } from '../hooks/useLibraryData';
import { groupMovies, type MovieGroup } from '../utils/grouping';
import type { Progress } from '../types';

const { Title } = Typography;

function groupProgress(g: MovieGroup, progressMap: Map<string, Progress>): number | undefined {
  let best: number | undefined;
  for (const m of g.items) {
    const pct = progressPctOf(progressMap.get(m.id));
    if (pct !== undefined && (best === undefined || pct > best)) best = pct;
  }
  return best;
}

export default function Favorites() {
  const navigate = useNavigate();
  const { movies, progressMap, favorites, loading, toggleGroupFavorite } = useLibraryData();
  const [drawerGroup, setDrawerGroup] = useState<MovieGroup | null>(null);

  // 收藏的影片按与媒体库相同的规则合并成组
  const groups = useMemo(() => groupMovies(movies.filter((m) => favorites.has(m.id))), [movies, favorites]);

  return (
    <div>
      <Title level={4}>我的收藏</Title>
      {!loading && groups.length === 0 ? (
        <Empty description="还没有收藏任何影片" style={{ padding: '60px 0' }}>
          <Typography.Link onClick={() => navigate('/library')}>去媒体库看看</Typography.Link>
        </Empty>
      ) : (
        <Row gutter={[20, 20]}>
          {groups.map((g) => (
            <Col key={g.key} xs={12} sm={8} md={6} lg={4}>
              <MovieCard
                movie={g.cover}
                title={g.title}
                badge={g.isSeries ? `共 ${g.items.length} 集` : undefined}
                progressPct={groupProgress(g, progressMap)}
                favorite
                onClick={() => (g.isSeries ? setDrawerGroup(g) : navigate(`/play/${g.items[0].id}`))}
                onToggleFavorite={() => void toggleGroupFavorite(g.items.map((m) => m.id))}
              />
            </Col>
          ))}
        </Row>
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
