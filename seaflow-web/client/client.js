Stat = new Mongo.Collection("stat");
Sfl = new Mongo.Collection("sfl");
var subHandles = {
  sfl: Meteor.subscribe("sfl"),
  stat: null
};
Session.set("sflReady", false);
Session.set("statReady", false);
Session.set("recent", null);

Tracker.autorun(function(computation) {
  if (subHandles.sfl.ready()) {
    Session.set("sflReady", true);
    computation.stop();
  }
});

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
  sflReady: function() {
    return Session.get("sflReady");
  },
  statReady: function() {
    return Session.get("statReady");
  },
  recent: function() {
    return Session.get("recent");
  }
});

Template.charts.rendered = function() {
  var madeSflPlots = false;
  var madePopPlots = false;

  Sfl.find().observe({
    added: throttled(function(doc) {
      if (! madeSflPlots) {
        initializeSflData();
        initializeDateRange();
        initializeSflPlots();
        madeSflPlots = true;

        // Subscribe to stat after SFL data has been received
        subHandles.stat = Meteor.subscribe("stat");
        Tracker.autorun(function(computation) {
          if (subHandles.stat.ready()) {
            Session.set("statReady", true);
            computation.stop();
          }
        });
      }
      updateRangeChart();
      updateCharts();
      updateMap();
      Session.set("recent", doc.date.toISOString());
    }, 1000, function(doc) {
      xfs.sfl.add([doc]);
      xfs.range.add([doc]);
      cruiseLocs.push({lat: doc.lat, lon: doc.lon, date: doc.date});
    })
  });

  Stat.find().observe({
    added: throttled(function(doc) {
      if (! madePopPlots) {
        initializePopData();
        initializePopPlots();
        madePopPlots = true;
      }
      updateCharts();
    }, 1000, function(doc) {
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
    })
  });

  var tileURL = 'http://173.250.187.201:3002/{z}/{x}/{y}.png';
  var attribution = 'Map data &copy; <a href="http://openstreetmap.org">OpenStreetMap</a> contributors, <a href="http://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>';
  cruiseMap = L.map('cruise-map').setView([47, -122], 4);
  L.Icon.Default.imagePath = '/leaflet/images';
  var tileLayer = L.tileLayer(tileURL, {
    attribution: attribution,
    maxZoom: 8
  });
  tileLayer.addTo(cruiseMap);
};

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
var xfs = { "sfl": crossfilter(), "range": crossfilter(), "pop": crossfilter() };
// crossfilter dimensions
var dims = { "date": [], "range": [], "pop": [], "datePop": [] };
// crossfilter groups
var groups = {
  "velocity": [], "temp": [], "salinity": [], "range": [],
  "abundance": [], "fsc_small": []
};

// dc.js charts
var charts = {};
dc.disableTransitions = true;

/*
// Browser console debugging
window._groups = groups;
window._dims = dims;
window._xfs = xfs;
window._charts = charts;
*/

/*
Map stuff
*/
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
  velocity: [0, 20],
  temp: null,
  salinity: null,
  par: null,
  attenuation: [0, 0.3],
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

  // Figure out how large to make each bin (in 480 3 minute point increments)
  // in order to keep points
  // below maxPoints. e.g. if there are 961 3 minute points in range,
  // then the new bin size would be 3 * 3 minutes = 9 minutes. If there
  // were 960 the new bin size would be 2 * 3 minutes = 6 minutes.
  //return Math.min(ceiling(points / maxPoints), 8);
  //return 1;
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

function valueAccessor(d) {
  if (d.value.total === null || d.value.count === 0) {
    // D3 plots are setup so that if a y value is null the line segement
    // is broken to indicate missing data.
    return null;
  } else {
    return d.value.total / d.value.count;
  }
}

/*
Crossfilter functions
*/

// Reduce functions to stop crossfilter from coercing null values to 0
// Allows chart.defined() to work as expected and create disconintinous
// line charts, while also differentiating between true 0 values and
// missing data.
function reduceAdd(key) {
  return function(p, v) {
    //console.log("adding: ", v.pop, v.time, v[key], p.count, p.total);
    if (v[key] !== null) {
      ++p.count;
    }
    // want to avoid coercing a null p.total to 0 by adding a null
    // v[key]
    if (p.total !== null || v[key] !== null) {
      p.total += v[key];
    }
    return p;
  };
}

function reduceRemove(key) {
  return function(p, v) {
    if (v[key] !== null) {
      --p.count;
    }
    // want to avoid coercing a null p.total to 0 by subtracting
    // a null v[key]
    if (p.total !== null || v[key] !== null) {
      p.total -= v[key];
    }
    return p;
  };
}

function reduceInitial() {
  return { count: 0, total: null };
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
  var keyAccessor = function(d) {
    return new Date(+(d.key.substr(0, 13)));
  };
  var seriesAccessor = function(d) {
    return d.key.substr(14);
  };
  return {
    all: function() {
      var prev = {};
      var groups = [];
      group.all().forEach(function(g) {
        var pop = seriesAccessor(g);
        var date = keyAccessor(g);
        // If the gap between data is more than <bucket size> + 1 minute,
        // insert a null data point to break line segment.
        if (prev[pop] && (date - prev[pop]) > binSize * 3 * msIn1Min + msIn1Min) {
          var newdate = new Date(prev[pop].getTime() + binSize * 3 * msIn1Min);
          /*console.log("added empty group " + pop + " " + newdate.toISOString()
                      + " between " + prev[pop].toISOString() + " and " +
                      date.toISOString());*/
          groups.push({
            key: String(newdate.getTime()) + "_" + pop,
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

/*
// Browser console debugging
window._addEmpty = addEmpty;
window._addEmptyPop = addEmptyPop;
*/

function initializeSflData() {
  var msIn3Min = 3 * 60 * 1000;
  dims.date[1] = xfs.sfl.dimension(function(d) { return d.date; });
  var first = dims.date[1].bottom(1)[0].date;
  [2,4,8,16,32].forEach(function(binSize) {
    dims.date[binSize] = xfs.sfl.dimension(function(d) {
      return roundDate(d.date, first, binSize*msIn3Min);
    });
  });

  ["temp", "salinity"].forEach(function(key) {
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

  dims.datePop[1] = xfs.pop.dimension(function(d) { return String(d.date.getTime()) + "_" + d.pop; });

  // dims.date must have data from SFL by now!
  var first = dims.date[1].bottom(1)[0].date;
  [2,4,8,16,32].forEach(function(binSize) {
    dims.datePop[binSize] = xfs.pop.dimension(function(d) {
      return String(roundDate(d.date, first, binSize*msIn3Min).getTime()) + "_" + d.pop;
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
  //plotLineChart("velocity", "Speed (knots)");
  plotLineChart("temp", "Temp (degC)");
  plotLineChart("salinity", "Salinity (psu)");
}

function initializePopPlots() {
  plotPopSeriesChart("abundance", "Abundance (10^6 cells/L)", legend = true);
  plotPopSeriesChart("fsc_small", "Forward scatter (a.u.)", legend = true);
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

  // As small performance improvement, hardcode substring positions since
  // we know the key is always something like "1426522573342_key" and the
  // length of the milliseconds string from Date.getTime() won't change until
  // 2286
  var keyAccessor = function(d) {
    return new Date(+(d.key.substr(0, 13)));
  };
  var seriesAccessor = function(d) {
    return popLookup[d.key.substr(14)];
  };

  // Create label for each point from key
  // e.g. "1437259296000_beads" becomes a date and "beads"
  var titleFunc = function(d) {
    return labelFormat(keyAccessor(d)) + "\n" + d3.format(".2f")(valueAccessor(d));
  };
  // Bind to window for easy browswer console debugging
  //window._titleFunc = titleFunc;

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
    .seriesAccessor(seriesAccessor)
    .keyAccessor(keyAccessor)
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
  chart.render();
}

function updateCharts() {
  var t0 = new Date();

  var binSize = getBinSize(dateRange);
  console.log("points per bin = " + binSize);

  ["temp", "salinity"].forEach(function(key) {
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

  ["attenuation"].forEach(function(key) {
    if (charts[key]) {
      charts[key].dimension(dims.date[binSize]);
      charts[key].group(addEmpty(groups[key][binSize], binSize));
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
      // key for dimension is [time, pop]
      timeKey = function(element) {
        var parts = element.key.split("_");
        return new Date(+parts[0]);
      };
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
      filterPops();

      // Update plot
      ["abundance", "fsc_small"].forEach(function(key) {
        redrawChart(key);
      });
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
