"""Rule table for branch_switch.py.

Each row pins one rule of branch_switch.py's module docstring as the triple
`(switch_target, commit_target_dir, others_inert)` for one command, where
others_inert is the second value of `_commit_target`, the same function
`__main__` calls for lines 2 and 3 of its output. Removing or loosening a
rule reddens the rows that depend on it. A second class pins the script's
three-line output contract and its fail-toward-live-state behaviour.

Run:
    cd .claude/hooks/lib && PYTHONDONTWRITEBYTECODE=1 python3 -m unittest branch_switch_test -v

`board-commit-branch-gate.probe.sh` runs this in CI via `guard:hook-probes`.
"""

import os
import subprocess
import sys
import unittest

LIB_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, LIB_DIR)

import branch_switch  # noqa: E402

# Canonical message body: the one command substitution a trusted chain may carry.
CANONICAL = "\"$(cat <<'EOF'\nmsg $(date)\nEOF\n)\""
CANONICAL_INDENT = "\"$(cat <<-'EOF'\nmsg\nEOF\n)\""

# (label, command, (switch_target, commit_target_dir, others_inert))
ROWS = [
    # --- positive reads: each return value -----------------------------------
    ("switch -c reads the new branch", "git switch -c feat/x && git commit -m y", ("feat/x", None, False)),
    ("switch --create reads the new branch", "git switch --create feat/x && git commit -m y", ("feat/x", None, False)),
    ("switch -C reads the new branch", "git switch -C feat/x && git commit -m y", ("feat/x", None, False)),
    (
        "switch --force-create reads the new branch",
        "git switch --force-create feat/x && git commit -m y",
        ("feat/x", None, False),
    ),
    ("checkout -b reads the new branch", "git checkout -b feat/x && git commit -m y", ("feat/x", None, False)),
    (
        "checkout -B with a start point reads the new branch",
        "git checkout -B feat/x origin/develop && git commit -m y",
        ("feat/x", None, False),
    ),
    ("plain switch <name> reads the branch", "git switch feat/x && git commit -m y", ("feat/x", None, False)),
    ("a quoted branch name is resolved", 'git switch -c "feat/x" && git commit -m y', ("feat/x", None, False)),
    (
        "every allowlisted subcommand keeps the target",
        "git switch -c feat/x && git add a.ts && git status && git diff && git log && git show && git commit -m y",
        ("feat/x", None, False),
    ),
    (
        "a later git status keeps the target",
        "git switch -c feat/x && git status && git commit -m y",
        ("feat/x", None, False),
    ),
    ("git -C <abs> commit reads the directory", "git -C /other/repo commit -m x", (None, "/other/repo", True)),
    (
        "leading cd <abs> && commit reads the directory",
        "cd /other/repo && git commit -m x",
        (None, "/other/repo", True),
    ),
    (
        "a relative -C after a leading cd joins onto it",
        "cd /other && git -C repo commit -m x",
        (None, "/other/repo", True),
    ),
    (
        "a relative -C after an absolute -C joins onto it",
        "git -C /other -C sub commit -m y",
        (None, "/other/sub", True),
    ),
    (
        "an inert segment between cd and commit keeps inert",
        "cd /other && git add a && git commit -m y",
        (None, "/other", True),
    ),
    (
        "two commits in one normalized directory read it",
        "git -C /other commit -m y && git -C /other/ commit -m z",
        (None, "/other", True),
    ),
    ("the --no-pager global flag is stepped over", "git --no-pager -C /other commit -m y", (None, "/other", True)),
    ("the -P global flag is stepped over", "git -P -C /other commit -m y", (None, "/other", True)),
    (
        "a prefix assignment on the commit is skipped",
        "TZUROT_ALLOW=1 git -C /other commit -m y",
        (None, "/other", True),
    ),
    (
        "a lower-case git_dir assignment is not a GIT_DIR mention",
        "git_dir=/x git -C /other commit -m y",
        (None, "/other", True),
    ),
    ("a bare commit reads nothing", "git commit -m x", (None, None, False)),
    # --- a directory read with a non-inert other segment ---------------------
    (
        "a non-inert ln before the commit clears inert",
        "ln -sfn /x /other && git -C /other commit -m y",
        (None, "/other", False),
    ),
    ("a non-inert make after the commit clears inert", "git -C /other commit -m y && make", (None, "/other", False)),
    (
        "a leading switch is a non-inert segment for the dir read",
        "git switch -c feat/x && git -C /other commit -m y",
        (None, "/other", False),
    ),
    (
        "a global flag on a non-commit segment clears inert",
        "git --no-pager log && git -C /other commit -m y",
        (None, "/other", False),
    ),
    (
        "a -C on a non-commit segment clears inert",
        "git -C /other add a && git -C /other commit -m y",
        (None, "/other", False),
    ),
    # Observed, fail-closed: the commit-dir segment split reads the `&` of a
    # numeric fd redirect as a separator, so `1` becomes a non-inert segment.
    ("commit-dir read: a 2>&1 redirect clears inert", "git -C /other commit -m y 2>&1", (None, "/other", False)),
    # Known gap, pinned as observed (TASK-1214): the commit-dir read requires
    # `&&` only after the leading cd, unlike the docstring's every-join rule.
    (
        "commit-dir read: a ; after cd && <inert> still reads the dir",
        "cd /other && git add a; git commit -m y",
        (None, "/other", True),
    ),
    # --- WHY ONLY A PURE && CHAIN ------------------------------------------
    ("a ; join after the switch is not trusted", "git switch -c feat/x; git commit -m y", (None, None, False)),
    (
        "a ; after the commit is not trusted",
        "git switch -c feat/x && git commit -m y; git commit -m z",
        (None, None, False),
    ),
    ("a || join is not trusted", "git switch -c feat/x || git commit -m y", (None, None, False)),
    ("a pipe is not trusted", "git switch -c feat/x && git commit -m y | cat", (None, None, False)),
    ("a background & is not trusted", "git switch -c feat/x && git commit -m y &", (None, None, False)),
    ("a newline join is not trusted", "git switch -c feat/x\ngit commit -m y", (None, None, False)),
    ("a subshell is not trusted", "git switch -c feat/x && (git commit -m y)", (None, None, False)),
    ("a &&& join is not trusted", "git switch -c feat/x &&& git commit -m y", (None, None, False)),
    ("a leading cd joined by ; is not read", "cd /other; git commit -m y", (None, None, False)),
    ("a switch with no && chain is not read", "git switch -c feat/x", (None, None, False)),
    (
        "a redirect on the switch segment is not read",
        "git switch -c feat/x >/dev/null && git commit -m y",
        (None, None, False),
    ),
    # --- the switch only holds: the allowlist ------------------------------
    (
        "a later git switch back is not trusted",
        "git switch -c feat/x && git switch develop && git commit -m y",
        (None, None, False),
    ),
    (
        "a later git alias is not trusted",
        "git switch -c feat/x && git co develop && git commit -m y",
        (None, None, False),
    ),
    ("a later non-git command is not trusted", "git switch -c feat/x && make && git commit -m y", (None, None, False)),
    (
        "a later git mv is not trusted",
        "git switch -c feat/x && git mv -f h.txt .git/HEAD && git commit -m y",
        (None, None, False),
    ),
    ("a later git rm is not trusted", "git switch -c feat/x && git rm a.ts && git commit -m y", (None, None, False)),
    (
        "a later git push is not trusted",
        "git switch -c feat/x && git push --receive-pack=x && git commit -m y",
        (None, None, False),
    ),
    (
        "a later global flag is not trusted",
        "git switch -c feat/x && git --no-pager log && git commit -m y",
        (None, None, False),
    ),
    ("a later quoted git is a placeholder, not git", 'git switch -c feat/x && "git" commit -m y', (None, None, False)),
    # --- WHY PLAIN git checkout IS NOT READ ---------------------------------
    ("plain git checkout <name> is not read", "git checkout feat/x && git commit -m y", (None, None, False)),
    # --- --output ------------------------------------------------------------
    (
        "a later log --output= is not trusted",
        "git switch -c feat/x && git log --output=.x && git commit -m y",
        (None, None, False),
    ),
    (
        "a later diff --output <file> is not trusted",
        "git switch -c feat/x && git diff --output x && git commit -m y",
        (None, None, False),
    ),
    (
        "a later show with a quoted --output= is not trusted",
        'git switch -c feat/x && git show "--output=x" && git commit -m y',
        (None, None, False),
    ),
    (
        "a log --output after the commit is not trusted",
        "git switch -c feat/x && git commit -m y && git log --output=x",
        (None, None, False),
    ),
    (
        "--output on status is not a writing option",
        "git switch -c feat/x && git status --output=x && git commit -m y",
        ("feat/x", None, False),
    ),
    (
        "--output-indicator-new is not --output",
        "git switch -c feat/x && git diff --output-indicator-new=+ && git commit -m y",
        ("feat/x", None, False),
    ),
    # --- .git path components --------------------------------------------
    (
        "a later .git/HEAD word is not trusted",
        "git switch -c feat/x && git add .git/HEAD && git commit -m y",
        (None, None, False),
    ),
    (
        "a later ./.git/ word is not trusted",
        "git switch -c feat/x && git add ./.git/x && git commit -m y",
        (None, None, False),
    ),
    (
        "a later upper-case .GIT component is not trusted",
        "git switch -c feat/x && git add x/.GIT/y && git commit -m y",
        (None, None, False),
    ),
    (
        "a later quoted .git/HEAD is not trusted",
        'git switch -c feat/x && git add ".git/HEAD" && git commit -m y',
        (None, None, False),
    ),
    (
        "a later > redirect into .git is not trusted",
        "git switch -c feat/x && git log >.git/config && git commit -m y",
        (None, None, False),
    ),
    (
        "a later < redirect from .git is not trusted",
        "git switch -c feat/x && git add a <.git/HEAD && git commit -m y",
        (None, None, False),
    ),
    (
        "a later --opt=.git/ value is not trusted",
        "git switch -c feat/x && git add --pathspec-from-file=.git/x && git commit -m y",
        (None, None, False),
    ),
    (
        "a .gitignore path is not a .git component",
        "git switch -c feat/x && git add .gitignore && git commit -m y",
        ("feat/x", None, False),
    ),
    # --- fd redirects versus & ---------------------------------------------
    ("a trailing 2>&1 is not a separator", "git switch -c feat/x && git commit -m y 2>&1", ("feat/x", None, False)),
    ("a >&2 is not a separator", "git switch -c feat/x && git commit -m y >&2", ("feat/x", None, False)),
    ("a pipe after 2>&1 is not trusted", "git switch -c feat/x && git commit -m y 2>&1 | cat", (None, None, False)),
    ("a background & after 2>&1 is not trusted", "git switch -c feat/x && git commit -m y 2>&1 &", (None, None, False)),
    ("a >&file is not an fd redirect", "git switch -c feat/x && git commit -m y >&file", (None, None, False)),
    # --- the canonical "$(cat <<'EOF' ... EOF)" message --------------------
    (
        "the canonical quoted cat message keeps the target",
        "git switch -c feat/x && git commit -m " + CANONICAL,
        ("feat/x", None, False),
    ),
    (
        "the canonical <<- cat message keeps the target",
        "git switch -c feat/x && git commit -m " + CANONICAL_INDENT,
        ("feat/x", None, False),
    ),
    (
        "any other $(...) substitution is not trusted",
        'git switch -c feat/x && git commit -m "$(date)"',
        (None, None, False),
    ),
    ("a backtick substitution is not trusted", "git switch -c feat/x && git commit -m `date`", (None, None, False)),
    (
        "an unquoted heredoc in the cat message is not trusted",
        'git switch -c feat/x && git commit -m "$(cat <<EOF\nmsg $(date)\nEOF\n)"',
        (None, None, False),
    ),
    # --- heredoc delimiters ------------------------------------------------
    (
        "an unquoted <<EOF heredoc is not trusted",
        "git switch -c feat/x && git commit -F - <<EOF\nmsg $(date)\nEOF",
        (None, None, False),
    ),
    (
        "an unquoted <<-EOF heredoc is not trusted",
        "git switch -c feat/x && git commit -F - <<-EOF\nmsg\nEOF",
        (None, None, False),
    ),
    (
        "a single-quoted delimiter keeps the body inert",
        "git switch -c feat/x && git commit -F - <<'EOF'\nmsg $(date)\nEOF",
        ("feat/x", None, False),
    ),
    (
        "a double-quoted delimiter keeps the body inert",
        'git switch -c feat/x && git commit -F - <<"EOF"\nmsg $(date)\nEOF',
        ("feat/x", None, False),
    ),
    # Observed, fail-closed: shell_quotes.strip_heredoc_bodies does not strip a
    # backslash-quoted delimiter's body, so its newline voids the read.
    (
        "a backslash-quoted delimiter is not stripped, so not read",
        "git switch -c feat/x && git commit -F - <<\\EOF\nmsg $(date)\nEOF",
        (None, None, False),
    ),
    ("a here-string is not a heredoc", "git switch -c feat/x && git commit -F - <<<msg", ("feat/x", None, False)),
    (
        "a substitution in a here-string is not trusted",
        'git switch -c feat/x && git commit -F - <<<"$(date)"',
        (None, None, False),
    ),
    # --- bash -c / eval ----------------------------------------------------
    (
        "a later bash -c wrapper is not trusted",
        "git switch -c feat/x && bash -c 'git commit -m y'",
        (None, None, False),
    ),
    ("a later eval wrapper is not trusted", "git switch -c feat/x && eval 'git commit -m y'", (None, None, False)),
    ("a commit inside bash -c is not located", "bash -c 'git -C /other commit -m y'", (None, None, False)),
    # --- GIT_DIR-style environment variables -------------------------------
    ("a GIT_DIR prefix voids both reads", "GIT_DIR=/x git switch -c feat/x && git commit -m y", (None, None, False)),
    (
        "a GIT_WORK_TREE mention anywhere voids both reads",
        "git switch -c feat/x && git commit -m y # GIT_WORK_TREE",
        (None, None, False),
    ),
    (
        "an exported GIT_INDEX_FILE voids the dir read",
        "export GIT_INDEX_FILE=/x && git -C /other commit -m y",
        (None, None, False),
    ),
    (
        "a quoted GIT_COMMON_DIR mention voids the dir read",
        "git -C /other commit -m 'GIT_COMMON_DIR'",
        (None, None, False),
    ),
    # --- -C and cd commit directories --------------------------------------
    ("a relative -C is not read", "git -C relative commit -m y", (None, None, False)),
    ("a -C path with a .. step is not read", "git -C /other/l/.. commit -m y", (None, None, False)),
    ("a leading cd with a .. step is not read", "cd /other/.. && git commit -m y", (None, None, False)),
    ("a relative -C join with a .. step is not read", "cd /other && git -C ../x commit -m y", (None, None, False)),
    ("a relative leading cd is not read", "cd relative && git commit -m y", (None, None, False)),
    (
        "two commits in different directories are not read",
        "git -C /other commit -m y && git -C /else commit -m z",
        (None, None, False),
    ),
    ("a -c global flag voids the dir read", "git -c core.worktree=/x -C /other commit -m y", (None, None, False)),
    ("a --git-dir global flag voids the dir read", "git --git-dir=/x -C /other commit -m y", (None, None, False)),
    ("a second cd voids the dir read", "cd /other && cd /else && git commit -m y", (None, None, False)),
    ("a later pushd voids the dir read", "cd /other && git commit -m y && pushd /x", (None, None, False)),
    (
        "a commit inside a substitution voids the dir read",
        'git -C /other commit -m "$(git commit -m z)"',
        (None, None, False),
    ),
    ("a commit word outside a git commit segment voids the dir read", "make commit", (None, None, False)),
    ("a ~ directory is not read", "git -C ~/other commit -m y", (None, None, False)),
    ("a glob directory is not read", "git -C /oth*r commit -m y", (None, None, False)),
    ("a -C with no commit reads nothing", "git -C /other", (None, None, False)),
    ("an upper-case COMMIT subcommand is not a git commit", "git -C /other COMMIT -m y", (None, None, False)),
    # --- switch shapes that are not read ------------------------------------
    ("a global flag before switch is not read", "git -C /x switch feat/x && git commit -m y", (None, None, False)),
    ("switch --detach is not read", "git switch --detach feat/x && git commit -m y", (None, None, False)),
    (
        "switch -c with two extra words is not read",
        "git switch -c feat/x origin/develop extra && git commit -m y",
        (None, None, False),
    ),
    (
        "switch -c with a flag as start point is not read",
        "git switch -c feat/x -t && git commit -m y",
        (None, None, False),
    ),
    (
        "a prefix assignment before the switch is not read",
        "X=1 git switch -c feat/x && git commit -m y",
        (None, None, False),
    ),
    (
        "a switch that is not the first segment is not read",
        "git add a && git switch -c feat/x && git commit -m y",
        (None, None, False),
    ),
    ("an expanded branch name is not read", "git switch -c $B && git commit -m y", (None, None, False)),
    ("a comment in the first segment is not read", "git switch -c feat/x # c && git commit -m y", (None, None, False)),
    ("brace expansion in the first segment is not read", "git switch {a,b} && git commit -m y", (None, None, False)),
    ("an empty quoted branch name is not read", "git switch -c '' && git commit -m y", (None, None, False)),
]

# _BAD_REF: each name is rejected by the ref-name pattern alone (with
# _BAD_REF disabled, every one of these reads as a switch target). Each is
# spliced into "git switch -c {name} && git commit -m y" as written here
# (some carry their own shell quotes); the expected triple is all-None.
BAD_REF_NAMES = [
    "feat..x",
    "feat~1",
    "feat^x",
    "feat:x",
    "'feat x'",
    "'fe\tt'",
    "'fe\x7ft'",
    "'feat@{x'",
    "feat//x",
    "-feat",
    "/feat",
    ".feat",
    "feat/",
    "feat.",
    "feat.lock",
    "@",
    "fe?t",
    "fe*t",
    "fe[t",
    "'fe\\t'",
    "'fe$t'",
    "'fe`t'",
]


class RuleTable(unittest.TestCase):
    def test_rows(self):
        for label, cmd, (switch, directory, inert) in ROWS:
            with self.subTest(label):
                self.assertEqual(branch_switch.switch_target(cmd), switch)
                self.assertEqual(branch_switch._commit_target(cmd), (directory, inert))
                self.assertEqual(branch_switch.commit_target_dir(cmd), directory)

    def test_bad_ref_names(self):
        for name in BAD_REF_NAMES:
            cmd = f"git switch -c {name} && git commit -m y"
            with self.subTest(repr(name)):
                self.assertIsNone(branch_switch.switch_target(cmd))
                self.assertEqual(branch_switch._commit_target(cmd), (None, False))

    def test_bad_ref_control(self):
        # Same command shape with a good name reads, so the rows above are
        # None because of the name, not because of the shape.
        cmd = "git switch -c feat/x && git commit -m y"
        self.assertEqual(branch_switch.switch_target(cmd), "feat/x")


class MainContract(unittest.TestCase):
    """Runs the script as `__main__` in a subprocess."""

    def _run_main(self, command, prelude=""):
        code = prelude + 'import runpy; runpy.run_path("branch_switch.py", run_name="__main__")'
        proc = subprocess.run(
            [sys.executable, "-c", code],
            cwd=LIB_DIR,
            env={**os.environ, "GUARD_CMD": command, "PYTHONDONTWRITEBYTECODE": "1"},
            capture_output=True,
            text=True,
        )
        return proc.returncode, proc.stdout

    def test_switch_target_line(self):
        rc, out = self._run_main("git switch -c feat/x && git commit -m y")
        self.assertEqual(rc, 0)
        self.assertEqual(out.split("\n"), ["feat/x", "", "", ""])

    def test_commit_dir_lines(self):
        rc, out = self._run_main("git -C /other/repo commit -m x")
        self.assertEqual(rc, 0)
        self.assertEqual(out.split("\n"), ["", "/other/repo", "1", ""])

    def test_none_case(self):
        rc, out = self._run_main("git commit -m x")
        self.assertEqual(rc, 0)
        self.assertEqual(out.split("\n"), ["", "", "", ""])

    def test_helper_failure_leaves_empty_output(self):
        # Unit-level twin of the in-script try/except fail-toward-live-state
        # branch. The probes separately cover a helper that raises at import
        # (module-level raise, the hooks' `|| LEADING=""` fallback).
        prelude = (
            "import shell_quotes\n"
            "def _boom(*a, **k):\n"
            "    raise RuntimeError('simulated helper failure')\n"
            "shell_quotes.wrapped_command_strings = _boom\n"
        )
        for cmd in ("git switch -c feat/x && git commit -m y", "git -C /other/repo commit -m x"):
            with self.subTest(cmd):
                # Control: unpatched, the command produces output.
                rc, out = self._run_main(cmd)
                self.assertEqual(rc, 0)
                self.assertNotEqual(out.split("\n"), ["", "", "", ""])
                rc, out = self._run_main(cmd, prelude)
                self.assertEqual(rc, 0)
                self.assertEqual(out.split("\n"), ["", "", "", ""])


if __name__ == "__main__":
    unittest.main()
