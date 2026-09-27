#!/bin/sh
set -e

# Corre las migraciones antes de arrancar la API. node-pg-migrate lee DATABASE_URL
# del entorno por defecto. Es idempotente: no reaplica migraciones ya corridas.
echo "Ejecutando migraciones..."
node_modules/.bin/node-pg-migrate up -m ./migrations -j sql

echo "Migraciones OK. Iniciando API..."
exec "$@"
