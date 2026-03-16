# Nginx-based static file server for 3D visualization
FROM nginx:alpine

# Copy HTML and assets
COPY sim-visualizer/html/ /usr/share/nginx/html/
COPY shared/ /usr/share/nginx/html/shared/

# Configure nginx
COPY sim-visualizer/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
