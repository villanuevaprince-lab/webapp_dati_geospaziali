import os
import re
from datetime import datetime, timezone
from pathlib import Path

from bson import ObjectId
from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from pymongo import ASCENDING, GEOSPHERE, MongoClient
from pymongo.errors import PyMongoError
from werkzeug.exceptions import HTTPException


load_dotenv()

PROJECT_ROOT = Path(__file__).resolve().parent
CLIENT_DIR = PROJECT_ROOT / "client"

app = Flask(__name__, static_folder=str(CLIENT_DIR), static_url_path="")

app.config["FLASK_ENV"] = os.getenv("FLASK_ENV", "development")
app.config["PORT"] = int(os.getenv("PORT", "5000"))
app.config["DEBUG"] = app.config["FLASK_ENV"].strip().lower() == "development"
app.config["MONGODB_URI"] = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
app.config["DB_NAME"] = os.getenv("DB_NAME", "dbSpaziali")
app.config["FOUNTAINS_COLLECTION"] = os.getenv("FOUNTAINS_COLLECTION", "vedovelle")
app.config["NIL_COLLECTION"] = os.getenv("NIL_COLLECTION", "nil")
app.config["JSON_SORT_KEYS"] = False

CORS(app, resources={r"/api/*": {"origins": "*"}})


def success_response(data=None, message="OK", status_code=200):
    payload = {
        "ok": True,
        "message": message,
        "data": data if data is not None else {},
    }
    return jsonify(payload), status_code


def error_response(message="Errore", status_code=400, details=None):
    payload = {
        "ok": False,
        "message": message,
        "error": details if details is not None else {},
    }
    return jsonify(payload), status_code


def init_mongo():
    mongodb_uri = app.config["MONGODB_URI"]
    db_name = app.config["DB_NAME"]

    try:
        client = MongoClient(
            mongodb_uri,
            serverSelectionTimeoutMS=5000,
            appname="fontanelle-milano-api",
        )
        client.admin.command("ping")
        db = client[db_name]

        app.extensions["mongo_client"] = client
        app.extensions["mongo_db"] = db
        app.logger.info("Connessione MongoDB inizializzata correttamente")
        return True
    except PyMongoError as exc:
        app.extensions["mongo_client"] = None
        app.extensions["mongo_db"] = None
        app.logger.error("Impossibile connettersi a MongoDB: %s", exc)
        return False


def initialize_fountains_indexes():
    db = app.extensions.get("mongo_db")
    if db is None:
        app.logger.warning("Indice non creato: database MongoDB non inizializzato")
        return False

    collection = db[app.config["FOUNTAINS_COLLECTION"]]

    try:
        collection.create_index([("geometry", GEOSPHERE)], name="geometry_2dsphere_idx")
        collection.create_index([("properties.NIL", ASCENDING)], name="properties_nil_idx")
        collection.create_index([("properties.ID_NIL", ASCENDING)], name="properties_id_nil_idx")
        app.logger.info("Indici MongoDB inizializzati correttamente")
        return True
    except PyMongoError as exc:
        app.logger.error("Errore durante la creazione indici MongoDB: %s", exc)
        return False


def get_fountains_collection():
    db = app.extensions.get("mongo_db")
    if db is None:
        raise ConnectionError("Database MongoDB non disponibile")
    return db[app.config["FOUNTAINS_COLLECTION"]]


def to_object_id_string(value):
    if isinstance(value, ObjectId):
        return str(value)
    if value is None:
        return None
    return str(value)


def validate_point_geometry(geometry):
    if not isinstance(geometry, dict):
        raise ValueError("Il campo geometry deve essere un oggetto GeoJSON")

    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")

    if geometry_type != "Point":
        raise ValueError("Il campo geometry.type deve essere 'Point'")

    if not isinstance(coordinates, list) or len(coordinates) != 2:
        raise ValueError("Il campo geometry.coordinates deve avere [longitude, latitude]")

    lng, lat = coordinates
    if not isinstance(lng, (int, float)) or not isinstance(lat, (int, float)):
        raise ValueError("Le coordinate devono essere numeriche")

    return {
        "type": "Point",
        "coordinates": [float(lng), float(lat)],
    }


def serialize_fountain(document):
    if not isinstance(document, dict):
        raise ValueError("Il documento fontanella deve essere un dizionario")

    properties = document.get("properties")
    if not isinstance(properties, dict):
        properties = {}

    geometry = document.get("geometry")
    if geometry is None:
        geometry = document.get("coordinate")

    normalized_geometry = validate_point_geometry(geometry)

    object_id = properties.get("objectID") or properties.get("OBJECTID")
    nil_name = properties.get("NIL") or document.get("nil")
    cap = properties.get("CAP")
    municipio = properties.get("MUNICIPIO")
    id_nil = properties.get("ID_NIL")
    location = properties.get("Location")

    lng = properties.get("LONG_X_4326")
    lat = properties.get("LAT_Y_4326")
    if lng is None or lat is None:
        lng = normalized_geometry["coordinates"][0]
        lat = normalized_geometry["coordinates"][1]

    return {
        "_id": to_object_id_string(document.get("_id")),
        "type": document.get("type", "Feature"),
        "geometry": normalized_geometry,
        "properties": {
            "objectID": str(object_id) if object_id is not None else None,
            "CAP": cap,
            "MUNICIPIO": str(municipio) if municipio is not None else None,
            "ID_NIL": str(id_nil) if id_nil is not None else None,
            "NIL": nil_name,
            "LONG_X_4326": float(lng),
            "LAT_Y_4326": float(lat),
            "Location": location,
        },
        # Alias di compatibilita con frontend base.
        "nome": f"Fontanella {object_id}" if object_id is not None else "Fontanella",
        "indirizzo": location,
        "nil": nil_name,
        "coordinate": normalized_geometry,
        "descrizione": None,
        "stato": None,
        "tipologia": None,
    }


def serialize_fountains(documents):
    return [serialize_fountain(item) for item in documents]


def to_float(value, field_name):
    if value is None or str(value).strip() == "":
        raise ValueError(f"Parametro '{field_name}' obbligatorio")

    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Parametro '{field_name}' non valido") from exc


def validate_lng_lat(lng_raw, lat_raw):
    lng = to_float(lng_raw, "lng")
    lat = to_float(lat_raw, "lat")

    if lng < -180 or lng > 180:
        raise ValueError("Parametro 'lng' fuori intervallo [-180, 180]")
    if lat < -90 or lat > 90:
        raise ValueError("Parametro 'lat' fuori intervallo [-90, 90]")

    return lng, lat


def validate_radius_meters(radius_raw, default=500, max_radius=5000):
    if radius_raw is None or str(radius_raw).strip() == "":
        radius = default
    else:
        try:
            radius = int(radius_raw)
        except (TypeError, ValueError) as exc:
            raise ValueError("Parametro 'radius' deve essere un intero") from exc

    if radius <= 0:
        raise ValueError("Parametro 'radius' deve essere > 0")
    if radius > max_radius:
        raise ValueError(f"Parametro 'radius' troppo grande (max {max_radius})")

    return radius


def validate_limit(limit_raw, default=100, max_limit=1000):
    if limit_raw is None or str(limit_raw).strip() == "":
        limit = default
    else:
        try:
            limit = int(limit_raw)
        except (TypeError, ValueError) as exc:
            raise ValueError("Parametro 'limit' deve essere un intero") from exc

    if limit <= 0:
        raise ValueError("Parametro 'limit' deve essere > 0")
    if limit > max_limit:
        raise ValueError(f"Parametro 'limit' troppo grande (max {max_limit})")

    return limit


def validate_nil_name(nil_name):
    if nil_name is None:
        raise ValueError("Parametro NIL mancante")

    value = str(nil_name).strip()
    if value == "":
        raise ValueError("Parametro NIL non valido")
    return value


def build_near_query(lng, lat, radius_meters):
    return {
        "geometry": {
            "$near": {
                "$geometry": {
                    "type": "Point",
                    "coordinates": [float(lng), float(lat)],
                },
                "$maxDistance": int(radius_meters),
            }
        }
    }


def list_fountains(limit=100, nil_filter=None):
    collection = get_fountains_collection()
    query = {}

    if nil_filter:
        normalized_nil = nil_filter.strip()
        if normalized_nil:
            query["properties.NIL"] = {"$regex": f"^{re.escape(normalized_nil)}$", "$options": "i"}

    documents = list(collection.find(query).limit(limit))
    return serialize_fountains(documents)


def get_fountains_by_nil(nil_name, limit=200):
    collection = get_fountains_collection()
    query = {"properties.NIL": {"$regex": f"^{re.escape(nil_name)}$", "$options": "i"}}
    documents = list(collection.find(query).limit(limit))
    return serialize_fountains(documents)


def get_fountains_nearby(lng, lat, radius_meters=500, limit=100):
    collection = get_fountains_collection()
    query = build_near_query(lng=lng, lat=lat, radius_meters=radius_meters)
    documents = list(collection.find(query).limit(limit))
    return serialize_fountains(documents)


def get_fountains_stats_by_nil():
    collection = get_fountains_collection()

    pipeline = [
        {"$match": {"properties.NIL": {"$exists": True, "$ne": None}}},
        {"$group": {"_id": "$properties.NIL", "count": {"$sum": 1}}},
        {"$project": {"_id": 0, "nil": "$_id", "count": 1}},
        {"$sort": {"count": -1, "nil": 1}},
    ]

    return list(collection.aggregate(pipeline))


@app.errorhandler(HTTPException)
def handle_http_error(error):
    details = {
        "code": error.code,
        "name": error.name,
        "description": error.description,
    }
    return error_response(message="Richiesta non valida", status_code=error.code, details=details)


@app.errorhandler(Exception)
def handle_unexpected_error(_error):
    return error_response(message="Errore interno del server", status_code=500, details={"code": 500})


@app.get("/")
def serve_home():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/api/health")
def health_check():
    payload = {
        "service": "fontanelle-milano-api",
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    return success_response(data=payload, message="Servizio attivo")


@app.get("/api/fontanelle")
def fountains_list_route():
    try:
        limit = validate_limit(request.args.get("limit"), default=100)
        nil_filter = request.args.get("nil")

        items = list_fountains(limit=limit, nil_filter=nil_filter)
        return success_response(
            data={"items": items, "count": len(items)},
            message="Elenco fontanelle recuperato",
            status_code=200,
        )
    except ValueError as exc:
        return error_response(message=str(exc), status_code=400)
    except (ConnectionError, PyMongoError) as exc:
        return error_response(
            message="Database non disponibile",
            status_code=503,
            details={"reason": str(exc)},
        )


@app.get("/api/fontanelle/nil/<nil_name>")
def fountains_by_nil_route(nil_name):
    try:
        normalized_nil_name = validate_nil_name(nil_name)
        limit = validate_limit(request.args.get("limit"), default=200)

        items = get_fountains_by_nil(nil_name=normalized_nil_name, limit=limit)
        return success_response(
            data={"nil": normalized_nil_name, "items": items, "count": len(items)},
            message="Fontanelle per NIL recuperate",
            status_code=200,
        )
    except ValueError as exc:
        return error_response(message=str(exc), status_code=400)
    except (ConnectionError, PyMongoError) as exc:
        return error_response(
            message="Database non disponibile",
            status_code=503,
            details={"reason": str(exc)},
        )


@app.get("/api/fontanelle/vicine")
def fountains_nearby_route():
    try:
        lng, lat = validate_lng_lat(request.args.get("lng"), request.args.get("lat"))
        radius = validate_radius_meters(request.args.get("radius"), default=500)
        limit = validate_limit(request.args.get("limit"), default=100)

        items = get_fountains_nearby(lng=lng, lat=lat, radius_meters=radius, limit=limit)
        return success_response(
            data={
                "query": {"lng": lng, "lat": lat, "radius": radius},
                "items": items,
                "count": len(items),
            },
            message="Fontanelle vicine recuperate",
            status_code=200,
        )
    except ValueError as exc:
        return error_response(message=str(exc), status_code=400)
    except (ConnectionError, PyMongoError) as exc:
        return error_response(
            message="Database non disponibile",
            status_code=503,
            details={"reason": str(exc)},
        )


@app.get("/api/fontanelle/stats/nil")
def fountains_stats_by_nil_route():
    try:
        items = get_fountains_stats_by_nil()
        return success_response(
            data={"items": items, "count": len(items)},
            message="Statistiche NIL recuperate",
            status_code=200,
        )
    except (ConnectionError, PyMongoError) as exc:
        return error_response(
            message="Database non disponibile",
            status_code=503,
            details={"reason": str(exc)},
        )


if init_mongo():
    initialize_fountains_indexes()
else:
    app.logger.warning("Avvio senza connessione MongoDB disponibile")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=app.config["PORT"], debug=app.config["DEBUG"])
