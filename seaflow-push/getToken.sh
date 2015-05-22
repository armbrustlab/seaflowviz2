#!/bin/bash
METEOR_TOKEN=$(node_modules/ddp-login/bin/ddp-login --host 127.0.0.1 --port 3000 --method email)
echo $METEOR_TOKEN
