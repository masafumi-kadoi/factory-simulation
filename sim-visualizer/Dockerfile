# Nginx-based static file server for 3D visualization
FROM nginx:alpine

# Copy HTML and assets
COPY html/ /usr/share/nginx/html/

# Configure nginx
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
