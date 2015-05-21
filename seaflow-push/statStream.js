
var util = require('util');
var Transform = require('stream').Transform;
util.inherits(statStream, Transform);

exports.statStream = statStream;

/*
******************************************************************************
statStream definition
******************************************************************************
Split a stream of single lines of an stat.csv file into objects.
*/
function statStream() {
  if (!(this instanceof statStream)) {
    return new statStream();
  }

  options = {
    objectMode: true
  };
  Transform.call(this, options);

  // State to keep between data events
  this._linecount = 0;
  this._keys = {};
  this._cur = null;
  this._allowedPops = {
    "prochloro": true,
    "synecho": true,
    "picoeuk": true,
    "beads": true
  };
}

// Create a doc from one line of a stat.csv file.
statStream.prototype._line2doc = function(line) {
  var self = this;

  var fields = line.split(',');

  // Check that this line has correct field count
  if (fields.length !== Object.keys(self._keys).length) {
    self.emit('error', new Error('field count != header column count, line='
      + self._linecount + ', cruise=' + self.cruise));
    return;
  }

  var doc = {
    cruise: fields[self._keys.cruise],
    //file: fields[self._keys.file],
    date: new Date(fields[self._keys.time]),
    //flow_rate: +fields[self._keys.flow_rate],
    //file_duration: +fields[self._keys.file_duration],
    pop: fields[self._keys.pop],
    popData: {
      //opp_evt_ratio: +fields[self._keys.opp_evt_ratio],
      //n_count: +fields[self._keys.n_count],
      abundance: +fields[self._keys.abundance],
      fsc_small: +fields[self._keys.fsc_small],
      //chl_small: +fields[self._keys.chl_small],
      //pe: +fields[self._keys.pe]
    }
  };
  if (this._allowedPops[doc.pop]) {
    return doc;
  }
  return null;
};

statStream.prototype._transform = function(data, encoding, done) {
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
      if (! doc) {
        if (self._cur) {
          self.push(self._cur);
          self._cur = null;
        }
      } else {
        if (! self._cur) {
          doc.pops = {};
          doc.pops[doc.pop] = doc.popData;
          delete doc.pop;
          delete doc.popData;
          self._cur = doc;
        } else {
          if (self._cur.date.getTime() === doc.date.getTime()) {
            self._cur.pops[doc.pop] = doc.popData;
          } else {
            self.push(self._cur);
            doc.pops = {};
            doc.pops[doc.pop] = doc.popData;
            delete doc.pop;
            delete doc.popData;
            self._cur = doc;
          }
        }
      }
    }
  }
  done();
};
