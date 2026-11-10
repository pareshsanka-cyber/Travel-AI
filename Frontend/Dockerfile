FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Inject backend URL at build time
ARG VITE_FASTAPI_URL=http://localhost:8000
ENV VITE_FASTAPI_URL=$VITE_FASTAPI_URL

RUN npm run build

# --- Serve stage ---
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
