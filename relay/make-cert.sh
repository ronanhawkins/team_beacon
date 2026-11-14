#!/bin/sh
# Create a self-signed certificate for the relay in relay/certs/.
# Valid for localhost, 127.0.0.1 and, if given, the laptop's IP address.
#
# Usage: ./make-cert.sh [laptop-ip]     e.g. ./make-cert.sh 192.168.1.20

set -eu

cd "$(dirname "$0")"
mkdir -p certs

IP="${1:-}"
SAN="DNS:localhost,IP:127.0.0.1"
if [ -n "$IP" ]; then
  SAN="$SAN,IP:$IP"
fi

CONF="$(mktemp)"
trap 'rm -f "$CONF"' EXIT
cat > "$CONF" <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = Beacon relay
[ext]
subjectAltName = $SAN
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
EOF

openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 365 \
  -keyout certs/key.pem -out certs/cert.pem -config "$CONF" 2>/dev/null

echo "Wrote relay/certs/cert.pem and relay/certs/key.pem for: $SAN"
