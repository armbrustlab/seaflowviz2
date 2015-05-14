var fs = require('fs');
var path = require('path');
var split = require('split');
var sflStream = require('./sflStream.js').sflStream;
var login = require('ddp-login');
var DDP = require('ddp-login/node_modules/ddp');
var Writable = require("stream").Writable;

// Setup DDP client
var ddpClient = new DDP({
    host: "localhost",
    port: 3000
});

// Stream to read SFL csv lines
var sfl = sflStream();
// Stream to upload sfl objects to Meteor server
var uploader = Writable({objectMode: true});
uploader._write = function(chunk, err, next) {
    if (chunk) {
        // chunk, upload
        ddpClient.call(
            "addSfl",
            [chunk],
            function (err, result) {     // callback which returns the method call results 
                if (result) {
                    console.log(chunk.date + " added to db");
                }
                next();
            }
        );
    } else {
        // Chunk is empty, skip
        console.log("null chunk");
        next();
    }
};

process.stdout.on('error', function( err ) {
    if (err.code == 'EPIPE') {
        process.exit(0);
    }
});

if (process.argv.length < 2 || 
    (process.argv[2] === '-h' || process.argv[2] === '--help' || process.argv[2] === 'help')) {
        console.log('usage: ' + path.basename(process.argv[1]));
        process.exit(0)
} else {
    ddpClient.connect(function (err) {
        if (err) throw err;

        login(ddpClient,
            {  // Options below are the defaults
                env: 'METEOR_TOKEN',  // Name of an environment variable to check for a
                                      // token. If a token is found and is good,
                                      // authentication will require no user interaction.
                method: 'email',      // Login method: account, email, username or token
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
                    // Now that we're logged in, start the pipeline
                    process.stdin
                        .pipe(split())
                        .pipe(sfl)
                        .pipe(uploader);
                    uploader.on("finish", function() {
                        process.exit(0);
                    });
                }
            }
        );
    });
}
