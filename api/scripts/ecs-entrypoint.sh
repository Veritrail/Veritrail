#!/bin/sh
set -e

# When APP_CONFIG is injected from Secrets Manager (JSON object), export each key
# as an environment variable before the container command runs.
if [ -n "${APP_CONFIG:-}" ]; then
  eval "$(python - <<'PY'
import json, os, shlex
raw = os.environ.get("APP_CONFIG", "")
if not raw:
    raise SystemExit(0)
data = json.loads(raw)
for key, value in data.items():
    if value is None:
        continue
    print(f"export {key}={shlex.quote(str(value))}")
PY
)"
fi

exec "$@"
