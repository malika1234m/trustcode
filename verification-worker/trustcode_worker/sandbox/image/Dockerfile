# TrustCode test sandbox image. Runs UNTRUSTED code + tests. Started only by the worker with:
#   --network none --read-only --tmpfs /tmp:noexec --cap-drop ALL --cap-add SETUID,SETGID,KILL
#   --security-opt no-new-privileges --pids-limit --memory --cpus   (see sandbox/docker_runner.py)
# The trusted runner runs as container-root with only those three capabilities; it executes the
# untrusted tests as uid 65534 in their own process group, so they cannot open /proc/1/* (the
# runner's result pipe) and are killed before the result is emitted (ADR-003, threat T-7).
FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir pytest==8.3.3 coverage==7.6.1
COPY runner.py /opt/trustcode/runner.py
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HOME=/tmp
WORKDIR /tmp
ENTRYPOINT ["python", "/opt/trustcode/runner.py"]
