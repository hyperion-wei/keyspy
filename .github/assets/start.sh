#!/bin/sh
# KeySpy 免安装版启动脚本（Linux x64，包内已内置 Node 运行时）
set -e

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$HERE/app"

# 默认只监听回环，避免带明文密钥的库在公网裸跑；确需外部访问时显式指定 BIND_ADDR
BIND_ADDR=${BIND_ADDR:-127.0.0.1}
PORT=${PORT:-3000}

# Next.js 的 server.js 用 HOSTNAME 决定监听地址。
# 注意不能沿用 shell 自带的 HOSTNAME（那是主机名），必须显式覆盖。
export HOSTNAME="$BIND_ADDR"
export PORT
export NODE_ENV=production

# MCP 与内部自调用走回环，反代 / SSL 部署下也可用
export INTERNAL_BASE_URL=${INTERNAL_BASE_URL:-http://127.0.0.1:${PORT}}

# Hunt 扫描引擎随包内置
export GITLEAKS_PATH=${GITLEAKS_PATH:-${PWD}/tools/gitleaks/gitleaks}
export GITLEAKS_ENHANCED_RULES=${GITLEAKS_ENHANCED_RULES:-${PWD}/tools/gitleaks/enhanced-rules.toml}
export NEXT_TELEMETRY_DISABLED=1

# 低配机器：堆上限默认 512MB，可用 NODE_MAX_OLD_SPACE 覆盖
exec "${HERE}/node" --max-old-space-size=${NODE_MAX_OLD_SPACE:-512} server.js
