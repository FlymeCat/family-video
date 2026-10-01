# ============================================================
# 局域网家庭影院 - 常用开发 / 部署命令
# 直接执行 make 查看帮助；make <target> 执行对应任务
# ============================================================

# 可通过环境变量覆盖，如：make docker-run MEDIA_DIR=/mnt/d/迅雷下载 PORT=9000
TAG        ?= family-video:latest
CONTAINER  ?= family-video
PORT       ?= 8080
# 宿主机媒体目录，挂载进容器 /media（默认值按你的实际片库目录修改）
MEDIA_DIR  ?= /mnt/d/迅雷下载
# 命名卷：持久化 配置/进度/收藏/封面缓存（删除卷即重置数据）
DATA_VOL   ?= fv-data

.PHONY: help install dev build start typecheck clean \
        docker-build docker-run docker-stop docker-restart docker-rm docker-logs

help: ## 显示所有可用命令
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

# ---------- 本地开发 ----------
install: ## 安装全部依赖 (pnpm workspace)
	pnpm install

dev: ## 本地开发模式（server 热重载 + vite，浏览器访问 5173/8080）
	pnpm dev

build: ## 构建前端产物 packages/web/dist
	pnpm --filter @fv/web build

start: build ## 生产模式启动：8080 同端口托管 API + 前端页面
	pnpm start

typecheck: ## 前后端 TypeScript 类型检查
	cd packages/server && pnpm exec tsc --noEmit
	cd packages/web && pnpm exec tsc --noEmit

clean: ## 清理构建产物与封面缓存（保留进度/收藏数据）
	rm -rf packages/web/dist packages/server/dist
	rm -rf .data/cache

# ---------- Docker 部署（局域网推荐方式） ----------
docker-build: ## 构建生产镜像
	docker build -t $(TAG) .

docker-run: ## 后台运行容器(映射PORT,挂载MEDIA_DIR与数据卷)
	docker rm -f $(CONTAINER) 2>/dev/null || true
	docker run -d --name $(CONTAINER) \
		-p $(PORT):8080 \
		-v $(DATA_VOL):/data \
		-v $(MEDIA_DIR):/media:ro \
		--restart unless-stopped \
		$(TAG)
	@echo "局域网访问: http://<本机IP>:$(PORT)"

docker-stop: ## 停止容器（保留数据卷）
	docker stop $(CONTAINER)

docker-restart: ## 重启容器
	docker restart $(CONTAINER)

docker-rm: ## 删除容器（数据卷 $(DATA_VOL) 保留）
	docker rm -f $(CONTAINER)

docker-logs: ## 跟踪查看容器日志
	docker logs -f $(CONTAINER)
