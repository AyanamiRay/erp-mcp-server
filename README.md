# 企业级高可用可热插拔 MCP Server (Enterprise MCP Gateway)

基于 TypeScript 与 Model Context Protocol (`@modelcontextprotocol/sdk`) 开发的高可用企业级网关服务。专用于为大模型（Claude、Cursor、Antigravity、自研 LLM Agent 等）提供针对现有 Java ERP 系统的安全、稳定、可热插拔的工具调用支持。

---

## 🌟 核心特性

1. **热插拔与动态自适应 (Hot-Pluggable)**
   - 接口元数据驱动，新增、下线、修改工具**无需重启 MCP Server**。
   - 原生支持 MCP 规范的 `notifications/tools/list_changed` 实时广播，大模型端即时无感刷新能力列表。
2. **多副本高可用支持 (High Availability)**
   - 针对 SSE 长连接优化的 Nginx 配置，通过 `hash $arg_sessionId consistent` 实现**会话粘性路由 (Sticky Session)**。
   - 包含 `/healthz` 探活探针与 `SIGTERM` 优雅停机（Graceful Shutdown）机制。
   - 可选 Redis Pub/Sub，实现跨多节点集群的工具更新广播。
3. **针对 Java ERP 的安全防护**
   - **大模型防循环攻击**：超时严格切断（默认 5s），防止长事务拖垮下游 ERP。
   - **Token 节约与数据裁剪**：支持 `pickFields` 出参过滤，杜绝几百行原始 JSON 污染模型上下文。
   - **全链路追踪**：生成全局唯一 `traceId` 并通过 `X-Trace-Id` 传递给 Java 业务系统。
4. **Spring Boot 极简集成**
   - 提供 `@McpTool` 注解，Java ERP 启动时自动扫描并批量上报，实现“Java 写完接口加个注解，大模型立刻可用”。

---

## 🚀 快速启动

### 方式一：本地开发调试

```bash
# 1. 安装依赖
npm install

# 2. 编译项目
npm run build

# 3. 启动服务 (读取 .env 配置)
npm run dev
```

服务启动后：
- SSE 长连接端点：`http://localhost:3000/sse`
- 消息发送端点：`http://localhost:3000/messages`
- 工具管理端点：`http://localhost:3000/admin/tools`
- 健康探活端点：`http://localhost:3000/healthz`

---

### 方式二：Docker All-in-One 单容器极简部署（推荐）

本架构采用 **All-in-One 单容器设计**：在单个轻量 Alpine 容器内同时运行 **Nginx 反向代理** 与 **Node.js MCP 核心服务**。
- **SSE 流式深度优化**：内置 Nginx 预配置 `proxy_buffering off;` 与 3600 秒长连接超时，彻底解决网关层缓冲截断问题。
- **动态 SSL/TLS 支持**：支持挂载 SSL 证书自适应启用 443 HTTPS，保障内网传输及 `MCP_API_KEY` 凭据安全。
- **极低开销**：无需独立启动 Redis 或额外 Nginx 容器，单容器总内存开销仅约 60MB。

#### 1. 使用 Docker Compose 启动

```bash
cd deploy
docker-compose up -d --build
```
该命令会自动构建并启动 `enterprise-mcp-server`，监听宿主机 `80` (HTTP) 与 `443` (HTTPS) 端口。

#### 2. 直接使用 Docker 命令行启动

```bash
# 构建镜像
docker build -t erp-mcp-server -f deploy/Dockerfile .

# 启动单容器 (仅 HTTP)
docker run -d --name enterprise-mcp-server \
  -p 80:80 \
  -v $(pwd)/data:/app/data \
  -e MCP_API_KEY=mcp-secret-key-prod-2026 \
  erp-mcp-server

# (可选) 启用 HTTPS：挂载本地证书目录即可自动启用 443 端口
docker run -d --name enterprise-mcp-server \
  -p 80:80 -p 443:443 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/certs:/etc/nginx/certs:ro \
  -e MCP_API_KEY=mcp-secret-key-prod-2026 \
  erp-mcp-server
```

> **提示**：只需将 `cert.pem` 与 `key.pem`（或 `tls.crt` 与 `tls.key`）放入 `certs/` 目录，容器启动时将自动识别并加载 HTTPS 配置。

---

## 📡 API 管理端点一览

所有 `/admin/*` 接口均需携带 Header: `X-API-Key: <你的MCP_API_KEY>` 或 `Authorization: Bearer <你的MCP_API_KEY>`。

| 接口 | 方法 | 说明 |
| :--- | :--- | :--- |
| `/admin/tools` | `GET` | 查询当前已加载的所有工具元数据 |
| `/admin/tools/register` | `POST` | 动态注册或更新单个工具（即时广播） |
| `/admin/tools/batch` | `POST` | 批量注册工具（供 Spring Boot 启动自动同步） |
| `/admin/tools/:toolName` | `DELETE`| 动态下线某个工具（即时向客户端广播移除） |
| `/admin/tools/:toolName/toggle` | `PATCH` | 快速启用/禁用工具 |
| `/healthz` | `GET` | 节点探活状态与当前会话数 |

---

## 📖 Spring Boot 集成指南

详细的 Spring Boot 工程配置与 `@McpTool` 源码请参考文档：
👉 [docs/springboot-mcp-guide.md](docs/springboot-mcp-guide.md)

---

## 🤖 客户端连接配置示例

在 Claude Desktop 或其它 MCP 客户端配置中添加：

```json
{
  "mcpServers": {
    "enterprise-erp": {
      "url": "http://your-server-ip:3000/sse",
      "headers": {
        "Authorization": "Bearer test-secret-key-123456"
      }
    }
  }
}
```
