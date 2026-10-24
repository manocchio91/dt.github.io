# Immagine CPU, utente non root, NESSUN peso del modello incluso.
# I pesi si montano in /models (cache Hugging Face) o si scaricano al primo avvio
# alla revisione bloccata; il container può girare offline con HF_HUB_OFFLINE=1.
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    HF_HOME=/models UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 app && mkdir /models && chown app /models
COPY --from=ghcr.io/astral-sh/uv:0.7.3 /uv /usr/local/bin/uv
WORKDIR /srv
COPY pyproject.toml uv.lock* ./
RUN uv sync --no-dev --extra timestral --no-install-project
COPY app ./app
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/health').status==200 else 1)"
CMD [".venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
