## Set meteor token
1) Make a user account on the meteor server
2) Save an authentication token in this shell session's environment

```sh
export METEOR_TOKEN=$(./getToken.sh)
```

## Set password
Or, instead of setting an environment variable token, hardcode a user password and email in `sflLoader.js` and `statLoader.js`.

## Convert GGA to DD
Lat and lon values in `sfl.csv` and `stat.csv` may have GGA coordinate values instead of decimal degrees. These should be converted before uploading to a database.

```
./gga2dd.py stat.csv stat-gga2dd.csv
./gga2dd.py sfl.csv sfl-gga2dd.csv
```

## Upload `sfl.csv` and `stat.csv` to MongoDB
```
node sflLoader.js <example-sfl.csv 
node statLoader.js <example-stat.csv 
```

## Upload `sfl.csv` and `stat.csv` to SQLShare
Must be run in the same directory as `stat.csv` and `sfl.csv`

```
./doit.py
```
