#!/bin/sh
# Print the site's current public address (it changes each time the tunnel restarts).
journalctl --user -u quran-tunnel --no-pager -o cat | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1
