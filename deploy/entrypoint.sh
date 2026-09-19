#!/bin/bash
set -e

echo "=========================================================="
echo " Starting ERP MCP Server (All-in-One Single Container)    "
echo " Internal Architecture: Nginx (Proxy/SSE) + Node.js (MCP) "
echo "=========================================================="

# 1. 确保必要目录存在
mkdir -p /app/data /run/nginx /var/log/nginx /etc/nginx/conf.d /etc/nginx/certs
chown -R node:node /app/data

# 2. 动态 SSL / TLS 证书检测与配置
CERT_FILE=""
KEY_FILE=""

if [ -f "/etc/nginx/certs/cert.pem" ] && [ -f "/etc/nginx/certs/key.pem" ]; then
    CERT_FILE="/etc/nginx/certs/cert.pem"
    KEY_FILE="/etc/nginx/certs/key.pem"
elif [ -f "/etc/nginx/certs/tls.crt" ] && [ -f "/etc/nginx/certs/tls.key" ]; then
    CERT_FILE="/etc/nginx/certs/tls.crt"
    KEY_FILE="/etc/nginx/certs/tls.key"
fi

if [ -n "$CERT_FILE" ] && [ -n "$KEY_FILE" ]; then
    echo "[All-in-One] SSL certificates detected ($CERT_FILE, $KEY_FILE). Enabling HTTPS on port 443..."
    cat <<EOF > /etc/nginx/conf.d/ssl.conf
server {
    listen 443 ssl;
    server_name _;

    ssl_certificate $CERT_FILE;
    ssl_certificate_key $KEY_FILE;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    client_max_body_size 20M;

    # 探活直接转发
    location /healthz {
        proxy_pass http://127.0.0.1:3000/healthz;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        access_log off;
    }

    # 核心：SSE 长连接与 API 反向代理
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # 关闭反代缓冲，保证流式推送实时性
        proxy_buffering off;
        proxy_cache off;

        # 超时时间延长至 1 小时
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;

        proxy_set_header Connection '';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
EOF
else
    echo "[All-in-One] No SSL certificates detected. Running in HTTP-only mode (port 80)."
    rm -f /etc/nginx/conf.d/ssl.conf
fi

# 3. 优雅启停信号捕获
stop_services() {
    echo ""
    echo "[All-in-One] Received termination signal. Shutting down gracefully..."
    if [ -n "$NGINX_PID" ]; then
        echo "[All-in-One] Stopping Nginx (PID: $NGINX_PID)..."
        nginx -s quit 2>/dev/null || kill -TERM "$NGINX_PID" 2>/dev/null || true
    fi
    if [ -n "$NODE_PID" ]; then
        echo "[All-in-One] Stopping Node.js MCP Server (PID: $NODE_PID)..."
        kill -TERM "$NODE_PID" 2>/dev/null || true
        wait "$NODE_PID" 2>/dev/null || true
    fi
    echo "[All-in-One] All services stopped gracefully."
    exit 0
}

trap stop_services SIGTERM SIGINT

# 4. 启动 Node.js MCP 服务 (切换至非特权 node 用户后台运行)
echo "[All-in-One] Starting Node.js MCP Server on 127.0.0.1:3000..."
su-exec node node dist/index.js &
NODE_PID=$!

# 5. 等待 Node.js 健康检查通过 (最长等待 30 秒)
echo "[All-in-One] Waiting for Node.js MCP service to be healthy..."
RETRIES=30
until curl -sf http://127.0.0.1:3000/healthz > /dev/null 2>&1 || [ $RETRIES -eq 0 ]; do
    sleep 1
    RETRIES=$((RETRIES - 1))
done

if [ $RETRIES -eq 0 ]; then
    echo "[All-in-One] ERROR: Node.js MCP service failed to start within 30 seconds."
    kill -TERM "$NODE_PID" 2>/dev/null || true
    exit 1
fi

echo "[All-in-One] Node.js MCP service is healthy and ready."

# 6. 启动 Nginx (前台运行，接管流量并监听容器信号)
echo "[All-in-One] Starting Nginx reverse proxy..."
nginx -g "daemon off;" &
NGINX_PID=$!

echo "[All-in-One] ERP MCP Server is fully operational!"
echo "[All-in-One] HTTP Endpoint: http://0.0.0.0:80"
if [ -f "/etc/nginx/conf.d/ssl.conf" ]; then
    echo "[All-in-One] HTTPS Endpoint: https://0.0.0.0:443"
fi

# 7. 持续守护 Node 与 Nginx 进程
wait -n "$NODE_PID" "$NGINX_PID"
EXIT_STATUS=$?
echo "[All-in-One] Process exited with status $EXIT_STATUS. Cleaning up..."
stop_services
exit $EXIT_STATUS
