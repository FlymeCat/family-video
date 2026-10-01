# 局域网家庭影院 - 生产镜像
# 单容器方案：Express 后端同端口托管 API + 前端构建产物，家人访问 http://主机IP:8080 即可
FROM node:22-slim

WORKDIR /app

# tsx 通过 corepack 使用 package.json 锁定的 pnpm 版本
RUN corepack enable

# 封面抽帧依赖系统 ffmpeg（server 通过 PATH 调用）
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# 先只拷清单文件安装依赖，源码变动时不必重装依赖（层缓存）
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile

# 拷源码并构建前端产物（.dockerignore 已排除宿主 node_modules/dist/.data）
COPY . .
RUN pnpm --filter @fv/web build

# FV_DATA_DIR：进度/收藏/封面/配置持久化位置（挂载卷）
# FV_MEDIA_DIR：默认媒体目录（仅当卷内无 config.json 时生效；也可启动后在"设置"页配置）
ENV NODE_ENV=production \
    PORT=8080 \
    FV_DATA_DIR=/data \
    FV_MEDIA_DIR=/media

EXPOSE 8080
VOLUME ["/data", "/media"]

# start = tsx 运行 src/index.ts，PROJECT_ROOT 路径锚定与本地开发一致
CMD ["pnpm", "start"]
