# TrustCode test sandbox image. Runs UNTRUSTED code + tests. Started only by the worker with:
#   --network none --read-only --tmpfs /tmp:noexec --cap-drop ALL --security-opt no-new-privileges
#   --pids-limit --memory --cpus --user 65534:65534   (see sandbox/docker_runner.py)
FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir pytest==8.3.3 coverage==7.6.1
COPY runner.py /opt/trustcode/runner.py
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HOME=/tmp
USER 65534:65534
WORKDIR /tmp
ENTRYPOINT ["python", "/opt/trustcode/runner.py"]
