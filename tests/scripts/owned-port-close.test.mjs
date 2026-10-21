import assert from "node:assert/strict";
import test from "node:test";
import {
  probeWindowsListen,
  waitForOwnedPortClose,
} from "../../packages/testkit/src/owned-port-close.ts";

const PORT = 55433;
const STILL_LISTENING = /owned port 55433 is still listening/;

function accessDenied(host) {
  return Object.assign(new Error(`connect EACCES ${host}:${PORT}`), { code: "EACCES" });
}

function unexpected(code, host) {
  return Object.assign(new Error(`connect ${code} ${host}:${PORT}`), { code });
}

function fakeClock(start = 0) {
  let now = start;
  return {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    advance(ms) {
      now += ms;
    },
    get elapsed() {
      return now - start;
    },
  };
}

async function waitWith(overrides) {
  const clock = overrides.clock ?? fakeClock();
  return waitForOwnedPortClose(PORT, {
    platform: "win32",
    connect: overrides.connect,
    nativeListening: overrides.nativeListening,
    now: clock.now,
    sleep: clock.sleep,
    ...("budgetMs" in overrides ? { budgetMs: overrides.budgetMs } : {}),
  });
}

test("Windows EACCES with a successful CLOSED native probe treats the owned port as closed", async () => {
  const nativeCalls = [];
  await waitWith({
    connect: async (host) => {
      throw accessDenied(host);
    },
    nativeListening: async (port, remainingMs) => {
      nativeCalls.push({ port, remainingMs });
      return false;
    },
  });
  assert.equal(nativeCalls.length, 2);
  assert.ok(nativeCalls.every((call) => call.port === PORT && call.remainingMs === 5_000));
});

test("Windows EACCES with a persisting OPEN native probe fails the existing close loop", async () => {
  const clock = fakeClock();
  await assert.rejects(
    () => waitWith({
      clock,
      connect: async (host) => {
        throw accessDenied(host);
      },
      nativeListening: async () => true,
    }),
    STILL_LISTENING,
  );
  assert.equal(clock.elapsed, 5_000);
});

test("Windows EACCES native query failure is rejected and is not treated as closed", async () => {
  const queryError = new Error("Get-NetTCPConnection failed");
  await assert.rejects(
    () => waitWith({
      connect: async (host) => {
        throw accessDenied(host);
      },
      nativeListening: async () => {
        throw queryError;
      },
    }),
    (error) => error === queryError,
  );
});

test("unexpected connect errors keep their original rejection and skip the native probe", async () => {
  let nativeCalls = 0;
  await assert.rejects(
    () => waitWith({
      connect: async (host) => {
        throw unexpected("EPERM", host);
      },
      nativeListening: async () => {
        nativeCalls += 1;
        return false;
      },
    }),
    (error) => error instanceof Error && "code" in error && error.code === "EPERM",
  );
  assert.equal(nativeCalls, 0);

  const ipv6Denied = accessDenied("::1");
  await assert.rejects(
    () => waitForOwnedPortClose(PORT, {
      platform: "linux",
      connect: async () => {
        throw ipv6Denied;
      },
      nativeListening: async () => {
        nativeCalls += 1;
        return false;
      },
      now: () => 0,
      sleep: async () => {
        throw new Error("sleep must not run");
      },
    }),
    (error) => error === ipv6Denied,
  );
  assert.equal(nativeCalls, 0);
});

test("the Windows EACCES native probe is bounded by the remaining 5s shutdown deadline", async () => {
  const clock = fakeClock();
  const remainings = [];
  const sleeps = [];
  const originalSleep = clock.sleep;
  clock.sleep = async (ms) => {
    sleeps.push(ms);
    await originalSleep(ms);
  };
  await assert.rejects(
    () => waitWith({
      clock,
      connect: async (host) => {
        throw accessDenied(host);
      },
      nativeListening: async (_port, remainingMs) => {
        remainings.push(remainingMs);
        return true;
      },
    }),
    STILL_LISTENING,
  );
  assert.equal(clock.elapsed, 5_000);
  assert.equal(remainings[0], 5_000);
  assert.equal(remainings.at(-1), 100);
  assert.ok(remainings.every((value) => value > 0 && value <= 5_000));
  assert.ok(sleeps.every((value) => value > 0 && value <= 100));
});

test("a connect that consumes most of the budget passes the reduced remaining native timeout", async () => {
  const clock = fakeClock();
  const nativeCalls = [];
  const sleeps = [];
  const originalSleep = clock.sleep;
  clock.sleep = async (ms) => {
    sleeps.push(ms);
    await originalSleep(ms);
  };
  await waitWith({
    clock,
    connect: async (host) => {
      if (host === "127.0.0.1") {
        return false;
      }
      clock.advance(4_200);
      throw accessDenied(host);
    },
    nativeListening: async (port, remainingMs) => {
      nativeCalls.push({ port, remainingMs });
      return false;
    },
  });
  assert.deepEqual(nativeCalls, [{ port: PORT, remainingMs: 800 }]);
  assert.deepEqual(sleeps, []);
  assert.equal(clock.elapsed, 4_200);
});

test("a slow still-open EACCES probe sleeps only the remaining budget", async () => {
  const clock = fakeClock();
  const nativeCalls = [];
  const sleeps = [];
  const originalSleep = clock.sleep;
  clock.sleep = async (ms) => {
    sleeps.push(ms);
    await originalSleep(ms);
  };
  await assert.rejects(
    () => waitWith({
      clock,
      connect: async (host) => {
        if (host === "127.0.0.1") {
          return false;
        }
        clock.advance(4_920);
        throw accessDenied(host);
      },
      nativeListening: async (_port, remainingMs) => {
        nativeCalls.push(remainingMs);
        return true;
      },
    }),
    STILL_LISTENING,
  );
  assert.deepEqual(nativeCalls, [80]);
  assert.deepEqual(sleeps, [80]);
  assert.equal(clock.elapsed, 5_000);
});

test("a connect that exhausts the budget rejects without invoking the native probe", async () => {
  const clock = fakeClock();
  let nativeCalls = 0;
  let slept = 0;
  const originalSleep = clock.sleep;
  clock.sleep = async (ms) => {
    slept += 1;
    await originalSleep(ms);
  };
  await assert.rejects(
    () => waitWith({
      clock,
      connect: async (host) => {
        if (host === "127.0.0.1") {
          return false;
        }
        clock.advance(5_000);
        throw accessDenied(host);
      },
      nativeListening: async () => {
        nativeCalls += 1;
        return false;
      },
    }),
    STILL_LISTENING,
  );
  assert.equal(nativeCalls, 0);
  assert.equal(slept, 0);
  assert.equal(clock.elapsed, 5_000);
});

test("Windows listen probe maps exact OPEN and CLOSED output and rejects query failures", async () => {
  const captured = [];
  const run = (stdout, error = null, stderr = "") => {
    return (file, args, options, callback) => {
      captured.push({ file, args: [...args], options });
      callback(error, stdout, stderr);
    };
  };

  assert.equal(await probeWindowsListen(PORT, 1_500, run("OPEN\r\n")), true);
  assert.equal(await probeWindowsListen(PORT, 800, run("CLOSED\n")), false);

  const invocation = captured[0];
  assert.equal(invocation.file, "powershell.exe");
  assert.deepEqual(invocation.args.slice(0, 4), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"]);
  assert.equal(invocation.options.encoding, "utf8");
  assert.equal(invocation.options.windowsHide, true);
  assert.equal(invocation.options.timeout, 1_500);
  assert.equal(captured[1].options.timeout, 800);
  const command = invocation.args[4];
  assert.match(command, /try \{ \$ErrorActionPreference='Stop';/);
  assert.match(command, /Get-NetTCPConnection -ErrorAction Stop/);
  assert.match(command, /State -eq 'Listen'/);
  assert.match(command, /\(\$_\.LocalPort -as \[int\]\) -eq 55433/);
  assert.doesNotMatch(command, /LocalAddress|AddressFamily|-LocalPort/);
  assert.match(command, /'OPEN'/);
  assert.match(command, /'CLOSED'/);
  assert.match(command, /\} catch \{ \[Console\]::Error\.WriteLine\(\$_\.Exception\.Message\); exit 1 \}/);

  await assert.rejects(
    () => probeWindowsListen(PORT, 400, run("", Object.assign(new Error("exit 1"), { code: 1 }), "access denied")),
    /Windows listen probe failed: access denied/,
  );
  await assert.rejects(
    () => probeWindowsListen(PORT, 400, run("", Object.assign(new Error("killed"), { killed: true }))),
    /Windows listen probe timed out/,
  );
  await assert.rejects(
    () => probeWindowsListen(PORT, 400, run("MAYBE\n")),
    /malformed output/,
  );
  await assert.rejects(
    () => probeWindowsListen(22.5, 400, () => {
      throw new Error("execFile must not run for an invalid port");
    }),
    /Invalid TCP port: 22\.5/,
  );
  await assert.rejects(
    () => probeWindowsListen(PORT, 0, () => {
      throw new Error("execFile must not run for a nonpositive remaining budget");
    }),
    /positive remaining shutdown budget/,
  );
  await assert.rejects(
    () => probeWindowsListen(PORT, -5, () => {
      throw new Error("execFile must not run for a nonpositive remaining budget");
    }),
    /positive remaining shutdown budget/,
  );
  await assert.rejects(
    () => probeWindowsListen(PORT, 0.4, () => {
      throw new Error("execFile must not run for a sub-millisecond remaining budget");
    }),
    /positive remaining shutdown budget/,
  );
});
