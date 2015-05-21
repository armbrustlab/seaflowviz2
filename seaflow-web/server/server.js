Stat = new Mongo.Collection("stat")
Sfl = new Mongo.Collection("sfl")

Meteor.startup(function() {
  Stat._ensureIndex({date: 1});
  Sfl._ensureIndex({date: 1});
});

Meteor.publish("stat", function() {
  return Stat.find({},
    {
      fields: {
        cruise : 0,
        owner: 0
      },
      sort: {
        date: 1
      }
    }
  );
});
Meteor.publish("sfl", function() {
  return Sfl.find({},
    {
      fields: {
        date: 1,
        lat: 1,
        lon: 1,
        par: 1,
        temp: 1,
        salinity: 1,
        velocity: 1
      },
      sort: {
        date: 1
      }
    }
  );
});

Meteor.methods({
  addSfl: function (doc) {
    // Make sure the user is logged in before inserting a task
    if (! Meteor.userId()) {
      throw new Meteor.Error("not-authorized");
    }
    var addedDoc = false;
    // Only add if not in database by date
    if (doc) {
      dup = Sfl.findOne({date: doc.date});
      if (! dup) {
        doc.owner = Meteor.userId();
        doc.loc = {
          // GeoJSON point object
          'type': 'Point',
          'coordinates': [doc.lon, doc.lat]
        };
        doc.velocity = 0;
        Sfl.insert(doc);
        addedDoc = true;
      }
    }
    return addedDoc;
  },
  addStat: function (doc) {
    // Make sure the user is logged in before inserting a task
    if (! Meteor.userId()) {
      throw new Meteor.Error("not-authorized");
    }
    var addedDoc = false;
    // Only add if not in database by date+pop
    if (doc) {
      dup = Stat.findOne({date: doc.date});
      if (! dup) {
        doc.owner = Meteor.userId();
        Stat.insert(doc);
        addedDoc = true;
      }
    }
    return addedDoc;
  }
});
