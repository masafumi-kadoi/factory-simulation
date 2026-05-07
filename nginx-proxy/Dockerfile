FROM nginx:alpine

RUN apk add --no-cache openssl

RUN mkdir -p /etc/nginx/ssl

COPY nginx.conf /etc/nginx/conf.d/default.conf

RUN openssl req -x509 -nodes -days 3650 \
  -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/server.key \
  -out /etc/nginx/ssl/server.crt \
  -subj "/CN=factory-sim.local" \
  -addext "subjectAltName=DNS:factory-sim.local,DNS:localhost,IP:127.0.0.1"

EXPOSE 80 443
