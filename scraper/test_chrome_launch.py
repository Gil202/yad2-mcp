import subprocess

cmd = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "--remote-debugging-port=9222",
    "--no-first-run",
    "--no-default-browser-check",
    "--user-data-dir=/tmp/test_chrome_profile"
]

print("Launching Google Chrome directly...")
proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

try:
    stdout, stderr = proc.communicate(timeout=5)
    print("STDOUT:", stdout.decode())
    print("STDERR:", stderr.decode())
except subprocess.TimeoutExpired:
    print("SUCCESS! Chrome is running and listening on port 9222!")
    proc.kill()
