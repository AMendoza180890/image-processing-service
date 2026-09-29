#!/bin/bash
# Script de init de LocalStack: se ejecuta cuando LocalStack está listo
# (montado en /etc/localstack/init/ready.d/). Crea el bucket S3 y la cola SQS.
set -e

BUCKET="${S3_BUCKET:-images-bucket}"
QUEUE="${SQS_QUEUE_NAME:-images-jobs}"

echo "Creando bucket S3: ${BUCKET}"
awslocal s3 mb "s3://${BUCKET}"

echo "Creando cola SQS: ${QUEUE}"
awslocal sqs create-queue --queue-name "${QUEUE}"

echo "Init de LocalStack completo."
