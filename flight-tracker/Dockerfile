FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
ENV PORT=8080
EXPOSE 8080
USER node
HEALTHCHECK CMD wget -qO- http://localhost:8080/healthz || exit 1
CMD ["node", "server.js"]
