"""The book's shape, in one machine-readable place.

PLAN.md holds the argument: what each chapter is for, and why the book is in this order. This
module holds only what a script or a test needs: the order, the titles, the question each
chapter answers, what the reader can do at the end of it, and which experiments it embeds.

A chapter's number is derived from its position here and never typed anywhere else. Its identity
is its slug: the file name and the anchor a cross-reference uses.
"""

from __future__ import annotations

from dataclasses import dataclass

#: The headings every chapter carries, in order. ``tests/test_book.py`` holds every chapter to
#: them. A section a chapter needs and this list lacks is a subsection of one of these.
#:
#: The order is the book's method: a question, the smallest program that asks it, a run, the
#: operations the source hid, the instructions the compiler emitted, one change that fixes it, one
#: change that breaks it again, and the model the reader takes to the next chapter.
CHAPTER_SHAPE = (
    "The question",
    "The smallest program",
    "Run it",
    "What the source hides",
    "At the machine",
    "Fix one thing",
    "Break it again",
    "The mental model",
    "What this cannot tell you",
    "Where to go next",
)

#: Headings a chapter may leave out, where removing a guarantee would show nothing new.
OPTIONAL_HEADINGS = frozenset({"Break it again"})

#: What a page carries until it is written. Everything that reports progress keys off it.
UNWRITTEN = "[To write"


@dataclass(frozen=True)
class Part:
    slug: str
    title: str
    question: str

    @property
    def path(self) -> str:
        return f"parts/{self.slug}.md"

    @property
    def anchor(self) -> str:
        return "part-" + self.slug.replace("_", "-")


@dataclass(frozen=True)
class Chapter:
    number: int
    slug: str
    title: str
    part: str
    #: The one question the chapter answers. Its opening paragraph expands it.
    question: str
    #: What the reader can do, or has seen run, at the end of the chapter.
    shows: str
    #: The experiments (``lab`` blocks) the chapter embeds.
    experiments: tuple[str, ...] = ()

    @property
    def anchor(self) -> str:
        return self.slug.replace("_", "-")

    @property
    def label(self) -> str:
        return f"ch{self.number:02d}"

    @property
    def path(self) -> str:
        return f"chapters/{self.slug}.md"


@dataclass(frozen=True)
class FrontPage:
    """A page between the preface and Part I: read before the chapters, numbered like none of them."""

    slug: str
    title: str

    @property
    def anchor(self) -> str:
        return self.slug.replace("_", "-")

    @property
    def path(self) -> str:
        return f"{self.slug}.md"


#: What a reader is asked to read before ch01, after the preface.
FRONT = (FrontPage("before_you_start", "Before you start"),)


@dataclass(frozen=True)
class Appendix:
    letter: str
    slug: str
    title: str

    @property
    def anchor(self) -> str:
        return self.slug.replace("_", "-")

    @property
    def label(self) -> str:
        return f"Appendix {self.letter}"

    @property
    def path(self) -> str:
        return f"appendices/{self.slug}.md"


PARTS = (
    Part(
        "instructions_and_races",
        "Part I: Instructions and races",
        "What does one line of code become, and what happens when two threads run it?",
    ),
    Part(
        "building_and_breaking_locks",
        "Part II: Building and breaking locks",
        "How does a lock come out of one atomic instruction, and what does it cost?",
    ),
    Part(
        "memory_ordering",
        "Part III: Memory ordering",
        "When does one thread's write become visible to another, and in what order?",
    ),
    Part(
        "hardware_reality",
        "Part IV: Hardware reality",
        "What is the machine doing that the memory model describes?",
    ),
    Part(
        "lock_free_algorithms",
        "Part V: Lock-free algorithms",
        "What can threads share with no lock at all, and what does that cost them?",
    ),
    Part(
        "performance_and_the_laboratory",
        "Part VI: Performance and the browser laboratory",
        "How do these experiments run in a browser, and what do they measure?",
    ),
)

_P = {p.slug: p.title for p in PARTS}

_CHAPTERS = (
    (
        "what_x_plus_plus_does",
        "What does x++ actually do?",
        "instructions_and_races",
        "What does one increment of a shared variable become, once the compiler is done with it?",
        "One increment expanded into a load, an add and a store, and the instructions four "
        "compilers' targets emit for it.",
        ("counter",),
    ),
    (
        "two_threads_one_variable",
        "Two threads, one variable",
        "instructions_and_races",
        "Why can two threads each increment a counter a million times and still lose increments?",
        "A lost update, forced in a deterministic trace and then observed on real workers.",
        ("counter",),
    ),
    (
        "atomic_operations",
        "Atomic operations",
        "instructions_and_races",
        "What does an atomic read-modify-write fix, and which concurrency problems does it leave?",
        "The same counter incremented atomically, losing nothing, and the one instruction that "
        "replaced three.",
        ("counter",),
    ),
    (
        "compare_and_swap",
        "Compare-and-swap",
        "instructions_and_races",
        "How can one instruction let a thread change a value only if nobody else has?",
        "A compare-and-swap loop that retries under contention, with every retry counted, and a "
        "lock built from it.",
        ("cas",),
    ),
    (
        "test_and_set_and_spinlocks",
        "Test-and-set and spinlocks",
        "building_and_breaking_locks",
        "What does a thread do while it waits for a lock, and what does that cost the others?",
        "A spinlock under contention: who gets it, how often, and how long the others burn.",
        ("spinlock",),
    ),
    (
        "from_spinlock_to_mutex",
        "From spinlock to mutex",
        "building_and_breaking_locks",
        "Why is a production mutex more than an atomic variable and a loop?",
        "A lock that sleeps instead of spinning, and the cost of each when the holder is slow.",
        ("mutex",),
    ),
    (
        "the_compiler_is_part_of_the_story",
        "The compiler is part of the concurrency story",
        "building_and_breaking_locks",
        "Why can a program that reads a flag in a loop never see the flag change?",
        "A loop the optimiser turned into a single load, the same loop with volatile, and the "
        "same loop with an atomic, each compiled and run.",
        ("compiler",),
    ),
    (
        "acquire_and_release",
        "Acquire and release",
        "memory_ordering",
        "How does one thread hand a finished piece of data to another, safely?",
        "A message passed through a flag, with the orderings that make the data arrive with it.",
        ("publication",),
    ),
    (
        "relaxed_atomics",
        "Relaxed atomics",
        "memory_ordering",
        "What does an atomic operation still guarantee when it promises nothing about order?",
        "A relaxed counter that is exact, and a relaxed flag that publishes nothing.",
        ("publication",),
    ),
    (
        "sequential_consistency",
        "Sequential consistency",
        "memory_ordering",
        "What is the strongest ordering, and what does asking for it change in the code?",
        "A two-thread test whose impossible outcome appears under weaker orderings and never "
        "under sequential consistency.",
        ("store_buffer",),
    ),
    (
        "fences",
        "Fences",
        "memory_ordering",
        "What does a fence order, and why is it not a substitute for an atomic read-modify-write?",
        "The same test with a fence between the store and the load, and the instruction each "
        "target uses for it.",
        ("store_buffer",),
    ),
    (
        "cache_coherence",
        "Cache coherence",
        "hardware_reality",
        "If every core has its own cache, how does a write by one ever reach another?",
        "A line passed between cores, timed against the same work on lines nobody shares.",
        ("sharing",),
    ),
    (
        "false_sharing",
        "False sharing",
        "hardware_reality",
        "Why do two threads that never touch the same variable slow each other down?",
        "Two independent counters on one cache line, then padded apart, timed side by side.",
        ("sharing",),
    ),
    (
        "store_buffers_and_visibility",
        "Store buffers and visibility",
        "hardware_reality",
        "Why does another core not see a store the moment it happens?",
        "A store that sits in a buffer while the load after it runs, observed on x86-64.",
        ("store_buffer",),
    ),
    (
        "x86_is_not_the_model",
        "x86 is not the model",
        "hardware_reality",
        "Which reorderings does each architecture allow, and what does the same C become on each?",
        "The orderings of x86-64, AArch64 and RISC-V side by side, with the instructions each "
        "needs for the same source.",
        ("store_buffer", "publication"),
    ),
    (
        "lock_free_stack",
        "Lock-free stack",
        "lock_free_algorithms",
        "How can many threads push and pop one stack with no lock?",
        "A stack built on compare-and-swap, pushed and popped by workers, with every node accounted for.",
        ("stack",),
    ),
    (
        "the_aba_problem",
        "The ABA problem",
        "lock_free_algorithms",
        "How can a compare-and-swap succeed when the world changed underneath it?",
        "A pop that succeeds on a stale head, stepped through one operation at a time.",
        ("aba",),
    ),
    (
        "memory_reclamation",
        "Memory reclamation",
        "lock_free_algorithms",
        "Why does removing a lock create a problem about when memory may be reused?",
        "A node freed while a reader still holds it, in an unsafe mode and a safe one.",
        ("reclamation",),
    ),
    (
        "lock_free_queue",
        "Lock-free queue",
        "lock_free_algorithms",
        "How do many producers and many consumers share one queue without a lock?",
        "A bounded queue built up in steps, with producers and consumers you set.",
        ("queue",),
    ),
    (
        "rcu",
        "RCU",
        "lock_free_algorithms",
        "How can readers never wait, if a writer must still replace what they read?",
        "Readers that never block, a writer that waits for a grace period, and the reclamation "
        "that waiting makes safe.",
        ("rcu",),
    ),
    (
        "contention_and_scalability",
        "Contention and scalability",
        "performance_and_the_laboratory",
        "Why does adding workers to a shared counter make it slower, not faster?",
        "Throughput against the number of workers, drawn from your own device's cores.",
        ("contention",),
    ),
    (
        "webassembly_threads",
        "WebAssembly threads",
        "performance_and_the_laboratory",
        "How does a web page run threads on shared memory at all?",
        "A worker that sleeps on a word of shared memory and the notify that wakes it.",
        ("handshake",),
    ),
    (
        "build_a_concurrency_lab",
        "Build a concurrency lab in the browser",
        "performance_and_the_laboratory",
        "What does it take to run a C kernel on real threads in a page, and measure it?",
        "The book's own laboratory, taken apart: the kernel, the module, the workers and the measurement.",
        ("counter",),
    ),
    (
        "from_wasm_to_machine_code",
        "From Wasm to machine code",
        "performance_and_the_laboratory",
        "What happens between a WebAssembly atomic and the instruction the processor runs?",
        "One kernel's WebAssembly beside three native lowerings, and the boundary the browser "
        "draws between them.",
        ("counter",),
    ),
    (
        "diagnose_the_race",
        "Final challenge: diagnose the race",
        "performance_and_the_laboratory",
        "Given a program that is wrong once in a thousand runs, can you say why?",
        "A deliberately broken concurrent program, with the whole book's model as the only tool.",
        ("challenge",),
    ),
)

CHAPTERS = tuple(
    Chapter(
        number=i + 1,
        slug=slug,
        title=title,
        part=_P[part],
        question=question,
        shows=shows,
        experiments=experiments,
    )
    for i, (slug, title, part, question, shows, experiments) in enumerate(_CHAPTERS)
)

APPENDICES = (
    Appendix("A", "reproducing_at_a_desk", "Reproducing at a desk"),
    Appendix("B", "the_experiments", "The experiments"),
    Appendix("C", "glossary", "Glossary"),
    Appendix("D", "reading_the_fragments", "Reading the fragments"),
    Appendix("E", "the_c_after_kernighan_and_ritchie", "The C after Kernighan and Ritchie"),
)

BY_SLUG = {c.slug: c for c in CHAPTERS}
BY_ANCHOR = {x.anchor: x for x in (*CHAPTERS, *APPENDICES)}

#: The experiments the catalogue in ``experiments/`` must hold and ``web/lab/lab.js`` must mount,
#: in the order the book meets them. A ``lab`` block naming anything else fails the build, rather
#: than rendering an empty box. ``tools/experiments.py`` loads each one's contract.
EXPERIMENTS = (
    "counter",
    "cas",
    "spinlock",
    "mutex",
    "compiler",
    "publication",
    "store_buffer",
    "sharing",
    "stack",
    "aba",
    "reclamation",
    "queue",
    "rcu",
    "contention",
    "handshake",
    "challenge",
)
