#!/bin/bash -e

# Make log dir if it doesn't exist
[[ ! -d log ]] && mkdir log

# Start tile server
cd seaflow-map/
/usr/local/bin/node tileserver.js seaflow.mbtiles 3002 >>log/tileserver.log 2>&1 &
cd ..

# Start meteor server
# Assume we have created a meteor bundle and want to start the server
cd bundle
env ROOT_URL="127.0.0.1" PORT=3000 MONGO_URL="mongodb://meteor:PWD:27017/seaflowviz2" /usr/local/bin/node main.js 2>> ../log/meteor.stderr.log | tee ../log/meteor.stdout.log
