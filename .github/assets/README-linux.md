# KeySpy Linux 免安装版

包内已内置 Node 运行时与 gitleaks 扫描引擎，目标机**无需**安装 Node / pnpm / 编译工具链。

## 目录结构

```
keyspy-vX.Y.Z-linux-x64/
├── node                       # 内置 Node 运行时
├── start.sh                   # 前台启动脚本
├── keyspy.service.example     # systemd 单元模板（含资源限额）
└── app/                       # Next.js standalone 产物，进程工作目录
    ├── server.js
    ├── .next/                 # 含 static 资源与已 trace 的依赖（better-sqlite3 为 linux 原生绑定）
    ├── public/
    ├── data/                  # 运行后生成 app.db（可用 DB_PATH 覆盖）
    └── tools/gitleaks/        # gitleaks 引擎 + enhanced-rules.toml
```

## 快速启动

```sh
tar -xzf keyspy-vX.Y.Z-linux-x64.tar.gz
mv keyspy-vX.Y.Z-linux-x64 /opt/keyspy
cd /opt/keyspy && ./start.sh          # 默认监听 127.0.0.1:3000
```

## 开机自启（推荐）

```sh
useradd -r -s /usr/sbin/nologin -d /opt/keyspy keyspy
chown -R keyspy:keyspy /opt/keyspy
install -m 0644 /opt/keyspy/keyspy.service.example /etc/systemd/system/keyspy.service
systemctl daemon-reload && systemctl enable --now keyspy
```

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `BIND_ADDR` | `127.0.0.1` | 监听地址（`start.sh` 内部映射为 Next 的 `HOSTNAME`）。公网裸跑风险高，建议保持回环 + 端口转发 |
| `PORT` | `3000` | 监听端口 |
| `DB_PATH` | `app/data/app.db` | SQLite 数据库路径 |
| `INTERNAL_BASE_URL` | `http://127.0.0.1:3000` | MCP / 内部自调用地址，反代与 SSL 部署下需保持回环 |
| `GITLEAKS_PATH` | `app/tools/gitleaks/gitleaks` | Hunt 扫描引擎路径 |
| `GITLEAKS_ENHANCED_RULES` | `app/tools/gitleaks/enhanced-rules.toml` | 增强规则 |
| `NODE_MAX_OLD_SPACE` | `512` | Node 堆上限（MB），低配机器不要随意调大 |

## 低配机器注意

- systemd 模板已设 `MemoryHigh=600M` / `MemoryMax=700M` / `CPUQuota=150%` / `Nice=10`，防止轮询与扫描拖垮整机。
- 监控数量多时优先调大「轮询间隔」（界面：管理 → 设置），比调高堆上限更有效。
- Hunt 扫描会抓取大量文件到 `app/data`，磁盘紧张时先清理历史任务与结果。

## 访问方式（仅回环监听时）

在服务器上建立隧道后本地浏览器打开 `http://127.0.0.1:3000`：

```sh
ssh -N -L 3000:127.0.0.1:3000 user@server
```

## 校验下载完整性

```sh
sha256sum -c keyspy-vX.Y.Z-linux-x64.tar.gz.sha256
```
