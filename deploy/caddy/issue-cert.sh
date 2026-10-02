#!/usr/bin/env bash
# 方案1 证书签发：用 acme.sh 走 DNS-01 为域名申请「公共可信证书」，安装到 Caddy 挂载目录。
# 全程只用 DNS API，不需要把 80/443 暴露到公网，适合家用宽带（常封 80/443 / 无公网 IP）。
#
# 依赖：acme.sh（安装：curl https://get.acme.sh | sh -s email=you@example.com）
#
# 用法（先按你的 DNS 服务商导出 API 凭据，再执行）：
#   # 腾讯云 DNSPod（本仓默认用这个，域名 www.mastercat.asia 托管在此）：
#   #   DNSPod 控制台 → 账号 → API 密钥 → 创建密钥，得到 ID 与 Token
#   export DP_Id='你的APIID'
#   export DP_Key='你的Token'
#   DNS_PROVIDER=dns_dp ./deploy/caddy/issue-cert.sh www.mastercat.asia
#
#   # Cloudflare：export CF_API_TOKEN='令牌'；DNS_PROVIDER=dns_cf（默认）
#   # 腾讯云 API 密钥(SecretId/SecretKey，走 dns.tencentcloudapi.com，本环境首选)：
#   #   DNS_PROVIDER=dns_tencent  export Tencent_SecretId=SecretId Tencent_SecretKey=SecretKey
#
# 产物：deploy/caddy/certs/{fullchain.pem,privkey.pem}
# 续期：acme.sh 安装时已注册定时任务，自动续期并回调 reloadcmd 重启 Caddy。
set -euo pipefail

DOMAIN="${1:?用法: issue-cert.sh <域名>；先导出对应 DNS 服务商的 API 环境变量}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERT_DIR="${CERT_DIR:-$SCRIPT_DIR/certs}"
CADDY_CONTAINER="${CADDY_CONTAINER:-fv-caddy}"
ACME="${ACME_SH:-$HOME/.acme.sh/acme.sh}"
PROVIDER="${DNS_PROVIDER:-dns_cf}"
CA="${ACME_CA:-letsencrypt}"

[ -x "$ACME" ] || { echo "✗ 未找到 acme.sh（$ACME）。先安装：curl https://get.acme.sh | sh -s email=you@example.com"; exit 1; }
mkdir -p "$CERT_DIR"

echo "→ 用 $PROVIDER 走 DNS-01 向 $CA 申请 $DOMAIN 的证书…"
"$ACME" --issue --server "$CA" -d "$DOMAIN" --dns "$PROVIDER" --force

echo "→ 安装证书到 $CERT_DIR …"
"$ACME" --install-cert -d "$DOMAIN" \
  --key-file       "$CERT_DIR/privkey.pem" \
  --fullchain-file "$CERT_DIR/fullchain.pem" \
  --reloadcmd      "docker restart $CADDY_CONTAINER >/dev/null 2>&1 || true"

chmod 600 "$CERT_DIR/privkey.pem" 2>/dev/null || true
echo "✔ 完成：$CERT_DIR/{fullchain,privkey}.pem"
echo "  若 Caddy 已在跑：make caddy-up FV_DOMAIN=$DOMAIN PUBLIC_BASE_URL=https://$DOMAIN"
