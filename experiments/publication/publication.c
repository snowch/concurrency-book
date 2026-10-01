/* Publication: a writer prepares a value, then raises a flag; a reader waits for the flag, then
 * reads the value. Whether the value has arrived when the flag has is the question of ch08 and
 * ch09, and the answer depends on the ordering the stores and loads ask for.
 *
 * The two workers run many trials. In trial t the writer stores t into the data and then raises
 * the flag to t; the reader waits for the flag to read t, then reads the data, and counts a
 * stale read if the data is not yet t. An acknowledgement, which is always sequentially
 * consistent, hands the next trial to the writer.
 */
#include "../cm.h"

/* The value being published: plain, because the flag is meant to carry it. */
int data = 0;

/* The flag, as a volatile word and as an atomic one, so each variant has its own. */
volatile int volatile_ready = 0;
_Atomic int ready = 0;

/* The reader's acknowledgement of trial t, and the counts. */
_Atomic int ack = 0;
_Atomic int stale = 0;
_Atomic int trials_done = 0;

/* The writer's half, four ways. */
CM_NOINLINE void publish_volatile(int t) {
  data = t;
  volatile_ready = t;
}
CM_NOINLINE void publish_relaxed(int t) {
  data = t;
  atomic_store_explicit(&ready, t, memory_order_relaxed);
}
CM_NOINLINE void publish_release(int t) {
  data = t;
  atomic_store_explicit(&ready, t, memory_order_release);
}
CM_NOINLINE void publish_seq_cst(int t) {
  data = t;
  atomic_store_explicit(&ready, t, memory_order_seq_cst);
}

/* The reader's half, four ways: wait for the flag to read t, then read the data. */
CM_NOINLINE int receive_volatile(int t) {
  while (volatile_ready != t) {}
  return data;
}
CM_NOINLINE int receive_relaxed(int t) {
  while (atomic_load_explicit(&ready, memory_order_relaxed) != t) {}
  return data;
}
CM_NOINLINE int receive_acquire(int t) {
  while (atomic_load_explicit(&ready, memory_order_acquire) != t) {}
  return data;
}
CM_NOINLINE int receive_seq_cst(int t) {
  while (atomic_load_explicit(&ready, memory_order_seq_cst) != t) {}
  return data;
}

/* Two workers. Worker 0 writes, worker 1 reads. a: trials. b: the ordering, 0 volatile,
   1 relaxed, 2 release and acquire, 3 sequentially consistent. c: unused. */
CM_EXPORT("cm_run") void cm_run(int tid, int a, int b, int c) {
  (void)c;
  cm_barrier_wait();
  if (tid == 0) {
    for (int t = 1; t <= a; t++) {
      while (atomic_load_explicit(&ack, memory_order_seq_cst) != t - 1) {}
      if (b == 1) publish_relaxed(t);
      else if (b == 2) publish_release(t);
      else if (b == 3) publish_seq_cst(t);
      else publish_volatile(t);
    }
  } else if (tid == 1) {
    int seen_stale = 0;
    for (int t = 1; t <= a; t++) {
      int value = b == 1   ? receive_relaxed(t)
                  : b == 2 ? receive_acquire(t)
                  : b == 3 ? receive_seq_cst(t)
                           : receive_volatile(t);
      if (value != t) seen_stale++;
      atomic_store_explicit(&ack, t, memory_order_seq_cst);
    }
    atomic_store_explicit(&stale, seen_stale, memory_order_relaxed);
    atomic_store_explicit(&trials_done, a, memory_order_relaxed);
  }
}

CM_EXPORT("cm_reset") void cm_reset(void) {
  data = 0;
  volatile_ready = 0;
  atomic_store_explicit(&ready, 0, memory_order_relaxed);
  atomic_store_explicit(&ack, 0, memory_order_relaxed);
  atomic_store_explicit(&stale, 0, memory_order_relaxed);
  atomic_store_explicit(&trials_done, 0, memory_order_relaxed);
  cm_barrier_reset();
}

/* Result 0: trials completed. Result 1: trials where the reader saw the flag but not the data. */
CM_EXPORT("cm_result") int cm_result(int i) {
  if (i == 0) return atomic_load_explicit(&trials_done, memory_order_relaxed);
  if (i == 1) return atomic_load_explicit(&stale, memory_order_relaxed);
  return -1;
}
