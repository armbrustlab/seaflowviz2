#!/bin/bash -e
ulimit -n 2048
mongod --config mongod.conf
