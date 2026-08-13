#!/bin/bash
# Forced skill evaluation hook
# Compensates for unreliable skill auto-activation (~20% success rate)
# Uses regex matching rather than an LLM call — that is the property that
# matters, and it holds.
#
# MEASURED cost, replacing an earlier "<5ms" claim that was never true: this
# machine, 5 runs averaged.
#   ~97ms   typical — one jq parse plus ~15 single-grep branches, each a fork
#   ~213ms  worst case — a 20-clause prompt containing "address", where the
#           per-clause loop below adds up to two more forks per clause
# The floor is process spawning, not regex evaluation; jq and bash startup
# alone dominate the 97ms. Re-measure before trusting these numbers on other
# hardware, and re-measure again if a branch stops being a single grep.
#
# Only triggers for actual skills (`.claude/skills/` directories).
# Rules (`.claude/rules/`) are always loaded and don't need reminders.

INPUT=$(cat)
PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty' 2>/dev/null)

# Exit if no prompt or jq not available
if [ -z "$PROMPT" ] || ! command -v jq &> /dev/null; then
    exit 0
fi

# Build list of relevant skills based on keywords
RELEVANT_SKILLS=""

# Database/Prisma → tzurot-db-vector skill
if echo "$PROMPT" | grep -qiE 'prisma|schema\.prisma|migration|database|pgvector|findMany|findFirst|createMany'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-db-vector"
fi

# Testing → tzurot-testing skill
if echo "$PROMPT" | grep -qiE '\.test\.ts|vitest|mock|coverage|beforeEach|afterEach|describe\(|it\(|expect\(|fake.?timer'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-testing"
fi

# Deployment → tzurot-deployment skill
if echo "$PROMPT" | grep -qiE 'railway|deploy|production|staging|live.?issue|logs.*service'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-deployment"
fi

# Git → tzurot-git-workflow skill
if echo "$PROMPT" | grep -qiE 'git commit|git push|pull.?request|\bPR\b|rebase|merge.*branch|create.*commit'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-git-workflow"
fi

# Documentation session workflow → tzurot-docs skill
if echo "$PROMPT" | grep -qiE 'CURRENT\.md|BACKLOG\.md|wrap.?up|session.?end|summarize|done.?for.?now'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-docs"
fi

# Documentation Audit → tzurot-doc-audit skill
if echo "$PROMPT" | grep -qiE 'doc.*audit|audit.*doc|documentation.*fresh|stale.*doc|review.*doc'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-doc-audit"
fi

# Bug remediation → tzurot-bug-remediation skill. Two trigger families:
# (a) recurrence language (a "fixed" class came back), and (b) the FIRST-fix
# moment for a path-specific UI/flow bug — the skill's first-fix sibling-sweep
# only helps if the skill loads THEN, not just on recurrence (the phrasing here
# mirrors the owner's smoke-report shape: "delete button doesn't show up after
# creation", "only shows up after edit").
if echo "$PROMPT" | grep -qiE 'keeps? (biting|happening|recurring)|recurring bug|regress(ed|ion)|why didn.t.*tests? catch|root.?cause|(delete|edit|create|browse|view|save|submit) (button|flow|screen|dialog|modal)|does(n.?t| not) (show|appear|render)|only (shows?|appears?).*(after|on)'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-bug-remediation"
fi

# Reuse scout → tzurot-reuse-scout skill
if echo "$PROMPT" | grep -qiE 'don.?t we already have|do we (already )?have (a|an|any)|duplicat\w*|drift(ed)? cop|consolidat'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-reuse-scout"
fi

# Design Boulder → tzurot-design-boulder skill
if echo "$PROMPT" | grep -qiE 'boulder|design session|design pass|architecture design'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-design-boulder"
fi

# MCP Council → tzurot-council-mcp skill
if echo "$PROMPT" | grep -qiE 'mcp|council|second.?opinion|stuck|brainstorm'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-council-mcp"
fi

# Architecture Audit → tzurot-arch-audit skill
if echo "$PROMPT" | grep -qiE 'arch.*audit|audit.*arch|boundary.*check|depcruise.*audit'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-arch-audit"
fi

# Session mining → tzurot-session-mining skill
# \b anchors "mine" so "determine/undermine ... session" don't false-match.
# Keep the pattern free of a trailing \b before "session": with ugrep's
# default engine standing in for grep (some dev machines), that form
# returned zero matches for the first branch while GNU grep matched —
# probe any edit against BOTH greps. "keep (happen|occur|recur)" scopes
# to the meta/process phrasing; bare "keep" swallowed bug-report language
# ("keep failing in CI") that belongs to tzurot-bug-remediation.
if echo "$PROMPT" | grep -qiE '\bmine\b.*session|session.*mining|mined[ -]corpus|friction.*(audit|mining|report)|why do(es)? th(is|ese) keep (happen|occur|recur)'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-session-mining"
fi

# PR review response → tzurot-review-response skill
# The primary trigger is agent-internal (05-tooling's PR-monitoring step 4 says
# to INVOKE the skill), so this hook is the SECOND path: the owner asking about
# review findings directly. That redundancy is the point — the procedure lives
# in a skill rather than an always-loaded rule, so a missed invoke means the
# rubber-stamping it prevents comes back.
# Scoping: "review" is qualified by a feedback noun so "review this code" and
# "let's review the backlog" don't false-match — those want a code read, not
# this procedure.
#
# The "address" alternative has gone through three wrong shapes before this
# one. Unanchored (`address.*(review|finding)`) false-matched unrelated
# clauses ("update the address field and review the schema"). A whitelist of
# what can sit in the gap (determiners/quantifiers only) fixed that but cost
# recall: a noun object between "address" and "review" ("address concerns
# from the review") is a real positive no whitelist has room for, because it
# enumerates what comes AFTER "address" and a noun object isn't on that list.
# A whole-PROMPT broad-match-minus-exclusion fixed recall but reopened
# precision from a different angle: the BROAD and NOUN_CONTEXT checks each
# scanned the WHOLE prompt independently, so one genuine "address that
# finding" earlier in a multi-topic prompt could be silently vetoed by an
# unrelated "mailing address" later in the SAME prompt ("let me address that
# finding, and also update the persona's mailing address field") — the two
# matches share no correlation, so a real trigger anywhere lost to a noun
# elsewhere anywhere else.
#
# The actual discriminator is still "what comes BEFORE address, not after"
# (noun-sense is determiner/possessive-preceded; verb-sense is preceded by
# nothing, or by please/can you/let me) — but it must be evaluated PER
# CLAUSE, not per prompt, so an unrelated clause can't veto a real one.
# $PROMPT is split on sentence-ending punctuation, commas AND semicolons,
# and each clause
# is tested independently; the prompt triggers if ANY clause has a broad
# match with no noun-context match INSIDE THAT SAME CLAUSE. Comma is included
# alongside `.!?` (not sentence-ending punctuation on its own) because the
# motivating false-negative is a single comma-joined compound sentence
# ("let me address that finding, and also update the persona's mailing
# address field") — splitting on `.!?` alone leaves that whole clause pair as
# one segment and the veto still fires; the comma is where the two topics
# actually separate.
#
# The exclusion word list is still enumeration and will still miss modifiers
# nobody thought of ("courier address", "invoice address", ...) — sentence
# scoping shrinks the blast radius of a miss (a false positive now needs the
# noun-sense "address" and the review word in the SAME sentence, not merely
# somewhere in the same prompt) but does not make the list exhaustive. Do not
# read it as a complete enumeration.
#
# KNOWN, ACCEPTED GAP — the split is character-level, so an INCIDENTAL period
# splits too. `tr` cannot tell a sentence boundary from a decimal, version, or
# IP, so "address open issue build v3.2 review needed" becomes two fragments
# and the trigger is lost. Runtime-confirmed: the same string without the
# decimal hits. This one is a REGRESSION introduced by clause-scoping — the
# older whole-prompt match was immune — and it is accepted rather than
# overlooked: closing it needs a sentence-boundary heuristic (period followed
# by whitespace-and-capital, or end of string), which is a different splitter
# on a branch that has already been wrong three times. The cost model below
# is what makes that trade wrong.
#
# KNOWN, ACCEPTED GAP — clause splitting is punctuation-only. A conjunction
# joins two thoughts without punctuation ("address that finding and also
# update my mailing address"), so they stay one clause and the veto fires
# across them. Runtime-confirmed: that phrasing misses, while the same
# sentence with a comma or semicolon hits. `tr` splits on characters and
# cannot see a word, so closing this means a different splitter, not another
# delimiter — declined against the cost model below.
#
# KNOWN, ACCEPTED GAP — ordering is directional. BROAD requires "address"
# to come BEFORE "review"/"finding" in the clause, so the reversed phrasing
# ("please review and address these comments", "reviewer comments need to be
# addressed") matches nothing here and nothing in the alternation above.
# Runtime-confirmed, both miss. Adding the reverse arm is a second full
# pattern with its own noun-sense veto problem, on a branch that has already
# been wrong three times — declined against the cost model below, not
# overlooked.
#
# KNOWN, ACCEPTED RESIDUAL — the veto is still uncorrelated WITHIN a clause.
# NOUN_CONTEXT is tested against the whole clause, not against the specific
# "address" that satisfied BROAD, so one clause holding both a genuine trigger
# and an unrelated noun-sense "address" is still vetoed. Runtime-confirmed,
# not theoretical: "kindly address the review at the office address" does not
# fire (pinned as a known-limitation case in the probe). Fixing it means
# correlating the two matches to a single occurrence, which POSIX ERE plus
# grep cannot express without another rewrite of this branch. Given the cost
# model below, that trade is not worth taking — this is a documented gap, not
# an unnoticed one.
#
# Both remaining failure modes are cheap and bounded: a miss here costs one
# absent skill suggestion; a false positive costs one spurious suggestion
# line. Neither can take a wrong action — the hook only ever prints a
# reminder banner. That asymmetry is the reason to stop tuning this regex.
# BOTH boundaries are load-bearing, and the trailing one is the subtle half.
# A leading \b alone does not exclude "addressee" — that word starts at a word
# boundary like any other, and an open `[a-z]*` suffix then swallows the "ee",
# so "the addressee reviewed the letter" satisfied BROAD. NOUN_CONTEXT cannot
# veto it either: its own \b after "address" fails against those same trailing
# letters. Only pinning the END of the word rules it out.
#
# The suffix set is spelled out rather than left open. This is enumeration, but
# unlike the NOUN_CONTEXT modifier list it is COMPLETE — English inflects this
# verb exactly four ways (address / addresses / addressed / addressing) and
# will not grow a fifth. Nouns that merely start with the same seven letters
# (addressee, addressograph) fall outside it by construction.
ADDRESS_BROAD='\baddress(es|ed|ing)?\b[^.!?]{0,40}(review|finding)'
ADDRESS_NOUN_CONTEXT='\b(the|my|your|a|an|this|that|his|her|their|our|its|email|mailing|postal|physical|work|return|contact|server|wallet|mac|office|residential|ip|web|home|billing|shipping|street) address\b'
if echo "$PROMPT" | grep -qiE 'review (feedback|finding|comment)|claude.?review|apply.*review|reviewer said'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-review-response"
# Prefilter before the clause loop below. The loop forks two greps PER CLAUSE,
# and it would otherwise run on every prompt that misses the alternatives above
# — the overwhelming majority, including prompts with no "address" at all. A
# 20-clause message would fork ~40 subprocesses to answer a question about a
# word that is not present, against this file's stated per-prompt budget. One
# whole-prompt grep decides that, and it cannot change the outcome: every
# clause-level match requires ADDRESS_BROAD, which requires "address".
elif echo "$PROMPT" | grep -qi 'address'; then
    ADDRESS_SENTENCE_HIT=false
    while IFS= read -r sentence; do
        if echo "$sentence" | grep -qiE "$ADDRESS_BROAD" && ! echo "$sentence" | grep -qiE "$ADDRESS_NOUN_CONTEXT"; then
            ADDRESS_SENTENCE_HIT=true
            break
        fi
    done < <(echo "$PROMPT" | tr '.!?,;' '\n')
    if [ "$ADDRESS_SENTENCE_HIT" = true ]; then
        RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-review-response"
    fi
fi

# Orchestrator mode → tzurot-orchestration skill. The primary trigger is
# agent-internal (invoke before the first src edit of a delegated unit); this
# hook is the second path, for the owner asking about delegation directly.
if echo "$PROMPT" | grep -qiE 'delegate|delegation|orchestrat|implementer|worker spec|spawn.*(agent|worker|implementer)'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-orchestration"
fi

# Trim whitespace
RELEVANT_SKILLS=$(echo "$RELEVANT_SKILLS" | xargs)

# Only output if we found relevant skills
if [ -n "$RELEVANT_SKILLS" ]; then
cat << EOF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SKILL CHECK: Keywords detected for: $RELEVANT_SKILLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Load these skills NOW using Skill("skill-name") BEFORE implementation.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
fi
