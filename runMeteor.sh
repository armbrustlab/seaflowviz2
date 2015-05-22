#!/bin/bash -e
cd bundle
export PORT=3000
export MONGO_URL="mongodb://meteor:password@localhost:27017/seaflowviz2"
export MONGO_OPLOG_URL="mongodb://oplogger:password@127.0.0.1:27017/local?authSource=admin"
export ROOT_URL="http://HOST"
node main.js
