Stat = new Mongo.Collection("stat");
Sfl = new Mongo.Collection("sfl");
Cstar = new Mongo.Collection("cstar");

var subHandles = {
  sfl: Meteor.subscribe("sfl"),
  stat: null,
  cstar: null
};

Session.set("recent", null);

/*
Template functions
*/
Template.status.helpers({
  sflCount: function() {
    return Sfl.find().count();
  },
  statCount: function() {
    return Stat.find().count();
  },
  cstarCount: function() {
    return Cstar.find().count();
  },
  recent: function() {
    return Session.get("recent");
  }
});

Template.charts.rendered = function() {
  var madeSflPlots = false;
  var madePopPlots = false;
  var prevSfl;

  // Define how to handle new SFL data
  Sfl.find().observe({
    added: sflAdded()
  });

  // Define how to handle new stats data
  Stat.find().observe({
    added: statAdded()
  });

  // Define how to handle new cstar data
  Cstar.find().observe({
    added: cstarAdded()
  });

  setupMap();  // Draw initial map
};

// Incorporate new SFL data as it arrives
function sflAdded() {
  var madeSflPlots = false;
  var f = throttled(function(doc) {
    if (! madeSflPlots) {
      initializeSflData();
      initializeDateRange();
      initializeSflPlots();
      madeSflPlots = true;

      // Subscribe to other data publications after SFL data has been received
      subHandles.stat = Meteor.subscribe("stat");
      subHandles.cstar = Meteor.subscribe("cstar");
    }
    updateRangeChart();
    updateCharts();
    updateMap();
    Session.set("recent", doc.date.toISOString());
  }, 1000, addSflRecord());
  return f;
}

function addSflRecord() {
  var prevSfl;
  var f = function(doc) {
    addSpeed(prevSfl, doc);
    prevSfl = doc;
    xfs.sfl.add([doc]);
    xfs.range.add([doc]);
    cruiseLocs.push({lat: doc.lat, lon: doc.lon, date: doc.date});
  };
  return f;
}

// Incorporate new stats (population) data as it arrives
function statAdded() {
  var madePopPlots = false;
  var f = throttled(function(doc) {
    if (! madePopPlots) {
      initializePopData();
      initializePopPlots();
      madePopPlots = true;
    }
    updateCharts();
  }, 1000, addStatRecord());
  return f;
}

function addStatRecord() {
  var f = function(doc) {
    _.keys(doc.pops).forEach(function(p) {
      if (p === "unknown") {
        return;
      }
      var popDoc = {
        date: doc.date,
        abundance: doc.pops[p].abundance,
        fsc_small: Math.log10(doc.pops[p].fsc_small),
        pop: p
      };
      xfs.pop.add([popDoc]);
    });
  };
  return f;
}

// Incorporate new cstar data as it arrives
function cstarAdded() {
  var madeCstarPlots = false;
  var f = throttled(function(doc) {
    if (! madeCstarPlots) {
      initializeCstarData();
      initializeCstarPlots();
      madeCstarPlots = true;
    }
    updateCharts();
  }, 1000, addCstarRecord());
  return f;
}

function addCstarRecord() {
  var f = function(doc) {
    xfs.cstar.add([doc]);
  };
  return f;
}

function resetPlots() {
  // Clear current crossfilters and map points
  cruiseLocs = [];
  resetCrossfilters();

  // Add data back to crossfilters
  Sfl.find().forEach(addSflRecord());
  Stat.find().forEach(addStatRecord());
  Cstar.find().forEach(addCstarRecord());

  // Reconfigure crossfilter dimensions and groups
  initializeSflData();
  initializePopData();
  initializeCstarData();

  // Reapply pop filters
  filterPops();

  // Replot
  updateRangeChart();
  updateCharts();
  updateMap();
}

window.resetPlots = resetPlots;

// Make sure func only runs if inner hasn't been called
// since delay seconds ago. If every is defined, run it
// every time inner is called
function throttled(func, delay, every) {
  var counter = 0;
  var inner = function() {
    var args = arguments;
    if (every) {
      every.apply(every, args);
    }
    var myNumber = ++counter;
    Meteor.setTimeout(function() {
      if (myNumber == counter) {
        func.apply(func, args);
        counter = 0;
      }
    }, delay);
  };
  return inner;
}

/*
crossfilter stuff
*/
// Define crossfilters
var xfs;

function resetCrossfilters() {
  xfs = { "sfl": crossfilter(), "range": crossfilter(), "pop": crossfilter(),
          "cstar": crossfilter() };
}

resetCrossfilters();

// crossfilter dimensions
var dims = { "date": [], "range": [], "pop": [], "datePop": [],
             "dateCstar": [] };
// crossfilter groups
var groups = {
  "speed": [], "temp": [], "salinity": [], "range": [],
  "abundance": [], "fsc_small": [], "attenuation": []
};

var erased = {
  "speed": {}, "temp": {}, "salinity": {}, "range": {},
  "abundance": {}, "fsc_small": {}, "attenuation": {},
};

// dc.js charts
var charts = {};
dc.disableTransitions = true;

/*
Map stuff
*/
var tileURL = 'http://127.0.0.1:3002/{z}/{x}/{y}.png';
var cruiseLocs = [];
var cruiseMap = null;
var cruiseLayer = null;

/*
variables for chart formatting
*/
// format for chart point label time
var labelFormat = d3.time.format.utc("%Y-%m-%d %H:%M:%S GMT");
// default y domain limits
var yDomains = {
  range: [0, 0.3],
  speed: [0, 15],
  temp: null,
  salinity: null,
  par: null,
  attenuation: null,
  abundance: null,
  fsc_small: null
};
// should time selection be pinned to most recent data?
var pinnedToMostRecent = false;
// Short names for populations in database
var popNames = ["prochloro", "synecho", "picoeuk", "beads"];
// Full names for legend
var popLabels = ["Prochlorococcus", "Synechococcus", "Picoeukaryotes", "Beads"];
// Lookup table between pop database shortnames / object keys and common names
var popLookup = {};
for (var i = 0; i < popNames.length; i++) {
  popLookup[popNames[i]] = popLabels[i];
  popLookup[popLabels[i]] = popNames[i];
}
// Track which populations should be shown in plots
var popFlags = {};
popNames.forEach(function(p) { popFlags[p] = true; });
// Date range to plot for all charts except range chart
var dateRange = null;

function getBinSize(dateRange) {
  var maxPoints = 240;

  // Find number of points for 3 minute buckets in dateRange
  var msIn3Min = 3 * 60 * 1000;
  var msInRange = dateRange[1].getTime() - dateRange[0].getTime();
  var points = ceiling(msInRange / msIn3Min);

  // Figure out how large to make each bin in order to keep points
  // below maxPoints. e.g. if there are 961 3 minute points in range,
  // then the new bin size would be 5 * 3 minutes = 15 minutes. If there
  // were 960 the new bin size would be 4 * 3 minutes = 12 minutes.
  var exponent = ceiling(log(points/maxPoints, 2));
  exponent = Math.max(Math.min(exponent, 6), 0);
  return Math.pow(2, exponent);
}

function roundDate(date, firstDate, binSizeMilli) {
  var offset = Math.floor((date.getTime() - firstDate.getTime()) / binSizeMilli) * binSizeMilli;
  return new Date(firstDate.getTime() + offset);
}

function ceiling(input) {
  return Math.floor(input + 0.99999999999);
}

function log(n, base) {
  return Math.log(n) / Math.log(base);
}

// Value accessor common to all dc.js plots
function valueAccessor(d) {
  if (d.value.total === null || d.value.count === 0) {
    // D3 plots are setup so that if a y value is null the line segement
    // is broken to indicate missing data.
    return null;
  } else {
    return d.value.total / d.value.count;
  }
}

// Create a population plot dimension key formatted as
// date.toISOString()_population, e.g. "2015-08-03T09:37:45.000Z_picoeuk"
function makePopKey(date, pop) {
  return date.toISOString() + "_" + pop;
}

function keyAccessorPop(d) {
  return new Date(d.key.substr(0, 24));
}

function seriesAccessorPop(d) {
  return d.key.substr(25);
}

/*
Crossfilter functions
*/

// Reduce functions to stop crossfilter from coercing null totals to 0.
// This will happen if a null value is added to or subtracted from a null
// total. D3 would then erroneously plot this point as 0, when it should not
// be plotted at all. Keeping null totals as null allows chart.defined() to
// work as expected and create discontinous line charts, differentiating
// between true 0 values and missing data.
function reduceAdd(key) {
  return function(p, v) {
    // Don't add this value if it's marked for erasure
    if (erased[key]) {
        if (erased[key][v.date.toISOString()] ||
            (v.pop && erased[key][makePopKey(v.date, v.pop)])) {
            return p;
        }
    }

    // Record this member of the group, even if it is null and does not count
    // towards the total or count for the group. Helpful during debugging.
    p.members.push(v);

    // If there is data to add
    if (v[key] !== null && ! isNaN(v[key]) && v[key] !== undefined) {
      ++p.count;
      p.total += v[key];
    }
    return p;
  };
}

function reduceRemove(key) {
  return function(p, v) {
    var idx = null;
    for (var i=0; i<p.members.length; i++) {
      if (p.members[i] === v) {
        idx = i;
        break;
      }
    }
    if (idx !== null) {
      p.members.splice(idx, 1);  // erase this member
    }

    // If there is data to remove
    if (v[key] !== null && ! isNaN(v[key]) && v[key] !== undefined) {
      --p.count;
      p.total -= v[key];
    }
    return p;
  };
}

function reduceInitial() {
  return { count: 0, total: null, members: [] };
}

// Make sure there are empty groups to interrupt line connections
// when data is missing
function addEmpty(group, binSize) {
  var msIn1Min = 60 * 1000;
  return {
    all: function() {
      var prev = null;
      var groups = [];
      group.all().forEach(function(g) {
        // If the gap between data is more than <bucket size> + 1 minute,
        // insert a null data point to break line segment.
        if (prev && (g.key - prev) > binSize * 3 * msIn1Min + msIn1Min) {
          var newdate = new Date(prev.getTime() + binSize * 3 * msIn1Min);
          /*console.log("added empty group " + newdate.toISOString()) +
                      " between " + prev.toISOString() + " and " +
                      g.key.toISOString());*/
          groups.push({
            key: newdate,
            value: {count: 0, total: null}
          });
        }
        groups.push(g);
        prev = g.key;
      });
      return groups;
    }
  };
}

// Make sure there are empty groups to interrupt line connections
// when data is missing
function addEmptyPop(group, binSize) {
  var msIn1Min = 60 * 1000;
  return {
    all: function() {
      var prev = {};
      var groups = [];
      group.all().forEach(function(g) {
        var pop = seriesAccessorPop(g);
        var date = keyAccessorPop(g);
        // If the gap between data is more than <bucket size> + 1 minute,
        // insert a null data point to break line segment.
        if (prev[pop] && (date - prev[pop]) > binSize * 3 * msIn1Min + msIn1Min) {
          var newdate = new Date(prev[pop].getTime() + binSize * 3 * msIn1Min);
          /*console.log("added empty group " + pop + " " + newdate.toISOString()
                      + " between " + prev[pop].toISOString() + " and " +
                      date.toISOString());*/
          groups.push({
            key: makePopKey(newdate, pop),
            value: {count: 0, total: null}
          });
        }
        groups.push(g);
        prev[pop] = date;
      });
      return groups;
    }
  };
}

function initializeSflData() {
  var msIn3Min = 3 * 60 * 1000;
  dims.date[1] = xfs.sfl.dimension(function(d) { return d.date; });
  var first = dims.date[1].bottom(1)[0].date;
  [2,4,8,16,32].forEach(function(binSize) {
    dims.date[binSize] = xfs.sfl.dimension(function(d) {
      return roundDate(d.date, first, binSize*msIn3Min);
    });
  });

  ["speed", "temp", "salinity"].forEach(function(key) {
    [1,2,4,8,16,32].forEach(function(binSize) {
      groups[key][binSize] = dims.date[binSize].group().reduce(
        reduceAdd(key), reduceRemove(key), reduceInitial);
    });
  });

  dims.range[1] = xfs.range.dimension(function(d) { return d.date; });
  [2,4,8,16,32].forEach(function(binSize) {
    dims.range[binSize] = xfs.range.dimension(function(d) {
      return roundDate(d.date, first, binSize*msIn3Min);
    });
  });

  var rangeKey = "par";
  [1,2,4,8,16,32].forEach(function(binSize) {
    groups.range[binSize] = dims.range[binSize].group().reduce(
      reduceAdd(rangeKey), reduceRemove(rangeKey), reduceInitial);
  });
}

function initializePopData() {
  var msIn3Min = 3 * 60 * 1000;

  dims.datePop[1] = xfs.pop.dimension(function(d) {
    return makePopKey(d.date, d.pop);
  });

  // dims.date must have data from SFL by now!
  var first = dims.date[1].bottom(1)[0].date;
  [2,4,8,16,32].forEach(function(binSize) {
    dims.datePop[binSize] = xfs.pop.dimension(function(d) {
      return makePopKey(roundDate(d.date, first, binSize*msIn3Min), d.pop);
    });
  });

  ["abundance", "fsc_small"].forEach(function(key) {
    [1,2,4,8,16,32].forEach(function(binSize) {
      groups[key][binSize] = dims.datePop[binSize].group().reduce(
        reduceAdd(key), reduceRemove(key), reduceInitial);
    });
  });

  dims.pop = xfs.pop.dimension(function(d) { return d.pop; });
}

function initializeCstarData() {
  var msIn3Min = 3 * 60 * 1000;
  var first = dims.date[1].bottom(1)[0].date;

  dims.dateCstar[1] = xfs.cstar.dimension(function(d) { return d.date; });
  [2,4,8,16,32].forEach(function(binSize) {
    dims.dateCstar[binSize] = xfs.cstar.dimension(function(d) {
      return roundDate(d.date, first, binSize*msIn3Min);
    });
  });

  var key = "attenuation";
  [1,2,4,8,16,32].forEach(function(binSize) {
    groups[key][binSize] = dims.dateCstar[binSize].group().reduce(
      reduceAdd(key), reduceRemove(key), reduceInitial);
  });
}

function initializeDateRange() {
  // Select the last day by default. If there is less than a day of data
  // select all data.
  dateRange = [dims.date[1].bottom(1)[0].date, dims.date[1].top(1)[0].date];
  dateRangeSizeMilli = dateRange[1].getTime() - dateRange[0].getTime();
  if (dateRangeSizeMilli >= 1000 * 60 * 60 * 24) {
    dateRange = [new Date(dateRange[1].getTime() - 1000 * 60 * 60 * 24), dateRange[1]];
  }
}

/*
plotting functions
*/
function initializeSflPlots() {
  plotRangeChart("PAR (w/m2)");
  // Only do intialize range chart filter (brush selection) if dateRange is not
  // the whole data set.
  if (dateRange[0] !== dims.date[1].bottom(1)[0].date || dateRange[1] !== dims.date[1].top(1)[0].date) {
    charts.range.filter(dateRange);
  }
  plotLineChart("speed", "Speed (knots)");
  plotLineChart("temp", "Temp (degC)");
  plotLineChart("salinity", "Salinity (psu)");
}

function initializePopPlots() {
  plotPopSeriesChart("abundance", "Abundance (10^6 cells/L)", legend = true);
  plotPopSeriesChart("fsc_small", "Forward scatter (a.u.)", legend = true);
}

function initializeCstarPlots() {
  plotLineChart("attenuation", "Attenuation (m-1)");
}

function plotRangeChart(yAxisLabel) {
  var key = "range";
  var chart = dc.lineChart("#" + key);
  charts[key] = chart;

  var minMaxTime = [dims.range[1].bottom(1)[0].date, dims.range[1].top(1)[0].date];
  var binSize = getBinSize(minMaxTime);
  var dim = dims.range[binSize];
  var group = addEmpty(groups.range[binSize], binSize);
  var yAxisDomain = yDomains[key] ? yDomains[key] : d3.extent(group.all(), valueAccessor);
  chart
    .width($("#" + key).width())
    .height($("#" + key).height())
    .x(d3.time.scale.utc().domain(minMaxTime))
    .y(d3.scale.linear().domain(yAxisDomain))
    .interpolate("cardinal")
    .clipPadding(10)
    .yAxisLabel(yAxisLabel)
    .xAxisLabel("Time (GMT)")
    .dimension(dim)
    .group(group)
    .valueAccessor(valueAccessor)
    .defined(function(d) { return (d.y !== null); });  // don't plot segements with missing data
  chart.on("filtered", throttled(function(chart, filter) {
    if (filter === null) {
      // No time window selected, reset dateRange to entire cruise
      dateRange = [dims.date[1].bottom(1)[0].date, dims.date[1].top(1)[0].date];
      updateCharts();
      updateMap();
    } else if (dateRange[0].getTime() !== filter[0].getTime() ||
               dateRange[1].getTime() !== filter[1].getTime()) {
      // If a time window is selected and it extends to the latest time point
      // then we set pinnedToMostRecent to true to make sure window always
      // stays pinned to the right when new data is added.
      if (filter[1].getTime() === dims.date[1].top(1)[0].date.getTime()) {
        pinnedToMostRecent = true;
      } else {
        pinnedToMostRecent = false;
      }
      dateRange = filter;  // set dateRange to filter window
      updateCharts();
      updateMap();
    }
  }, 400));
  chart.margins().left = 60;
  chart.yAxis().ticks(4);
  chart.yAxis().tickFormat(d3.format(".2f"));
  chart.render();
}

function plotLineChart(key, yAxisLabel) {
  var chart = dc.lineChart("#" + key);
  charts[key] = chart;

  var minMaxTime = dateRange;
  var binSize = getBinSize(minMaxTime);
  var dim = dims.date[binSize];
  var group = addEmpty(groups[key][binSize], binSize);
  var yAxisDomain = yDomains[key] ? yDomains[key] : d3.extent(group.all(), valueAccessor);

  chart
    .width($("#" + key).width())
    .height($("#" + key).height())
    .x(d3.time.scale.utc().domain(minMaxTime))
    .y(d3.scale.linear().domain(yAxisDomain))
    .brushOn(false)
    .clipPadding(10)
    .renderDataPoints({
      radius: 3,
      fillOpacity: 0.65,
      strokeOpacity: 1
    })
    .yAxisLabel(yAxisLabel)
    .xAxisLabel("Time (GMT)")
    .interpolate("cardinal")
    .dimension(dim)
    .group(group)
    .valueAccessor(valueAccessor)
    .defined(function(d) { return (d.y !== null); })  // don't plot segements with missing data
    .title(function(d) {
      return labelFormat(d.key) + '\n' + d3.format(".2f")(valueAccessor(d));
    });
  chart.margins().left = 60;
  chart.xAxis().ticks(6);
  chart.yAxis().ticks(4);
  chart.yAxis().tickFormat(d3.format(".2f"));
  chart.on("renderlet", function(chart) {
    chart.selectAll("circle").on("click", function(d, i) {
      d.data.value.members.forEach(function(m) {
        erased[key][m.date.toISOString()] = true;
      });
      resetPlots();
    });
  });
  chart.render();
}

function plotPopSeriesChart(key, yAxisLabel, legendFlag) {
  var chart = dc.seriesChart("#" + key);
  charts[key] = chart;

  var minMaxTime = dateRange;
  var binSize = getBinSize(minMaxTime);
  var dim = dims.datePop[binSize];
  var group = addEmptyPop(groups[key][binSize], binSize);
  var yAxisDomain = yDomains[key] ? yDomains[key] : d3.extent(group.all(), valueAccessor);

  // Create label for each point from key
  // e.g. "2015-08-04T22:22:42.660Z_beads" becomes a date and "beads"
  var titleFunc = function(d) {
    var t = labelFormat(keyAccessorPop(d)) + "\n";
    t += d3.format(".2f")(valueAccessor(d));
    return t;
  };

  var minMaxY = d3.extent(group.all(), valueAccessor);
  var legendHeight = 15;  // size of legend

  chart
    .width($("#" + key).width())
    .height($("#" + key).height())
    .chart(dc.lineChart)
    .x(d3.time.scale.utc().domain(minMaxTime))
    .y(d3.scale.linear().domain(yAxisDomain))
    .ordinalColors(["#FFBB78", "#FF7F0E", "#1F77B4", "#AEC7E8"])
    .dimension(dim)
    .group(group)
    .seriesAccessor(function(d) {
      // Return full population name rather than short name
      return popLookup[seriesAccessorPop(d)];
    })
    .keyAccessor(keyAccessorPop)
    .valueAccessor(valueAccessor)
    .brushOn(false)
    .clipPadding(10)
    .yAxisLabel(yAxisLabel)
    .xAxisLabel("Time (GMT)")
    .title(titleFunc)
    .childOptions(
    {
      defined: function(d) {
        // don't plot segements with missing data
        return (d.y !== null);
      },
      interpolate: "cardinal",
      renderDataPoints: {
        radius: 3,
        fillOpacity: 0.65,
        strokeOpacity: 1
      }
    });
  chart.margins().left = 60;
  chart.yAxis().ticks(6);
  chart.yAxis().tickFormat(d3.format(".2f"));

  // Legend setup
  if (legendFlag) {
    chart.margins().top = legendHeight + 5;
    // Must make legend and render in callback because the legend may get
    // rendered after postRedraw and postRender may never be called, making it
    // hard to know when to configure the legend.
    chart.seaflowLegend = dc.legend()
      .x(200)
      .y(2)
      .itemHeight(legendHeight)
      .gap(10)
      .horizontal(true)
      .autoItemWidth(true);
    chart.seaflowLegend.parent(chart);
    chart.on("postRedraw", function(chart) {
      chart.seaflowLegend.render();
      configureLegend(chart);
      // Clear postRedraw callback after first call. Basically mimic
      // postRender because postRender callback may not get called
      // https://github.com/dc-js/dc.js/issues/688
      chart.on("postRedraw", function(chart) {});
    });
  } else {
    // adjust chart size so that plot area is same size as chart with legend
    chart.height(chart.height() - legendHeight + 5);
  }
  chart.on("renderlet", function(chart) {
    chart.selectAll("circle").on("click", function(d, i) {
      d.data.value.members.forEach(function(m) {
        erased[key][makePopKey(m.date, m.pop)] = true;
      });
      resetPlots();
      console.log(d);
    });
  });
  chart.render();
}

function updateCharts() {
  var t0 = new Date();

  var binSize = getBinSize(dateRange);
  console.log("points per bin = " + binSize);

  ["speed", "temp", "salinity", "attenuation"].forEach(function(key) {
    if (charts[key]) {
      charts[key].dimension(dims.date[binSize]);
      charts[key].group(addEmpty(groups[key][binSize], binSize));
      charts[key].expireCache();
      charts[key].x().domain(dateRange);
      redrawChart(key);
    }
  });

  ["abundance", "fsc_small"].forEach(function(key) {
    if (charts[key]) {
      charts[key].dimension(dims.datePop[binSize]);
      charts[key].group(addEmptyPop(groups[key][binSize], binSize));
      charts[key].expireCache();
      charts[key].x().domain(dateRange);
      redrawChart(key);
    }
  });

  var t1 = new Date();
  console.log("chart updates took " + (t1.getTime() - t0.getTime()) / 1000);
  console.log("dateRange is " + dateRange.map(labelFormat).join(" - "));
}

function redrawChart(key) {
  if (! charts[key]) {
    return;
  }
  var t0 = new Date();
  recalculateY(charts[key], yDomains[key]);
  charts[key].redraw();
  charts[key].renderYAxis();
  charts[key].renderXAxis(charts[key].g());
  var t1 = new Date();
  console.log("chart " + key + " redraw took " + (t1.getTime() - t0.getTime()) / 1000);
}

function updateRangeChart() {
  var t0 = new Date();
  if (charts.range !== undefined) {
    // Note: rangeChart always shows the full time range, not current value of
    // dateRange, which may be a user selected time window.
    // rangeChart gets its own bin size because it's always based on total
    // date range, not based on a possibly user selected date range
    var totalDateRange = [dims.date[1].bottom(1)[0].date, dims.date[1].top(1)[0].date];
    var rangeBinSize = getBinSize(totalDateRange);

    // If we don't reset filters on dimensions here the re-render of the
    // time window selection will only show filtered data points if the
    // dimension changes.  This is due to the way crossfilter dimension
    // filtering works.
    var filter = charts.range.filter();
    if (filter !== null) {
      // If the focus range is pinned to the right of the x axis (most recent)
      // then
      if (pinnedToMostRecent) {
        // how much time has been added
        var delta = totalDateRange[1].getTime() - filter[1].getTime();
        // set right boundary to latest time
        filter[1] = totalDateRange[1];
        // move left boundary forward by delta
        filter[0] = new Date(filter[0].getTime() + delta);
      }
      charts.range.dimension().filterAll();  // clear filter on current dim
      dims.range[rangeBinSize].filter(filter);     // set filter on new dim
      dateRange = filter;  // update dateRange
    } else {
      dateRange = totalDateRange;  // update dateRange
    }
    charts.range.dimension(dims.range[rangeBinSize]);
    charts.range.group(addEmpty(groups.range[rangeBinSize], rangeBinSize));
    charts.range.expireCache();
    var yAxisDomain;
    if (! yDomains.range) {
      yAxisDomain = d3.extent(groups.range[rangeBinSize].all(), valueAccessor);
    } else {
      yAxisDomain = yDomains.range;
    }
    charts.range.x().domain(totalDateRange);
    charts.range.y().domain(yAxisDomain);

    // Also need to reset the brush extent to compensate for any potential
    // shifts in the X axis
    if (filter !== null) {
      charts.range.brush().extent(filter);
    }
    charts.range.render();
  }

  var t1 = new Date();
  console.log("range chart update took " + (t1.getTime() - t0.getTime()) / 1000);
}

// Recalculate y range for values in filterRange.  Must re-render/redraw to
// update plot.
function recalculateY(chart, yDomain) {
  if (! chart) {
      return;
  }
  if (! yDomain) {
    var timeKey;
    if (chart.children !== undefined) {
      // Population series plot
      timeKey = function(element) { return keyAccessorPop(element); };
    } else {
      // Single line chart
      // key for dimension is time
      timeKey = function(element) { return element.key; };
    }

    var valueInRange;
    if (dateRange) {
      valuesInRange = chart.group().all().filter(function(element, index, array) {
        return (timeKey(element) >= dateRange[0] && timeKey(element) <= dateRange[1]);
      });
    } else {
      valuesInRange = chart.group().all();
    }

    // If data has been filtered, some group elements may have no data, which would
    // cause minMaxY to always anchor at 0. Filter out those values here.
    var nonNull = valuesInRange.filter(function(d) {
      return valueAccessor(d) !== null;
    });
    var minMaxY = d3.extent(nonNull, function(d) {
      return valueAccessor(d);
    });
    // Make sure there is some distance within Y axis if all values are the same
    if (minMaxY[1] - minMaxY[0] === 0) {
      minMaxY[0] -= 0.1;
      minMaxY[1] += 0.1;
    }
    chart.y(d3.scale.linear().domain(minMaxY));
  } else {
    chart.y(d3.scale.linear().domain(yDomain));
  }
}

function configureLegend(chart) {
  if (! chart) {
    return;
  }

  dressButtons();

  var legendGroups = chart.selectAll("g.dc-legend-item");
  legendGroups[0].forEach(function(g) {
    var fullPopName = g.childNodes[1].firstChild.data;
    var popName = popLookup[fullPopName];

    // Set onclick handlers to show/hide data
    g.onclick = function() {
      popFlags[popName] = ! popFlags[popName];

      dressButtons();  // do this first to hide plotting delay
      resetPlots();
    };
  });
}

// Stylize buttons to indicate selection
function dressButtons() {
  ["abundance", "fsc_small"].forEach(function(key) {
    if (charts[key]) {
      var legendGroups = charts[key].selectAll("g.dc-legend-item");
      legendGroups[0].forEach(function(g) {
        var fullPopName = g.childNodes[1].firstChild.data;
        var popName = popLookup[fullPopName];
        var rect = g.childNodes[0];

        // Create a stroke to highlight rect when fill is transparent
        rect.setAttribute("stroke", rect.getAttribute("fill"));
        rect.setAttribute("stroke-width", 2);
        // Toggle rect tranparency to indicate selection
        if (popFlags[popName]) {
          rect.setAttribute("fill-opacity", 1);
        } else {
          rect.setAttribute("fill-opacity", 0);
        }
      });
    }
  });
}

function filterPops() {
  dims.pop.filterAll();  // remove filters
  if (popFlags !== null) {
    dims.pop.filter(function(d) {
      return popFlags[d];
    });
  }
}

// Return the distance between two coordinates in km
// http://stackoverflow.com/questions/365826/calculate-distance-between-2-gps-coordinates
// by cletus.  Which answer was itself based on
// http://www.movable-type.co.uk/scripts/latlong.html
//
// Args:
//     lonlat1 and lonlat2 are two-item arrays of decimal degree
//     latitude and longitude.
function geo2km(lonlat1, lonlat2) {
  if (! lonlat1 || ! lonlat2) {
    return 0;
  }
  var toRad = function(degree) { return degree * (Math.PI / 180); };
  var R = 6371; // km radius of Earth
  var dLat = toRad(lonlat2[1] - lonlat1[1]);
  var dLon = toRad(lonlat2[0] - lonlat1[0]);
  var lat1 = toRad(lonlat1[1]);
  var lat2 = toRad(lonlat2[1]);

  var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.sin(dLon/2) * Math.sin(dLon/2) * Math.cos(lat1) * Math.cos(lat2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  var d = R * c;
  return d;
}

// Return speed in knots traveling between lonlat1 and lonlat2 during time
// interval t1 to t2.
//
// Args:
//     lonlat1 and lonlat2 are two-item arrays of decimal degree
//     latitude and longitude.
//
//     t1 and t2 are Date objects corresponding to coordinates.
function geo2knots(lonlat1, lonlat2, t1, t2) {
  kmPerKnot = 1.852;  // 1 knot = 1.852 km/h
  km = geo2km(lonlat1, lonlat2);
  hours = (t2.getTime() - t1.getTime()) / 1000 / 60 / 60;
  return km / hours / kmPerKnot;
}

// Calculate average speed between this current SFL doc  and previous
//
// Args:
//     prev: previous SFL document
//     cur: current SFL document
//
// A new attribute "speed" will be added to cur. If there is not previous
// doc it will be null.
function addSpeed(prev, cur) {
  if (prev) {
    cur.speed = geo2knots([prev.lat, prev.lon], [cur.lat, cur.lon],
                          prev.date, cur.date);
  } else {
    cur.speed = null;
  }
}

function setupMap() {
  var attribution = 'Map data &copy; ';
  attribution += '<a href="http://openstreetmap.org">OpenStreetMap</a> contributors, ';
  attribution += '<a href="http://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>';
  cruiseMap = L.map('cruise-map').setView([47, -122], 4);
  L.Icon.Default.imagePath = '/leaflet/images';
  var tileLayer = L.tileLayer(tileURL, {
    attribution: attribution,
    maxZoom: 8
  });
  tileLayer.addTo(cruiseMap);
}

var updateMap = (function() {
  var alreadyRun = false;

  return function() {
    if (cruiseLocs.length === 0) {
      return;
    }
    var allLatLngs = [];
    var selectedLatLngs = [];
    cruiseLocs.forEach(function(loc) {
      if (! loc.latLng) {
        loc.latLng = new L.latLng(loc.lat, loc.lon);
      }
      allLatLngs.push(loc.latLng);
      if (dateRange && (loc.date >= dateRange[0] && loc.date <= dateRange[1])) {
        selectedLatLngs.push(loc.latLng);
      }
    });
    var latestLatLng = cruiseLocs[cruiseLocs.length-1].latLng;
    var latestCircle = new L.CircleMarker(latestLatLng, {
      color: "gray",
      radius: 6,
      weight: 2,
      opacity: 0.75
    });
    var allCruiseLine = new L.polyline(allLatLngs, {
      color: "gray",
      weight: 3,
      opacity: 0.5,
      smoothFactor: 1
    });
    var fg;
    if (dateRange) {
      var selectedCruiseLine = new L.polyline(selectedLatLngs, {
        color: "red",
        weight: 4,
        opacity: 0.5,
        smoothFactor: 1
      });
      fg = L.featureGroup([allCruiseLine, selectedCruiseLine, latestCircle]);
    } else {
      fg = L.featureGroup([allCruiseLine, latestCircle]);
    }

    if (cruiseLayer) {
      cruiseMap.removeLayer(cruiseLayer);
    }
    cruiseMap.addLayer(fg);
    cruiseLayer = fg;
    if (! alreadyRun) {
      // Only zoom to fit once
      cruiseMap.fitBounds(fg.getBounds());
      alreadyRun = true;
    }
  };
})();

/*
// Browser console debugging
window._groups = groups;
window._dims = dims;
window._xfs = xfs;
window._charts = charts;
window._addEmpty = addEmpty;
window._addEmptyPop = addEmptyPop;
window._erased = erased;
*/
