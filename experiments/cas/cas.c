/* Compare-and-swap: change a word only if it still holds what you last saw.
 *
 * ch04 increments a counter with a compare-and-swap loop and counts every retry, then builds a
 * lock from the same instruction. Later chapters build stacks and queues from it.
 */
#include "../cm.h"

/* The counter, incremented only by compare-and-swap. */
_Atomic int counter = 0;

/* How many times each worker's compare-and-swap failed and went round again. */
_Atomic int retries[64];

/* A lock made of one word: 0 free, 1 held. */
_Atomic int lock = 0;

/* A plain counter, changed only while holding the lock. */
int protected_counter = 0;

/* One increment by compare-and-swap. Read the value, compute the new one, and store it only if
   the word still holds the value read; otherwise `seen` is updated to what it holds now, and the
   loop computes again from that. Returns how many times it had to go round. */
CM_NOINLINE int increment_with_cas(void) {
  int tries = 0;
  int seen = atomic_load_explicit(&counter, memory_order_relaxed);
  while (!atomic_compare_exchange_weak_explicit(&counter, &seen, seen + 1, memory_order_relaxed,
                                                memory_order_relaxed)) {
    tries++;
  }
  return tries;
}

/* Take the lock: change it from 0 to 1, and only if it is 0. The orderings are Part III's; for
   now, read them as "the critical section stays inside the lock". */
CM_NOINLINE void lock_acquire(void) {
  int expected = 0;
  while (!atomic_compare_exchange_weak_explicit(&lock, &expected, 1, memory_order_acquire,
                                                memory_order_relaxed)) {
    expected = 0;
  }
}

/* Release it: back to 0. Nobody else can hold it, so no compare is needed. */
CM_NOINLINE void lock_release(void) { atomic_store_explicit(&lock, 0, memory_order_release); }

/* a: increments per worker. b: 0 increments by compare-and-swap, 1 plain increments under the
   lock built from it. c: unused. */
CM_EXPORT("cm_run") void cm_run(int tid, int a, int b, int c) {
  (void)c;
  cm_barrier_wait();
  int tries = 0;
  if (b == 1) {
    for (int i = 0; i < a; i++) {
      lock_acquire();
      protected_counter++;
      lock_release();
    }
  } else {
    for (int i = 0; i < a; i++) tries += increment_with_cas();
  }
  atomic_store_explicit(&retries[tid & 63], tries, memory_order_relaxed);
}

CM_EXPORT("cm_reset") void cm_reset(void) {
  atomic_store_explicit(&counter, 0, memory_order_relaxed);
  atomic_store_explicit(&lock, 0, memory_order_relaxed);
  protected_counter = 0;
  for (int i = 0; i < 64; i++) atomic_store_explicit(&retries[i], 0, memory_order_relaxed);
  cm_barrier_reset();
}

/* Result 0: the counter. Result 1: every worker's retries, added up. Result 2: the counter
   under the lock. Result 3: the most retries any one worker made. */
CM_EXPORT("cm_result") int cm_result(int i) {
  if (i == 0) return atomic_load_explicit(&counter, memory_order_relaxed);
  if (i == 1 || i == 3) {
    int total = 0, most = 0;
    for (int w = 0; w < 64; w++) {
      int r = atomic_load_explicit(&retries[w], memory_order_relaxed);
      total += r;
      if (r > most) most = r;
    }
    return i == 1 ? total : most;
  }
  if (i == 2) return protected_counter;
  return -1;
}
