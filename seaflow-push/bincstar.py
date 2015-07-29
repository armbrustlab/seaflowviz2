#!/usr/bin/env python
"""Bin cstar transmissometer data into 3 min windows and validate data."""

import argparse
import datetime
import re
import sys


def main():
    """Read cstar file, bin in 3 minute windows, and validate data values."""
    p = argparse.ArgumentParser(
        description="""Bin cstar transmissometer data into 3 min windows and
        validate data.""")
    p.add_argument("input", help="""Input csv file""")
    p.add_argument("output", help="""Output csv file""")
    args = p.parse_args()

    cstar_gen = clean_cstar(open(args.input))
    out_gen = bin_cstar(cstar_gen)
    with open(args.output, "w") as fh:
        write_cstar(out_gen, fh)


def write_cstar(cstar_data, outfh):
    """Write cstar csv file based on cstar data iterable.

    Args:
        cstar_data: iterable of cstar data (ISO_STRING, float)
        outfh: writable file object for output
    """
    outfh.write("time,attenuation\n")
    for item in cstar_data:
        line = ",".join([item[0].isoformat() + "Z", "%.03f" % item[1]])
        outfh.write(line + "\n")


def clean_cstar(cstar_file):
    """Generator function to read cstar csv file.

    Lines with invalid timestamps or data will be skipped with a warning.

    Args:
        cstar_file: open cstar csv file object.
        One header line, then lines of format
        2015-07-25T01:46:41.9570Z,0.076

    Returns:
        Generator of (datetime, float)
    """
    header_seen = False
    line_num = 0
    for line in cstar_file:
        line_num += 1

        # Make sure line is complete
        if not line.endswith("\n"):
            sys.stderr.write("Warning: %i, line is incomplete\n" % line_num)
            continue

        if header_seen:
            try:
                timestamp, value = line.split(",")
            except ValueError:
                sys.stderr.write("Warning: %i, line does not have 2 values\n" %
                                 line_num)
                continue

            # Not using datetime.datetime.strptime because it's 3x slower than
            # regex
            date = strptime(timestamp)
            if date is None:
                sys.stderr.write("Warning: %i, could not parse date %s\n" %
                                 (line_num, timestamp))
                continue

            try:
                number = float(value)
            except ValueError:
                sys.stderr.write("Warning: %i, invalid float \n" %
                                 line_num)
                sys.stderr.write(value + "\n")
                continue

            # Ignore values less than 0.6 (probably filtered water control)
            # 0.6 is a magic judgment call heuristic number
            if number >= 0.06:
                yield (date, number)
        else:
            header_seen = True


# datetime string parsing regex to match e.g. "2015-07-28T10:49:50.9003Z"
datere = re.compile(r"(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d+Z")


def strptime(datestr):
    """Return a datetime object based on datestr.

    Args:
        datestr: date string in format 2015-07-25T01:46:41.9570Z

    Returns:
        datetime object based on datestr, ignores ms and assumes UTC
    """
    g = datere.match(datestr)
    d = None
    if g:
        args = [int(x) for x in g.groups()]
        d = datetime.datetime(*args)
    return d


def bin_cstar(cstar_data):
    """Generator function to average transmissometer data into 3 min. windows.

    Args:
        cstar_data: iterable of cstar (datetime, float)

    Returns:
        Generator of (datetime for start of 3 min window, mean)
    """
    three = datetime.timedelta(minutes=3)
    start = None
    end = None
    cursum = 0.0
    curcount = 0
    for date, number in cstar_data:
        if start is None:
            start = date
            end = start + three
        elif date >= end:
            try:
                mean = cursum / curcount
            except ZeroDivisionError:
                mean = 0.0
            yield (start, mean)
            while date >= end:
                start = end
                end = start + three
            cursum = number
            curcount = 1
        else:
            cursum += number
            curcount += 1


if __name__ == "__main__":
    main()
