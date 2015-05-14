## Set meteor token
1) Make a user account on the meteor server
2) Save an authentication token in this shell session's environment

```sh
export METEOR_TOKEN=$(node_modules/ddp-login/bin/ddp-login --host 127.0.0.1 --port 3000 --method email)
```

## Upload Sfl.csv and Stat.csv

```sh
node sflLoader.js <example-sfl.csv 
node statLoader.js <example-stat.csv 
```
