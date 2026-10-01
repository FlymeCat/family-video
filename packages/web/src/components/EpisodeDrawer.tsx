import { Drawer, List, Tag, Typography } from 'antd';
import { PlayCircleOutlined } from '@ant-design/icons';
import type { MovieGroup } from '../utils/grouping';
import type { Progress } from '../types';
import { formatTime } from '../utils/format';

export interface EpisodeDrawerProps {
  group: MovieGroup | null;
  progressMap: Map<string, Progress>;
  onClose: () => void;
  /** 点击某一集（传入 movieId 与集序） */
  onPlay: (movieId: string) => void;
}

/** 连续剧选集抽屉：按 1-xxxx 顺序列出，标注已看进度 */
export default function EpisodeDrawer({ group, progressMap, onClose, onPlay }: EpisodeDrawerProps) {
  return (
    <Drawer
      open={group !== null}
      onClose={onClose}
      width={420}
      styles={{ body: { padding: 0 }, header: { borderBottom: '1px solid #2b2b33' } }}
      title={
        group ? (
          <span>
            {group.title} <Typography.Text type="secondary" style={{ fontSize: 13 }}>共 {group.items.length} 集</Typography.Text>
          </span>
        ) : null
      }
    >
      {group && (
        <List
          dataSource={group.items}
          renderItem={(m, idx) => {
            const p = progressMap.get(m.id);
            const watched = p && p.duration ? Math.round((p.position / p.duration) * 100) : 0;
            return (
              <List.Item
                style={{ padding: '12px 20px', cursor: 'pointer' }}
                onClick={() => onPlay(m.id)}
                actions={[
                  <PlayCircleOutlined key="play" style={{ fontSize: 20, color: '#e50914' }} />,
                ]}
              >
                <List.Item.Meta
                  title={
                    <span style={{ color: '#fff' }}>第 {idx + 1} 集</span>
                  }
                  description={
                    <Typography.Text
                      type="secondary"
                      ellipsis={{ tooltip: m.fileName }}
                      style={{ maxWidth: 300, display: 'block' }}
                    >
                      {m.fileName}
                    </Typography.Text>
                  }
                />
                {watched > 0 && watched < 97 ? (
                  <Tag color="red" style={{ marginRight: 8 }}>
                    看到 {formatTime(p!.position)}
                  </Tag>
                ) : watched >= 97 ? (
                  <Tag style={{ marginRight: 8 }}>已看完</Tag>
                ) : null}
              </List.Item>
            );
          }}
        />
      )}
    </Drawer>
  );
}
