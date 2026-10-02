/* Contention: the same work on one shared word, or on a word per worker.
 *
 * ch21 runs this with one worker, then two, then more, and draws the rate. Every worker makes the
 * same number of increments; where they land is the layout: one atomic counter all share, an
 * atomic counter per worker on a line of its own, or a plain counter per worker on its own line.
 */
#include "../cm.h"

#define SLOTS 1024
_Atomic int shared = 0;
_Atomic int atomic_slots[SLOTS];
int plain_slots[SLOTS];

CM_NOINLINE void bump_shared(void) { atomic_fetch_add_explicit(&shared, 1, memory_order_relaxed); }
CM_NOINLINE void bump_own(_Atomic int *slot) {
  atomic_fetch_add_explicit(slot, 1, memory_order_relaxed);
}
CM_NOINLINE void bump_plain(int *slot) { (*slot)++; }

/* a: increments per worker. b: 0 one shared atomic counter, 1 an atomic counter per worker on
   its own line, 2 a plain counter per worker on its own line. c: unused. */
CM_EXPORT("cm_run") void cm_run(int tid, int a, int b, int c) {
  (void)c;
  int w = (tid & 31) * 16;
  cm_barrier_wait();
  if (b == 1) {
    for (int i = 0; i < a; i++) bump_own(&atomic_slots[w]);
  } else if (b == 2) {
    for (int i = 0; i < a; i++) bump_plain(&plain_slots[w]);
  } else {
    for (int i = 0; i < a; i++) bump_shared();
  }
}

CM_EXPORT("cm_reset") void cm_reset(void) {
  atomic_store_explicit(&shared, 0, memory_order_relaxed);
  for (int i = 0; i < SLOTS; i++) {
    atomic_store_explicit(&atomic_slots[i], 0, memory_order_relaxed);
    plain_slots[i] = 0;
  }
  cm_barrier_reset();
}

/* Result 0: every counter added up, whichever layout ran. */
CM_EXPORT("cm_result") int cm_result(int i) {
  if (i == 0) {
    int total = atomic_load_explicit(&shared, memory_order_relaxed);
    for (int s = 0; s < SLOTS; s++) {
      total += atomic_load_explicit(&atomic_slots[s], memory_order_relaxed) + plain_slots[s];
    }
    return total;
  }
  return -1;
}
