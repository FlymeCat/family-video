import { useMemo, useState } from 'react';
import { Layout, Menu, Grid, Drawer } from 'antd';
import {
  HddOutlined,
  PlaySquareOutlined,
  StarOutlined,
  SettingOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import MediaLibrary from './pages/MediaLibrary';
import ContinueWatching from './pages/ContinueWatching';
import Favorites from './pages/Favorites';
import Settings from './pages/Settings';
import Player from './pages/Player';

const { Sider, Content, Header } = Layout;
const { useBreakpoint } = Grid;

const NAV_ITEMS = [
  { key: '/library', icon: <HddOutlined />, label: '媒体库' },
  { key: '/watching', icon: <PlaySquareOutlined />, label: '继续观看' },
  { key: '/favorites', icon: <StarOutlined />, label: '收藏' },
  { key: '/settings', icon: <SettingOutlined />, label: '设置' },
];

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const [drawerOpen, setDrawerOpen] = useState(false);

  // 播放页全屏沉浸，不显示导航
  const isPlayer = location.pathname.startsWith('/play');
  const selectedKey = useMemo(() => {
    const item = NAV_ITEMS.find((i) => location.pathname.startsWith(i.key));
    return item ? [item.key] : [];
  }, [location.pathname]);

  const nav = (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={selectedKey}
      items={NAV_ITEMS}
      onClick={({ key }) => {
        navigate(key);
        setDrawerOpen(false);
      }}
    />
  );

  if (isPlayer) {
    return (
      <Layout className="fv-player-fullscreen" style={{ minHeight: '100vh' }}>
        <Content>
          <Routes>
            <Route path="/play/:id" element={<Player />} />
          </Routes>
        </Content>
      </Layout>
    );
  }

  const header = (
    <Header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: isMobile ? '0 12px' : '0 24px',
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}
    >
      {isMobile && (
        <PlaySquareOutlined style={{ fontSize: 20, color: '#e50914' }} onClick={() => setDrawerOpen(true)} />
      )}
      <VideoCameraOutlined style={{ fontSize: 24, color: '#e50914' }} />
      <span style={{ fontSize: 18, fontWeight: 600, color: '#fff' }}>家庭影院</span>
    </Header>
  );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {!isMobile && (
        <Sider width={200} theme="dark">
          <div style={{ height: 56 }} />
          {nav}
        </Sider>
      )}
      <Layout>
        {header}
        <Content style={{ padding: 24, maxWidth: 1600, width: '100%', margin: '0 auto' }}>
          <Routes>
            <Route path="/" element={<MediaLibrary />} />
            <Route path="/library" element={<MediaLibrary />} />
            <Route path="/watching" element={<ContinueWatching />} />
            <Route path="/favorites" element={<Favorites />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </Content>
      </Layout>
      <Drawer
        open={drawerOpen}
        placement="left"
        width={220}
        closable={false}
        styles={{ body: { padding: 0, background: '#141419' } }}
        onClose={() => setDrawerOpen(false)}
      >
        {nav}
      </Drawer>
    </Layout>
  );
}
