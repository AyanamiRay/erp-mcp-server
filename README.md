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

### 方式二：Docker 极简单容器部署（推荐）

整个工程无需额外安装 Redis 或 Nginx，**只需启动 1 个容器**（内存仅占约 50MB）：

```bash
cd deploy
docker-compose up -d --build
```
该命令会自动构建并启动：
- `enterprise-mcp-server`: 独立运行在 `3000` 端口，自动使用内置单机事件总线，并将数据挂载至宿主机的 `data/` 目录。

> **提示**：如果你想不用 docker-compose，也可以直接单条命令运行：
> ```bash
> docker run -d --name mcp-server \
>   -p 3000:3000 \
>   -v $(pwd)/data:/app/data \
>   -e MCP_API_KEY=mcp-secret-key-prod-2026 \
>   enterprise-mcp-server
> ```

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
