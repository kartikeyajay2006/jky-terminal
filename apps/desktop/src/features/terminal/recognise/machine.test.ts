import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { recogniseDf, recogniseDockerPs, recogniseJson, recognisePs } from "./machine";
import type { Completion } from "./types";

const done = (command: string, output = "", code = 0): Completion => ({
  command,
  output,
  code,
  cwd: "/x",
});

/** Output this machine actually printed, captured when the tests were written. */
const REAL = "/tmp/claude-1000/-home-kartikeyayadav-Desktop-jky-terminal/3a85ed93-03d8-4774-8cd9-04afa6aa15a4/scratchpad/real";
const real = (f: string) => {
  try {
    return readFileSync(`${REAL}/${f}`, "utf8");
  } catch {
    return null;
  }
};

describe("recogniseDf", () => {
  const DF = `Filesystem      Size  Used Avail Use% Mounted on
/dev/nvme0n1p6  199G  175G   20G  90% /
devtmpfs        7.7G     0  7.7G   0% /dev
tmpfs           7.7G  286M  7.4G   4% /dev/shm
/dev/nvme0n1p1  974M  158M  749M  18% /boot/efi`;

  it("reads every mount into a meter", () => {
    const out = recogniseDf(done("df -h", DF))!;
    expect(out.view.kind).toBe("meters");
    if (out.view.kind !== "meters") return;
    expect(out.view.meters).toHaveLength(4);
  });

  /*
   * Fullest first.
   *
   * The disk about to be a problem is the one you came to look for, and it is
   * rarely the first line `df` happens to print.
   */
  it("puts the fullest disk first", () => {
    const out = recogniseDf(done("df -h", DF))!;
    if (out.view.kind !== "meters") return;
    expect(out.view.meters[0].label).toBe("/");
    expect(out.view.meters[0].used).toBe(90);
    expect(out.view.meters.at(-1)!.used).toBe(0);
  });

  /*
   * A mount point can contain spaces — "/run/media/me/My Drive" — so it takes
   * the rest of the line rather than the next field.
   */
  it("keeps a mount point that has spaces in it", () => {
    const withSpace = `Filesystem      Size  Used Avail Use% Mounted on
/dev/sdb1       1.8T  1.1T  700G  62% /run/media/me/My Drive`;
    const out = recogniseDf(done("df -h", withSpace))!;
    if (out.view.kind !== "meters") return;
    expect(out.view.meters[0].label).toBe("/run/media/me/My Drive");
  });

  it("keeps the sizes as df wrote them", () => {
    const out = recogniseDf(done("df -h", DF))!;
    if (out.view.kind !== "meters") return;
    expect(out.view.meters[0].usedText).toBe("175G");
    expect(out.view.meters[0].totalText).toBe("199G");
  });

  it("says nothing without the header it expects", () => {
    expect(recogniseDf(done("df -h", "/dev/sda1 100G 50G 50G 50% /"))).toBeNull();
  });

  const realDf = real("df.txt");
  it.skipIf(!realDf)("reads what this machine printed", () => {
    const out = recogniseDf(done("df -h", realDf!))!;
    expect(out).not.toBeNull();
    if (out.view.kind !== "meters") return;
    expect(out.view.meters.length).toBeGreaterThan(1);
    for (const m of out.view.meters) {
      expect(m.label).not.toBe("");
      expect(m.used).toBeGreaterThanOrEqual(0);
      expect(m.used).toBeLessThanOrEqual(100);
    }
  });
});

describe("recognisePs", () => {
  const AUX = `USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
root           1  0.0  0.0  40088 13104 ?        Ss   Aug28   3:18 /usr/lib/systemd/systemd --switched-root
me          4242 91.4  2.1 900000 90000 pts/1    Rl+  10:00   0:30 node /home/me/server.js --port 3000`;

  it("reads the rows", () => {
    const out = recognisePs(done("ps aux", AUX))!;
    if (out.view.kind !== "table") return;
    expect(out.view.rows).toHaveLength(2);
    expect(out.view.rows[1].cells.pid).toBe("4242");
    expect(out.view.rows[1].cells.user).toBe("me");
  });

  /*
   * The command is the last column and is mostly spaces.
   *
   * Splitting on whitespace cuts every process at its first argument, which
   * is exactly where the part that tells two of them apart begins.
   */
  it("keeps the whole command line", () => {
    const out = recognisePs(done("ps aux", AUX))!;
    if (out.view.kind !== "table") return;
    expect(out.view.rows[1].cells.command).toBe("node /home/me/server.js --port 3000");
  });

  // `ps aux` and `ps -ef` order their columns differently, so the header is
  // read rather than assumed.
  it("reads the column order from the header", () => {
    const EF = `UID          PID    PPID  C STIME TTY          TIME CMD
root           1       0  0 Aug28 ?        00:03:18 /usr/lib/systemd/systemd`;
    const out = recognisePs(done("ps -ef", EF))!;
    if (out.view.kind !== "table") return;
    expect(out.view.rows[0].cells.pid).toBe("1");
    expect(out.view.rows[0].cells.command).toContain("systemd");
  });

  it("marks a process that is working hard", () => {
    const out = recognisePs(done("ps aux", AUX))!;
    if (out.view.kind !== "table") return;
    expect(out.view.rows[1].tone).toBe("warn");
    expect(out.view.rows[0].tone).toBeUndefined();
  });

  it("says nothing without a recognisable header", () => {
    expect(recognisePs(done("ps aux", "just some text\nand more"))).toBeNull();
  });

  for (const [file, command] of [["ps-aux.txt", "ps aux"], ["ps-ef.txt", "ps -ef"]] as const) {
    const captured = real(file);
    it.skipIf(!captured)(`reads what this machine printed for ${command}`, () => {
      const out = recognisePs(done(command, captured!))!;
      expect(out, `${file} was not recognised`).not.toBeNull();
      if (out.view.kind !== "table") return;
      expect(out.view.rows.length).toBeGreaterThan(5);
      for (const row of out.view.rows) {
        expect(row.cells.pid).toMatch(/^\d+$/);
        expect(row.cells.command).not.toBe("");
      }
    });
  }
});

describe("recogniseDockerPs", () => {
  const PS = `CONTAINER ID   IMAGE                  COMMAND                  CREATED       STATUS                   PORTS                    NAMES
9f2e1a4b8c7d   postgres:16            "docker-entrypoint.s…"   2 hours ago   Up 2 hours               0.0.0.0:5432->5432/tcp   postgres
1a2b3c4d5e6f   redis:7-alpine         "docker-entrypoint.s…"   2 hours ago   Up 2 hours (healthy)     0.0.0.0:6379->6379/tcp   redis
7g8h9i0j1k2l   ghcr.io/me/api:latest  "node server.js"         3 days ago    Exited (137) 5 min ago                            api`;

  it("reads the containers", () => {
    const out = recogniseDockerPs(done("docker ps", PS))!;
    if (out.view.kind !== "table") return;
    expect(out.view.rows).toHaveLength(3);
    expect(out.view.rows[0].cells.name).toBe("postgres");
    expect(out.view.rows[0].cells.ports).toBe("0.0.0.0:5432->5432/tcp");
  });

  /*
   * "Up 2 hours" is running and "Exited (137)" is not, and that difference is
   * the first thing anybody looks for.
   */
  it("tells running from stopped", () => {
    const out = recogniseDockerPs(done("docker ps", PS))!;
    if (out.view.kind !== "table") return;
    expect(out.view.rows.map((r) => r.tone)).toEqual(["good", "good", "bad"]);
    // The counts are chips now: two facts rather than one sentence, so the
    // one that is bad news can be coloured as such.
    expect(out.chips).toEqual([
      { text: "2 running", tone: "good" },
      { text: "1 stopped", tone: "bad" },
    ]);
  });

  /*
   * Every field here contains single spaces — an image tag, "Up 2 hours", a
   * port map. Splitting on one space would cut all three.
   */
  it("splits on the alignment, not on single spaces", () => {
    const out = recogniseDockerPs(done("docker ps", PS))!;
    if (out.view.kind !== "table") return;
    expect(out.view.rows[1].cells.status).toBe("Up 2 hours (healthy)");
    expect(out.view.rows[2].cells.image).toBe("ghcr.io/me/api:latest");
  });

  // A container with no published ports leaves the column empty, and the
  // row must not shift left to fill it.
  it("survives a row with an empty column", () => {
    const out = recogniseDockerPs(done("docker ps", PS))!;
    if (out.view.kind !== "table") return;
    expect(out.view.rows[2].cells.name).toBe("api");
  });

  it("reads podman as well", () => {
    expect(recogniseDockerPs(done("podman ps", PS))).not.toBeNull();
  });

  it("says nothing when nothing is running", () => {
    const header = "CONTAINER ID   IMAGE   COMMAND   CREATED   STATUS   PORTS   NAMES";
    expect(recogniseDockerPs(done("docker ps", header))).toBeNull();
  });
});

describe("recogniseJson", () => {
  it("lays out a document that arrived on one line", () => {
    const body = JSON.stringify({ users: [{ id: 1, name: "Ada" }], page: 1, total: 90 });
    const out = recogniseJson(done("curl -s https://api.example.com/users", body))!;
    expect(out.view.kind).toBe("json");
    if (out.view.kind !== "json") return;
    expect(out.view.text).toContain('\n  "page": 1');
  });

  /*
   * Not tied to a command: the things that print JSON are endless — curl, jq,
   * aws, kubectl, half of npm. What matters is that it parses.
   */
  it("does not care which command printed it", () => {
    const body = JSON.stringify({ a: 1, b: 2, c: 3, d: 4, e: 5, f: "something long here" });
    expect(recogniseJson(done("kubectl get pod -o json", body))).not.toBeNull();
    expect(recogniseJson(done("aws s3api list-buckets", body))).not.toBeNull();
  });

  // Already laid out, so there is nothing to add.
  it("says nothing about JSON that is already readable", () => {
    const pretty = JSON.stringify({ a: 1, b: [1, 2, 3], c: "hello there world" }, null, 2);
    expect(recogniseJson(done("cat config.json", pretty))).toBeNull();
  });

  it("says nothing about a bare value", () => {
    expect(recogniseJson(done("echo 42", "42"))).toBeNull();
    expect(recogniseJson(done("echo hi", '"a string that is quite long but still a string"'))).toBeNull();
  });

  it("says nothing about output that is not JSON", () => {
    expect(recogniseJson(done("ls", "{ this is not json at all, just braces }"))).toBeNull();
  });

  it("says nothing about a fragment too short to be worth laying out", () => {
    expect(recogniseJson(done("echo", '{"a":1}'))).toBeNull();
  });
});
