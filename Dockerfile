FROM node:20-alpine

# Embedded Postgres for the quick-start single-container experience.
# For production use docker-compose.yml (separate postgres service).
RUN apk add --no-cache postgresql postgresql-contrib su-exec

ENV PGDATA=/var/lib/postgresql/data

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:types

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 8080
ENTRYPOINT ["/docker-entrypoint.sh"]
