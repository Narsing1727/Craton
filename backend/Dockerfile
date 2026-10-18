# The Craton API. No build step: Node runs the TypeScript directly.
#
#   docker build -t craton-api backend
#   docker run -p 4000:4000 -e CRATON_DATABASE_URL=postgres://... -e CRATON_WEB_URL=https://... craton-api
#
# See OPERATING.md for every setting. Chunks go to S3/R2 when those are configured; otherwise to /data (mount a volume there).
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-slim
ENV NODE_ENV=production \
    PORT=4000 \
    CRATON_DATA_DIR=/data
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY bin ./bin
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4000
# Ready means the database answers (not merely that the process is up).
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/v1/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.ts"]
