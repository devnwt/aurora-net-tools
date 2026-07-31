#!/usr/bin/env python3
"""Receptor de webhook do Harbor — dispara o deploy quando uma release nova é publicada.

Roda NO SERVIDOR de produção, ao lado do deploy.sh. O GitHub Actions continua
sem acesso à produção: ele só publica no Harbor, e o Harbor avisa este serviço.

    Harbor (PUSH_ARTIFACT) ──▶ webhook.py ──▶ deploy/deploy.sh <tag>

Só depende da stdlib. Configuração por ambiente (ver aurora-webhook.service):

    AURORA_WEBHOOK_SECRET   obrigatório — precisa bater com o "Auth Header" do Harbor
    AURORA_WEBHOOK_BIND     default 0.0.0.0
    AURORA_WEBHOOK_PORT     default 9000
    AURORA_DEPLOY_SCRIPT    default <dir deste arquivo>/deploy.sh
    AURORA_REGISTRY         default registry.aurora.app.br/aurora-nettools
"""

from __future__ import annotations

import hmac
import json
import logging
import os
import re
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))

SECRET = os.environ.get("AURORA_WEBHOOK_SECRET", "")
BIND = os.environ.get("AURORA_WEBHOOK_BIND", "0.0.0.0")
PORT = int(os.environ.get("AURORA_WEBHOOK_PORT", "9000"))
DEPLOY_SCRIPT = os.environ.get("AURORA_DEPLOY_SCRIPT", os.path.join(HERE, "deploy.sh"))
REGISTRY = os.environ.get("AURORA_REGISTRY", "registry.aurora.app.br/aurora-nettools")
PATH = "/harbor-webhook"


def _required_repos() -> tuple[str, ...]:
    """Repositórios que precisam existir no registry antes de implantar.

    Lidos do compose de deploy, que é exatamente o que o `deploy.sh` vai puxar.
    Uma lista fixa aqui ficou para trás quando o serviço 'backup' entrou no
    compose: o webhook liberaria o deploy sem esperar aquela imagem e o `pull`
    abortaria a release inteira. Se o arquivo não for legível, cai na tripla
    histórica — melhor esperar de menos do que não subir.
    """
    compose = os.path.join(os.path.dirname(HERE), "docker-compose.harbor.yml")
    try:
        with open(compose, encoding="utf-8") as fh:
            found = re.findall(r"}/([a-z0-9_-]+):\$\{IMAGE_TAG", fh.read())
    except OSError:
        found = []
    return tuple(sorted(set(found))) or ("backend", "frontend", "proxy")


# A stack só sobe inteira: o deploy espera todas existirem no registry.
REQUIRED_REPOS = _required_repos()
# Tag de release é o SHA curto que o workflow publica. 'latest' é alias móvel e
# é ignorado de propósito — implantá-lo apagaria o alvo do rollback.
TAG_RE = re.compile(r"^[0-9a-f]{7,40}$")
# Quanto esperar as imagens aparecerem (o push do conjunto não é atômico).
WAIT_ALL_TIMEOUT = int(os.environ.get("AURORA_WAIT_TIMEOUT", "900"))
DEPLOY_TIMEOUT = int(os.environ.get("AURORA_DEPLOY_TIMEOUT", "1800"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("aurora-webhook")


def manifest_exists(repo: str, tag: str) -> bool:
    """Usa o docker login já configurado no host — sem credencial extra aqui."""
    return (
        subprocess.run(
            ["docker", "manifest", "inspect", f"{REGISTRY}/{repo}:{tag}"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=60,
        ).returncode
        == 0
    )


class Deployer:
    """Serializa os deploys e absorve os webhooks duplicados.

    O push-harbor.sh publica vários repositórios × 2 tags, então o Harbor
    dispara vários eventos para a MESMA release. Aqui eles viram um deploy só:
    - enquanto um deploy roda, os eventos que chegam só atualizam o 'pendente';
    - o pendente guarda a tag MAIS NOVA (se duas releases entram em sequência,
      a antiga é descartada em vez de ser implantada depois da nova);
    - uma tag já implantada com sucesso é ignorada.
    """

    def __init__(self) -> None:
        self._cv = threading.Condition()
        self._pending: str | None = None
        self._last_ok: str | None = None
        self._running: str | None = None
        threading.Thread(target=self._loop, daemon=True, name="deployer").start()

    def request(self, tag: str) -> str:
        with self._cv:
            if tag == self._last_ok:
                return "ignorada (já implantada)"
            if tag == self._running:
                return "ignorada (deploy em andamento)"
            if tag == self._pending:
                return "ignorada (já enfileirada)"
            self._pending = tag
            self._cv.notify()
            return "enfileirada"

    def _loop(self) -> None:
        while True:
            with self._cv:
                while self._pending is None:
                    self._cv.wait()
                tag = self._pending
                self._pending = None
                self._running = tag
            try:
                self._deploy(tag)
            except Exception:
                log.exception("erro inesperado no deploy de %s", tag)
            finally:
                with self._cv:
                    self._running = None

    def _deploy(self, tag: str) -> None:
        # O push do conjunto não é atômico: o evento do backend pode chegar
        # antes do frontend estar no registry. Sem esta espera, o deploy puxaria
        # uma tag que ainda não existe e abortaria à toa.
        log.info("[%s] aguardando as %d imagens no registry...", tag, len(REQUIRED_REPOS))
        deadline = time.monotonic() + WAIT_ALL_TIMEOUT
        missing = set(REQUIRED_REPOS)
        while missing and time.monotonic() < deadline:
            for repo in sorted(missing):
                if manifest_exists(repo, tag):
                    missing.discard(repo)
                    log.info("[%s]   %s ✓", tag, repo)
            if missing:
                time.sleep(5)
        if missing:
            log.error("[%s] desisti: %s não apareceram em %ds", tag, sorted(missing), WAIT_ALL_TIMEOUT)
            return

        log.info("[%s] executando %s", tag, DEPLOY_SCRIPT)
        try:
            proc = subprocess.run(
                [DEPLOY_SCRIPT, tag],
                cwd=HERE,
                capture_output=True,
                text=True,
                timeout=DEPLOY_TIMEOUT,
            )
        except subprocess.TimeoutExpired:
            log.error("[%s] deploy estourou %ds", tag, DEPLOY_TIMEOUT)
            return

        for line in (proc.stdout or "").splitlines():
            log.info("[%s] %s", tag, line)
        for line in (proc.stderr or "").splitlines():
            log.warning("[%s] %s", tag, line)

        if proc.returncode == 0:
            with self._cv:
                self._last_ok = tag
            log.info("[%s] ✅ deploy concluído", tag)
        else:
            # Não marca last_ok: um novo push da mesma tag pode tentar de novo.
            log.error("[%s] ❌ deploy falhou (exit %d)", tag, proc.returncode)


DEPLOYER = Deployer()


class Handler(BaseHTTPRequestHandler):
    server_version = "aurora-webhook"

    def log_message(self, fmt: str, *args) -> None:  # silencia o log padrão
        log.debug("%s - %s", self.address_string(), fmt % args)

    def _reply(self, code: int, msg: str) -> None:
        body = json.dumps({"detail": msg}).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        # Sonda de saúde — sem segredo, sem informação sensível.
        if self.path == "/health":
            self._reply(200, "ok")
        else:
            self._reply(404, "not found")

    def do_POST(self) -> None:
        if self.path.split("?")[0] != PATH:
            self._reply(404, "not found")
            return

        # compare_digest evita vazar o segredo por diferença de tempo.
        sent = self.headers.get("Authorization", "")
        if not hmac.compare_digest(sent, SECRET):
            log.warning("401 de %s (Authorization inválido)", self.address_string())
            self._reply(401, "unauthorized")
            return

        try:
            n = int(self.headers.get("Content-Length", "0"))
            if n <= 0 or n > 1_000_000:
                raise ValueError("tamanho inválido")
            payload = json.loads(self.rfile.read(n))
        except Exception as e:
            self._reply(400, f"payload inválido: {e}")
            return

        if payload.get("type") != "PUSH_ARTIFACT":
            self._reply(200, f"evento ignorado: {payload.get('type')}")
            return

        data = payload.get("event_data") or {}
        repo = (data.get("repository") or {}).get("name", "")
        namespace = (data.get("repository") or {}).get("namespace", "")
        expected_ns = REGISTRY.rsplit("/", 1)[-1]
        if namespace != expected_ns:
            self._reply(200, f"namespace ignorado: {namespace}")
            return
        if repo not in REQUIRED_REPOS:
            self._reply(200, f"repositório ignorado: {repo}")
            return

        tags = [r.get("tag") for r in (data.get("resources") or []) if r.get("tag")]
        release = next((t for t in tags if TAG_RE.match(t)), None)
        if not release:
            # 'latest' cai aqui — e é o comportamento desejado.
            self._reply(200, f"sem tag de release em {tags}")
            return

        result = DEPLOYER.request(release)
        log.info("evento %s:%s -> %s", repo, release, result)
        # 202: o deploy leva minutos; segurar a conexão faria o Harbor dar timeout
        # e reenviar, multiplicando os disparos.
        self._reply(202, f"{release}: {result}")


def main() -> None:
    if not SECRET:
        raise SystemExit(
            "AURORA_WEBHOOK_SECRET não definido — sem segredo, qualquer requisição "
            "dispararia um deploy em produção."
        )
    if not os.access(DEPLOY_SCRIPT, os.X_OK):
        raise SystemExit(f"{DEPLOY_SCRIPT} não existe ou não é executável.")

    # Registrar os repositórios no boot torna o log a primeira coisa a consultar
    # quando um deploy automático não sai: dá para ver se a lista bate com o
    # compose sem precisar reproduzir um push.
    log.info(
        "ouvindo em %s:%d%s  (registry: %s, repos: %s)",
        BIND, PORT, PATH, REGISTRY, ", ".join(REQUIRED_REPOS),
    )
    ThreadingHTTPServer((BIND, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
