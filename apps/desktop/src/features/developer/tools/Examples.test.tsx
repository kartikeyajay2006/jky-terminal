import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Examples } from "./Examples";

describe("Examples", () => {
  it("loads the example that was chosen", async () => {
    const loaded: string[] = [];
    const user = userEvent.setup();
    render(
      <Examples
        examples={[
          { label: "A config file", shows: "nested objects", load: () => loaded.push("a") },
          { label: "Broken input", shows: "the error", load: () => loaded.push("b") },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /broken input/i }));
    expect(loaded).toEqual(["b"]);
  });

  /*
   * Each one says what it will show.
   *
   * "Example 1" tells nobody whether it is worth a click. The promise is the
   * whole value: it is what turns a button into an answer to "can this tool
   * do the thing I need".
   */
  it("says what each example will show", () => {
    render(
      <Examples
        examples={[{ label: "A token", shows: "an expired one", load: () => {} }]}
      />,
    );
    expect(screen.getByText("an expired one")).toBeInTheDocument();
  });
});
