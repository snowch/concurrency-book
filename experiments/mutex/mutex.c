/* From a spinlock to a mutex: a lock whose waiters sleep.
 *
 * ch06 runs the spinlock from ch05 beside a lock that puts a waiting worker to sleep on the lock
 * word and wakes it on release, and beside one that spins a little first.
 */
#include "../cm.h"

/* The lock word. 0: free. 1: held, nobody waiting. 2: held, and somebody may be asleep on it. */
_Atomic int32_t lock = 0;

/* The counter the lock protects. */
int counter = 0;

/* Per worker: how many spins it made, and how many times it went to sleep. */
_Atomic int spins[64];
_Atomic int sleeps[64];

/* The spinlock from ch05, for comparison. */
CM_NOINLINE int spin_lock(void) {
  int spun = 0;
  while (atomic_exchange_explicit(&lock, 1, memory_order_acquire) != 0) spun++;
  return spun;
}

CM_NOINLINE void spin_unlock(void) { atomic_store_explicit(&lock, 0, memory_order_release); }

/* The sleeping lock. Try to take it from 0 to 1. Failing that, mark it 2, "somebody is
   waiting", and sleep until the word is no longer 2. Woken, try again, and mark it 2 again on
   the way in, since other sleepers may remain. Returns how many times it slept. */
CM_NOINLINE int mutex_lock(void) {
  int slept = 0;
  int32_t seen = 0;
  if (atomic_compare_exchange_strong_explicit(&lock, &seen, 1, memory_order_acquire,
                                              memory_order_relaxed)) {
    return 0;
  }
  if (seen != 2) seen = atomic_exchange_explicit(&lock, 2, memory_order_acquire);
  while (seen != 0) {
    cm_wait(&lock, 2);
    slept++;
    seen = atomic_exchange_explicit(&lock, 2, memory_order_acquire);
  }
  return slept;
}

/* Release. Count the word down; if it was 2, somebody may be asleep, so set it to 0 and wake
   one of them. If it was 1, nobody is waiting and the wake is saved. */
CM_NOINLINE void mutex_unlock(void) {
  if (atomic_fetch_sub_explicit(&lock, 1, memory_order_release) != 1) {
    atomic_store_explicit(&lock, 0, memory_order_release);
    cm_notify_one(&lock);
  }
}

/* Spin a bounded number of times before sleeping: the holder is often about to release. */
CM_NOINLINE int mutex_lock_spinning(int *spun) {
  for (int i = 0; i < 100; i++) {
    int32_t seen = 0;
    if (atomic_compare_exchange_weak_explicit(&lock, &seen, 1, memory_order_acquire,
                                              memory_order_relaxed)) {
      return 0;
    }
    (*spun)++;
  }
  return mutex_lock();
}

static void critical_section(int work) {
  counter++;
  for (volatile int i = 0; i < work; i++) {}
}

/* a: critical sections per worker. b: 0 spin, 1 sleep, 2 spin a little then sleep. c: busy
   steps inside each critical section. */
CM_EXPORT("cm_run") void cm_run(int tid, int a, int b, int c) {
  cm_barrier_wait();
  int spun = 0, slept = 0;
  for (int i = 0; i < a; i++) {
    if (b == 1) {
      slept += mutex_lock();
      critical_section(c);
      mutex_unlock();
    } else if (b == 2) {
      slept += mutex_lock_spinning(&spun);
      critical_section(c);
      mutex_unlock();
    } else {
      spun += spin_lock();
      critical_section(c);
      spin_unlock();
    }
  }
  atomic_store_explicit(&spins[tid & 63], spun, memory_order_relaxed);
  atomic_store_explicit(&sleeps[tid & 63], slept, memory_order_relaxed);
}

CM_EXPORT("cm_reset") void cm_reset(void) {
  atomic_store_explicit(&lock, 0, memory_order_relaxed);
  counter = 0;
  for (int i = 0; i < 64; i++) {
    atomic_store_explicit(&spins[i], 0, memory_order_relaxed);
    atomic_store_explicit(&sleeps[i], 0, memory_order_relaxed);
  }
  cm_barrier_reset();
}

/* Result 0: the counter. Result 1: spins, all workers. Result 2: sleeps, all workers. */
CM_EXPORT("cm_result") int cm_result(int i) {
  if (i == 0) return counter;
  if (i == 1 || i == 2) {
    int total = 0;
    for (int w = 0; w < 64; w++) {
      total += atomic_load_explicit(i == 1 ? &spins[w] : &sleeps[w], memory_order_relaxed);
    }
    return total;
  }
  return -1;
}
