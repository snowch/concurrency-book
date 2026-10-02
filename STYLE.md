# STYLE.md: how to make the writing clear

Every page is edited against this list. CLAUDE.md sets the voice; this is the checklist that gets a
page there. The rules are the family's (`snowch/sizing-and-tco`, `snowch/parquet-book`), trimmed
to the habits a book about threads is most prone to.

The goal: an experienced engineer understands each paragraph on the first reading.

## 1. Short sentences, one idea each

About twenty words. Split a sentence that carries two ideas. Three shapes hide a second sentence
inside a first: a clause after *which*, *rather than* or a second *and*; a colon followed by a list
of clauses; a parenthesis holding a thought of its own.

## 2. One idea per paragraph

A paragraph answers one question. If it moves from what a store buffer is to why x86 keeps one,
it is two paragraphs.

## 3. The point first

> The second store overwrites the first.

before the reasons, not after them. Do not set a small puzzle and make the reader wait for the
answer. Say which operation and why.

## 4. Show the instruction

An abstract statement about what the compiler does is weaker than the fragment that shows it.
Where a sentence describes an operation or an instruction, the page should have a fragment or an
experiment that shows it, and the sentence should point at it.

## 5. Ordinary words

*use*, not *utilise*; *start*, not *commence*; *show*, not *demonstrate*; *to*, not *in order to*.
Keep technical terms that do work (*read-modify-write*, *store buffer*, *acquire*), and define each
in plain words where it first appears.

## 6. Define a term before it carries an argument

A term used in an argument must be defined earlier on the same page, in plain words. The glossary
(Appendix C) is a reference, not a substitute.

## 7. Headings name what a section contains

A few words, not a sentence, not a question unless the section answers it: *The loop*, not
*What does the loop become?*.

## 8. Lists for three or more parallel things

And every item in a list takes the same shape: all sentences or all phrases.

## 9. Cause and effect, said

*The increment is three operations.* Then: *so another thread can run between them*, and *so the
second store can overwrite the first*. Do not leave the reader to infer why a fact matters.

## 10. Precision is not negotiable

Clarity never removes a caveat, turns one observed run into a rule, or rounds a specification's
*must* into *usually*. Say what the model leaves out. Say what the fragment does not promise. Say
which of the four (the language, the compiler, the instruction set, the microarchitecture) is
responsible for a surprise.

## 11. You, and the active voice

*You set the workers; the kernel loses the increments.* Use the passive only when the actor is
obvious and uninteresting.

## 12. No em dashes

Use a full stop, a colon, a comma or parentheses. `tests/test_book.py` checks every page and every
document.

## 13. No filler, no performance

Banned outright, and checked: *In this chapter*, *simply*, *just*, *obviously*, *basically*. Also
cut on sight: *it is worth noting that*, *actually*, *really*, *genuinely*, *quite*, *very*, fake
enthusiasm, and rhetorical questions the next sentence answers.

## 14. A short sentence lands a point; it does not label one

*Nothing orders them.* lands the point before it. *Three operations.* as the opening of a
paragraph is a heading in disguise: write the sentence that says what the three operations are.

## 15. A demonstrative needs its noun

If *this*, *that* or *it* points more than one sentence back, name the thing.

## 16. An evaluation gives its grounds

*The atomic version is slower* is incomplete. *The atomic version is slower, because every
increment now takes the cache line in exclusive state* is a claim, and the experiment that shows
it is beside it.

## 17. Numbers are observed or generated

Never type a measured number, even to make a sentence clearer. Point at the panel or the table
that shows it. A nondeterministic result is *what this run observed*, never *what happens*. See
AUTHORING_GUIDE.md.

## 18. Incidental machinery never blocks the concept

Never make unexplained machinery a prerequisite for the idea on the page. When a reader meets
C, compiler, library, operating-system, instruction-set or build machinery that is not the
chapter's subject, explain enough to unblock them in a folded note labelled with where it comes
from, and mark it as incidental. When the machinery becomes the subject, teach it in the open.
The kernel, the fragments and the results never fold. See AUTHORING_GUIDE.md for the note.

## Before you finish: two passes

**First pass, the sentences.** Rules 1, 5, 11, 12, 13, 14, 15. A scan: minutes per page.

**Second pass, the idea.** Rules 2, 3, 4, 6, 9, 10, 16, 18. Read the page as a reader arriving from the
previous chapter. At each paragraph ask: what does this paragraph claim, and could I point at the
instruction, the run or the trace that shows it? A page can pass the first pass and fail the
second: clean sentences, nothing to hold on to.
