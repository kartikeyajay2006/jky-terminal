import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Games, GAMES } from "./Games";
import { submitScore, writeTally } from "./scores";
import { useOpenGame } from "./openStore";
import { __setPlatformForTests, createWebPlatform } from "../../platform";

/**
 * The games are driven by `requestAnimationFrame`, which jsdom does provide
 * but never advances on its own. These tests therefore cover everything up to
 * the loop — mounting, navigation, controls, scoreboards, and the one game
 * that has no loop at all — while the rules each game runs on are covered
 * exhaustively in their own pure-logic suites.
 */

function nav() {
  return screen.getByRole("navigation", { name: "Games" });
}

describe("the games section", () => {
  beforeEach(() => localStorage.clear());

  it("lists all four games", () => {
    render(<Games />);
    for (const game of GAMES) {
      expect(within(nav()).getByRole("button", { name: new RegExp(game.label, "i") }))
        .toBeInTheDocument();
    }
  });

  it("lists them in the order the user asked for", () => {
    expect(GAMES.map((g) => g.id)).toEqual(["dino", "snake", "tictactoe", "flappy"]);
  });

  it("opens on Dino Run", () => {
    render(<Games />);
    expect(screen.getByRole("region", { name: "DINO RUN" })).toBeInTheDocument();
  });

  it("switches to another game when its name is clicked", async () => {
    const user = userEvent.setup();
    render(<Games />);

    await user.click(within(nav()).getByRole("button", { name: /snake/i }));
    expect(screen.getByRole("region", { name: "SNAKE GAME" })).toBeInTheDocument();
  });

  it("shows only the chosen game, so no loop runs unseen", async () => {
    // Three of the four animate. Mounting them all would leave two painting
    // boards nobody is looking at.
    const user = userEvent.setup();
    render(<Games />);
    await user.click(within(nav()).getByRole("button", { name: /flappy/i }));

    expect(screen.getByRole("region", { name: "FLAPPY BIRD" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "DINO RUN" })).toBeNull();
    expect(screen.queryByRole("region", { name: "SNAKE GAME" })).toBeNull();
  });

  it("reaches every game from the nav", async () => {
    const user = userEvent.setup();
    render(<Games />);
    for (const game of GAMES) {
      await user.click(within(nav()).getByRole("button", { name: new RegExp(game.label, "i") }));
      expect(
        screen.getByRole("region", { name: new RegExp(game.label.replace(" ", " "), "i") }),
      ).toBeInTheDocument();
    }
  });

  it("remembers the last game played", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Games />);
    await user.click(within(nav()).getByRole("button", { name: /tic tac toe/i }));
    unmount();

    render(<Games />);
    expect(screen.getByRole("region", { name: "TIC TAC TOE" })).toBeInTheDocument();
  });

  it("falls back to the first game when the remembered one is nonsense", () => {
    localStorage.setItem("jky.games.last", "pinball");
    render(<Games />);
    expect(screen.getByRole("region", { name: "DINO RUN" })).toBeInTheDocument();
  });

  it("shows a high score beside a game that has one", () => {
    submitScore("snake", 480);
    render(<Games />);
    expect(within(nav()).getByText("0480")).toBeInTheDocument();
  });

  it("shows no score beside a game never played", () => {
    render(<Games />);
    expect(within(nav()).queryByText(/^0\d{3}$/)).toBeNull();
  });

  it("says where high scores are kept, rather than leaving it a mystery", () => {
    render(<Games />);
    expect(screen.getByText(/kept on this machine/i)).toBeInTheDocument();
  });
});

describe("opening a game from the shell", () => {
  beforeEach(() => {
    localStorage.clear();
    useOpenGame.setState({ pending: null });
  });

  it("opens whichever game the command asked for", () => {
    useOpenGame.getState().open("flappy");
    render(<Games />);
    expect(screen.getByRole("region", { name: "FLAPPY BIRD" })).toBeInTheDocument();
  });

  it("wins over whichever game was played last", () => {
    localStorage.setItem("jky.games.last", "dino");
    useOpenGame.getState().open("tictactoe");
    render(<Games />);
    expect(screen.getByRole("region", { name: "TIC TAC TOE" })).toBeInTheDocument();
  });

  it("takes the request, so it does not reopen on every render", () => {
    useOpenGame.getState().open("snake");
    render(<Games />);
    expect(useOpenGame.getState().pending).toBeNull();
  });

  it("leaves the last-played game alone when nothing was asked for", () => {
    localStorage.setItem("jky.games.last", "snake");
    render(<Games />);
    expect(screen.getByRole("region", { name: "SNAKE GAME" })).toBeInTheDocument();
  });
});

describe("publishing scores to the shell", () => {
  beforeEach(() => {
    localStorage.clear();
    useOpenGame.setState({ pending: null });
  });
  afterEach(() => __setPlatformForTests(null));

  function withSpy() {
    const calls: Array<Array<{ id: string; best: number }>> = [];
    const base = createWebPlatform();
    __setPlatformForTests({
      ...base,
      games: {
        async publishScores(scores) {
          calls.push(scores);
        },
      },
    });
    return calls;
  }

  it("hands the listing its numbers when the section opens", async () => {
    submitScore("dino", 1256);
    const calls = withSpy();
    render(<Games />);

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0]).toContainEqual({ id: "dino", best: 1256 });
  });

  it("sends only the games that keep a score", async () => {
    // Tic tac toe has a tally, not a high score, and a zero beside it would
    // read as "never scored".
    const calls = withSpy();
    render(<Games />);

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0].map((s) => s.id)).not.toContain("tictactoe");
  });

  it("republishes when another game is opened, so a new record is not stale", async () => {
    const calls = withSpy();
    const user = userEvent.setup();
    render(<Games />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));

    const before = calls.length;
    await user.click(within(nav()).getByRole("button", { name: /snake/i }));
    await waitFor(() => expect(calls.length).toBeGreaterThan(before));
  });

  it("survives the backend refusing, rather than breaking the section", async () => {
    const base = createWebPlatform();
    __setPlatformForTests({
      ...base,
      games: {
        async publishScores() {
          throw new Error("no backend");
        },
      },
    });
    expect(() => render(<Games />)).not.toThrow();
    expect(screen.getByRole("region", { name: "DINO RUN" })).toBeInTheDocument();
  });
});

describe("dino run", () => {
  beforeEach(() => localStorage.clear());

  it("waits to be started rather than running on arrival", () => {
    render(<Games />);
    expect(screen.getByText(/press space to begin/i)).toBeInTheDocument();
  });

  it("shows three lives", () => {
    render(<Games />);
    const status = screen.getByRole("region", { name: "Status" });
    expect(within(status).getAllByText("♥")).toHaveLength(3);
  });

  it("shows a score and a high score", () => {
    submitScore("dino", 4567);
    render(<Games />);
    expect(screen.getByText("04567")).toBeInTheDocument();
  });

  it("gives the playfield a label, since it is a picture made of text", () => {
    render(<Games />);
    expect(screen.getByRole("img", { name: /dino run playfield/i })).toBeInTheDocument();
  });
});

describe("snake", () => {
  beforeEach(() => localStorage.clear());

  async function open(user: ReturnType<typeof userEvent.setup>) {
    render(<Games />);
    await user.click(within(nav()).getByRole("button", { name: /snake/i }));
  }

  it("shows the stats panel", async () => {
    const user = userEvent.setup();
    await open(user);
    const stats = screen.getByRole("region", { name: "Stats" });
    expect(within(stats).getByText("LENGTH")).toBeInTheDocument();
    expect(within(stats).getByText("SPEED")).toBeInTheDocument();
  });

  it("starts at the slowest speed", async () => {
    const user = userEvent.setup();
    await open(user);
    expect(screen.getByText("SLOW")).toBeInTheDocument();
  });

  it("spells out the controls rather than assuming they are known", async () => {
    const user = userEvent.setup();
    await open(user);
    const controls = screen.getByRole("region", { name: "Controls" });
    expect(within(controls).getByText("Up")).toBeInTheDocument();
    expect(within(controls).getByText("Pause")).toBeInTheDocument();
  });

  it("carries its high score over from a previous session", async () => {
    submitScore("snake", 45);
    const user = userEvent.setup();
    await open(user);
    const stats = screen.getByRole("region", { name: "Stats" });
    expect(within(stats).getByText("0045")).toBeInTheDocument();
  });
});

describe("flappy bird", () => {
  beforeEach(() => localStorage.clear());

  it("waits to be started", async () => {
    const user = userEvent.setup();
    render(<Games />);
    await user.click(within(nav()).getByRole("button", { name: /flappy/i }));
    expect(screen.getByText(/press space to take off/i)).toBeInTheDocument();
  });

  it("labels its playfield", async () => {
    const user = userEvent.setup();
    render(<Games />);
    await user.click(within(nav()).getByRole("button", { name: /flappy/i }));
    expect(screen.getByRole("img", { name: /flappy bird playfield/i })).toBeInTheDocument();
  });
});

describe("tic tac toe", () => {
  beforeEach(() => localStorage.clear());

  async function open() {
    const user = userEvent.setup();
    render(<Games />);
    await user.click(within(nav()).getByRole("button", { name: /tic tac toe/i }));
    return user;
  }

  function cells() {
    return within(screen.getByRole("grid", { name: /tic tac toe board/i })).getAllByRole(
      "gridcell",
    );
  }

  it("starts empty, with X to play", async () => {
    await open();
    expect(screen.getByText("X TO PLAY")).toBeInTheDocument();
    for (const cell of cells()) expect(cell).toHaveTextContent("");
  });

  it("places a mark where it is clicked", async () => {
    const user = await open();
    await user.click(cells()[4]);
    expect(cells()[4]).toHaveTextContent("X");
  });

  it("alternates between the two players", async () => {
    const user = await open();
    await user.click(cells()[0]);
    expect(screen.getByText("O TO PLAY")).toBeInTheDocument();
    await user.click(cells()[1]);
    expect(screen.getByText("X TO PLAY")).toBeInTheDocument();
  });

  it("takes a move from the number keys, as the guide says it does", async () => {
    const user = await open();
    await user.keyboard("5");
    expect(cells()[4]).toHaveTextContent("X");
  });

  it("refuses a square that is taken", async () => {
    const user = await open();
    await user.click(cells()[0]);
    await user.click(cells()[0]);
    expect(cells()[0]).toHaveTextContent("X");
    expect(screen.getByText("O TO PLAY")).toBeInTheDocument();
  });

  it("announces a win and marks the winning line", async () => {
    const user = await open();
    // X: 0, 1, 2 — O: 3, 4
    for (const key of ["1", "4", "2", "5", "3"]) await user.keyboard(key);

    // Scoped to the status line: "X WINS" is also the scoreboard's label for
    // the running tally, and an unscoped query matches both.
    expect(screen.getByRole("status")).toHaveTextContent("X WINS");
    for (const i of [0, 1, 2]) expect(cells()[i]).toHaveAttribute("data-won");
  });

  it("counts a win on the scoreboard", async () => {
    const user = await open();
    for (const key of ["1", "4", "2", "5", "3"]) await user.keyboard(key);

    const board = screen.getByRole("region", { name: "Score board" });
    await waitFor(() => expect(within(board).getByText("X WINS")).toBeInTheDocument());
    const row = within(board).getByText("X WINS").parentElement!;
    expect(row).toHaveTextContent("1");
  });

  it("stops accepting moves once the game is won", async () => {
    const user = await open();
    for (const key of ["1", "4", "2", "5", "3"]) await user.keyboard(key);
    await user.keyboard("9");
    expect(cells()[8]).toHaveTextContent("");
  });

  it("starts a new game on request, keeping the tally", async () => {
    const user = await open();
    for (const key of ["1", "4", "2", "5", "3"]) await user.keyboard(key);

    await user.click(screen.getByRole("button", { name: /new game/i }));
    for (const cell of cells()) expect(cell).toHaveTextContent("");

    const board = screen.getByRole("region", { name: "Score board" });
    expect(within(board).getByText("X WINS").parentElement).toHaveTextContent("1");
  });

  it("lets the loser of the last game go first", async () => {
    // How anyone playing across a table would actually do it.
    const user = await open();
    for (const key of ["1", "4", "2", "5", "3"]) await user.keyboard(key);
    await user.click(screen.getByRole("button", { name: /new game/i }));
    expect(screen.getByText("O TO PLAY")).toBeInTheDocument();
  });

  it("resets the scoreboard on request", async () => {
    writeTally({ x: 4, o: 2, draws: 1 });
    const user = await open();

    await user.click(screen.getByRole("button", { name: /reset scores/i }));
    const board = screen.getByRole("region", { name: "Score board" });
    expect(within(board).getByText("X WINS").parentElement).toHaveTextContent("0");
    expect(within(board).getByText("O WINS").parentElement).toHaveTextContent("0");
    expect(within(board).getByText("DRAWS").parentElement).toHaveTextContent("0");
  });

  it("carries the tally over from a previous session", async () => {
    writeTally({ x: 2, o: 1, draws: 0 });
    await open();
    const board = screen.getByRole("region", { name: "Score board" });
    expect(within(board).getByText("X WINS").parentElement).toHaveTextContent("2");
    expect(within(board).getByText("O WINS").parentElement).toHaveTextContent("1");
  });

  it("counts a draw as a draw", async () => {
    const user = await open();
    // X 5, O 1, X 2, O 8, X 7, O 3, X 6, O 4, X 9 — full board, nobody wins.
    for (const key of ["5", "1", "2", "8", "7", "3", "6", "4", "9"]) {
      await user.keyboard(key);
    }
    expect(screen.getByText("A DRAW")).toBeInTheDocument();

    const board = screen.getByRole("region", { name: "Score board" });
    await waitFor(() =>
      expect(within(board).getByText("DRAWS").parentElement).toHaveTextContent("1"),
    );
  });
});
