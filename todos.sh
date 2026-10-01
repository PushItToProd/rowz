#!/usr/bin/env bash

PROGDIR="$(dirname "${BASH_SOURCE[0]}")"

sed -En 's/^\s*- \[ \]\s*[*][*]P([0-9]+)[*][*] (.*)$/\1\t\2/p' "$PROGDIR"/todo.md | sort -g