#!/usr/bin/env bash
# Lists the open prioritized items of todo.md in priority order. An open
# sub-item without a priority of its own takes its parent's and is listed
# under it.

PROGDIR="$(dirname "${BASH_SOURCE[0]}")"

awk '
  /^[[:space:]]*- / {
    match($0, /^[[:space:]]*/)
    depth = RLENGTH
    # Forget priorities of items at this depth or deeper.
    for (d in inherited) if (d + 0 >= depth) delete inherited[d]
    own = ""
    if (match($0, /\*\*P[0-9]+\*\*/)) own = substr($0, RSTART + 3, RLENGTH - 5)
    priority = own
    if (priority == "") {
      best = -1
      for (d in inherited) if (d + 0 < depth && d + 0 > best) best = d + 0
      if (best >= 0) priority = inherited[best]
    }
    if ($0 ~ /^[[:space:]]*- \[ \]/ && own != "") inherited[depth] = own
    if ($0 ~ /^[[:space:]]*- \[ \]/ && priority != "") {
      text = $0
      sub(/^[[:space:]]*- \[ \][[:space:]]*(\*\*P[0-9]+\*\*[[:space:]]*)?/, "", text)
      printf "%s\t%s%s\n", priority, (own == "" ? "  ↳ " : ""), text
    }
    next
  }
  # Anything that is not a list item or its continuation ends the nesting.
  /^[^[:space:]]/ { delete inherited }
' "$PROGDIR"/todo.md | sort -s -g -k1,1
