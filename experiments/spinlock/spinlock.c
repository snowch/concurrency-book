/* A spinlock: one word, taken by test-and-set, and the waiting that costs the others.
 *
 * ch05 takes the lock with an atomic exchange, then with a test before the exchange, and then
 * with a test and a set that are two operations, which is not a lock at all.
 */
#include "../cm.h"

/* The lock: 0 free, 1 held. */
_Atomic int lock = 0;

/* The counter the lock protects. Plain: only the holder of the lock touches it. */
int counter = 0;

/* How many times each worker took the lock, and how many spins it made waiting for it. */
_Atomic int acquisitions[64];
_Atomic int spins[64];

/* Test-and-set. Exchange a 1 into the word and look at what came out: a 0 means the lock was
   free and is now ours; a 1 means somebody holds it, so go round again. */
CM_NOINLINE int spin_acquire(void) {
  int spun = 0;
  while (atomic_exchange_explicit(&lock, 1, memory_order_acquire) == 1) spun++;
  return spun;
}

/* Test, then test-and-set. Spin on a plain atomic load, which reads the cached line without
   taking it from the holder, and attempt the exchange only once the load says the lock is free. */
CM_NOINLINE int spin_acquire_ttas(void) {
  int spun = 0;
  for (;;) {
    while (atomic_load_explicit(&lock, memory_order_relaxed) == 1) spun++;
    if (atomic_exchange_explicit(&lock, 1, memory_order_acquire) == 0) return spun;
  }
}

/* Not a lock. Test with a load, then set with a store: two operations, with a window between
   them that another worker's whole test fits into. */
CM_NOINLINE int broken_acquire(void) {
  int spun = 0;
  while (atomic_load_explicit(&lock, memory_order_relaxed) == 1) spun++;
  atomic_store_explicit(&lock, 1, memory_order_relaxed);
  return spun;
}

/* Release: a plain store of 0, since the holder is the only one who may. */
CM_NOINLINE void spin_release(void) { atomic_store_explicit(&lock, 0, memory_order_release); }

/* What happens inside the lock: the increment, then `work` steps of busy work, so the critical
   section can be made longer than the lock itself. */
static void critical_section(int work) {
  counter++;
  for (volatile int i = 0; i < work; i++) {}
}

/* a: critical sections per worker. b: 0 test-and-set, 1 test then test-and-set, 2 the broken
   test-then-set. c: busy steps inside each critical section. */
CM_EXPORT("cm_run") void cm_run(int tid, int a, int b, int c) {
  cm_barrier_wait();
  int spun = 0;
  for (int i = 0; i < a; i++) {
    if (b == 1) spun += spin_acquire_ttas();
    else if (b == 2) spun += broken_acquire();
    else spun += spin_acquire();
    critical_section(c);
    spin_release();
  }
  atomic_store_explicit(&acquisitions[tid & 63], a, memory_order_relaxed);
  atomic_store_explicit(&spins[tid & 63], spun, memory_order_relaxed);
}

CM_EXPORT("cm_reset") void cm_reset(void) {
  atomic_store_explicit(&lock, 0, memory_order_relaxed);
  counter = 0;
  for (int i = 0; i < 64; i++) {
    atomic_store_explicit(&acquisitions[i], 0, memory_order_relaxed);
    atomic_store_explicit(&spins[i], 0, memory_order_relaxed);
  }
  cm_barrier_reset();
}

/* Result 0: the counter. Result 1: every worker's spins, added up. Results 2 to 17: each of
   sixteen workers' spins, so the page can show who waited most. */
CM_EXPORT("cm_result") int cm_result(int i) {
  if (i == 0) return counter;
  if (i == 1) {
    int total = 0;
    for (int w = 0; w < 64; w++) total += atomic_load_explicit(&spins[w], memory_order_relaxed);
    return total;
  }
  if (i >= 2 && i < 18) return atomic_load_explicit(&spins[i - 2], memory_order_relaxed);
  return -1;
}
