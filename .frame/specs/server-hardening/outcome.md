
## T01 — Add the install-script scenario harness; fix the result line, home scoping and pid checks

Added test/installScript.test.js, which runs the real install-frame-server.sh against a temporary HOME with packages built at test time (the real bin/frame-server plus a stand-in server from test/fixtures/fake-frame-server) and logging systemctl/loginctl stubs, so the systemd branch runs on any machine. Fixed S1: start_server sets SERVICE_USED instead of being captured by $(…) (the linger advice had been swallowed into the service name), and result() escapes every field with json_escape. Fixed S6/S7: uses_systemd() is true only for the default home, and is_frame_pid accepts a pid only when its command line runs from this home (raw or resolved path); both are used by start/stop/running_pid in the script and by service_mode/running_pid in bin/frame-server. No fake getconf yet: the glibc guard that needs it is T05.

_Captured: 2026-11-11 · 8 file change(s)_

---
