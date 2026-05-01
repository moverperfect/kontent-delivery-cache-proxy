#!/bin/sh
set -e
/usr/sbin/sshd
exec node dist/index.js
