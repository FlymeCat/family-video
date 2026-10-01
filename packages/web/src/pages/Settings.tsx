import { useEffect, useState } from 'react';
import { App, Button, Card, Input, List, Space, Tag, Typography } from 'antd';
import { CopyOutlined, DeleteOutlined, PlusOutlined, WifiOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import { getDeviceName, setDeviceName } from '../device';
import type { ServerConfig } from '../types';

const { Title, Text, Paragraph } = Typography;

export default function Settings() {
  const { message } = App.useApp();
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [newRoot, setNewRoot] = useState('');
  const [saving, setSaving] = useState(false);
  const [owner, setOwner] = useState(getDeviceName());

  const load = async () => setConfig(await api.getConfig());

  useEffect(() => {
    void load().catch(() => message.error('无法连接后端服务'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveRoots = async (roots: string[]) => {
    setSaving(true);
    try {
      await api.updateConfig(roots);
      message.success('媒体目录已更新并重新扫描');
      await load();
    } catch (e) {
      message.error('更新失败：' + ((e as Error)?.message ?? '请检查目录路径是否存在'));
    } finally {
      setSaving(false);
    }
  };

  const addRoot = () => {
    const p = newRoot.trim();
    if (!p || !config) return;
    setNewRoot('');
    void saveRoots([...config.mediaRoots, p]);
  };

  const copyUrl = (url: string) => {
    void navigator.clipboard
      .writeText(url)
      .then(() => message.success('已复制'))
      .catch(() => message.info(url));
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <Title level={4}>设置</Title>

      <Card title={<Space><WifiOutlined />局域网访问地址</Space>} style={{ marginBottom: 20 }}>
        <Paragraph type="secondary">
          家人用手机、平板、电视浏览器访问以下地址即可观看（需与本机在同一局域网）：
        </Paragraph>
        <List
          dataSource={config?.lanUrls ?? []}
          renderItem={(url) => (
            <List.Item
              actions={[
                <Button key="copy" size="small" type="text" icon={<CopyOutlined />} onClick={() => copyUrl(url)}>
                  复制
                </Button>,
              ]}
            >
              <Text code>{url}</Text>
            </List.Item>
          )}
        />
        {config && (
          <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
            媒体库共 <Tag color="red">{config.movieCount}</Tag> 部影片
          </Paragraph>
        )}
      </Card>

      <Card title="媒体目录" style={{ marginBottom: 20 }}>
        <Paragraph type="secondary">服务器上存放视频的绝对路径，修改后自动重新扫描。</Paragraph>
        <List
          dataSource={config?.mediaRoots ?? []}
          renderItem={(root, idx) => (
            <List.Item
              actions={
                config && config.mediaRoots.length > 1
                  ? [
                      <Button
                        key="del"
                        size="small"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        disabled={saving}
                        onClick={() => void saveRoots(config.mediaRoots.filter((_, i) => i !== idx))}
                      />,
                    ]
                  : []
              }
            >
              <Text code>{root}</Text>
            </List.Item>
          )}
        />
        <Space style={{ marginTop: 12, width: '100%' }}>
          <Input
            placeholder="例如 /home/user/Videos"
            value={newRoot}
            onChange={(e) => setNewRoot(e.target.value)}
            onPressEnter={addRoot}
            style={{ width: 360 }}
          />
          <Button icon={<PlusOutlined />} disabled={!newRoot.trim() || saving} loading={saving} onClick={addRoot}>
            添加
          </Button>
        </Space>
      </Card>

      <Card title="本机设备昵称">
        <Paragraph type="secondary">给这台设备起个名字（如：客厅电视、爸爸的手机），仅保存在本机。</Paragraph>
        <Space>
          <Input
            placeholder="设备昵称"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            style={{ width: 240 }}
          />
          <Button
            type="primary"
            onClick={() => {
              setDeviceName(owner.trim());
              message.success('已保存');
            }}
          >
            保存
          </Button>
        </Space>
      </Card>
    </div>
  );
}
