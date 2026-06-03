FROM golang:1.22-alpine AS hclpatch
WORKDIR /src
COPY tools/hclpatch/ ./
RUN go mod download && go build -o /usr/local/bin/hclpatch .

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev curl unzip \
    pkg-config libxml2-dev libxmlsec1-dev libxmlsec1-openssl \
    && rm -rf /var/lib/apt/lists/*

ARG TERRAFORM_VERSION=1.9.8
RUN curl -fsSL "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_amd64.zip" -o /tmp/tf.zip \
    && unzip /tmp/tf.zip -d /usr/local/bin && rm /tmp/tf.zip

COPY --from=hclpatch /usr/local/bin/hclpatch /usr/local/bin/hclpatch

COPY api/requirements.txt .
RUN pip install -r requirements.txt

COPY api/ .

EXPOSE 8000
