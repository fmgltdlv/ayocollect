# Use a slim Python base
FROM python:3.11-slim

# System deps (optional but helpful)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

# Set workdir
WORKDIR /app

# Copy only requirements first (better layer caching)
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# Copy app code
COPY app.py /app/

# Create a writable logs dir for the non-root user
RUN mkdir -p /app/webhook_logs && chown -R 10001:10001 /app/webhook_logs

# (Optional) run as non-root
RUN useradd -u 10001 -m nonroot
USER 10001

# Expose port (Cloud Run sets PORT env var, but it's good practice)
EXPOSE 6000

# Cloud Run sends traffic to $PORT; default to 8080
ENV PORT=6000

#Secret Word
ENV USANORTH_WEBHOOK_SECRET=advanced123

# Start FastAPI with Uvicorn on the given PORT
CMD exec uvicorn app:app --host 0.0.0.0 --port ${PORT}
