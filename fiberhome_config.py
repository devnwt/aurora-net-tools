import copy
import os
import json
from pathlib import Path
from urllib.parse import quote_plus


DEFAULT_INVENTORY_PATH = str(Path(__file__).parent / "olts_fiberhome.json")


def get_inventory_path() -> str:
    return os.getenv("INVENTORY_PATH") or DEFAULT_INVENTORY_PATH


def _env_int(name: str):
    value = os.getenv(name)
    if value is None or value == "":
        return None
    return int(value)


def _mongo_uri_from_env() -> str | None:
    explicit_uri = os.getenv("MONGO_URI") or os.getenv("MONGODB_URI")
    if explicit_uri:
        return explicit_uri

    host = os.getenv("MONGO_HOST")
    if not host:
        return None

    port = os.getenv("MONGO_PORT", "27017")
    username = os.getenv("MONGO_USERNAME") or ""
    password = os.getenv("MONGO_PASSWORD") or ""

    if username:
        auth = quote_plus(username)
        if password:
            auth += f":{quote_plus(password)}"
        auth += "@"
    else:
        auth = ""

    return f"mongodb://{auth}{host}:{port}/"


def apply_env_overrides(config: dict) -> dict:
    """Return config with .env overrides applied over olts_fiberhome.json."""
    cfg = copy.deepcopy(config)
    cfg.setdefault("unm2000", {})
    cfg.setdefault("mongodb", {})

    tl1_host = os.getenv("TL1_HOST")
    tl1_port = _env_int("TL1_PORT")
    tl1_username = os.getenv("TL1_USERNAME")
    tl1_password = os.getenv("TL1_PASSWORD")

    if tl1_host:
        cfg["unm2000"]["ip"] = tl1_host
    if tl1_port is not None:
        cfg["unm2000"]["porta"] = tl1_port
    if tl1_username:
        cfg["unm2000"]["usuario"] = tl1_username
    if tl1_password:
        cfg["unm2000"]["senha"] = tl1_password

    mongo_uri = _mongo_uri_from_env()
    mongo_database = os.getenv("MONGO_DATABASE") or os.getenv("MONGODB_DATABASE")
    mongo_collection = os.getenv("MONGO_COLLECTION") or os.getenv("MONGO_ONUS_COLLECTION")
    mongo_sync_status_collection = os.getenv("MONGO_SYNC_STATUS_COLLECTION")

    if mongo_uri:
        cfg["mongodb"]["uri"] = mongo_uri
    if mongo_database:
        cfg["mongodb"]["database"] = mongo_database
    if mongo_collection:
        cfg["mongodb"]["onus_collection"] = mongo_collection
    if mongo_sync_status_collection:
        cfg["mongodb"]["sync_status_collection"] = mongo_sync_status_collection

    return cfg


def load_config(inventory_path: str | None = None) -> dict:
    with open(inventory_path or get_inventory_path(), "r") as f:
        return apply_env_overrides(json.load(f))
