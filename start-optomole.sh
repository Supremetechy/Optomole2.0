#!/usr/bin/env bash
set -Eeuo pipefail

# Resolve the repo root robustly: works whether this script lives at the repo
# root or under scripts/. Pick the ancestor dir that actually contains api/.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -d "$SCRIPT_DIR/api" && -d "$SCRIPT_DIR/frontend" ]]; then
  ROOT_DIR="$SCRIPT_DIR"
else
  ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
LOG_DIR="$ROOT_DIR/.optomole-data/dev/logs"
PID_DIR="$ROOT_DIR/.optomole-data/dev/pids"
OBJECT_DIR="$ROOT_DIR/.optomole-data/objects"

INSTALL_DEPS=0
USE_DOCKER_INFRA=1

usage() {
  cat <<'USAGE'
Usage: scripts/start-optomole.sh [options]

Starts the local Optomole beta stack:
  - RabbitMQ, Redis, and MinIO through docker/compose.dev.yml
  - NestJS API gateway on http://localhost:8080
  - Build worker
  - Vite frontend on http://localhost:3000

Options:
  --install       Run npm install in api/, frontend/, and worker/ before start.
  --no-docker     Skip RabbitMQ/Redis/MinIO startup. Use only if those services
                  are already running or you are using memory-mode env overrides.
  -h, --help      Show this help.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install)
      INSTALL_DEPS=1
      ;;
    --no-docker)
      USE_DOCKER_INFRA=0
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
  shift
done

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

wait_for_http() {
  local name="$1"
  local url="$2"
  local attempts="${3:-60}"

  printf "Waiting for %s" "$name"
  for _ in $(seq 1 "$attempts"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      printf "\n"
      return 0
    fi
    printf "."
    sleep 1
  done
  printf "\n"
  echo "$name did not become ready at $url" >&2
  return 1
}

start_process() {
  local name="$1"
  local workdir="$2"
  shift 2

  local log_file="$LOG_DIR/$name.log"
  echo "Starting $name. Log: $log_file"
  (
    cd "$workdir"
    "$@"
  ) >"$log_file" 2>&1 &

  local pid=$!
  echo "$pid" > "$PID_DIR/$name.pid"
}

stop_processes() {
  echo
  echo "Stopping Optomole local services..."
  for pid_file in "$PID_DIR"/*.pid; do
    [[ -e "$pid_file" ]] || continue
    local pid
    pid="$(cat "$pid_file")"
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done
  rm -f "$PID_DIR"/*.pid

  if [[ "$USE_DOCKER_INFRA" -eq 1 ]] && command -v docker >/dev/null 2>&1; then
    docker compose -f "$ROOT_DIR/docker/compose.dev.yml" stop rabbitmq redis minio >/dev/null 2>&1 || true
  fi
}

trap stop_processes INT TERM EXIT

require_command node
require_command npm
require_command curl

if [[ "$USE_DOCKER_INFRA" -eq 1 ]]; then
  require_command docker
fi

mkdir -p "$LOG_DIR" "$PID_DIR" "$OBJECT_DIR"

if [[ "$INSTALL_DEPS" -eq 1 ]]; then
  echo "Installing npm dependencies..."
  (cd "$ROOT_DIR/api" && npm install)
  (cd "$ROOT_DIR/frontend" && npm install)
  (cd "$ROOT_DIR/worker" && npm install)
else
  for package_dir in api frontend worker; do
    if [[ ! -d "$ROOT_DIR/$package_dir/node_modules" ]]; then
      echo "$package_dir/node_modules is missing. Re-run with --install." >&2
      exit 1
    fi
  done
fi

if [[ ! -f "$ROOT_DIR/.env" ]]; then
  cat > "$ROOT_DIR/.env" <<'ENV'
PORT=8080
NODE_ENV=development
CORS_ORIGIN=*
BUILD_QUEUE_MODE=rabbitmq
BUILD_QUEUE_NAME=optomole.build.jobs
RABBITMQ_URL=amqp://localhost:5672
REDIS_URL=redis://localhost:6379
OBJECT_STORAGE_MODE=memory
PUBLIC_GATEWAY_URL=http://localhost:8080
CDN_BASE_URL=http://localhost:9000/optomole
WORKER_CALLBACK_TOKEN=dev-worker-token
INTERNAL_API_TOKEN=dev-internal-token
TEMPLATE_REGISTRY_PATH=../templates/registry.json
BROWSER_ENGINE_PATH=../browser-engine
LOCAL_OBJECT_STORE_PATH=../.optomole-data/objects
API_URL=http://localhost:8080
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ROOT_USER=optomole
MINIO_ROOT_PASSWORD=optomole-dev-password
MINIO_BUCKET=optomole-artifacts
SIMULATE_UNREAL=1
SIMULATE_UNITY=1
SIMULATE_BLENDER=1
ENV
  echo "Created local .env with development defaults."
fi

# Load the dev .env without `source`: values here can contain spaces/backslashes
# (e.g. a Windows UE_PATH) that are valid for Node's --env-file but break bash
# `source` word-splitting. Export each KEY=VALUE line as a single quoted arg so
# the whole value is preserved literally; skip comments and blank lines.
if [[ -f "$ROOT_DIR/.env" ]]; then
  while IFS= read -r env_line || [[ -n "$env_line" ]]; do
    env_line="${env_line#"${env_line%%[![:space:]]*}"}"   # strip leading whitespace
    [[ -z "$env_line" || "$env_line" == \#* ]] && continue # skip blanks/comments
    [[ "$env_line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] || continue # skip non-assignments (prose, etc.)
    export "$env_line"
  done < "$ROOT_DIR/.env"
fi

if [[ "$USE_DOCKER_INFRA" -eq 1 ]]; then
  echo "Starting Docker infrastructure..."
  docker compose -f "$ROOT_DIR/docker/compose.dev.yml" up -d rabbitmq redis minio
  wait_for_http "RabbitMQ management" "http://localhost:15672" 60
  wait_for_http "MinIO console" "http://localhost:9001" 60
fi

export VITE_OPTOMOLE_API_URL="${VITE_OPTOMOLE_API_URL:-http://localhost:8080/v1}"

start_process "api" "$ROOT_DIR/api" npm run start:dev
wait_for_http "Optomole API" "http://localhost:8080/v1/health" 90

start_process "worker" "$ROOT_DIR/worker" npm start
start_process "frontend" "$ROOT_DIR/frontend" npm run dev
wait_for_http "Optomole frontend" "http://localhost:3000" 90

cat <<READY

Optomole is running.

Frontend: http://localhost:3000
API:      http://localhost:8080/v1
Docs:     http://localhost:8080/docs
RabbitMQ: http://localhost:15672
MinIO:    http://localhost:9001

Logs are in:
  $LOG_DIR

Press Ctrl+C to stop the local stack.
READY

while true; do
  sleep 3600
done
