import logging
import sys


def configure_logging() -> None:
    """Logging estruturado simples (linha única, nível + logger + msg)."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s", "%Y-%m-%dT%H:%M:%S%z")
    )
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)
    # Reduz ruído do uvicorn access; mantém o nosso.
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
