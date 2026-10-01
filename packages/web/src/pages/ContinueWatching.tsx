import { useMemo } from 'react';
import { Col, Empty, Row, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import MovieCard from '../components/MovieCard';
import { useLibraryData, progressPctOf } from '../hooks/useLibraryData';

const { Title } = Typography;

export default function ContinueWatching() {
  const navigate = useNavigate();
  const { movies, progressMap, favorites, loading, toggleFavorite } = useLibraryData();

  const list = useMemo(
    () =>
      movies
        .map((m) => ({ movie: m, progress: progressMap.get(m.id) }))
        .filter(({ progress }) => {
          const pct = progressPctOf(progress);
          return pct !== undefined && pct > 0 && pct < 97;
        })
        .sort((a, b) => (b.progress?.updatedAt ?? 0) - (a.progress?.updatedAt ?? 0)),
    [movies, progressMap],
  );

  return (
    <div>
      <Title level={4}>继续观看</Title>
      {!loading && list.length === 0 ? (
        <Empty description="还没有观看记录，去媒体库挑一部影片吧" style={{ padding: '60px 0' }}>
          <Typography.Link onClick={() => navigate('/library')}>打开媒体库</Typography.Link>
        </Empty>
      ) : (
        <Row gutter={[16, 16]}>
          {list.map(({ movie, progress }) => (
            <Col key={movie.id} xs={24} sm={12} md={8} lg={6} xl={4}>
              <MovieCard
                movie={movie}
                progressPct={progressPctOf(progress)}
                favorite={favorites.has(movie.id)}
                onClick={() => navigate(`/play/${movie.id}`)}
                onToggleFavorite={() => void toggleFavorite(movie.id)}
              />
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
}
