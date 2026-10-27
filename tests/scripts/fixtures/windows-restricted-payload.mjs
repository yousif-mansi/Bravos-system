import { execFile, spawn } from "node:child_process";
import fs from "node:fs";

const heartbeat = process.env.BRAVOS_PAYLOAD_HEARTBEAT;
if (heartbeat) fs.writeFileSync(heartbeat, String(process.pid));

const mode = process.argv[2];

function stayAlive() {
  setInterval(() => {}, 60_000);
}

if (mode === "report") {
  process.stdout.write(JSON.stringify({
    argv: process.argv.slice(3),
    cwd: process.cwd(),
    probe: process.env.BRAVOS_RESTRICTED_PROBE ?? null,
  }));
} else if (mode === "exit23") {
  process.stdout.write("restricted-stdout-marker\n");
  process.stderr.write("restricted-stderr-marker\n");
  process.exit(23);
} else if (mode === "exit259") {
  process.exit(259);
} else if (mode === "identity") {
  const pwsh = process.argv[3];
  const probe = process.argv[4];
  execFile(pwsh, ["-NoProfile", "-NonInteractive", "-File", probe], {
    windowsHide: true,
    shell: false,
  }, (error, stdout, stderr) => {
    if (error) {
      process.stderr.write(stderr || error.message);
      process.exit(error.code || 1);
      return;
    }
    process.stdout.write(stdout);
  });
} else if (mode === "hold") {
  fs.writeFileSync(process.argv[3], String(process.pid));
  stayAlive();
} else if (mode === "tree") {
  const childPidFile = process.argv[3];
  const grandchildPidFile = process.argv[4];
  const grandchild = spawn(process.execPath, [process.argv[1], "hold", grandchildPidFile], {
    stdio: "ignore",
    windowsHide: true,
    shell: false,
  });
  grandchild.on("error", () => {});
  fs.writeFileSync(childPidFile, String(process.pid));
  stayAlive();
} else {
  process.stderr.write("unknown payload mode\n");
  process.exit(9);
}
