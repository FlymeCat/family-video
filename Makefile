# 局域网家庭影院 · 工程化命令入口
#
# 常用：
#   make                查看帮助
#   make install        安装依赖
#   make dev            启动开发服务器（server 热重载 + vite）
#   make build          构建前端产物
#   make start          生产模式本机启动（8080 同端口托管 API + 页面）
#   make docker-up      本地构建镜像并启动容器（挂载媒体库与数据卷）
#   make docker-push    推送镜像到仓库 NAMESPACE=<命名空间>
#   make compose-up     用 docker-compose.yml 启动现成镜像
#
# 可覆盖变量：REGISTRY / NAMESPACE / IMAGE_NAME / IMAGE_TAG / CONTAINER / HOST_PORT / MEDIA_DIR / DATA_VOL / NPM_REGISTRY
# 例：make docker-up MEDIA_DIR=/mnt/d/迅雷下载 HOST_PORT=9000

# 可选：把项目根的 .env 作为默认值引入（-include 缺失不报错）；写在 ?= 之前，命令行仍可覆盖
-include .env

# ---------------- 镜像仓库（阿里云容器镜像服务）----------------
# 注意：REGISTRY 是 Docker 镜像仓库，NPM_REGISTRY 是 npm 包源，两者不能混用。
REGISTRY     ?= crpi-oa7sq9hledsqbgu5.cn-hangzhou.personal.cr.aliyuncs.com
# 仓库命名空间，推送 / 拉取必填：make docker-push NAMESPACE=<命名空间>
NAMESPACE    ?=
IMAGE_NAME   ?= family-video
IMAGE_TAG    ?= latest
APP_VERSION  := $(shell node -p "require('./package.json').version" 2>/dev/null || echo 0.0.0)

CONTAINER    ?= family-video
# 宿主机映射端口（容器内部固定 8080）；注意 make 行尾注释会被并入变量值，禁止内联
HOST_PORT    ?= 8080
# 局域网通信端口：微信小程序 UDP 服务发现(9527/udp) + TCP 控制面(9528/tcp)
LAN_UDP_PORT ?= 9527
LAN_TCP_PORT ?= 9528
# 方案1：备案域名 + DNS-01 证书 + 本地 DNS 指内网，Caddy 反代出 HTTPS 供小程序 <video> 播放
FV_DOMAIN        ?= tv.example.com
PUBLIC_BASE_URL  ?= https://$(FV_DOMAIN)
FV_NET           ?= fv-net
CADDY_CONTAINER  ?= fv-caddy
CADDY_IMAGE      ?= caddy:2
CERT_DIR         ?= $(CURDIR)/deploy/caddy/certs
PNPM         ?= pnpm
IMAGE        ?= $(IMAGE_NAME):$(IMAGE_TAG)
NPM_REGISTRY ?= https://registry.npmmirror.com

# ---------------- 本服务特有：片库与数据持久化 ----------------
# 宿主机媒体目录，只读挂载进容器 /media（新卷首次启动时作为默认片库；之后可在"设置"页改）
MEDIA_DIR    ?= /mnt/d/迅雷下载
# 命名卷：持久化 配置/进度/收藏/封面缓存（删除卷即重置数据：docker volume rm $(DATA_VOL)）
DATA_VOL     ?= fv-data

SHELL := /bin/bash
.DEFAULT_GOAL := help

# 只有给了 NAMESPACE 才生成远端 tag，否则 make docker-build 仅打本地 tag
ifeq ($(strip $(NAMESPACE)),)
REMOTE     :=
TAG_ARGS   := -t $(IMAGE_NAME):$(IMAGE_TAG)
else
REMOTE     := $(REGISTRY)/$(NAMESPACE)/$(IMAGE_NAME)
TAG_ARGS   := -t $(IMAGE_NAME):$(IMAGE_TAG) -t $(REMOTE):$(IMAGE_TAG) -t $(REMOTE):v$(APP_VERSION)
endif

LOCAL_IMAGE := $(IMAGE_NAME):$(IMAGE_TAG)

# ------------------------------ 开发 ------------------------------

help: ## 显示所有可用命令
	@echo "局域网家庭影院 · 可用命令"
	@echo ""
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z0-9_.-]+:.*?## / {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## 安装全部依赖（pnpm workspace）
	$(PNPM) install

dev: ## 本地开发模式（server 热重载 + vite，页面 http://localhost:5173）
	$(PNPM) dev

typecheck: ## 前后端 TypeScript 类型检查
	cd packages/server && $(PNPM) exec tsc --noEmit
	cd packages/web && $(PNPM) exec tsc --noEmit

build: ## 构建前端产物 packages/web/dist
	$(PNPM) --filter @fv/web build

start: build ## 生产模式本机启动：8080 同端口托管 API + 前端页面
	$(PNPM) start

doctor: ## 打印 node / pnpm 版本，便于排查环境问题
	@echo "node   : `node -v`"
	@echo "pnpm   : `$(PNPM) -v`"
	@echo "registry: `$(PNPM) config get registry`"

clean: ## 清理构建产物与封面缓存（保留进度/收藏数据）
	rm -rf packages/web/dist packages/server/dist .data/cache
	@echo "已清理 dist 与 .data/cache（进度/收藏未动）"

clean-all: ## 连同 node_modules 一起删除（需重新 make install）
	rm -rf packages/web/dist packages/server/dist packages/*/node_modules node_modules
	@echo "已删除 dist 与 node_modules，执行 make install 重装"

# ------------------------------ Docker ------------------------------

docker-build: ## 本地构建镜像（多阶段：pnpm 构建 web → node+ffmpeg 运行）
	docker build $(TAG_ARGS) --build-arg NPM_REGISTRY=$(NPM_REGISTRY) .

docker-up: docker-build ## 构建并后台启动本地镜像，挂载片库与数据卷
	@docker network inspect $(FV_NET) >/dev/null 2>&1 || docker network create $(FV_NET)
	@docker rm -f $(CONTAINER) >/dev/null 2>&1 || true
	docker run -d --name $(CONTAINER) --restart unless-stopped \
		--network $(FV_NET) \
		-p $(HOST_PORT):8080 \
		-p $(LAN_UDP_PORT):9527/udp \
		-p $(LAN_TCP_PORT):9528/tcp \
		-v $(DATA_VOL):/data \
		-v $(MEDIA_DIR):/media:ro \
		-e TZ=Asia/Shanghai \
		-e FV_PUBLIC_BASE_URL=$(PUBLIC_BASE_URL) \
		$(LOCAL_IMAGE)
	@echo ""
	@echo "容器已启动 → 局域网家人访问 http://<本机IP>:$(HOST_PORT)   （make docker-logs 查看日志）"
	@echo "小程序局域网通道：UDP $(LAN_UDP_PORT)/udp + TCP $(LAN_TCP_PORT)/tcp（WSL2 需放行 Windows 防火墙入站）"
	@echo "HTTPS 播放（方案1）：签发证书后 make caddy-up FV_DOMAIN=$(FV_DOMAIN)；详见 docs/微信小程序集成方案.md"

docker-login: ## 登录镜像仓库（交互式输入密码，勿在命令行写明文）
	@echo "用户名：阿里云容器镜像服务设置的固定账号密码中的「用户名」"
	docker login $(REGISTRY)

docker-push: docker-build ## 推送镜像到仓库（需 NAMESPACE=xxx，推送 latest 与 v<版本号>）
	@if [ -z "$(strip $(NAMESPACE))" ]; then \
		echo "缺少命名空间，用法：make docker-push NAMESPACE=<命名空间>"; exit 1; \
	fi
	@docker push $(REMOTE):$(IMAGE_TAG)
	@docker push $(REMOTE):v$(APP_VERSION)
	@echo "已推送：$(REMOTE):$(IMAGE_TAG) 与 $(REMOTE):v$(APP_VERSION)"

docker-pull: ## 从仓库拉取镜像（需 NAMESPACE=xxx）
	@if [ -z "$(strip $(NAMESPACE))" ]; then \
		echo "缺少命名空间，用法：make docker-pull NAMESPACE=<命名空间>"; exit 1; \
	fi
	docker pull $(REMOTE):$(IMAGE_TAG)

docker-deploy: docker-pull ## 服务器上直拉镜像并启动容器（无需源码与构建环境）
	@docker network inspect $(FV_NET) >/dev/null 2>&1 || docker network create $(FV_NET)
	@docker rm -f $(CONTAINER) >/dev/null 2>&1 || true
	docker run -d --name $(CONTAINER) --restart unless-stopped \
		--network $(FV_NET) \
		-p $(HOST_PORT):8080 \
		-p $(LAN_UDP_PORT):9527/udp \
		-p $(LAN_TCP_PORT):9528/tcp \
		-v $(DATA_VOL):/data \
		-v $(MEDIA_DIR):/media:ro \
		-e TZ=Asia/Shanghai \
		-e FV_PUBLIC_BASE_URL=$(PUBLIC_BASE_URL) \
		$(REMOTE):$(IMAGE_TAG)
	@echo ""
	@echo "已部署 → http://<本机>:$(HOST_PORT)"

docker-down: ## 停止并删除容器（数据卷保留）
	@docker rm -f $(CONTAINER) $(CADDY_CONTAINER) >/dev/null 2>&1 || true
	@echo "容器 $(CONTAINER) 已停止"

docker-restart: ## 重启容器
	docker restart $(CONTAINER)

docker-logs: ## 跟随容器日志
	docker logs -f $(CONTAINER)

docker-shell: ## 进入容器内部
	docker exec -it $(CONTAINER) sh

docker-inspect: ## 查看镜像 tag 与容器状态
	@echo "REGISTRY     = $(REGISTRY)"
	@echo "NAMESPACE    = $(or $(NAMESPACE),<未设置>)"
	@echo "LOCAL_IMAGE  = $(LOCAL_IMAGE)"
	@echo "REMOTE_IMAGE = $(or $(REMOTE),<未设置>)"
	@echo "APP_VERSION  = $(APP_VERSION)"
	@echo "MEDIA_DIR    = $(MEDIA_DIR) -> /media (ro)"
	@echo "DATA_VOL     = $(DATA_VOL) -> /data"
	@docker ps -a --filter name=$(CONTAINER) || true

docker-clean: ## 停止容器并删除本地镜像（数据卷与仓库镜像不受影响）
	@docker rm -f $(CONTAINER) $(CADDY_CONTAINER) >/dev/null 2>&1 || true
	@docker rmi -f $(LOCAL_IMAGE) >/dev/null 2>&1 || true
	@echo "本地镜像与容器已清理（数据卷 $(DATA_VOL) 保留）"

# ---------------- 方案1：HTTPS 反代（Caddy） ----------------

cert-issue: ## 用 acme.sh 走 DNS-01 为 FV_DOMAIN 申请证书到 deploy/caddy/certs（需先导出 DNS 凭据）
	@bash deploy/caddy/issue-cert.sh $(FV_DOMAIN)

caddy-up: ## 启动 Caddy HTTPS 反代（方案1：需先 make cert-issue 生成证书）
	@docker network inspect $(FV_NET) >/dev/null 2>&1 || docker network create $(FV_NET)
	@if [ ! -f "$(CERT_DIR)/fullchain.pem" ] || [ ! -f "$(CERT_DIR)/privkey.pem" ]; then \
		echo "✗ 缺少证书：$(CERT_DIR)/{fullchain,privkey}.pem"; \
		echo "  先签发（DNS-01，无需公网入口）：make cert-issue FV_DOMAIN=<你的备案域名>"; exit 1; \
	fi
	@docker rm -f $(CADDY_CONTAINER) >/dev/null 2>&1 || true
	docker run -d --name $(CADDY_CONTAINER) --restart unless-stopped \
		--network $(FV_NET) \
		-p 443:443 -p 80:80 \
		-e FV_DOMAIN=$(FV_DOMAIN) \
		-v $(CURDIR)/deploy/caddy/Caddyfile:/etc/caddy/Caddyfile:ro \
		-v $(CERT_DIR):/etc/caddy/certs:ro \
		-v fv-caddy-data:/data -v fv-caddy-config:/config \
		$(CADDY_IMAGE)
	@echo ""
	@echo "Caddy 已启动 → https://$(FV_DOMAIN) 反代到 family-video:8080"
	@echo "本地验证： curl -k https://127.0.0.1/api/health   （应返回健康 JSON）"
	@echo "提醒：家庭路由器/本地 DNS 需把 $(FV_DOMAIN) 解析到本机局域网 IP；手机连家里 WiFi 后方能命中内网"
	@echo "家庭影院需同时带 publicBaseUrl=https://$(FV_DOMAIN) 启动（make docker-up 已自动下发）"

caddy-down: ## 停止并删除 Caddy 容器
	@docker rm -f $(CADDY_CONTAINER) >/dev/null 2>&1 || true
	@echo "Caddy 容器已停止"

caddy-logs: ## 查看 Caddy 日志
	docker logs -f $(CADDY_CONTAINER)

# ---------------------------- Docker Compose ----------------------------
# 兼容 Compose v2（docker compose）与老版 docker-compose v1
COMPOSE ?= $(shell docker compose version >/dev/null 2>&1 && echo "docker compose" || echo "docker-compose")
# 把同一套默认值传给 docker-compose.yml，避免两处各写一份
export IMAGE CONTAINER HOST_PORT NPM_REGISTRY MEDIA_DIR DATA_VOL
export LAN_UDP_PORT LAN_TCP_PORT PUBLIC_BASE_URL FV_DOMAIN CADDY_CONTAINER CADDY_IMAGE

compose-up: ## 用 docker-compose.yml 启动（生产编排，只跑现成镜像不在本机构建）
	@echo "使用: $(COMPOSE)  镜像: $(IMAGE)"
	@# docker-up 与 compose-up 共用同一个 container_name，先移除旧的同名容器避免命名冲突
	@docker rm -f $(CONTAINER) >/dev/null 2>&1 || true
	$(COMPOSE) up -d
	@echo "已启动 → http://localhost:$(HOST_PORT)"

compose-pull: ## 只拉取镜像，不重启容器
	$(COMPOSE) pull

compose-update: ## 更新镜像并重建容器（先 down 再 up，避开 compose v1 重建报错；IMAGE 需为仓库完整地址）
	$(COMPOSE) pull
	$(COMPOSE) down
	$(COMPOSE) up -d

compose-down: ## 停止并移除 compose 服务与网络
	$(COMPOSE) down

compose-logs: ## 跟随 compose 服务日志
	$(COMPOSE) logs -f

compose-ps: ## 查看 compose 服务状态
	$(COMPOSE) ps

compose-config: ## 校验并渲染 compose 配置（展开变量默认值）
	$(COMPOSE) config

.PHONY: help install dev typecheck build start doctor clean clean-all \
        docker-build docker-up docker-login docker-push docker-pull docker-deploy \
        docker-down docker-restart docker-logs docker-shell docker-inspect docker-clean \
        cert-issue caddy-up caddy-down caddy-logs \
        compose-up compose-pull compose-update compose-down compose-logs compose-ps compose-config
