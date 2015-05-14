var fs = require('fs');
var path = require('path');
var split = require('split');
var JSONStream = require('JSONStream');
var sflStream = require('./sflStream.js').sflStream;

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
    // stdin
    var sfl = sflStream();
    var addStats = addStatsStream();
    process.stdin
        .pipe(split())
        .pipe(sfl)
        .pipe(JSONStream.stringify())
        .pipe(process.stdout);
}
