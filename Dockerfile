FROM node:20-alpine

WORKDIR /app

# 安装 Git (用于真实代码版本管理与补丁提取)
RUN apk add --no-cache git bash

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

CMD ["npm", "start"]
