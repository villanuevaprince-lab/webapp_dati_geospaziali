import os
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

from bson import ObjectId
from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from pymongo import ASCENDING, GEOSPHERE, MongoClient
from pymongo.errors import OperationFailure, PyMongoError
from werkzeug.exceptions import HTTPException


load_dotenv()

PROJECT_ROOT = Path(__file__).resolve().parent
CLIENT_DIR = PROJECT_ROOT / "client"

app = Flask(__name__, static_folder=str(CLIENT_DIR), static_url_path="")

app.config["FLASK_ENV"] = os.getenv("FLASK_ENV", "development")
app.config["PORT"] = int(os.getenv("PORT", "5000"))
app.config["DEBUG"] = app.config["FLASK_ENV"].strip().lower() == "development"
app.config["MONGODB_URI"] = os.getenv("MONGODB_URI") or os.getenv("MONGO_URI") or "mongodb://localhost:27017"
app.config["DB_NAME"] = os.getenv("DB_NAME") or os.getenv("MONGO_DB_NAME") or "dbSpaziali"
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

    def create_index_safely(keys, name):
        try:
            collection.create_index(keys, name=name)
            return True
        except OperationFailure as exc:
            # Codice 85: indice equivalente gia esistente con nome diverso.
            if getattr(exc, "code", None) == 85:
                app.logger.info("Indice equivalente gia presente per %s", name)
                return True
            app.logger.error("Errore durante la creazione indice %s: %s", name, exc)
            return False
        except PyMongoError as exc:
            app.logger.error("Errore durante la creazione indice %s: %s", name, exc)
            return False

    ok = True
    ok = create_index_safely([("geometry", GEOSPHERE)], "geometry_2dsphere_idx") and ok
    ok = create_index_safely([("coordinate", GEOSPHERE)], "coordinate_2dsphere_idx") and ok
    ok = create_index_safely([("properties.NIL", ASCENDING)], "properties_nil_idx") and ok
    ok = create_index_safely([("properties.ID_NIL", ASCENDING)], "properties_id_nil_idx") and ok

    if ok:
        app.logger.info("Indici MongoDB inizializzati correttamente")
    return ok


def get_fountains_collection():
    db = app.extensions.get("mongo_db")
    if db is None:
        raise ConnectionError("Database MongoDB non disponibile")
    return db[app.config["FOUNTAINS_COLLECTION"]]


def get_nil_collection():
    db = app.extensions.get("mongo_db")
    if db is None:
        raise ConnectionError("Database MongoDB non disponibile")
    return db[app.config["NIL_COLLECTION"]]


def normalize_nil_value(value):
    if value is None:
        return None

    normalized = re.sub(r"\s+", " ", str(value)).strip()
    return normalized or None


def normalize_nil_key(value):
    normalized_value = normalize_nil_value(value)
    if not normalized_value:
        return None

    ascii_normalized = "".join(
        char
        for char in unicodedata.normalize("NFKD", normalized_value)
        if not unicodedata.combining(char)
    )
    compact = re.sub(r"[^\w\s]", " ", ascii_normalized)
    compact = re.sub(r"\s+", " ", compact).strip()
    return compact.casefold() or None


def unique_sorted_nil(values):
    unique_map = {}
    for value in values:
        normalized = normalize_nil_value(value)
        if not normalized:
            continue

        key = normalized.casefold()
        if key not in unique_map:
            unique_map[key] = normalized

    return sorted(unique_map.values(), key=lambda item: item.casefold())


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

    # Normalizza spazi multipli per un confronto piu robusto.
    value = re.sub(r"\s+", " ", value)

    # Consente formati NIL reali (es. "Q.RE ... - ...") con separatori comuni.
    if not re.fullmatch(r"[\w\s'\-\./()&,]+", value, flags=re.UNICODE):
        raise ValueError("Parametro NIL non valido")

    return value


def build_nil_regex(search_text):
    tokens = [re.escape(token) for token in search_text.split() if token]
    if not tokens:
        raise ValueError("Parametro NIL non valido")

    return r"[\s\-.']*".join(tokens)


def build_near_query(field_name, lng, lat, radius_meters):
    return {
        field_name: {
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
    normalized_nil_name = normalize_nil_value(nil_name) or nil_name
    nil_regex = build_nil_regex(normalized_nil_name)
    nil_partial_regex = re.escape(normalized_nil_name)

    query_clauses = [
        {"properties.NIL": {"$regex": nil_regex, "$options": "i"}},
        {"nil": {"$regex": nil_regex, "$options": "i"}},
        {"properties.NIL": {"$regex": nil_partial_regex, "$options": "i"}},
        {"nil": {"$regex": nil_partial_regex, "$options": "i"}},
    ]

    # Se l'utente inserisce un codice NIL numerico, match anche su ID_NIL.
    if normalized_nil_name.isdigit():
        query_clauses.append({"properties.ID_NIL": str(int(normalized_nil_name))})

    query = {"$or": query_clauses}
    documents = list(collection.find(query).limit(limit))
    return serialize_fountains(documents)


def get_fountains_nearby(lng, lat, radius_meters=500, limit=100):
    collection = get_fountains_collection()
    last_error = None

    for field_name in ("coordinate", "geometry"):
        try:
            query = build_near_query(
                field_name=field_name,
                lng=lng,
                lat=lat,
                radius_meters=radius_meters,
            )
            documents = list(collection.find(query).limit(limit))
            if documents:
                return serialize_fountains(documents)
        except PyMongoError as exc:
            last_error = exc
            app.logger.warning("Ricerca geospaziale su campo %s non riuscita: %s", field_name, exc)

    if last_error:
        raise last_error
    return []


def get_fountains_stats_by_nil():
    collection = get_fountains_collection()

    pipeline = [
        {
            "$project": {
                "raw_nil": {
                    "$ifNull": ["$nil", {"$ifNull": ["$properties.NIL", ""]}]
                }
            }
        },
        {
            "$project": {
                "nil": {
                    "$trim": {
                        "input": {
                            "$convert": {
                                "input": "$raw_nil",
                                "to": "string",
                                "onError": "",
                                "onNull": "",
                            }
                        },
                        "chars": " \t\n\r",
                    }
                }
            }
        },
        {
            "$project": {
                "nil": {
                    "$cond": [
                        {"$eq": ["$nil", ""]},
                        "Non specificato",
                        "$nil",
                    ]
                }
            }
        },
        {"$group": {"_id": "$nil", "count": {"$sum": 1}}},
        {"$project": {"_id": 0, "nil": "$_id", "count": 1}},
        {"$sort": {"count": -1, "nil": 1}},
    ]

    return list(collection.aggregate(pipeline))


def get_available_nil_list():
    nil_values = []

    # Tentativo primario: collezione NIL dedicata.
    try:
        nil_collection = get_nil_collection()

        pipeline = [
            {
                "$project": {
                    "candidate": {
                        "$ifNull": ["$properties.NIL", {"$ifNull": ["$NIL", "$nil"]}]
                    }
                }
            },
            {"$match": {"candidate": {"$ne": None, "$type": "string"}}},
            {
                "$project": {
                    "candidate": {
                        "$trim": {
                            "input": "$candidate",
                            "chars": " \t\n\r",
                        }
                    }
                }
            },
            {"$match": {"candidate": {"$ne": ""}}},
        ]

        nil_values = [item.get("candidate") for item in nil_collection.aggregate(pipeline)]
    except (ConnectionError, PyMongoError) as exc:
        app.logger.warning("Impossibile leggere NIL dalla collection dedicata: %s", exc)
        nil_values = []

    # Fallback: ricava NIL dalle vedovelle se la collection nil e' vuota/non adatta.
    if not nil_values:
        collection = get_fountains_collection()
        from_properties = collection.distinct("properties.NIL")
        from_root = collection.distinct("nil")
        nil_values = [*from_properties, *from_root]

    return unique_sorted_nil(nil_values)


def extract_nil_name_from_doc(document):
    if not isinstance(document, dict):
        return None

    properties = document.get("properties")
    candidates = []

    if isinstance(properties, dict):
        candidates.extend(
            [
                properties.get("NIL"),
                properties.get("nil"),
                properties.get("nome"),
                properties.get("NOME"),
                properties.get("name"),
                properties.get("Name"),
            ]
        )

    candidates.extend(
        [
            document.get("NIL"),
            document.get("nil"),
            document.get("nome"),
            document.get("NOME"),
            document.get("name"),
            document.get("Name"),
        ]
    )

    for candidate in candidates:
        normalized = normalize_nil_value(candidate)
        if normalized:
            return normalized

    return None


def extract_geometry_from_geojson_candidate(candidate):
    if not isinstance(candidate, dict):
        return None

    geometry_type = candidate.get("type")
    coordinates = candidate.get("coordinates")
    if isinstance(geometry_type, str) and isinstance(coordinates, list):
        return {
            "type": geometry_type,
            "coordinates": coordinates,
        }

    if geometry_type == "Feature" and isinstance(candidate.get("geometry"), dict):
        geometry = candidate.get("geometry")
        nested_type = geometry.get("type")
        nested_coordinates = geometry.get("coordinates")
        if isinstance(nested_type, str) and isinstance(nested_coordinates, list):
            return {
                "type": nested_type,
                "coordinates": nested_coordinates,
            }

    return None


def extract_nil_geometry(document):
    if not isinstance(document, dict):
        return None

    if document.get("type") == "Feature":
        geometry = extract_geometry_from_geojson_candidate(document.get("geometry"))
        if geometry:
            return geometry

    for field_name in ("geometry", "geom", "the_geom", "wkb_geometry", "geojson", "feature"):
        geometry = extract_geometry_from_geojson_candidate(document.get(field_name))
        if geometry:
            return geometry

    return None


def iter_nil_feature_documents(nil_documents):
    for document in nil_documents:
        if not isinstance(document, dict):
            continue

        if document.get("type") == "FeatureCollection" and isinstance(document.get("features"), list):
            for feature in document["features"]:
                if isinstance(feature, dict):
                    yield feature
            continue

        yield document


def build_nil_counts_map(fountains_collection):
    counts_pipeline = [
        {
            "$project": {
                "raw_nil": {
                    "$ifNull": ["$nil", {"$ifNull": ["$properties.NIL", ""]}]
                }
            }
        },
        {
            "$project": {
                "raw_nil": {
                    "$trim": {
                        "input": {
                            "$convert": {
                                "input": "$raw_nil",
                                "to": "string",
                                "onError": "",
                                "onNull": "",
                            }
                        },
                        "chars": " \t\n\r",
                    }
                }
            }
        },
        {"$match": {"raw_nil": {"$ne": ""}}},
        {"$group": {"_id": "$raw_nil", "count": {"$sum": 1}}},
    ]

    nil_counts = {}
    for item in fountains_collection.aggregate(counts_pipeline):
        raw_nil = item.get("_id")
        count = int(item.get("count", 0))
        nil_key = normalize_nil_key(raw_nil)
        if not nil_key:
            continue
        nil_counts[nil_key] = nil_counts.get(nil_key, 0) + count

    return nil_counts


def get_choropleth_geojson():
    fountains_collection = get_fountains_collection()
    nil_collection = get_nil_collection()

    nil_counts = build_nil_counts_map(fountains_collection)

    raw_nil_documents = list(nil_collection.find({}))
    features = []

    for document in iter_nil_feature_documents(raw_nil_documents):
        geometry = extract_nil_geometry(document)
        if not geometry:
            continue

        nil_name = extract_nil_name_from_doc(document) or "NIL non specificato"
        nil_key = normalize_nil_key(nil_name)
        count = nil_counts.get(nil_key, 0) if nil_key else 0

        doc_properties = document.get("properties") if isinstance(document.get("properties"), dict) else {}
        feature_properties = {**doc_properties}
        feature_properties["nil"] = nil_name
        feature_properties["fontanelle_count"] = int(count)

        features.append(
            {
                "type": "Feature",
                "properties": feature_properties,
                "geometry": geometry,
            }
        )

    return {
        "type": "FeatureCollection",
        "features": features,
    }


def get_choropleth_geojson_for_nil(nil_name):
    fountains_collection = get_fountains_collection()
    nil_collection = get_nil_collection()

    target_key = normalize_nil_key(nil_name)
    if not target_key:
        return {"type": "FeatureCollection", "features": []}

    nil_counts = build_nil_counts_map(fountains_collection)
    nil_regex = build_nil_regex(nil_name)
    nil_partial_regex = re.escape(normalize_nil_value(nil_name) or str(nil_name))
    regex_query = {
        "$or": [
            {"properties.NIL": {"$regex": nil_regex, "$options": "i"}},
            {"properties.NIL": {"$regex": nil_partial_regex, "$options": "i"}},
            {"NIL": {"$regex": nil_regex, "$options": "i"}},
            {"NIL": {"$regex": nil_partial_regex, "$options": "i"}},
            {"nil": {"$regex": nil_regex, "$options": "i"}},
            {"nil": {"$regex": nil_partial_regex, "$options": "i"}},
            {"nome": {"$regex": nil_regex, "$options": "i"}},
            {"nome": {"$regex": nil_partial_regex, "$options": "i"}},
        ]
    }
    raw_nil_documents = list(nil_collection.find(regex_query))

    best_feature = None
    best_score = -1

    for document in iter_nil_feature_documents(raw_nil_documents):
        geometry = extract_nil_geometry(document)
        if not geometry:
            continue

        doc_nil_name = extract_nil_name_from_doc(document)
        doc_nil_key = normalize_nil_key(doc_nil_name)
        if not doc_nil_key:
            continue

        if doc_nil_key == target_key:
            match_score = 3
        elif target_key in doc_nil_key:
            match_score = 2
        else:
            continue

        count = int(nil_counts.get(doc_nil_key, 0))
        resolved_name = doc_nil_name or normalize_nil_value(nil_name) or str(nil_name)

        doc_properties = document.get("properties") if isinstance(document.get("properties"), dict) else {}
        feature_properties = {**doc_properties}
        feature_properties["nil"] = resolved_name
        feature_properties["fontanelle_count"] = count

        # Preferisce match esatto, poi parziale con piu fontanelle.
        current_score = (match_score * 100000) + count
        if current_score > best_score:
            best_score = current_score
            best_feature = {
                "type": "Feature",
                "properties": feature_properties,
                "geometry": geometry,
            }

    if best_feature is not None:
        return {
            "type": "FeatureCollection",
            "features": [best_feature],
        }

    return {
        "type": "FeatureCollection",
        "features": [],
    }

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
        message = "Fontanelle per NIL recuperate"
        if not items:
            message = f"Nessuna fontanella trovata per il NIL '{normalized_nil_name}'"

        return success_response(
            data={"nil": normalized_nil_name, "items": items, "count": len(items)},
            message=message,
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
                "reference_point": {"lng": lng, "lat": lat},
                "radius_meters": radius,
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


@app.get("/api/fontanelle/choropleth")
def fountains_choropleth_route():
    try:
        geojson = get_choropleth_geojson()
        return success_response(
            data=geojson,
            message="GeoJSON choropleth NIL recuperato",
            status_code=200,
        )
    except (ConnectionError, PyMongoError) as exc:
        return error_response(
            message="Database non disponibile",
            status_code=503,
            details={"reason": str(exc)},
        )


@app.get("/api/fontanelle/choropleth/nil/<nil_name>")
def fountains_choropleth_single_nil_route(nil_name):
    try:
        normalized_nil_name = validate_nil_name(nil_name)
        geojson = get_choropleth_geojson_for_nil(normalized_nil_name)
        feature_count = len(geojson.get("features", []))

        if feature_count == 0:
            return success_response(
                data=geojson,
                message=f"Nessuna geometria NIL trovata per '{normalized_nil_name}'",
                status_code=200,
            )

        return success_response(
            data=geojson,
            message=f"GeoJSON NIL '{normalized_nil_name}' recuperato",
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


@app.get("/api/nil")
def nil_list_route():
    try:
        items = get_available_nil_list()
        return success_response(
            data={"items": items, "count": len(items)},
            message="Elenco NIL recuperato",
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
