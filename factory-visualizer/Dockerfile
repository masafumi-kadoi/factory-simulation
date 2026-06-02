FROM nginx:alpine
ARG BASE_PREFIX=""
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY html/ /usr/share/nginx/html/
# Inject path prefix at build time (empty = local standalone, "/digital-twin" = densei-system)
RUN find /usr/share/nginx/html -type f \( -name '*.js' -o -name '*.html' \) \
      -exec sed -i "s|__BASE_PREFIX__|${BASE_PREFIX}|g" {} +
