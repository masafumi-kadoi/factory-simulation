FROM golang:1.21-alpine AS builder

RUN apk add --no-cache git

WORKDIR /build
COPY . .
RUN go mod tidy && go mod download
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o server ./cmd/server

FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=builder /build/server .
EXPOSE 8090
CMD ["./server"]
