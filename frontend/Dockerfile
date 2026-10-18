# The Craton web app (Next.js, standalone output).
#
#   docker build -t craton-web frontend
#   docker run -p 3100:3100 -e CRATON_API_URL=http://api:4000 craton-web
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm install` rather than `npm ci`: the lock file was made on Windows and lists only that platform's optional native packages (Tailwind's
# oxide, lightningcss), which `npm ci` refuses to add on Linux. Versions still come from the lock file.
RUN npm install --no-audit --no-fund

FROM node:24-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3100 \
    HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
USER node
EXPOSE 3100
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/login').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
