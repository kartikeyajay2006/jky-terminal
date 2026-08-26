import { JkyMark } from "../../components/JkyMark";

interface WelcomeProps {
  onPick: (prompt: string) => void;
}

/**
 * Openings, not features.
 *
 * Each is a real question about the project in front of the user, because a
 * blank box with a cursor is the least helpful invitation an assistant can
 * offer.
 */
const OPENINGS = [
  {
    label: "Explain this project",
    prompt: "What does this project do? Read the README first.",
  },
  {
    label: "What changed?",
    prompt: "What has changed in my working tree, and does anything look unfinished?",
  },
  {
    label: "Find something",
    prompt: "Search the codebase for TODO comments and summarise what is outstanding.",
  },
  {
    label: "Review a file",
    prompt: "Read the main entry point and tell me what it does and anything that looks wrong.",
  },
];

export function Welcome({ onPick }: WelcomeProps) {
  return (
    <div className="welcome">
      <div className="welcome__mark">
        <JkyMark size={88} animated />
      </div>

      <h2 className="welcome__title">Ask about this project</h2>
      <p className="welcome__blurb">
        The assistant reads your files through tools you watch it use.
        <strong> Nothing runs until you approve it.</strong>
      </p>

      <div className="welcome__openings">
        {OPENINGS.map((opening) => (
          <button
            key={opening.label}
            type="button"
            className="opening"
            onClick={() => onPick(opening.prompt)}
          >
            <span className="opening__label">{opening.label}</span>
            <span className="opening__prompt">{opening.prompt}</span>
          </button>
        ))}
      </div>

      <p className="welcome__tip">
        You can also ask from a terminal: <code>jky ask what does ls do</code>
      </p>
    </div>
  );
}
