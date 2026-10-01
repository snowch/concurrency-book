/* Sharing a cache line. Every worker increments a counter of its own, and the page decides where
 * the counters live: all in one word, side by side in one cache line, or each on a line of its
 * own. The counts come out the same; the time does not. ch12 and ch13.
 */
#include "../cm.h"

/* Enough words for sixteen workers at a hundred and twenty-eight bytes apart. */
#define SLOTS 1024
_Atomic int slots[SLOTS];

/* One increment of a counter at an address the worker was given. */
CM_NOINLINE void bump(_Atomic int *slot) {
  atomic_fetch_add_explicit(slot, 1, memory_order_relaxed);
}

/* Where worker `tid`'s counter lives under each layout: 0 the same word for every worker,
   1 adjacent words, 2 sixty-four bytes apart, 3 a hundred and twenty-eight bytes apart. */
static int slot_of(int tid, int layout) {
  if (layout == 1) return tid;
  if (layout == 2) return tid * 16;
  if (layout == 3) return tid * 32;
  return 0;
}

/* a: increments per worker. b: the layout. c: unused. */
CM_EXPORT("cm_run") void cm_run(int tid, int a, int b, int c) {
  (void)c;
  _Atomic int *mine = &slots[slot_of(tid & 31, b)];
  cm_barrier_wait();
  for (int i = 0; i < a; i++) bump(mine);
}

CM_EXPORT("cm_reset") void cm_reset(void) {
  for (int i = 0; i < SLOTS; i++) atomic_store_explicit(&slots[i], 0, memory_order_relaxed);
  cm_barrier_reset();
}

/* Result 0: every counter added up. */
CM_EXPORT("cm_result") int cm_result(int i) {
  if (i == 0) {
    int total = 0;
    for (int s = 0; s < SLOTS; s++) total += atomic_load_explicit(&slots[s], memory_order_relaxed);
    return total;
  }
  return -1;
}
