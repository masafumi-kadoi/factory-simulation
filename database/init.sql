-- PostgreSQL initialization script

-- Create database (run as postgres user)
-- CREATE DATABASE factory_simulation;

-- Connect to the database
\c factory_simulation;

-- Run migrations
\i /docker-entrypoint-initdb.d/migrations/001_init.sql
