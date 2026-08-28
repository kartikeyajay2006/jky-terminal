//! The one thing the games need from the backend.
//!
//! High scores live in the window, not on disk — they are produced by the app
//! rather than typed by the user, so they sit alongside the chosen theme
//! rather than in `jky-store`. But `jky games` runs in a shell that cannot see
//! browser storage, so the window hands the numbers over and Rust renders the
//! listing the shell reads.
//!
//! The renderer supplies only an id and a number. The path, the format and the
//! set of valid ids all live here, so the widest thing this command can do is
//! print a wrong score.

use tauri::State;

use crate::listing::{self, GameScore, GAME_IDS};
use crate::state::AppState;

/// Publish the games listing that `jky games` prints.
///
/// Scores for anything not in `GAME_IDS` are dropped rather than rejected: a
/// newer window reporting a game this build has never heard of should not
/// fail the whole call, it should simply not appear.
#[tauri::command]
pub fn games_publish_scores(
    state: State<'_, AppState>,
    scores: Vec<GameScore>,
) -> Result<(), String> {
    let known: Vec<GameScore> = scores
        .into_iter()
        .filter(|s| GAME_IDS.contains(&s.id.as_str()))
        .collect();

    let bin_dir = jky_pty::launcher_dir(&state.config_dir);
    listing::write_games(&known, &bin_dir, None).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_known_id_has_a_row_in_the_listing() {
        let text = listing::render_games(&[], None);
        for id in GAME_IDS {
            let label = match id {
                "dino" => "Dino Run",
                "snake" => "Snake",
                "tictactoe" => "Tic Tac Toe",
                "flappy" => "Flappy Bird",
                _ => unreachable!(),
            };
            assert!(text.contains(label), "{id} missing from: {text}");
        }
    }

    #[test]
    fn a_score_for_an_unknown_game_is_dropped_rather_than_printed() {
        // The filter this command applies, checked on the renderer it feeds.
        let scores = vec![GameScore { id: "pinball".into(), best: 9999 }];
        let kept: Vec<GameScore> = scores
            .into_iter()
            .filter(|s| GAME_IDS.contains(&s.id.as_str()))
            .collect();
        assert!(kept.is_empty());
        assert!(!listing::render_games(&kept, None).contains("9999"));
    }
}
