#!/bin/sh
set -e

echo "[harold] starting"
exec node --dns-result-order=ipv4first dist/index.js
