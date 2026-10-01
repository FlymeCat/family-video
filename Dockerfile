# syntax=docker/dockerfile:1
#
# 局域网家庭影院 · 多阶段构建
#   构建镜像：docker build -t family-video .          （或 make docker-build）
#   启动容器：docker run -d -p 8080:8080 \
#              -v fv-data:/data -v /path/to/media:/media:ro family-video  （或 make docker-up）
#
# 与纯静态站不同：本服务需 Express 后端（目录扫描 / Range 流式播放 / 进度收藏 API），
# 运行阶段是 node + ffmpeg 容器，同端口托管 API 与前端产物，内部端口固定 8080。

# ---------- 可通过 --build-arg 覆盖的参数 ----------
ARG NODE_IMAGE=node:24-alpine
ARG PNPM_VERSION=11.23.0
# 国内网络保持默认；境外构建传 --build-arg NPM_REGISTRY=https://registry.npmjs.org
ARG NPM_REGISTRY=https://registry.npmmirror.com

# ===================== 1. 构建阶段 =====================
FROM ${NODE_IMAGE} AS build
ARG PNPM_VERSION
ARG NPM_REGISTRY
WORKDIR /app

RUN npm config set registry ${NPM_REGISTRY} \
 && npm install --global pnpm@${PNPM_VERSION}

# 先只拷依赖清单（含各子包 package.json），源码变更时不重复装依赖
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm config set registry ${NPM_REGISTRY} \
 && pnpm fetch

COPY . .
# pnpm-workspace.yaml 已声明 allowBuilds（esbuild 需要装二进制；ffmpeg-static 跳过下载，
# 封面抽帧统一用运行阶段的系统 ffmpeg）
RUN pnpm install --frozen-lockfile --prefer-offline --reporter=append-only \
 && pnpm --filter @fv/web build

# ===================== 2. 运行阶段 =====================
FROM ${NODE_IMAGE} AS runtime
ARG PNPM_VERSION
ARG NPM_REGISTRY
LABEL org.opencontainers.image.title="family-video" \
      org.opencontainers.image.description="局域网家庭影院 · React + Ant Design + Express 流式播放"

# 运行脚本需要 pnpm 工作区命令；ffmpeg 用于封面抽帧（server 通过 PATH 调用）
RUN npm config set registry ${NPM_REGISTRY} \
 && npm install --global pnpm@${PNPM_VERSION} \
 && apk add --no-cache ffmpeg

WORKDIR /app
# 带上 node_modules / 源码 / web 产物：start 脚本用 tsx 直跑 src/index.ts，
# PROJECT_ROOT 路径锚定与本地开发完全一致
COPY --from=build /app /app

# 内部端口固定 8080（宿主机映射由 make docker-up 的 HOST_PORT 决定）
# FV_DATA_DIR：配置/进度/收藏/封面缓存持久化位置（挂载卷）
# FV_MEDIA_DIR：默认媒体目录（仅当卷内无 config.json 时生效；也可启动后在"设置"页修改）
ENV NODE_ENV=production \
    PORT=8080 \
    FV_DATA_DIR=/data \
    FV_MEDIA_DIR=/media

EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1

CMD ["pnpm", "start"]
