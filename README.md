# seaflowviz2
## First time setup
### Copy/clone seaflowviz2 git repo 
```sh
git clone https://github.com/armbrustlab/seaflowviz2.git
cd ~/seaflowviz2
```

### Install node.js
```sh
curl -O http://nodejs.org/dist/v0.10.38/node-v0.10.38.pkg
sudo installer -pkg node-v0.10.38.pkg -target /
```

### Install meteor
```sh
curl https://install.meteor.com/ | sh
```

### Install MongoDB
```sh
curl -O http://downloads.mongodb.org/osx/mongodb-osx-x86_64-3.0.3.tgz
tar -zxvf mongodb-osx-x86_64-3.0.3.tgz
mkdir ~/seaflowviz2/mongodb
cp -R -n mongodb-osx-x86_64-3.0.3/ ~/seaflowviz2/mongodb
# add mongo bin to path in ~/.profile
# export PATH=$HOME/seaflowviz2/mongodb/bin:$PATH
mkdir -p ~/seaflowviz2/mongodb-data
```

### Start mongod
```sh
./runMongoDB.sh
```

### Create first user in MongoDB
Create first admin user and make db and user for meteor. Not necessary if mongo has already been set up.

```sh
mongo
use admin
db.createUser({user: "admin", pwd: "...", roles: ["root"]})
use seaflowviz2
db.createUser({user: "meteor", pwd: "...", roles: [{"role": "dbOwner", "db": "seaflowviz2"}]})
```
Log out, then in again as new admin user. Next set up replication to enable Meteor oplog tailing

```sh
mongo -u admin -p --authenticationDatabase admin
rsconf = { _id: "rs0", members: [ {_id: 0, host: "127.0.0.1:27017"}]}
rs.initiate(rsconf)
use admin
db.createUser({user: "oplogger", pwd: "...", roles: [{role: "read", db: "local"}]})
```

## Normal startup routine

### Start mongod
If not already started during first time setup

```sh
./runMongoDB.sh
```

### Start tile server
```sh
(cd seaflow-map && npm install)
./runTileserver.sh
```

### Build meteor bundle
If changes have been made to Meteor project source files, recreate the application bundle. Make sure Leaflet tile server URL in `seaflow-web/client/client.js` is pointing to the correct IP for the tile server.

```sh
cd seaflow-web
meteor build build --directory
```
An application bundle directory will be created at `seaflow-web/build/bundle/`

### Start meteor bundle
First, take a look in `runMeteor.sh` and update MongoDB user passwords, MongoDB URLs, and the Meteor server root URL. Then start the server.

```sh
(cd seaflow-web/bundle/programs/server && npm install)
./runMeteor.sh
```

### Start data uploads
Make sure to use the real path to `sfl.csv` and `stat.csv`. If **lat** and **lon** in these files is in [GGA](http://www.gpsinformation.org/dale/nmea.htm#GGA) format use `seaflow-push/gga_fix.py` to convert them to decimal degrees before upload. If MongoDB is not on localhost make sure to change host addresses in `getToken.sh`, `sflLoader.js`, and `statLoader.js`.

```sh
cd seaflow-push
export METEOR_TOKEN=$(./getToken.sh)
# in some sort of timed loop or cron job every 1-3 minutes
while true; do
    python gga_fix.py stat.csv stat-gga2dd.csv && \
    python gga_fix.py sfl.csv sfl-gga2dd.csv && \
    node sflLoader.js < sfl-gga2dd.csv && \
    node statLoader.js < stat-gga2dd.csv
    sleep 180
done
```
