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
	@docker rm -f $(CONTAINER) >/dev/null 2>&1 || true
	docker run -d --name $(CONTAINER) --restart unless-stopped \
		-p $(HOST_PORT):8080 \
		-v $(DATA_VOL):/data \
		-v $(MEDIA_DIR):/media:ro \
		-e TZ=Asia/Shanghai \
		$(LOCAL_IMAGE)
	@echo ""
	@echo "容器已启动 → 局域网家人访问 http://<本机IP>:$(HOST_PORT)   （make docker-logs 查看日志）"

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
	@docker rm -f $(CONTAINER) >/dev/null 2>&1 || true
	docker run -d --name $(CONTAINER) --restart unless-stopped \
		-p $(HOST_PORT):8080 \
		-v $(DATA_VOL):/data \
		-v $(MEDIA_DIR):/media:ro \
		-e TZ=Asia/Shanghai \
		$(REMOTE):$(IMAGE_TAG)
	@echo ""
	@echo "已部署 → http://<本机>:$(HOST_PORT)"

docker-down: ## 停止并删除容器（数据卷保留）
	@docker rm -f $(CONTAINER) >/dev/null 2>&1 || true
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
	@docker rm -f $(CONTAINER) >/dev/null 2>&1 || true
	@docker rmi -f $(LOCAL_IMAGE) >/dev/null 2>&1 || true
	@echo "本地镜像与容器已清理（数据卷 $(DATA_VOL) 保留）"

# ---------------------------- Docker Compose ----------------------------
# 兼容 Compose v2（docker compose）与老版 docker-compose v1
COMPOSE ?= $(shell docker compose version >/dev/null 2>&1 && echo "docker compose" || echo "docker-compose")
# 把同一套默认值传给 docker-compose.yml，避免两处各写一份
export IMAGE CONTAINER HOST_PORT NPM_REGISTRY MEDIA_DIR DATA_VOL

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
        compose-up compose-pull compose-update compose-down compose-logs compose-ps compose-config
