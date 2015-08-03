
var util = require('util');
var Transform = require('stream').Transform;
util.inherits(cstarStream, Transform);

exports.cstarStream = cstarStream;

/*
******************************************************************************
cstarStream definition
******************************************************************************
Split a stream of single lines of an cstar.csv file into objects.
*/
function cstarStream() {
  if (!(this instanceof cstarStream)) {
    return new cstarStream();
  }

  options = {
    objectMode: true
  };
  Transform.call(this, options);

  // State to keep between data events
  this._linecount = 0;
  this._keys = {};
}

// Create a doc from one line of a cstar.csv file.
cstarStream.prototype._line2doc = function(line) {
  var self = this;

  var fields = line.split(',');

  // Check that this line has correct field count
  if (fields.length !== Object.keys(self._keys).length) {
    self.emit('error', new Error('field count != header column count, line=' +
              self._linecount + ', cruise=' + self.cruise));
    return;
  }

  var doc = {
    date: new Date(fields[self._keys.time]),
    attenuation: toNumberOrNull(fields[self._keys.attenuation])
  };

  return doc;
};

cstarStream.prototype._transform = function(data, encoding, done) {
  var self = this;

  data = data.toString('utf8');

  if (data) {
    if (++self._linecount === 1) {
      // column headers as doc keys
      data.split(',').forEach(function(k, i) {
        self._keys[k] = i;
      });
    } else {
      var doc = self._line2doc(data);
      self.push(doc);
    }
  }
  done();
};

function toNumberOrNull(str) {
  var num = +str;
  if (isNaN(num)) {
    return null;
  }
  return num;
}
