var util = require('util');
var login = require('ddp-login');
var DDP = require('ddp-login/node_modules/ddp');
var Writable = require('stream').Writable;
util.inherits(addStatsStream, Writable);

exports.addStatsStream = addStatsStream;

var ddpClient = new DDP({
  host: "localhost",
  port: 3000
});

ddpClient.connect(function (err) {
  if (err) throw err;

  login(ddpClient,
    {  // Options below are the defaults
       env: 'METEOR_TOKEN',  // Name of an environment variable to check for a
                             // token. If a token is found and is good,
                             // authentication will require no user interaction.
       method: 'email',    // Login method: account, email, username or token
       account: 'chrisbee@uw.edu',        // Prompt for account info by default
       pass: null,           // Prompt for password by default
       retry: 5,             // Number of login attempts to make
       plaintext: false      // Do not fallback to plaintext password compatibility
                             // for older non-bcrypt accounts
    },
    function (error, userInfo) {
      if (error) {
        // Something went wrong...
        console.log("DDP error" + error);
        process.exit(1);
      } else {
        // We are now logged in, with userInfo.token as our session auth token.
        console.log("token = " + userInfo.token);
        ddpClient.call(
          "addStat",
          [{date: new Date(), salinity: 9}],
          function (err, result) {   // callback which returns the method call results 
            console.log('called function, result: ' + result);
          },
          function () {              // callback which fires when server has finished 
            console.log('updated');  // sending any updated documents as a result of 
          }
        );
      }
    }
  );
});

/*
******************************************************************************
addStatsStream definition
******************************************************************************
Add stat objects to Stats collection with Meteor method calls
*/
function addStatsStream() {
  if (!(this instanceof addStatsStream)) {
    return new addStatsStream();
  }
  Writable.call(this, {objectMode: true});
}

addStatsStream.prototype._write = function(data, encoding, next) {
  console.log(data);
  next();
};
