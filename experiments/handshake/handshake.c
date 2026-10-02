/* A handshake between two workers: one says "ping", the other answers "pong", round after round.
 *
 * ch22. Each worker waits for the other's word with the two instructions a web page has for
 * waiting and waking, memory.atomic.wait32 and memory.atomic.notify, or by spinning on the word.
 * The time per round trip is the cost of being woken, against the cost of never sleeping.
 */
#include "../cm.h"

_Atomic int32_t ping = 0;
_Atomic int32_t pong = 0;
_Atomic int rounds_done = 0;
_Atomic int sleeps = 0;
_Atomic int spins = 0;

/* Wait until the word reads at least `want`, sleeping while it does not. */
CM_NOINLINE void await_sleeping(_Atomic int32_t *word, int want) {
  int seen;
  while ((seen = atomic_load_explicit(word, memory_order_acquire)) < want) {
    cm_wait(word, seen);
    atomic_fetch_add_explicit(&sleeps, 1, memory_order_relaxed);
  }
}

/* Wait until the word reads at least `want`, spinning. */
CM_NOINLINE void await_spinning(_Atomic int32_t *word, int want) {
  while (atomic_load_explicit(word, memory_order_acquire) < want) {
    atomic_fetch_add_explicit(&spins, 1, memory_order_relaxed);
  }
}

/* Say a word: store the round number and wake whoever sleeps on it. */
CM_NOINLINE void say(_Atomic int32_t *word, int round) {
  atomic_store_explicit(word, round, memory_order_release);
  cm_notify(word);
}

/* Two workers. a: round trips. b: 0 sleep and wake, 1 spin. c: unused. */
CM_EXPORT("cm_run") void cm_run(int tid, int a, int b, int c) {
  (void)c;
  cm_barrier_wait();
  for (int round = 1; round <= a; round++) {
    if (tid == 0) {
      say(&ping, round);
      if (b == 1) await_spinning(&pong, round);
      else await_sleeping(&pong, round);
    } else {
      if (b == 1) await_spinning(&ping, round);
      else await_sleeping(&ping, round);
      say(&pong, round);
    }
  }
  if (tid == 0) atomic_store_explicit(&rounds_done, a, memory_order_relaxed);
}

CM_EXPORT("cm_reset") void cm_reset(void) {
  atomic_store_explicit(&ping, 0, memory_order_relaxed);
  atomic_store_explicit(&pong, 0, memory_order_relaxed);
  atomic_store_explicit(&rounds_done, 0, memory_order_relaxed);
  atomic_store_explicit(&sleeps, 0, memory_order_relaxed);
  atomic_store_explicit(&spins, 0, memory_order_relaxed);
  cm_barrier_reset();
}

/* Result 0: round trips. Result 1: times a worker slept. Result 2: spins. */
CM_EXPORT("cm_result") int cm_result(int i) {
  if (i == 0) return atomic_load_explicit(&rounds_done, memory_order_relaxed);
  if (i == 1) return atomic_load_explicit(&sleeps, memory_order_relaxed);
  if (i == 2) return atomic_load_explicit(&spins, memory_order_relaxed);
  return -1;
}
