# Fontanelle Milano

Progetto web geospaziale con frontend vanilla e backend Flask in un solo file Python: app.py.

## Stack

- Frontend: HTML, CSS, JavaScript vanilla + Leaflet
- Backend: Python + Flask
- Database: MongoDB Atlas (PyMongo)

## Struttura progetto

.
├── app.py
├── .env.example
├── README.md
├── requirements.txt
└── client/
    ├── index.html
    ├── css/
    │   └── style.css
    └── js/
        ├── api.js
        ├── app.js
        └── map.js

## Avvio rapido

1. Crea e attiva il virtual environment:

python3 -m venv .venv
source .venv/bin/activate

2. Installa dipendenze:

pip install -r requirements.txt

3. Crea il file ambiente:

cp .env.example .env

4. Avvia il server:

python app.py

5. Verifica:

- Home: http://localhost:5000
- API health: http://localhost:5000/api/health

## Variabili ambiente

- FLASK_ENV
- PORT
- MONGODB_URI
- DB_NAME
- FOUNTAINS_COLLECTION
- NIL_COLLECTION

## Endpoint principali

- GET /api/health
- GET /api/fontanelle
- GET /api/fontanelle/nil/<nil_name>
- GET /api/fontanelle/vicine?lng=...&lat=...&radius=500
- GET /api/fontanelle/stats/nil