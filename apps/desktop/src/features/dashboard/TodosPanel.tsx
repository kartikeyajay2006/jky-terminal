import { useState } from "react";
import { PanelHead } from "../settings/PanelHead";
import { useDashboard, newId, nowIso } from "./dashboardStore";
import { Empty } from "./Empty";

export function TodosPanel() {
  const todos = useDashboard((s) => s.todos);
  const error = useDashboard((s) => s.errors.todos);
  const saveTodo = useDashboard((s) => s.saveTodo);
  const deleteTodo = useDashboard((s) => s.deleteTodo);
  const [draft, setDraft] = useState("");

  const done = todos.filter((t) => t.done).length;

  function add(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    void saveTodo({ id: newId("todo"), text, done: false, created_at: nowIso() });
    setDraft("");
  }

  return (
    <section className="panel" aria-labelledby="todos-heading">
      <PanelHead
        where="Todos"
        headingId="todos-heading"
        status={
          todos.length > 0 ? (
            <>
              <b>{done}</b> of {todos.length} done
            </>
          ) : undefined
        }
      />

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <form className="row-form" onSubmit={add}>
        <input
          className="input"
          aria-label="New todo"
          placeholder="What needs doing?"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="btn btn--primary" disabled={!draft.trim()}>
          Add
        </button>
      </form>

      {todos.length === 0 ? (
        <Empty
          glyph="☑"
          title="Nothing on the list"
          hint="Add the first thing above. It stays until you remove it."
        />
      ) : (
        <ul className="checklist" aria-label="Todos">
          {todos.map((todo) => (
            <li key={todo.id} className="checklist__row" data-done={todo.done || undefined}>
              <label className="checklist__check">
                <input
                  type="checkbox"
                  checked={todo.done}
                  onChange={() => void saveTodo({ ...todo, done: !todo.done })}
                />
                <span className="checklist__text">{todo.text}</span>
              </label>
              <button
                type="button"
                className="checklist__remove"
                aria-label={`Remove ${todo.text}`}
                onClick={() => void deleteTodo(todo.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
