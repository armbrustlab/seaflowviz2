
var util = require('util');
var Transform = require('stream').Transform;
util.inherits(sflStream, Transform);

exports.sflStream = sflStream;

/*
******************************************************************************
sflStream definition
******************************************************************************
Split a stream of single lines of an sfl.csv file into objects.
*/
function sflStream() {
  if (!(this instanceof sflStream)) {
    return new sflStream();
  }

  options = {
    objectMode: true
  };
  Transform.call(this, options);

  // State to keep between data events
  this._linecount = 0;
  this._keys = {};
}

// Create a doc from one line of a sfl.csv file.
sflStream.prototype._line2doc = function(line) {
  var self = this;

  var fields = line.split(',');

  // Check that this line has correct field count
  if (fields.length !== Object.keys(self._keys).length) {
    self.emit('error', new Error('field count != header column count, line='
      + self._linecount + ', cruise=' + self.cruise));
    return;
  }

  var doc = {
    date: new Date(fields[self._keys.date]),
    file: fields[self._keys.file],
    lon: +fields[self._keys.lon],
    lat: +fields[self._keys.lat],
    //conductivity: +fields[self._keys.conductivity],
    salinity: +fields[self._keys.salinity],
    temp: +fields[self._keys.ocean_tmp],
    //bulk_red: +fields[self._keys.bulk_red],
    par: +fields[self._keys.par],
    cruise: fields[self._keys.cruise]
  };
  return doc;
};

sflStream.prototype._transform = function(data, encoding, done) {
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
