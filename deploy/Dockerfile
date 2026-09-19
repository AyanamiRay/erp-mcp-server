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
# 阶段 2: 生产运行阶段（轻量化镜像）
# ==========================================
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATA_DIR=/app/data

# 仅安装生产依赖
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 拷贝编译产物
COPY --from=builder /app/dist ./dist

# 创建持久化数据目录并设置用户权限
RUN mkdir -p /app/data && chown -R node:node /app

# 使用内置非 root 用户增强安全性
USER node

EXPOSE 3000

# 挂载数据卷以保存动态工具配置
VOLUME ["/app/data"]

# 启动服务
CMD ["node", "dist/index.js"]
