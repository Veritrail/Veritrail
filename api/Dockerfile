# syntax=docker/dockerfile:1
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev \
    pkg-config libxml2-dev libxmlsec1-dev libxmlsec1-openssl \
    && rm -rf /var/lib/apt/lists/*

COPY api/requirements.txt api/requirements-dev.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt -r requirements-dev.txt

COPY api/ .

EXPOSE 8000
