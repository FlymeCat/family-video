#!/usr/bin/env node
/**
 * 局域网通信层冒烟测试（无需手机）
 * 用法：先启动服务（pnpm --filter @fv/server dev 或 pnpm start），再执行：
 *   node scripts/lan-test.mjs [host]
 * host 默认 127.0.0.1，跨机测试传服务器局域网 IP。
 *
 * 验证：UDP 发现回包 + 若干 TCP JSON-RPC 方法。
 */
import dgram from 'node:dgram';
import net from 'node:net';

const HOST = process.argv[2] || '127.0.0.1';
const UDP_PORT = Number(process.env.FV_LAN_UDP_PORT || 9527);

function discover() {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const req = { method: 'DISCOVER' };
    const msg = Buffer.from(JSON.stringify(req));
    let done = false;
    sock.on('message', (m) => {
      if (done) return;
      done = true;
      try {
        resolve(JSON.parse(m.toString()));
      } catch {
        resolve(null);
      }
      sock.close();
    });
    sock.bind(() => sock.send(msg, UDP_PORT, HOST));
    setTimeout(() => {
      if (!done) {
        resolve(null);
        try { sock.close(); } catch { /* ignore */ }
      }
    }, 1500);
  });
}

function rpc(port, method, params) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, HOST);
    let buf = '';
    const id = Math.floor(Math.random() * 1e6);
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error(`${method} 超时`));
    }, 60000);
    sock.on('connect', () =>
      sock.write(JSON.stringify({ id, method, params }) + '\n'),
    );
    sock.on('data', (c) => {
      buf += c.toString();
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      clearTimeout(timer);
      const resp = JSON.parse(buf.slice(0, nl));
      sock.end();
      if (resp.ok) resolve(resp.result);
      else reject(new Error(resp.error));
    });
    sock.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function ok(label, detail) {
  console.log(`  ✔ ${label}`, detail === undefined ? '' : JSON.stringify(detail));
}

async function main() {
  console.log(`[1] UDP 发现 ${HOST}:${UDP_PORT}`);
  const info = await discover();
  if (!info || info.service !== 'family-video') {
    console.error('  ✘ 未发现服务（确认服务器已启动、UDP 端口可达）');
    process.exit(1);
  }
  ok('发现服务', { tcpPort: info.tcpPort, publicBaseUrl: info.publicBaseUrl });

  const tcp = info.tcpPort;
  console.log(`[2] TCP JSON-RPC :${tcp}`);

  const server = await rpc(tcp, 'server.info', {});
  ok('server.info', { movieCount: server.movieCount, lanUrls: server.lanUrls });

  const list = await rpc(tcp, 'library.list', { pageSize: 5, page: 1 });
  ok('library.list', { total: list.total, returned: list.movies.length });

  if (list.movies.length) {
    const m = list.movies[0];
    ok('首条影片', { id: m.id, title: m.title, category: m.category });
    // 确认服务器绝对路径不外泄
    if ('path' in m || 'root' in m) {
      console.error('  ✘ 安全：影片对象不应包含 path/root 字段');
      process.exit(1);
    }
    try {
      const probe = await rpc(tcp, 'media.probe', { id: m.id });
      ok('media.probe', probe);
    } catch (e) {
      console.warn('  ! media.probe 跳过:', e.message);
    }
    try {
      const thumb = await rpc(tcp, 'media.thumbnail', { id: m.id });
      ok('media.thumbnail', { mime: thumb.mime, bytes: thumb.base64.length });
    } catch (e) {
      console.warn('  ! media.thumbnail 跳过（封面可能尚未生成）:', e.message);
    }
  }

  const dev = 'lan-test-device';
  const favs = await rpc(tcp, 'favorites.list', { deviceId: dev });
  ok('favorites.list', { count: favs.length });
  if (list.movies.length) {
    const t = await rpc(tcp, 'favorites.toggle', { deviceId: dev, movieId: list.movies[0].id });
    ok('favorites.toggle', t);
    await rpc(tcp, 'favorites.toggle', { deviceId: dev, movieId: list.movies[0].id }); // 还原
  }

  console.log('\n全部通过 ✅');
}

main().catch((e) => {
  console.error('\n测试失败 ❌:', e.message);
  process.exit(1);
});
