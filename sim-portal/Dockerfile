FROM nginx:alpine

# Create ssl directory for volume mount
RUN mkdir -p /etc/nginx/ssl

COPY html/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf
