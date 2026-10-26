# Immagine CPU, utente non root, NESSUN peso del modello incluso.
# I pesi si montano in /models (cache Hugging Face, volume Docker) o si scaricano al primo avvio
# alla revisione bloccata; il container può girare offline con HF_HUB_OFFLINE=1.
# Dipendenze bloccate da uv.lock (torch solo CPU, codice Timestral a un commit).

# ---- build: risolve l'ambiente dal lockfile (git serve solo qui, per il pacchetto timestral)
FROM python:3.12-slim AS build
ENV UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1 UV_PYTHON_DOWNLOADS=never
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.7.3 /uv /usr/local/bin/uv
WORKDIR /srv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --extra timestral --no-install-project

# ---- test: stesso ambiente più le dipendenze di sviluppo (pytest), mai in produzione
FROM build AS test
RUN uv sync --frozen --extra timestral --no-install-project
COPY app ./app
COPY tests ./tests
CMD [".venv/bin/pytest", "-q"]

# ---- runtime: solo Python, ambiente virtuale e codice del servizio
FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HF_HOME=/models \
    HF_HUB_DISABLE_TELEMETRY=1 PATH=/srv/.venv/bin:$PATH
RUN useradd --create-home --uid 10001 app && mkdir /models && chown app /models
WORKDIR /srv
COPY --from=build /srv/.venv ./.venv
COPY app ./app
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/health').status==200 else 1)"
# arresto controllato: uvicorn chiude le richieste in corso entro 20 s dopo SIGTERM
STOPSIGNAL SIGTERM
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--timeout-graceful-shutdown", "20"]
