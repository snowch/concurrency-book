/* The store-buffer test. Two workers, two words. Each stores a one into its own word and then
 * loads the other's. Can both load a zero? In a world where every store is visible the moment
 * it happens, no: one of the two stores came first, and the other worker's load came after it.
 * On most processors, yes: a store waits in a buffer while the load after it runs.
 *
 * ch10, ch11, ch14 and ch15 run this test under different orderings and on different
 * architectures. The two workers run many trials, each begun together behind a trial barrier,
 * and the counts of the four outcomes are the result.
 */
#include "../cm.h"

/* The two words, as volatile and as atomic, so each variant has its own. */
volatile int volatile_x = 0, volatile_y = 0;
_Atomic int x = 0, y = 0;

/* Worker 0's half, five ways: store x, then load y. */
CM_NOINLINE int sb_volatile_a(void) {
  volatile_x = 1;
  return volatile_y;
}
CM_NOINLINE int sb_relaxed_a(void) {
  atomic_store_explicit(&x, 1, memory_order_relaxed);
  return atomic_load_explicit(&y, memory_order_relaxed);
}
CM_NOINLINE int sb_release_acquire_a(void) {
  atomic_store_explicit(&x, 1, memory_order_release);
  return atomic_load_explicit(&y, memory_order_acquire);
}
CM_NOINLINE int sb_seq_cst_a(void) {
  atomic_store_explicit(&x, 1, memory_order_seq_cst);
  return atomic_load_explicit(&y, memory_order_seq_cst);
}
CM_NOINLINE int sb_fence_a(void) {
  volatile_x = 1;
  atomic_thread_fence(memory_order_seq_cst);
  return volatile_y;
}

/* Worker 1's half, the mirror image: store y, then load x. */
CM_NOINLINE int sb_volatile_b(void) {
  volatile_y = 1;
  return volatile_x;
}
CM_NOINLINE int sb_relaxed_b(void) {
  atomic_store_explicit(&y, 1, memory_order_relaxed);
  return atomic_load_explicit(&x, memory_order_relaxed);
}
CM_NOINLINE int sb_release_acquire_b(void) {
  atomic_store_explicit(&y, 1, memory_order_release);
  return atomic_load_explicit(&x, memory_order_acquire);
}
CM_NOINLINE int sb_seq_cst_b(void) {
  atomic_store_explicit(&y, 1, memory_order_seq_cst);
  return atomic_load_explicit(&x, memory_order_seq_cst);
}
CM_NOINLINE int sb_fence_b(void) {
  volatile_y = 1;
  atomic_thread_fence(memory_order_seq_cst);
  return volatile_x;
}

/* The trial barrier, and worker 1's result for the trial, handed to worker 0 to tally. */
_Atomic int arrived = 0;
_Atomic int result_b = 0;
_Atomic int counts[4];
_Atomic int trials_done = 0;

static void meet(int at) {
  atomic_fetch_add_explicit(&arrived, 1, memory_order_seq_cst);
  while (atomic_load_explicit(&arrived, memory_order_seq_cst) < at) {}
}

/* Two workers. a: trials. b: the variant, 0 volatile, 1 relaxed, 2 release and acquire,
   3 sequentially consistent, 4 volatile with a fence. c: unused. */
CM_EXPORT("cm_run") void cm_run(int tid, int a, int b, int c) {
  (void)c;
  cm_barrier_wait();
  for (int t = 0; t < a; t++) {
    meet(4 * t + 2);
    int r;
    if (tid == 0) {
      r = b == 1   ? sb_relaxed_a()
          : b == 2 ? sb_release_acquire_a()
          : b == 3 ? sb_seq_cst_a()
          : b == 4 ? sb_fence_a()
                   : sb_volatile_a();
    } else {
      r = b == 1   ? sb_relaxed_b()
          : b == 2 ? sb_release_acquire_b()
          : b == 3 ? sb_seq_cst_b()
          : b == 4 ? sb_fence_b()
                   : sb_volatile_b();
      atomic_store_explicit(&result_b, r, memory_order_seq_cst);
    }
    meet(4 * t + 4);
    if (tid == 0) {
      int r2 = atomic_load_explicit(&result_b, memory_order_seq_cst);
      atomic_fetch_add_explicit(&counts[(r ? 2 : 0) + (r2 ? 1 : 0)], 1, memory_order_relaxed);
      volatile_x = 0;
      volatile_y = 0;
      atomic_store_explicit(&x, 0, memory_order_seq_cst);
      atomic_store_explicit(&y, 0, memory_order_seq_cst);
      atomic_store_explicit(&trials_done, t + 1, memory_order_relaxed);
    }
  }
}

CM_EXPORT("cm_reset") void cm_reset(void) {
  volatile_x = 0;
  volatile_y = 0;
  atomic_store_explicit(&x, 0, memory_order_relaxed);
  atomic_store_explicit(&y, 0, memory_order_relaxed);
  atomic_store_explicit(&arrived, 0, memory_order_relaxed);
  atomic_store_explicit(&result_b, 0, memory_order_relaxed);
  for (int i = 0; i < 4; i++) atomic_store_explicit(&counts[i], 0, memory_order_relaxed);
  atomic_store_explicit(&trials_done, 0, memory_order_relaxed);
  cm_barrier_reset();
}

/* Result 0: trials. Results 1 to 4: how often (r1, r2) was (0, 0), (0, 1), (1, 0), (1, 1). */
CM_EXPORT("cm_result") int cm_result(int i) {
  if (i == 0) return atomic_load_explicit(&trials_done, memory_order_relaxed);
  if (i >= 1 && i <= 4) return atomic_load_explicit(&counts[i - 1], memory_order_relaxed);
  return -1;
}
