#!/usr/bin/env python

import os
import sys
import argparse

# Convert degrees decimal minutes coordinate to decimal degrees
# Args:
#   ddm = two item list: [degrees string, decimal minutes string]
#         e.g. ["21", 16.6922"]
# Return:
#   A decimal degree string with precision to 4 decimal places (11.132 m)
#   e.g. "21.2782"
def ddm2dd(ddm):
    dd = int(ddm[0]) + (float(ddm[1]) / 60)
    return "%.04f" % dd

# Convert from GGA coordinate to degree decimal minutes
# Args:
#   gga_string = GGA format coordinate string, e.g. "2116.6922"
#
# Return:
#   A two-item tuple of of strings (degrees, decimal minutes).
#   e.g. ("21", "16.6922")
def gga2ddm(gga):
    try:
        dot_index = gga.index(".")
        degrees = gga[:gga.index(".")-2]
        decimal_minutes = gga[gga.index(".")-2:]
    except ValueError:
        degrees = gga[:2]
        decimal_minutes = gga[2:]
    return (degrees, decimal_minutes)

# Convert from GGA coordinate string to decimal degrees string
# with precision to 4 decimal places (11.132 m)
# e.g. "2116.6922" -> "21.2782"
def gga2dd(gga):
    return ddm2dd(gga2ddm(gga))

def csv_gga2dd(csv_in, csv_out):
    with open(csv_in) as fin:
        with open(csv_out, "w") as fout:
            lines = fin.readlines()
            header = lines[0].split(",")
            lat_index = header.index("lat")
            lon_index = header.index("lon")
            fout.write(lines[0])
            i = 0
            for line in lines[1:]:
                fields = line.split(",")
                try:
                    fields[lat_index] = gga2dd(fields[lat_index])
                except:
                    sys.stderr.write("%i: %s\n" % (i, line))
                    raise

                # Input data has no E/W sign for longitude, but for the
                # Dec 2014 cruise in Hawaii we know longitudes must be
                # W (negative)
                try:
                    fields[lon_index] = gga2dd(fields[lon_index])
                    if fields[lon_index][0] != "-":
                        fields[lon_index] = "-" + fields[lon_index]
                except:

                    raise

                fout.write(",".join(fields))
                i += 1

if __name__ == "__main__":
    p = argparse.ArgumentParser(
        description="""Convert lat and lon fields in stat.csv or sfl.csv from
        GGA to decimal degrees""")
    p.add_argument("input", help="""Input csv file""")
    p.add_argument("output", help="""Output csv file""")
    args = p.parse_args()

    csv_gga2dd(args.input, args.output)
