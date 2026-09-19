# ==========================================
# 阶段 1: 依赖构建阶段
# ==========================================
FROM node:22-alpine AS builder

WORKDIR /app

# 拷贝依赖描述
COPY package*.json tsconfig.json ./

# 安装完整依赖
RUN npm ci

# 拷贝源代码并编译
COPY src/ ./src/
RUN npm run build

# ==========================================
# 阶段 2: All-in-One 生产运行阶段（Nginx + Node.js 单容器）
# ==========================================
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=127.0.0.1
ENV DATA_DIR=/app/data

# 安装运行 Nginx 与启动脚本所需的基础工具
RUN apk add --no-cache nginx bash curl su-exec

# 仅安装生产依赖
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 拷贝编译产物
COPY --from=builder /app/dist ./dist

# 拷贝 Nginx 内部反向代理配置与 All-in-One 启动守护脚本
COPY deploy/nginx-internal.conf /etc/nginx/nginx.conf
COPY deploy/entrypoint.sh /app/deploy/entrypoint.sh

# 创建相关运行目录，修复换行符并赋予执行权限
RUN mkdir -p /app/data /etc/nginx/conf.d /etc/nginx/certs /run/nginx /var/log/nginx && \
    sed -i 's/\r$//' /app/deploy/entrypoint.sh && \
    chmod +x /app/deploy/entrypoint.sh && \
    chown -R node:node /app/data /app/dist

# 对外暴露 Nginx 监听的 80 (HTTP) 与 443 (HTTPS) 端口
EXPOSE 80 443

# 持久化数据卷
VOLUME ["/app/data"]

# 容器入口：由 entrypoint 自动拉起 Node.js 并由 Nginx 接管流量
ENTRYPOINT ["/bin/bash", "/app/deploy/entrypoint.sh"]
