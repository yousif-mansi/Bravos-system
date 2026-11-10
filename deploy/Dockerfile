FROM node:22.23.3-bookworm-slim AS build
WORKDIR /app
RUN npm install -g pnpm@10.34.5
COPY . .
RUN pnpm install --frozen-lockfile
ENV NODE_ENV=production BRAVOS_API_ORIGIN=http://api:3010
ARG VITE_POS_RECEIPT_PHONE
ARG VITE_POS_RECEIPT_PAPER_WIDTH
ENV VITE_POS_RECEIPT_PHONE=${VITE_POS_RECEIPT_PHONE} VITE_POS_RECEIPT_PAPER_WIDTH=${VITE_POS_RECEIPT_PAPER_WIDTH}
RUN pnpm build

FROM node:22.23.3-bookworm-slim AS app
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
RUN chown -R node:node /app/apps/storefront/.next
USER node

FROM nginx:1.27-alpine AS staff
COPY deploy/staff.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/internal/dist /usr/share/nginx/html
