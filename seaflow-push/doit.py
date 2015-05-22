#!/usr/bin/env python
# Upload realtime SeaFlow data to SQLShare

import sqlshare

from collections import defaultdict
import os
import sys

def exit(message, code=1):
    print >> sys.stderr, message
    sys.exit(code)

def get_defaultdict_of_int():
    return defaultdict(int)

def main():
    # Find the STAT.CSV file
    stats_file = "stat-gga2dd.csv"
    stats_table = "stat.csv"
    # Find the SFL.CSV file
    sfl_file = "sfl-gga2dd.csv"
    sfl_table = "sfl.csv"
    # Find the cstar.csv file
    cstar_file = "cstar.csv"
    cstar_table = "cstar.csv"

    sql = sqlshare.SQLShare()

    print "updating STATS..."
    sql.uploadone(stats_file, stats_table)

    print "updating SFL..."
    sql.uploadone(sfl_file, sfl_table)

    print "updating CSTAR..."
    sql.uploadone(cstar_file, cstar_table)

if __name__ == "__main__":
    main()
