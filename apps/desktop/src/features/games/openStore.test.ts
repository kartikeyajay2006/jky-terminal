import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { decodeGamePayload, GAME_PREFIX, SHELL_ORDER, useOpenGame } from "./openStore";
import { GAMES } from "./registry";

describe("the shell and the window agree on the games", () => {
  it("lets the launchers open exactly the games the window can", () => {
    // The launchers are generated from SHELL_GAMES in Rust. When 2048 arrived
    // as the fifth game, both launchers still stopped at four, and nothing
    // noticed because each side was only ever tested against itself.
    const source = readFileSync(join(process.cwd(), "../../crates/jky-pty/src/launcher.rs"), "utf8");
    const declared = /pub const SHELL_GAMES: u8 = (\d+);/.exec(source)?.[1];
    expect(declared, "SHELL_GAMES not found in launcher.rs").toBeDefined();
    expect(Number(declared)).toBe(SHELL_ORDER.length);
  });
});

describe("decoding a game from the shell", () => {
  it("maps each number onto the game the command promises", () => {
    // The command's contract: `jky games 2` has to keep meaning Snake.
    expect(decodeGamePayload("JKYGame=1")).toBe("dino");
    expect(decodeGamePayload("JKYGame=2")).toBe("snake");
    expect(decodeGamePayload("JKYGame=3")).toBe("tictactoe");
    expect(decodeGamePayload("JKYGame=4")).toBe("flappy");
    expect(decodeGamePayload("JKYGame=5")).toBe("2048");
  });

  it("ignores a number outside the five games", () => {
    for (const payload of ["JKYGame=0", "JKYGame=6", "JKYGame=-1", "JKYGame=99"]) {
      expect(decodeGamePayload(payload)).toBeNull();
    }
  });

  it("ignores anything that is not a number", () => {
    for (const payload of ["JKYGame=", "JKYGame=snake", "JKYGame=1.5", "JKYGame= x"]) {
      expect(decodeGamePayload(payload)).toBeNull();
    }
  });

  it("ignores a payload that is not ours at all", () => {
    // OSC 1337 is shared, application-defined space; other programs put their
    // own things in it and must pass through untouched.
    expect(decodeGamePayload("JKYAsk=aGVsbG8=")).toBeNull();
    expect(decodeGamePayload("SetBadge=3")).toBeNull();
    expect(decodeGamePayload("")).toBeNull();
  });

  it("tolerates surrounding whitespace", () => {
    expect(decodeGamePayload("JKYGame= 2 ")).toBe("snake");
  });

  it("uses the prefix it publishes", () => {
    expect(decodeGamePayload(`${GAME_PREFIX}1`)).toBe("dino");
  });
});

describe("the shell's numbering", () => {
  it("covers every game the section offers", () => {
    expect([...SHELL_ORDER].sort()).toEqual(GAMES.map((g) => g.id).sort());
  });

  it("matches the order the section lists them in", () => {
    // The nav is numbered on screen, and those numbers are what someone
    // will type. If the two ever disagree the command opens the wrong game.
    expect(SHELL_ORDER).toEqual(GAMES.map((g) => g.id));
  });
});

describe("the pending game", () => {
  beforeEach(() => useOpenGame.setState({ pending: null }));

  it("starts with nothing waiting", () => {
    expect(useOpenGame.getState().pending).toBeNull();
  });

  it("holds a request until it is taken", () => {
    useOpenGame.getState().open("snake");
    expect(useOpenGame.getState().pending).toBe("snake");
  });

  it("hands the request over exactly once", () => {
    // One command opens one game once; a request left behind would reopen it
    // every time the section re-rendered.
    useOpenGame.getState().open("flappy");
    expect(useOpenGame.getState().take()).toBe("flappy");
    expect(useOpenGame.getState().take()).toBeNull();
  });

  it("replaces an untaken request rather than queueing", () => {
    useOpenGame.getState().open("dino");
    useOpenGame.getState().open("tictactoe");
    expect(useOpenGame.getState().take()).toBe("tictactoe");
  });
});
