FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# net-snmp (driver SNMP), ssh/telnet (drivers) e ping (teste de latência ICMP)
RUN apt-get update \
    && apt-get install -y --no-install-recommends snmp openssh-client telnet iputils-ping \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# MIBs (grandes e estáticas) numa camada própria — embutidas na imagem
# (self-contained para o registry Harbor). O entrypoint monta MIDIRS a partir
# dos subdiretórios de /app/mibs.
COPY mibs /app/mibs
ENV MIBDIRS=/app/mibs

# Código da aplicação (camada separada — não invalida a das MIBs em rebuilds).
COPY app /app/app
COPY alembic /app/alembic
COPY tests /app/tests
COPY alembic.ini pytest.ini ./

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
