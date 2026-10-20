#!/usr/bin/env python3
"""Deterministic accepted million-row workload; never overwrite an existing file."""
import argparse
import pathlib
parser = argparse.ArgumentParser()
parser.add_argument("path", type=pathlib.Path)
parser.add_argument("--rows", type=int, default=1_000_000)
args = parser.parse_args()
with args.path.open("x", encoding="utf-8", newline="") as output:
    output.write("elapsed_s," + ",".join(f"metric_{i}_ms" for i in range(20)) + ",phase\n")
    for row in range(args.rows):
        values = [f"{((row * (i + 3)) % 100003) / 1000:.3f}" for i in range(20)]
        output.write(f"{row / 1000:.3f}," + ",".join(values) + f",phase-{row % 8}\n")
