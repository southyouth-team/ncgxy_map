FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    ASSET_STORAGE_DIR=/data/campus-map-assets
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/database/schema.sql ./src/database/schema.sql
EXPOSE 3001
CMD ["node", "dist/main"]

VOLUME ["/data/campus-map-assets"]
